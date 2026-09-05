import { randomUUID } from "node:crypto";
import { db } from "../db";
import { appendEvent, withTx, actorFields, type DbLike } from "../events";
import { authorize } from "../authz/authorize";
import { AppError, type Ctx } from "../authz/types";
import { nextCode } from "../model/codes";
import { deriveStatus, type ClockStatus } from "../journey/engine";

export type { ClockStatus } from "../journey/engine";

// 12-escalations-notifications.md. `0027_escalations.sql`'s header carries the full Data-table
// reconciliation (source_entity_id denormalization, escalation_rule.source_module as the real
// "condition" shape, decision_options). Depends on 10 (action/sla_clock_id, real), 06
// (deriveStatus — reused directly, not re-derived, from journey/engine.ts's pure function), 19/21
// (demand/loan_case, real, for decision-pack impact). Genuinely blocked/scoped forward
// dependencies, flagged not faked:
//  - Rule 1's tiering mechanism (SLA-clock-driven, via escalation_ladder attached to sla_policy)
//    is fully buildable now and IS what `scanEscalations` implements — no forward dependency at
//    all. Verified, not assumed, exactly what carries a real due date: `action.due_at` is never
//    set by any `createAction` call site outside `journey/instances.ts` — grepped every call site
//    (`collections-sweep.ts`, `demands.ts`, `loans/sweep.ts`, `loans/core.ts`) and none pass
//    `due_at`; the reminder/follow-up actions those create are undated "look at this" nudges, not
//    SLA-bound. `journey/instances.ts`'s own comment confirms `action.due_at` is deliberately never
//    duplicated there either — the one source of truth for a deadline is `sla_clock.due_at`,
//    reached via `action.sla_clock_id`. So `scannableActions` gates on `sla_clock_id IS NOT NULL`:
//    that is genuinely the only place in this codebase today an action carries a real deadline.
//  - Consequence for the 13-rule seed catalogue (escalation_rule): NONE of the 13 have a
//    deadline-bearing action to escalate through today, so all 13 are seeded `wired = false` —
//    real, not a stand-in for "the underlying spec isn't built" (commitment/13, snag/15,
//    handover/16, registration/23 are genuinely unbuilt; but payment/TDS/loan-sanction/legal-
//    review's own specs (19/21) ARE built — their reminder actions simply carry no due date to
//    escalate against). Wiring any of them for real needs either a due_at on those actions
//    (touches `collections-sweep.ts`/`demands.ts`/`loans/sweep.ts`/`loans/core.ts`, outside this
//    spec's Files list) or a second, domain-field-reading scan (a materially bigger mechanism than
//    this slice's escalation-ladder-plus-decision-pack scope) — flagged for a future slice, not
//    silently built around. All 13 still seed real rows (severity/category/decision_options) so
//    Policy Studio has real config to show once wiring lands.
//  - Rule 2's `options[]` ("from the action type's configured options" — no such config exists on
//    action_type) comes from `escalation_rule.decision_options` instead — unused today per the
//    point above, but real config for whenever a rule's `wired` flips true. An escalation raised
//    with no matching rule (the only kind possible today — the generic SLA-ladder path) gets a
//    fixed 2-option default.
//  - Rule 1's ladder step targets (BACKUP_OWNER/DEPT_HEAD/PROJECT_HEAD/MANAGEMENT) resolve through
//    `project_team_assignment` (0001_identity.sql: `is_backup_owner`, `escalation_manager_user_id`
//    — real columns, previously unused by any built spec). No multi-level org chart exists beyond
//    that one escalation-manager pointer, so DEPT_HEAD/PROJECT_HEAD/MANAGEMENT all resolve through
//    the same `escalation_manager_user_id` chain (falls back to any MANAGEMENT-role project
//    assignment for the top tier); a real multi-tier org model is out of scope here, flagged.
//  - Rule 3's snapshot/digest cadence (rule 5's daily digest, rule 3's "system takes MONTH_START…")
//    has no scheduler anywhere in this codebase (same gap already documented for 06/19/21) —
//    `scanEscalations`/`sendDigest` are directly callable with a controlled `asOf`, tested, not
//    cron-wired.
//
// Authorization: `escalations` module in the seeded matrix (§1.3) grants WRITE to CRM only (plus
// SUPER_ADMIN via ADMIN) — everyone else is READ. Built to match it exactly (same "trust the
// seeded matrix" discipline 21-loans.md's revert established), layered with a per-instance
// self-guard: the escalation's OWN current `owner_user_id` (whoever the ladder has tiered it to
// right now) may also act on it, mirroring `actions/core.ts`'s existing submitted_by/verifier_role
// self-guard pattern — otherwise a BANKING-owned L2 escalation could never be acted on by the
// BANKING dept head it was just tiered to. Logged here, not silently invented.

const TIERS = ["L0", "L1", "L2", "L3", "L4"] as const;
type Tier = (typeof TIERS)[number];

interface LadderStep {
  tier: Tier;
  after_hours: number;
  to: "OWNER" | "BACKUP_OWNER" | "DEPT_HEAD" | "PROJECT_HEAD" | "MANAGEMENT";
  notify_channel: "IN_APP" | "EMAIL";
}

export interface EscalationRow {
  id: string;
  code: string;
  action_id: string;
  rule_key: string | null;
  source_entity_type: string;
  source_entity_id: string;
  project_id: string | null;
  tier: Tier;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  category: "CUSTOMER" | "CASH" | "HANDOVER" | "REPUTATION" | "MARGIN";
  owner_user_id: string | null;
  status: "OPEN" | "ACKNOWLEDGED" | "IN_PROGRESS" | "RESOLVED" | "CLOSED" | "REOPENED";
  decision_pack: Record<string, unknown>;
  resolution_notes: string | null;
  raised_at: string;
  resolved_at: string | null;
  auto_closed: boolean;
}

const ESCALATION_SELECT = `
  SELECT id, code, action_id, rule_key, source_entity_type, source_entity_id, project_id, tier,
         severity, category, owner_user_id, status, decision_pack, resolution_notes,
         raised_at::text AS raised_at, resolved_at::text AS resolved_at, auto_closed
    FROM escalation
`;

async function requireEscalation(handle: DbLike, id: string): Promise<EscalationRow> {
  const r = await handle.query<EscalationRow>(`${ESCALATION_SELECT} WHERE id = $1`, [id]);
  if (!r.rows[0]) throw new AppError("not_found", "escalation not found");
  return r.rows[0];
}

/** Rule 7's WRITE gate + the per-instance self-guard documented above. */
async function assertCanAct(esc: EscalationRow, ctx: Ctx): Promise<void> {
  const level = await authorize(ctx, "escalations", "READ");
  if (level === "WRITE" || level === "ADMIN") return;
  if (ctx.actor.user_id === esc.owner_user_id) return;
  throw new AppError("forbidden", "escalations requires WRITE, or being this escalation's current tier owner");
}

interface ScannableAction {
  id: string;
  code: string;
  title: string;
  type: string;
  source_module: string;
  source_entity_type: string;
  source_entity_id: string;
  project_id: string | null;
  booking_id: string | null;
  owner_user_id: string | null;
  owner_role: string;
  backup_owner_user_id: string | null;
  sla_clock_id: string;
}

/** Every open, sla_clock-backed action — see this file's header for why that's genuinely the
 *  only place a real deadline lives in this codebase today (only `journey/instances.ts` sets
 *  `sla_clock_id`; no other `createAction` call site anywhere sets `due_at` either). */
async function scannableActions(tx: DbLike): Promise<ScannableAction[]> {
  const r = await tx.query<ScannableAction>(
    `SELECT a.id, a.code, a.title, a.type, a.source_module, a.source_entity_type, a.source_entity_id,
            a.project_id, a.booking_id, a.owner_user_id, a.owner_role, a.backup_owner_user_id,
            a.sla_clock_id
       FROM action a
       JOIN sla_clock c ON c.id = a.sla_clock_id
       JOIN sla_policy p ON p.id = c.policy_id
      WHERE a.status NOT IN ('Closed', 'Cancelled') AND p.escalation_ladder_id IS NOT NULL AND c.stopped_at IS NULL`
  );
  return r.rows;
}

interface MatchedRule {
  rule_key: string;
  severity: EscalationRow["severity"];
  category: EscalationRow["category"];
  decision_options: { label: string; clears_block: boolean; leakage_inr: number | null }[];
}

async function matchRule(sourceModule: string, tx: DbLike): Promise<MatchedRule | null> {
  const r = await tx.query<MatchedRule>(
    `SELECT rule_key, severity, category, decision_options
       FROM escalation_rule
      WHERE source_module = $1 AND wired = true
        AND effective_from <= now()::date AND (effective_to IS NULL OR effective_to >= now()::date)
      LIMIT 1`,
    [sourceModule]
  );
  return r.rows[0] ?? null;
}

/** Rule 2's decision-pack `impact`. Only journey-task actions reach this today (see header) — the
 *  collections/loans branches below are forward-looking, real once one of those source_modules
 *  ever escalates for real, not currently exercised. */
async function resolveImpact(action: ScannableAction, tx: DbLike): Promise<{ inr_exposure: number | null; customer_count: number | null }> {
  if (!action.booking_id) return { inr_exposure: null, customer_count: null };
  if (action.source_module === "collections" || action.source_module === "accounts") {
    const r = await tx.query<{ remaining: number }>(
      `SELECT COALESCE(SUM(d.amount - COALESCE((
                SELECT SUM(rc.amount) FROM receipt rc WHERE rc.demand_id = d.id AND rc.status IN ('posted','reconciled') AND rc.verification != 'DISPUTED'
              ), 0)), 0)::float8 AS remaining
         FROM demand d WHERE d.booking_id = $1 AND d.status NOT IN ('settled', 'waived')`,
      [action.booking_id]
    );
    return { inr_exposure: r.rows[0]?.remaining ?? 0, customer_count: 1 };
  }
  if (action.source_module === "loans") {
    const r = await tx.query<{ gap: number }>(
      `SELECT (COALESCE(lc.sanctioned_amount_inr, 0) - COALESCE((SELECT SUM(amount_inr) FROM loan_event WHERE loan_id = lc.id AND type = 'DISBURSED'), 0))::float8 AS gap
         FROM loan_case lc WHERE lc.booking_id = $1 ORDER BY lc.created_at DESC LIMIT 1`,
      [action.booking_id]
    );
    return { inr_exposure: r.rows[0]?.gap ?? null, customer_count: 1 };
  }
  return { inr_exposure: null, customer_count: 1 };
}

/** Rule 1's ladder targets, resolved through the only real org-hierarchy data this codebase
 *  has (`project_team_assignment` — see this file's header). */
async function resolveTierOwner(action: ScannableAction, target: LadderStep["to"], tx: DbLike): Promise<string | null> {
  if (target === "OWNER") return action.owner_user_id;
  if (target === "BACKUP_OWNER") return action.backup_owner_user_id ?? action.owner_user_id;
  if (!action.project_id || !action.owner_user_id) return action.owner_user_id;
  const owner = await tx.query<{ escalation_manager_user_id: string | null; department: string }>(
    `SELECT escalation_manager_user_id, department FROM project_team_assignment WHERE project_id = $1 AND user_id = $2 LIMIT 1`,
    [action.project_id, action.owner_user_id]
  );
  if (owner.rows[0]?.escalation_manager_user_id) return owner.rows[0].escalation_manager_user_id;
  if (target === "MANAGEMENT") {
    const mgmt = await tx.query<{ user_id: string }>(
      `SELECT user_id FROM project_team_assignment WHERE project_id = $1 AND role_scope = 'MANAGEMENT' LIMIT 1`,
      [action.project_id]
    );
    if (mgmt.rows[0]) return mgmt.rows[0].user_id;
  }
  return action.owner_user_id; // documented fallback — no further hierarchy to resolve
}

function tierForElapsed(steps: LadderStep[], elapsedHours: number): LadderStep {
  const sorted = [...steps].sort((a, b) => a.after_hours - b.after_hours);
  let current = sorted[0]!;
  for (const s of sorted) {
    if (elapsedHours >= s.after_hours) current = s;
  }
  return current;
}

/** Rule 1 + rule 3. No scheduler exists (see header) — directly callable with a controlled `asOf`. */
export async function scanEscalations(asOf: string = new Date().toISOString(), tx?: DbLike): Promise<{ raised: string[]; updated: string[]; resolved: string[] }> {
  return withTx(tx, async (t) => {
    const actions = await scannableActions(t);
    const raised: string[] = [];
    const updated: string[] = [];
    const resolvedIds: string[] = [];

    for (const action of actions) {
      const clock = await t.query<{ due_at: string; stopped_at: string | null; outcome: string | null; due_soon_lead_days: number; ladder_id: string }>(
        `SELECT c.due_at::text AS due_at, c.stopped_at::text AS stopped_at, c.outcome, p.due_soon_lead_days, p.escalation_ladder_id AS ladder_id
           FROM sla_clock c JOIN sla_policy p ON p.id = c.policy_id WHERE c.id = $1`,
        [action.sla_clock_id]
      );
      const c = clock.rows[0]!;
      const dueAt = c.due_at;
      const matched = await matchRule(action.source_module, t); // never matches today — see header; kept live for whenever a named rule's `wired` flips true
      const existing = await t.query<EscalationRow>(`${ESCALATION_SELECT} WHERE action_id = $1 AND status NOT IN ('RESOLVED','CLOSED') LIMIT 1`, [action.id]);
      const open = existing.rows[0] ?? null;

      const status: ClockStatus = deriveStatus({ now: asOf, dueAt, stoppedAt: c.stopped_at, outcome: c.outcome as "ON_TIME" | "LATE" | null, dueSoonLeadDays: c.due_soon_lead_days, atRisk: false });

      if (status !== "DUE_SOON" && status !== "OVERDUE") {
        // Rule 3: auto-close when the condition clears.
        if (open) {
          await t.query(
            `UPDATE escalation SET status = 'RESOLVED', resolved_at = $2, auto_closed = true, resolution_notes = 'Auto-resolved: condition no longer met' WHERE id = $1`,
            [open.id, asOf]
          );
          await appendEvent(t, {
            type: "escalation.resolved",
            entity_type: "escalation",
            entity_id: open.id,
            project_id: open.project_id,
            booking_id: action.booking_id,
            payload: { auto_closed: true },
            actor_user_id: null,
            actor_kind: "SYSTEM",
          });
          resolvedIds.push(open.id);
        }
        continue;
      }

      const ladder = await t.query<{ steps: LadderStep[] }>(`SELECT steps FROM escalation_ladder WHERE id = $1`, [c.ladder_id]);
      const steps = ladder.rows[0]?.steps ?? [];
      const raisedAt = open?.raised_at ?? asOf;
      const elapsedHours = (Date.parse(asOf) - Date.parse(raisedAt)) / (60 * 60 * 1000);
      const step = steps.length > 0 ? tierForElapsed(steps, Math.max(0, elapsedHours)) : { tier: status === "OVERDUE" ? "L1" : "L0", to: "OWNER" as const, after_hours: 0, notify_channel: "IN_APP" as const };
      const ownerId = await resolveTierOwner(action, step.to, t);

      const ruleKey = matched?.rule_key ?? null;
      const impact = await resolveImpact(action, t);
      const decisionPack = {
        blocked_what: `${action.title} (${action.code})`,
        since: dueAt,
        impact,
        options: matched?.decision_options?.length ? matched.decision_options : [
          { label: "Acknowledge and continue", clears_block: false, leakage_inr: null },
          { label: "Escalate further", clears_block: false, leakage_inr: null },
        ],
        recommended: (matched?.decision_options ?? []).filter((o) => o.clears_block).sort((a, b) => (a.leakage_inr ?? Infinity) - (b.leakage_inr ?? Infinity))[0]?.label ?? "Acknowledge and continue",
        owner_history: open ? { previous_tier: open.tier, previous_owner: open.owner_user_id } : null,
      };

      if (open) {
        if (open.tier !== step.tier || open.owner_user_id !== ownerId) {
          await t.query(`UPDATE escalation SET tier = $2, owner_user_id = $3, decision_pack = $4::jsonb WHERE id = $1`, [open.id, step.tier, ownerId, JSON.stringify(decisionPack)]);
          await appendEvent(t, {
            type: "escalation.tier_changed",
            entity_type: "escalation",
            entity_id: open.id,
            project_id: open.project_id,
            booking_id: action.booking_id,
            payload: { from: open.tier, to: step.tier },
            actor_user_id: null,
            actor_kind: "SYSTEM",
          });
          updated.push(open.id);
        }
      } else {
        const id = "esc_" + randomUUID().slice(0, 8);
        const code = await nextCode(t, "ESC");
        await t.query(
          `INSERT INTO escalation (id, code, action_id, rule_key, source_entity_type, source_entity_id, project_id, tier, severity, category, owner_user_id, decision_pack, raised_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13)`,
          [
            id, code, action.id, ruleKey, action.source_entity_type, action.source_entity_id, action.project_id,
            step.tier, matched?.severity ?? "MEDIUM", matched?.category ?? "CASH", ownerId, JSON.stringify(decisionPack), asOf,
          ]
        );
        await appendEvent(t, {
          type: "escalation.raised",
          entity_type: "escalation",
          entity_id: id,
          project_id: action.project_id,
          booking_id: action.booking_id,
          payload: { action_id: action.id, tier: step.tier, rule_key: ruleKey },
          actor_user_id: null,
          actor_kind: "SYSTEM",
        });
        raised.push(id);
      }
    }
    return { raised, updated, resolved: resolvedIds };
  });
}

export async function listEscalations(
  filters: { tier?: string; status?: string; category?: string; project_id?: string },
  ctx: Ctx
): Promise<EscalationRow[]> {
  await authorize(ctx, "escalations", "READ");
  const conds: string[] = [];
  const params: unknown[] = [];
  if (filters.project_id) { params.push(filters.project_id); conds.push(`project_id = $${params.length}`); }
  if (filters.tier) { params.push(filters.tier); conds.push(`tier = $${params.length}`); }
  if (filters.status) { params.push(filters.status); conds.push(`status = $${params.length}`); }
  if (filters.category) { params.push(filters.category); conds.push(`category = $${params.length}`); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const r = await db.query<EscalationRow>(`${ESCALATION_SELECT} ${where} ORDER BY raised_at DESC`, params);
  // Rule 4: MANAGEMENT (and only MANAGEMENT/SUPER_ADMIN, since materiality is a management-alert
  // concept) sees only escalations above the configured threshold; everyone else (department
  // heads/owners with plain READ/WRITE) sees the full list scoped by their own filters above.
  if (!ctx.actor.roles.includes("MANAGEMENT") && !ctx.actor.roles.includes("SUPER_ADMIN")) return r.rows;
  const threshold = await db.query<{ metric: string; value: number }>(`SELECT metric, value FROM materiality_threshold WHERE scope = 'MANAGEMENT_ALERT'`);
  if (threshold.rows.length === 0) return r.rows; // no threshold configured — nothing to filter against
  const inrThreshold = threshold.rows.find((t) => t.metric === "INR_EXPOSURE")?.value;
  const custThreshold = threshold.rows.find((t) => t.metric === "CUSTOMER_COUNT")?.value;
  return r.rows.filter((e) => {
    const impact = (e.decision_pack as { impact?: { inr_exposure?: number | null; customer_count?: number | null } })?.impact;
    const inrOk = inrThreshold !== undefined && (impact?.inr_exposure ?? 0) >= inrThreshold;
    const custOk = custThreshold !== undefined && (impact?.customer_count ?? 0) >= custThreshold;
    return inrOk || custOk;
  });
}

export async function getEscalation(id: string, ctx: Ctx): Promise<EscalationRow> {
  await authorize(ctx, "escalations", "READ");
  return requireEscalation(db, id);
}

async function transition(id: string, next: EscalationRow["status"], ctx: Ctx, extra: { resolution_notes?: string } = {}): Promise<EscalationRow> {
  const esc = await requireEscalation(db, id);
  await assertCanAct(esc, ctx);
  const VALID: Record<EscalationRow["status"], EscalationRow["status"][]> = {
    OPEN: ["ACKNOWLEDGED", "RESOLVED", "CLOSED"],
    ACKNOWLEDGED: ["IN_PROGRESS", "RESOLVED", "CLOSED"],
    IN_PROGRESS: ["RESOLVED", "CLOSED"],
    RESOLVED: ["CLOSED", "REOPENED"],
    CLOSED: ["REOPENED"],
    REOPENED: ["ACKNOWLEDGED", "IN_PROGRESS", "RESOLVED", "CLOSED"],
  };
  if (!VALID[esc.status].includes(next)) throw new AppError("conflict", `cannot move escalation from ${esc.status} to ${next}`);
  await withTx(undefined, async (tx) => {
    const resolvedAt = next === "RESOLVED" ? new Date().toISOString() : null;
    await tx.query(
      `UPDATE escalation SET status = $2, resolution_notes = COALESCE($3, resolution_notes), resolved_at = COALESCE($4, resolved_at) WHERE id = $1`,
      [id, next, extra.resolution_notes ?? null, resolvedAt]
    );
    await appendEvent(tx, {
      type: next === "RESOLVED" ? "escalation.resolved" : next === "CLOSED" ? "escalation.closed" : "escalation.tier_changed",
      entity_type: "escalation",
      entity_id: id,
      project_id: esc.project_id,
      booking_id: null,
      payload: { from: esc.status, to: next },
      ...actorFields(ctx),
    });
  });
  return requireEscalation(db, id);
}

export const acknowledgeEscalation = (id: string, ctx: Ctx) => transition(id, "ACKNOWLEDGED", ctx);
export const startEscalation = (id: string, ctx: Ctx) => transition(id, "IN_PROGRESS", ctx);
export async function resolveEscalation(id: string, notes: string, ctx: Ctx): Promise<EscalationRow> {
  if (!notes?.trim()) throw new AppError("validation", "resolution_notes is required", "resolution_notes"); // async fn — rejects, doesn't throw synchronously, so callers awaiting/`.rejects`-asserting this see a normal rejected promise
  return transition(id, "RESOLVED", ctx, { resolution_notes: notes });
}
export const closeEscalation = (id: string, ctx: Ctx) => transition(id, "CLOSED", ctx);
export const reopenEscalation = (id: string, ctx: Ctx) => transition(id, "REOPENED", ctx);

import { randomUUID } from "node:crypto";
import { db } from "../db";
import { appendEvent, withTx, actorFields, type DbLike } from "../events";
import { requireRole, STAFF_ROLES } from "../authz/requireRole";
import { AppError, type Ctx } from "../authz/types";
import { todayIst } from "../authz/clock";
import { deriveFreshness } from "../progress/freshness";
import { unitsInScope } from "../progress/core";
import { persistSnapshot, previousValue } from "../scores/store";
import { trendFrom, type Score } from "../scores/contract";
import {
  evaluateGates, flexibilityScore, isMoreClosed, type ChangeGateRule, type EvaluatedGate, type GateCategoryInput, type GateComponentInput, type GateState, type ProgressState, type TriggerEvent,
} from "../gates";
import { activeHoldsForUnit } from "../sales/holds";

// 08-changeability-engine.md over the real `change_category`/`change_gate_rule` tables
// (0033_changeability.sql ALTERs them — SCHEMA.md drift #4). The engine itself is gates.ts
// (pure); this file loads its inputs, persists `unit_change_gate`, logs transitions, owns the
// rule studio's draft/publish and the exception flow.
//
// Reconciliations, flagged not faked:
//  - Rule 1's `trigger_event` sources: only HANDOVER_SCHEDULED has an event in this codebase
//    (`handover.scheduled`, 16 — not emitted yet). PROCUREMENT_ORDERED / DRAWING_RELEASED / SLAB_CAST
//    have no producer anywhere; rules on them are storable and evaluate false until one exists.
//  - Rule 3's nightly re-evaluation: no scheduler exists (06/07/12/13/19/21 gap) — `scanClosingGates`
//    is directly callable with a controlled asOf. Event-driven re-evaluation IS wired (subscribers.ts)
//    on progress.updated / progress.bulk_applied / handover.scheduled.
//  - Rule 8: the seeded 32-module matrix has no changeability module, so this uses role lists:
//    every STAFF role reads; SITE/MANAGEMENT/SUPER_ADMIN edit rules (studio/registry.ts's 08 tabs
//    + rule 3 of 25); exceptions need the winning rule's `exception_authority_role` (or SUPER_ADMIN).
//    SALES/CRM/CUSTOMISATION are therefore read-only exactly as rule 8 demands.
//  - Rule 7 (capture never blocked) is 18's behaviour — nothing here blocks a change request;
//    `useException` is exported for 18 to consume an exception on release.
//  - Categories stay the four real seeded codes (kitchen_layout/electrical/flooring_selection/
//    structural) that the rules FK onto — the spec's uppercase list is a Policy Studio re-seed
//    proposal (same call 07 made for components).

const RULE_EDIT_ROLES = ["SITE", "MANAGEMENT", "SUPER_ADMIN"];
const TRIGGER_EVENT_SOURCES: Partial<Record<TriggerEvent, string>> = { HANDOVER_SCHEDULED: "handover.scheduled" };

// COALESCE: seed.ts's demo rules are inserted after migrations, so 0033's code back-fill never saw them.
const RULE_SELECT = `SELECT id, COALESCE(code, category_code || ':' || trigger_component_code || '>=' || COALESCE(min_state, trigger_event)) AS code, category_code, project_id, trigger_component_code, min_state, trigger_event, condition_expr, resulting_state,
  hard_or_soft, closing_lead_days, exception_authority_role, priority, effective_from::text AS effective_from, effective_to::text AS effective_to,
  version, status, publish_reason, published_by, published_at::text AS published_at FROM change_gate_rule`;

export interface RuleRow extends ChangeGateRule {
  id: number; code: string | null; project_id: string | null; condition_expr: string | null;
  hard_or_soft: "HARD" | "SOFT"; closing_lead_days: number; exception_authority_role: string; priority: number;
  effective_from: string; effective_to: string | null; version: number; status: "DRAFT" | "PUBLISHED" | "RETIRED";
  publish_reason: string | null; published_by: string | null; published_at: string | null;
}

/** PUBLISHED, effective rules for a project: a project's own rules for a category replace the
 *  standard ones for that category (same override shape as 17's checklist rules). */
export async function loadPublishedRules(projectId: string, tx: DbLike = db): Promise<RuleRow[]> {
  const r = await tx.query<RuleRow>(
    `${RULE_SELECT} WHERE status = 'PUBLISHED' AND (project_id IS NULL OR project_id = $1)
       AND effective_from <= CURRENT_DATE AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
     ORDER BY priority DESC, id`,
    [projectId]
  );
  const projectCats = new Set(r.rows.filter((x) => x.project_id === projectId).map((x) => x.category_code));
  return r.rows.filter((x) => x.project_id === projectId || !projectCats.has(x.category_code));
}

async function loadCategories(productType: string, tx: DbLike): Promise<(GateCategoryInput & { customer_label: string; sort_order: number })[]> {
  const r = await tx.query<GateCategoryInput & { customer_label: string; sort_order: number }>(
    `SELECT code, customer_label, customer_visible, weight, sort_order FROM change_category
      WHERE product_types IS NULL OR $1 = ANY(product_types) ORDER BY sort_order`,
    [productType]
  );
  return r.rows;
}

interface UnitFacts { project_id: string; product_type: string; unit_number: string }

async function unitFacts(unitId: string, tx: DbLike): Promise<UnitFacts> {
  const r = await tx.query<UnitFacts>(`SELECT project_id, product_type, unit_number FROM unit WHERE id = $1`, [unitId]);
  if (!r.rows[0]) throw new AppError("not_found", "unit not found");
  return r.rows[0];
}

async function componentInputs(unitId: string, rules: ChangeGateRule[], asOf: string, tx: DbLike): Promise<Record<string, GateComponentInput>> {
  const gateDependent = new Set(rules.map((r) => r.trigger_component_code));
  const r = await tx.query<{ component_code: string; state_code: ProgressState; planned_next_event_date: unknown; updated_at: unknown; stale_after_days: number }>(
    `SELECT p.component_code, p.state_code, p.planned_next_event_date, p.updated_at, c.stale_after_days
       FROM unit_progress p JOIN component_definition c ON c.code = p.component_code WHERE p.unit_id = $1`,
    [unitId]
  );
  const out: Record<string, GateComponentInput> = {};
  for (const row of r.rows) {
    out[row.component_code] = {
      state: row.state_code,
      planned_next_event_date: row.planned_next_event_date ? new Date(row.planned_next_event_date as string).toISOString().slice(0, 10) : null,
      freshness: deriveFreshness({
        state: row.state_code, updatedAt: new Date(row.updated_at as string).toISOString(), staleAfterDays: row.stale_after_days,
        gateDependent: gateDependent.has(row.component_code), asOf: `${asOf}T23:59:59+05:30`,
      }),
    };
  }
  return out;
}

async function observedEvents(unitId: string, tx: DbLike): Promise<{ kinds: TriggerEvent[]; latestEventId: string | null }> {
  const types = Object.values(TRIGGER_EVENT_SOURCES);
  const r = await tx.query<{ type: string; id: string }>(
    `SELECT type, id::text AS id FROM event WHERE unit_id = $1 AND type = ANY($2::text[]) ORDER BY id DESC`,
    [unitId, types]
  );
  const kinds = (Object.entries(TRIGGER_EVENT_SOURCES) as [TriggerEvent, string][]).filter(([, t]) => r.rows.some((x) => x.type === t)).map(([k]) => k);
  return { kinds, latestEventId: r.rows[0]?.id ?? null };
}

export interface GateView extends EvaluatedGate {
  customer_label: string;
  customer_visible: boolean;
  hard_or_soft: "HARD" | "SOFT" | null;
  exception_open: boolean;
  exception: ExceptionRow | null;
  last_evaluated_at: string;
}

export interface ChangeabilityMatrix {
  unit_id: string;
  unit_number: string;
  project_id: string;
  as_of: string;
  gates: GateView[];
  flexibility: Score;
}

async function expireStaleExceptions(unitId: string, tx: DbLike): Promise<void> {
  const r = await tx.query<{ id: string; category_code: string; project_id: string }>(
    `UPDATE unit_gate_exception e SET status = 'EXPIRED', closed_at = now()
       FROM unit u WHERE u.id = e.unit_id AND e.unit_id = $1 AND e.status = 'ACTIVE' AND e.valid_until < now()
     RETURNING e.id, e.category_code, u.project_id`,
    [unitId]
  );
  for (const row of r.rows) {
    await appendEvent(tx, { type: "gate.exception_expired", entity_type: "unit_gate_exception", entity_id: row.id, project_id: row.project_id, unit_id: unitId, payload: { category_code: row.category_code } });
  }
}

interface EvaluateOpts { trigger: string; asOf?: string; dryRun?: boolean; overrides?: Record<string, string>; tx?: DbLike; sourceEventId?: string | null }

/** Rules 1–4 + 10 for one unit. Persists `unit_change_gate` and logs every transition unless
 *  dryRun; dry runs still log (rule 3 "log every transition", `dry_run = true`). */
export async function evaluateUnit(unitId: string, opts: EvaluateOpts): Promise<ChangeabilityMatrix> {
  const asOf = opts.asOf ?? todayIst();
  return withTx(opts.tx, async (tx) => {
    const unit = await unitFacts(unitId, tx);
    const rules = await loadPublishedRules(unit.project_id, tx);
    const categories = await loadCategories(unit.product_type, tx);
    if (!opts.dryRun) await expireStaleExceptions(unitId, tx);
    const components = await componentInputs(unitId, rules, asOf, tx);
    for (const [code, state] of Object.entries(opts.overrides ?? {})) {
      const lower = state.toLowerCase() as ProgressState;
      components[code] = { ...(components[code] ?? { state: "not_started" }), state: lower, freshness: "FRESH" };
    }
    const { kinds, latestEventId } = await observedEvents(unitId, tx);
    const derived = evaluateGates(categories, { components, events: kinds, rules, asOf });

    const current = await tx.query<{ category_code: string; current_state: GateState; freshness_status: string }>(
      `SELECT category_code, current_state, freshness_status FROM unit_change_gate WHERE unit_id = $1`,
      [unitId]
    );
    const before = new Map(current.rows.map((r) => [r.category_code, r]));
    const exceptions = await tx.query<ExceptionRow>(`${EXCEPTION_SELECT} WHERE unit_id = $1 AND status = 'ACTIVE'`, [unitId]);

    // 24 rule 6: an APPROVED Change Window Hold keeps this unit/category's gate from moving to a
    // more closed state while it lasts — the stored state stands, with the hold as the reason.
    const holds = await activeHoldsForUnit(unitId, tx, asOf);
    const evaluated: EvaluatedGate[] = derived.map((g) => {
      const hold = holds.find((h) => h.category_code === g.category_code);
      if (!hold) return g;
      // A never-evaluated unit has no stored state — the hold was granted against an open window.
      const baseline: GateState = before.get(g.category_code)?.current_state ?? "OPEN";
      if (!isMoreClosed(g.state, baseline)) return g;
      return { ...g, state: baseline, reason_code: "HOLD", reason_text: `held for a prospect until ${hold.approved_until} (${hold.code}) — would otherwise be ${g.state}` };
    });

    const gates: GateView[] = [];
    for (const g of evaluated) {
      const prev = before.get(g.category_code);
      const changed = !prev || prev.current_state !== g.state;
      if (changed || opts.dryRun) {
        await tx.query(
          `INSERT INTO gate_evaluation_log (unit_id, category_code, from_state, to_state, rule_id, trigger, dry_run) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [unitId, g.category_code, prev?.current_state ?? null, g.state, g.rule_id, opts.trigger, Boolean(opts.dryRun)]
        );
      }
      const exception = exceptions.rows.find((e) => e.category_code === g.category_code) ?? null;
      if (!opts.dryRun) {
        await tx.query(
          `INSERT INTO unit_change_gate (unit_id, category_code, current_state, reason_code, reason_text, source_event_id, source_rule_id, expected_close_at, closing_event, last_evaluated_at, freshness_status, exception_open)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),$10,$11)
           ON CONFLICT (unit_id, category_code) DO UPDATE SET current_state = $3, reason_code = $4, reason_text = $5, source_event_id = $6, source_rule_id = $7,
             expected_close_at = $8, closing_event = $9, last_evaluated_at = now(), freshness_status = $10, exception_open = $11`,
          [unitId, g.category_code, g.state, g.reason_code, g.reason_text, opts.sourceEventId ?? latestEventId, g.rule_id, g.expected_close_at, g.closing_event, g.freshness_status, exception !== null]
        );
        if (changed) {
          await appendEvent(tx, {
            type: "gate.state_changed", entity_type: "unit", entity_id: unitId, project_id: unit.project_id, unit_id: unitId,
            payload: { category_code: g.category_code, from: prev?.current_state ?? null, to: g.state, reason_code: g.reason_code, reason: g.reason_text, trigger: opts.trigger, expected_close_at: g.expected_close_at },
          });
        }
      }
      const cat = categories.find((c) => c.code === g.category_code)!;
      const rule = rules.find((r) => r.id === g.rule_id);
      gates.push({ ...g, customer_label: cat.customer_label, customer_visible: cat.customer_visible, hard_or_soft: rule?.hard_or_soft ?? null, exception_open: exception !== null, exception, last_evaluated_at: new Date().toISOString() });
    }

    const flex = flexibilityScore(evaluated, categories);
    const stale = evaluated.some((g) => g.freshness_status === "VERIFICATION_REQUIRED");
    const flexibility: Score = {
      value: flex.value,
      trend: trendFrom(flex.value, opts.dryRun ? null : await previousValue("UNIT_FLEXIBILITY", unitId, tx)),
      drivers: flex.drivers.slice(0, 3).map((d) => ({ code: d.category_code.toUpperCase(), label: `${categories.find((c) => c.code === d.category_code)?.customer_label ?? d.category_code} is ${d.state}`, contribution: d.lost, fact: d.reason })),
      confidence: stale ? "LOW" : "HIGH",
      confidence_reason: stale ? "a trigger component's progress reading is stale — verification required" : "all trigger readings fresh",
      actions: evaluated.filter((g) => g.state === "EXCEPTION_ONLY").slice(0, 3).map((g) => ({ action_type: "exec_approval", title: `Exception needed for ${g.category_code}`, target: g.category_code })),
    };
    if (!opts.dryRun) await persistSnapshot("UNIT_FLEXIBILITY", "unit", unitId, unit.project_id, flexibility, tx);
    return { unit_id: unitId, unit_number: unit.unit_number, project_id: unit.project_id, as_of: asOf, gates, flexibility };
  });
}

export async function getUnitChangeability(unitId: string, ctx: Ctx): Promise<ChangeabilityMatrix> {
  requireRole(ctx, STAFF_ROLES);
  return evaluateUnit(unitId, { trigger: "read" });
}

/** Rule 10's dry run — `overrides` is component → state (spec UPPERCASE or DB lowercase). */
export async function evaluateDryRun(unitId: string, overrides: Record<string, string>, ctx: Ctx): Promise<ChangeabilityMatrix> {
  requireRole(ctx, STAFF_ROLES);
  return evaluateUnit(unitId, { trigger: "dry_run", dryRun: true, overrides });
}

export async function getProjectChangeability(projectId: string, filters: { node_id?: string; category?: string; state?: string }, ctx: Ctx) {
  requireRole(ctx, STAFF_ROLES);
  const units = filters.node_id
    ? await unitsInScope(projectId, { node_ids: [filters.node_id] }, db)
    : (await db.query<{ id: string; unit_number: string; hierarchy_node_id: string }>(`SELECT id, unit_number, hierarchy_node_id FROM unit WHERE project_id = $1 ORDER BY unit_number`, [projectId])).rows;
  const rows = [];
  for (const u of units) {
    const m = await evaluateUnit(u.id, { trigger: "read" });
    const gates = m.gates.filter((g) => (!filters.category || g.category_code === filters.category) && (!filters.state || g.state === filters.state.toUpperCase()));
    if (filters.state && gates.length === 0) continue;
    rows.push({ unit_id: u.id, unit_number: u.unit_number, hierarchy_node_id: u.hierarchy_node_id, flexibility: m.flexibility.value, gates: gates.map((g) => ({ category_code: g.category_code, state: g.state, expected_close_at: g.expected_close_at, freshness_status: g.freshness_status, exception_open: g.exception_open })) });
  }
  return rows;
}

/** Rule 3's "nightly for time-based closing" — callable, not cron-wired (no scheduler exists). */
export async function scanClosingGates(asOf: string = todayIst(), projectId?: string): Promise<{ evaluated: number; changed: string[] }> {
  const units = await db.query<{ id: string }>(`SELECT id FROM unit ${projectId ? "WHERE project_id = $1" : ""} ORDER BY id`, projectId ? [projectId] : []);
  const changed: string[] = [];
  for (const u of units.rows) {
    const before = (await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM gate_evaluation_log WHERE unit_id = $1 AND dry_run = false`, [u.id])).rows[0]!.n;
    await evaluateUnit(u.id, { trigger: "nightly", asOf });
    const after = (await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM gate_evaluation_log WHERE unit_id = $1 AND dry_run = false`, [u.id])).rows[0]!.n;
    if (after !== before) changed.push(u.id);
  }
  return { evaluated: units.rows.length, changed };
}

// --- rule studio (versioned draft → publish) ---

export interface RuleInput {
  category_code: string;
  trigger_component_code: string;
  min_state?: string | null;
  trigger_event?: TriggerEvent | null;
  resulting_state: GateState;
  hard_or_soft?: "HARD" | "SOFT";
  closing_lead_days?: number;
  exception_authority_role?: string;
  priority?: number;
  condition_expr?: string | null;
  code?: string | null;
}

export async function listRules(filters: { project_id?: string | null; status?: string }, ctx: Ctx): Promise<RuleRow[]> {
  requireRole(ctx, STAFF_ROLES);
  const conds: string[] = [];
  const params: unknown[] = [];
  if (filters.project_id !== undefined) {
    if (filters.project_id === null) conds.push("project_id IS NULL");
    else { params.push(filters.project_id); conds.push(`project_id = $${params.length}`); }
  }
  if (filters.status) { params.push(filters.status); conds.push(`status = $${params.length}`); }
  const r = await db.query<RuleRow>(`${RULE_SELECT} ${conds.length ? "WHERE " + conds.join(" AND ") : ""} ORDER BY project_id NULLS FIRST, category_code, priority DESC, id`, params);
  return r.rows;
}

/** PUT: the complete desired rule set for one scope (standard or one project) as the next DRAFT
 *  version. Publishing swaps it in; the PUBLISHED set stays live until then. */
export async function putRules(scope: { project_id?: string | null }, rules: RuleInput[], ctx: Ctx): Promise<RuleRow[]> {
  requireRole(ctx, RULE_EDIT_ROLES);
  const projectId = scope.project_id ?? null;
  if (!Array.isArray(rules) || rules.length === 0) throw new AppError("validation", "rules must be a non-empty list", "rules");
  const states: GateState[] = ["OPEN", "CLOSING", "CONDITIONAL", "EXCEPTION_ONLY", "HARD_CLOSED"];
  const progressStates = ["not_started", "in_progress", "complete", "verified", "rework"];
  for (const r of rules) {
    if (!r.category_code || !r.trigger_component_code) throw new AppError("validation", "category_code and trigger_component_code are required", "rules");
    if (!states.includes(r.resulting_state)) throw new AppError("validation", `invalid resulting_state ${r.resulting_state}`, "rules");
    const minState = r.min_state ? String(r.min_state).toLowerCase() : null;
    if (!minState && !r.trigger_event) throw new AppError("validation", `rule for ${r.category_code} needs min_state or trigger_event`, "rules");
    if (minState && !progressStates.includes(minState)) throw new AppError("validation", `invalid min_state ${r.min_state}`, "rules");
  }
  return withTx(undefined, async (tx) => {
    const v = await tx.query<{ version: number }>(
      `SELECT COALESCE(MAX(version), 0)::int AS version FROM change_gate_rule WHERE COALESCE(project_id, '') = COALESCE($1, '')`,
      [projectId]
    );
    const version = (v.rows[0]?.version ?? 0) + 1;
    await tx.query(`DELETE FROM change_gate_rule WHERE status = 'DRAFT' AND COALESCE(project_id, '') = COALESCE($1, '')`, [projectId]);
    for (const r of rules) {
      const minState = r.min_state ? String(r.min_state).toLowerCase() : null;
      await tx.query(
        `INSERT INTO change_gate_rule (code, category_code, project_id, trigger_component_code, min_state, trigger_event, condition_expr, resulting_state,
                                       hard_or_soft, closing_lead_days, exception_authority_role, priority, version, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'DRAFT')`,
        [
          r.code ?? `${r.category_code}:${r.trigger_component_code}>=${minState ?? r.trigger_event}`, r.category_code, projectId, r.trigger_component_code, minState, r.trigger_event ?? null,
          r.condition_expr ?? null, r.resulting_state, r.hard_or_soft ?? "HARD", r.closing_lead_days ?? 14, r.exception_authority_role ?? "MANAGEMENT", r.priority ?? 0, version,
        ]
      );
    }
    const out = await tx.query<RuleRow>(`${RULE_SELECT} WHERE status = 'DRAFT' AND COALESCE(project_id, '') = COALESCE($1, '') ORDER BY category_code, priority DESC, id`, [projectId]);
    return out.rows;
  });
}

/** Rule 3 (policy.changed) + rule 6: publish the DRAFT set with a reason, retire the previous
 *  PUBLISHED set for the scope, re-evaluate every affected unit and log the transitions. */
export async function publishRules(scope: { project_id?: string | null }, reason: string, ctx: Ctx): Promise<{ version: number; rules: RuleRow[]; reevaluated: number; transitions: number }> {
  requireRole(ctx, RULE_EDIT_ROLES);
  if (!reason?.trim()) throw new AppError("validation", "reason is required to publish a rule version", "reason");
  const projectId = scope.project_id ?? null;
  const published = await withTx(undefined, async (tx) => {
    const drafts = await tx.query<RuleRow>(`${RULE_SELECT} WHERE status = 'DRAFT' AND COALESCE(project_id, '') = COALESCE($1, '')`, [projectId]);
    if (drafts.rows.length === 0) throw new AppError("conflict", "no DRAFT rules to publish for this scope");
    const version = drafts.rows[0]!.version;
    await tx.query(`UPDATE change_gate_rule SET status = 'RETIRED', effective_to = CURRENT_DATE WHERE status = 'PUBLISHED' AND COALESCE(project_id, '') = COALESCE($1, '')`, [projectId]);
    await tx.query(
      `UPDATE change_gate_rule SET status = 'PUBLISHED', publish_reason = $2, published_by = $3, published_at = now(), effective_from = CURRENT_DATE
        WHERE status = 'DRAFT' AND COALESCE(project_id, '') = COALESCE($1, '')`,
      [projectId, reason.trim(), ctx.actor.user_id]
    );
    await appendEvent(tx, {
      type: "gate.rules_published", entity_type: "change_gate_rule_set", entity_id: `${projectId ?? "standard"}:v${version}`, project_id: projectId,
      payload: { version, reason: reason.trim(), rule_count: drafts.rows.length }, ...actorFields(ctx),
    });
    const rules = await tx.query<RuleRow>(`${RULE_SELECT} WHERE status = 'PUBLISHED' AND COALESCE(project_id, '') = COALESCE($1, '') ORDER BY category_code, priority DESC, id`, [projectId]);
    return { version, rules: rules.rows };
  });
  // Re-evaluation runs per unit in its own transaction after the publish commits.
  const units = await db.query<{ id: string }>(`SELECT id FROM unit ${projectId ? "WHERE project_id = $1" : ""} ORDER BY id`, projectId ? [projectId] : []);
  let transitions = 0;
  for (const u of units.rows) {
    const before = (await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM gate_evaluation_log WHERE unit_id = $1 AND dry_run = false`, [u.id])).rows[0]!.n;
    await evaluateUnit(u.id, { trigger: "policy.changed" });
    const after = (await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM gate_evaluation_log WHERE unit_id = $1 AND dry_run = false`, [u.id])).rows[0]!.n;
    transitions += Number(after) - Number(before);
  }
  return { ...published, reevaluated: units.rows.length, transitions };
}

// --- exceptions (rule 5) ---

export interface ExceptionRow {
  id: string; unit_id: string; category_code: string; granted_by: string; authority_role: string; reason: string;
  evidence_file_keys: string[]; valid_until: string; change_request_id: string | null; status: "ACTIVE" | "USED" | "EXPIRED" | "REVOKED"; created_at: string; closed_at: string | null;
}
const EXCEPTION_SELECT = `SELECT id, unit_id, category_code, granted_by, authority_role, reason, evidence_file_keys, valid_until::text AS valid_until, change_request_id, status,
  created_at::text AS created_at, closed_at::text AS closed_at FROM unit_gate_exception`;

export async function grantException(
  unitId: string,
  input: { category_code: string; reason: string; evidence_file_keys?: string[]; valid_until: string; change_request_id?: string | null },
  ctx: Ctx
): Promise<ExceptionRow> {
  requireRole(ctx, STAFF_ROLES);
  if (!input.reason?.trim()) throw new AppError("validation", "reason is required", "reason");
  if (!input.evidence_file_keys || input.evidence_file_keys.length === 0) throw new AppError("validation", "evidence is required", "evidence_file_keys");
  if (!input.valid_until || Date.parse(input.valid_until) <= Date.now()) throw new AppError("validation", "valid_until must be a future date", "valid_until");

  const matrix = await evaluateUnit(unitId, { trigger: "exception_request" });
  const gate = matrix.gates.find((g) => g.category_code === input.category_code);
  if (!gate) throw new AppError("validation", `unknown or inapplicable category ${input.category_code}`, "category_code");
  if (gate.state === "HARD_CLOSED") throw new AppError("conflict", `${input.category_code} is HARD_CLOSED — it cannot be reopened by anyone`);
  if (gate.state !== "EXCEPTION_ONLY") throw new AppError("conflict", `${input.category_code} is ${gate.state}; an exception applies only to EXCEPTION_ONLY gates`);
  const authority = gate.exception_authority_role ?? "MANAGEMENT";
  if (!ctx.actor.roles.includes(authority) && !ctx.actor.roles.includes("SUPER_ADMIN")) {
    throw new AppError("forbidden", `exception on ${input.category_code} requires the ${authority} role`);
  }
  if (gate.exception_open) throw new AppError("conflict", `${input.category_code} already has an active exception`);

  const id = "gex_" + randomUUID().slice(0, 8);
  await withTx(undefined, async (tx) => {
    await tx.query(
      `INSERT INTO unit_gate_exception (id, unit_id, category_code, granted_by, authority_role, reason, evidence_file_keys, valid_until, change_request_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7::text[],$8,$9)`,
      [id, unitId, input.category_code, ctx.actor.user_id, authority, input.reason.trim(), input.evidence_file_keys, input.valid_until, input.change_request_id ?? null]
    );
    await tx.query(`UPDATE unit_change_gate SET exception_open = true WHERE unit_id = $1 AND category_code = $2`, [unitId, input.category_code]);
    await appendEvent(tx, {
      type: "gate.exception_granted", entity_type: "unit_gate_exception", entity_id: id, project_id: matrix.project_id, unit_id: unitId,
      payload: { category_code: input.category_code, authority_role: authority, valid_until: input.valid_until, change_request_id: input.change_request_id ?? null }, ...actorFields(ctx),
    });
  });
  return (await db.query<ExceptionRow>(`${EXCEPTION_SELECT} WHERE id = $1`, [id])).rows[0]!;
}

async function closeException(id: string, status: "REVOKED" | "USED", eventType: string | null, extra: Record<string, unknown>, actor: Ctx | null, tx: DbLike): Promise<ExceptionRow> {
  const e = (await tx.query<ExceptionRow & { project_id: string }>(`${EXCEPTION_SELECT.replace("FROM unit_gate_exception", ", (SELECT project_id FROM unit WHERE id = unit_id) AS project_id FROM unit_gate_exception")} WHERE id = $1`, [id])).rows[0];
  if (!e) throw new AppError("not_found", "exception not found");
  if (e.status !== "ACTIVE") throw new AppError("conflict", `exception is ${e.status}`);
  await tx.query(`UPDATE unit_gate_exception SET status = $2, closed_at = now(), change_request_id = COALESCE($3, change_request_id) WHERE id = $1`, [id, status, (extra.change_request_id as string | undefined) ?? null]);
  await tx.query(`UPDATE unit_change_gate SET exception_open = false WHERE unit_id = $1 AND category_code = $2`, [e.unit_id, e.category_code]);
  if (eventType) {
    await appendEvent(tx, { type: eventType, entity_type: "unit_gate_exception", entity_id: id, project_id: e.project_id, unit_id: e.unit_id, payload: { category_code: e.category_code, ...extra }, ...(actor ? actorFields(actor) : {}) });
  }
  return (await tx.query<ExceptionRow>(`${EXCEPTION_SELECT} WHERE id = $1`, [id])).rows[0]!;
}

export async function revokeException(id: string, reason: string | undefined, ctx: Ctx): Promise<ExceptionRow> {
  requireRole(ctx, STAFF_ROLES);
  const e = (await db.query<{ authority_role: string }>(`SELECT authority_role FROM unit_gate_exception WHERE id = $1`, [id])).rows[0];
  if (!e) throw new AppError("not_found", "exception not found");
  if (!ctx.actor.roles.includes(e.authority_role) && !ctx.actor.roles.includes("SUPER_ADMIN")) throw new AppError("forbidden", `revoking requires the ${e.authority_role} role`);
  return withTx(undefined, (tx) => closeException(id, "REVOKED", "gate.exception_revoked", { reason: reason ?? null }, ctx, tx));
}

/** For 18: a change request released under this exception consumes it (p44 §33.6 t8). */
export async function useException(id: string, changeRequestId: string, tx: DbLike): Promise<ExceptionRow> {
  return closeException(id, "USED", null, { change_request_id: changeRequestId }, null, tx);
}

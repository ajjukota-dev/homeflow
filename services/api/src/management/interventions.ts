// 27-management-control-tower.md rules 1-3, 7 — Control Tower (replaces tower.ts/tower-view.ts,
// PR #8's base). Candidates are gathered from six real sources rule 1 names; ranked by
// `scoring.ts`'s composite score; exactly five shown (one per category); Act links a real action
// (10) and stamps the real actor (acceptance's own named regression for PR #8's `acted_by = NULL`);
// Dismiss requires a reason and can't reappear for the configured cooldown against the same
// `source_refs` (rule 2).

import { randomUUID } from "node:crypto";
import { db } from "../db";
import { pickFive, type TowerCandidate, type RankingWeights } from "./scoring";
import { projectCollections } from "../collections-view";
import { projectHandover } from "../qa";
import { appendEvent, withTx, actorFields } from "../events";
import { authorize } from "../authz/authorize";
import { createAction } from "../actions/core";
import { AppError, type Ctx } from "../authz/types";

interface InterventionRow {
  id: string; project_id: string; category: string; rank: number; headline: string;
  decision_pack: unknown; impact: { inr: number; customers: number; days: number };
  owner_name: string | null; owner_user_id: string | null; source_refs: string[];
  booking_id: string | null; unit_id: string | null; status: string;
  acted_at: Date | null; acted_by: string | null; action_id: string | null;
  dismiss_reason: string | null; dismissed_at: Date | null;
}

async function rankingWeights(): Promise<RankingWeights> {
  const r = await db.query<{ value: RankingWeights }>(`SELECT value FROM management_config WHERE key = 'intervention_ranking_weights'`);
  return r.rows[0]?.value ?? { inr: 1, customers: 100000, days: 50000 };
}

async function dismissCooldownDays(): Promise<number> {
  const r = await db.query<{ value: number }>(`SELECT (value #>> '{}')::float8 AS value FROM management_config WHERE key = 'dismiss_cooldown_days'`);
  return r.rows[0]?.value ?? 14;
}

const CAT_FROM_ESCALATION: Record<string, TowerCandidate["category"]> = {
  CUSTOMER: "customer", CASH: "cash", HANDOVER: "handover", REPUTATION: "reputation", MARGIN: "margin",
};

async function gatherCandidates(projectId: string): Promise<TowerCandidate[]> {
  const candidates: TowerCandidate[] = [];

  // Rule 1 source 1: material escalations (12), any category, above the CONTROL_TOWER-scoped
  // materiality band — a stricter/looser sibling of listEscalations' own MANAGEMENT_ALERT filter
  // (escalations/core.ts), never wired anywhere until now (same "anticipated, unbuilt" class as
  // 26's customer_* permission modules).
  const threshold = await db.query<{ metric: string; value: number }>(`SELECT metric, value FROM materiality_threshold WHERE scope = 'CONTROL_TOWER'`);
  const inrThreshold = threshold.rows.find((t) => t.metric === "INR_EXPOSURE")?.value;
  const custThreshold = threshold.rows.find((t) => t.metric === "CUSTOMER_COUNT")?.value;
  const escalations = await db.query<{
    id: string; category: string; decision_pack: { impact?: { inr_exposure?: number; customer_count?: number } };
    booking_id: string | null; unit_id: string | null; raised_at: string; owner_user_id: string | null;
  }>(
    `SELECT e.id, e.category, e.decision_pack, a.booking_id, a.unit_id, e.raised_at::text AS raised_at, e.owner_user_id
       FROM escalation e JOIN action a ON a.id = e.action_id WHERE e.project_id = $1 AND e.status NOT IN ('RESOLVED', 'CLOSED')`,
    [projectId]
  );
  for (const e of escalations.rows) {
    const impact = e.decision_pack?.impact ?? {};
    const inrOk = inrThreshold !== undefined && (impact.inr_exposure ?? 0) >= inrThreshold;
    const custOk = custThreshold !== undefined && (impact.customer_count ?? 0) >= custThreshold;
    if (threshold.rows.length > 0 && !inrOk && !custOk) continue; // rule 7: below the configured band, department heads still see it in their own queue
    const days = Math.max(1, Math.round((Date.now() - Date.parse(e.raised_at)) / 86400000));
    candidates.push({
      category: CAT_FROM_ESCALATION[e.category] ?? "customer",
      headline: `Escalation ${e.id} — ${e.category.toLowerCase()} exposure needs a decision`,
      what_happened: `Open ${days} day(s), ₹${(impact.inr_exposure ?? 0).toLocaleString("en-IN")} exposure.`,
      impact: { inr: impact.inr_exposure ?? 0, customers: impact.customer_count ?? 1, days },
      owner: e.owner_user_id ?? "Management",
      recommended_decision: "Review and act on this escalation",
      evidence_links: [`escalation:${e.id}`],
      source_refs: [`escalation:${e.id}`],
      booking_id: e.booking_id ?? undefined,
      unit_id: e.unit_id ?? undefined,
      dependencies: ["escalations"],
    });
  }

  // Rule 1 source 2/5: true-risk cash concentration (19) and disputed dues tying up margin.
  const collections = await projectCollections(projectId);
  const trueRisk = collections.buckets.TRUE_RISK;
  if (trueRisk.amount > 0 && trueRisk.items[0]) {
    const item = trueRisk.items[0];
    candidates.push({
      category: "cash",
      headline: `${item.customer_name}, Villa ${item.unit_number} — true-risk cash sitting unpaid`,
      what_happened: `${item.milestone_label} has been unpaid for ${item.ageing_days} days with recovery below policy.`,
      impact: { inr: trueRisk.amount, customers: 1, days: item.ageing_days },
      owner: "Accounts",
      recommended_decision: "Escalate recovery and keep the RM in the loop",
      evidence_links: [`demand:${item.demand_id}`],
      source_refs: [`demand:${item.demand_id}`],
      booking_id: item.booking_id,
      dependencies: ["collections"],
    });
  }
  const disputed = collections.buckets.DISPUTED;
  if (disputed.amount > 0 && disputed.items[0]) {
    const item = disputed.items[0];
    candidates.push({
      category: "margin",
      headline: `${item.customer_name}, Villa ${item.unit_number} — disputed dues tying up margin`,
      what_happened: `${item.milestone_label} is disputed. Until it is resolved the rupee cannot be recognised.`,
      impact: { inr: disputed.amount, customers: 1, days: item.ageing_days },
      owner: "Accounts",
      recommended_decision: "Resolve the dispute or post an approved waiver",
      evidence_links: [`demand:${item.demand_id}`],
      source_refs: [`demand:${item.demand_id}`],
      booking_id: item.booking_id,
      dependencies: ["accounts", "crm-rm"],
    });
  }

  // Rule 1 source 3: handover cases predicted late with customers waiting (16/06).
  const handovers = await projectHandover(projectId);
  const blocked = handovers.find((h) => h.lifecycle !== "completed" && !h.eligible);
  if (blocked) {
    candidates.push({
      category: "handover",
      headline: `${blocked.customer_name}, Villa ${blocked.unit_number} — keys blocked on hard gates`,
      what_happened: blocked.blockers.map((b) => b.reason).join("; ") || "Handover hard gates are still open.",
      impact: { inr: 0, customers: 1, days: 1 },
      owner: "QA",
      recommended_decision: "Clear the listed blockers before offering an appointment",
      evidence_links: [`booking:${blocked.booking_id}`],
      source_refs: [`booking:${blocked.booking_id}`],
      booking_id: blocked.booking_id,
      unit_id: blocked.unit_id,
      dependencies: ["qa", "legal", "accounts"],
    });
  }

  // Rule 1 source 4: broken-promise clusters (13) — a customer with more than one breached commitment.
  const clusters = await db.query<{ booking_id: string; customer_name: string; unit_number: string; breach_count: string; total_impact: number }>(
    `SELECT c.booking_id, a.display_name AS customer_name, u.unit_number, count(*) AS breach_count,
            COALESCE(SUM(c.financial_impact_inr), 0)::float8 AS total_impact
       FROM commitment c JOIN unit u ON u.id = c.unit_id LEFT JOIN booking_applicant a ON a.booking_id = c.booking_id AND a.role = 'primary'
      WHERE c.project_id = $1 AND c.status = 'BREACHED'
      GROUP BY c.booking_id, a.display_name, u.unit_number HAVING count(*) >= 2
      ORDER BY count(*) DESC LIMIT 1`,
    [projectId]
  );
  if (clusters.rows[0]) {
    const c = clusters.rows[0];
    candidates.push({
      category: "customer",
      headline: `${c.customer_name ?? "Villa " + c.unit_number}, Villa ${c.unit_number} — ${c.breach_count} broken promises`,
      what_happened: `${c.breach_count} commitments have been breached for this customer — trust is at risk, not just the individual dates.`,
      impact: { inr: c.total_impact, customers: 1, days: Number(c.breach_count) },
      owner: "CRM",
      recommended_decision: "RM to call and reset expectations with a consolidated recovery plan",
      evidence_links: [`booking:${c.booking_id}`],
      source_refs: [`booking:${c.booking_id}:broken_promise_cluster`],
      booking_id: c.booking_id,
      dependencies: ["crm-rm", "commitments"],
    });
  }

  // Rule 1 source 6: repeat quality (15) — a critical, still-open snag.
  const snag = await db.query<{ id: string; unit_id: string; description: string; unit_number: string; customer_name: string; booking_id: string; is_repeat: boolean }>(
    `SELECT s.id, s.unit_id, s.description, u.unit_number, a.display_name AS customer_name, b.id AS booking_id, s.is_repeat
       FROM snag s JOIN unit u ON u.id = s.unit_id
       LEFT JOIN booking b ON b.unit_id = u.id AND b.status = 'active'
       LEFT JOIN booking_applicant a ON a.booking_id = b.id AND a.role = 'primary'
      WHERE s.project_id = $1 AND s.severity = 'critical' AND s.status NOT IN ('closed','verified')
      LIMIT 1`,
    [projectId]
  );
  if (snag.rows[0]) {
    const s = snag.rows[0];
    candidates.push({
      category: "reputation",
      headline: `${s.customer_name ?? "Villa " + s.unit_number}, Villa ${s.unit_number} — a critical snag is still open`,
      what_happened: s.description + (s.is_repeat ? " (a repeat defect)" : ""),
      impact: { inr: 0, customers: 1, days: 1 },
      owner: "QA lead",
      recommended_decision: "Rectify and QA-verify before any keys conversation",
      evidence_links: [`snag:${s.id}`],
      source_refs: [`snag:${s.id}`],
      booking_id: s.booking_id,
      unit_id: s.unit_id,
      dependencies: ["qa"],
    });
  }

  return candidates;
}

export async function controlTower(projectId: string, ctx: Ctx) {
  await authorize(ctx, "escalations", "READ");
  const weights = await rankingWeights();
  const cooldownDays = await dismissCooldownDays();

  // Rule 2: a dismissed candidate can't reappear for the cooldown against the same source_refs.
  const recentlyDismissed = await db.query<{ source_refs: string[] }>(
    `SELECT source_refs FROM intervention WHERE project_id = $1 AND status = 'dismissed' AND dismissed_at > now() - ($2 || ' days')::interval`,
    [projectId, cooldownDays]
  );
  const skip = new Set(recentlyDismissed.rows.flatMap((r) => r.source_refs));

  const candidates = await gatherCandidates(projectId);
  const five = pickFive(candidates, weights, skip);
  const out: (ReturnType<typeof pickFive>[number] & { id: string; status: string; acted_at: Date | null; acted_by: string | null })[] = [];
  let changed = false;
  for (const row of five) {
    const id = `tw_${projectId}_${row.category}`;
    const prev = await db.query<{ status: string; headline: string; rank: number }>(`SELECT status, headline, rank FROM intervention WHERE id = $1`, [id]);
    // Status/act/dismiss state only carries forward when this recompute produced the SAME
    // underlying issue (identical source_refs) — otherwise a dismissed/acted slot would silently
    // swallow a genuinely new candidate that just happens to rank #1 in the same category (rule
    // 2's cooldown is against the specific source_refs, not the category slot).
    const r = await db.query<{ status: string; acted_at: Date | null; acted_by: string | null }>(
      `INSERT INTO intervention (id, project_id, category, rank, headline, decision_pack, impact, owner_name, source_refs, booking_id, unit_id, status, computed_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11,'open',now())
       ON CONFLICT (id) DO UPDATE SET
         rank = $4, headline = $5, decision_pack = $6::jsonb, impact = $7::jsonb, owner_name = $8, source_refs = $9, computed_at = now(),
         status = CASE WHEN intervention.source_refs = $9 THEN intervention.status ELSE 'open' END,
         acted_at = CASE WHEN intervention.source_refs = $9 THEN intervention.acted_at ELSE NULL END,
         acted_by = CASE WHEN intervention.source_refs = $9 THEN intervention.acted_by ELSE NULL END,
         action_id = CASE WHEN intervention.source_refs = $9 THEN intervention.action_id ELSE NULL END,
         dismiss_reason = CASE WHEN intervention.source_refs = $9 THEN intervention.dismiss_reason ELSE NULL END,
         dismissed_at = CASE WHEN intervention.source_refs = $9 THEN intervention.dismissed_at ELSE NULL END
       RETURNING status, acted_at, acted_by`,
      [id, projectId, row.category, row.rank, row.headline, JSON.stringify(row.decision_pack), JSON.stringify(row.decision_pack.impact), row.owner, row.source_refs, row.booking_id ?? null, row.unit_id ?? null]
    );
    const after = r.rows[0]!;
    if (!prev.rows[0] || prev.rows[0].headline !== row.headline || prev.rows[0].rank !== row.rank || prev.rows[0].status !== after.status) {
      changed = true;
    }
    out.push({ id, status: after.status, acted_at: after.acted_at, acted_by: after.acted_by, ...row });
  }
  if (changed) {
    await appendEvent(db, { type: "intervention.computed", entity_type: "project", entity_id: projectId, project_id: projectId, payload: { count: out.length } });
  }
  return { interventions: out };
}

async function requireIntervention(id: string): Promise<InterventionRow> {
  const r = await db.query<InterventionRow>(`SELECT * FROM intervention WHERE id = $1`, [id]);
  if (!r.rows[0]) throw new AppError("not_found", "not_found");
  return r.rows[0];
}

/** Act is idempotent: only the first call stamps acted_at/acted_by and links a real action (10). */
export async function actIntervention(id: string, ctx: Ctx) {
  await authorize(ctx, "escalations", "WRITE");
  const current = await requireIntervention(id);
  if (current.status === "acted") return current;
  let updated: InterventionRow | undefined;
  await withTx(undefined, async (t) => {
    // Inlined rather than `createManualAction` (which opens its own `withTx`) — nesting a second
    // transaction inside this one would deadlock on the single-connection PGlite adapter, the
    // same class of bug this session has already hit and fixed several times.
    const actionId = await createAction(
      {
        type: "exec_simple", title: current.headline, source_module: "management", source_entity_type: "intervention", source_entity_id: id,
        project_id: current.project_id, booking_id: current.booking_id ?? undefined, unit_id: current.unit_id ?? undefined, owner_role: "MANAGEMENT",
        origin: "MANUAL", created_by: ctx.actor.user_id,
      },
      t
    );
    const r = await t.query<InterventionRow>(
      `UPDATE intervention SET status = 'acted', acted_at = now(), acted_by = $2, action_id = $3 WHERE id = $1 AND status <> 'acted' RETURNING *`,
      [id, ctx.actor.user_id, actionId]
    );
    updated = r.rows[0];
    if (updated) {
      await appendEvent(t, {
        type: "intervention.acted", entity_type: "intervention", entity_id: id, project_id: updated.project_id,
        booking_id: updated.booking_id, unit_id: updated.unit_id, payload: { category: updated.category, headline: updated.headline, action_id: actionId }, ...actorFields(ctx),
      });
    }
  });
  return updated ?? (await requireIntervention(id));
}

/** Rule 2: Dismiss requires a reason; the cooldown is enforced by `controlTower` reading
 *  `dismissed_at`/`source_refs` back on its next computation, not here. */
export async function dismissIntervention(id: string, reason: string, ctx: Ctx) {
  await authorize(ctx, "escalations", "WRITE");
  if (!reason?.trim()) throw new AppError("validation", "a reason is required to dismiss", "reason");
  const current = await requireIntervention(id);
  if (current.status !== "open") throw new AppError("conflict", `cannot dismiss a ${current.status} intervention`);
  let updated: InterventionRow | undefined;
  await withTx(undefined, async (t) => {
    const r = await t.query<InterventionRow>(
      `UPDATE intervention SET status = 'dismissed', dismissed_at = now(), dismiss_reason = $2 WHERE id = $1 RETURNING *`,
      [id, reason.trim()]
    );
    updated = r.rows[0];
    await appendEvent(t, {
      type: "intervention.dismissed", entity_type: "intervention", entity_id: id, project_id: current.project_id,
      booking_id: current.booking_id, unit_id: current.unit_id, payload: { category: current.category, reason: reason.trim() }, ...actorFields(ctx),
    });
  });
  return updated!;
}

import { db } from "../db";
import { deriveStatus } from "../journey/engine";
import { createClock } from "../ports/clock";
import { rankActions, whyNow, DEFAULT_WEIGHTS, type RankInput, type RankedAction } from "./rank";
import { buildActor } from "../authz/buildActor";
import type { Ctx } from "../authz/types";

// 11-my-day-ranking.md. Depends on 10 (action, real), 06 (deriveStatus, reused), 01. `action.impact`
// (jsonb {revenue_inr, customer_count, dependency_count}) was pre-declared for this spec but no
// `createAction` call site anywhere sets it — same "declared but never populated" pattern already
// found for `action.escalation_tier` (also always its default 'L0', never written; 12's
// `scanEscalations` writes `escalation.tier`, not this column). Both are read here as the real,
// current facts instead: customer_count/revenue_inr are derived live from the action's booking,
// dependency_count from a real `depends_on_action_id` count, escalation tier/state from a live
// join against 12's `escalation`/`sla_clock` tables rather than the two dead columns. Same
// treatment for the actual due date: `action.due_at` is never set by any `createAction` call site
// outside `journey/instances.ts` (12/21's own finding) — `ACTION_QUERY` reads `sla_clock.due_at`
// via `action.sla_clock_id` instead, COALESCEd with `action.due_at` for whichever future call site
// does pass one directly.
//
// No `ranking_weights`/`my_day_snapshot` config table this slice — `DEFAULT_WEIGHTS` (rank.ts) is
// an in-code constant (same "config over code, unwired" class as 12/13/14's own thresholds), and
// every load recomputes live rather than caching (real, but simple — no invalidation logic to get
// wrong; revisit if a real load-time problem shows up, per rule 7's "no N+1" requirement, which a
// single joined query already satisfies without a cache).

interface ActionRow {
  id: string;
  code: string;
  title: string;
  status: string;
  owner_user_id: string | null;
  owner_role: string;
  approver_role: string | null;
  booking_id: string | null;
  project_id: string | null;
  customer_visible: boolean;
  due_at: string | null;
  sla_clock_id: string | null;
  dependency_count: number;
  escalation_tier: string | null;
  escalation_status: string | null;
  revenue_inr: number;
  customer_count: number;
  created_at: string;
}

// `a.due_at` is never set by any createAction call site outside journey/instances.ts (same
// finding 12's header documents) — the real deadline for a journey-task action lives only on
// `sla_clock.due_at`, reached via `a.sla_clock_id`. COALESCE covers both so a future call site
// that DOES pass `due_at` directly still works.
const ACTION_QUERY = `
  SELECT a.id, a.code, a.title, a.status, a.owner_user_id, a.owner_role, a.approver_role,
         a.booking_id, a.project_id, a.customer_visible, COALESCE(a.due_at, c.due_at)::text AS due_at, a.sla_clock_id,
         (SELECT count(*)::int FROM action d WHERE d.depends_on_action_id = a.id) AS dependency_count,
         e.tier AS escalation_tier, e.status AS escalation_status,
         COALESCE(b.total_consideration, 0)::float8 AS revenue_inr,
         COALESCE((SELECT count(*)::int FROM booking_applicant ba WHERE ba.booking_id = a.booking_id), 0) AS customer_count,
         COALESCE((SELECT MIN(occurred_at)::text FROM event WHERE entity_type = 'action' AND entity_id = a.id AND type = 'action.created'), now()::text) AS created_at
    FROM action a
    LEFT JOIN booking b ON b.id = a.booking_id
    LEFT JOIN sla_clock c ON c.id = a.sla_clock_id
    LEFT JOIN escalation e ON e.action_id = a.id AND e.status NOT IN ('RESOLVED', 'CLOSED')
   WHERE a.status NOT IN ('Closed', 'Cancelled')
`;

async function medianDemandForProject(projectId: string | null): Promise<number> {
  if (!projectId) return 0;
  const r = await db.query<{ median: number }>(
    `SELECT COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY amount), 0)::float8 AS median FROM demand WHERE project_id = $1`,
    [projectId]
  );
  return r.rows[0]?.median ?? 0;
}

async function clockStatusFor(slaClockId: string | null, asOf: string): Promise<RankInput["clock_status"]> {
  if (!slaClockId) return null;
  const c = await db.query<{ due_at: string; stopped_at: string | null; outcome: string | null; due_soon_lead_days: number }>(
    `SELECT c.due_at::text AS due_at, c.stopped_at::text AS stopped_at, c.outcome, p.due_soon_lead_days
       FROM sla_clock c JOIN sla_policy p ON p.id = c.policy_id WHERE c.id = $1`,
    [slaClockId]
  );
  if (!c.rows[0]) return null;
  return deriveStatus({ now: asOf, dueAt: c.rows[0].due_at, stoppedAt: c.rows[0].stopped_at, outcome: c.rows[0].outcome as "ON_TIME" | "LATE" | null, dueSoonLeadDays: c.rows[0].due_soon_lead_days, atRisk: false });
}

export interface MyDaySection {
  key: string;
  actions: { id: string; code: string; title: string; status: string; due_at: string | null; score: number; why_now: string }[];
}

export interface MyDayView {
  due_today: MyDaySection["actions"];
  at_risk: MyDaySection["actions"];
  waiting_on_me: MyDaySection["actions"];
  needs_my_approval: MyDaySection["actions"];
  customers_waiting: MyDaySection["actions"];
  done_today: number;
}

async function candidateActions(ctx: Ctx, projectId?: string): Promise<ActionRow[]> {
  const params: unknown[] = [];
  const conds: string[] = [];
  params.push(ctx.actor.user_id);
  conds.push(`(a.owner_user_id = $${params.length} OR (a.owner_user_id IS NULL AND a.owner_role = ANY($${params.length + 1})) OR a.approver_role = ANY($${params.length + 1}))`);
  params.push(ctx.actor.roles);
  if (ctx.actor.project_ids !== "ALL") {
    params.push(ctx.actor.project_ids);
    conds.push(`a.project_id = ANY($${params.length})`);
  }
  if (projectId) {
    params.push(projectId);
    conds.push(`a.project_id = $${params.length}`);
  }
  const r = await db.query<ActionRow>(`${ACTION_QUERY} AND ${conds.join(" AND ")}`, params);
  return r.rows;
}

function toRankInput(row: ActionRow, medians: Map<string, number>): RankInput {
  return {
    id: row.id,
    due_at: row.due_at,
    clock_status: null, // filled by caller — needs an await per row, done in buildRanked below
    customer_count: row.customer_count,
    customer_visible: row.customer_visible,
    revenue_inr: row.revenue_inr,
    project_median_demand_inr: medians.get(row.project_id ?? "") ?? 0,
    dependency_count: row.dependency_count,
    escalation_tier: (row.escalation_tier as RankInput["escalation_tier"]) ?? "L0",
  };
}

async function buildRanked(rows: ActionRow[], asOf: string): Promise<{ row: ActionRow; input: RankInput; ranked: RankedAction }[]> {
  const projectIds = [...new Set(rows.map((r) => r.project_id).filter((p): p is string => !!p))];
  const medians = new Map<string, number>();
  for (const p of projectIds) medians.set(p, await medianDemandForProject(p));

  const out: { row: ActionRow; input: RankInput; ranked: RankedAction }[] = [];
  for (const row of rows) {
    const input = toRankInput(row, medians);
    input.clock_status = await clockStatusFor(row.sla_clock_id, asOf);
    if (!input.clock_status && row.escalation_status) input.clock_status = "AT_RISK"; // an open escalation with no clock still signals risk
    out.push({ row, input, ranked: { id: row.id, score: 0, terms: { deadline: 0, customer_impact: 0, revenue_impact: 0, dependency_impact: 0, escalation_risk: 0 }, due_at: row.due_at } });
  }
  const ranked = rankActions(out.map((o) => o.input), DEFAULT_WEIGHTS, asOf);
  const byId = new Map(ranked.map((r) => [r.id, r]));
  for (const o of out) o.ranked = byId.get(o.row.id)!;
  return out;
}

function toRow(o: { row: ActionRow; input: RankInput; ranked: RankedAction }, asOf: string): MyDayView["due_today"][number] {
  return { id: o.row.id, code: o.row.code, title: o.row.title, status: o.row.status, due_at: o.row.due_at, score: o.ranked.score, why_now: whyNow(o.input, o.ranked, asOf) };
}

/** Rule 1: five ordered sections + done-today count. Rule 6: explicit empty state is the caller's
 *  concern (an empty `actions[]` array, not a special value) — the workspace UI renders the
 *  "Nothing due" copy from that. */
export async function getMyDay(ctx: Ctx, projectId?: string, asOf: string = new Date().toISOString()): Promise<MyDayView> {
  const rows = await candidateActions(ctx, projectId);
  const built = await buildRanked(rows, asOf);
  const today = createClock(() => new Date(asOf)).todayIst();

  const dueToday = built.filter((o) => o.row.due_at && createClock(() => new Date(o.row.due_at!)).todayIst() === today);
  const dueTodayIds = new Set(dueToday.map((o) => o.row.id));
  const atRisk = built.filter((o) => !dueTodayIds.has(o.row.id) && (o.input.clock_status === "AT_RISK" || o.input.clock_status === "OVERDUE"));
  const atRiskIds = new Set(atRisk.map((o) => o.row.id));
  const waitingOnMe = built.filter(
    (o) => !dueTodayIds.has(o.row.id) && !atRiskIds.has(o.row.id) && (o.row.status === "New" || o.row.status === "In Progress") && (o.row.owner_user_id === ctx.actor.user_id || (!o.row.owner_user_id && ctx.actor.roles.includes(o.row.owner_role)))
  );
  const needsApproval = built.filter((o) => o.row.status === "Ready for Approval" && o.row.approver_role && ctx.actor.roles.includes(o.row.approver_role));
  const customersWaiting = built
    .filter((o) => o.row.status === "Waiting Customer" && o.row.owner_user_id === ctx.actor.user_id)
    .sort((a, b) => Date.parse(a.row.created_at) - Date.parse(b.row.created_at));

  const doneToday = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM action WHERE closed_by = $1 AND closed_at::date = $2::date`,
    [ctx.actor.user_id, today]
  );

  return {
    due_today: dueToday.map((o) => toRow(o, asOf)),
    at_risk: atRisk.map((o) => toRow(o, asOf)),
    waiting_on_me: waitingOnMe.map((o) => toRow(o, asOf)),
    needs_my_approval: needsApproval.map((o) => toRow(o, asOf)),
    customers_waiting: customersWaiting.map((o) => toRow(o, asOf)),
    done_today: doneToday.rows[0]?.count ?? 0,
  };
}

/** Rule 5: functional heads (MANAGEMENT/SUPER_ADMIN, or a real CENTRAL-team primary owner) get
 *  the same sections aggregated per team member. Scoped to real `project_team_assignment` rows —
 *  no invented org chart beyond what 12 already resolves through (escalation_manager_user_id). */
export async function getTeamDay(ctx: Ctx, projectId: string, asOf: string = new Date().toISOString()): Promise<Record<string, { counts: Record<string, number>; top3: MyDayView["due_today"] }>> {
  const isHead = ctx.actor.roles.includes("MANAGEMENT") || ctx.actor.roles.includes("SUPER_ADMIN");
  if (!isHead) {
    const own = await db.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM project_team_assignment WHERE project_id = $1 AND user_id = $2 AND is_primary_owner = true AND assignment_type = 'CENTRAL'`,
      [projectId, ctx.actor.user_id]
    );
    if ((own.rows[0]?.count ?? 0) === 0) throw new Error("forbidden: team view requires MANAGEMENT/SUPER_ADMIN or a CENTRAL-team primary-owner assignment");
  }

  const members = await db.query<{ user_id: string }>(`SELECT DISTINCT user_id FROM project_team_assignment WHERE project_id = $1`, [projectId]);
  const out: Record<string, { counts: Record<string, number>; top3: MyDayView["due_today"] }> = {};
  for (const m of members.rows) {
    const memberActor = await buildActor(m.user_id);
    if (!memberActor) continue; // real, current facts only — no invented role set for a deactivated/missing user
    const day = await getMyDay({ actor: memberActor }, projectId, asOf);
    const all = [...day.due_today, ...day.at_risk, ...day.waiting_on_me, ...day.needs_my_approval, ...day.customers_waiting];
    out[m.user_id] = {
      counts: { due_today: day.due_today.length, at_risk: day.at_risk.length, waiting_on_me: day.waiting_on_me.length, needs_my_approval: day.needs_my_approval.length, customers_waiting: day.customers_waiting.length },
      top3: all.sort((a, b) => b.score - a.score).slice(0, 3),
    };
  }
  return out;
}

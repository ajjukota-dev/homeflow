import { randomUUID } from "node:crypto";
import { db } from "../db";
import { appendEvent, withTx, actorFields, type DbLike, type EventInput } from "../events";
import { authorize } from "../authz/authorize";
import { AppError, type Ctx } from "../authz/types";
import { nextCode } from "../model/codes";
import { deriveStatus } from "../journey/engine";
import { createClock } from "../ports/clock";
import { createAction } from "../actions/core";
import { computeConfidence, type ConfidenceResult, type DependencyFact, type DependencyType } from "./confidence";

// 13-promise-ledger.md. `0028_commitments.sql`'s header carries the Data-table reconciliation
// (customer_id nullability, confidence never stored, no assign-owner endpoint). Depends on 10
// (action, real — rule 3's pre-breach action), 06 (deriveStatus, reused not re-derived), 04/19
// (demand, for depends_on's DEMAND type), 01, 25 (approvals matrix — named as the real upgrade
// path below, not hard-wired). Genuinely scoped forward dependencies, flagged not faked:
//  - Rule 2's "who may approve" (MANAGEMENT for financial_impact_inr ≥ threshold or category ∈
//    {COMMERCIAL, TIMELINE}, CRM lead otherwise) is implemented directly in `defaultApproverRole`
//    below rather than via `approvals/matrix.ts`'s `requiredApprovers("COMMITMENT", ...)` — that
//    lookup ships with zero seeded rows (25's own header) and fails CLOSED with no band
//    configured, which would block every single commitment approval until Amarsh populates
//    Policy Studio. `defaultApproverRole` is the real, usable default the spec's own text
//    describes; swapping in `requiredApprovers` is a one-line upgrade once a COMMITMENT/INR band
//    exists — named here, not silently skipped.
//  - Rule 6 (sales-handover-packet commitments auto-created as DRAFT/SALES_HANDOVER) is now wired
//    from 17's `submitHandover` via `createCommitmentFromSource` below — Sales only holds READ on
//    this module (seed/permissions.ts), so the packet's commitments can't go through the normal
//    ctx-gated `createCommitment`; the source variant mirrors actions/core.ts's
//    `createAction(input, tx)` vs `createManualAction(input, ctx)` split (a Source writes directly,
//    attributed to the real triggering user, not a fabricated elevated ctx).
//  - Rule 5's `depends_on` can name ACTION|CHANGE_REQUEST|PROGRESS|DEMAND entries; only ACTION
//    (10) and DEMAND (04/19) are real, queryable tables today. CHANGE_REQUEST (18) and PROGRESS
//    (07) are unbuilt — those dependency entries score neutral in `confidence.ts`, not guessed.
//  - No scheduler exists (same gap already documented for 06/19/21/12) — `scanCommitments` is
//    directly callable with a controlled `asOf`, tested, not cron-wired.
//  - Pre-breach lead is a single window (default 7 days), not the spec's 7d→3d→1d cascade — one
//    `createAction` fires once a commitment first enters the lead window; a repeat-notify-at-3d/1d
//    cascade would need the no-scheduler gap closed first to mean anything (nothing re-runs the
//    scan on its own), so it's flagged rather than built as an inert cascade.
//
// Authorization: `commitments` module in the seeded matrix (§1.3) grants WRITE to CRM only
// (MANAGEMENT is READ) — same "trust the seeded matrix over prose" discipline 21/12 established,
// even though rule 1/2's own text names MANAGEMENT as an approver/waiver. Layered exactly like
// 12's escalation self-guard: the commitment's own current `owner_user_id` may fulfil/flag-at-risk
// it even without matrix WRITE, and a MANAGEMENT actor may approve/waive specifically when rule
// 2's resolved approver role names MANAGEMENT — widening who can act, never narrowing CRM's WRITE.

export type CommitmentCategory = "MODIFICATION" | "COMMERCIAL" | "TIMELINE" | "COMPLIMENTARY_ITEM" | "SPECIFICATION_UPGRADE" | "SERVICE" | "OTHER";
export type CommitmentSource = "SALES_HANDOVER" | "CRM" | "MANAGEMENT" | "COMMUNICATION" | "CHANGE_REQUEST";
export type CommitmentStatus = "DRAFT" | "APPROVED" | "ACTIVE" | "AT_RISK" | "FULFILLED" | "BREACHED" | "WAIVED_CANCELLED";
export type BreachRootCause = "DEPENDENCY" | "RESOURCE" | "VENDOR" | "SCOPE_MISUNDERSTOOD" | "OVERPROMISED" | "CUSTOMER" | "FORCE_MAJEURE";

// UNCONFIRMED — ASK_CLIENT, same class of placeholder as 12's ladder hours/materiality values;
// p16 gives no real number for "how large a promise needs MANAGEMENT sign-off."
const COMMITMENT_MANAGEMENT_THRESHOLD_INR = 200000;
const PRE_BREACH_LEAD_DAYS = 7; // UNCONFIRMED — the spec's own default; the 3d/1d steps need the scheduler gap closed first (see header)

export interface CommitmentRow {
  id: string;
  code: string;
  project_id: string;
  booking_id: string;
  customer_id: string | null;
  unit_id: string;
  category: CommitmentCategory;
  description: string;
  committed_by_user_id: string;
  committed_at: string;
  source: CommitmentSource;
  beneficiary: "CUSTOMER" | "INTERNAL";
  customer_facing: boolean;
  owner_user_id: string | null;
  responsible_department: string | null;
  due_date: string | null;
  financial_impact_inr: number | null;
  approval_required: boolean;
  approved_by: string | null;
  approved_at: string | null;
  status: CommitmentStatus;
  at_risk_reason: string | null;
  fulfilled_at: string | null;
  fulfilled_evidence_file_ids: string[];
  customer_confirmed_at: string | null;
  crm_confirmation_note: string | null;
  breached_at: string | null;
  breach_root_cause: BreachRootCause | null;
  waived_reason: string | null;
  recovery_plan: string | null;
  recovery_due_date: string | null;
  depends_on: { type: DependencyType; id: string }[];
}

export interface CommitmentView extends CommitmentRow {
  confidence: number;
  confidence_drivers: { label: string; delta: number }[];
}

export interface CommitmentTransitionRow {
  id: string;
  from_status: string;
  to_status: string;
  at: string;
  actor_user_id: string | null;
  reason: string | null;
}

export interface CommitmentDetail extends CommitmentView {
  transitions: CommitmentTransitionRow[];
}

const SELECT = `
  SELECT id, code, project_id, booking_id, customer_id, unit_id, category, description,
         committed_by_user_id, committed_at::text AS committed_at, source, beneficiary, customer_facing,
         owner_user_id, responsible_department, due_date::text AS due_date, financial_impact_inr::float8 AS financial_impact_inr,
         approval_required, approved_by, approved_at::text AS approved_at, status, at_risk_reason,
         fulfilled_at::text AS fulfilled_at, fulfilled_evidence_file_ids, customer_confirmed_at::text AS customer_confirmed_at,
         crm_confirmation_note, breached_at::text AS breached_at, breach_root_cause, waived_reason,
         recovery_plan, recovery_due_date::text AS recovery_due_date, depends_on
    FROM commitment
`;

async function requireCommitment(handle: DbLike, id: string): Promise<CommitmentRow> {
  const r = await handle.query<CommitmentRow>(`${SELECT} WHERE id = $1`, [id]);
  if (!r.rows[0]) throw new AppError("not_found", "commitment not found");
  return r.rows[0];
}

/** Rule 2, implemented directly — see header for why this doesn't call `requiredApprovers`. */
function defaultApproverRole(financialImpactInr: number | null, category: CommitmentCategory): "MANAGEMENT" | "CRM" {
  if ((financialImpactInr ?? 0) >= COMMITMENT_MANAGEMENT_THRESHOLD_INR) return "MANAGEMENT";
  if (category === "COMMERCIAL" || category === "TIMELINE") return "MANAGEMENT";
  return "CRM";
}

/** Rule 7's WRITE gate + the per-instance owner self-guard documented in the header. */
async function assertCanAct(row: CommitmentRow, ctx: Ctx): Promise<void> {
  const level = await authorize(ctx, "commitments", "READ");
  if (level === "WRITE" || level === "ADMIN") return;
  if (ctx.actor.user_id === row.owner_user_id) return;
  throw new AppError("forbidden", "commitments requires WRITE, or being this commitment's owner");
}

async function assertCanApprove(row: CommitmentRow, approverRole: "MANAGEMENT" | "CRM", ctx: Ctx): Promise<void> {
  if (ctx.actor.user_id === row.committed_by_user_id) {
    throw new AppError("forbidden", "cannot approve your own commitment");
  }
  const level = await authorize(ctx, "commitments", "READ");
  if (level === "WRITE" || level === "ADMIN") return;
  if (ctx.actor.roles.includes(approverRole)) return;
  throw new AppError("forbidden", `commitments requires WRITE, or the ${approverRole} role`);
}

async function assertCanWaive(ctx: Ctx): Promise<void> {
  const level = await authorize(ctx, "commitments", "READ");
  if (level === "WRITE" || level === "ADMIN") return;
  if (ctx.actor.roles.includes("MANAGEMENT")) return;
  throw new AppError("forbidden", "waiving a commitment requires WRITE, or the MANAGEMENT role");
}

async function recordTransition(tx: DbLike, commitmentId: string, from: string, to: string, ctx: Ctx, reason?: string | null): Promise<void> {
  await tx.query(
    `INSERT INTO commitment_transition (id, commitment_id, from_status, to_status, actor_user_id, reason)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    ["cmtx_" + randomUUID().slice(0, 8), commitmentId, from, to, ctx.actor.user_id ?? null, reason ?? null]
  );
  await appendEvent(tx, {
    type: "commitment.status_changed",
    entity_type: "commitment",
    entity_id: commitmentId,
    payload: { from, to },
    ...actorFields(ctx),
  });
}

export interface CreateCommitmentInput {
  booking_id: string;
  category: CommitmentCategory;
  description: string;
  source: CommitmentSource;
  beneficiary: "CUSTOMER" | "INTERNAL";
  customer_facing: boolean;
  owner_user_id?: string | null;
  responsible_department?: string | null;
  due_date?: string | null;
  financial_impact_inr?: number | null;
  approval_required: boolean;
  depends_on?: { type: DependencyType; id: string }[];
}

async function insertCommitmentRow(
  input: CreateCommitmentInput,
  committedByUserId: string,
  actor: Pick<EventInput, "actor_user_id" | "actor_kind">,
  tx: DbLike
): Promise<CommitmentRow> {
  const b = await tx.query<{ project_id: string; unit_id: string; customer_id: string | null }>(
    `SELECT b.project_id, b.unit_id, a.customer_id
       FROM booking b LEFT JOIN booking_applicant a ON a.booking_id = b.id AND a.role = 'primary'
      WHERE b.id = $1`,
    [input.booking_id]
  );
  if (!b.rows[0]) throw new AppError("not_found", "booking not found");
  const { project_id, unit_id, customer_id } = b.rows[0];

  const id = "cmt_" + randomUUID().slice(0, 8);
  const code = await nextCode(tx, "CMT");
  // Rule 1: approval-gated commitments start DRAFT; everything else is auto-approved — there's
  // no real "DRAFT → APPROVED" transition to log for the auto case, since it never visited DRAFT.
  const status: CommitmentStatus = input.approval_required ? "DRAFT" : "APPROVED";
  await tx.query(
    `INSERT INTO commitment (
       id, code, project_id, booking_id, customer_id, unit_id, category, description,
       committed_by_user_id, source, beneficiary, customer_facing, owner_user_id,
       responsible_department, due_date, financial_impact_inr, approval_required, status, depends_on
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb)`,
    [
      id, code, project_id, input.booking_id, customer_id, unit_id, input.category, input.description,
      committedByUserId, input.source, input.beneficiary, input.customer_facing, input.owner_user_id ?? null,
      input.responsible_department ?? null, input.due_date ?? null, input.financial_impact_inr ?? null,
      input.approval_required, status, JSON.stringify(input.depends_on ?? []),
    ]
  );
  await appendEvent(tx, {
    type: "commitment.created",
    entity_type: "commitment",
    entity_id: id,
    project_id,
    booking_id: input.booking_id,
    customer_id,
    payload: { code, category: input.category, status },
    ...actor,
  });
  return requireCommitment(tx, id);
}

export async function createCommitment(input: CreateCommitmentInput, ctx: Ctx): Promise<CommitmentRow> {
  await authorize(ctx, "commitments", "WRITE");
  return withTx(undefined, (tx) => insertCommitmentRow(input, ctx.actor.user_id, actorFields(ctx), tx));
}

/** Rule 6: 17's sales-handover packet creates these — Sales only holds READ on this module (seed/
 *  permissions.ts), so it can't go through the ctx-gated `createCommitment` above. A Source writes
 *  directly inside the caller's own transaction, still attributed to the real triggering user (see
 *  header). Caller (17) is responsible for always passing `approval_required: true` here per rule 6
 *  ("CRM must approve/activate before acceptance completes") — this function doesn't second-guess it. */
export async function createCommitmentFromSource(input: CreateCommitmentInput, ctx: Ctx, tx: DbLike): Promise<CommitmentRow> {
  return insertCommitmentRow(input, ctx.actor.user_id, actorFields(ctx), tx);
}

export async function approveCommitment(id: string, ctx: Ctx): Promise<CommitmentRow> {
  const row = await requireCommitment(db, id);
  if (row.status !== "DRAFT" || !row.approval_required) {
    throw new AppError("conflict", "commitment is not awaiting approval");
  }
  const approverRole = defaultApproverRole(row.financial_impact_inr, row.category);
  await assertCanApprove(row, approverRole, ctx);
  return withTx(undefined, async (tx) => {
    await tx.query(`UPDATE commitment SET status = 'APPROVED', approved_by = $2, approved_at = now() WHERE id = $1`, [id, ctx.actor.user_id]);
    await recordTransition(tx, id, "DRAFT", "APPROVED", ctx);
    return requireCommitment(tx, id);
  });
}

export async function activateCommitment(id: string, ctx: Ctx): Promise<CommitmentRow> {
  const row = await requireCommitment(db, id);
  if (row.status !== "APPROVED") throw new AppError("conflict", "commitment must be APPROVED before it can be activated");
  if (!row.owner_user_id) throw new AppError("validation", "owner_user_id is required before activation", "owner_user_id");
  if (!row.due_date) throw new AppError("validation", "due_date is required before activation", "due_date");
  await authorize(ctx, "commitments", "WRITE");
  return withTx(undefined, async (tx) => {
    await tx.query(`UPDATE commitment SET status = 'ACTIVE' WHERE id = $1`, [id]);
    await recordTransition(tx, id, "APPROVED", "ACTIVE", ctx);
    return requireCommitment(tx, id);
  });
}

export interface FulfilInput {
  evidence_file_ids: string[];
  customer_confirmed_at?: string | null;
  crm_confirmation_note?: string | null;
}

export async function fulfilCommitment(id: string, input: FulfilInput, ctx: Ctx): Promise<CommitmentRow> {
  const row = await requireCommitment(db, id);
  if (row.status !== "ACTIVE" && row.status !== "AT_RISK") throw new AppError("conflict", `cannot fulfil a commitment from ${row.status}`);
  if (!input.evidence_file_ids?.length) throw new AppError("validation", "evidence is required to fulfil a commitment", "evidence_file_ids");
  if (row.customer_facing && !input.customer_confirmed_at && !input.crm_confirmation_note?.trim()) {
    throw new AppError("validation", "customer-facing commitments need customer_confirmed_at or a CRM confirmation note");
  }
  await assertCanAct(row, ctx);
  return withTx(undefined, async (tx) => {
    await tx.query(
      `UPDATE commitment SET status = 'FULFILLED', fulfilled_at = now(), fulfilled_evidence_file_ids = $2::jsonb,
              customer_confirmed_at = $3, crm_confirmation_note = $4 WHERE id = $1`,
      [id, JSON.stringify(input.evidence_file_ids), input.customer_confirmed_at ?? null, input.crm_confirmation_note ?? null]
    );
    await appendEvent(tx, { type: "commitment.fulfilled", entity_type: "commitment", entity_id: id, project_id: row.project_id, booking_id: row.booking_id, payload: {}, ...actorFields(ctx) });
    await recordTransition(tx, id, row.status, "FULFILLED", ctx);
    return requireCommitment(tx, id);
  });
}

export async function waiveCommitment(id: string, reason: string, ctx: Ctx): Promise<CommitmentRow> {
  if (!reason?.trim()) throw new AppError("validation", "waived_reason is required", "waived_reason");
  const row = await requireCommitment(db, id);
  if (row.status === "FULFILLED" || row.status === "WAIVED_CANCELLED") {
    throw new AppError("conflict", `cannot waive a commitment from ${row.status}`);
  }
  await assertCanWaive(ctx);
  return withTx(undefined, async (tx) => {
    await tx.query(`UPDATE commitment SET status = 'WAIVED_CANCELLED', waived_reason = $2 WHERE id = $1`, [id, reason]);
    await appendEvent(tx, { type: "commitment.waived", entity_type: "commitment", entity_id: id, project_id: row.project_id, booking_id: row.booking_id, payload: { reason }, ...actorFields(ctx) });
    await recordTransition(tx, id, row.status, "WAIVED_CANCELLED", ctx, reason);
    return requireCommitment(tx, id);
  });
}

export async function setAtRisk(id: string, reason: string, ctx: Ctx): Promise<CommitmentRow> {
  const row = await requireCommitment(db, id);
  if (row.status !== "ACTIVE") throw new AppError("conflict", "only an ACTIVE commitment can be flagged at risk");
  await assertCanAct(row, ctx);
  return withTx(undefined, async (tx) => {
    await tx.query(`UPDATE commitment SET status = 'AT_RISK', at_risk_reason = $2 WHERE id = $1`, [id, reason ?? null]);
    await appendEvent(tx, { type: "commitment.at_risk", entity_type: "commitment", entity_id: id, project_id: row.project_id, booking_id: row.booking_id, payload: { reason }, ...actorFields(ctx) });
    await recordTransition(tx, id, "ACTIVE", "AT_RISK", ctx, reason);
    return requireCommitment(tx, id);
  });
}

export async function recordRecoveryPlan(id: string, plan: string, dueDate: string, ctx: Ctx): Promise<CommitmentRow> {
  const row = await requireCommitment(db, id);
  if (row.status !== "AT_RISK") throw new AppError("conflict", "recovery plan can only be recorded while AT_RISK");
  if (!plan?.trim() || !dueDate) throw new AppError("validation", "recovery_plan and recovery_due_date are both required");
  await assertCanAct(row, ctx);
  // No dedicated event here — this records a plan, it doesn't change status (spec §3 leaves the
  // commitment AT_RISK until it's actually fulfilled or breaches); commitment.status_changed would
  // misreport a from==to transition, so it's deliberately not emitted for this one write.
  await db.query(`UPDATE commitment SET recovery_plan = $2, recovery_due_date = $3 WHERE id = $1`, [id, plan, dueDate]);
  return requireCommitment(db, id);
}

export async function recordRootCause(id: string, cause: BreachRootCause, ctx: Ctx): Promise<CommitmentRow> {
  const row = await requireCommitment(db, id);
  if (row.status !== "BREACHED") throw new AppError("conflict", "root cause can only be recorded on a BREACHED commitment");
  await assertCanAct(row, ctx);
  await db.query(`UPDATE commitment SET breach_root_cause = $2 WHERE id = $1`, [id, cause]);
  return requireCommitment(db, id);
}

// --- Rule 5: confidence, computed at read time, never stored (see 0028's header) ---

async function resolveDependencyFacts(dependsOn: { type: DependencyType; id: string }[], tx: DbLike): Promise<DependencyFact[]> {
  const facts: DependencyFact[] = [];
  for (const dep of dependsOn) {
    if (dep.type === "ACTION") {
      const a = await tx.query<{ status: string; sla_clock_id: string | null }>(`SELECT status, sla_clock_id FROM action WHERE id = $1`, [dep.id]);
      const row = a.rows[0];
      if (!row) { facts.push({ type: dep.type }); continue; }
      const satisfied = row.status === "Closed";
      const blocked = row.status === "Blocked";
      let overdue = false;
      if (!satisfied && row.sla_clock_id) {
        const c = await tx.query<{ due_at: string; stopped_at: string | null; outcome: string | null; due_soon_lead_days: number }>(
          `SELECT c.due_at::text AS due_at, c.stopped_at::text AS stopped_at, c.outcome, p.due_soon_lead_days
             FROM sla_clock c JOIN sla_policy p ON p.id = c.policy_id WHERE c.id = $1`,
          [row.sla_clock_id]
        );
        if (c.rows[0]) {
          const status = deriveStatus({ now: new Date().toISOString(), dueAt: c.rows[0].due_at, stoppedAt: c.rows[0].stopped_at, outcome: c.rows[0].outcome as "ON_TIME" | "LATE" | null, dueSoonLeadDays: c.rows[0].due_soon_lead_days, atRisk: false });
          overdue = status === "OVERDUE";
        }
      }
      facts.push({ type: dep.type, resolved: { blocked, overdue, satisfied } });
    } else if (dep.type === "DEMAND") {
      const d = await tx.query<{ status: string; due_date: string | null }>(`SELECT status, due_date::text AS due_date FROM demand WHERE id = $1`, [dep.id]);
      const row = d.rows[0];
      if (!row) { facts.push({ type: dep.type }); continue; }
      const satisfied = row.status === "settled" || row.status === "waived";
      const overdue = !satisfied && !!row.due_date && row.due_date < new Date().toISOString().slice(0, 10);
      facts.push({ type: dep.type, resolved: { blocked: false, overdue, satisfied } });
    } else {
      facts.push({ type: dep.type }); // CHANGE_REQUEST/PROGRESS — no real table to resolve against yet
    }
  }
  return facts;
}

async function confidenceFor(row: CommitmentRow, tx: DbLike): Promise<ConfidenceResult> {
  const deps = await resolveDependencyFacts(row.depends_on, tx);
  const ownerLoad = row.owner_user_id
    ? await tx.query<{ count: number }>(`SELECT count(*)::int AS count FROM commitment WHERE owner_user_id = $1 AND status IN ('ACTIVE','AT_RISK')`, [row.owner_user_id])
    : { rows: [{ count: 0 }] };
  const deptStats = row.responsible_department
    ? await tx.query<{ fulfilled: number; breached: number }>(
        `SELECT count(*) FILTER (WHERE status = 'FULFILLED')::int AS fulfilled, count(*) FILTER (WHERE status = 'BREACHED')::int AS breached
           FROM commitment WHERE responsible_department = $1`,
        [row.responsible_department]
      )
    : { rows: [{ fulfilled: 0, breached: 0 }] };
  return computeConfidence({
    dependencies: deps,
    ownerOpenCount: ownerLoad.rows[0]?.count ?? 0,
    departmentFulfilledCount: deptStats.rows[0]?.fulfilled ?? 0,
    departmentBreachedCount: deptStats.rows[0]?.breached ?? 0,
  });
}

async function attachConfidence(rows: CommitmentRow[], tx: DbLike): Promise<CommitmentView[]> {
  const out: CommitmentView[] = [];
  for (const row of rows) {
    const c = await confidenceFor(row, tx);
    out.push({ ...row, confidence: c.score, confidence_drivers: c.drivers });
  }
  return out;
}

export async function listCommitments(
  filters: { status?: string; owner_user_id?: string; responsible_department?: string; due_before?: string; project_id?: string },
  ctx: Ctx
): Promise<CommitmentView[]> {
  await authorize(ctx, "commitments", "READ");
  const conds: string[] = [];
  const params: unknown[] = [];
  if (filters.project_id) { params.push(filters.project_id); conds.push(`project_id = $${params.length}`); }
  if (filters.status) { params.push(filters.status); conds.push(`status = $${params.length}`); }
  if (filters.owner_user_id) { params.push(filters.owner_user_id); conds.push(`owner_user_id = $${params.length}`); }
  if (filters.responsible_department) { params.push(filters.responsible_department); conds.push(`responsible_department = $${params.length}`); }
  if (filters.due_before) { params.push(filters.due_before); conds.push(`due_date <= $${params.length}`); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const r = await db.query<CommitmentRow>(`${SELECT} ${where} ORDER BY committed_at DESC`, params);
  return attachConfidence(r.rows, db);
}

/** Widened over `CommitmentView` with `commitment_transition` history — a detail-only read (like
 *  `actions/core.ts`'s `getAction`/`ActionDetail`), not folded into `attachConfidence` since
 *  `listCommitments`/`commitmentsForBooking` would otherwise pay an extra query per row for
 *  history no list view needs. */
export async function getCommitment(id: string, ctx: Ctx): Promise<CommitmentDetail> {
  await authorize(ctx, "commitments", "READ");
  const row = await requireCommitment(db, id);
  const [view] = await attachConfidence([row], db);
  const t = await db.query<CommitmentTransitionRow>(
    `SELECT id, from_status, to_status, at::text AS at, actor_user_id, reason FROM commitment_transition WHERE commitment_id = $1 ORDER BY at`,
    [id]
  );
  return { ...view!, transitions: t.rows };
}

export async function commitmentsForBooking(bookingId: string, ctx: Ctx): Promise<CommitmentView[]> {
  await authorize(ctx, "commitments", "READ");
  const r = await db.query<CommitmentRow>(`${SELECT} WHERE booking_id = $1 ORDER BY committed_at DESC`, [bookingId]);
  return attachConfidence(r.rows, db);
}

/** Rule 8's handover-gate input: any commitment on the booking still open by the spec's own
 *  definition. Consumed by `qa.ts`'s `handoverForBooking` (necessary wiring outside this spec's
 *  own Files list, same class of exception 12/21 already used for server.ts/db/index.ts). */
export async function openCommitmentsForBooking(bookingId: string, tx: DbLike = db): Promise<{ code: string; description: string }[]> {
  const r = await tx.query<{ code: string; description: string }>(
    `SELECT code, description FROM commitment WHERE booking_id = $1 AND status IN ('DRAFT','APPROVED','ACTIVE','AT_RISK','BREACHED')`,
    [bookingId]
  );
  return r.rows;
}

// --- Rule 3 + 4: pre-breach alert and automatic breach. No scheduler exists (see header) —
// directly callable with a controlled `asOf`, tested, not cron-wired. ---

export async function scanCommitments(asOf: string = new Date().toISOString(), tx?: DbLike): Promise<{ atRisk: string[]; breached: string[] }> {
  return withTx(tx, async (t) => {
    const today = createClock(() => new Date(asOf)).todayIst();
    const rows = await t.query<CommitmentRow>(`${SELECT} WHERE status IN ('ACTIVE','AT_RISK')`);
    const atRisk: string[] = [];
    const breached: string[] = [];

    for (const row of rows.rows) {
      if (!row.due_date) continue;
      if (row.due_date < today) {
        await t.query(`UPDATE commitment SET status = 'BREACHED', breached_at = $2 WHERE id = $1`, [row.id, asOf]);
        await appendEvent(t, { type: "commitment.breached", entity_type: "commitment", entity_id: row.id, project_id: row.project_id, booking_id: row.booking_id, payload: {}, actor_user_id: null, actor_kind: "SYSTEM" });
        await appendEvent(t, { type: "commitment.status_changed", entity_type: "commitment", entity_id: row.id, project_id: row.project_id, booking_id: row.booking_id, payload: { from: row.status, to: "BREACHED" }, actor_user_id: null, actor_kind: "SYSTEM" });
        await t.query(`INSERT INTO commitment_transition (id, commitment_id, from_status, to_status, reason) VALUES ($1,$2,$3,$4,$5)`, ["cmtx_" + randomUUID().slice(0, 8), row.id, row.status, "BREACHED", "due date passed"]);
        breached.push(row.id);
        continue;
      }
      if (row.status !== "ACTIVE") continue;
      const deps = await resolveDependencyFacts(row.depends_on, t);
      const dependencyIssue = deps.some((d) => d.resolved && !d.resolved.satisfied && (d.resolved.blocked || d.resolved.overdue));
      const daysToDue = (Date.parse(row.due_date) - Date.parse(today)) / (24 * 60 * 60 * 1000);
      if (dependencyIssue || daysToDue <= PRE_BREACH_LEAD_DAYS) {
        const reason = dependencyIssue ? "A dependency is blocked or overdue" : `Due within ${PRE_BREACH_LEAD_DAYS} days`;
        await t.query(`UPDATE commitment SET status = 'AT_RISK', at_risk_reason = $2 WHERE id = $1`, [row.id, reason]);
        await appendEvent(t, { type: "commitment.at_risk", entity_type: "commitment", entity_id: row.id, project_id: row.project_id, booking_id: row.booking_id, payload: { reason }, actor_user_id: null, actor_kind: "SYSTEM" });
        await appendEvent(t, { type: "commitment.status_changed", entity_type: "commitment", entity_id: row.id, project_id: row.project_id, booking_id: row.booking_id, payload: { from: "ACTIVE", to: "AT_RISK" }, actor_user_id: null, actor_kind: "SYSTEM" });
        await t.query(`INSERT INTO commitment_transition (id, commitment_id, from_status, to_status, reason) VALUES ($1,$2,$3,$4,$5)`, ["cmtx_" + randomUUID().slice(0, 8), row.id, "ACTIVE", "AT_RISK", reason]);
        if (row.owner_user_id) {
          // Rule 3's pre-breach action (10, real) — no sla_clock attached, so it does NOT itself
          // feed 12's escalation ladder (same "createAction with no due date" gap 21 already
          // logged for its own Banking stand-in actions).
          await createAction(
            {
              type: "exec_simple",
              title: `Commitment at risk: ${row.description}`,
              source_module: "commitments",
              source_entity_type: "commitment",
              source_entity_id: row.id,
              project_id: row.project_id,
              booking_id: row.booking_id,
              owner_role: "CRM",
              owner_user_id: row.owner_user_id,
              origin: "AUTO",
            },
            t
          );
        }
        atRisk.push(row.id);
      }
    }
    return { atRisk, breached };
  });
}

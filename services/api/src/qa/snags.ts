import { randomUUID } from "node:crypto";
import { db } from "../db";
import { appendEvent, withTx, actorFields, type DbLike } from "../events";
import { authorize } from "../authz/authorize";
import { requireRole } from "../authz/requireRole";
import { AppError, type Ctx } from "../authz/types";
import { nextCode } from "../model/codes";
import { createAction } from "../actions/core";
import { startClock, stopClock } from "../journey/sla";
import type { CalendarRow } from "../journey/calendar";
import type { SnagSeverity } from "./templates";

// 15-qa-evidence-snags.md rules 5–8 on the real `snag` table (0032_qa.sql header has the
// ALTER-not-create decision). DB keeps the lowercase status/severity vocabulary the pre-15
// readers filter on (qa-snags.ts, tower-view.ts); the spec's Appendix A names are accepted and
// returned at this boundary via toDb*/toSpec*. Legacy qa.ts::closeSnag (note-based close) stays
// registered for the existing console — flagged in TODO.md, not removed.
//
// Reconciliations, flagged not faked:
//  - Rule 5's "Management" reopen: the seeded matrix gives MANAGEMENT only READ on `snagging`
//    (SITE+QA and FM write). Built to the matrix: QA, FM (handover), SUPER_ADMIN reopen; a CUSTOMER
//    session may reopen a snag it raised. MANAGEMENT cannot — flagged.
//  - Rule 6: the SLA clock starts at OPEN via 06's startClock; the breach path is 12's
//    scanEscalations, which only scans sla_clock-backed ACTIONS — so every snag also owns one
//    `exec_simple` action carrying the clock (source_module 'snagging'). seed/escalation-rules.ts's
//    `critical_snag_2d` stays wired:false (12's matchRule has no severity filter — flipping it
//    would stamp MAJOR/MINOR breaches HIGH too); breaches escalate through the generic ladder.
//  - Customer-raised snags via the portal (26) aren't built — `raised_by_kind: 'CUSTOMER'` is
//    accepted from staff entering a walkthrough finding; customer_verified_at is set by
//    customerVerifySnag (FM/QA/SUPER_ADMIN, or the CUSTOMER session itself).

export type SnagStatus = "OPEN" | "ASSIGNED" | "IN_PROGRESS" | "READY_FOR_VERIFICATION" | "VERIFIED" | "CLOSED" | "REOPENED";
const SPEC_STATUSES: SnagStatus[] = ["OPEN", "ASSIGNED", "IN_PROGRESS", "READY_FOR_VERIFICATION", "VERIFIED", "CLOSED", "REOPENED"];
const SEVERITIES: SnagSeverity[] = ["CRITICAL", "MAJOR", "MINOR"];
export const ROOMS = ["LIVING", "KITCHEN", "MASTER_BEDROOM", "BEDROOM_2", "BEDROOM_3", "BATHROOM_1", "BATHROOM_2", "UTILITY", "BALCONY", "COMMON", "EXTERIOR", "PLOT", "OTHER"];
export const CATEGORIES = ["CIVIL", "ELECTRICAL", "PLUMBING", "PAINTING", "FLOORING", "FITTINGS", "CLEANING", "OTHER"];
const ROOT_CAUSES = ["WORKMANSHIP", "MATERIAL", "DESIGN", "DAMAGE_AFTER_COMPLETION", "VENDOR_DELAY", "OTHER"];
const RAISED_BY = ["QA", "SITE", "CUSTOMER", "HANDOVER", "FM"];
const REPEAT_WINDOW_DAYS = 90;
const VERIFIER_ROLES = ["QA", "FM", "SUPER_ADMIN"]; // FM = the handover department in the seeded role list

export function toDbSnagStatus(value: string): string {
  const upper = String(value ?? "").toUpperCase();
  if (!SPEC_STATUSES.includes(upper as SnagStatus)) throw new AppError("validation", `invalid snag status ${value}`, "status");
  return upper.toLowerCase();
}
export const toSpecSnagStatus = (value: string): SnagStatus => value.toUpperCase() as SnagStatus;
export function toDbSeverity(value: string): string {
  const upper = String(value ?? "").toUpperCase();
  if (!SEVERITIES.includes(upper as SnagSeverity)) throw new AppError("validation", `invalid severity ${value}`, "severity");
  return upper.toLowerCase();
}

export interface SnagView {
  id: string; code: string | null; unit_id: string; project_id: string; booking_id: string | null;
  room: string | null; category: string | null; trade: string | null; location: string | null;
  severity: SnagSeverity; description: string; status: SnagStatus;
  raised_by_kind: string | null; raised_by_user_id: string | null;
  contractor_id: string | null; assigned_to_user_id: string | null; ready_by_user_id: string | null;
  root_cause: string | null; is_repeat: boolean;
  estimated_cost_inr: number | null; actual_cost_inr: number | null;
  sla_clock_id: string | null; before_file_keys: string[]; after_file_keys: string[];
  customer_verified_at: string | null; closed_at: string | null; reopen_count: number; reopen_reason: string | null;
  action_id: string | null; inspection_id: string | null; created_at: string; updated_at: string;
}

const SELECT = `SELECT id, code, unit_id, project_id, booking_id, room, category, trade, location, severity, description, status,
  raised_by_kind, raised_by_user_id, contractor_id, assigned_to_user_id, ready_by_user_id, root_cause, is_repeat,
  estimated_cost_inr::float8 AS estimated_cost_inr, actual_cost_inr::float8 AS actual_cost_inr, sla_clock_id,
  before_file_keys, after_file_keys, customer_verified_at::text AS customer_verified_at, closed_at::text AS closed_at,
  reopen_count, reopen_reason, action_id, inspection_id, created_at::text AS created_at, updated_at::text AS updated_at FROM snag`;

type Raw = Omit<SnagView, "severity" | "status"> & { severity: string; status: string };
const view = (r: Raw): SnagView => ({ ...r, severity: r.severity.toUpperCase() as SnagSeverity, status: toSpecSnagStatus(r.status) });

async function loadSnag(id: string, tx: DbLike = db): Promise<SnagView> {
  const r = await tx.query<Raw>(`${SELECT} WHERE id = $1`, [id]);
  if (!r.rows[0]) throw new AppError("not_found", "snag not found");
  return view(r.rows[0]);
}

export async function getSnag(id: string, ctx: Ctx): Promise<SnagView> {
  await authorize(ctx, "snagging", "READ");
  return loadSnag(id);
}

export interface SnagFilters { project_id?: string; unit_id?: string; status?: string; severity?: string; contractor_id?: string }

export async function listSnags(filters: SnagFilters, ctx: Ctx): Promise<SnagView[]> {
  await authorize(ctx, "snagging", "READ");
  const conds: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => { params.push(v); conds.push(`${sql} $${params.length}`); };
  if (filters.project_id) add("project_id =", filters.project_id);
  if (filters.unit_id) add("unit_id =", filters.unit_id);
  if (filters.status) add("status =", toDbSnagStatus(filters.status));
  if (filters.severity) add("severity =", toDbSeverity(filters.severity));
  if (filters.contractor_id) add("contractor_id =", filters.contractor_id);
  const r = await db.query<Raw>(`${SELECT} ${conds.length ? "WHERE " + conds.join(" AND ") : ""} ORDER BY created_at DESC`, params);
  return r.rows.map(view);
}

async function isRepeat(unitId: string, room: string, category: string, excludeId: string | null, tx: DbLike): Promise<boolean> {
  const r = await tx.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM snag
      WHERE unit_id = $1 AND room = $2 AND category = $3 AND ($4::text IS NULL OR id <> $4)
        AND created_at >= now() - ($5 || ' days')::interval`,
    [unitId, room, category, excludeId, String(REPEAT_WINDOW_DAYS)]
  );
  return (r.rows[0]?.n ?? 0) > 0;
}

async function calendar(tx: DbLike): Promise<CalendarRow> {
  // Same single-seeded-calendar precedent as journey/instances.ts and collections-sweep.ts.
  const r = await tx.query<CalendarRow>(`SELECT working_days, holidays FROM project_calendar ORDER BY id LIMIT 1`);
  return r.rows[0] ?? { working_days: [1, 2, 3, 4, 5], holidays: [] };
}

export interface CreateSnagInput {
  unit_id: string;
  room: string;
  category: string;
  severity: string;
  description: string;
  trade?: string | null;
  location?: string | null;
  raised_by_kind?: string | null;
  contractor_id?: string | null;
  before_file_keys?: string[];
  estimated_cost_inr?: number | null;
  inspection_id?: string | null;
}

/** Rule 5 OPEN + rule 6 clock start. Internal variant (no ctx gate) so a failed QA inspection can
 *  raise snags inside its own transaction; `createSnag` is the ctx-gated public entry. */
export async function insertSnag(input: CreateSnagInput, actor: { user_id: string | null; kind: "USER" | "SYSTEM" | "CUSTOMER" }, tx: DbLike): Promise<SnagView> {
  const room = String(input.room ?? "").toUpperCase();
  const category = String(input.category ?? "").toUpperCase();
  if (!ROOMS.includes(room)) throw new AppError("validation", `invalid room ${input.room}`, "room");
  if (!CATEGORIES.includes(category)) throw new AppError("validation", `invalid category ${input.category}`, "category");
  const severity = toDbSeverity(input.severity);
  if (!input.description?.trim()) throw new AppError("validation", "description is required", "description");
  const raisedBy = input.raised_by_kind ? String(input.raised_by_kind).toUpperCase() : null;
  if (raisedBy && !RAISED_BY.includes(raisedBy)) throw new AppError("validation", `invalid raised_by_kind ${input.raised_by_kind}`, "raised_by_kind");

  const unit = await tx.query<{ project_id: string; unit_number: string; booking_id: string | null }>(
    `SELECT u.project_id, u.unit_number, (SELECT b.id FROM booking b WHERE b.unit_id = u.id AND b.status = 'active' LIMIT 1) AS booking_id
       FROM unit u WHERE u.id = $1`,
    [input.unit_id]
  );
  if (!unit.rows[0]) throw new AppError("not_found", "unit not found");
  const u = unit.rows[0];

  const id = "sng_" + randomUUID().slice(0, 8);
  const code = await nextCode(tx, "SNG");
  const repeat = await isRepeat(input.unit_id, room, category, null, tx);

  const pol = await tx.query<{ id: string; duration_value: number; duration_unit: "WORKING_DAYS" | "CALENDAR_DAYS" | "HOURS" }>(
    `SELECT p.id, p.duration_value, p.duration_unit FROM snag_sla_policy s JOIN sla_policy p ON p.id = s.sla_policy_id WHERE s.severity = $1`,
    [severity]
  );
  const clockId = pol.rows[0] ? await startClock({ subject_type: "snag", subject_id: id, policy: pol.rows[0], calendar: await calendar(tx) }, tx) : null;

  const actionId = await createAction(
    {
      type: "exec_simple", title: `Fix snag ${code} (${severity.toUpperCase()}): ${input.description.trim()}`, project_id: u.project_id,
      source_module: "snagging", source_entity_type: "snag", source_entity_id: id, unit_id: input.unit_id, booking_id: u.booking_id,
      owner_role: "SITE", priority: severity === "critical" ? "CRITICAL" : severity === "major" ? "HIGH" : "MEDIUM",
      sla_clock_id: clockId, origin: actor.kind === "USER" ? "MANUAL" : "AUTO", created_by: actor.user_id,
    },
    tx
  );

  await tx.query(
    `INSERT INTO snag (id, code, unit_id, project_id, booking_id, room, category, trade, location, severity, description, status,
                       raised_by_kind, raised_by_user_id, contractor_id, is_repeat, estimated_cost_inr, sla_clock_id, before_file_keys, action_id, inspection_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'open',$12,$13,$14,$15,$16,$17,$18::text[],$19,$20)`,
    [
      id, code, input.unit_id, u.project_id, u.booking_id, room, category, input.trade ?? category.toLowerCase(), input.location ?? room,
      severity, input.description.trim(), raisedBy, actor.user_id, input.contractor_id ?? null, repeat, input.estimated_cost_inr ?? null,
      clockId, input.before_file_keys ?? [], actionId, input.inspection_id ?? null,
    ]
  );
  await appendEvent(tx, {
    type: "snag.opened", entity_type: "snag", entity_id: id, project_id: u.project_id, unit_id: input.unit_id, booking_id: u.booking_id,
    payload: { code, severity: severity.toUpperCase(), room, category, is_repeat: repeat, raised_by_kind: raisedBy },
    actor_user_id: actor.user_id, actor_kind: actor.kind,
  });
  return loadSnag(id, tx);
}

export async function createSnag(input: CreateSnagInput, ctx: Ctx): Promise<SnagView> {
  await authorize(ctx, "snagging", "WRITE");
  const roleKind = ctx.actor.roles.includes("QA") ? "QA" : ctx.actor.roles.includes("SITE") ? "SITE" : ctx.actor.roles.includes("FM") ? "FM" : null;
  return withTx(undefined, (tx) => insertSnag({ ...input, raised_by_kind: input.raised_by_kind ?? roleKind }, { user_id: ctx.actor.user_id, kind: "USER" }, tx));
}

function assertFrom(snag: SnagView, allowed: SnagStatus[], to: SnagStatus): void {
  if (!allowed.includes(snag.status)) throw new AppError("conflict", `cannot move snag ${snag.code ?? snag.id} from ${snag.status} to ${to}`);
}

async function transition(
  snag: SnagView,
  to: SnagStatus,
  set: string,
  params: unknown[],
  event: string | null,
  payload: Record<string, unknown>,
  ctx: Ctx
): Promise<SnagView> {
  await withTx(undefined, async (tx) => {
    await tx.query(`UPDATE snag SET status = $2, updated_at = now()${set ? ", " + set : ""} WHERE id = $1`, [snag.id, to.toLowerCase(), ...params]);
    if (event) {
      await appendEvent(tx, {
        type: event, entity_type: "snag", entity_id: snag.id, project_id: snag.project_id, unit_id: snag.unit_id, booking_id: snag.booking_id,
        payload: { code: snag.code, from: snag.status, to, ...payload }, ...actorFields(ctx),
      });
    }
  });
  return loadSnag(snag.id);
}

export async function assignSnag(id: string, input: { contractor_id?: string | null; assigned_to_user_id?: string | null }, ctx: Ctx): Promise<SnagView> {
  await authorize(ctx, "snagging", "WRITE");
  if (!input.contractor_id && !input.assigned_to_user_id) throw new AppError("validation", "contractor_id or assigned_to_user_id is required");
  if (input.contractor_id) {
    const c = await db.query<{ id: string }>(`SELECT id FROM contractor WHERE id = $1 AND active`, [input.contractor_id]);
    if (!c.rows[0]) throw new AppError("validation", "unknown or inactive contractor", "contractor_id");
  }
  const snag = await loadSnag(id);
  assertFrom(snag, ["OPEN", "REOPENED", "ASSIGNED"], "ASSIGNED");
  if (input.assigned_to_user_id && snag.action_id) {
    // The fix action follows the assignee so 12's escalation ladder has a real L0 owner.
    await db.query(`UPDATE action SET owner_user_id = $2 WHERE id = $1`, [snag.action_id, input.assigned_to_user_id]);
  }
  return transition(snag, "ASSIGNED", `contractor_id = COALESCE($3, contractor_id), assigned_to_user_id = COALESCE($4, assigned_to_user_id)`,
    [input.contractor_id ?? null, input.assigned_to_user_id ?? null], "snag.assigned",
    { contractor_id: input.contractor_id ?? snag.contractor_id, assigned_to_user_id: input.assigned_to_user_id ?? snag.assigned_to_user_id }, ctx);
}

export async function startSnag(id: string, ctx: Ctx): Promise<SnagView> {
  await authorize(ctx, "snagging", "WRITE");
  const snag = await loadSnag(id);
  assertFrom(snag, ["ASSIGNED"], "IN_PROGRESS");
  return transition(snag, "IN_PROGRESS", "", [], null, {}, ctx);
}

/** Rule 5: READY needs ≥ 1 after-photo [E]. The actor becomes the "fixer" the verifier must differ from. */
export async function readySnag(id: string, input: { after_file_keys?: string[] }, ctx: Ctx): Promise<SnagView> {
  await authorize(ctx, "snagging", "WRITE");
  const snag = await loadSnag(id);
  assertFrom(snag, ["IN_PROGRESS"], "READY_FOR_VERIFICATION");
  const after = [...snag.after_file_keys, ...(input.after_file_keys ?? [])];
  if (after.length === 0) throw new AppError("validation", "at least one after-photo is required before verification", "after_file_keys");
  return transition(snag, "READY_FOR_VERIFICATION", `after_file_keys = $3::text[], ready_by_user_id = $4`, [after, ctx.actor.user_id],
    "snag.ready_for_verification", { after_photos: after.length }, ctx);
}

export async function verifySnag(id: string, ctx: Ctx): Promise<SnagView> {
  await authorize(ctx, "snagging", "WRITE");
  requireRole(ctx, VERIFIER_ROLES);
  const snag = await loadSnag(id);
  assertFrom(snag, ["READY_FOR_VERIFICATION"], "VERIFIED");
  if (ctx.actor.user_id === snag.ready_by_user_id || ctx.actor.user_id === snag.assigned_to_user_id) {
    throw new AppError("forbidden", "the fixer cannot verify their own snag");
  }
  return transition(snag, "VERIFIED", "", [], "snag.verified", {}, ctx);
}

export async function customerVerifySnag(id: string, ctx: Ctx): Promise<SnagView> {
  const snag = await loadSnag(id);
  if (ctx.actor.kind !== "CUSTOMER") { await authorize(ctx, "snagging", "WRITE"); requireRole(ctx, VERIFIER_ROLES); }
  assertFrom(snag, ["VERIFIED", "READY_FOR_VERIFICATION"], snag.status);
  await db.query(`UPDATE snag SET customer_verified_at = now(), updated_at = now() WHERE id = $1`, [id]);
  return loadSnag(id);
}

export async function closeSnagLifecycle(id: string, ctx: Ctx): Promise<SnagView> {
  await authorize(ctx, "snagging", "WRITE");
  const snag = await loadSnag(id);
  assertFrom(snag, ["VERIFIED"], "CLOSED");
  if (snag.raised_by_kind === "CUSTOMER" && !snag.customer_verified_at) {
    throw new AppError("conflict", "customer-raised snag needs customer verification before CLOSED");
  }
  await withTx(undefined, async (tx) => {
    await tx.query(`UPDATE snag SET status = 'closed', closed_at = now(), updated_at = now() WHERE id = $1`, [id]);
    if (snag.sla_clock_id) {
      const c = await tx.query<{ stopped_at: string | null }>(`SELECT stopped_at FROM sla_clock WHERE id = $1`, [snag.sla_clock_id]);
      if (c.rows[0] && !c.rows[0].stopped_at) await stopClock(snag.sla_clock_id, tx);
    }
    if (snag.action_id) await tx.query(`UPDATE action SET status = 'Closed', closed_at = now() WHERE id = $1 AND status <> 'Closed'`, [snag.action_id]);
    await appendEvent(tx, {
      type: "snag.closed", entity_type: "snag", entity_id: id, project_id: snag.project_id, unit_id: snag.unit_id, booking_id: snag.booking_id,
      payload: { code: snag.code, severity: snag.severity, reopen_count: snag.reopen_count }, ...actorFields(ctx),
    });
  });
  return loadSnag(id);
}

export async function reopenSnag(id: string, reason: string, ctx: Ctx): Promise<SnagView> {
  const snag = await loadSnag(id);
  if (ctx.actor.kind === "CUSTOMER") {
    if (snag.raised_by_kind !== "CUSTOMER") throw new AppError("forbidden", "customers may reopen only snags they raised");
  } else {
    await authorize(ctx, "snagging", "WRITE");
    requireRole(ctx, VERIFIER_ROLES);
  }
  if (!reason?.trim()) throw new AppError("validation", "reason is required", "reason");
  assertFrom(snag, ["VERIFIED", "CLOSED"], "REOPENED");
  const repeat = await isRepeat(snag.unit_id, snag.room ?? "OTHER", snag.category ?? "OTHER", snag.id, db);
  await withTx(undefined, async (tx) => {
    await tx.query(
      `UPDATE snag SET status = 'reopened', reopen_count = reopen_count + 1, reopen_reason = $2, is_repeat = $3,
              closed_at = NULL, ready_by_user_id = NULL, after_file_keys = '{}', updated_at = now()
        WHERE id = $1`,
      [id, reason.trim(), repeat || snag.is_repeat]
    );
    if (snag.action_id) await tx.query(`UPDATE action SET status = 'New', closed_at = NULL WHERE id = $1`, [snag.action_id]);
    await appendEvent(tx, {
      type: "snag.reopened", entity_type: "snag", entity_id: id, project_id: snag.project_id, unit_id: snag.unit_id, booking_id: snag.booking_id,
      payload: { code: snag.code, from: snag.status, reason: reason.trim(), reopen_count: snag.reopen_count + 1 }, ...actorFields(ctx),
    });
  });
  return loadSnag(id);
}

export async function patchSnag(
  id: string,
  input: { root_cause?: string | null; estimated_cost_inr?: number | null; actual_cost_inr?: number | null; contractor_id?: string | null },
  ctx: Ctx
): Promise<SnagView> {
  await authorize(ctx, "snagging", "WRITE");
  await loadSnag(id);
  const rootCause = input.root_cause ? String(input.root_cause).toUpperCase() : null;
  if (rootCause && !ROOT_CAUSES.includes(rootCause)) throw new AppError("validation", `invalid root_cause ${input.root_cause}`, "root_cause");
  await db.query(
    `UPDATE snag SET root_cause = COALESCE($2, root_cause), estimated_cost_inr = COALESCE($3, estimated_cost_inr),
            actual_cost_inr = COALESCE($4, actual_cost_inr), contractor_id = COALESCE($5, contractor_id), updated_at = now()
      WHERE id = $1`,
    [id, rootCause, input.estimated_cost_inr ?? null, input.actual_cost_inr ?? null, input.contractor_id ?? null]
  );
  return loadSnag(id);
}

/** Rule 8. Groupings for 27's quality KPIs; mean time to close from closed_at - created_at. */
export async function snagAnalytics(projectId: string, ctx: Ctx) {
  await authorize(ctx, "snagging", "READ");
  const [byContractor, byCategory, byRootCause, totals, mttc] = await Promise.all([
    db.query<{ contractor_id: string | null; contractor_name: string | null; total: number; open: number }>(
      `SELECT s.contractor_id, c.name AS contractor_name, COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE s.status NOT IN ('closed','verified'))::int AS open
         FROM snag s LEFT JOIN contractor c ON c.id = s.contractor_id WHERE s.project_id = $1
        GROUP BY s.contractor_id, c.name ORDER BY total DESC`, [projectId]),
    db.query<{ category: string | null; total: number }>(
      `SELECT category, COUNT(*)::int AS total FROM snag WHERE project_id = $1 GROUP BY category ORDER BY total DESC`, [projectId]),
    db.query<{ root_cause: string | null; total: number }>(
      `SELECT root_cause, COUNT(*)::int AS total FROM snag WHERE project_id = $1 GROUP BY root_cause ORDER BY total DESC`, [projectId]),
    db.query<{ total: number; repeat: number; closed: number; estimated: number; actual: number }>(
      `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE is_repeat)::int AS repeat, COUNT(*) FILTER (WHERE status = 'closed')::int AS closed,
              COALESCE(SUM(estimated_cost_inr), 0)::float8 AS estimated, COALESCE(SUM(actual_cost_inr), 0)::float8 AS actual
         FROM snag WHERE project_id = $1`, [projectId]),
    db.query<{ severity: string; mean_days: number | null }>(
      `SELECT severity, AVG(EXTRACT(EPOCH FROM (closed_at - created_at)) / 86400)::float8 AS mean_days
         FROM snag WHERE project_id = $1 AND closed_at IS NOT NULL GROUP BY severity`, [projectId]),
  ]);
  const t = totals.rows[0]!;
  return {
    project_id: projectId,
    total: t.total,
    closed: t.closed,
    closure_pct: t.total ? Math.round((t.closed / t.total) * 100) : 0,
    repeat_rate_pct: t.total ? Math.round((t.repeat / t.total) * 100) : 0,
    cost_inr: { estimated: t.estimated, actual: t.actual },
    by_contractor: byContractor.rows,
    by_category: byCategory.rows,
    by_root_cause: byRootCause.rows,
    mean_days_to_close_by_severity: mttc.rows.map((r) => ({ severity: r.severity.toUpperCase(), mean_days: r.mean_days === null ? null : Math.round(r.mean_days * 10) / 10 })),
  };
}

// --- contractor master (Config: "contractor master") ---
export async function listContractors(ctx: Ctx) {
  await authorize(ctx, "snagging", "READ");
  return (await db.query<{ id: string; name: string; trade: string | null; contact: string | null; active: boolean }>(`SELECT * FROM contractor ORDER BY name`)).rows;
}

export async function createContractor(input: { name: string; trade?: string | null; contact?: string | null }, ctx: Ctx) {
  await authorize(ctx, "snagging", "WRITE");
  if (!input.name?.trim()) throw new AppError("validation", "name is required", "name");
  const id = "ctr_" + randomUUID().slice(0, 8);
  await db.query(`INSERT INTO contractor (id, name, trade, contact) VALUES ($1,$2,$3,$4)`, [id, input.name.trim(), input.trade ?? null, input.contact ?? null]);
  return (await db.query<{ id: string; name: string; trade: string | null; contact: string | null; active: boolean }>(`SELECT * FROM contractor WHERE id = $1`, [id])).rows[0]!;
}

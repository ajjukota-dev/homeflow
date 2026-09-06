import { randomUUID } from "node:crypto";
import { db } from "../db";
import { appendEvent, withTx, actorFields, type DbLike } from "../events";
import { authorize } from "../authz/authorize";
import { AppError, type Ctx } from "../authz/types";
import { nextCode } from "../model/codes";
import { startClock } from "../journey/sla";
import type { CalendarRow } from "../journey/calendar";
import { addServiceRecord } from "./core";
import { resolveDlpPolicy } from "./dlp";

// 30-post-handover.md rules 2, 3 — the richer warranty case lifecycle
// (triage/assign/quote/accept-quote/start/resolve/verify/close/reject), additive on the
// pre-existing `warranty_case` table (0000_init.sql) alongside `warranty.ts`'s own simple
// open/closed flow, which stays registered for whatever already calls it unchanged.
//
// Flagged, not faked: rule 3's "execution and before/after evidence via a linked snag (15)" is
// NOT wired — `insertSnag` requires a `room` (LIVING/KITCHEN/...) and a fixed `category` vocab
// (CIVIL/ELECTRICAL/...) that a warranty case carries neither of (no room field; its own category
// vocab is DLP-window categories like STRUCTURAL/WATERPROOFING, not 15's). Inventing a mapping
// with no client-supplied crosswalk would be exactly the kind of guessed business rule CLAUDE.md
// forbids — same class of gap 15/18 already flagged for their own mismatched vocabularies.
// Evidence is instead stored directly on the case (`before_file_keys`/`after_file_keys`).

export type WarrantyStatus = "open" | "triaged" | "assigned" | "in_progress" | "resolved" | "closed" | "rejected";
const SEVERITIES = ["CRITICAL", "MAJOR", "MINOR"];

export interface WarrantyCaseRow {
  id: string; unit_id: string; booking_id: string; project_id: string; passport_item_id: string | null;
  category: string; trade: string; severity: string; description: string; status: WarrantyStatus;
  raised_by_kind: string | null; in_coverage: boolean | null; coverage_basis: string | null;
  contractor_id: string | null; quote_inr: string | null; quote_accepted_at: string | null; waived_reason: string | null;
  cost_inr: string | null; sla_clock_id: string | null; customer_verified_at: string | null;
  before_file_keys: string[]; after_file_keys: string[]; rejected_reason: string | null; root_cause_code: string | null;
}
const SELECT = `SELECT id, unit_id, booking_id, project_id, passport_item_id, category, trade, severity, description, status,
  raised_by_kind, in_coverage, coverage_basis, contractor_id, quote_inr::text AS quote_inr,
  quote_accepted_at::text AS quote_accepted_at, waived_reason, cost_inr::text AS cost_inr, sla_clock_id,
  customer_verified_at::text AS customer_verified_at, before_file_keys, after_file_keys, rejected_reason, root_cause_code
  FROM warranty_case`;

async function loadCase(id: string, handle: DbLike = db): Promise<WarrantyCaseRow> {
  const r = await handle.query<WarrantyCaseRow>(`${SELECT} WHERE id = $1`, [id]);
  if (!r.rows[0]) throw new AppError("not_found", "not_found");
  return r.rows[0];
}

function assertFrom(c: WarrantyCaseRow, allowed: WarrantyStatus[], to: WarrantyStatus): void {
  if (!allowed.includes(c.status)) throw new AppError("conflict", `cannot move warranty case from ${c.status} to ${to}`);
}

/** Rule 2 coverage derivation: category window (from `dlp_policy`) not yet expired, or the
 *  linked passport item's own warranty is still active. */
export async function computeCoverage(
  category: string, handoverCompletedAt: string, passportItemId: string | null, projectId: string, productType: string, tx: DbLike, asOf: Date = new Date()
): Promise<{ in_coverage: boolean; coverage_basis: string }> {
  const policy = await resolveDlpPolicy(projectId, productType, tx);
  const entry = policy?.windows.find((w) => w.category.toUpperCase() === category.toUpperCase());
  if (entry) {
    const end = new Date(handoverCompletedAt);
    end.setUTCMonth(end.getUTCMonth() + entry.months);
    if (asOf <= end) return { in_coverage: true, coverage_basis: `DLP:${entry.category}:${entry.months}mo` };
  }
  if (passportItemId) {
    const item = (await tx.query<{ warranty_until: string | null }>(`SELECT warranty_until::text AS warranty_until FROM home_passport_item WHERE id = $1`, [passportItemId])).rows[0];
    if (item?.warranty_until && asOf <= new Date(item.warranty_until)) return { in_coverage: true, coverage_basis: "PASSPORT_WARRANTY" };
  }
  return { in_coverage: false, coverage_basis: "EXPIRED" };
}

export interface CreateWarrantyCaseInput {
  unit_id: string; booking_id: string; category: string; trade: string; severity: string; description: string;
  raised_by_kind?: "CUSTOMER_PORTAL" | "FM" | "CRM"; passport_item_id?: string | null;
}

export async function createWarrantyCase(input: CreateWarrantyCaseInput, ctx: Ctx): Promise<WarrantyCaseRow> {
  await authorize(ctx, "handovers", "WRITE");
  const severity = input.severity.toUpperCase();
  if (!SEVERITIES.includes(severity)) throw new AppError("validation", `invalid severity ${input.severity}`, "severity");
  const unit = await db.query<{ project_id: string }>(`SELECT project_id FROM unit WHERE id = $1`, [input.unit_id]);
  if (!unit.rows[0]) throw new AppError("not_found", "unit not found");
  const id = randomUUID();
  await withTx(undefined, async (tx) => {
    await tx.query(
      `INSERT INTO warranty_case (id, unit_id, booking_id, project_id, passport_item_id, category, trade, severity, description, coverage, status, chargeable_amount, raised_by_kind)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending','open',0,$10)`,
      [id, input.unit_id, input.booking_id, unit.rows[0].project_id, input.passport_item_id ?? null, input.category, input.trade, severity, input.description, input.raised_by_kind ?? null]
    );
    await appendEvent(tx, {
      type: "warranty.case_opened", entity_type: "warranty_case", entity_id: id,
      project_id: unit.rows[0].project_id, unit_id: input.unit_id, booking_id: input.booking_id,
      payload: { category: input.category, severity }, ...actorFields(ctx),
    });
  });
  return loadCase(id);
}

/** Rule 2/3: derives coverage, starts a real response `sla_clock` by severity (06's own
 *  mechanism — not wired to an escalation ladder; flagged, same class as 15's own
 *  `critical_snag_2d` staying unwired). */
export async function triageWarrantyCase(id: string, ctx: Ctx): Promise<WarrantyCaseRow> {
  await authorize(ctx, "handovers", "WRITE");
  const c = await loadCase(id);
  assertFrom(c, ["open"], "triaged");
  const unit = (await db.query<{ handover_completed_at: string | null; product_type: string }>(
    `SELECT phc.handover_completed_at::text AS handover_completed_at, u.product_type
       FROM unit u LEFT JOIN post_handover_case phc ON phc.unit_id = u.id WHERE u.id = $1`,
    [c.unit_id]
  )).rows[0];
  const handoverAt = unit?.handover_completed_at ?? new Date(0).toISOString();

  await withTx(undefined, async (tx) => {
    const { in_coverage, coverage_basis } = await computeCoverage(c.category, handoverAt, c.passport_item_id, c.project_id, unit?.product_type ?? "DEFAULT", tx);
    const policyCode = `warranty_${c.severity.toLowerCase()}`;
    const policy = (await tx.query<{ id: string; duration_value: number; duration_unit: "WORKING_DAYS" | "CALENDAR_DAYS" | "HOURS" }>(
      `SELECT id, duration_value, duration_unit FROM sla_policy WHERE code = $1`, [policyCode]
    )).rows[0];
    const calendarRow = (await tx.query<CalendarRow>(`SELECT working_days, holidays FROM project_calendar ORDER BY id LIMIT 1`)).rows[0] ?? { working_days: [1, 2, 3, 4, 5], holidays: [] };
    const clockId = policy ? await startClock({ subject_type: "warranty_case", subject_id: id, policy, calendar: calendarRow }, tx) : null;
    await tx.query(
      `UPDATE warranty_case SET status = 'triaged', in_coverage = $2, coverage_basis = $3, coverage = $4, sla_clock_id = $5 WHERE id = $1`,
      [id, in_coverage, coverage_basis, in_coverage ? "dlp" : "out_of_coverage", clockId]
    );
  });
  return loadCase(id);
}

/** Out-of-coverage cases get a quote before work (rule 2) — customer accepts, or FM records a
 *  waiver with reason; `assignWarrantyCase` enforces "no work without acceptance or waiver." */
export async function quoteWarrantyCase(id: string, quoteInr: number, ctx: Ctx): Promise<WarrantyCaseRow> {
  await authorize(ctx, "handovers", "WRITE");
  const c = await loadCase(id);
  if (c.in_coverage) throw new AppError("conflict", "case is in coverage — no quote needed");
  assertFrom(c, ["triaged"], "triaged");
  await withTx(undefined, async (tx) => {
    await tx.query(`UPDATE warranty_case SET quote_inr = $2 WHERE id = $1`, [id, quoteInr]);
    await appendEvent(tx, {
      type: "warranty.quote_issued", entity_type: "warranty_case", entity_id: id,
      project_id: c.project_id, unit_id: c.unit_id, booking_id: c.booking_id,
      payload: { quote_inr: quoteInr }, ...actorFields(ctx),
    });
  });
  return loadCase(id);
}

/** Customer accepts the quote (own booking, portal) or staff records acceptance on their behalf —
 *  same on-behalf fallback 18/23/26 already established for a portal-shaped action. The staff
 *  branch is `authorize(ctx, "handovers", "WRITE")`, and the seeded matrix grants that only to
 *  SITE/FM ("R N R N N N N W W") — CRM is READ-only here and cannot call this, despite being the
 *  quote-issuing conversation's usual owner elsewhere in the flow. Flagged, not silently widened:
 *  narrowing "staff" to FM/SITE is the matrix's call, not this file's to override. */
export async function acceptQuote(id: string, ctx: Ctx): Promise<WarrantyCaseRow> {
  const c = await loadCase(id);
  if (ctx.actor.kind === "CUSTOMER") {
    const owns = await db.query<{ id: string }>(`SELECT b.id FROM booking b JOIN customer_login cl ON cl.booking_id = b.id WHERE b.id = $1 AND cl.user_id = $2`, [c.booking_id, ctx.actor.user_id]);
    if (!owns.rows[0]) throw new AppError("forbidden", "not your booking");
  } else {
    await authorize(ctx, "handovers", "WRITE");
  }
  if (!c.quote_inr) throw new AppError("conflict", "no quote to accept");
  await withTx(undefined, async (tx) => {
    await tx.query(`UPDATE warranty_case SET quote_accepted_at = now() WHERE id = $1`, [id]);
    await appendEvent(tx, {
      type: "warranty.quote_accepted", entity_type: "warranty_case", entity_id: id,
      project_id: c.project_id, unit_id: c.unit_id, booking_id: c.booking_id,
      payload: { quote_inr: c.quote_inr }, ...actorFields(ctx),
    });
  });
  return loadCase(id);
}

export async function waiveQuote(id: string, reason: string, ctx: Ctx): Promise<WarrantyCaseRow> {
  await authorize(ctx, "handovers", "WRITE");
  if (!reason?.trim()) throw new AppError("validation", "reason is required", "reason");
  await db.query(`UPDATE warranty_case SET waived_reason = $2 WHERE id = $1`, [id, reason.trim()]);
  return loadCase(id);
}

export async function assignWarrantyCase(id: string, contractorId: string, ctx: Ctx): Promise<WarrantyCaseRow> {
  await authorize(ctx, "handovers", "WRITE");
  const c = await loadCase(id);
  assertFrom(c, ["triaged"], "assigned");
  if (!c.in_coverage && !c.quote_accepted_at && !c.waived_reason) {
    throw new AppError("conflict", "out-of-coverage work needs an accepted quote or an FM waiver with reason");
  }
  await db.query(`UPDATE warranty_case SET status = 'assigned', contractor_id = $2 WHERE id = $1`, [id, contractorId]);
  return loadCase(id);
}

export async function startWarrantyCase(id: string, beforeFileKeys: string[] | undefined, ctx: Ctx): Promise<WarrantyCaseRow> {
  await authorize(ctx, "handovers", "WRITE");
  const c = await loadCase(id);
  assertFrom(c, ["assigned"], "in_progress");
  await db.query(`UPDATE warranty_case SET status = 'in_progress', before_file_keys = $2::text[] WHERE id = $1`, [id, beforeFileKeys ?? []]);
  return loadCase(id);
}

export async function resolveWarrantyCase(id: string, input: { cost_inr?: number | null; root_cause_code?: string | null; after_file_keys?: string[] }, ctx: Ctx): Promise<WarrantyCaseRow> {
  await authorize(ctx, "handovers", "WRITE");
  const c = await loadCase(id);
  assertFrom(c, ["in_progress"], "resolved");
  await withTx(undefined, async (tx) => {
    await tx.query(
      `UPDATE warranty_case SET status = 'resolved', cost_inr = $2, root_cause_code = $3, after_file_keys = $4::text[] WHERE id = $1`,
      [id, input.cost_inr ?? null, input.root_cause_code ?? null, input.after_file_keys ?? []]
    );
  });
  await addServiceRecord({ unit_id: c.unit_id, kind: "WARRANTY_FIX", description: c.description, cost_inr: input.cost_inr ?? null, warranty_case_id: id }, ctx);
  return loadCase(id);
}

/** Customer verification — required before CLOSED for a customer-raised case (rule 3). */
export async function verifyWarrantyCase(id: string, ctx: Ctx): Promise<WarrantyCaseRow> {
  const c = await loadCase(id);
  assertFrom(c, ["resolved"], "resolved");
  if (ctx.actor.kind === "CUSTOMER") {
    const owns = await db.query<{ id: string }>(`SELECT b.id FROM booking b JOIN customer_login cl ON cl.booking_id = b.id WHERE b.id = $1 AND cl.user_id = $2`, [c.booking_id, ctx.actor.user_id]);
    if (!owns.rows[0]) throw new AppError("forbidden", "not your booking");
  } else {
    await authorize(ctx, "handovers", "WRITE");
  }
  await db.query(`UPDATE warranty_case SET customer_verified_at = now() WHERE id = $1`, [id]);
  return loadCase(id);
}

export async function closeWarrantyCase(id: string, ctx: Ctx): Promise<WarrantyCaseRow> {
  await authorize(ctx, "handovers", "WRITE");
  const c = await loadCase(id);
  assertFrom(c, ["resolved"], "closed");
  if (c.raised_by_kind === "CUSTOMER_PORTAL" && !c.customer_verified_at) {
    throw new AppError("conflict", "customer verification is required before closing a customer-raised case");
  }
  await withTx(undefined, async (tx) => {
    await tx.query(`UPDATE warranty_case SET status = 'closed', chargeable_amount = $2 WHERE id = $1`, [id, c.in_coverage === false ? (c.cost_inr ?? 0) : 0]);
    await appendEvent(tx, {
      type: "warranty.case_closed", entity_type: "warranty_case", entity_id: id,
      project_id: c.project_id, unit_id: c.unit_id, booking_id: c.booking_id,
      payload: { cost_inr: c.cost_inr }, ...actorFields(ctx),
    });
  });
  return loadCase(id);
}

export async function rejectWarrantyCase(id: string, reason: string, ctx: Ctx): Promise<WarrantyCaseRow> {
  await authorize(ctx, "handovers", "WRITE");
  if (!reason?.trim()) throw new AppError("validation", "reason is required", "reason");
  const c = await loadCase(id);
  assertFrom(c, ["open", "triaged"], "rejected");
  await db.query(`UPDATE warranty_case SET status = 'rejected', rejected_reason = $2 WHERE id = $1`, [id, reason.trim()]);
  return loadCase(id);
}

export async function listWarrantyCases(filters: { unit_id?: string; booking_id?: string; project_id?: string; status?: string }, ctx: Ctx): Promise<WarrantyCaseRow[]> {
  await authorize(ctx, "handovers", "READ");
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.unit_id) { params.push(filters.unit_id); clauses.push(`unit_id = $${params.length}`); }
  if (filters.booking_id) { params.push(filters.booking_id); clauses.push(`booking_id = $${params.length}`); }
  if (filters.project_id) { params.push(filters.project_id); clauses.push(`project_id = $${params.length}`); }
  if (filters.status) { params.push(filters.status.toLowerCase()); clauses.push(`status = $${params.length}`); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const r = await db.query<WarrantyCaseRow>(`${SELECT} ${where} ORDER BY status, severity`, params);
  return r.rows;
}

export async function getWarrantyCase(id: string, ctx: Ctx): Promise<WarrantyCaseRow> {
  await authorize(ctx, "handovers", "READ");
  return loadCase(id);
}

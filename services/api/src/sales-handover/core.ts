import { randomUUID } from "node:crypto";
import { db } from "../db";
import { appendEvent, withTx, actorFields, type DbLike } from "../events";
import { authorize } from "../authz/authorize";
import { AppError, type Ctx } from "../authz/types";
import { requiredApprovers } from "../approvals/matrix";
import { createAction } from "../actions/core";
import { createCommitmentFromSource, approveCommitment, activateCommitment, type CommitmentCategory } from "../commitments/core";
import { acceptBooking as acceptBookingLegacy, returnBooking as returnBookingLegacy } from "../bookings-crm";
import { resolveChecklistRules, scoreCompleteness, type ChecklistRuleRow, type CompletenessResult } from "./checklist";

// 17-sales-crm-handover.md. Additive alongside the existing bookings.ts/bookings-crm.ts
// accept/return flow (see that file's header + 0030_sales_handover.sql's header for the
// booking.status decision). Journey instantiation (rule 5) is already wired — 06's
// journey/subscribers.ts fires on `sales_handover.accepted`, which `acceptBooking` already
// emits — so accepting through this module gets a real journey for free, no new subscriber
// needed. The gap this module actually fills: packet/checklist completeness (rules 1-2),
// commercial approval gate (rule 3), DRAFT commitments capture + CRM review action on submit
// (rule 4), rm_owner round-robin + onboarding actions + commitment activation + first_time_right
// on accept (rule 5), return-reason taxonomy + Sales action on return (rule 6), FTR metric
// (rule 7).
//
// Two completeness gates coexist deliberately (not unified): bookings.ts's `assessCompleteness`
// (simple field/doc presence, gates booking creation itself) and this module's checklist-based
// one (weighted, project/product/residency-resolved, gates the NEW submit step). Full unification
// needs 22's document statuses, which the spec itself marks as a fallback state — flagged, not
// attempted here under the speed mandate.
//
// documents_section is scored against booking.docs (existing jsonb from booking creation), not a
// `files` table — 22 isn't built and the spec's own fallback names a table (`files`) that doesn't
// exist either; booking.docs is real, live data the one flow that reaches this checklist already
// produces. Residency is captured on the packet's own customer_section (defaulting RESIDENT) —
// `customer` (which has the real residency column) doesn't exist yet at submit time, since
// acceptBooking is what creates the Customer Twin.

export interface SalesHandoverRow {
  id: string;
  booking_id: string;
  project_id: string;
  status: "DRAFT" | "SUBMITTED" | "RETURNED" | "ACCEPTED";
  version: number;
  packet: HandoverPacket;
  completeness_score: number | null;
  completeness_detail: CompletenessResult["detail"] | null;
  submitted_by: string | null;
  submitted_at: string | null;
  accepted_by: string | null;
  accepted_at: string | null;
  returned_by: string | null;
  returned_at: string | null;
  return_reason_code: string | null;
  return_note: string | null;
  first_time_right: boolean | null;
}

export interface HandoverPacket {
  customer_section: {
    display_name: string | null;
    phone: string | null;
    pan: string | null;
    residency: "RESIDENT" | "NRI" | "OCI";
    applicant_details_confirmed: boolean;
    contact_verified: boolean;
    nri_status_confirmed: boolean;
    communication_pref_confirmed: boolean;
  };
  commercial_section: {
    final_price_inr: number | null;
    discount_inr: number;
    brokerage: number;
    payment_plan_ref: string | null;
    booking_amount_inr: number | null;
    approved_deviations: { domain: "DISCOUNT" | "BROKERAGE"; approver: string; ref: string }[];
  };
  unit_section: {
    unit_number: string | null;
    unit_type: string | null;
    facing: string | null;
    product_type: string | null;
    unit_confirmed: boolean;
    facing_confirmed: boolean;
    parking_confirmed: boolean;
  };
  documents_section: { type: string; received: boolean }[];
  commitments_section: SalesHandoverCommitmentInput[];
}

export interface SalesHandoverCommitmentInput {
  category: CommitmentCategory;
  description: string;
  due_date: string;
  financial_impact_inr?: number | null;
  beneficiary: "CUSTOMER" | "INTERNAL";
  customer_facing: boolean;
}

export interface SubmitHandoverInput {
  residency?: "RESIDENT" | "NRI" | "OCI";
  confirmations?: Partial<
    Pick<
      HandoverPacket["customer_section"],
      "applicant_details_confirmed" | "contact_verified" | "nri_status_confirmed" | "communication_pref_confirmed"
    > &
      Pick<HandoverPacket["unit_section"], "unit_confirmed" | "facing_confirmed" | "parking_confirmed">
  >;
  commercial?: { discount_inr?: number; brokerage?: number; payment_plan_ref?: string | null };
  commitments?: SalesHandoverCommitmentInput[];
}

interface HandoverBlockedError extends AppError {
  blockers: string[];
}

function row(r: Record<string, unknown>): SalesHandoverRow {
  return {
    id: r.id as string,
    booking_id: r.booking_id as string,
    project_id: r.project_id as string,
    status: r.status as SalesHandoverRow["status"],
    version: r.version as number,
    packet: r.packet as HandoverPacket,
    completeness_score: (r.completeness_score as number | null) ?? null,
    completeness_detail: (r.completeness_detail as CompletenessResult["detail"] | null) ?? null,
    submitted_by: (r.submitted_by as string | null) ?? null,
    submitted_at: r.submitted_at ? new Date(r.submitted_at as string).toISOString() : null,
    accepted_by: (r.accepted_by as string | null) ?? null,
    accepted_at: r.accepted_at ? new Date(r.accepted_at as string).toISOString() : null,
    returned_by: (r.returned_by as string | null) ?? null,
    returned_at: r.returned_at ? new Date(r.returned_at as string).toISOString() : null,
    return_reason_code: (r.return_reason_code as string | null) ?? null,
    return_note: (r.return_note as string | null) ?? null,
    first_time_right: (r.first_time_right as boolean | null) ?? null,
  };
}

const SELECT = `SELECT id, booking_id, project_id, status, version, packet, completeness_score, completeness_detail,
  submitted_by, submitted_at, accepted_by, accepted_at, returned_by, returned_at,
  return_reason_code, return_note, first_time_right FROM sales_handover`;

export async function getSalesHandover(bookingId: string, tx: DbLike = db): Promise<SalesHandoverRow | null> {
  const r = await tx.query<Record<string, unknown>>(`${SELECT} WHERE booking_id = $1`, [bookingId]);
  return r.rows[0] ? row(r.rows[0]) : null;
}

async function requireHandoverByBooking(bookingId: string, tx: DbLike): Promise<SalesHandoverRow> {
  const h = await getSalesHandover(bookingId, tx);
  if (!h) throw new AppError("not_found", "sales handover not found for this booking");
  return h;
}

async function loadChecklistRules(tx: DbLike): Promise<ChecklistRuleRow[]> {
  const r = await tx.query<ChecklistRuleRow>(
    `SELECT id, project_id, product_type, residency, item_code, kind, required, weight FROM handover_checklist_rule
      WHERE effective_from <= CURRENT_DATE AND (effective_to IS NULL OR effective_to > CURRENT_DATE)`
  );
  return r.rows;
}

interface BookingFacts {
  project_id: string;
  status: string;
  unit_id: string;
  booking_number: string;
  total_consideration: number;
  booking_amount_inr: number | null;
  docs: { type: string; received: boolean }[];
  applicant_name: string | null;
  applicant_phone: string | null;
  applicant_pan: string | null;
  unit_number: string | null;
  unit_type: string | null;
  facing: string | null;
  product_type: string | null;
}

async function loadBookingFacts(bookingId: string, tx: DbLike): Promise<BookingFacts> {
  const r = await tx.query<{
    project_id: string; status: string; unit_id: string; booking_number: string;
    total_consideration: number; booking_amount_inr: number | null; docs: unknown;
    applicant_name: string | null; applicant_phone: string | null; applicant_pan: string | null;
    unit_number: string | null; unit_type: string | null; facing: string | null; product_type: string | null;
  }>(
    `SELECT b.project_id, b.status, b.unit_id, b.booking_number, b.total_consideration::float8 AS total_consideration,
            b.booking_amount_inr::float8 AS booking_amount_inr, b.docs,
            a.display_name AS applicant_name, a.phone AS applicant_phone, a.pan AS applicant_pan,
            u.unit_number, u.unit_type, u.facing, u.product_type
       FROM booking b
       JOIN unit u ON u.id = b.unit_id
       LEFT JOIN booking_applicant a ON a.booking_id = b.id AND a.role = 'primary'
      WHERE b.id = $1`,
    [bookingId]
  );
  if (!r.rows[0]) throw new AppError("not_found", "booking not found");
  const b = r.rows[0];
  return { ...b, docs: (b.docs as { type: string; received: boolean }[] | null) ?? [] };
}

function buildPacket(facts: BookingFacts, input: SubmitHandoverInput, existing: HandoverPacket | null): HandoverPacket {
  const c = input.confirmations ?? {};
  return {
    customer_section: {
      display_name: facts.applicant_name,
      phone: facts.applicant_phone,
      pan: facts.applicant_pan,
      residency: input.residency ?? existing?.customer_section.residency ?? "RESIDENT",
      applicant_details_confirmed: c.applicant_details_confirmed ?? existing?.customer_section.applicant_details_confirmed ?? false,
      contact_verified: c.contact_verified ?? existing?.customer_section.contact_verified ?? false,
      nri_status_confirmed: c.nri_status_confirmed ?? existing?.customer_section.nri_status_confirmed ?? false,
      communication_pref_confirmed: c.communication_pref_confirmed ?? existing?.customer_section.communication_pref_confirmed ?? false,
    },
    commercial_section: {
      final_price_inr: facts.total_consideration,
      discount_inr: input.commercial?.discount_inr ?? existing?.commercial_section.discount_inr ?? 0,
      brokerage: input.commercial?.brokerage ?? existing?.commercial_section.brokerage ?? 0,
      payment_plan_ref: input.commercial?.payment_plan_ref ?? existing?.commercial_section.payment_plan_ref ?? null,
      booking_amount_inr: facts.booking_amount_inr ?? facts.total_consideration,
      approved_deviations: existing?.commercial_section.approved_deviations ?? [],
    },
    unit_section: {
      unit_number: facts.unit_number,
      unit_type: facts.unit_type,
      facing: facts.facing,
      product_type: facts.product_type,
      unit_confirmed: c.unit_confirmed ?? existing?.unit_section.unit_confirmed ?? false,
      facing_confirmed: c.facing_confirmed ?? existing?.unit_section.facing_confirmed ?? false,
      parking_confirmed: c.parking_confirmed ?? existing?.unit_section.parking_confirmed ?? false,
    },
    documents_section: facts.docs,
    commitments_section: input.commitments ?? existing?.commitments_section ?? [],
  };
}

/** Rule 3, part 1: resolve a required approver via 25's matrix; the spec's own fallback ("no
 *  threshold") applies when no band is configured, since 25 ships with zero seeded rows for a
 *  domain nothing has consumed until now. Part 2 (an APPROVAL-family action must be CLOSED) is
 *  the real gate — resolving a role alone proves nothing. */
async function commercialApprovalGate(
  bookingId: string,
  projectId: string,
  commercial: HandoverPacket["commercial_section"],
  tx: DbLike
): Promise<{ satisfied: boolean; blockers: string[] }> {
  const blockers: string[] = [];
  const domains: { domain: "DISCOUNT" | "BROKERAGE"; value: number }[] = [
    { domain: "DISCOUNT", value: commercial.discount_inr },
    { domain: "BROKERAGE", value: commercial.brokerage },
  ];
  for (const { domain, value } of domains) {
    if (value <= 0) continue;
    let approverRole: string;
    try {
      const resolved = await requiredApprovers(domain, "INR", value, projectId, tx);
      approverRole = resolved.approver_role;
    } catch {
      continue; // no band configured — spec's stated fallback: no threshold
    }
    const title = `Commercial approval: ${domain}`;
    const existingAction = await tx.query<{ id: string; status: string }>(
      `SELECT id, status FROM action WHERE source_module = 'sales_handover' AND source_entity_type = 'booking'
         AND source_entity_id = $1 AND title = $2`,
      [bookingId, title]
    );
    if (existingAction.rows[0]?.status === "Closed") continue;
    if (!existingAction.rows[0]) {
      await createAction(
        {
          type: "exec_approval", title, project_id: projectId, source_module: "sales_handover",
          source_entity_type: "booking", source_entity_id: bookingId, booking_id: bookingId,
          owner_role: approverRole, approver_role: approverRole, priority: "HIGH", origin: "AUTO",
        },
        tx
      );
    }
    blockers.push(`commercial_approval:${domain}`);
  }
  return { satisfied: blockers.length === 0, blockers };
}

function satisfiedItemCodes(packet: HandoverPacket, commercialApprovalSatisfied: boolean): Set<string> {
  const s = new Set<string>();
  const cs = packet.customer_section;
  if (cs.applicant_details_confirmed) s.add("applicant_details_confirmed");
  if (cs.contact_verified) s.add("contact_verified");
  if (cs.nri_status_confirmed) s.add("nri_status_confirmed");
  if (cs.communication_pref_confirmed) s.add("communication_pref_confirmed");
  const us = packet.unit_section;
  if (us.unit_confirmed) s.add("unit_confirmed");
  if (us.facing_confirmed) s.add("facing_confirmed");
  if (us.parking_confirmed) s.add("parking_confirmed");

  const co = packet.commercial_section;
  if (co.final_price_inr !== null) s.add("final_price_inr");
  s.add("discount_inr"); // always present — defaults to 0
  s.add("brokerage"); // always present — defaults to 0
  if (co.payment_plan_ref) s.add("payment_plan_ref");
  if (co.booking_amount_inr !== null) s.add("booking_amount_inr");

  const receivedTypes = new Set(packet.documents_section.filter((d) => d.received).map((d) => d.type));
  for (const t of ["Booking Form", "Cost Sheet", "PAN", "Identity Proof", "Address Proof", "Photograph", "Passport", "OCI card", "POA"]) {
    if (receivedTypes.has(t)) s.add(t);
  }

  if (commercialApprovalSatisfied) s.add("commercial_approval");
  return s;
}

async function upsertHandoverRow(
  tx: DbLike,
  data: {
    id: string; booking_id: string; project_id: string; status: SalesHandoverRow["status"]; version: number;
    packet: HandoverPacket; completeness_score: number; completeness_detail: CompletenessResult["detail"];
    submitted_by?: string; returned_by?: string; return_reason_code?: string; return_note?: string;
    accepted_by?: string; first_time_right?: boolean;
  }
): Promise<void> {
  await tx.query(
    `INSERT INTO sales_handover
       (id, booking_id, project_id, status, version, packet, completeness_score, completeness_detail,
        submitted_by, submitted_at, returned_by, returned_at, return_reason_code, return_note,
        accepted_by, accepted_at, first_time_right)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,
             $9, CASE WHEN $9::text IS NOT NULL THEN now() ELSE NULL END,
             $10, CASE WHEN $10::text IS NOT NULL THEN now() ELSE NULL END, $11, $12,
             $13, CASE WHEN $13::text IS NOT NULL THEN now() ELSE NULL END, $14)
     ON CONFLICT (booking_id) DO UPDATE SET
       status = $4, version = $5, packet = $6::jsonb, completeness_score = $7, completeness_detail = $8::jsonb,
       submitted_by = COALESCE($9, sales_handover.submitted_by),
       submitted_at = CASE WHEN $9::text IS NOT NULL THEN now() ELSE sales_handover.submitted_at END,
       returned_by = COALESCE($10, sales_handover.returned_by),
       returned_at = CASE WHEN $10::text IS NOT NULL THEN now() ELSE sales_handover.returned_at END,
       return_reason_code = COALESCE($11, sales_handover.return_reason_code),
       return_note = COALESCE($12, sales_handover.return_note),
       accepted_by = COALESCE($13, sales_handover.accepted_by),
       accepted_at = CASE WHEN $13::text IS NOT NULL THEN now() ELSE sales_handover.accepted_at END,
       first_time_right = COALESCE($14, sales_handover.first_time_right)`,
    [
      data.id, data.booking_id, data.project_id, data.status, data.version,
      JSON.stringify(data.packet), data.completeness_score, JSON.stringify(data.completeness_detail),
      data.submitted_by ?? null, data.returned_by ?? null, data.return_reason_code ?? null, data.return_note ?? null,
      data.accepted_by ?? null, data.first_time_right ?? null,
    ]
  );
}

/** Rule 1/2/4: DRAFT|RETURNED → SUBMITTED, version++, checklist-based completeness score, DRAFT
 *  commitments captured (13 rule 6), CRM "Review handover" action. Coexists with `createBooking`'s
 *  own simpler completeness gate (see header) — this is the packet's first-class submit, called
 *  separately once a booking exists. */
export async function submitHandover(bookingId: string, input: SubmitHandoverInput, ctx: Ctx): Promise<SalesHandoverRow> {
  await authorize(ctx, "sales_handover", "WRITE");
  const existing = await getSalesHandover(bookingId);
  if (existing && existing.status !== "DRAFT" && existing.status !== "RETURNED") {
    throw new AppError("conflict", `cannot submit a handover from ${existing.status}`);
  }

  // Phase 1: compute the live packet/score and persist it unconditionally (rule 1: "shows the
  // missing list otherwise") — this must commit even when blocked, so it's its own transaction;
  // a blocked submit still throws below, and a throw inside `withTx` would roll everything back.
  const { id, facts, packet, score, detail, blockers } = await withTx(undefined, async (tx) => {
    const facts = await loadBookingFacts(bookingId, tx);
    const packet = buildPacket(facts, input, existing?.packet ?? null);
    const rules = await loadChecklistRules(tx);
    const applied = resolveChecklistRules(rules, packet.unit_section.product_type, packet.customer_section.residency, facts.project_id);
    const approval = await commercialApprovalGate(bookingId, facts.project_id, packet.commercial_section, tx);
    const satisfied = satisfiedItemCodes(packet, approval.satisfied);
    const { score, detail, blockers: itemBlockers } = scoreCompleteness(applied, satisfied);
    // Replace the generic "commercial_approval" item-code blocker (if present) with the
    // domain-specific ones from the gate itself (e.g. "commercial_approval:DISCOUNT") — more
    // useful to a caller than the bare item code, same information either way.
    const blockers = approval.blockers.length > 0 ? [...itemBlockers.filter((b) => b !== "commercial_approval"), ...approval.blockers] : itemBlockers;
    const id = existing?.id ?? "sho_" + randomUUID().slice(0, 8);
    await upsertHandoverRow(tx, {
      id, booking_id: bookingId, project_id: facts.project_id, status: existing?.status ?? "DRAFT",
      version: existing?.version ?? 0, packet, completeness_score: score, completeness_detail: detail,
    });
    return { id, facts, packet, score, detail, blockers };
  });

  if (blockers.length > 0) {
    const err = new AppError("validation", "gate_blocked") as HandoverBlockedError;
    err.blockers = blockers;
    throw err;
  }

  // Phase 2: advance DRAFT|RETURNED → SUBMITTED and fire the rule-4 side effects.
  return withTx(undefined, async (tx) => {
    const version = existing ? existing.version + 1 : 1;
    await upsertHandoverRow(tx, {
      id, booking_id: bookingId, project_id: facts.project_id, status: "SUBMITTED", version, packet,
      completeness_score: score, completeness_detail: detail, submitted_by: ctx.actor.user_id,
    });

    // Resubmit-after-return (rule 4's RETURNED → SUBMITTED leg): booking.status needs to be back
    // at 'submitted' for the existing, unchanged `acceptBooking`/`returnBooking` (bookings-crm.ts)
    // to accept it again — those two are the only writers of booking.status and neither one else
    // reverses a 'returned' booking.
    if (facts.status === "returned") {
      await tx.query(`UPDATE booking SET status = 'submitted' WHERE id = $1`, [bookingId]);
      await appendEvent(tx, {
        type: "booking.status_changed", entity_type: "booking", entity_id: bookingId, project_id: facts.project_id,
        booking_id: bookingId, unit_id: facts.unit_id, payload: { from: "returned", to: "submitted" },
        ...actorFields(ctx),
      });
    }

    for (const c of packet.commitments_section) {
      await createCommitmentFromSource(
        {
          booking_id: bookingId, category: c.category, description: c.description, source: "SALES_HANDOVER",
          beneficiary: c.beneficiary, customer_facing: c.customer_facing, owner_user_id: ctx.actor.user_id,
          due_date: c.due_date, financial_impact_inr: c.financial_impact_inr ?? null,
          approval_required: true, // rule 6: always DRAFT, CRM approves/activates at accept
        },
        ctx,
        tx
      );
    }

    await createAction(
      {
        type: "exec_simple", title: `Review handover ${facts.booking_number}`, project_id: facts.project_id,
        source_module: "sales_handover", source_entity_type: "sales_handover", source_entity_id: id,
        booking_id: bookingId, unit_id: facts.unit_id, owner_role: "CRM", priority: "MEDIUM", origin: "AUTO",
      },
      tx
    );

    await appendEvent(tx, {
      type: "sales_handover.submitted", entity_type: "sales_handover", entity_id: id, project_id: facts.project_id,
      booking_id: bookingId, unit_id: facts.unit_id, payload: { version, completeness_score: score },
      ...actorFields(ctx),
    });

    return requireHandoverByBooking(bookingId, tx);
  });
}

/** Least-loaded round robin (rule 5) among the project's CRM team assignments — real, computed
 *  live from current rm_owner_user_id load, not a stub. Falls back to no assignment (accept still
 *  proceeds with the legacy default-name owner) if no CRM member is assigned to the project. */
async function assignRmOwner(projectId: string, tx: DbLike): Promise<{ user_id: string; display_name: string } | null> {
  const candidates = await tx.query<{ user_id: string; display_name: string }>(
    `SELECT pta.user_id, u.display_name FROM project_team_assignment pta
       JOIN "user" u ON u.id = pta.user_id
      WHERE pta.project_id = $1 AND pta.department = 'CRM'
        AND (pta.effective_to IS NULL OR pta.effective_to >= CURRENT_DATE)`,
    [projectId]
  );
  if (candidates.rows.length === 0) return null;
  const loads = await tx.query<{ rm_owner_user_id: string; count: string }>(
    `SELECT rm_owner_user_id, count(*)::text AS count FROM booking
      WHERE rm_owner_user_id = ANY($1::text[]) AND status IN ('active', 'crm_accepted')
      GROUP BY rm_owner_user_id`,
    [candidates.rows.map((c) => c.user_id)]
  );
  const loadByUser = new Map(loads.rows.map((l) => [l.rm_owner_user_id, Number(l.count)]));
  return [...candidates.rows].sort((a, b) => (loadByUser.get(a.user_id) ?? 0) - (loadByUser.get(b.user_id) ?? 0))[0];
}

const ONBOARDING_ACTIONS: { title: string; owner_role: string }[] = [
  { title: "Welcome call within 24h", owner_role: "CRM" },
  { title: "KYC completion", owner_role: "CRM" },
  { title: "Agreement kickoff", owner_role: "LEGAL" },
  { title: "Payment plan confirmation", owner_role: "ACCOUNTS" },
];

/** Rule 5 (CRM role, not the submitter): SUBMITTED → ACCEPTED. Delegates the actual booking
 *  state change to the existing, already-tested `acceptBooking` (customer twin, unit booked,
 *  `sales_handover.accepted` emitted → journey instantiated for free via 06's subscriber) and
 *  layers the packet-specific rule-5 side effects on top: rm_owner round-robin, onboarding
 *  actions, commitment approve+activate (13 rule 6), first_time_right. */
export async function acceptHandover(bookingId: string, ctx: Ctx): Promise<SalesHandoverRow> {
  const h = await requireHandoverByBooking(bookingId, db);
  if (h.status !== "SUBMITTED") throw new AppError("conflict", `cannot accept a handover from ${h.status}`);
  if (ctx.actor.user_id === h.submitted_by) {
    throw new AppError("forbidden", "the submitter cannot accept their own handover");
  }
  await authorize(ctx, "sales_handover", "WRITE");

  const rm = await withTx(undefined, (tx) => assignRmOwner(h.project_id, tx));
  await acceptBookingLegacy(bookingId, ctx, rm?.display_name);

  await withTx(undefined, async (tx) => {
    const unit = await tx.query<{ unit_id: string }>(`SELECT unit_id FROM booking WHERE id = $1`, [bookingId]);
    const unitId = unit.rows[0]!.unit_id;
    if (rm) await tx.query(`UPDATE booking SET rm_owner_user_id = $1 WHERE id = $2`, [rm.user_id, bookingId]);

    for (const onboarding of ONBOARDING_ACTIONS) {
      await createAction(
        {
          type: "exec_simple", title: onboarding.title, project_id: h.project_id, source_module: "sales_handover",
          source_entity_type: "sales_handover", source_entity_id: h.id, booking_id: bookingId,
          unit_id: unitId, owner_role: onboarding.owner_role, priority: "MEDIUM", origin: "AUTO",
        },
        tx
      );
    }
  });

  // approveCommitment/activateCommitment each open their own transaction (commitments/core.ts) —
  // called sequentially here, not nested inside the withTx blocks above/below (this db adapter's
  // single connection can't hold two concurrent transactions).
  const drafts = await db.query<{ id: string }>(
    `SELECT id FROM commitment WHERE booking_id = $1 AND source = 'SALES_HANDOVER' AND status = 'DRAFT'`,
    [bookingId]
  );
  for (const d of drafts.rows) {
    await approveCommitment(d.id, ctx);
    await activateCommitment(d.id, ctx);
  }

  return withTx(undefined, async (tx) => {
    const firstTimeRight = h.version === 1;
    await upsertHandoverRow(tx, {
      id: h.id, booking_id: bookingId, project_id: h.project_id, status: "ACCEPTED", version: h.version,
      packet: h.packet, completeness_score: h.completeness_score ?? 0, completeness_detail: h.completeness_detail ?? [],
      accepted_by: ctx.actor.user_id, first_time_right: firstTimeRight,
    });
    return requireHandoverByBooking(bookingId, tx);
  });
}

/** Rule 6 (CRM role, not the submitter): SUBMITTED → RETURNED with a taxonomy reason code, a
 *  Sales action listing the reasons, and `booking.status = 'returned'` via the existing, already
 *  guarded `returnBooking` (bookings-crm.ts now also refuses a non-'submitted' booking — see that
 *  file's own note — so return-after-accept is refused there, satisfying rule 6's "not allowed"). */
export async function returnHandover(bookingId: string, reasonCode: string, note: string, ctx: Ctx): Promise<SalesHandoverRow> {
  const h = await requireHandoverByBooking(bookingId, db);
  if (h.status !== "SUBMITTED") throw new AppError("conflict", `cannot return a handover from ${h.status}`);
  if (ctx.actor.user_id === h.submitted_by) {
    throw new AppError("forbidden", "the submitter cannot return their own handover");
  }
  await authorize(ctx, "sales_handover", "WRITE");
  const reason = await db.query<{ label: string }>(`SELECT label FROM return_reason WHERE code = $1`, [reasonCode]);
  if (!reason.rows[0]) throw new AppError("validation", "unknown return_reason_code", "reason_code");

  await returnBookingLegacy(bookingId, note || reason.rows[0].label, ctx);

  return withTx(undefined, async (tx) => {
    await createAction(
      {
        type: "exec_simple", title: `Handover returned: ${reason.rows[0]!.label}`, project_id: h.project_id,
        source_module: "sales_handover", source_entity_type: "sales_handover", source_entity_id: h.id,
        booking_id: bookingId, owner_role: "SALES", priority: "HIGH", origin: "AUTO",
        description: note || undefined,
      },
      tx
    );
    await upsertHandoverRow(tx, {
      id: h.id, booking_id: bookingId, project_id: h.project_id, status: "RETURNED", version: h.version,
      packet: h.packet, completeness_score: h.completeness_score ?? 0, completeness_detail: h.completeness_detail ?? [],
      returned_by: ctx.actor.user_id, return_reason_code: reasonCode, return_note: note,
    });
    return requireHandoverByBooking(bookingId, tx);
  });
}

export interface HandoverMetrics {
  accepted: number;
  first_time_right: number;
  first_time_right_pct: number;
  by_sales_owner: { user_id: string; display_name: string; accepted: number; first_time_right: number }[];
  return_reasons: { code: string; label: string; count: number }[];
}

/** Rule 7: FTR = accepted with version=1 / accepted, per sales owner + project + month. Live, not
 *  persisted — same "compute on read" pattern as every other read model this session. Sales owner
 *  comes from `booking.sales_owner_user_id` (bookings.ts now captures it at creation — it existed
 *  on the table since 0003 but nothing wrote it before this spec needed it). */
export async function getHandoverMetrics(projectId: string, from: string, to: string, ctx: Ctx): Promise<HandoverMetrics> {
  await authorize(ctx, "sales_handover", "READ");
  const accepted = await db.query<{ version: number; sales_owner_user_id: string | null; display_name: string | null }>(
    `SELECT sh.version, b.sales_owner_user_id, u.display_name
       FROM sales_handover sh
       JOIN booking b ON b.id = sh.booking_id
       LEFT JOIN "user" u ON u.id = b.sales_owner_user_id
      WHERE sh.project_id = $1 AND sh.status = 'ACCEPTED' AND sh.accepted_at >= $2 AND sh.accepted_at < $3`,
    [projectId, from, to]
  );
  const ftr = accepted.rows.filter((r) => r.version === 1).length;
  const byOwner = new Map<string, { user_id: string; display_name: string; accepted: number; first_time_right: number }>();
  for (const r of accepted.rows) {
    if (!r.sales_owner_user_id) continue;
    const entry = byOwner.get(r.sales_owner_user_id) ?? { user_id: r.sales_owner_user_id, display_name: r.display_name ?? r.sales_owner_user_id, accepted: 0, first_time_right: 0 };
    entry.accepted += 1;
    if (r.version === 1) entry.first_time_right += 1;
    byOwner.set(r.sales_owner_user_id, entry);
  }
  const reasons = await db.query<{ code: string; label: string; count: string }>(
    `SELECT sh.return_reason_code AS code, rr.label, count(*)::text AS count
       FROM sales_handover sh JOIN return_reason rr ON rr.code = sh.return_reason_code
      WHERE sh.project_id = $1 AND sh.returned_at >= $2 AND sh.returned_at < $3
      GROUP BY sh.return_reason_code, rr.label`,
    [projectId, from, to]
  );
  return {
    accepted: accepted.rows.length,
    first_time_right: ftr,
    first_time_right_pct: accepted.rows.length === 0 ? 0 : Math.round((ftr / accepted.rows.length) * 100),
    by_sales_owner: [...byOwner.values()],
    return_reasons: reasons.rows.map((r) => ({ code: r.code, label: r.label, count: Number(r.count) })),
  };
}

export async function listReturnReasons(ctx: Ctx): Promise<{ code: string; label: string; category: string }[]> {
  await authorize(ctx, "sales_handover", "READ");
  const r = await db.query<{ code: string; label: string; category: string }>(`SELECT code, label, category FROM return_reason ORDER BY category, code`);
  return r.rows;
}

export interface HandoverQueueRow {
  booking_id: string;
  booking_number: string;
  completeness_score: number | null;
  age_days: number;
  sales_owner: string | null;
}

/** CRM handover queue — submitted packets awaiting accept/return, oldest first. */
export async function getHandoverQueue(projectId: string, ctx: Ctx): Promise<HandoverQueueRow[]> {
  await authorize(ctx, "sales_handover", "READ");
  const r = await db.query<{ booking_id: string; booking_number: string; completeness_score: number | null; submitted_at: string; sales_owner: string | null }>(
    `SELECT sh.booking_id, b.booking_number, sh.completeness_score, sh.submitted_at, u.display_name AS sales_owner
       FROM sales_handover sh
       JOIN booking b ON b.id = sh.booking_id
       LEFT JOIN "user" u ON u.id = b.sales_owner_user_id
      WHERE sh.project_id = $1 AND sh.status = 'SUBMITTED'
      ORDER BY sh.submitted_at ASC`,
    [projectId]
  );
  const now = Date.now();
  return r.rows.map((row) => ({
    booking_id: row.booking_id,
    booking_number: row.booking_number,
    completeness_score: row.completeness_score,
    age_days: Math.floor((now - new Date(row.submitted_at).getTime()) / (24 * 60 * 60 * 1000)),
    sales_owner: row.sales_owner,
  }));
}

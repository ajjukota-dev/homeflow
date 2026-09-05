import { describe, it, expect, beforeAll } from "vitest";
import { initDb, db } from "../db";
import { superAdminCtx as fakeSuperAdminCtx, ctxWithRoles } from "../authz/test-helpers";
import type { Ctx } from "../authz/types";
import { createProject, createUnit } from "../projects";
import { createBooking } from "../bookings";
import { updateProgress } from "../progress/core";
import { grantException } from "../changeability/core";
import { createBaseline, approveBaseline } from "../specification/baselines";
import { startInspection, setInspectionItems, addInspectionEvidence, completeInspection } from "../qa/inspections";
import { postReceipt } from "../demands-receipts";
import { DEMAND_SELECT, mapDemands } from "../demands";
import { raiseChangeRequest, recordFeasibility, getChangeRequest } from "./capture";
import { putCrItems, setImpact, linkGateException } from "./costing";
import { putApprovalRules, submitCrForApproval, decideCrApproval } from "./approvals";
import { issueQuotation, acceptQuotation } from "./quotation";
import { confirmPaymentGate, releaseChangeRequest, waivePayment } from "./release";
import { closeExecutionAction, linkQaInspection, markQaVerified, customerAcceptCr, asBuiltClose } from "./execution";
import { withdrawChangeRequest } from "./capture";
import { cancelChangeRequest } from "./cancellation";
import { getCrEconomics } from "./economics";

// 18-change-requests.md — integration over real PGlite. One test per rule group; the full happy
// path (rules 2-8, 10-12) runs as one CR through the whole state machine, the way the spec's own
// acceptance criterion frames it ("portal raise -> desk feasibility -> costing -> approval ->
// quotation -> accept -> payment -> release -> QA -> accept -> as-built").
const superAdminCtx: Ctx = { actor: { ...fakeSuperAdminCtx.actor, user_id: "user_superadmin" } };
function ctxAs(userId: string, roles: string[]): Ctx {
  return { actor: { ...ctxWithRoles(roles).actor, user_id: userId } };
}
const customisation = () => ctxAs("user_customisation", ["CUSTOMISATION"]);
const customisation2 = () => ctxAs("user_customisation2", ["CUSTOMISATION"]);
const site = () => ctxAs("user_site", ["SITE"]);
const management = () => ctxAs("user_management", ["MANAGEMENT"]);
const qa = () => ctxAs("user_qa", ["QA"]);
const crm = () => ctxAs("user_crm", ["CRM"]);
const sales = () => ctxAs("user_sales", ["SALES"]);
const accounts = () => ctxAs("user_accounts", ["ACCOUNTS"]);

let PROJECT_ID: string;
let unitSeq = 0;

const FULL_DOCS = [
  { type: "PAN card", received: true }, { type: "Address proof", received: true }, { type: "Photograph", received: true },
  { type: "Booking Form", received: true }, { type: "Cost Sheet", received: true },
];

beforeAll(async () => {
  await initDb();
  const p = await createProject({ code: "crtest", name: "Change Request Test Project" }, superAdminCtx);
  PROJECT_ID = p.id;
  await putApprovalRules({ project_id: PROJECT_ID }, [{ kind: "VALUE", threshold: 100000, approver_role: "MANAGEMENT" }], management());
  // 09's release/as-built (rules 7/8 of this file's own state machine) need a real APPROVED
  // baseline for the unit's scope — every test unit here defaults to product_type VILLA.
  const baseline = await createBaseline({ project_id: PROJECT_ID, product_type: "VILLA", name: "CR test standard", items: { flooring_selection: { spec: "Standard vitrified tile", qty: 1 }, kitchen_layout: { spec: "Standard modular", qty: 1 } } }, site());
  await approveBaseline(baseline.id, site());
});

const eventTypesFor = async (entityId: string): Promise<string[]> =>
  (await db.query<{ type: string }>(`SELECT type FROM event WHERE entity_id = $1`, [entityId])).rows.map((r) => r.type);

async function freshBooking(): Promise<{ bookingId: string; unitId: string }> {
  unitSeq += 1;
  const unit = await createUnit(PROJECT_ID, { unit_number: `CR-${unitSeq}`, unit_type: "2BHK", facing: "East" }, superAdminCtx);
  const b = await createBooking(
    unit!.id,
    { applicant: { display_name: "CR Test Customer", phone: `98877${String(unitSeq).padStart(5, "0")}`, pan: `CRTST${String(unitSeq).padStart(4, "0")}A` }, total_consideration: 8_000_000, docs: FULL_DOCS },
    sales()
  );
  return { bookingId: b!.id, unitId: unit!.id };
}

describe("rule 1 — capture is never blocked; a closed gate is routed, not rejected outright", () => {
  it("HARD_CLOSED auto-rejects with a draft customer reason", async () => {
    const { bookingId, unitId } = await freshBooking();
    await updateProgress(unitId, "structure", { state_code: "COMPLETE" }, site());
    await updateProgress(unitId, "mep_first_fix", { state_code: "COMPLETE" }, site());
    const cr = await raiseChangeRequest({ booking_id: bookingId, title: "Move a load-bearing wall", primary_category_code: "structural", raised_by_kind: "CRM" }, crm());
    expect(cr.status).toBe("REJECTED");
    expect(cr.feasibility?.result).toBe("NOT_FEASIBLE");
    expect(cr.gate_summary_at_request.structural).toBe("HARD_CLOSED");
  });

  it("EXCEPTION_ONLY proceeds to FEASIBILITY_REVIEW, then blocks COSTING until 08's exception is linked", async () => {
    const { bookingId, unitId } = await freshBooking();
    await updateProgress(unitId, "structure", { state_code: "COMPLETE" }, site());
    await updateProgress(unitId, "mep_first_fix", { state_code: "COMPLETE" }, site());
    const cr = await raiseChangeRequest({ booking_id: bookingId, title: "Extra AC point", primary_category_code: "electrical", raised_by_kind: "CRM" }, crm());
    expect(cr.status).toBe("FEASIBILITY_REVIEW");
    expect(cr.gate_summary_at_request.electrical).toBe("EXCEPTION_ONLY");

    await recordFeasibility(cr.id, { result: "FEASIBLE", technical_notes: "site can accommodate one extra point" }, site());
    await putCrItems(cr.id, [{ category_code: "electrical", description: "Extra AC point in master bedroom", qty: 1, unit_price_inr: 15000, vendor_cost_inr: 8000 }], customisation());
    await setImpact(cr.id, { cost_inr: 15000, schedule_days: 2, technical_risk: "LOW", handover_impact: "NONE", notes: "minor" }, customisation());
    await expect(submitCrForApproval(cr.id, customisation())).rejects.toThrow(/EXCEPTION_ONLY/);

    const ex = await grantException(unitId, { category_code: "electrical", reason: "customer paid before first-fix closed", evidence_file_keys: ["k/a.pdf"], valid_until: new Date(Date.now() + 30 * 86400000).toISOString() }, management());
    await linkGateException(cr.id, ex.id, customisation());
    const submitted = await submitCrForApproval(cr.id, customisation());
    expect(submitted.status).toBe("AWAITING_CUSTOMER"); // below the VALUE threshold — no approver required
  });
});

describe("rules 2-8, 10-12 — the full lifecycle on one CR", () => {
  it("feasibility -> costing -> approval -> quotation -> payment -> release -> QA -> customer accept -> as-built, with a real profitability figure", async () => {
    const { bookingId, unitId } = await freshBooking();
    const cr = await raiseChangeRequest({ booking_id: bookingId, title: "Flooring upgrade", primary_category_code: "flooring_selection", raised_by_kind: "CRM" }, crm());
    expect(cr.status).toBe("FEASIBILITY_REVIEW");
    expect(cr.gate_summary_at_request.flooring_selection).toBe("OPEN");

    // Rule 2
    const feasible = await recordFeasibility(cr.id, { result: "FEASIBLE_WITH_CONDITIONS", technical_notes: "vendor lead time confirmed" }, site());
    expect(feasible.status).toBe("COSTING");
    expect(await eventTypesFor(cr.id)).toEqual(expect.arrayContaining(["change_request.feasibility_recorded", "change_request.status_changed"]));

    // Rule 3 — one catalogue-priced-shaped bespoke item above the VALUE threshold (100000)
    const items = await putCrItems(cr.id, [{ category_code: "flooring_selection", description: "Italian marble upgrade", qty: 1, unit_price_inr: 150000, vendor_cost_inr: 90000, tax_pct: 10 }], customisation());
    expect(items).toHaveLength(1);
    await expect(submitCrForApproval(cr.id, customisation())).rejects.toThrow(/impact assessment/);
    await setImpact(cr.id, { cost_inr: 150000, schedule_days: 5, technical_risk: "LOW", handover_impact: "NONE", notes: "no handover impact" }, customisation());

    // Rule 4 — value above threshold requires MANAGEMENT; requester/coster cannot approve their own
    const submitted = await submitCrForApproval(cr.id, customisation());
    expect(submitted.status).toBe("AWAITING_APPROVAL");
    const approvalRow = await db.query<{ action_id: string }>(`SELECT action_id FROM change_request_approval WHERE cr_id = $1`, [cr.id]);
    const actionId = approvalRow.rows[0]!.action_id;
    // approver != requester: crm() raised this CR — blocked before role is even checked.
    await expect(decideCrApproval(actionId, "APPROVE", undefined, crm())).rejects.toThrow(/approver ≠ requester/);
    const approved = await decideCrApproval(actionId, "APPROVE", "within margin, approved", management());
    expect(approved.status).toBe("AWAITING_CUSTOMER");

    // Rule 5 — quotation issue + accept
    const quotation = await issueQuotation(cr.id, customisation());
    expect(quotation.status).toBe("ISSUED");
    expect(quotation.total_inr).toBe(Math.round(150000 * 1.1));
    expect(quotation.pdf_file_key).toBeTruthy();
    expect(await eventTypesFor(quotation.id)).toContain("change_request.quotation_issued");
    const accepted = await acceptQuotation(quotation.id, { accepted_via: "SIGNED_COPY" }, crm());
    expect(accepted.status).toBe("ACCEPTED");
    expect(await eventTypesFor(quotation.id)).toEqual(expect.arrayContaining(["change_request.quotation_issued", "change_request.quotation_accepted"]));
    const afterAccept = await getChangeRequest(cr.id, customisation());
    expect(afterAccept.status).toBe("AWAITING_PAYMENT");
    expect(afterAccept.payment_demand_id).toBeTruthy();

    // Rule 6 — payment gate: blocked until the receipt clears it
    await expect(confirmPaymentGate(cr.id, customisation())).rejects.toThrow(/payment gate not satisfied/);
    const demand = (await mapDemands(`${DEMAND_SELECT} WHERE d.id = $1`, [afterAccept.payment_demand_id!]))[0]!;
    await postReceipt(demand.id, { amount: demand.remaining, mode: "neft" }, accounts());
    const gateConfirmed = await confirmPaymentGate(cr.id, customisation());
    expect(gateConfirmed.status).toBe("APPROVED");

    // Rule 7, 12 — release: spec revision, execution actions, change_request.created fired for
    // 06's (unwired) conditional-stage consumer — see release.ts's header for that gap.
    const released = await releaseChangeRequest(cr.id, customisation());
    expect(released.status).toBe("IN_PROGRESS");
    expect(released.spec_revision_id).toBeTruthy();
    const execRows = await db.query<{ action_id: string }>(`SELECT action_id FROM cr_execution_action WHERE cr_id = $1`, [cr.id]);
    expect(execRows.rows).toHaveLength(1);
    const createdEvt = await db.query(`SELECT id FROM event WHERE type = 'change_request.created' AND entity_id = $1`, [cr.id]);
    expect(createdEvt.rows).toHaveLength(1);
    expect(await eventTypesFor(cr.id)).toContain("change_request.released");

    // Rule 8 — execution closes -> READY_FOR_QA -> QA_VERIFIED -> CUSTOMER_ACCEPTED -> AS_BUILT_CLOSED
    const readyForQa = await closeExecutionAction(execRows.rows[0]!.action_id, "installed", site());
    expect(readyForQa.status).toBe("READY_FOR_QA");

    const insp = await startInspection(unitId, { component_code: "flooring", kind: "QA_VERIFICATION" }, qa());
    const passItems = insp.template!.items.map((i) => ({ code: i.code, result: "PASS" as const }));
    await setInspectionItems(insp.id, passItems, qa());
    for (const i of insp.template!.items) await addInspectionEvidence(insp.id, { item_code: i.code, kind: "PHOTO", content_type: "image/jpeg" }, qa());
    const passedInspection = await completeInspection(insp.id, qa());
    expect(passedInspection.status).toBe("PASSED");

    await linkQaInspection(cr.id, passedInspection.id, customisation());
    const qaVerified = await markQaVerified(cr.id, qa());
    expect(qaVerified.status).toBe("QA_VERIFIED");
    expect(await eventTypesFor(cr.id)).toContain("change_request.qa_verified");

    const customerAccepted = await customerAcceptCr(cr.id, crm());
    expect(customerAccepted.status).toBe("CUSTOMER_ACCEPTED");
    expect(await eventTypesFor(cr.id)).toContain("change_request.customer_accepted");

    const asBuilt = await asBuiltClose(cr.id, { as_built_items: { flooring_selection: { spec: "Italian marble upgrade", qty: 1 } } }, customisation());
    expect(asBuilt.status).toBe("AS_BUILT_CLOSED");
    expect(await eventTypesFor(cr.id)).toContain("change_request.as_built_closed");

    // Rule 10 — profitability: price - vendor cost - tax - waivers
    const economics = await getCrEconomics(cr.id, management());
    expect(economics.price_inr).toBe(150000);
    expect(economics.vendor_cost_inr).toBe(90000);
    expect(economics.tax_inr).toBeCloseTo(15000, 0);
    expect(economics.contribution_inr).toBeCloseTo(150000 - 90000 - 15000, 0);
  }, 40_000);
});

describe("rule 9 — withdrawal (pre-release) and cancellation (post-release, with abortive cost)", () => {
  it("customer/staff withdraw before release; MANAGEMENT cancels after release with a recorded abortive cost", async () => {
    const { bookingId } = await freshBooking();
    const cr = await raiseChangeRequest({ booking_id: bookingId, title: "Kitchen layout tweak", primary_category_code: "kitchen_layout", raised_by_kind: "CRM" }, crm());
    await expect(withdrawChangeRequest(cr.id, customisation())).resolves.toMatchObject({ status: "WITHDRAWN" });
    await expect(withdrawChangeRequest(cr.id, customisation())).rejects.toThrow(/can no longer be withdrawn/);

    const { bookingId: bookingId2 } = await freshBooking();
    const cr2 = await raiseChangeRequest({ booking_id: bookingId2, title: "Wardrobe addition", primary_category_code: "kitchen_layout", raised_by_kind: "CRM" }, crm());
    await recordFeasibility(cr2.id, { result: "FEASIBLE", technical_notes: "ok" }, site());
    await putCrItems(cr2.id, [{ category_code: "kitchen_layout", description: "Extra wardrobe unit", qty: 1, unit_price_inr: 20000, vendor_cost_inr: 12000 }], customisation());
    await setImpact(cr2.id, { cost_inr: 20000, schedule_days: 3, technical_risk: "LOW", handover_impact: "NONE", notes: "-" }, customisation());
    const submitted2 = await submitCrForApproval(cr2.id, customisation());
    expect(submitted2.status).toBe("AWAITING_CUSTOMER"); // below threshold, no approver
    const q = await issueQuotation(cr2.id, customisation());
    await acceptQuotation(q.id, { accepted_via: "SIGNED_COPY" }, crm());
    // Rule 6's other path: an explicit waiver instead of a receipt.
    const waived = await waivePayment(cr2.id, "goodwill gesture, no charge", management());
    expect(waived.status).toBe("APPROVED");
    expect(waived.payment_gate).toBe("WAIVED");
    expect(await eventTypesFor(cr2.id)).toContain("change_request.payment_waived");
    const released2 = await releaseChangeRequest(cr2.id, customisation());
    expect(released2.status).toBe("IN_PROGRESS");

    await expect(cancelChangeRequest(cr2.id, { reason: "customer changed their mind", abortive_cost_inr: 5000 }, customisation())).rejects.toThrow(/requires one of/);
    const cancelled = await cancelChangeRequest(cr2.id, { reason: "customer changed their mind", abortive_cost_inr: 5000 }, management());
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.abortive_cost_inr).toBe(5000);
    // Nothing was paid (the gate was waived), so no refund is raised.
    expect(cancelled.refund_raised).toBe(false);
    expect(await eventTypesFor(cr2.id)).toContain("change_request.cancelled");
  }, 40_000);
});

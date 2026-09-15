import { raiseChangeRequest, recordFeasibility } from "../change-requests/capture";
import { putCrItems, setImpact } from "../change-requests/costing";
import { submitCrForApproval } from "../change-requests/approvals";
import { createProspect } from "../sales/prospects";
import { requestHold, approveHold } from "../sales/holds";
import { evaluateUnit } from "../changeability/core";
import { todayIst } from "../authz/clock";
import { crm, customisation, sales, site } from "./occupants-ctx";
import { NISHA, TANVI } from "./occupants-phase2-ctx";
import { PROJECT_ID } from "./users";

// 2.3 Customisation desk row + 2.4 Sales prospect/hold + V101 vs V104 gates.
// Hold max_days is 14 (hold_policy default). Do not call scanHolds.

function daysAhead(n: number): string {
  return todayIst(new Date(Date.now() + n * 24 * 60 * 60 * 1000));
}

/** Kitchen CR on Nisha's accepted apartment. Stops at AWAITING_CUSTOMER (preferred).
 *  issueQuotation is omitted: it launches Chromium via pdf.render, and seed() runs
 *  inside every vitest file's initDb. */
export async function seedNishaChangeRequest(): Promise<void> {
  const cr = await raiseChangeRequest(
    {
      booking_id: NISHA.booking_id,
      title: "Kitchen island",
      summary: "Add an island with breakfast seating in the kitchen.",
      primary_category_code: "kitchen_layout",
      raised_by_kind: "CRM",
    },
    crm
  );
  await recordFeasibility(
    cr.id,
    { result: "FEASIBLE", technical_notes: "MEP not started; island fits the current layout." },
    site
  );
  await putCrItems(
    cr.id,
    [{ category_code: "kitchen_layout", description: "Island counter addition", qty: 1, unit_price_inr: 45000, vendor_cost_inr: 28000 }],
    customisation
  );
  await setImpact(
    cr.id,
    { cost_inr: 45000, schedule_days: 5, technical_risk: "LOW", handover_impact: "NONE", notes: "No handover impact." },
    customisation
  );
  await submitCrForApproval(cr.id, customisation);
}

export async function seedTanviProspectAndHold(): Promise<void> {
  const prospect = await createProspect(
    { project_id: PROJECT_ID, name: TANVI.name, phone: TANVI.phone, email: TANVI.email, source: "walk_in" },
    sales
  );
  const until = daysAhead(7);
  const hold = await requestHold(
    {
      unit_id: "u_v101",
      category_code: "kitchen_layout",
      prospect_id: prospect.id,
      reason: "Tanvi is deciding a kitchen layout on V101 before booking.",
      requested_until: until,
    },
    sales
  );
  await approveHold(hold.id, { approved_until: until, note: "Window held for kitchen layout." }, site);
  await evaluateUnit("u_v101", { trigger: "seed_phase2" });
  await evaluateUnit("u_v104", { trigger: "seed_phase2" });
}

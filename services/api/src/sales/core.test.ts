import { describe, it, expect, beforeAll } from "vitest";
import { initDb, db } from "../db";
import { superAdminCtx as fakeSuperAdminCtx, ctxWithRoles } from "../authz/test-helpers";
import { createProject, createUnit } from "../projects";
import { updateProgress, previewBulkUpdate } from "../progress/core";
import { evaluateUnit } from "../changeability/core";
import { claimAction, startAction, submitForApproval, approveAction } from "../actions/core";
import { createApprovalRule } from "../approvals/matrix";
import { appendEvent, withTx } from "../events";
import type { Ctx } from "../authz/types";
import { listInventory, compareUnits } from "./inventory";
import { createProspect, putNeeds, getMatches, markProspectLost, lostRequirementAnalytics } from "./prospects";
import { requestHold, approveHold, rejectHold, releaseHold, scanHolds } from "./holds";
import { bookFromInventory, confirmInventoryBooking } from "./booking";

// 24-sales-inventory-discovery.md — integration over real 04/07/08/14 data. Rule 4 (the pure
// match) is in match.test.ts. Real seeded demo users (seed/users.ts).
const superAdminCtx: Ctx = { actor: { ...fakeSuperAdminCtx.actor, user_id: "user_superadmin" } };
function ctxAs(userId: string, roles: string[]): Ctx {
  return { actor: { ...ctxWithRoles(roles).actor, user_id: userId } };
}
const sales = () => ctxAs("user_sales", ["SALES"]);
const site = () => ctxAs("user_site", ["SITE"]);
const management = () => ctxAs("user_management", ["MANAGEMENT"]);
const DAY = 24 * 60 * 60 * 1000;
const isoDay = (offsetDays: number) => new Date(Date.now() + 5.5 * 60 * 60 * 1000 + offsetDays * DAY).toISOString().slice(0, 10);

let PROJECT_ID: string;
let unitSeq = 0;

beforeAll(async () => {
  await initDb();
  const p = await createProject({ code: "salestest", name: "Sales Test Project" }, superAdminCtx);
  PROJECT_ID = p.id;
  await db.query(`UPDATE project SET planned_handover_date = '2027-06-30' WHERE id = $1`, [PROJECT_ID]);
  await db.query(`INSERT INTO handover_policy (project_id, readiness_threshold, minor_snag_max, dlp_months, checkin_days) VALUES ($1, 80, 2, 12, '7,30,90') ON CONFLICT (project_id) DO NOTHING`, [PROJECT_ID]);
});

async function freshUnit(price = 10_000_000): Promise<string> {
  unitSeq += 1;
  const u = await createUnit(PROJECT_ID, { unit_number: `S-${String(unitSeq).padStart(2, "0")}`, unit_type: "3BHK", facing: "East", base_price_inr: price }, superAdminCtx);
  return u!.id;
}

const gateOf = async (unitId: string, category: string) => (await evaluateUnit(unitId, { trigger: "read" })).gates.find((g) => g.category_code === category)!;

describe("rules 1 + 2 — inventory filters map to gate states; chips carry freshness", () => {
  it("named filters, construction %, possession window, closing-soon and Verification Required display", async () => {
    const open = await freshUnit(9_000_000);
    const closed = await freshUnit(12_000_000);
    const closing = await freshUnit(11_000_000);
    const stale = await freshUnit(10_500_000);
    await updateProgress(closed, "mep_first_fix", { state_code: "COMPLETE" }, site());
    await db.query(`UPDATE unit_progress SET planned_next_event = 'Flooring start', planned_next_event_date = $2 WHERE unit_id = $1 AND component_code = 'flooring'`, [closing, isoDay(5)]);
    await updateProgress(stale, "mep_first_fix", { state_code: "IN_PROGRESS" }, site());
    await db.query(`UPDATE unit_progress SET updated_at = now() - interval '40 days' WHERE unit_id = $1 AND component_code = 'mep_first_fix'`, [stale]);

    const all = await listInventory(PROJECT_ID, {}, sales());
    const byId = new Map(all.map((u) => [u.unit_id, u]));
    expect(byId.get(open)!.filters.sort()).toEqual(["electrical_open", "flooring_open", "highly_customisable", "kitchen_open", "layout_flexible"]);
    expect(byId.get(open)).toMatchObject({ construction_pct: 0, sale_status: "AVAILABLE", price_inr: 9_000_000, freshness: "FRESH", ready_to_move: false });
    expect(byId.get(open)!.expected_possession_window).toMatchObject({ anchor: "2027-06-30", confidence: "LOW", from: "2027-03-30", to: "2027-09-30" });
    expect(byId.get(closed)).toMatchObject({ construction_pct: 25, closing_soon: false });
    expect(byId.get(closed)!.filters).not.toContain("kitchen_open");
    expect(byId.get(closed)!.flexibility.value).toBe(33);
    expect(byId.get(closing)!.filters).toContain("closing_soon");
    expect(byId.get(closing)!.gates.find((g) => g.category_code === "flooring_selection")).toMatchObject({ state: "CLOSING", expected_close_at: isoDay(5) });
    const staleChip = byId.get(stale)!.gates.find((g) => g.category_code === "electrical")!;
    expect(staleChip).toMatchObject({ state: "CLOSING", display_state: "VERIFICATION_REQUIRED", freshness_status: "VERIFICATION_REQUIRED" });
    expect(staleChip.source_at).toBeTruthy();
    expect(byId.get(stale)!.freshness).toBe("VERIFICATION_REQUIRED");

    const kitchenOpen = await listInventory(PROJECT_ID, { named: ["kitchen_open"] }, sales());
    expect(kitchenOpen.map((u) => u.unit_id)).not.toContain(closed);
    // Both the forecast-CLOSING unit and the in_progress-CLOSING (stale) one count — a CLOSING gate with
    // no forecast date is still closing, date unknown.
    const closingOnly = await listInventory(PROJECT_ID, { named: ["closing_soon"] }, sales());
    expect(closingOnly.map((u) => u.unit_id).sort()).toEqual([closing, stale].sort());
    const byPrice = await listInventory(PROJECT_ID, { sort: "price", max_price: 11_000_000 }, sales());
    expect(byPrice.map((u) => u.price_inr)).toEqual([9_000_000, 10_500_000, 11_000_000]);
  });
});

describe("rule 3 — compare ≥ 3 units, with the requirement match when a prospect is chosen", () => {
  it("rejects 2 units, returns 3 side by side with match + disclaimer", async () => {
    const [a, b, c] = [await freshUnit(), await freshUnit(), await freshUnit()];
    await updateProgress(b, "structure", { state_code: "COMPLETE" }, site());
    await expect(compareUnits([a, b], undefined, sales())).rejects.toThrow(/3 or 4 distinct units/);
    const p = await createProspect({ project_id: PROJECT_ID, name: "Anita Rao", source: "walk-in" }, sales());
    await putNeeds(p.id, [{ category_code: "structural", importance: "MUST_HAVE" }, { category_code: "kitchen_layout", importance: "PREFERRED" }], sales());
    const cmp = await compareUnits([a, b, c], p.id, sales());
    expect(cmp.units).toHaveLength(3);
    expect(cmp.disclaimer).toBe("Compatibility reflects current site status and is not an engineering approval.");
    expect(cmp.units.find((u) => u.unit_id === a)!.match!.score).toBe(100);
    expect(cmp.units.find((u) => u.unit_id === b)!.match).toMatchObject({ score: 25, explanation: expect.arrayContaining([expect.objectContaining({ category: "structural", verdict: "NOT_POSSIBLE" })]) });
    expect((await compareUnits([a, b, c], undefined, sales())).disclaimer).toBeNull();
  });
});

describe("rule 5 — matches recompute on gate changes and go stale past the threshold", () => {
  it("a 07 progress write → gate.state_changed → stored match updated for the active prospect", async () => {
    const unitId = await freshUnit();
    const p = await createProspect({ project_id: PROJECT_ID, name: "Rohit Menon" }, sales());
    await putNeeds(p.id, [{ category_code: "kitchen_layout", importance: "MUST_HAVE" }, { category_code: "electrical", importance: "PREFERRED" }], sales());
    const first = await getMatches(p.id, [unitId], sales());
    expect(first[0]).toMatchObject({ unit_id: unitId, score: 100, freshness: "FRESH" });

    await updateProgress(unitId, "mep_first_fix", { state_code: "IN_PROGRESS" }, site());
    const stored = await getMatches(p.id, undefined, sales());
    expect(stored[0]).toMatchObject({ unit_id: unitId, score: 56 }); // (3×0.5 + 1×0.75) / 4
    expect((await db.query(`SELECT id FROM event WHERE type = 'match.computed' AND entity_id = $1`, [p.id])).rows.length).toBeGreaterThanOrEqual(2);
    expect((await db.query(`SELECT id FROM event_delivery_failure WHERE subscriber = 'sales.recompute_matches'`)).rows).toHaveLength(0);

    await db.query(`UPDATE unit_requirement_match SET computed_at = now() - interval '48 hours' WHERE prospect_id = $1`, [p.id]);
    expect((await getMatches(p.id, undefined, sales()))[0]!.freshness).toBe("STALE");
  });
});

describe("rule 6 + rule 7 — Change Window Hold: policy-bound, Project-approved, holds the gate, auto-expires; Sales never writes physics", () => {
  it("request → approve keeps the gate from closing; bulk preview flags the unit; expiry releases it; reject/release paths", async () => {
    const unitId = await freshUnit();
    const p = await createProspect({ project_id: PROJECT_ID, name: "Divya S" }, sales());
    await expect(requestHold({ unit_id: unitId, category_code: "kitchen_layout", prospect_id: p.id, reason: "finalising kitchen", requested_until: isoDay(30) }, sales())).rejects.toThrow(/at most 14 days/);
    await expect(requestHold({ unit_id: unitId, category_code: "kitchen_layout", prospect_id: p.id, reason: "", requested_until: isoDay(7) }, sales())).rejects.toThrow(/reason/);
    const hold = await requestHold({ unit_id: unitId, category_code: "kitchen_layout", prospect_id: p.id, reason: "finalising kitchen", requested_until: isoDay(7) }, sales());
    expect(hold).toMatchObject({ status: "REQUESTED", requested_by: "user_sales" });
    expect(hold.code).toMatch(/^HLD-/);
    expect((await db.query(`SELECT id FROM event WHERE type = 'hold.requested' AND entity_id = $1`, [hold.id])).rows).toHaveLength(1);
    await expect(approveHold(hold.id, {}, sales())).rejects.toThrow(/require the SITE role/);
    await expect(approveHold(hold.id, { approved_until: isoDay(10) }, site())).rejects.toThrow(/cannot exceed/);
    const approved = await approveHold(hold.id, { note: "ok until the slab" }, site());
    expect(approved).toMatchObject({ status: "APPROVED", approved_by: "user_site", approved_until: isoDay(7) });
    expect((await db.query(`SELECT id FROM event WHERE type = 'hold.approved' AND entity_id = $1`, [hold.id])).rows).toHaveLength(1);
    await expect(requestHold({ unit_id: unitId, category_code: "kitchen_layout", reason: "again", requested_until: isoDay(3) }, sales())).rejects.toThrow(/already exists/);

    // Rule 7: Sales is read-only on physics.
    await expect(updateProgress(unitId, "mep_first_fix", { state_code: "COMPLETE" }, sales())).rejects.toThrow(/WRITE/);

    // 07's bulk preview shows the held unit as an exception before anything moves.
    const preview = await previewBulkUpdate(PROJECT_ID, { scope: { unit_ids: [unitId] }, component_code: "mep_first_fix", new_state: "COMPLETE" }, site());
    expect(preview.units[0]).toMatchObject({ unit_id: unitId, held: true });

    await updateProgress(unitId, "mep_first_fix", { state_code: "COMPLETE" }, site());
    expect(await gateOf(unitId, "kitchen_layout")).toMatchObject({ state: "OPEN", reason_code: "HOLD", reason_text: expect.stringMatching(/held for a prospect until .* would otherwise be EXCEPTION_ONLY/) });
    expect((await gateOf(unitId, "electrical")).state).toBe("EXCEPTION_ONLY"); // only the held category is protected
    const inv = await listInventory(PROJECT_ID, {}, sales());
    expect(inv.find((u) => u.unit_id === unitId)!.gates.find((g) => g.category_code === "kitchen_layout")!.held_until).toBe(isoDay(7));

    const scan = await scanHolds(isoDay(8));
    expect(scan.expired).toContain(hold.id);
    expect((await db.query<{ status: string }>(`SELECT status FROM change_window_hold WHERE id = $1`, [hold.id])).rows[0]!.status).toBe("EXPIRED");
    expect((await db.query(`SELECT id FROM event WHERE type = 'hold.expired' AND entity_id = $1`, [hold.id])).rows).toHaveLength(1);
    expect((await gateOf(unitId, "kitchen_layout")).state).toBe("EXCEPTION_ONLY");

    const other = await freshUnit();
    const rej = await requestHold({ unit_id: other, category_code: "electrical", reason: "maybe", requested_until: isoDay(5) }, sales());
    expect((await rejectHold(rej.id, "no capacity", site())).status).toBe("REJECTED");
    expect((await db.query(`SELECT id FROM event WHERE type = 'hold.rejected' AND entity_id = $1`, [rej.id])).rows).toHaveLength(1);
    const rel = await requestHold({ unit_id: other, category_code: "electrical", reason: "retry", requested_until: isoDay(5) }, sales());
    await approveHold(rel.id, {}, site());
    await expect(releaseHold(rel.id, "", sales())).rejects.toThrow(/reason/);
    expect((await releaseHold(rel.id, "prospect went cold", sales())).status).toBe("RELEASED");
    expect((await db.query(`SELECT id FROM event WHERE type = 'hold.released' AND entity_id = $1`, [rel.id])).rows).toHaveLength(1);
  });
});

describe("rule 8 — booking from inventory", () => {
  it("DRAFT with applicants (residency), discount approval, copied needs, consumed hold; CONFIRMED on approval + explicit confirm, or on booking-amount receipt", async () => {
    const unitId = await freshUnit(12_000_000);
    const p = await createProspect({ project_id: PROJECT_ID, name: "Karthik & Meera" }, sales());
    await putNeeds(p.id, [{ category_code: "kitchen_layout", importance: "MUST_HAVE", note: "island" }], sales());
    const hold = await requestHold({ unit_id: unitId, category_code: "kitchen_layout", prospect_id: p.id, reason: "deciding", requested_until: isoDay(7) }, sales());
    await approveHold(hold.id, {}, site());
    await createApprovalRule({ domain: "DISCOUNT", metric: "INR", min: 1, max: null, approver_role: "MANAGEMENT", effective_from: "2020-01-01" }, superAdminCtx);

    const applicants = [
      { display_name: "Karthik Iyer", phone: "9845011122", pan: "ABCDE1234F", residency: "RESIDENT" as const },
      { display_name: "Meera Iyer", residency: "NRI" as const, role: "CO_APPLICANT" as const },
    ];
    await expect(bookFromInventory(p.id, { unit_id: unitId, applicants: [], price_inr: 12_000_000 }, sales())).rejects.toThrow(/at least one applicant/);
    await expect(bookFromInventory(p.id, { unit_id: unitId, applicants: [{ ...applicants[0]!, residency: "ALIEN" as never }], price_inr: 12_000_000 }, sales())).rejects.toThrow(/residency/);
    await expect(bookFromInventory(p.id, { unit_id: unitId, applicants, price_inr: 12_000_000 }, site())).rejects.toThrow(/WRITE/); // SITE holds NONE on sales_handover (CRM holds WRITE)

    const b = await bookFromInventory(p.id, { unit_id: unitId, applicants, price_inr: 12_000_000, discount_inr: 300_000, booking_amount_inr: 1_000_000 }, sales());
    expect(b).toMatchObject({ status: "DRAFT", agreement_value_inr: 11_700_000, discount_inr: 300_000, consumed_hold_ids: [hold.id] });
    expect(b.code).toMatch(/^BKG-/);
    expect(b.approval_action_id).toBeTruthy();
    expect(b.personalisation_context).toEqual([{ category_code: "kitchen_layout", importance: "MUST_HAVE", note: "island" }]);
    const row = await db.query<{ status: string; prospect_id: string; sales_owner_user_id: string; booking_amount_inr: number }>(`SELECT status, prospect_id, sales_owner_user_id, booking_amount_inr::float8 AS booking_amount_inr FROM booking WHERE id = $1`, [b.booking_id]);
    expect(row.rows[0]).toEqual({ status: "draft", prospect_id: p.id, sales_owner_user_id: "user_sales", booking_amount_inr: 1_000_000 });
    const custs = await db.query<{ display_name: string; residency: string; role: string }>(
      `SELECT c.display_name, c.residency, a.role FROM booking_applicant a JOIN customer c ON c.id = a.customer_id WHERE a.booking_id = $1 ORDER BY a.sort_order`, [b.booking_id]
    );
    expect(custs.rows).toEqual([{ display_name: "Karthik Iyer", residency: "RESIDENT", role: "primary" }, { display_name: "Meera Iyer", residency: "NRI", role: "CO_APPLICANT" }]);
    expect((await db.query<{ status: string; customer_id: string | null }>(`SELECT status, customer_id FROM prospect WHERE id = $1`, [p.id])).rows[0]).toMatchObject({ status: "BOOKED", customer_id: expect.any(String) });
    expect((await db.query<{ sale_status: string }>(`SELECT sale_status FROM unit WHERE id = $1`, [unitId])).rows[0]!.sale_status).toBe("held");
    expect((await db.query<{ status: string }>(`SELECT status FROM change_window_hold WHERE id = $1`, [hold.id])).rows[0]!.status).toBe("CONSUMED");
    expect((await db.query(`SELECT id FROM event WHERE type = 'hold.consumed' AND entity_id = $1`, [hold.id])).rows).toHaveLength(1);

    // Unit now held by a booking, not by another prospect → refused for anyone else.
    const p2 = await createProspect({ project_id: PROJECT_ID, name: "Someone Else" }, sales());
    await expect(bookFromInventory(p2.id, { unit_id: unitId, applicants, price_inr: 12_000_000 }, sales())).rejects.toThrow(/HELD and not held by this prospect/);

    await expect(confirmInventoryBooking(b.booking_id, sales())).rejects.toThrow(/discount approval pending/);
    await claimAction(b.approval_action_id!, management());
    await startAction(b.approval_action_id!, management());
    await submitForApproval(b.approval_action_id!, management());
    await approveAction(b.approval_action_id!, undefined, superAdminCtx);
    expect((await confirmInventoryBooking(b.booking_id, sales())).status).toBe("CONFIRMED");
    expect((await db.query<{ status: string }>(`SELECT status FROM booking WHERE id = $1`, [b.booking_id])).rows[0]!.status).toBe("confirmed");

    // No discount → no approval; the booking-amount receipt confirms it through the subscriber.
    const unit2 = await freshUnit();
    const b2 = await bookFromInventory(p2.id, { unit_id: unit2, applicants: [applicants[0]!], price_inr: 10_000_000 }, sales());
    expect(b2.approval_action_id).toBeNull();
    await withTx(undefined, (tx) => appendEvent(tx, { type: "payment.received", entity_type: "receipt", entity_id: "rcpt_test_24", project_id: PROJECT_ID, booking_id: b2.booking_id, payload: { amount: 1_000_000 } }));
    expect((await db.query<{ status: string }>(`SELECT status FROM booking WHERE id = $1`, [b2.booking_id])).rows[0]!.status).toBe("confirmed");
    expect((await db.query(`SELECT id FROM event_delivery_failure WHERE subscriber = 'sales.confirm_on_receipt'`)).rows).toHaveLength(0);
  });
});

describe("rule 9 — lost prospects keep their needs for analytics", () => {
  it("marks LOST with a reason and reports which requirements lose deals", async () => {
    const p = await createProspect({ project_id: PROJECT_ID, name: "Lost Lead" }, sales());
    expect(p.code).toMatch(/^PRS-/);
    expect((await db.query<{ payload: Record<string, unknown> }>(`SELECT payload FROM event WHERE type = 'prospect.created' AND entity_id = $1`, [p.id])).rows[0]!.payload).toMatchObject({ code: p.code });
    await putNeeds(p.id, [{ category_code: "structural", importance: "MUST_HAVE" }], sales());
    expect((await db.query<{ payload: Record<string, unknown> }>(`SELECT payload FROM event WHERE type = 'need.captured' AND entity_id = $1`, [p.id])).rows[0]!.payload).toEqual({ needs: ["structural:MUST_HAVE"] });
    await expect(markProspectLost(p.id, "", sales())).rejects.toThrow(/reason/);
    expect((await markProspectLost(p.id, "wanted a structural change we can't offer", sales())).status).toBe("LOST");
    expect((await db.query(`SELECT id FROM prospect_personalisation_need WHERE prospect_id = $1`, [p.id])).rows).toHaveLength(1);
    const a = await lostRequirementAnalytics(PROJECT_ID, management());
    expect(a.prospects.lost).toBeGreaterThanOrEqual(1);
    expect(a.by_requirement.find((r) => r.category_code === "structural" && r.importance === "MUST_HAVE")).toMatchObject({ lost: 1 });
  });
});

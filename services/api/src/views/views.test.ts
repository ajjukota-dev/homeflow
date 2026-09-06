import { describe, it, expect, beforeAll } from "vitest";
import { initDb } from "../db";
import { getUnit360, getUnitActivity } from "./unit-360";
import { getCustomer360, getCustomerDocuments, getCustomerActivity } from "./customer-360";
import { getBooking360, getBookingActivity } from "./booking-360";
import { getProjectHeader } from "./project-header";
import { getMyContext, setMyContext } from "./context";
import { ctxWithRoles, superAdminCtx as fakeSuperAdminCtx } from "../authz/test-helpers";
import type { Ctx } from "../authz/types";

// 28-360-views.md rules 1-6.

beforeAll(async () => {
  await initDb();
});

// `PUT /me/context`'s `user_preference.user_id` FKs a real "user" row — same convention
// commitments/core.test.ts and 27's management.test.ts already established.
const realSuperAdminCtx: Ctx = { actor: { ...fakeSuperAdminCtx.actor, user_id: "user_superadmin" } };

describe("28 rule 1 — Unit 360", () => {
  it("returns the Overview payload with hierarchy path, readiness, flexibility and current booking", async () => {
    const view = await getUnit360("u_v110", fakeSuperAdminCtx);
    expect(view.unit_number).toBeTruthy();
    expect(view.hierarchy_path.length).toBeGreaterThan(0);
    expect(view.readiness).toHaveProperty("value");
    expect(view.flexibility).toHaveProperty("value");
    expect(view.current_booking?.id).toBeTruthy();
    expect(view.tabs.length).toBeGreaterThan(0);
    expect(view.tabs.find((t) => t.key === "changeability")?.available).toBe(true);
  });

  it("throws not_found for an unknown unit", async () => {
    await expect(getUnit360("does-not-exist", fakeSuperAdminCtx)).rejects.toThrow("not_found");
  });

  it("returns this unit's own activity slice", async () => {
    const activity = await getUnitActivity("u_v110", fakeSuperAdminCtx);
    expect(Array.isArray(activity)).toBe(true);
  });
});

describe("28 rule 2 — Customer 360", () => {
  it("returns profile, bookings, commitments, change requests and a derived health score", async () => {
    const view = await getCustomer360("c_karthik", fakeSuperAdminCtx);
    expect(view.display_name).toBe("Karthik Iyer");
    expect(view.bookings.some((b) => b.booking_number)).toBe(true);
    expect(Array.isArray(view.commitments)).toBe(true);
    expect(Array.isArray(view.change_requests)).toBe(true);
    expect(view.health.score).toBeGreaterThanOrEqual(0);
    expect(view.health.score).toBeLessThanOrEqual(100);
    // 29 (communications) has since landed — the tab is real now, not a placeholder.
    expect(view.tabs.find((t) => t.key === "communications")?.available).toBe(true);
    expect(view.tabs.find((t) => t.key === "communications")?.api).toBe("/api/customers/c_karthik/communications");
  });

  it("a customer with an overdue demand scores lower than one without", async () => {
    // b_v110's d_v110_3 is seeded overdue (see seed.ts) — Karthik's health score must reflect it.
    const karthik = await getCustomer360("c_karthik", fakeSuperAdminCtx);
    const overdueDriver = karthik.health.drivers.find((d) => d.label.includes("overdue"));
    expect(overdueDriver?.delta).toBeLessThan(0);
  });

  it("lists KYC documents and activity for a customer", async () => {
    const docs = await getCustomerDocuments("c_karthik", fakeSuperAdminCtx);
    expect(Array.isArray(docs)).toBe(true);
    const activity = await getCustomerActivity("c_karthik", fakeSuperAdminCtx);
    expect(Array.isArray(activity)).toBe(true);
  });

  it("blocks a role the customer_overview/customer_documents matrix locks out", async () => {
    // permission_matrix: SITE is READ_LIMITED (below READ) on customer_overview, and NONE on
    // customer_documents — a role STAFF_ROLES would have let straight through.
    await expect(getCustomer360("c_karthik", ctxWithRoles(["SITE"]))).rejects.toThrow(/forbidden|requires/);
    await expect(getCustomerDocuments("c_karthik", ctxWithRoles(["SITE"]))).rejects.toThrow(/forbidden|requires/);
  });
});

describe("28 rule 3 — Booking 360", () => {
  it("returns overview, both readiness scores, next actions and a tab manifest", async () => {
    const view = await getBooking360("b_v110", fakeSuperAdminCtx);
    expect(view.booking_number).toBeTruthy();
    expect(view.unit?.unit_number).toBeTruthy();
    expect(view.customer?.display_name).toBe("Karthik Iyer");
    expect(view.booking_readiness).toHaveProperty("value");
    expect(view.handover_readiness).toHaveProperty("value");
    expect(Array.isArray(view.next_actions)).toBe(true);
    // 29 (communications) has since landed — the tab is real now, not a placeholder.
    expect(view.tabs.find((t) => t.key === "communications")?.available).toBe(true);
    expect(view.tabs.find((t) => t.key === "handover")?.api).toBe("/api/bookings/b_v110/handover");
  });

  it("returns this booking's own activity slice", async () => {
    const activity = await getBookingActivity("b_v110", fakeSuperAdminCtx);
    expect(Array.isArray(activity)).toBe(true);
  });
});

describe("28 rule 4 — Project 360 header", () => {
  it("returns real portfolio figures: product mix, true-risk, escalations, readiness average", async () => {
    const header = await getProjectHeader("p_eastcrest", fakeSuperAdminCtx);
    expect(header.name).toBeTruthy();
    expect(header.product_mix.length).toBeGreaterThan(0);
    expect(header.units_total).toBe(header.units_sold + header.units_available);
    expect(typeof header.true_risk_inr).toBe("number");
    expect(header.open_material_escalations).toBeGreaterThanOrEqual(0);
    expect(header.unit_readiness_avg).not.toBeNull();
    expect(header.handovers_due_30d).toBeNull(); // flagged gap, not guessed — no handover-stage forecast date exists
  });

  it("only surfaces the forecast figures to a role with forecast read access", async () => {
    const salesHeader = await getProjectHeader("p_eastcrest", ctxWithRoles(["SALES"]));
    expect(salesHeader.next_month_forecast_inr).toBeNull();
    const managementHeader = await getProjectHeader("p_eastcrest", ctxWithRoles(["MANAGEMENT"]));
    expect(typeof managementHeader.next_month_forecast_inr).toBe("number");
    expect(typeof managementHeader.actual_to_date_inr).toBe("number");
  });
});

describe("28 rule 4 — context retention (PUT/GET /me/context)", () => {
  it("round-trips the last project + entity across calls", async () => {
    const before = await getMyContext(realSuperAdminCtx);
    expect(before.last_project_id).toBeNull();
    const after = await setMyContext(realSuperAdminCtx, { project_id: "p_eastcrest", entity_type: "unit", entity_id: "u_v110" });
    expect(after.last_project_id).toBe("p_eastcrest");
    expect(after.last_entity_id).toBe("u_v110");
    const fetched = await getMyContext(realSuperAdminCtx);
    expect(fetched).toEqual(after);
  });

  it("a partial update only overwrites the fields given", async () => {
    await setMyContext(realSuperAdminCtx, { project_id: "p_eastcrest", entity_type: "unit", entity_id: "u_v110" });
    const updated = await setMyContext(realSuperAdminCtx, { entity_type: "booking", entity_id: "b_v110" });
    expect(updated.last_project_id).toBe("p_eastcrest"); // unchanged
    expect(updated.last_entity_type).toBe("booking");
    expect(updated.last_entity_id).toBe("b_v110");
  });
});

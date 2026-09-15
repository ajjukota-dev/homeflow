import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll } from "vitest";
import { initDb, db } from "./db";
import { getBooking360 } from "./views/booking-360";
import { getUnit360 } from "./views/unit-360";
import { getOverview, getRequests } from "./portal/core";
import { evaluateUnit } from "./changeability/core";
import { releaseChangeRequest } from "./change-requests/release";
import { superAdminCtx as fakeSuperAdminCtx, customerCtx } from "./authz/test-helpers";
import type { Ctx } from "./authz/types";
import { customisation } from "./seed/occupants-ctx";

// Phase 2: Packets / Customisation / Sales / Meadows via handlers, not INSERT INTO booking.

const sa: Ctx = { actor: { ...fakeSuperAdminCtx.actor, user_id: "user_superadmin" } };

const PHASE2_SEED_FILES = [
  "seed.ts", "seed/occupants-via-handlers.ts", "seed/occupants-book.ts", "seed/occupants-ctx.ts",
  "seed/occupants-phase2.ts", "seed/occupants-phase2-ctx.ts", "seed/occupants-phase2-desk.ts", "seed/users.ts",
];

beforeAll(async () => {
  await initDb();
}, 120_000);

async function unitId(unitNumber: string): Promise<string> {
  const r = await db.query<{ id: string }>(`SELECT id FROM unit WHERE unit_number = $1`, [unitNumber]);
  expect(r.rows[0], unitNumber).toBeTruthy();
  return r.rows[0].id;
}

describe("Phase 2 occupants via handlers (seed)", () => {
  it("e2-sql: seed files do not INSERT INTO booking / journey_instance / change_request / change_window_hold / prospect", () => {
    for (const rel of PHASE2_SEED_FILES) {
      const src = readFileSync(new URL("./" + rel, import.meta.url), "utf8");
      expect(src, rel).not.toMatch(/INSERT INTO booking\b/i);
      expect(src, rel).not.toMatch(/INSERT INTO journey_instance\b/i);
      expect(src, rel).not.toMatch(/INSERT INTO change_request\b/i);
      expect(src, rel).not.toMatch(/INSERT INTO change_window_hold\b/i);
      expect(src, rel).not.toMatch(/INSERT INTO prospect\b/i);
    }
  });

  it("2.1 BK-MV01 exists, handover submitted, no journey_instance", async () => {
    const b = await db.query<{ id: string; status: string }>(
      `SELECT id, status FROM booking WHERE booking_number = 'BK-MV01'`
    );
    expect(b.rows[0], "BK-MV01").toBeTruthy();
    expect(b.rows[0].id).toBe("b_mv01");
    const sh = await db.query<{ status: string }>(`SELECT status FROM sales_handover WHERE booking_id = 'b_mv01'`);
    expect(sh.rows[0]?.status).toBe("SUBMITTED");
    const j = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM journey_instance WHERE booking_id = 'b_mv01'`
    );
    expect(j.rows[0].n).toBe(0);
    const applicant = await db.query<{ display_name: string }>(
      `SELECT display_name FROM booking_applicant WHERE booking_id = 'b_mv01' AND role = 'primary'`
    );
    expect(applicant.rows[0]?.display_name).toBe("Aditi Bansal");
    const unit = await db.query<{ unit_number: string }>(
      `SELECT u.unit_number FROM booking b JOIN unit u ON u.id = b.unit_id WHERE b.id = 'b_mv01'`
    );
    expect(unit.rows[0]?.unit_number).toBe("MV-01");
  });

  it("2.2 BK-MV02 exists, handover returned, reason non-empty, not deleted", async () => {
    const b = await db.query<{ id: string; status: string }>(
      `SELECT id, status FROM booking WHERE booking_number = 'BK-MV02'`
    );
    expect(b.rows[0], "BK-MV02").toBeTruthy();
    expect(b.rows[0].status).toBe("returned");
    const sh = await db.query<{ status: string; return_reason_code: string | null; return_note: string | null }>(
      `SELECT status, return_reason_code, return_note FROM sales_handover WHERE booking_id = 'b_mv02'`
    );
    expect(sh.rows[0]?.status).toBe("RETURNED");
    expect(sh.rows[0]?.return_reason_code).toBeTruthy();
    expect(sh.rows[0]?.return_note).toBeTruthy();
    const j = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM journey_instance WHERE booking_id = 'b_mv02'`
    );
    expect(j.rows[0].n).toBe(0);
    const applicant = await db.query<{ display_name: string }>(
      `SELECT display_name FROM booking_applicant WHERE booking_id = 'b_mv02' AND role = 'primary'`
    );
    expect(applicant.rows[0]?.display_name).toBe("Harish Patel");
  });

  it("2.3 Nisha / BK-MT201 has a change_request at AWAITING_CUSTOMER; release fails without payment", async () => {
    const cr = await db.query<{ id: string; status: string }>(
      `SELECT id, status FROM change_request WHERE booking_id = 'b_mt201'`
    );
    expect(cr.rows[0], "Nisha CR").toBeTruthy();
    expect(cr.rows[0].status).toBe("AWAITING_CUSTOMER");
    await expect(releaseChangeRequest(cr.rows[0].id, customisation)).rejects.toThrow();
  });

  it("2.4 Tanvi Joshi prospect, APPROVED hold on u_v101 with future approved_until; V101 vs V104 gates differ", async () => {
    const p = await db.query<{ id: string; name: string }>(`SELECT id, name FROM prospect WHERE name = 'Tanvi Joshi'`);
    expect(p.rows[0], "Tanvi Joshi").toBeTruthy();
    const hold = await db.query<{ status: string; approved_until: string; category_code: string; unit_id: string }>(
      `SELECT status, approved_until::text AS approved_until, category_code, unit_id
         FROM change_window_hold WHERE prospect_id = $1`,
      [p.rows[0].id]
    );
    expect(hold.rows[0]?.status).toBe("APPROVED");
    expect(hold.rows[0]?.unit_id).toBe("u_v101");
    expect(hold.rows[0]?.category_code).toBe("kitchen_layout");
    expect(hold.rows[0]?.approved_until).toBeTruthy();
    expect(new Date(hold.rows[0].approved_until).getTime()).toBeGreaterThan(Date.now() - 24 * 60 * 60 * 1000);

    const bookedSpare = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM booking WHERE unit_id IN ('u_v101','u_v104','u_v108')`
    );
    expect(bookedSpare.rows[0].n).toBe(0);

    const v101 = await evaluateUnit("u_v101", { trigger: "phase2_assert" });
    const v104 = await evaluateUnit("u_v104", { trigger: "phase2_assert" });
    const k101 = v101.gates.find((g) => g.category_code === "kitchen_layout");
    const k104 = v104.gates.find((g) => g.category_code === "kitchen_layout");
    const s104 = v104.gates.find((g) => g.category_code === "structural");
    expect(k101?.state).toBe("OPEN");
    expect(k104?.state).toBe("EXCEPTION_ONLY");
    expect(s104?.state).toBe("HARD_CLOSED");
    expect(v104.gates.find((g) => g.category_code === "electrical")?.state).toBe("EXCEPTION_ONLY");
    expect(v104.gates.find((g) => g.category_code === "flooring_selection")?.state).toBe("EXCEPTION_ONLY");
  });

  it("2.5 Meadows APARTMENT MT1-201 and PLOT MP-01 bookings each have a journey_instance", async () => {
    const apt = await db.query<{ id: string; product_type: string; unit_number: string }>(
      `SELECT b.id, u.product_type, u.unit_number FROM booking b JOIN unit u ON u.id = b.unit_id
        WHERE b.booking_number = 'BK-MT201'`
    );
    expect(apt.rows[0], "BK-MT201").toBeTruthy();
    expect(apt.rows[0].id).toBe("b_mt201");
    expect(apt.rows[0].product_type).toBe("APARTMENT");
    expect(apt.rows[0].unit_number).toBe("MT1-201");
    const plot = await db.query<{ id: string; product_type: string; unit_number: string }>(
      `SELECT b.id, u.product_type, u.unit_number FROM booking b JOIN unit u ON u.id = b.unit_id
        WHERE b.booking_number = 'BK-MP01'`
    );
    expect(plot.rows[0], "BK-MP01").toBeTruthy();
    expect(plot.rows[0].id).toBe("b_mp01");
    expect(plot.rows[0].product_type).toBe("PLOT");
    expect(plot.rows[0].unit_number).toBe("MP-01");
    for (const id of ["b_mt201", "b_mp01"]) {
      const j = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM journey_instance WHERE booking_id = $1`, [id]);
      expect(j.rows[0].n, id).toBe(1);
    }
    const nisha = await db.query<{ display_name: string }>(
      `SELECT display_name FROM booking_applicant WHERE booking_id = 'b_mt201' AND role = 'primary'`
    );
    expect(nisha.rows[0]?.display_name).toBe("Nisha Verma");
    const suresh = await db.query<{ display_name: string }>(
      `SELECT display_name FROM booking_applicant WHERE booking_id = 'b_mp01' AND role = 'primary'`
    );
    expect(suresh.rows[0]?.display_name).toBe("Suresh Naik");
  });

  it("2.14 customer_login for nisha@ and suresh@demo.pranava", async () => {
    const logins = await db.query<{ email: string; booking_id: string }>(
      `SELECT u.email, cl.booking_id FROM customer_login cl JOIN "user" u ON u.id = cl.user_id
        WHERE u.email IN ('nisha@demo.pranava','suresh@demo.pranava') ORDER BY u.email`
    );
    expect(logins.rows).toHaveLength(2);
    expect(logins.rows.find((r) => r.email === "nisha@demo.pranava")?.booking_id).toBe("b_mt201");
    expect(logins.rows.find((r) => r.email === "suresh@demo.pranava")?.booking_id).toBe("b_mp01");
  });

  it("e2-story: staff 360 and portal agree on unit/name for accepted Meadows occupants; portal has no vendor price", async () => {
    const families = [
      { booking_id: "b_mt201", booking_number: "BK-MT201", name: "Nisha Verma", unit: "MT1-201" },
      { booking_id: "b_mp01", booking_number: "BK-MP01", name: "Suresh Naik", unit: "MP-01" },
    ];
    for (const f of families) {
      const b360 = await getBooking360(f.booking_id, sa);
      expect(b360.booking_number).toBe(f.booking_number);
      expect(b360.unit?.unit_number).toBe(f.unit);
      expect(b360.customer?.display_name).toBe(f.name);
      const login = await db.query<{ user_id: string }>(`SELECT user_id FROM customer_login WHERE booking_id = $1`, [f.booking_id]);
      const home = await getOverview(customerCtx(login.rows[0].user_id));
      expect(home.unit_number).toBe(f.unit);
      expect(JSON.stringify(home)).not.toMatch(/vendor_cost/);
    }
    const nishaLogin = await db.query<{ user_id: string }>(`SELECT user_id FROM customer_login WHERE booking_id = 'b_mt201'`);
    const requests = await getRequests(customerCtx(nishaLogin.rows[0].user_id));
    expect(JSON.stringify(requests)).not.toMatch(/vendor_cost/);
    expect(JSON.stringify(requests)).not.toMatch(/internal_note/);
  });

  it("e2-desks: Packets, Customisation, Sales (prospect/hold) are not empty; Meadows 360 shows apartment + plot", async () => {
    const packets = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM sales_handover sh JOIN booking b ON b.id = sh.booking_id
        WHERE sh.status IN ('SUBMITTED','RETURNED') AND b.booking_number NOT IN ('BK-V110','BK-V111','BK-V112','BK-V113')`
    );
    expect(packets.rows[0].n).toBeGreaterThanOrEqual(2);
    const crs = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM change_request`);
    expect(crs.rows[0].n).toBeGreaterThan(0);
    const prospects = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM prospect WHERE name = 'Tanvi Joshi'`);
    expect(prospects.rows[0].n).toBe(1);
    const holds = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM change_window_hold WHERE status = 'APPROVED'`
    );
    expect(holds.rows[0].n).toBeGreaterThan(0);

    const aptId = await unitId("MT1-201");
    const plotId = await unitId("MP-01");
    const apt360 = await getUnit360(aptId, sa);
    const plot360 = await getUnit360(plotId, sa);
    expect(apt360.product_type).toBe("APARTMENT");
    expect(plot360.product_type).toBe("PLOT");
  });
});

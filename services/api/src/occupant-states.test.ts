import { describe, it, expect, beforeAll } from "vitest";
import { initDb, db } from "./db";
import { updateProgress } from "./progress/core";
import { ctxWithRoles } from "./authz/test-helpers";

// 5.1: one test per seeded PDF §34.2 stage on click-path people (initDb roster).
// Leftover/phase2 files hold the long proofs — this file names the stages. §33.6 t3
// extends progress/core.test.ts (SALES refused) on V110, not a second matrix.

beforeAll(async () => {
  await initDb();
}, 180_000);

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const r = await db.query<T>(sql, params);
  return r.rows[0];
}

describe("p47 §34.2 occupant stages vs click-path roster", () => {
  it("packet submitted: Aditi Bansal BK-MV01 SUBMITTED, no journey", async () => {
    const r = await one<{ status: string; n: number }>(
      `SELECT sh.status, (SELECT count(*)::int FROM journey_instance j WHERE j.booking_id = 'b_mv01') AS n
         FROM sales_handover sh WHERE sh.booking_id = 'b_mv01'`
    );
    expect(r.status).toBe("SUBMITTED");
    expect(r.n).toBe(0);
  });

  it("packet returned: Harish Patel BK-MV02 RETURNED", async () => {
    const r = await one<{ status: string; name: string }>(
      `SELECT sh.status, a.display_name AS name FROM sales_handover sh
         JOIN booking_applicant a ON a.booking_id = sh.booking_id AND a.role = 'primary'
        WHERE sh.booking_id = 'b_mv02'`
    );
    expect(r.name).toBe("Harish Patel");
    expect(r.status).toBe("RETURNED");
  });

  it("CR in flight: Nisha Verma BK-MT201 AWAITING_CUSTOMER", async () => {
    const r = await one<{ status: string }>(`SELECT status FROM change_request WHERE booking_id = 'b_mt201'`);
    expect(r.status).toBe("AWAITING_CUSTOMER");
  });

  it("hold/prospect: Tanvi Joshi APPROVED kitchen_layout hold on u_v101", async () => {
    const r = await one<{ status: string; unit_id: string }>(
      `SELECT h.status, h.unit_id FROM change_window_hold h
         JOIN prospect p ON p.id = h.prospect_id WHERE p.name = 'Tanvi Joshi'`
    );
    expect(r.status).toBe("APPROVED");
    expect(r.unit_id).toBe("u_v101");
  });

  it("Meadows apt+plot: Nisha APARTMENT BK-MT201, Suresh PLOT BK-MP01", async () => {
    const r = await db.query<{ unit_number: string; product_type: string }>(
      `SELECT u.unit_number, u.product_type FROM booking b JOIN unit u ON u.id = b.unit_id
        WHERE b.id IN ('b_mt201','b_mp01') ORDER BY u.unit_number`
    );
    expect(r.rows).toEqual([
      { unit_number: "MP-01", product_type: "PLOT" },
      { unit_number: "MT1-201", product_type: "APARTMENT" },
    ]);
  });

  it("AOS draft: Kavya Iyer BK-MT502 draft, not executed", async () => {
    const r = await one<{ status: string }>(
      `SELECT status FROM generated_document WHERE booking_id = 'b_mt502' AND document_family = 'AOS'`
    );
    expect(r.status).toBe("draft");
  });

  it("registration slot: Deepak Nair BK-MP02 slot_booked", async () => {
    const r = await one<{ status: string }>(`SELECT status FROM registration_case WHERE booking_id = 'b_mp02'`);
    expect(r.status).toBe("slot_booked");
  });

  it("handover in progress: Ishaan Gupta BK-V114 scheduled, keys not issued", async () => {
    const r = await one<{ status: string }>(`SELECT status FROM handover_record WHERE booking_id = 'b_v114'`);
    expect(r.status).toBe("scheduled");
  });

  it("NRI+loan: Leela Fernandes BK-V115 DOCS_PENDING", async () => {
    const r = await one<{ residency: string; stage: string }>(
      `SELECT c.residency, l.stage FROM customer c JOIN loan_case l ON l.booking_id = 'b_v115' WHERE c.id = 'c_leela'`
    );
    expect(r.residency).toBe("NRI");
    expect(r.stage).toBe("DOCS_PENDING");
  });

  it("default/legal: Farhan Qureshi BK-V116 cheque_bounce overdue", async () => {
    const r = await one<{ overdue_reason_code: string }>(
      `SELECT overdue_reason_code FROM demand WHERE booking_id = 'b_v116' AND status = 'overdue' LIMIT 1`
    );
    expect(r.overdue_reason_code).toBe("cheque_bounce");
  });

  it("cancelled: Gita Reddy BK-V117 cancelled; unit remains", async () => {
    const r = await one<{ status: string; unit_number: string }>(
      `SELECT b.status, u.unit_number FROM booking b JOIN unit u ON u.id = b.unit_id WHERE b.id = 'b_v117'`
    );
    expect(r.status).toBe("cancelled");
    expect(r.unit_number).toBe("V117");
  });

  it("pre-reg blocked: Anjali Bhat BK-V118 not completed/slot_booked", async () => {
    const r = await one<{ status: string }>(`SELECT status FROM registration_case WHERE booking_id = 'b_v118'`);
    expect(["completed", "slot_booked"]).not.toContain(r.status);
  });

  it("CRITICAL snag: Vivek Sharma BK-V119", async () => {
    const r = await one<{ n: number }>(
      `SELECT count(*)::int AS n FROM snag s JOIN booking b ON b.unit_id = s.unit_id
        WHERE b.id = 'b_v119' AND s.severity = 'critical'`
    );
    expect(r.n).toBeGreaterThan(0);
  });

  it("construction/cash: Karthik Iyer BK-V110 CONSTRUCTION + PAYMENTS_FUNDING", async () => {
    const r = await db.query<{ stage_code: string }>(
      `SELECT si.stage_code FROM stage_instance si JOIN journey_instance j ON j.id = si.journey_id
        WHERE j.booking_id = 'b_v110' AND si.stage_code IN ('CONSTRUCTION','PAYMENTS_FUNDING')`
    );
    expect(r.rows.map((x) => x.stage_code).sort()).toEqual(["CONSTRUCTION", "PAYMENTS_FUNDING"]);
  });

  it("post-handover: Rohan Desai BK-V113 HANDOVER completed", async () => {
    const r = await one<{ status: string }>(
      `SELECT si.status FROM stage_instance si JOIN journey_instance j ON j.id = si.journey_id
        WHERE j.booking_id = 'b_v113' AND si.stage_code = 'HANDOVER'`
    );
    expect(r.status).toBe("COMPLETED");
  });
});

describe("p44 §33.6 Sales cannot PATCH site gates (roster unit)", () => {
  it("t3 SALES updateProgress on V110 is forbidden — same authorize as progress/core.test.ts", async () => {
    const sales = ctxWithRoles(["SALES"]);
    sales.actor.user_id = "user_sales";
    await expect(updateProgress("u_v110", "mep_first_fix", { state_code: "IN_PROGRESS" }, sales)).rejects.toMatchObject({
      code: "forbidden",
    });
  });
});

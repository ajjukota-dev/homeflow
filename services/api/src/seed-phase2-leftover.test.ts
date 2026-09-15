import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll } from "vitest";
import { initDb, db } from "./db";
import { completeHandover } from "./qa";
import { completeCase, overrideGate } from "./handover/core";
import { getUnit360 } from "./views/unit-360";
import { superAdminCtx as fakeSuperAdminCtx } from "./authz/test-helpers";
import type { Ctx } from "./authz/types";
import { fm, qa } from "./seed/occupants-ctx";

// Phase 2 leftover 2.6–2.16: PDF §34.2 states not seeded on Day 2.

const sa: Ctx = { actor: { ...fakeSuperAdminCtx.actor, user_id: "user_superadmin" } };

const LEFTOVER_SEED_FILES = [
  "seed/occupants-via-handlers.ts",
  "seed/occupants-leftover.ts",
  "seed/occupants-leftover-ctx.ts",
  "seed/occupants-leftover-ready.ts",
  "seed/occupants-leftover-must.ts",
  "seed/occupants-leftover-extra.ts",
  "seed/occupants-leftover-plan.ts",
  "seed/users.ts",
];

beforeAll(async () => {
  await initDb();
}, 180_000);

describe("Phase 2 leftover occupants via handlers (seed)", () => {
  it("e2-sql: leftover seed files do not INSERT INTO booking / journey_instance", () => {
    for (const rel of LEFTOVER_SEED_FILES) {
      const src = readFileSync(new URL("./" + rel, import.meta.url), "utf8");
      expect(src, rel).not.toMatch(/INSERT INTO booking\b/i);
      expect(src, rel).not.toMatch(/INSERT INTO journey_instance\b/i);
    }
  });

  it("2.6 BK-MT502 exists; AOS is draft not executed; Kavya portal login", async () => {
    const b = await db.query<{ id: string; status: string }>(
      `SELECT id, status FROM booking WHERE booking_number = 'BK-MT502'`
    );
    expect(b.rows[0], "BK-MT502").toBeTruthy();
    expect(b.rows[0].id).toBe("b_mt502");
    const applicant = await db.query<{ display_name: string }>(
      `SELECT display_name FROM booking_applicant WHERE booking_id = 'b_mt502' AND role = 'primary'`
    );
    expect(applicant.rows[0]?.display_name).toBe("Kavya Iyer");
    const unit = await db.query<{ unit_number: string }>(
      `SELECT u.unit_number FROM booking b JOIN unit u ON u.id = b.unit_id WHERE b.id = 'b_mt502'`
    );
    expect(unit.rows[0]?.unit_number).toBe("MT1-502");
    const aos = await db.query<{ status: string; booking_id: string }>(
      `SELECT status, booking_id FROM generated_document WHERE booking_id = 'b_mt502' AND document_family = 'AOS'`
    );
    expect(aos.rows[0], "Kavya AOS").toBeTruthy();
    expect(aos.rows[0].status).toBe("draft");
    const karthikExecuted = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM generated_document
        WHERE booking_id = 'b_v110' AND document_family = 'AOS' AND status IN ('executed','archived')`
    );
    expect(karthikExecuted.rows[0].n).toBeGreaterThan(0);
    expect(aos.rows[0].booking_id).not.toBe("b_v110");
    const login = await db.query<{ email: string }>(
      `SELECT u.email FROM customer_login cl JOIN "user" u ON u.id = cl.user_id
        WHERE cl.booking_id = 'b_mt502'`
    );
    expect(login.rows[0]?.email).toBe("kavya@demo.pranava");
    const j = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM journey_instance WHERE booking_id = 'b_mt502'`
    );
    expect(j.rows[0].n).toBe(1);
  });

  it("2.7 BK-MP02 has a registration case with slot booked, status not completed", async () => {
    const b = await db.query<{ id: string }>(`SELECT id FROM booking WHERE booking_number = 'BK-MP02'`);
    expect(b.rows[0], "BK-MP02").toBeTruthy();
    expect(b.rows[0].id).toBe("b_mp02");
    const applicant = await db.query<{ display_name: string }>(
      `SELECT display_name FROM booking_applicant WHERE booking_id = 'b_mp02' AND role = 'primary'`
    );
    expect(applicant.rows[0]?.display_name).toBe("Deepak Nair");
    const rc = await db.query<{ status: string; slot_datetime: string | null }>(
      `SELECT status, slot_datetime::text AS slot_datetime FROM registration_case WHERE booking_id = 'b_mp02'`
    );
    expect(rc.rows[0], "Deepak registration case").toBeTruthy();
    expect(rc.rows[0].status).toBe("slot_booked");
    expect(rc.rows[0].slot_datetime).toBeTruthy();
    expect(rc.rows[0].status).not.toBe("completed");
    const ananya = await db.query<{ status: string }>(
      `SELECT status FROM registration_case WHERE booking_id = 'b_v112'`
    );
    expect(ananya.rows[0]?.status).toBe("completed");
    const login = await db.query<{ email: string }>(
      `SELECT u.email FROM customer_login cl JOIN "user" u ON u.id = cl.user_id WHERE cl.booking_id = 'b_mp02'`
    );
    expect(login.rows[0]?.email).toBe("deepak@demo.pranava");
  });

  it("2.8 BK-V114 appointment confirmed, handover not completed, not b_v113", async () => {
    const b = await db.query<{ id: string }>(`SELECT id FROM booking WHERE booking_number = 'BK-V114'`);
    expect(b.rows[0], "BK-V114").toBeTruthy();
    expect(b.rows[0].id).toBe("b_v114");
    expect(b.rows[0].id).not.toBe("b_v113");
    const applicant = await db.query<{ display_name: string }>(
      `SELECT display_name FROM booking_applicant WHERE booking_id = 'b_v114' AND role = 'primary'`
    );
    expect(applicant.rows[0]?.display_name).toBe("Ishaan Gupta");
    const ho = await db.query<{ status: string; id: string }>(
      `SELECT status, id FROM handover_record WHERE booking_id = 'b_v114'`
    );
    expect(ho.rows[0], "Ishaan handover case").toBeTruthy();
    expect(ho.rows[0].status).toBe("scheduled");
    expect(["completed", "closed"]).not.toContain(ho.rows[0].status);
    const appt = await db.query<{ confirmed_slot: string | null }>(
      `SELECT confirmed_slot::text AS confirmed_slot FROM handover_appointment WHERE case_id = $1`,
      [ho.rows[0].id]
    );
    expect(appt.rows[0]?.confirmed_slot).toBeTruthy();
    const rohan = await db.query<{ status: string }>(
      `SELECT status FROM handover_record WHERE booking_id = 'b_v113'`
    );
    expect(rohan.rows[0]?.status).toBe("completed");
    const login = await db.query<{ email: string }>(
      `SELECT u.email FROM customer_login cl JOIN "user" u ON u.id = cl.user_id WHERE cl.booking_id = 'b_v114'`
    );
    expect(login.rows[0]?.email).toBe("ishaan@demo.pranava");
    const sig = await db.query<{ customer_signature_file_id: string | null }>(
      `SELECT customer_signature_file_id FROM handover_checklist WHERE case_id = $1`,
      [ho.rows[0].id]
    );
    expect(sig.rows[0]?.customer_signature_file_id).toMatch(/^project\//);
    expect(sig.rows[0]?.customer_signature_file_id).not.toMatch(/^data:/);
  });

  it("2.16 every overdue demand has overdue_reason_code and next_action, including Karthik", async () => {
    const overdue = await db.query<{
      id: string; booking_id: string; overdue_reason_code: string | null; next_action: string | null; next_action_id: string | null;
    }>(
      `SELECT d.id, d.booking_id, d.overdue_reason_code, o.next_action, d.next_action_id
         FROM demand d LEFT JOIN overdue_reason o ON o.code = d.overdue_reason_code
        WHERE d.status = 'overdue'`
    );
    expect(overdue.rows.length).toBeGreaterThan(0);
    const karthik = overdue.rows.filter((r) => r.booking_id === "b_v110");
    expect(karthik.length).toBeGreaterThan(0);
    for (const row of overdue.rows) {
      expect(row.overdue_reason_code, row.id).toBeTruthy();
      expect(row.next_action, row.id).toBeTruthy();
    }
    for (const row of karthik) {
      expect(row.next_action_id, row.id).toBeTruthy();
    }
  });

  it("2.9 Leela is NRI with a loan case at DOCS_PENDING, not Meera", async () => {
    const b = await db.query<{ id: string }>(`SELECT id FROM booking WHERE booking_number = 'BK-V115'`);
    expect(b.rows[0]?.id).toBe("b_v115");
    const res = await db.query<{ residency: string; display_name: string }>(
      `SELECT c.residency, c.display_name FROM customer c WHERE c.id = 'c_leela'`
    );
    expect(res.rows[0]?.residency).toBe("NRI");
    expect(res.rows[0]?.display_name).toBe("Leela Fernandes");
    const loan = await db.query<{ stage: string; booking_id: string }>(
      `SELECT stage, booking_id FROM loan_case WHERE booking_id = 'b_v115'`
    );
    expect(loan.rows[0]?.stage).toBe("DOCS_PENDING");
    expect(loan.rows[0]?.booking_id).not.toBe("b_v111");
  });

  it("2.10 Farhan Qureshi is TRUE_RISK / Default-Legal, not Karthik and not Meera", async () => {
    const b = await db.query<{ id: string }>(`SELECT id FROM booking WHERE booking_number = 'BK-V116'`);
    expect(b.rows[0]?.id).toBe("b_v116");
    const applicant = await db.query<{ display_name: string }>(
      `SELECT display_name FROM booking_applicant WHERE booking_id = 'b_v116' AND role = 'primary'`
    );
    expect(applicant.rows[0]?.display_name).toBe("Farhan Qureshi");
    const overdue = await db.query<{ overdue_reason_code: string | null; due_date: string }>(
      `SELECT overdue_reason_code, due_date::text AS due_date FROM demand
        WHERE booking_id = 'b_v116' AND status = 'overdue'`
    );
    expect(overdue.rows.length).toBeGreaterThan(0);
    expect(overdue.rows[0].overdue_reason_code).toBeTruthy();
    const login = await db.query<{ email: string }>(
      `SELECT u.email FROM customer_login cl JOIN "user" u ON u.id = cl.user_id WHERE cl.booking_id = 'b_v116'`
    );
    expect(login.rows[0]?.email).toBe("farhanq@demo.pranava");
  });

  it("2.11 BK-V117 is cancelled; unit V117 still exists and 360 shows the closed booking", async () => {
    const b = await db.query<{ id: string; status: string; unit_id: string }>(
      `SELECT id, status, unit_id FROM booking WHERE booking_number = 'BK-V117'`
    );
    expect(b.rows[0], "BK-V117").toBeTruthy();
    expect(b.rows[0].status).toBe("cancelled");
    const unit = await db.query<{ unit_number: string; sale_status: string }>(
      `SELECT unit_number, sale_status FROM unit WHERE id = $1`,
      [b.rows[0].unit_id]
    );
    expect(unit.rows[0]?.unit_number).toBe("V117");
    expect(unit.rows[0]?.sale_status).toBe("available");
    const u360 = await getUnit360(b.rows[0].unit_id, sa);
    expect(u360.current_booking?.booking_number).toBe("BK-V117");
    expect(u360.current_booking?.status).toBe("cancelled");
  });

  it("2.13 Anjali BK-V118 registration is blocked, not Karthik-open and not Ananya-done", async () => {
    const b = await db.query<{ id: string }>(`SELECT id FROM booking WHERE booking_number = 'BK-V118'`);
    expect(b.rows[0]?.id).toBe("b_v118");
    const rc = await db.query<{ status: string; readiness: unknown }>(
      `SELECT status, readiness FROM registration_case WHERE booking_id = 'b_v118'`
    );
    expect(rc.rows[0], "Anjali registration case").toBeTruthy();
    expect(rc.rows[0].status).not.toBe("completed");
    expect(rc.rows[0].status).not.toBe("slot_booked");
    const readiness = rc.rows[0].readiness as {
      documents?: { ok: boolean; fact: string };
      clearance?: { ok: boolean; fact: string };
      agreement_executed?: { ok: boolean; fact: string };
    };
    expect(readiness.documents?.ok).toBe(false);
    expect(readiness.clearance?.ok).toBe(false);
    expect(readiness.agreement_executed?.ok).toBe(false);
    expect(readiness.documents?.fact).toBeTruthy();
    expect(readiness.clearance?.fact).toBeTruthy();
  });

  it("2.15 Vivek CRITICAL snag hard-gates complete handover without override + reason", async () => {
    const b = await db.query<{ id: string; unit_id: string }>(
      `SELECT id, unit_id FROM booking WHERE booking_number = 'BK-V119'`
    );
    expect(b.rows[0]?.id).toBe("b_v119");
    const snag = await db.query<{ severity: string; status: string }>(
      `SELECT severity, status FROM snag WHERE unit_id = $1 AND severity = 'critical'`,
      [b.rows[0].unit_id]
    );
    expect(snag.rows[0], "Vivek critical snag").toBeTruthy();
    await expect(completeHandover("b_v119", fm)).rejects.toThrow();
    await expect(completeCase("b_v119", qa)).rejects.toThrow();
    await expect(overrideGate("b_v119", { gate: "QUALITY", reason: "" }, sa)).rejects.toThrow(/reason is required/);
  });

  it("2.14 portal logins exist for every accepted leftover occupant", async () => {
    const emails = [
      "kavya@demo.pranava",
      "deepak@demo.pranava",
      "ishaan@demo.pranava",
      "leela@demo.pranava",
      "farhanq@demo.pranava",
      "anjali@demo.pranava",
      "vivek@demo.pranava",
    ];
    const logins = await db.query<{ email: string }>(
      `SELECT u.email FROM customer_login cl JOIN "user" u ON u.id = cl.user_id
        WHERE u.email = ANY($1::text[])`,
      [emails]
    );
    expect(logins.rows.map((r) => r.email).sort()).toEqual([...emails].sort());
  });

  it("2.12 plan ≠ baseline on Karthik BK-V110 and Nisha BK-MT201 via delay_reason catalog", async () => {
    const reasons = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM delay_reason`);
    expect(reasons.rows[0]!.n).toBeGreaterThan(0);
    for (const bookingId of ["b_v110", "b_mt201"]) {
      const stages = await db.query<{ planned_end: string | Date; baseline_end: string | Date; forecast_end: string | Date }>(
        `SELECT si.planned_end, si.baseline_end, si.forecast_end
           FROM stage_instance si JOIN journey_instance j ON j.id = si.journey_id
          WHERE j.booking_id = $1 AND si.planned_end <> si.baseline_end`,
        [bookingId]
      );
      expect(stages.rows.length, bookingId).toBeGreaterThan(0);
      const rev = await db.query<{ reason_code: string }>(
        `SELECT r.reason_code FROM timeline_plan_revision r
           JOIN journey_instance j ON j.id = r.journey_id WHERE j.booking_id = $1`,
        [bookingId]
      );
      expect(rev.rows[0]?.reason_code).toBeTruthy();
    }
  });

  it("Phase 1 + Day 2 still hold; spare pool V101/V104/V108 unbooked", async () => {
    for (const num of ["BK-V110", "BK-V111", "BK-V112", "BK-V113", "BK-MV01", "BK-MT201"]) {
      const r = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM booking WHERE booking_number = $1`, [num]);
      expect(r.rows[0].n, num).toBe(1);
    }
    const mv01 = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM journey_instance WHERE booking_id = 'b_mv01'`
    );
    expect(mv01.rows[0].n).toBe(0);
    const bookedSpare = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM booking WHERE unit_id IN ('u_v101','u_v104','u_v108')`
    );
    expect(bookedSpare.rows[0].n).toBe(0);
  });
});

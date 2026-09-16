import { describe, it, expect, beforeAll } from "vitest";
import { initDb, db } from "./db";
import { getBooking360 } from "./views/booking-360";
import { getUnit360 } from "./views/unit-360";
import { getCustomer360 } from "./views/customer-360";
import { getOverview } from "./portal/core";
import { assertNoDenylistedKeys } from "./portal/denylist";
import { projectCollections } from "./collections-view";
import { customerCtx, superAdminCtx as fakeSa } from "./authz/test-helpers";
import type { Ctx } from "./authz/types";

// 5.1 named PDF coverage (§26 / §31.5 / §32.11 / §34.7) against click-path people.
// Stages live in occupant-states.test.ts. GET 360 must not persist snapshots on read.

const sa: Ctx = { actor: { ...fakeSa.actor, user_id: "user_superadmin" } };

beforeAll(async () => {
  await initDb();
}, 180_000);

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const r = await db.query<T>(sql, params);
  return r.rows[0];
}

describe("p31 §26 named coverage vs roster", () => {
  it("portal Ananya + Rohan never expose vendor / internal_note / unapproved forecast", async () => {
    for (const bookingId of ["b_v112", "b_v113"]) {
      const login = await one<{ user_id: string }>(`SELECT user_id FROM customer_login WHERE booking_id = $1`, [bookingId]);
      const home = await getOverview(customerCtx(login.user_id));
      expect(() => assertNoDenylistedKeys(home)).not.toThrow();
      expect(JSON.stringify(home)).not.toMatch(/TRUE_RISK|vendor_cost|internal_note/);
    }
  });

  it("every overdue (Karthik included) has a structured reason and next action", async () => {
    const r = await db.query<{ overdue_reason_code: string | null; next_action: string | null; booking_id: string }>(
      `SELECT d.overdue_reason_code, o.next_action, d.booking_id FROM demand d
         LEFT JOIN overdue_reason o ON o.code = d.overdue_reason_code WHERE d.status = 'overdue'`
    );
    expect(r.rows.some((x) => x.booking_id === "b_v110")).toBe(true);
    for (const row of r.rows) {
      expect(row.overdue_reason_code).toBeTruthy();
      expect(row.next_action).toBeTruthy();
    }
  });
});

describe("p37 §31.5 named coverage vs roster", () => {
  it("t2 derived project_id: Karthik East Crest, Nisha Meadows — no manual tagging", async () => {
    const r = await db.query<{ id: string; project_id: string }>(
      `SELECT id, project_id FROM booking WHERE id IN ('b_v110','b_mt201')`
    );
    expect(r.rows.find((x) => x.id === "b_v110")?.project_id).toBe("p_eastcrest");
    expect(r.rows.find((x) => x.id === "b_mt201")?.project_id).toBe("p_meadows");
  });

  it("t3 outstanding/overdue/disputed/loan/true-risk distinguishable on Farhan vs Meera vs Leela", async () => {
    const view = await projectCollections("p_eastcrest");
    expect(view.buckets.TRUE_RISK.items.some((i) => i.booking_id === "b_v116")).toBe(true);
    const meera = [...view.buckets.DISPUTED.items, ...view.buckets.OVERDUE.items];
    expect(meera.some((i) => i.booking_id === "b_v111")).toBe(true);
    const loan = await one<{ loan_dependent: boolean }>(
      `SELECT loan_dependent FROM demand WHERE booking_id = 'b_v115' AND loan_dependent = true LIMIT 1`
    );
    expect(loan.loan_dependent).toBe(true);
  });
});

describe("p41 §32.11 named coverage vs roster", () => {
  it("t1/t2 Kavya AOS is draft from an APPROVED factory family; Karthik AOS is executed", async () => {
    const tpl = await one<{ n: number }>(
      `SELECT count(*)::int AS n FROM doc_factory_template WHERE family_code = 'AOS' AND status = 'APPROVED'`
    );
    expect(tpl.n).toBeGreaterThan(0);
    const kavya = await one<{ status: string }>(
      `SELECT status FROM generated_document WHERE booking_id = 'b_mt502' AND document_family = 'AOS'`
    );
    const karthik = await one<{ n: number }>(
      `SELECT count(*)::int AS n FROM generated_document
        WHERE booking_id = 'b_v110' AND document_family = 'AOS' AND status IN ('executed','archived')`
    );
    expect(kavya.status).toBe("draft");
    expect(karthik.n).toBeGreaterThan(0);
  });
});

describe("p47 §34.7 two projects, durations from Studio/seed rows", () => {
  it("t1 East Crest vs Meadows launch-to-handover days differ; journeys read template rows", async () => {
    const projects = await db.query<{ id: string; days: number; version_id: string | null }>(
      `SELECT id, (planned_handover_date - launch_date) AS days, journey_template_version_id AS version_id
         FROM project WHERE id IN ('p_eastcrest','p_meadows')`
    );
    const east = projects.rows.find((p) => p.id === "p_eastcrest")!;
    const meadows = projects.rows.find((p) => p.id === "p_meadows")!;
    expect(Number(east.days)).not.toBe(Number(meadows.days));
    expect(east.version_id).toBeTruthy();

    const karthik = await one<{ template_version_id: string }>(
      `SELECT template_version_id FROM journey_instance WHERE booking_id = 'b_v110'`
    );
    const nisha = await one<{ template_version_id: string }>(
      `SELECT template_version_id FROM journey_instance WHERE booking_id = 'b_mt201'`
    );
    expect(karthik.template_version_id).toBe(east.version_id);
    expect(nisha.template_version_id).not.toBe(karthik.template_version_id);

    const dur = await db.query<{ version_id: string; days: number }>(
      `SELECT version_id, planned_duration_days AS days FROM journey_stage_template
        WHERE code = 'CONSTRUCTION' AND version_id IN ($1,$2)`,
      [karthik.template_version_id, nisha.template_version_id]
    );
    expect(dur.rows).toHaveLength(2);
    const sla = await one<{ duration_value: number }>(`SELECT duration_value FROM sla_policy WHERE target_ref = 'T11'`);
    const clock = await one<{ n: number }>(
      `SELECT count(*)::int AS n FROM sla_clock c
         JOIN task_instance ti ON ti.sla_clock_id = c.id
         JOIN stage_instance si ON si.id = ti.stage_instance_id
         JOIN journey_instance j ON j.id = si.journey_id
        WHERE j.booking_id = 'b_v110' AND c.policy_id IN (SELECT id FROM sla_policy)`
    );
    expect(Number(sla.duration_value)).toBeGreaterThan(0);
    expect(clock.n).toBeGreaterThan(0);
  });
});

describe("GET 360 / scores persist-on-change only", () => {
  it("getBooking360 / getCustomer360 / getUnit360 do not insert UNIT_READINESS or CUSTOMER_HEALTH snapshots", async () => {
    const snap = async (type: string, id: string) =>
      (await one<{ n: number }>(`SELECT count(*)::int AS n FROM score_snapshot WHERE score_type = $1 AND subject_id = $2`, [type, id])).n;
    const ev = async (bookingId: string) =>
      (await one<{ n: number }>(`SELECT count(*)::int AS n FROM event WHERE booking_id = $1`, [bookingId])).n;

    const bBefore = await snap("BOOKING_READINESS", "b_v110");
    const evBefore = await ev("b_v110");
    await getBooking360("b_v110", sa);
    expect(await snap("BOOKING_READINESS", "b_v110")).toBe(bBefore);
    expect(await ev("b_v110")).toBe(evBefore);

    const cBefore = await snap("CUSTOMER_HEALTH", "c_karthik");
    await getCustomer360("c_karthik", sa);
    expect(await snap("CUSTOMER_HEALTH", "c_karthik")).toBe(cBefore);

    const uBefore = await snap("UNIT_READINESS", "u_v110");
    await getUnit360("u_v110", sa);
    expect(await snap("UNIT_READINESS", "u_v110")).toBe(uBefore);
  });
});

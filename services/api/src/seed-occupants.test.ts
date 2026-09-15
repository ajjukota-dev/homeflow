import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll } from "vitest";
import { initDb, db } from "./db";
import { getJourneyForBooking } from "./journey/instances";
import { getProjectJourneyControl } from "./journey/control";
import { getBooking360 } from "./views/booking-360";
import { getCustomer360 } from "./views/customer-360";
import { getOverview } from "./portal/core";
import { superAdminCtx as fakeSuperAdminCtx, customerCtx } from "./authz/test-helpers";
import type { Ctx } from "./authz/types";

// Phase 1 occupant foundation: after initDb/seed, the four East Crest families must exist
// via handlers (journey + events + portal logins), not raw INSERT INTO booking.

const sa: Ctx = { actor: { ...fakeSuperAdminCtx.actor, user_id: "user_superadmin" } };

const FAMILIES = [
  { booking_id: "b_v110", booking_number: "BK-V110", customer_id: "c_karthik", name: "Karthik Iyer", unit: "V110", email: "karthik@demo.pranava" },
  { booking_id: "b_v111", booking_number: "BK-V111", customer_id: "c_meera", name: "Meera Krishnan", unit: "V111", email: "meera@demo.pranava" },
  { booking_id: "b_v112", booking_number: "BK-V112", customer_id: "c_ananya", name: "Ananya Rao", unit: "V112", email: "customer@demo.pranava" },
  { booking_id: "b_v113", booking_number: "BK-V113", customer_id: "c_rohan", name: "Rohan Desai", unit: "V113", email: "rohan@demo.pranava" },
] as const;

beforeAll(async () => {
  await initDb();
}, 120_000);

async function currentCodes(bookingId: string): Promise<string[]> {
  const ctrl = await getProjectJourneyControl("p_eastcrest", sa);
  const row = ctrl.journeys.find((j) => j.booking_id === bookingId);
  return row?.current_stage_per_stream.map((s) => s.stage_code) ?? [];
}

async function stageStatus(bookingId: string, code: string): Promise<string | undefined> {
  const r = await db.query<{ status: string }>(
    `SELECT si.status FROM stage_instance si JOIN journey_instance ji ON ji.id = si.journey_id
      WHERE ji.booking_id = $1 AND si.stage_code = $2`,
    [bookingId, code]
  );
  return r.rows[0]?.status;
}

describe("Phase 1 occupants via handlers (seed)", () => {
  it("does not INSERT INTO booking for BK-V110–V113 in seed files", () => {
    const files = [
      "seed.ts",
      "seed-lifecycle.ts",
      "seed/users.ts",
      "seed/occupants-via-handlers.ts",
      "seed/occupants-book.ts",
      "seed/occupants-advance.ts",
      "seed/occupants-money.ts",
      "seed/occupants-papers.ts",
      "seed/occupants-ctx.ts",
    ];
    for (const rel of files) {
      const src = readFileSync(new URL("./" + rel, import.meta.url), "utf8");
      expect(src).not.toMatch(/INSERT INTO booking[\s\S]{0,500}BK-V11[0-3]/);
    }
  });

  it("each of BK-V110–V113 has a journey_instance", async () => {
    for (const f of FAMILIES) {
      const j = await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM journey_instance WHERE booking_id = $1`,
        [f.booking_id]
      );
      expect(j.rows[0].n, f.booking_number).toBe(1);
    }
  });

  it("current stage codes match 1b–1e (parallel streams may also be current)", async () => {
    // T11 and PT3 have no incoming deps, so CONSTRUCTION / HANDOVER / POST_HANDOVER can be
    // "current" on every instantiated journey. Assert the target stage with OR, not exclusivity.
    const karthik = await currentCodes("b_v110");
    expect(karthik).toContain("CONSTRUCTION");
    expect(karthik).toContain("PAYMENTS_FUNDING");

    const meera = await currentCodes("b_v111");
    expect(meera).toContain("PAYMENTS_FUNDING");

    const ananya = await currentCodes("b_v112");
    expect(ananya.some((c) => c === "READINESS_QA" || c === "HANDOVER")).toBe(true);
    expect(await stageStatus("b_v112", "HANDOVER")).not.toBe("COMPLETED");

    const rohan = await currentCodes("b_v113");
    expect(rohan).toContain("POST_HANDOVER");
    expect(await stageStatus("b_v113", "HANDOVER")).toBe("COMPLETED");
  });

  it("four customer_login rows; karthik/meera/rohan/customer @demo.pranava", async () => {
    const logins = await db.query<{ email: string; booking_id: string }>(
      `SELECT u.email, cl.booking_id FROM customer_login cl JOIN "user" u ON u.id = cl.user_id
        WHERE cl.booking_id IN ('b_v110','b_v111','b_v112','b_v113') ORDER BY u.email`
    );
    expect(logins.rows).toHaveLength(4);
    const emails = logins.rows.map((r) => r.email);
    expect(emails).toEqual([
      "customer@demo.pranava",
      "karthik@demo.pranava",
      "meera@demo.pranava",
      "rohan@demo.pranava",
    ]);
    expect(logins.rows.find((r) => r.email === "customer@demo.pranava")?.booking_id).toBe("b_v112");
  });

  it("sales_handover.accepted or journey.started exists for each of the four booking ids", async () => {
    for (const f of FAMILIES) {
      const ev = await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM event
          WHERE booking_id = $1 AND type IN ('sales_handover.accepted','journey.started')`,
        [f.booking_id]
      );
      expect(ev.rows[0].n, f.booking_number).toBeGreaterThan(0);
    }
  });

  it("Meera's unit has a snag with severity critical", async () => {
    const s = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM snag WHERE unit_id = 'u_v111' AND lower(severity) = 'critical'`
    );
    expect(s.rows[0].n).toBeGreaterThan(0);
  });

  it("Rohan has post-handover case + passport item + 7/30/90 check-ins", async () => {
    const phc = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM post_handover_case WHERE booking_id = 'b_v113'`
    );
    expect(phc.rows[0].n).toBe(1);
    const pass = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM home_passport_item WHERE unit_id = 'u_v113'`
    );
    expect(pass.rows[0].n).toBeGreaterThan(0);
    const checks = await db.query<{ kind: string }>(
      `SELECT kind FROM customer_check_in WHERE booking_id = 'b_v113'`
    );
    const kinds = checks.rows.map((r) => r.kind);
    const hasCheckIns = ["DAY_7", "DAY_30", "DAY_90"].every((k) => kinds.includes(k));
    const tasks = await db.query<{ task_code: string }>(
      `SELECT ti.task_code FROM task_instance ti
         JOIN stage_instance si ON si.id = ti.stage_instance_id
         JOIN journey_instance ji ON ji.id = si.journey_id
        WHERE ji.booking_id = 'b_v113' AND ti.task_code IN ('PT4','PT5','PT6')`
    );
    expect(hasCheckIns || tasks.rows.length === 3).toBe(true);
    expect(hasCheckIns).toBe(true); // handler-scheduled check-ins, not a blank after-care tab
  });
});

describe("e1-names: 360 and portal show names/unit numbers, never raw ids as the title", () => {
  it("Booking 360 and Customer 360 use display names and unit numbers", async () => {
    for (const f of FAMILIES) {
      const b360 = await getBooking360(f.booking_id, sa);
      expect(b360.booking_number).toBe(f.booking_number);
      expect(b360.unit?.unit_number).toBe(f.unit);
      expect(b360.customer?.display_name).toBe(f.name);
      expect(b360.customer?.display_name).not.toBe(f.customer_id);
      expect(b360.unit?.unit_number).not.toBe(f.booking_id);

      const c360 = await getCustomer360(f.customer_id, sa);
      expect(c360.display_name).toBe(f.name);
      expect(c360.display_name).not.toMatch(/^(c_|b_|u_|user_)/);
    }
  });

  it("portal overview for each family is that family's unit, not a raw id", async () => {
    for (const f of FAMILIES) {
      const login = await db.query<{ user_id: string }>(
        `SELECT user_id FROM customer_login WHERE booking_id = $1`,
        [f.booking_id]
      );
      const ctx = customerCtx(login.rows[0].user_id);
      const home = await getOverview(ctx);
      expect(home.unit_number).toBe(f.unit);
      expect(home.unit_number).not.toBe(f.booking_id);
    }
  });
});

describe("e1-get: reloading 360/Journey does not insert a new audit/snapshot row every GET", () => {
  it("getJourneyForBooking is side-effect free on event", async () => {
    const before = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM event WHERE booking_id = 'b_v110'`);
    await getJourneyForBooking("b_v110", sa);
    await getJourneyForBooking("b_v110", sa);
    const after = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM event WHERE booking_id = 'b_v110'`);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it("getBooking360 does not insert event or score_snapshot rows", async () => {
    const evBefore = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM event WHERE booking_id = 'b_v110'`);
    const snapBefore = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM score_snapshot WHERE subject_id = 'b_v110'`
    );
    await getBooking360("b_v110", sa);
    await getBooking360("b_v110", sa);
    const evAfter = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM event WHERE booking_id = 'b_v110'`);
    const snapAfter = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM score_snapshot WHERE subject_id = 'b_v110'`
    );
    expect(evAfter.rows[0].n).toBe(evBefore.rows[0].n);
    expect(snapAfter.rows[0].n).toBe(snapBefore.rows[0].n);
  });
});

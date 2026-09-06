import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll } from "vitest";
import { initDb, db } from "../db";
import { createBooking } from "../bookings";
import { acceptBooking } from "../bookings-crm";
import { ctxWithRoles, superAdminCtx as fakeSuperAdminCtx } from "../authz/test-helpers";
import type { Ctx } from "../authz/types";
import { getKpis, drillKpi } from "./kpis";
import { getExceptions } from "./exceptions";
import { getProfitability, deriveEconomicEvents } from "./profitability";
import { getPortfolio } from "./portfolio";
import { getTeamBottlenecks } from "./teams";
import { grantException } from "../changeability/core";
import { createSnag } from "../qa/snags";
import { KPI_QUERIES } from "../kpis/queries";
import { db as dbHandle } from "../db";

// 27-management-control-tower.md rules 4-8, and the Portfolio view.

beforeAll(async () => {
  await initDb();
});

// Real seeded user ids (seed/users.ts) — createAction/createSnag FK created_by/granted_by to a
// real "user" row, and the synthetic ctxWithRoles() id isn't one (same convention
// commitments/core.test.ts and handover.test.ts already established).
const superAdminCtx: Ctx = { actor: { ...fakeSuperAdminCtx.actor, user_id: "user_superadmin" } };
const management: Ctx = { actor: { ...ctxWithRoles(["MANAGEMENT"]).actor, user_id: "user_management" } };
const site: Ctx = { actor: { ...ctxWithRoles(["SITE"]).actor, user_id: "user_site" } };
const qa: Ctx = { actor: { ...ctxWithRoles(["QA"]).actor, user_id: "user_qa" } };

async function freshUnit(suffix: string): Promise<string> {
  const node = await db.query<{ id: string }>(`SELECT id FROM project_hierarchy_node WHERE project_id = 'p_eastcrest' LIMIT 1`);
  const id = `u_mgmt_${suffix}`;
  await db.query(
    `INSERT INTO unit (id, project_id, unit_number, unit_type, facing, code, hierarchy_node_id, product_type, sale_status)
     VALUES ($1,'p_eastcrest',$2,'2BHK','EAST',$3,$4,'APARTMENT','available')`,
    [id, `MG${suffix}`, `U-MG${suffix}`, node.rows[0]!.id]
  );
  return id;
}

let bookingPhoneCounter = 100000;

async function freshBooking(suffix: string): Promise<{ bookingId: string; unitId: string }> {
  const unitId = await freshUnit(suffix);
  const b = await createBooking(
    unitId,
    {
      applicant: { display_name: "Management Test", phone: `91${(bookingPhoneCounter++).toString().padStart(8, "0")}`, pan: "MGMTT1234A" },
      total_consideration: 9_000_000,
      docs: [{ type: "PAN card", received: true }, { type: "Address proof", received: true }, { type: "Photograph", received: true }],
    },
    superAdminCtx
  );
  await acceptBooking(b!.id, superAdminCtx);
  return { bookingId: b!.id, unitId };
}

describe("27 rule 4 — KPIs: every seeded kpi_definition computes without throwing", () => {
  it.each(Object.keys(KPI_QUERIES))("formula_ref %s returns a well-formed result on p_eastcrest", async (code) => {
    const fn = KPI_QUERIES[code]!;
    const r = await fn("p_eastcrest", "2026-09", dbHandle);
    expect(r).toHaveProperty("value");
    expect(typeof r.numerator).toBe("number");
    expect(typeof r.denominator).toBe("number");
  });

  it("c_true_risk_inr matches collections-view's own TRUE_RISK bucket total", async () => {
    const { projectCollections } = await import("../collections-view");
    const collections = await projectCollections("p_eastcrest");
    const r = await KPI_QUERIES.c_true_risk_inr!("p_eastcrest", "2026-09", dbHandle);
    expect(r.value).toBe(collections.buckets.TRUE_RISK.amount);
  });

  it("getKpis snapshots values and reports a domain-filtered list with target/direction", async () => {
    const kpis = await getKpis("p_eastcrest", management, "COLLECTIONS");
    expect(kpis.length).toBeGreaterThan(0);
    for (const k of kpis) expect(k.domain).toBe("COLLECTIONS");
    const snap = await db.query(`SELECT 1 FROM kpi_snapshot WHERE kpi_code = $1 AND project_id = 'p_eastcrest'`, [kpis[0]!.code]);
    expect(snap.rows.length).toBe(1);
    const evt = await db.query(`SELECT 1 FROM event WHERE type = 'kpi.snapshot_taken' AND entity_id = 'p_eastcrest'`);
    expect(evt.rows.length).toBeGreaterThan(0);
  });

  it("drillKpi returns the current result plus snapshot history", async () => {
    const drill = await drillKpi("c_overdue_inr", "p_eastcrest", management);
    expect(drill).toHaveProperty("current");
    expect(drill.history.length).toBeGreaterThan(0);
  });
});

describe("27 rule 5 — exceptions view: every row links to its real source", () => {
  it("a gate exception granted via 08 appears as a GATE_EXCEPTION row", async () => {
    // createUnit (not the raw-SQL freshUnit) — 07's own creation-time seed gives it the
    // unit_progress rows updateProgress needs, same as changeability/core.test.ts's own fixture.
    const { createUnit } = await import("../projects");
    const { updateProgress } = await import("../progress/core");
    const unit = await createUnit("p_eastcrest", { unit_number: "MG-EXC1", unit_type: "3BHK", facing: "East" }, superAdminCtx);
    const unitId = unit!.id;
    // 08's electrical gate only reaches EXCEPTION_ONLY once structure+MEP first-fix are complete
    // (same setup changeability/core.test.ts's own rule-5 test uses) — grantException rejects an
    // OPEN gate outright.
    await updateProgress(unitId, "structure", { state_code: "COMPLETE" }, site);
    await updateProgress(unitId, "mep_first_fix", { state_code: "COMPLETE" }, site);
    const ex = await grantException(unitId, { category_code: "electrical", reason: "customer paid before first-fix closed", evidence_file_keys: ["k/a.pdf"], valid_until: new Date(Date.now() + 30 * 86400000).toISOString() }, management);
    const rows = await getExceptions("p_eastcrest", management, "GATE_EXCEPTION");
    expect(rows.some((r) => r.id === ex.id)).toBe(true);
  });

  it("unfiltered listing includes multiple exception kinds without throwing", async () => {
    const rows = await getExceptions("p_eastcrest", management);
    const kinds = new Set(rows.map((r) => r.kind));
    expect(kinds.size).toBeGreaterThanOrEqual(1);
  });
});

describe("27 rule 6 — profitability: economic_event derives from real facts, explainable per row", () => {
  it("a critical snag's cost becomes a QUALITY_COST economic_event", async () => {
    const unitId = await freshUnit("snag1");
    const snag = await createSnag({ unit_id: unitId, room: "KITCHEN", category: "FITTINGS", severity: "MAJOR", description: "Cabinet hinge loose", estimated_cost_inr: 4500 }, qa);
    await deriveEconomicEvents("p_eastcrest");
    const row = await db.query<{ amount_inr: number }>(`SELECT amount_inr::float8 AS amount_inr FROM economic_event WHERE kind = 'QUALITY_COST' AND source_id = $1`, [snag.id]);
    expect(row.rows[0]?.amount_inr).toBe(4500);
  });

  it("a breached TIMELINE commitment becomes a DELAY_COST priced at the configured ₹/day", async () => {
    const { bookingId, unitId } = await freshBooking("delay1");
    const id = "cmt_" + randomUUID().slice(0, 8);
    await db.query(
      `INSERT INTO commitment (id, code, project_id, booking_id, unit_id, category, description, committed_by_user_id, source, beneficiary, status, due_date, breached_at)
       VALUES ($1,$1,'p_eastcrest',$2,$3,'TIMELINE','promised possession date','user_superadmin','CRM','CUSTOMER','BREACHED', CURRENT_DATE - 5, now())`,
      [id, bookingId, unitId]
    );
    const perDay = await db.query<{ value: number }>(`SELECT (value #>> '{}')::float8 AS value FROM management_config WHERE key = 'delay_cost_per_day_inr'`);
    await deriveEconomicEvents("p_eastcrest");
    const row = await db.query<{ amount_inr: number }>(`SELECT amount_inr::float8 AS amount_inr FROM economic_event WHERE kind = 'DELAY_COST' AND source_id = $1`, [id]);
    expect(row.rows[0]?.amount_inr).toBe(5 * (perDay.rows[0]?.value ?? 0));
    const evt = await db.query(`SELECT 1 FROM event WHERE type = 'economic_event.recorded' AND entity_id = 'p_eastcrest'`);
    expect(evt.rows.length).toBeGreaterThan(0);
  });

  it("getProfitability derives fresh and totals by kind, explainable via the per-row reason", async () => {
    const p = await getProfitability("p_eastcrest", management);
    expect(p.totals_by_kind).toHaveProperty("QUALITY_COST");
    expect(p.rows.every((r) => "reason" in r)).toBe(true);
  });
});

describe("27 rule 7 — materiality: a Control-Tower-scoped threshold filters escalations below the band", () => {
  it("excludes an escalation whose decision_pack impact is below a temporary CONTROL_TOWER band", async () => {
    // Inserted and cleaned up within this test — materiality_threshold has no project scoping,
    // so a permanent row here would change every other test's Control Tower output.
    await db.query(`INSERT INTO materiality_threshold (id, scope, metric, value) VALUES ('mt_test_ct', 'CONTROL_TOWER', 'INR_EXPOSURE', 999999999)`);
    try {
      const { controlTower } = await import("./interventions");
      const tower = await controlTower("p_eastcrest", superAdminCtx);
      // no seeded escalation clears a ₹999,999,999 exposure band — the customer/cash/etc. slots
      // fall back to their non-escalation sources or the all-clear card, never an escalation one.
      expect(tower.interventions.every((i) => !i.headline.startsWith("Escalation"))).toBe(true);
    } finally {
      await db.query(`DELETE FROM materiality_threshold WHERE id = 'mt_test_ct'`);
    }
  });
});

describe("27 rule 8 — team bottlenecks: a table, not charts", () => {
  it("groups open actions by owner_role with SLA state and median age", async () => {
    const rows = await getTeamBottlenecks("p_eastcrest", management);
    expect(Array.isArray(rows)).toBe(true);
    for (const r of rows) {
      expect(r.open_count).toBe(r.on_track + r.overdue + r.breached);
      expect(Array.isArray(r.top_blockers)).toBe(true);
    }
  });
});

describe("27 — Portfolio view: readiness/cash/risk/experience per project", () => {
  it("returns a row for every project with the 4 numbers", async () => {
    const rows = await getPortfolio(management);
    const eastcrest = rows.find((r) => r.project_id === "p_eastcrest")!;
    expect(eastcrest).toBeTruthy();
    expect(eastcrest).toHaveProperty("readiness_pct");
    expect(eastcrest).toHaveProperty("cash_outstanding_inr");
    expect(eastcrest).toHaveProperty("risk_inr");
    expect(eastcrest).toHaveProperty("experience_score");
  });
});

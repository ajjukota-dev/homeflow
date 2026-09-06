import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll } from "vitest";
import { initDb, db } from "../db";
import { createBooking } from "../bookings";
import { acceptBooking } from "../bookings-crm";
import { ctxWithRoles, superAdminCtx } from "../authz/test-helpers";
import type { Ctx } from "../authz/types";
import { computeProbability, overdueRecoveryProbability, ptpHonourRate, loanDisbursementProbability } from "./probability";
import { resolveDemandLine, deriveProjectLines, applyScenarioAssumptions, futureSalesLines, type DemandFacts } from "./derive";
import { computeWaterfall, bandConfidence } from "./waterfall";
import { getForecast, overrideForecastLine, createScenario, listScenarios, putScenarioAssumptions, takeSnapshot, listSnapshots, compareForecast } from "./core";

// 20-cash-forecast.md — rule tests 1-8 + the double-counting property test (Acceptance).

function staffCtx(role: string, userId: string): Ctx {
  const c = ctxWithRoles([role]);
  c.actor.user_id = userId;
  return c;
}
const accounts = staffCtx("ACCOUNTS", "user_accounts");
const management = staffCtx("MANAGEMENT", "user_management");
const sales = staffCtx("SALES", "user_sales");

let availableUnits: string[] = [];
const UNITS_NEEDED = 15;

beforeAll(async () => {
  await initDb();
  const node = await db.query<{ id: string }>(`SELECT id FROM project_hierarchy_node WHERE project_id = 'p_eastcrest' LIMIT 1`);
  const nodeId = node.rows[0]!.id;
  for (let i = 0; i < UNITS_NEEDED; i++) {
    const id = `u_forecast_test_${i}`;
    await db.query(
      `INSERT INTO unit (id, project_id, unit_number, unit_type, facing, code, hierarchy_node_id, product_type, sale_status)
       VALUES ($1,'p_eastcrest',$2,'2BHK','EAST',$3,$4,'APARTMENT','available')`,
      [id, `FT${i}`, `U-FT${i}`, nodeId]
    );
    availableUnits.push(id);
  }
});

async function freshBooking(applicantSuffix: string): Promise<{ bookingId: string; projectId: string }> {
  const unitId = availableUnits.pop();
  if (!unitId) throw new Error("ran out of seeded available units for this test file");
  const b = await createBooking(
    unitId,
    {
      applicant: { display_name: "Forecast Test", phone: `97654${applicantSuffix.padStart(5, "0")}`, pan: "FCAST1234A" },
      total_consideration: 9_000_000,
      docs: [
        { type: "PAN card", received: true },
        { type: "Address proof", received: true },
        { type: "Photograph", received: true },
      ],
    },
    superAdminCtx // booking setup only — same precedent as loans/core.test.ts's own freshBooking
  );
  await acceptBooking(b!.id, superAdminCtx);
  return { bookingId: b!.id, projectId: "p_eastcrest" };
}

/** Insert a fully controlled demand row directly — simpler and more deterministic than driving
 *  it through setupFunding's trigger logic (same "create exactly what this test needs via SQL"
 *  precedent as rls.test.ts/loans's own fixtures). */
async function insertDemand(id: string, bookingId: string, projectId: string, opts: { amount: number; due_date: string | null; status: string; overdue_reason_code?: string | null; loan_dependent?: boolean }): Promise<void> {
  await db.query(
    `INSERT INTO demand (id, booking_id, project_id, milestone_key, milestone_label, sequence, amount, due_date, status, overdue_reason_code, loan_dependent)
     VALUES ($1,$2,$3,'test_milestone','Test milestone',99,$4,$5,$6,$7,$8)`,
    [id, bookingId, projectId, opts.amount, opts.due_date, opts.status, opts.overdue_reason_code ?? null, opts.loan_dependent ?? false]
  );
}

describe("probability.ts — rule 2 (pure, explainable)", () => {
  it("CONTRACTUAL_DUE: 0.95 never late, 0.85 has been late", () => {
    expect(computeProbability({ source_type: "CONTRACTUAL_DUE", contractualDue: { everLate: false } }).probability).toBe(0.95);
    expect(computeProbability({ source_type: "CONTRACTUAL_DUE", contractualDue: { everLate: true } }).probability).toBe(0.85);
  });

  it("OVERDUE_RECOVERY: four age bands 0.6/0.4/0.25/0.1", () => {
    expect(overdueRecoveryProbability(5)).toBe(0.6);
    expect(overdueRecoveryProbability(30)).toBe(0.4);
    expect(overdueRecoveryProbability(60)).toBe(0.25);
    expect(overdueRecoveryProbability(120)).toBe(0.1);
  });

  it("PROMISE_TO_PAY: 0.7 x historical honour rate, neutral (rate=1) with no history", () => {
    expect(ptpHonourRate(0, 0)).toBe(1);
    expect(computeProbability({ source_type: "PROMISE_TO_PAY", promiseToPay: { honouredCount: 0, totalCount: 0 } }).probability).toBeCloseTo(0.7);
    expect(computeProbability({ source_type: "PROMISE_TO_PAY", promiseToPay: { honouredCount: 1, totalCount: 2 } }).probability).toBeCloseTo(0.35);
  });

  it("LOAN_DISBURSEMENT: 0.9 sanctioned-or-later, 0.5 applied", () => {
    expect(loanDisbursementProbability("SANCTIONED")).toBe(0.9);
    expect(loanDisbursementProbability("APPLICATION")).toBe(0.5);
    expect(computeProbability({ source_type: "LOAN_DISBURSEMENT", loanDisbursement: { stage: "SANCTION_PENDING" } }).probability).toBe(0.5);
  });

  it("APPROVED_RESCHEDULE: flat 0.8; MANUAL_FINANCE_OVERRIDE: as set", () => {
    expect(computeProbability({ source_type: "APPROVED_RESCHEDULE" }).probability).toBe(0.8);
    expect(computeProbability({ source_type: "MANUAL_FINANCE_OVERRIDE", manualOverride: { probability: 0.42 } }).probability).toBe(0.42);
  });

  it("drivers array carries the explain facts (never empty for a real source)", () => {
    const r = computeProbability({ source_type: "OVERDUE_RECOVERY", overdueRecovery: { daysOverdue: 22, reasonLabel: "Loan delay" } });
    expect(r.drivers.length).toBeGreaterThan(0);
    expect(r.drivers.some((d) => d.value === "Loan delay")).toBe(true);
  });
});

describe("derive.ts::resolveDemandLine — rule 1 precedence, one winner per demand", () => {
  const base: DemandFacts = {
    demand_id: "d1", booking_id: "b1", project_id: "p1", loan_case_id: null,
    remaining: 100_000, due_date: "2026-10-01", status: "due", overdue_reason_label: null, ever_late: false,
    active_ptp: null, ptp_honoured_count: 0, ptp_total_count: 0,
    loan_dependent: false, loan_stage: null, loan_expected_disbursement_date: null,
  };
  const asOf = "2026-09-06";

  it("nothing to forecast once fully settled or waived", () => {
    expect(resolveDemandLine({ ...base, remaining: 0 }, asOf)).toBeNull();
    expect(resolveDemandLine({ ...base, status: "settled" }, asOf)).toBeNull();
    expect(resolveDemandLine({ ...base, status: "waived" }, asOf)).toBeNull();
  });

  it("no due date yet (construction trigger not fired) -> no line", () => {
    expect(resolveDemandLine({ ...base, due_date: null, status: "scheduled" }, asOf)).toBeNull();
  });

  it("plain contractual: CONTRACTUAL_DUE at the demand's own due date", () => {
    const line = resolveDemandLine(base, asOf)!;
    expect(line.source_type).toBe("CONTRACTUAL_DUE");
    expect(line.expected_date).toBe("2026-10-01");
  });

  it("overdue: OVERDUE_RECOVERY wins over plain contractual", () => {
    const line = resolveDemandLine({ ...base, status: "overdue", due_date: "2026-07-01", overdue_reason_label: "Unresponsive" }, asOf)!;
    expect(line.source_type).toBe("OVERDUE_RECOVERY");
  });

  it("active promise-to-pay supersedes overdue for that demand", () => {
    const line = resolveDemandLine({ ...base, status: "overdue", due_date: "2026-07-01", active_ptp: { expected_date: "2026-09-20", expected_amount: 100_000 } }, asOf)!;
    expect(line.source_type).toBe("PROMISE_TO_PAY");
    expect(line.expected_date).toBe("2026-09-20");
  });

  it("loan-dependent supersedes even an active PTP (highest precedence)", () => {
    const line = resolveDemandLine(
      { ...base, loan_dependent: true, loan_stage: "SANCTIONED", loan_expected_disbursement_date: "2026-11-01", active_ptp: { expected_date: "2026-09-20", expected_amount: 100_000 } },
      asOf
    )!;
    expect(line.source_type).toBe("LOAN_DISBURSEMENT");
    expect(line.expected_date).toBe("2026-11-01");
  });

  it("loan-dependent with no expected disbursement date yet -> no confident line (flagged gap, not guessed)", () => {
    expect(resolveDemandLine({ ...base, loan_dependent: true, loan_stage: "SANCTIONED", loan_expected_disbursement_date: null }, asOf)).toBeNull();
  });

  it("PTP amount is capped at the demand's remaining balance (never over-promises past what's owed)", () => {
    const line = resolveDemandLine({ ...base, remaining: 40_000, active_ptp: { expected_date: "2026-09-20", expected_amount: 100_000 } }, asOf)!;
    expect(line.amount_inr).toBe(40_000);
  });
});

describe("double-counting property test (Acceptance: 200 seeded demands/loans)", () => {
  function randomFacts(seed: number): DemandFacts {
    const r = (n: number) => (Math.sin(seed * 999 + n) + 1) / 2; // deterministic pseudo-random
    const remaining = 10_000 + Math.floor(r(1) * 990_000);
    const statusRoll = r(2);
    const status = statusRoll < 0.15 ? "settled" : statusRoll < 0.25 ? "waived" : statusRoll < 0.4 ? "overdue" : statusRoll < 0.55 ? "scheduled" : "due";
    const hasDueDate = status !== "scheduled" || r(3) > 0.5;
    const loanDependent = r(4) < 0.2;
    const hasPtp = !loanDependent && r(5) < 0.2;
    return {
      demand_id: `pd_${seed}`, booking_id: `pb_${seed % 20}`, project_id: "p_eastcrest", loan_case_id: loanDependent ? `plc_${seed}` : null,
      remaining, due_date: hasDueDate ? "2026-08-01" : null, status, overdue_reason_label: status === "overdue" ? "Unresponsive" : null,
      ever_late: r(6) < 0.3,
      active_ptp: hasPtp ? { expected_date: "2026-09-15", expected_amount: Math.floor(remaining * r(7)) } : null,
      ptp_honoured_count: Math.floor(r(8) * 5), ptp_total_count: Math.floor(r(8) * 5) + Math.floor(r(9) * 3),
      loan_dependent: loanDependent, loan_stage: "SANCTIONED", loan_expected_disbursement_date: loanDependent ? "2026-10-15" : null,
    };
  }

  it("Sigma active COMMITTED line amount per demand never exceeds that demand's remaining balance, over 200 generated demands", () => {
    for (let i = 0; i < 200; i++) {
      const facts = randomFacts(i);
      const line = resolveDemandLine(facts, "2026-09-06");
      if (line) expect(line.amount_inr).toBeLessThanOrEqual(facts.remaining + 1e-6);
    }
  });
});

describe("waterfall.ts — rule 4 (pure)", () => {
  it("opening -> +raised -> -weighted collections -> closing; confidence bands the weighted mean", () => {
    const result = computeWaterfall({
      opening_outstanding: 1_000_000,
      periods: [
        { period: "2026-10", lines: [{ source_type: "CONTRACTUAL_DUE", amount_inr: 200_000, probability: 0.9 }, { source_type: "OVERDUE_RECOVERY", amount_inr: 100_000, probability: 0.5 }], target_inr: 250_000 },
      ],
    });
    const p = result[0]!;
    expect(p.opening_outstanding).toBe(1_000_000);
    expect(p.demands_raised).toBe(300_000);
    expect(p.expected_weighted).toBeCloseTo(180_000);
    expect(p.overdue_recovery_weighted).toBeCloseTo(50_000);
    expect(p.closing_outstanding).toBeCloseTo(1_000_000 + 300_000 - 180_000 - 50_000);
    expect(p.shortfall).toBeCloseTo(180_000 + 50_000 - 250_000);
  });

  it("no cash_target row -> target_inr and shortfall are null, not a fake zero-surplus (advisor review)", () => {
    const result = computeWaterfall({ opening_outstanding: 0, periods: [{ period: "2026-10", lines: [{ source_type: "CONTRACTUAL_DUE", amount_inr: 100_000, probability: 1 }], target_inr: null }] });
    expect(result[0]!.target_inr).toBeNull();
    expect(result[0]!.shortfall).toBeNull();
  });

  it("closing_outstanding carries forward as next period's opening", () => {
    const result = computeWaterfall({
      opening_outstanding: 500_000,
      periods: [
        { period: "2026-10", lines: [{ source_type: "CONTRACTUAL_DUE", amount_inr: 100_000, probability: 1 }], target_inr: null },
        { period: "2026-11", lines: [], target_inr: null },
      ],
    });
    expect(result[1]!.opening_outstanding).toBe(result[0]!.closing_outstanding);
  });

  it("bandConfidence: HIGH >=0.8, MEDIUM >=0.5, LOW below", () => {
    expect(bandConfidence([{ source_type: "CONTRACTUAL_DUE", amount_inr: 100, probability: 0.9 }])).toBe("HIGH");
    expect(bandConfidence([{ source_type: "CONTRACTUAL_DUE", amount_inr: 100, probability: 0.6 }])).toBe("MEDIUM");
    expect(bandConfidence([{ source_type: "CONTRACTUAL_DUE", amount_inr: 100, probability: 0.2 }])).toBe("LOW");
    expect(bandConfidence([])).toBe("LOW");
  });
});

describe("scenarios (rule 5) — pure transforms", () => {
  const lines = [
    { demand_id: "d1", loan_case_id: null, source_type: "CONTRACTUAL_DUE" as const, expected_date: "2026-10-01", amount_inr: 100_000, probability: 0.9, probability_drivers: [] },
    { demand_id: "d2", loan_case_id: "lc1", source_type: "LOAN_DISBURSEMENT" as const, expected_date: "2026-10-05", amount_inr: 200_000, probability: 0.9, probability_drivers: [] },
  ];

  it("collection efficiency scales only CONTRACTUAL_DUE/OVERDUE_RECOVERY probability", () => {
    const out = applyScenarioAssumptions(lines, { collection_efficiency_pct: 50 });
    expect(out[0]!.probability).toBeCloseTo(0.45);
    expect(out[1]!.probability).toBe(0.9); // LOAN_DISBURSEMENT untouched
  });

  it("construction slip / loan lag shift only their own source type's date", () => {
    const out = applyScenarioAssumptions(lines, { construction_slip_days: 30, loan_disbursement_lag_days: 10 });
    expect(out[0]!.expected_date).toBe("2026-10-31");
    expect(out[1]!.expected_date).toBe("2026-10-15");
  });

  it("futureSalesLines: zero assumption -> no lines; a real assumption -> one SCENARIO_FUTURE_SALES line per month", () => {
    expect(futureSalesLines({}, "2026-09-06", 6)).toEqual([]);
    const out = futureSalesLines({ future_sales_per_month: 2, future_sale_ticket_inr: 5_000_000 }, "2026-09-06", 3);
    expect(out).toHaveLength(3);
    expect(out.every((l) => l.source_type === "SCENARIO_FUTURE_SALES" && l.amount_inr === 10_000_000)).toBe(true);
  });
});

describe("integration — derive/core against real demand rows", () => {
  it("derives CONTRACTUAL_DUE, then re-derive after going overdue supersedes it, then a receipt realises it (rules 1 + 7)", async () => {
    const { bookingId, projectId } = await freshBooking("11001");
    const demandId = "fd_" + bookingId;
    await insertDemand(demandId, bookingId, projectId, { amount: 500_000, due_date: "2026-12-01", status: "due" });

    await deriveProjectLines(projectId, "2026-09-06", db, accounts);
    const active1 = await db.query(`SELECT source_type, status FROM forecast_line WHERE demand_id = $1 AND status = 'ACTIVE'`, [demandId]);
    expect(active1.rows).toEqual([{ source_type: "CONTRACTUAL_DUE", status: "ACTIVE" }]);

    await db.query(`UPDATE demand SET status = 'overdue', overdue_reason_code = 'unresponsive' WHERE id = $1`, [demandId]);
    await deriveProjectLines(projectId, "2026-09-06", db, accounts);
    const rows2 = await db.query<{ source_type: string; status: string }>(`SELECT source_type, status FROM forecast_line WHERE demand_id = $1 ORDER BY created_at`, [demandId]);
    expect(rows2.rows.find((r) => r.source_type === "CONTRACTUAL_DUE")!.status).toBe("SUPERSEDED");
    expect(rows2.rows.find((r) => r.source_type === "OVERDUE_RECOVERY")!.status).toBe("ACTIVE");

    // A real receipt, not just a status flip — remaining must actually reach 0 for rule 7's
    // realisation branch to fire (a bare status='settled' with no receipt would leave `remaining`
    // unchanged, which is a fresh bug this test caught while writing it).
    await db.query(`INSERT INTO receipt (id, booking_id, project_id, demand_id, amount, status) VALUES ($1,$2,$3,$4,500000,'reconciled')`, [randomUUID(), bookingId, projectId, demandId]);
    await db.query(`UPDATE demand SET status = 'settled' WHERE id = $1`, [demandId]);
    await deriveProjectLines(projectId, "2026-09-06", db, accounts);
    const rows3 = await db.query<{ status: string }>(`SELECT status FROM forecast_line WHERE demand_id = $1 AND source_type = 'OVERDUE_RECOVERY'`, [demandId]);
    expect(rows3.rows[0]!.status).toBe("REALISED");

    const events = await db.query<{ type: string }>(`SELECT type FROM event WHERE entity_type = 'forecast_line' AND booking_id = $1 ORDER BY occurred_at`, [bookingId]);
    expect(events.rows.map((r) => r.type)).toEqual(
      expect.arrayContaining(["forecast.line_derived", "forecast.line_superseded", "forecast.line_realised"])
    );
  });

  it("a line whose own expected date has already passed, still unpaid, closes LAPSED (not SUPERSEDED) when the winner changes (rule 7)", async () => {
    const { bookingId, projectId } = await freshBooking("11004");
    const demandId = "fd_" + bookingId;
    // Already overdue with a due date in the past relative to asOf — the ACTIVE OVERDUE_RECOVERY
    // line this produces therefore starts life already past its own expected_date.
    await insertDemand(demandId, bookingId, projectId, { amount: 400_000, due_date: "2026-08-01", status: "overdue", overdue_reason_code: "unresponsive" });
    await deriveProjectLines(projectId, "2026-09-06", db, accounts);
    const active1 = await db.query<{ id: string; status: string }>(`SELECT id, status FROM forecast_line WHERE demand_id = $1 AND source_type = 'OVERDUE_RECOVERY'`, [demandId]);
    expect(active1.rows[0]!.status).toBe("ACTIVE");

    // Customer now promises to pay — the winner changes to PROMISE_TO_PAY; the old line's own
    // expected_date (2026-08-01) is before asOf (2026-09-06), so it must close LAPSED, not
    // SUPERSEDED (distinguishing "the old forecast simply expired unpaid" from "a fresher signal
    // pre-empted it before its date arrived").
    await db.query(`INSERT INTO promise_to_pay (id, demand_id, expected_date, expected_amount) VALUES ($1,$2,'2026-09-20',400000)`, [randomUUID(), demandId]);
    await deriveProjectLines(projectId, "2026-09-06", db, accounts);
    const rows = await db.query<{ source_type: string; status: string }>(`SELECT source_type, status FROM forecast_line WHERE demand_id = $1 ORDER BY created_at`, [demandId]);
    expect(rows.rows.find((r) => r.source_type === "OVERDUE_RECOVERY")!.status).toBe("LAPSED");
    expect(rows.rows.find((r) => r.source_type === "PROMISE_TO_PAY")!.status).toBe("ACTIVE");

    const evt = await db.query(`SELECT type FROM event WHERE type = 'forecast.line_lapsed'`);
    expect(evt.rows.length).toBeGreaterThan(0);
  });

  it("a manual override supersedes the derived line and survives the next derive pass untouched (rule 1)", async () => {
    const { bookingId, projectId } = await freshBooking("11002");
    const demandId = "fd_" + bookingId;
    await insertDemand(demandId, bookingId, projectId, { amount: 300_000, due_date: "2026-12-01", status: "due" });
    await deriveProjectLines(projectId, "2026-09-06", db, accounts);

    const derived = await db.query<{ id: string }>(`SELECT id FROM forecast_line WHERE demand_id = $1 AND status = 'ACTIVE'`, [demandId]);
    const overridden = await overrideForecastLine(derived.rows[0]!.id, { expected_date: "2027-01-15", amount_inr: 250_000, probability: 0.99, reason: "customer committed in writing" }, accounts);
    expect(overridden.source_type).toBe("MANUAL_FINANCE_OVERRIDE");

    await deriveProjectLines(projectId, "2026-09-06", db, accounts); // must leave the override alone
    const active = await db.query<{ id: string; source_type: string }>(`SELECT id, source_type FROM forecast_line WHERE demand_id = $1 AND status = 'ACTIVE'`, [demandId]);
    expect(active.rows).toHaveLength(1);
    expect(active.rows[0]!.source_type).toBe("MANUAL_FINANCE_OVERRIDE");

    const evt = await db.query(`SELECT type FROM event WHERE type = 'forecast.override_recorded'`);
    expect(evt.rows.length).toBeGreaterThan(0);
  });

  it("a non-Accounts/Management role cannot override a forecast line", async () => {
    const { bookingId, projectId } = await freshBooking("11003");
    const demandId = "fd_" + bookingId;
    await insertDemand(demandId, bookingId, projectId, { amount: 300_000, due_date: "2026-12-01", status: "due" });
    await deriveProjectLines(projectId, "2026-09-06", db, accounts);
    const derived = await db.query<{ id: string }>(`SELECT id FROM forecast_line WHERE demand_id = $1`, [demandId]);
    await expect(overrideForecastLine(derived.rows[0]!.id, { expected_date: "2027-01-01", amount_inr: 1, probability: 1, reason: "x" }, sales)).rejects.toThrow(/requires one of/);
  });

  it("getForecast: waterfall periods cover the requested range and lane is a required discriminator (rule 5/t8)", async () => {
    const view = await getForecast("p_eastcrest", { from: "2026-09", to: "2026-11", lane: "COMMITTED" }, accounts);
    expect(view.lane).toBe("COMMITTED");
    expect(view.periods.map((p) => p.period)).toEqual(["2026-09", "2026-10", "2026-11"]);
    expect(view.lines.every((l) => l.lane === "COMMITTED")).toBe(true);
  });

  it("BASE stays byte-identical after a CONSERVATIVE scenario is created and given assumptions (rule 5: never overwrites baseline)", async () => {
    const before = await getForecast("p_eastcrest", { scenario: "BASE", from: "2026-09", to: "2026-12", lane: "COMMITTED" }, accounts);
    const scenario = await createScenario("p_eastcrest", { code: `CONSERVATIVE_${Date.now()}` }, management);
    await putScenarioAssumptions(scenario.id, [{ key: "COLLECTION_EFFICIENCY_PCT", value: 40 }], management);
    const after = await getForecast("p_eastcrest", { scenario: "BASE", from: "2026-09", to: "2026-12", lane: "COMMITTED" }, accounts);
    expect(after.lines).toEqual(before.lines);
  });

  it("listScenarios reads back saved assumptions (planner reload prefill — advisor review, spec 20)", async () => {
    const scenario = await createScenario("p_eastcrest", { code: `PREFILL_${Date.now()}` }, management);
    const listed = (await listScenarios("p_eastcrest", accounts)) as { id: string; assumptions: Record<string, number> }[];
    expect(listed.find((s) => s.id === scenario.id)?.assumptions).toEqual({});
    await putScenarioAssumptions(scenario.id, [{ key: "COLLECTION_EFFICIENCY_PCT", value: 55 }], management);
    const after = (await listScenarios("p_eastcrest", accounts)) as { id: string; assumptions: Record<string, number> }[];
    expect(after.find((s) => s.id === scenario.id)?.assumptions).toEqual({ COLLECTION_EFFICIENCY_PCT: 55 });
  });

  it("cannot request the SCENARIO lane against the BASE scenario (lanes are never mixed)", async () => {
    await expect(getForecast("p_eastcrest", { scenario: "BASE", lane: "SCENARIO" }, accounts)).rejects.toThrow(/committed baseline/);
  });

  it("scenario lane reflects its own assumptions, independent of COMMITTED (rule 5)", async () => {
    const scenario = await createScenario("p_eastcrest", { code: `STRETCH_${Date.now()}` }, management);
    await putScenarioAssumptions(scenario.id, [{ key: "FUTURE_SALES_PER_MONTH", value: 1 }, { key: "FUTURE_SALE_TICKET_INR", value: 8_000_000 }], management);
    const view = await getForecast("p_eastcrest", { scenario: scenario.code, from: "2026-09", to: "2026-12", lane: "SCENARIO" }, accounts);
    expect(view.lane).toBe("SCENARIO");
    expect(view.lines.some((l) => l.source_type === "SCENARIO_FUTURE_SALES")).toBe(true);
  });

  it("snapshots are immutable and comparable (rule 3/6)", async () => {
    const snap = await takeSnapshot("p_eastcrest", "MANUAL", management);
    expect(snap.id).toBeTruthy();
    const list = (await listSnapshots("p_eastcrest", accounts)) as { id: string }[];
    expect(list.some((s) => s.id === snap.id)).toBe(true);
    const evt = await db.query(`SELECT type FROM event WHERE type = 'forecast.snapshot_taken'`);
    expect(evt.rows.length).toBeGreaterThan(0);

    const period = new Date().toISOString().slice(0, 7);
    const cmp = await compareForecast("p_eastcrest", period, accounts);
    expect(cmp.period).toBe(period);
    expect(typeof cmp.actual).toBe("number");
    expect(typeof cmp.latest).toBe("number");
  });

  it("scenario events are logged (registry coverage)", async () => {
    const evt = await db.query(`SELECT type FROM event WHERE type IN ('scenario.created', 'scenario.updated')`);
    expect(evt.rows.length).toBeGreaterThanOrEqual(2);
  });
});

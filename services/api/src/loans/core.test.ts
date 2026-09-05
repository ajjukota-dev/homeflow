import { describe, it, expect, beforeAll } from "vitest";
import { initDb, db } from "../db";
import { createBooking } from "../bookings";
import { acceptBooking } from "../bookings-crm";
import { listDemands } from "../demands";
import { classifyOpenAmount } from "../collections";
import { ctxWithRoles, superAdminCtx } from "../authz/test-helpers";
import {
  createLoanCase,
  patchLoanCase,
  recordLoanEvent,
  putLoanDocuments,
  listProjectLoans,
  getBookingLoan,
  getLoanRisk,
} from "./core";
import { sweepLoanValidity, sweepLoanGapBreach } from "./sweep";

// 21-loans.md. Uses the shared demo-seeded db (b_v111 already carries an active seed loan_case,
// lc_v111 — deliberately reused for rule 1's "one active loan case per booking" negative test)
// plus fresh bookings created here for every mutation-heavy lifecycle test, same pattern
// events/actor-attribution.test.ts already established.

// user_id set to seed/users.ts's real seeded demo users (user_banking, user_accounts, ...) — the
// loan_event/loan_case FKs to "user"(id), same as financial_clearance/waiver/tds_record's own
// actor columns, so a synthetic ctxWithRoles() default ("test_user") isn't enough here.
function staffCtx(role: string, userId: string) {
  const c = ctxWithRoles([role]);
  c.actor.user_id = userId;
  return c;
}
const banking = staffCtx("BANKING", "user_banking");
const accounts = staffCtx("ACCOUNTS", "user_accounts");
const management = staffCtx("MANAGEMENT", "user_management");
const crm = staffCtx("CRM", "user_crm");
const sales = staffCtx("SALES", "user_sales");

const completeInput = {
  applicant: { display_name: "Vivek Nair", phone: "9998887771", pan: "LOANS1234A" },
  total_consideration: 9500000,
  docs: [
    { type: "PAN card", received: true },
    { type: "Address proof", received: true },
    { type: "Photograph", received: true },
  ],
};

let availableUnits: string[] = [];

const UNITS_NEEDED = 25;

beforeAll(async () => {
  await initDb();
  // Don't rely on however many units happen to still be "available" after seed.ts's own
  // booking fixtures consume some — insert a dedicated batch directly (same "create exactly
  // what this test needs via SQL" precedent as rls.test.ts's own project/unit fixtures).
  const node = await db.query<{ id: string }>(`SELECT id FROM project_hierarchy_node WHERE project_id = 'p_eastcrest' LIMIT 1`);
  const nodeId = node.rows[0]!.id;
  for (let i = 0; i < UNITS_NEEDED; i++) {
    const id = `u_loans_test_${i}`;
    await db.query(
      `INSERT INTO unit (id, project_id, unit_number, unit_type, facing, code, hierarchy_node_id, product_type, sale_status)
       VALUES ($1,'p_eastcrest',$2,'2BHK','EAST',$3,$4,'APARTMENT','available')`,
      [id, `LT${i}`, `U-LT${i}`, nodeId]
    );
    availableUnits.push(id);
  }
});

async function freshBooking(applicantSuffix: string): Promise<string> {
  const unitId = availableUnits.pop();
  if (!unitId) throw new Error("ran out of seeded available units for this test file");
  const b = await createBooking(
    unitId,
    { ...completeInput, applicant: { ...completeInput.applicant, phone: `98765${applicantSuffix.padStart(5, "0")}` } }, // exactly 10 digits
    superAdminCtx // booking setup only — same precedent as events/actor-attribution.test.ts
  );
  await acceptBooking(b!.id, superAdminCtx);
  return b!.id;
}

describe("createLoanCase — rule 1", () => {
  it("refuses a second active loan case for a booking that already has one (b_v111 / lc_v111 from seed)", async () => {
    await expect(createLoanCase("b_v111", { requested_amount_inr: 5_000_000 }, banking)).rejects.toThrow(/active loan case already exists/);
  });

  it("flips bank_disbursement_applicable=true and marks every open demand loan_dependent, on both REGISTRATION and HANDOVER clearance", async () => {
    const bookingId = await freshBooking("001");
    const before = await listDemands(bookingId);
    expect(before.some((d) => d.loan_dependent)).toBe(false);

    await createLoanCase(bookingId, { lender_name: "HDFC", requested_amount_inr: 8_000_000 }, banking);

    const after = await listDemands(bookingId);
    expect(after.every((d) => d.loan_dependent)).toBe(true);

    const clearanceReg = await db.query<{ checklist: { bank_disbursement_applicable: boolean } }>(
      `SELECT checklist FROM financial_clearance WHERE booking_id = $1 AND purpose = 'REGISTRATION'`,
      [bookingId]
    );
    const clearanceHandover = await db.query<{ checklist: { bank_disbursement_applicable: boolean } }>(
      `SELECT checklist FROM financial_clearance WHERE booking_id = $1 AND purpose = 'HANDOVER'`,
      [bookingId]
    );
    expect(clearanceReg.rows[0]!.checklist.bank_disbursement_applicable).toBe(true);
    expect(clearanceHandover.rows[0]!.checklist.bank_disbursement_applicable).toBe(true);

    const evt = await db.query(`SELECT type FROM event WHERE type = 'loan.application_submitted' AND entity_type = 'loan_case'`);
    expect(evt.rows.length).toBeGreaterThan(0);
  });
});

describe("recordLoanEvent — REJECTED/WITHDRAWN reverse rule 1's flip and raise a CRM action", () => {
  it("REJECTED flips loan_dependent and bank_disbursement_applicable back, emits loan.rejected, creates a CRM action", async () => {
    const bookingId = await freshBooking("002");
    const loan = await createLoanCase(bookingId, { requested_amount_inr: 8_000_000 }, banking);

    const rejected = await recordLoanEvent(loan.id, { type: "REJECTED", note: "lender declined" }, banking);
    expect(rejected.stage).toBe("REJECTED");

    const demands = await listDemands(bookingId);
    expect(demands.every((d) => !d.loan_dependent)).toBe(true);

    const clearance = await db.query<{ checklist: { bank_disbursement_applicable: boolean } }>(
      `SELECT checklist FROM financial_clearance WHERE booking_id = $1 AND purpose = 'REGISTRATION'`,
      [bookingId]
    );
    expect(clearance.rows[0]!.checklist.bank_disbursement_applicable).toBe(false);

    const action = await db.query(`SELECT id FROM action WHERE source_entity_id = $1 AND source_module = 'loans'`, [loan.id]);
    expect(action.rows.length).toBe(1);

    const evt = await db.query(`SELECT type FROM event WHERE type = 'loan.rejected' AND entity_id = $1`, [loan.id]);
    expect(evt.rows).toHaveLength(1);

    // A rejected loan is terminal — no further events accepted.
    await expect(recordLoanEvent(loan.id, { type: "SANCTIONED" }, banking)).rejects.toThrow(/REJECTED/);
  });

  it("WITHDRAWN emits loan.withdrawn, not loan.rejected (spec names only loan.rejected; reusing it would be a false audit trail)", async () => {
    const bookingId = await freshBooking("003");
    const loan = await createLoanCase(bookingId, { requested_amount_inr: 8_000_000 }, banking);
    await recordLoanEvent(loan.id, { type: "WITHDRAWN" }, banking);

    const withdrawn = await db.query(`SELECT type FROM event WHERE type = 'loan.withdrawn' AND entity_id = $1`, [loan.id]);
    expect(withdrawn.rows).toHaveLength(1);
    const rejected = await db.query(`SELECT type FROM event WHERE type = 'loan.rejected' AND entity_id = $1`, [loan.id]);
    expect(rejected.rows).toHaveLength(0);
  });
});

describe("SANCTIONED — recordLoanEvent requires the sanction terms to already be PATCHed in", () => {
  it("refuses SANCTIONED before sanctioned_amount_inr/sanction_date/sanction_validity_date are set", async () => {
    const bookingId = await freshBooking("004");
    const loan = await createLoanCase(bookingId, { requested_amount_inr: 8_000_000 }, banking);
    await expect(recordLoanEvent(loan.id, { type: "SANCTIONED" }, banking)).rejects.toThrow(/must be set/);
  });

  it("PATCH then SANCTIONED moves the stage and fires loan.sanction_received", async () => {
    const bookingId = await freshBooking("005");
    const loan = await createLoanCase(bookingId, { requested_amount_inr: 8_000_000 }, banking);
    await patchLoanCase(loan.id, { sanctioned_amount_inr: 7_500_000, sanction_date: "2026-01-01", sanction_validity_date: "2026-06-01" }, banking);
    const sanctioned = await recordLoanEvent(loan.id, { type: "SANCTIONED" }, banking);
    expect(sanctioned.stage).toBe("SANCTIONED");
    expect(sanctioned.sanctioned_amount_inr).toBe(7_500_000);
    const evt = await db.query(`SELECT type FROM event WHERE type = 'loan.sanction_received' AND entity_id = $1`, [loan.id]);
    expect(evt.rows).toHaveLength(1);
  });
});

describe("DISBURSED — rule 2's waterfall + tolerance", () => {
  it("refuses disbursement before SANCTIONED", async () => {
    const bookingId = await freshBooking("006");
    const loan = await createLoanCase(bookingId, { requested_amount_inr: 8_000_000 }, banking);
    await expect(recordLoanEvent(loan.id, { type: "DISBURSED", amount_inr: 1_000_000 }, banking)).rejects.toThrow(/sanctioned or later/);
  });

  it("refuses cumulative disbursement past sanctioned + 1% tolerance", async () => {
    const bookingId = await freshBooking("007");
    const loan = await createLoanCase(bookingId, { requested_amount_inr: 8_000_000 }, banking);
    await patchLoanCase(loan.id, { sanctioned_amount_inr: 5_000_000, sanction_date: "2026-01-01", sanction_validity_date: "2026-12-01" }, banking);
    await recordLoanEvent(loan.id, { type: "SANCTIONED" }, banking);
    await expect(recordLoanEvent(loan.id, { type: "DISBURSED", amount_inr: 5_100_001 }, banking)).rejects.toThrow(/tolerance/);
  });

  it("waterfalls a disbursement across loan-dependent demands (oldest-due first), creates LOAN_DISBURSEMENT receipts, settles demands, and reaches FULLY_DISBURSED within tolerance", async () => {
    const bookingId = await freshBooking("008");
    const loan = await createLoanCase(bookingId, { requested_amount_inr: 9_500_000 }, banking);
    await patchLoanCase(loan.id, { sanctioned_amount_inr: 9_500_000, sanction_date: "2026-01-01", sanction_validity_date: "2026-12-01" }, banking);
    await recordLoanEvent(loan.id, { type: "SANCTIONED" }, banking);

    const before = await listDemands(bookingId);
    const totalOutstanding = before.reduce((sum, d) => sum + d.remaining, 0);

    const disbursed = await recordLoanEvent(loan.id, { type: "DISBURSED", amount_inr: totalOutstanding }, banking);
    expect(disbursed.stage).toBe("FULLY_DISBURSED");
    expect(disbursed.disbursed_amount_inr).toBe(totalOutstanding);

    const after = await listDemands(bookingId);
    expect(after.every((d) => d.remaining === 0)).toBe(true);

    const receipts = await db.query(`SELECT mode FROM receipt WHERE booking_id = $1 AND mode = 'LOAN_DISBURSEMENT'`, [bookingId]);
    expect(receipts.rows.length).toBeGreaterThan(0);

    const evt = await db.query(`SELECT type FROM event WHERE type = 'loan.disbursement_received' AND entity_id = $1`, [loan.id]);
    expect(evt.rows).toHaveLength(1);
  });

  it("a partial disbursement lands PARTIALLY_DISBURSED, not FULLY_DISBURSED", async () => {
    const bookingId = await freshBooking("009");
    const loan = await createLoanCase(bookingId, { requested_amount_inr: 9_500_000 }, banking);
    await patchLoanCase(loan.id, { sanctioned_amount_inr: 9_500_000, sanction_date: "2026-01-01", sanction_validity_date: "2026-12-01" }, banking);
    await recordLoanEvent(loan.id, { type: "SANCTIONED" }, banking);
    const partial = await recordLoanEvent(loan.id, { type: "DISBURSED", amount_inr: 500_000 }, banking);
    expect(partial.stage).toBe("PARTIALLY_DISBURSED");
  });
});

describe("BLOCKER_RECORDED / BLOCKER_RESOLVED", () => {
  it("requires a note to record a blocker, and resolving clears it", async () => {
    const bookingId = await freshBooking("010");
    const loan = await createLoanCase(bookingId, { requested_amount_inr: 8_000_000 }, banking);
    await expect(recordLoanEvent(loan.id, { type: "BLOCKER_RECORDED" }, banking)).rejects.toThrow(/note/);

    const blocked = await recordLoanEvent(loan.id, { type: "BLOCKER_RECORDED", note: "missing salary slips" }, banking);
    expect(blocked.blocker).toBe("missing salary slips");
    const evt = await db.query(`SELECT type FROM event WHERE type = 'loan.blocker_recorded' AND entity_id = $1`, [loan.id]);
    expect(evt.rows).toHaveLength(1);

    const resolved = await recordLoanEvent(loan.id, { type: "BLOCKER_RESOLVED" }, banking);
    expect(resolved.blocker).toBeNull();
    const resolvedEvt = await db.query(`SELECT type FROM event WHERE type = 'loan.blocker_resolved' AND entity_id = $1`, [loan.id]);
    expect(resolvedEvt.rows).toHaveLength(1);
  });
});

describe("DOCS_REQUESTED / DISBURSEMENT_REQUESTED — forward-only stage advances, logged as loan.stage_changed", () => {
  it("DOCS_REQUESTED advances APPLICATION to DOCS_PENDING and fires loan.stage_changed", async () => {
    const bookingId = await freshBooking("017");
    const loan = await createLoanCase(bookingId, { requested_amount_inr: 8_000_000 }, banking);
    const advanced = await recordLoanEvent(loan.id, { type: "DOCS_REQUESTED" }, banking);
    expect(advanced.stage).toBe("DOCS_PENDING");
    const evt = await db.query(`SELECT type, payload FROM event WHERE type = 'loan.stage_changed' AND entity_id = $1`, [loan.id]);
    expect(evt.rows).toHaveLength(1);
  });

  it("DOCS_REQUESTED can legitimately move a loan back to DOCS_PENDING even after SANCTIONED (rule 4's own expiry path does the same move)", async () => {
    const bookingId = await freshBooking("018");
    const loan = await createLoanCase(bookingId, { requested_amount_inr: 8_000_000 }, banking);
    await patchLoanCase(loan.id, { sanctioned_amount_inr: 8_000_000, sanction_date: "2026-01-01", sanction_validity_date: "2026-12-01" }, banking);
    await recordLoanEvent(loan.id, { type: "SANCTIONED" }, banking);
    const after = await recordLoanEvent(loan.id, { type: "DOCS_REQUESTED" }, banking);
    expect(after.stage).toBe("DOCS_PENDING");
  });

  it("DOCS_REQUESTED never regresses a loan that has already started disbursing", async () => {
    const bookingId = await freshBooking("019");
    const loan = await createLoanCase(bookingId, { requested_amount_inr: 8_000_000 }, banking);
    await patchLoanCase(loan.id, { sanctioned_amount_inr: 8_000_000, sanction_date: "2026-01-01", sanction_validity_date: "2026-12-01" }, banking);
    await recordLoanEvent(loan.id, { type: "SANCTIONED" }, banking);
    await recordLoanEvent(loan.id, { type: "DISBURSED", amount_inr: 100_000 }, banking);
    const after = await recordLoanEvent(loan.id, { type: "DOCS_REQUESTED" }, banking);
    expect(after.stage).toBe("PARTIALLY_DISBURSED");
  });
});

describe("putLoanDocuments — derives missing_docs from REQUIRED-not-yet-RECEIVED/VERIFIED", () => {
  it("populates and then clears missing_docs as documents come in", async () => {
    const bookingId = await freshBooking("011");
    const loan = await createLoanCase(bookingId, { requested_amount_inr: 8_000_000 }, banking);

    const staged = await putLoanDocuments(loan.id, [{ category: "salary_slip" }, { category: "bank_statement" }], banking);
    expect(staged.missing_docs.sort()).toEqual(["bank_statement", "salary_slip"]);

    const partial = await putLoanDocuments(loan.id, [{ category: "salary_slip", status: "VERIFIED" }], banking);
    expect(partial.missing_docs).toEqual(["bank_statement"]);
  });
});

describe("getLoanRisk — rule 3's timing gap, computed from real facts", () => {
  it("reports a negative gap and the TIMING_GAP driver when the next demand is due before the expected disbursement date", async () => {
    const bookingId = await freshBooking("012");
    const loan = await createLoanCase(bookingId, { requested_amount_inr: 8_000_000 }, banking);
    // The first demand (booking token) already carries a real due_date (today, from setupFunding) —
    // set an expected_disbursement_date well past it to force a negative gap.
    await patchLoanCase(loan.id, { expected_disbursement_date: "2099-01-01" }, banking);

    const risk = await getLoanRisk(loan.id, banking);
    expect(risk.days_to_demand).not.toBeNull();
    expect(risk.days_to_disbursement).not.toBeNull();
    expect(risk.drivers.map((d) => d.code)).toContain("TIMING_GAP");

    const persisted = await db.query<{ risk_score: number }>(`SELECT risk_score FROM loan_case WHERE id = $1`, [loan.id]);
    expect(persisted.rows[0]!.risk_score).toBe(risk.score);
  });
});

describe("sweepLoanValidity — rule 4", () => {
  it("raises a Banking action when validity is within the warning window, and flags EXPIRING vs EXPIRED", async () => {
    const bookingId = await freshBooking("013");
    const loan = await createLoanCase(bookingId, { requested_amount_inr: 8_000_000 }, banking);
    await patchLoanCase(loan.id, { sanctioned_amount_inr: 8_000_000, sanction_date: "2026-01-01", sanction_validity_date: "2026-01-06" }, banking);
    await recordLoanEvent(loan.id, { type: "SANCTIONED" }, banking);

    const results = await sweepLoanValidity("2026-01-01"); // 5 days left, within the 7-day window
    const mine = results.find((r) => r.loan_id === loan.id);
    expect(mine?.kind).toBe("EXPIRING");

    const action = await db.query(`SELECT owner_role FROM action WHERE id = $1`, [mine!.action_id]);
    expect(action.rows[0]!.owner_role).toBe("BANKING");
  });

  it("expired validity flips stage to DOCS_PENDING with blocker 'Sanction expired'", async () => {
    const bookingId = await freshBooking("014");
    const loan = await createLoanCase(bookingId, { requested_amount_inr: 8_000_000 }, banking);
    await patchLoanCase(loan.id, { sanctioned_amount_inr: 8_000_000, sanction_date: "2025-01-01", sanction_validity_date: "2026-01-01" }, banking);
    await recordLoanEvent(loan.id, { type: "SANCTIONED" }, banking);

    const results = await sweepLoanValidity("2026-01-10"); // 9 days past validity
    const mine = results.find((r) => r.loan_id === loan.id);
    expect(mine?.kind).toBe("EXPIRED");

    const row = await db.query<{ stage: string; blocker: string }>(`SELECT stage, blocker FROM loan_case WHERE id = $1`, [loan.id]);
    expect(row.rows[0]!.stage).toBe("DOCS_PENDING");
    expect(row.rows[0]!.blocker).toBe("Sanction expired");
  });
});

describe("sweepLoanGapBreach — rule 6: an on-track loan whose gap breaches > 15 d rejoins true risk", () => {
  it("flips loan_dependent back to false once the breach threshold is crossed, and the demand then classifies as OVERDUE/TRUE_RISK like any other open demand", async () => {
    const bookingId = await freshBooking("015");
    const loan = await createLoanCase(bookingId, { requested_amount_inr: 8_000_000 }, banking);
    // setupFunding's first demand carries a real due_date = today() (the actual system clock,
    // not a value this test controls) — pin it to a fixed date directly so the gap math below is
    // deterministic regardless of when this test happens to run.
    await db.query(
      `UPDATE demand SET due_date = '2026-01-01' WHERE booking_id = $1 AND sequence = (SELECT MIN(sequence) FROM demand WHERE booking_id = $1 AND due_date IS NOT NULL)`,
      [bookingId]
    );
    // expected_disbursement_date 20 days after the (now-fixed) demand due date -> gap = -20, breaches the 15d threshold
    await patchLoanCase(loan.id, { expected_disbursement_date: "2026-01-21" }, banking);

    const before = await listDemands(bookingId);
    expect(before.some((d) => d.loan_dependent)).toBe(true);

    const breaches = await sweepLoanGapBreach("2026-01-01");
    expect(breaches.find((b) => b.loan_id === loan.id)).toBeTruthy();

    const after = await listDemands(bookingId);
    expect(after.every((d) => !d.loan_dependent)).toBe(true);

    // p37 §31.5 t3: a loan-dependent demand is excluded from TRUE_RISK by classifyOpenAmount;
    // once loan_dependent flips false, the same overdue/low-recovery facts now do route there.
    const demand = after.find((d) => d.remaining > 0)!;
    const bucketWhileLoanDependent = classifyOpenAmount({
      remaining: demand.remaining,
      status: demand.status,
      due_date: demand.due_date,
      as_of: "2026-01-01",
      loan_dependent: true,
      has_active_ptp: demand.has_active_ptp,
      recovery_probability: 0.1,
      true_risk_threshold: 0.4,
    });
    const bucketAfterBreach = classifyOpenAmount({
      remaining: demand.remaining,
      status: "overdue",
      due_date: demand.due_date,
      as_of: "2026-01-01",
      loan_dependent: false,
      has_active_ptp: demand.has_active_ptp,
      recovery_probability: 0.1,
      true_risk_threshold: 0.4,
    });
    expect(bucketWhileLoanDependent).toBe("LOAN_DEPENDENT");
    expect(bucketAfterBreach).toBe("TRUE_RISK");
  });
});

describe("listProjectLoans / getBookingLoan", () => {
  it("filters by stage and risk, and getBookingLoan returns the most recent case for a booking", async () => {
    const loans = await listProjectLoans("p_eastcrest", undefined, management);
    expect(loans.some((l) => l.id === "lc_v111")).toBe(true);

    const docsPending = await listProjectLoans("p_eastcrest", { stage: "DOCS_PENDING" }, management);
    expect(docsPending.every((l) => l.stage === "DOCS_PENDING")).toBe(true);

    const b_v111Loan = await getBookingLoan("b_v111", management);
    expect(b_v111Loan?.id).toBe("lc_v111");
  });
});

// permission_matrix's real `loans` row (seed/permissions.ts, §1.3 verbatim) is
// MANAGEMENT=R ACCOUNTS=R BANKING=W CRM=R SALES=N — narrower than 21-loans.md's own rule 7 prose
// ("writers Banking/Accounts/Management"), which matches §6's routers/loans.py finding instead.
// Tests assert what the seeded matrix actually enforces (core.ts's header explains why §1.3 wins
// here); flagged as an open question for Amarsh in TODO.md rather than silently widened.
describe("rule 7 (as the seeded §1.3 matrix enforces it) — BANKING writes; MANAGEMENT/ACCOUNTS/CRM read-only; SALES no access", () => {
  it("SALES cannot even read; CRM/ACCOUNTS/MANAGEMENT can read but not write; only BANKING can write", async () => {
    await expect(getBookingLoan("b_v111", sales)).rejects.toThrow();
    await expect(getBookingLoan("b_v111", crm)).resolves.toBeTruthy();
    await expect(getBookingLoan("b_v111", accounts)).resolves.toBeTruthy();
    await expect(getBookingLoan("b_v111", management)).resolves.toBeTruthy();

    const bookingId = await freshBooking("016");
    await expect(createLoanCase(bookingId, { requested_amount_inr: 1_000_000 }, crm)).rejects.toThrow();
    await expect(createLoanCase(bookingId, { requested_amount_inr: 1_000_000 }, sales)).rejects.toThrow();
    await expect(createLoanCase(bookingId, { requested_amount_inr: 1_000_000 }, accounts)).rejects.toThrow();
    await expect(createLoanCase(bookingId, { requested_amount_inr: 1_000_000 }, management)).rejects.toThrow();

    const created = await createLoanCase(bookingId, { requested_amount_inr: 1_000_000 }, banking);
    expect(created.stage).toBe("APPLICATION");
  });
});

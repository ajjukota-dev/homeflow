import { db } from "../db";
import { bookingFinance } from "../finance";
import { trendFrom, topDrivers, type Score, type ScoreDriver } from "./contract";
import { previousValue, persistSnapshot } from "./store";

// Rule 2. Real components: payments (19's `bookingFinance().cleared`), TDS (24's tds_record),
// loan state (21's loan_case, only when one exists), agreement executed, registration done,
// customer-side actions waiting. Flagged, not faked: "documents verified share (17/22)" has no
// real source — 17 (sales→CRM handover packet) and 22 (document factory) are both unbuilt, so
// that component is excluded from the weighted average (not scored 0, which would misreport a
// real deficiency as a modeled one) and surfaced as its own LOW-confidence driver instead.

const WEIGHTS = { payments: 0.35, tds: 0.15, loan: 0.15, agreement: 0.15, registration: 0.1, customerActions: 0.1 };
const DOCUMENTS_UNAVAILABLE_REASON = "documents component (17/22) is not yet available — excluded from the weighted value, surfaced as a separate driver instead of guessed";

async function build(bookingId: string): Promise<{ value: number; allDrivers: ScoreDriver[]; actions: { action_type: string; title: string; target: string }[]; projectId: string | null }> {
  const finance = await bookingFinance(bookingId);
  const paymentsScore = finance.cleared ? 1 : finance.paid_pct > 0 ? 0.6 : 0;

  const tds = await db.query<{ total: number; verified: number }>(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'VERIFIED')::int AS verified FROM tds_record WHERE booking_id = $1 AND applicability != 'NOT_APPLICABLE'`,
    [bookingId]
  );
  const tdsScore = tds.rows[0].total === 0 ? 1 : tds.rows[0].verified / tds.rows[0].total;

  const loan = await db.query<{ stage: string }>(`SELECT stage FROM loan_case WHERE booking_id = $1 ORDER BY created_at DESC LIMIT 1`, [bookingId]);
  const loanApplicable = loan.rows.length > 0;
  const loanScore = !loanApplicable ? 1 : loan.rows[0].stage === "FULLY_DISBURSED" || loan.rows[0].stage === "CLOSED" ? 1 : loan.rows[0].stage === "PARTIALLY_DISBURSED" ? 0.6 : 0;

  const legal = await db.query<{ id: string }>(`SELECT id FROM generated_document WHERE booking_id = $1 AND status IN ('executed','archived') LIMIT 1`, [bookingId]);
  const agreementScore = legal.rows.length > 0 ? 1 : 0;

  const reg = await db.query<{ status: string }>(`SELECT status FROM registration_case WHERE booking_id = $1`, [bookingId]);
  const registrationScore = reg.rows[0]?.status === "completed" ? 1 : 0;

  const waiting = await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM action WHERE booking_id = $1 AND status = 'Waiting Customer'`, [bookingId]);
  const waitingCount = waiting.rows[0]?.count ?? 0;
  const customerActionsScore = waitingCount === 0 ? 1 : waitingCount <= 2 ? 0.6 : 0;

  const value = Math.round(
    100 * (
      WEIGHTS.payments * paymentsScore + WEIGHTS.tds * tdsScore + WEIGHTS.loan * loanScore +
      WEIGHTS.agreement * agreementScore + WEIGHTS.registration * registrationScore + WEIGHTS.customerActions * customerActionsScore
    )
  );

  const allDrivers: ScoreDriver[] = [
    { code: "PAYMENTS", label: finance.cleared ? "Financial clearance met" : "Financial clearance not yet met", contribution: Math.round(WEIGHTS.payments * 100 * (1 - paymentsScore)), fact: finance.reason ?? `${Math.round(finance.paid_pct * 100)}% paid` },
    { code: "TDS", label: tdsScore < 1 ? "TDS verification pending" : "TDS verified", contribution: Math.round(WEIGHTS.tds * 100 * (1 - tdsScore)), fact: `${tds.rows[0].verified}/${tds.rows[0].total} TDS records verified` },
    { code: "AGREEMENT", label: agreementScore === 1 ? "Agreement executed" : "Agreement not yet executed", contribution: Math.round(WEIGHTS.agreement * 100 * (1 - agreementScore)), fact: agreementScore === 1 ? "executed" : "no executed agreement on file" },
    { code: "REGISTRATION", label: registrationScore === 1 ? "Registration complete" : "Registration not yet complete", contribution: Math.round(WEIGHTS.registration * 100 * (1 - registrationScore)), fact: reg.rows[0]?.status ?? "not started" },
    { code: "CUSTOMER_ACTIONS", label: `${waitingCount} action(s) waiting on the customer`, contribution: Math.round(WEIGHTS.customerActions * 100 * (1 - customerActionsScore)), fact: `${waitingCount} open` },
    ...(loanApplicable ? [{ code: "LOAN", label: `Loan case: ${loan.rows[0].stage}`, contribution: Math.round(WEIGHTS.loan * 100 * (1 - loanScore)), fact: loan.rows[0].stage } as ScoreDriver] : []),
    { code: "DOCUMENTS", label: "Data not yet available: documents (17/22)", contribution: 0, fact: "sales→CRM handover packet (17) and document factory (22) are not built" },
  ];

  const actions = allDrivers.filter((d) => d.contribution > 0 && d.code !== "DOCUMENTS").map((d) => ({ action_type: "exec_simple", title: `Resolve: ${d.label}`, target: d.code }));
  const b = await db.query<{ project_id: string }>(`SELECT project_id FROM booking WHERE id = $1`, [bookingId]);
  return { value, allDrivers, actions, projectId: b.rows[0]?.project_id ?? null };
}

export async function computeBookingReadiness(bookingId: string): Promise<Score> {
  const { value, allDrivers, actions, projectId } = await build(bookingId);
  const previous = await previousValue("BOOKING_READINESS", bookingId);
  const score: Score = {
    value,
    trend: trendFrom(value, previous),
    drivers: topDrivers(allDrivers.filter((d) => d.code !== "DOCUMENTS"), 3),
    confidence: "MEDIUM",
    confidence_reason: DOCUMENTS_UNAVAILABLE_REASON,
    actions,
  };
  await persistSnapshot("BOOKING_READINESS", "booking", bookingId, projectId, score);
  return score;
}

/** Rule 5's `.../explain` — the full contribution table, including the DOCUMENTS placeholder
 *  driver the top-3 view excludes. */
export async function explainBookingReadiness(bookingId: string): Promise<Score> {
  const { value, allDrivers, actions } = await build(bookingId);
  const previous = await previousValue("BOOKING_READINESS", bookingId);
  return { value, trend: trendFrom(value, previous), drivers: allDrivers, confidence: "MEDIUM", confidence_reason: DOCUMENTS_UNAVAILABLE_REASON, actions };
}

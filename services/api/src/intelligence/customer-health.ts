import { db } from "../db";
import { trendFrom, topDrivers, type Score, type ScoreDriver, type ScoreAction } from "../scores/contract";
import { previousValue } from "../scores/store";
import { recordScore } from "./shared";

// 31-intelligence.md rule 1 — Customer Health, rules over: check-in scores (30/26's own
// `customer_check_in`, not the pre-26 `checkin_record`), open escalations (12), overdue ₹ (19),
// breached/at-risk commitments (13), unresolved inbound comms (29), pending customer action age
// (10), sentiment (31 itself — only after a human accepts the LLM suggestion, per rule 5's
// explainability rule; `communication.sentiment` is written ONLY on acceptance, so reading it
// directly already respects that gate with no extra join). Drivers name facts, never staff (rule
// 1's own text).
//
// Replaces `views/customer-360.ts`'s own interim formula (28's own Build note named this
// spec — 31 — as the real owner). BASELINE=80 and the check-in/escalation/overdue weights are
// carried over unchanged from that interim so behaviour doesn't jump the day 31 lands; the three
// new drivers (commitments/comms/action-age) are additive. All weights UNCONFIRMED — no PDF
// number for this formula, same class as 06/14/20's other placeholder formulas.

const BASELINE = 80;
const PENDING_ACTION_AGE_FREE_DAYS = 3; // UNCONFIRMED — no client number for "how old is too old"

interface Built { value: number; allDrivers: ScoreDriver[]; actions: ScoreAction[] }

async function build(customerId: string): Promise<Built> {
  let value = BASELINE;
  const allDrivers: ScoreDriver[] = [];
  const actions: ScoreAction[] = [];

  const checkins = await db.query<{ avg: number | null }>(
    `SELECT avg(ci.score)::float8 AS avg FROM customer_check_in ci
       JOIN booking b ON b.id = ci.booking_id JOIN booking_applicant a ON a.booking_id = b.id
      WHERE a.customer_id = $1 AND ci.score IS NOT NULL`,
    [customerId]
  );
  const avgCheckin = checkins.rows[0]?.avg ?? null;
  if (avgCheckin !== null && avgCheckin < 3) {
    const penalty = Math.round((3 - avgCheckin) * 8);
    value -= penalty;
    allDrivers.push({ code: "CHECKIN_LOW", label: "Low check-in satisfaction", contribution: penalty, fact: `average check-in score ${avgCheckin.toFixed(1)}/5` });
  }

  const esc = await db.query<{ count: string }>(
    `SELECT count(*) AS count FROM escalation e JOIN action a ON a.id = e.action_id
      WHERE a.customer_id = $1 AND e.status NOT IN ('RESOLVED', 'CLOSED')`,
    [customerId]
  );
  const escCount = Number(esc.rows[0]?.count ?? 0);
  if (escCount > 0) {
    const penalty = 10 * escCount;
    value -= penalty;
    allDrivers.push({ code: "OPEN_ESCALATION", label: `${escCount} open escalation(s)`, contribution: penalty, fact: `${escCount} escalation(s) not yet resolved` });
    actions.push({ action_type: "exec_simple", title: "Resolve open escalation", target: customerId });
  }

  const overdue = await db.query<{ total: number; max_days: number }>(
    `SELECT COALESCE(SUM(d.amount), 0)::float8 AS total,
            COALESCE(MAX(GREATEST(0, (CURRENT_DATE - d.due_date))), 0)::int AS max_days
       FROM demand d JOIN booking b ON b.id = d.booking_id JOIN booking_applicant a ON a.booking_id = b.id
      WHERE a.customer_id = $1 AND d.status = 'overdue'`,
    [customerId]
  );
  const overdueTotal = overdue.rows[0]?.total ?? 0;
  if (overdueTotal > 0) {
    const penalty = 15;
    value -= penalty;
    const days = overdue.rows[0]?.max_days ?? 0;
    allDrivers.push({ code: "OVERDUE_AMOUNT", label: "Overdue payment", contribution: penalty, fact: `₹${overdueTotal.toLocaleString("en-IN")} overdue, up to ${days} day(s)` });
    actions.push({ action_type: "exec_simple", title: "Follow up on overdue payment", target: customerId });
  }

  const commitments = await db.query<{ count: string }>(
    `SELECT count(*) AS count FROM commitment WHERE customer_id = $1 AND status IN ('BREACHED', 'AT_RISK')`,
    [customerId]
  );
  const commitmentCount = Number(commitments.rows[0]?.count ?? 0);
  if (commitmentCount > 0) {
    const penalty = 12 * commitmentCount;
    value -= penalty;
    allDrivers.push({ code: "COMMITMENT_RISK", label: `${commitmentCount} breached/at-risk commitment(s)`, contribution: penalty, fact: `${commitmentCount} commitment(s) breached or at risk` });
  }

  const comms = await db.query<{ count: string }>(
    `SELECT count(*) AS count FROM communication c LEFT JOIN action a ON a.id = c.follow_up_action_id
      WHERE c.customer_id = $1 AND c.direction = 'INBOUND' AND c.follow_up_required = true
        AND (a.id IS NULL OR a.status NOT IN ('Closed', 'Cancelled'))`,
    [customerId]
  );
  const commsCount = Number(comms.rows[0]?.count ?? 0);
  if (commsCount > 0) {
    const penalty = 6 * commsCount;
    value -= penalty;
    allDrivers.push({ code: "UNRESOLVED_COMMS", label: `${commsCount} unresolved inbound communication(s)`, contribution: penalty, fact: `${commsCount} inbound communication(s) still awaiting follow-up` });
  }

  const pendingAction = await db.query<{ age_days: number }>(
    `SELECT COALESCE(MAX(GREATEST(0, EXTRACT(EPOCH FROM (now() - created.at)) / 86400)), 0)::int AS age_days
       FROM action a
       CROSS JOIN LATERAL (
         SELECT COALESCE((SELECT MIN(occurred_at) FROM event WHERE entity_type = 'action' AND entity_id = a.id AND type = 'action.created'), now()) AS at
       ) created
      WHERE a.customer_id = $1 AND a.customer_visible = true AND a.status NOT IN ('Closed', 'Cancelled')`,
    [customerId]
  );
  const ageDays = pendingAction.rows[0]?.age_days ?? 0;
  if (ageDays > PENDING_ACTION_AGE_FREE_DAYS) {
    const penalty = Math.min(15, (ageDays - PENDING_ACTION_AGE_FREE_DAYS) * 2);
    value -= penalty;
    allDrivers.push({ code: "PENDING_ACTION_AGE", label: "Aging pending customer action", contribution: penalty, fact: `oldest customer-visible action open ${ageDays} day(s)` });
  }

  const sentiment = await db.query<{ count: string }>(
    `SELECT count(*) AS count FROM communication WHERE customer_id = $1 AND sentiment = 'NEGATIVE'`,
    [customerId]
  );
  const negativeSentiment = Number(sentiment.rows[0]?.count ?? 0);
  if (negativeSentiment > 0) {
    const penalty = 5 * negativeSentiment;
    value -= penalty;
    allDrivers.push({ code: "NEGATIVE_SENTIMENT", label: `${negativeSentiment} communication(s) with negative sentiment`, contribution: penalty, fact: `${negativeSentiment} accepted sentiment suggestion(s) read negative` });
  }

  return { value: Math.max(0, Math.min(100, value)), allDrivers, actions };
}

export async function computeCustomerHealth(customerId: string): Promise<Score> {
  const { value, allDrivers, actions } = await build(customerId);
  const previous = await previousValue("CUSTOMER_HEALTH", customerId);
  const score: Score = {
    value,
    trend: trendFrom(value, previous),
    drivers: topDrivers(allDrivers, 3),
    confidence: "MEDIUM",
    confidence_reason: "rule-based composite over 6 named signals — weights are UNCONFIRMED placeholders, no PDF number given",
    actions,
  };
  await recordScore("CUSTOMER_HEALTH", "customer", customerId, null, score, previous);
  return score;
}

export async function explainCustomerHealth(customerId: string): Promise<Score> {
  const { value, allDrivers, actions } = await build(customerId);
  const previous = await previousValue("CUSTOMER_HEALTH", customerId);
  return {
    value,
    trend: trendFrom(value, previous),
    drivers: allDrivers,
    confidence: "MEDIUM",
    confidence_reason: "rule-based composite over 6 named signals — weights are UNCONFIRMED placeholders, no PDF number given",
    actions,
  };
}

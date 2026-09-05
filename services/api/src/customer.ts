import { db } from "./db";
import { deriveGate, type ChangeGateRule, type ProgressState } from "./gates";
import { t2Payments } from "./collections-view";
import { t4Passport, t5Legal, t6Keys } from "./transparency";
import { handoverForBooking } from "./qa";

// My Pranava Home (customer) projection — the H10-filtered, approved view.
// T1: coarse construction stages. T3: friendly personalisation windows.
// Only customer-safe fields cross; no vendor/cost/internal state (customer-transparency.md).

// CustomerStageMap — fine components → coarse customer stages (Policy Studio config).
const CUSTOMER_STAGES: { label: string; component: string; min_state: ProgressState }[] = [
  { label: "Foundation", component: "structure", min_state: "in_progress" },
  { label: "Structure", component: "structure", min_state: "complete" },
  { label: "MEP & walls", component: "mep_first_fix", min_state: "complete" },
  { label: "Finishing", component: "finishing", min_state: "complete" },
  { label: "Ready", component: "finishing", min_state: "verified" },
];

const rank: Record<ProgressState, number> = { not_started: 0, in_progress: 1, complete: 2, verified: 3 };

async function progressFor(unitId: string): Promise<Record<string, ProgressState>> {
  const r = await db.query<{ component_code: string; state_code: ProgressState }>(
    `SELECT component_code, state_code FROM unit_progress WHERE unit_id = $1`,
    [unitId]
  );
  const map: Record<string, ProgressState> = {};
  for (const row of r.rows) map[row.component_code] = row.state_code;
  return map;
}

function friendlyWindow(state: string): string {
  switch (state) {
    case "OPEN":
    case "CLOSING":
      return "Open";
    case "CONDITIONAL":
      return "Possible with review";
    default:
      return "Window closed";
  }
}

export async function getCustomerHome(bookingId: string) {
  const b = await db.query<{
    unit_id: string;
    status: string;
    total_consideration: number;
    unit_number: string;
    unit_type: string;
    facing: string;
    customer_name: string;
    project_id: string;
    project_name: string;
  }>(
    `SELECT b.unit_id, b.status, b.total_consideration::float8 AS total_consideration,
            b.project_id, p.name AS project_name,
            u.unit_number, u.unit_type, u.facing, a.display_name AS customer_name
       FROM booking b JOIN unit u ON u.id = b.unit_id
       JOIN project p ON p.id = b.project_id
       LEFT JOIN booking_applicant a ON a.booking_id = b.id AND a.role = 'primary'
      WHERE b.id = $1`,
    [bookingId]
  );
  if (b.rows.length === 0) return null;
  const bk = b.rows[0];

  const progress = await progressFor(bk.unit_id);

  // T1 — stages
  const stages = CUSTOMER_STAGES.map((s) => {
    const done = rank[progress[s.component] ?? "not_started"] >= rank[s.min_state];
    return { label: s.label, done };
  });
  const firstPending = stages.findIndex((s) => !s.done);
  const current_stage = firstPending === -1 ? "Ready" : stages[firstPending].label;
  const next_stage = firstPending === -1 || firstPending + 1 >= stages.length ? null : stages[firstPending + 1].label;

  // T3 — personalisation windows (customer-visible categories only)
  const cats = await db.query<{ code: string; customer_label: string }>(
    `SELECT code, customer_label FROM change_category WHERE customer_visible = true ORDER BY sort_order`
  );
  const rules = (
    await db.query<ChangeGateRule>(
      `SELECT category_code, trigger_component_code, min_state, resulting_state FROM change_gate_rule`
    )
  ).rows;
  const personalisation = cats.rows.map((c) => ({
    label: c.customer_label,
    window: friendlyWindow(deriveGate(c.code, progress, rules).state),
  }));

  const payments = await t2Payments(bookingId, progress);
  const passport = await t4Passport(bk.unit_id);
  const legal = await t5Legal(bookingId, bk.project_id);
  const ho = await handoverForBooking(bookingId);
  const keys = await t6Keys(bookingId, ho.eligible, ho.lifecycle === "completed", progress);

  return {
    customer_name: bk.customer_name,
    project_name: bk.project_name,
    unit_number: bk.unit_number,
    unit_type: bk.unit_type,
    facing: bk.facing,
    booking_status: bk.status,
    total_consideration: bk.total_consideration,
    stages: stages.map((s, i) => ({
      label: s.label,
      state: s.done ? "done" : i === firstPending ? "current" : "upcoming",
    })),
    current_stage,
    next_stage,
    personalisation,
    payments,
    passport,
    legal,
    keys,
  };
}

/** The active customer's booking (helper so the portal can resolve "me"). */
export async function firstActiveBooking() {
  const r = await db.query<{ id: string }>(
    `SELECT id FROM booking WHERE status = 'active' ORDER BY booking_number LIMIT 1`
  );
  return r.rows[0]?.id ?? null;
}

// 01-identity-access.md Rule 4: a logged-in customer must only ever resolve
// to their OWN booking via customer_login — never firstActiveBooking(),
// which would leak another customer's data to whoever is signed in.
export async function bookingForCustomerUser(userId: string) {
  const r = await db.query<{ booking_id: string }>(`SELECT booking_id FROM customer_login WHERE user_id = $1`, [userId]);
  return r.rows[0]?.booking_id ?? null;
}

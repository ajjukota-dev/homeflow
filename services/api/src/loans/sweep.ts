import { appendEvent, withTx, type DbLike } from "../events";
import { createAction } from "../actions/core";
import { today, DEMAND_SELECT, mapDemands } from "../demands";
import { VALIDITY_WARNING_DAYS } from "./risk";

// 21-loans.md rule 4 (validity expiry) and rule 6 (loan-dependent demands rejoin true risk on
// breach). No scheduler/cron exists anywhere in this codebase (same gap already flagged for 06's
// ON_DATE_OFFSET triggers, 19's grace-window sweep, and 19's pre-breach ladder) — this is the
// logic a real nightly job would call. Callable directly with a controlled `asOf`, run by
// loans.test.ts, not invoked automatically today.
//
// Rule 4's "escalation [E §11.1]" fires as a Banking createAction instead of a real escalation
// row — spec 12 (escalations & notifications) isn't built yet, same substitute pattern the rest
// of this codebase already uses for its own unbuilt forward dependencies (05's migration Action,
// 19's overdue-reason reminder).

const GAP_BREACH_THRESHOLD_DAYS = 15; // rule 6's own literal ("> 15 d (config)")
const MS_PER_DAY = 86_400_000;

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY);
}

interface SweepableLoan {
  id: string;
  code: string;
  booking_id: string;
  project_id: string;
  stage: string;
  sanction_validity_date: string | null;
  expected_disbursement_date: string | null;
}

async function sweepableLoans(tx: DbLike): Promise<SweepableLoan[]> {
  const r = await tx.query<SweepableLoan>(
    `SELECT id, code, booking_id, project_id, stage, sanction_validity_date::text AS sanction_validity_date,
            expected_disbursement_date::text AS expected_disbursement_date
       FROM loan_case
      WHERE stage NOT IN ('CLOSED', 'REJECTED', 'WITHDRAWN', 'FULLY_DISBURSED')`
  );
  return r.rows;
}

export interface ValidityAction {
  loan_id: string;
  action_id: string;
  kind: "EXPIRING" | "EXPIRED";
}

/** Rule 4: validity within VALIDITY_WARNING_DAYS and not fully disbursed -> a Banking action
 *  (stand-in for 12's escalation); already-expired -> stage DOCS_PENDING with a "Sanction
 *  expired" blocker, on top of the action. Idempotent on the blocker text (re-running a day the
 *  blocker's already set is a no-op for that half); the action itself is NOT deduped across sweep
 *  runs, same known limitation 19's own overdue-reason sweep documents for its own reminder
 *  action, since neither has a real scheduler to dedupe against yet. */
export async function sweepLoanValidity(asOf: string = today(), tx?: DbLike): Promise<ValidityAction[]> {
  return withTx(tx, async (t) => {
    const loans = await sweepableLoans(t);
    const results: ValidityAction[] = [];
    for (const loan of loans) {
      if (!loan.sanction_validity_date) continue;
      const daysLeft = daysBetween(asOf, loan.sanction_validity_date);
      if (daysLeft > VALIDITY_WARNING_DAYS) continue;

      const expired = daysLeft < 0;
      if (expired && loan.stage !== "DOCS_PENDING") {
        await t.query(`UPDATE loan_case SET stage = 'DOCS_PENDING', blocker = 'Sanction expired' WHERE id = $1`, [loan.id]);
      }
      const actionId = await createAction(
        {
          type: "exec_simple",
          title: expired ? `${loan.code}: sanction validity expired` : `${loan.code}: sanction validity expires in ${daysLeft} day(s)`,
          project_id: loan.project_id,
          source_module: "loans",
          source_entity_type: "loan_case",
          source_entity_id: loan.id,
          booking_id: loan.booking_id,
          owner_role: "BANKING",
          priority: expired ? "HIGH" : "MEDIUM",
          origin: "AUTO",
        },
        t
      );
      results.push({ loan_id: loan.id, action_id: actionId, kind: expired ? "EXPIRED" : "EXPIRING" });
    }
    return results;
  });
}

export interface GapBreach {
  loan_id: string;
  demand_ids: string[];
}

/** Rule 6: "loan-dependent demands never appear in true risk while the loan is on track; they
 *  move to true risk when stage is REJECTED/WITHDRAWN or gap breaches by > 15 d (config)."
 *  REJECTED/WITHDRAWN is already handled at the point of rejection (recordLoanEvent flips
 *  loan_dependent back false immediately) — this covers the other half: an on-track loan whose
 *  timing gap has quietly breached the threshold. Flipping loan_dependent to false is sufficient
 *  by construction — collections.ts's classifyOpenAmount already routes a non-loan-dependent,
 *  overdue, low-recovery-probability demand to TRUE_RISK; no separate "true risk" write exists
 *  to duplicate. */
export async function sweepLoanGapBreach(asOf: string = today(), tx?: DbLike): Promise<GapBreach[]> {
  return withTx(tx, async (t) => {
    const loans = await sweepableLoans(t);
    const results: GapBreach[] = [];
    for (const loan of loans) {
      if (!loan.expected_disbursement_date) continue;
      const nextDemand = await t.query<{ due_date: string | null }>(
        `SELECT MIN(due_date)::text AS due_date FROM demand WHERE booking_id = $1 AND loan_dependent = true AND status NOT IN ('settled','waived') AND due_date IS NOT NULL`,
        [loan.booking_id]
      );
      const dueDate = nextDemand.rows[0]?.due_date;
      if (!dueDate) continue;
      const daysToDemand = daysBetween(asOf, dueDate);
      const daysToDisbursement = daysBetween(asOf, loan.expected_disbursement_date);
      const gap = daysToDemand - daysToDisbursement;
      if (gap >= -GAP_BREACH_THRESHOLD_DAYS) continue; // breach = demand due more than 15d before expected disbursement

      const demands = await mapDemands(
        `${DEMAND_SELECT} WHERE d.booking_id = $1 AND d.loan_dependent = true AND d.status NOT IN ('settled','waived')`,
        [loan.booking_id],
        t
      );
      await t.query(`UPDATE demand SET loan_dependent = false WHERE booking_id = $1 AND status NOT IN ('settled','waived')`, [loan.booking_id]);
      await appendEvent(t, {
        type: "loan.stage_changed",
        entity_type: "loan_case",
        entity_id: loan.id,
        project_id: loan.project_id,
        booking_id: loan.booking_id,
        payload: { reason: "timing_gap_breach", gap_days: gap },
        actor_user_id: null,
        actor_kind: "SYSTEM",
      });
      results.push({ loan_id: loan.id, demand_ids: demands.map((d) => d.id) });
    }
    return results;
  });
}

import { db } from "../db";
import { getJourneyForBooking } from "../journey/instances";
import { getUnitChangeability } from "../changeability/core";
import { trendFrom, topDrivers, type Score, type ScoreDriver } from "../scores/contract";
import { previousValue } from "../scores/store";
import { recordScore } from "./shared";
import type { Ctx } from "../authz/types";

// 31-intelligence.md rule 3 — Journey risk per booking, rules over: SLA clock states (06),
// slippage vs baseline (06's own `stage_instance.slippage_days`, real per-stage variance already
// computed by `getJourneyForBooking`), dependency chains blocked (06's own `stage_instance.status
// = 'BLOCKED'` — a real, literal status value on that table, distinct from the SLA-clock-derived
// OVERDUE/AT_RISK states above), gate freshness (08's own `freshness_status` on
// `unit_change_gate`, exactly what its name promises). No booking with no journey_instance yet (a
// pre-06 booking, or one that hasn't reached journey instantiation) scores 0 with LOW confidence
// rather than throwing — a real "nothing to measure yet" state.

const SLA_STATE_WEIGHT = 40;
const SLIPPAGE_WEIGHT = 30;
const BLOCKED_GATE_WEIGHT = 20;
const STALE_GATE_WEIGHT = 10;

interface Built { value: number; allDrivers: ScoreDriver[]; hasJourney: boolean }

async function build(bookingId: string, ctx: Ctx): Promise<Built> {
  let value = 0;
  const allDrivers: ScoreDriver[] = [];

  const journey = await getJourneyForBooking(bookingId, ctx);
  if (!journey) return { value: 0, allDrivers, hasJourney: false };

  const overdueTasks = journey.stages.flatMap((s) => s.tasks).filter((t) => t.clock_status === "OVERDUE").length;
  const atRiskTasks = journey.stages.flatMap((s) => s.tasks).filter((t) => t.clock_status === "AT_RISK").length;
  if (overdueTasks > 0 || atRiskTasks > 0) {
    const penalty = Math.min(SLA_STATE_WEIGHT, overdueTasks * 15 + atRiskTasks * 7);
    value += penalty;
    allDrivers.push({ code: "SLA_STATE", label: "SLA clock state", contribution: penalty, fact: `${overdueTasks} task(s) overdue, ${atRiskTasks} at risk` });
  }

  const worstSlippage = Math.max(0, ...journey.stages.map((s) => s.slippage_days));
  if (worstSlippage > 0) {
    const penalty = Math.min(SLIPPAGE_WEIGHT, worstSlippage * 2);
    value += penalty;
    const stage = journey.stages.find((s) => s.slippage_days === worstSlippage);
    allDrivers.push({ code: "SLIPPAGE", label: "Slippage vs journey baseline", contribution: penalty, fact: `${stage?.stage_code ?? "a stage"} forecast ${worstSlippage} day(s) behind plan` });
  }

  const blockedStages = journey.stages.filter((s) => s.status === "BLOCKED").length;
  if (blockedStages > 0) {
    const penalty = Math.min(BLOCKED_GATE_WEIGHT, blockedStages * 10);
    value += penalty;
    allDrivers.push({ code: "DEPENDENCY_BLOCKED", label: "Blocked dependency chain", contribution: penalty, fact: `${blockedStages} journey stage(s) BLOCKED on a dependency` });
  }

  const unit = await db.query<{ id: string }>(`SELECT unit_id AS id FROM booking WHERE id = $1`, [bookingId]);
  if (unit.rows[0]) {
    const matrix = await getUnitChangeability(unit.rows[0].id, ctx);
    const stale = matrix.gates.filter((g) => g.freshness_status === "VERIFICATION_REQUIRED").length;
    if (stale > 0) {
      const penalty = Math.min(STALE_GATE_WEIGHT, stale * 5);
      value += penalty;
      allDrivers.push({ code: "GATE_FRESHNESS", label: "Stale gate evaluation", contribution: penalty, fact: `${stale} gate(s) need re-verification` });
    }
  }

  return { value: Math.min(100, value), allDrivers, hasJourney: true };
}

export async function computeJourneyRisk(bookingId: string, ctx: Ctx): Promise<Score> {
  const { value, allDrivers, hasJourney } = await build(bookingId, ctx);
  const previous = await previousValue("JOURNEY_RISK", bookingId);
  const score: Score = {
    value,
    trend: trendFrom(value, previous),
    drivers: topDrivers(allDrivers, 3),
    confidence: hasJourney ? "MEDIUM" : "LOW",
    confidence_reason: hasJourney
      ? "rule-based composite over SLA state, slippage and gate signals — weights are UNCONFIRMED placeholders"
      : "no journey_instance exists yet for this booking — nothing to measure",
    actions: [],
  };
  const b = await db.query<{ project_id: string }>(`SELECT project_id FROM booking WHERE id = $1`, [bookingId]);
  await recordScore("JOURNEY_RISK", "booking", bookingId, b.rows[0]?.project_id ?? null, score, previous);
  return score;
}

export async function explainJourneyRisk(bookingId: string, ctx: Ctx): Promise<Score> {
  const { value, allDrivers, hasJourney } = await build(bookingId, ctx);
  const previous = await previousValue("JOURNEY_RISK", bookingId);
  return {
    value,
    trend: trendFrom(value, previous),
    drivers: allDrivers,
    confidence: hasJourney ? "MEDIUM" : "LOW",
    confidence_reason: hasJourney
      ? "rule-based composite over SLA state, slippage and gate signals — weights are UNCONFIRMED placeholders"
      : "no journey_instance exists yet for this booking — nothing to measure",
    actions: [],
  };
}

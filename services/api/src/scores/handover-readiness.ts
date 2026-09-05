import { db } from "../db";
import { handoverForBooking } from "../qa";
import { openCommitmentsForBooking } from "../commitments/core";
import { computeBookingReadiness } from "./booking-readiness";
import { trendFrom, topDrivers, type Score, type ScoreDriver, type ScoreAction } from "./contract";
import { previousValue, persistSnapshot } from "./store";

// Rule 3: min-gated composite. Reuses `handoverForBooking` (qa.ts, already real — includes 13's
// commitments gate as of this spec) rather than re-deriving gate inputs. FM/community readiness
// (16's own gate) has no real scoring source yet — 16 isn't built — so it's held neutral (1.0),
// flagged, not guessed at. Commitment penalty (rule 3's "13: −N per open") is real: counts
// `openCommitmentsForBooking`.
const COMMITMENT_PENALTY_PER_OPEN = 5; // UNCONFIRMED — spec names "−N per open, config", no real N given
const FM_UNAVAILABLE_REASON = "FM/community readiness (16) is not yet available — held neutral rather than guessed";
const WEIGHTS = { unit: 0.4, snags: 0.2, fm: 0.15, customer: 0.25 };

interface Built { value: number; allDrivers: ScoreDriver[]; actions: ScoreAction[]; capped: boolean; trend: Score["trend"] }

async function build(bookingId: string): Promise<Built & { projectId: string | null }> {
  const ho = await handoverForBooking(bookingId);
  const hardOpen = ho.gates.find((g) => g.classification === "hard" && g.state !== "passed");
  const b = await db.query<{ project_id: string }>(`SELECT project_id FROM booking WHERE id = $1`, [bookingId]);

  if (hardOpen) {
    return {
      value: Math.min(69, ho.readiness.value),
      allDrivers: [{ code: hardOpen.type.toUpperCase(), label: `${hardOpen.type} gate is open`, contribution: 100, fact: hardOpen.blockers[0] ?? "hard gate open" }],
      actions: [{ action_type: "exec_simple", title: `Resolve ${hardOpen.type} gate`, target: hardOpen.type }],
      capped: true,
      trend: "FLAT",
      projectId: b.rows[0]?.project_id ?? null,
    };
  }

  const openCommitments = await openCommitmentsForBooking(bookingId);
  const commitmentPenalty = Math.min(100, openCommitments.length * COMMITMENT_PENALTY_PER_OPEN);
  const snagsScore = ho.readiness.critical_snags > 0 ? 0 : 1;
  const customer = await computeBookingReadiness(bookingId);

  const value = Math.max(
    0,
    Math.round(WEIGHTS.unit * ho.readiness.value + WEIGHTS.snags * 100 * snagsScore + WEIGHTS.fm * 100 + WEIGHTS.customer * customer.value) - commitmentPenalty
  );

  const allDrivers: ScoreDriver[] = [
    { code: "UNIT_READINESS", label: "Unit readiness", contribution: Math.round(WEIGHTS.unit * (100 - ho.readiness.value)), fact: `${ho.readiness.value}/100` },
    { code: "SNAGS", label: ho.readiness.critical_snags > 0 ? `${ho.readiness.critical_snags} critical snag(s) open` : "No critical snags open", contribution: Math.round(WEIGHTS.snags * 100 * (1 - snagsScore)), fact: `${ho.readiness.critical_snags} critical open` },
    { code: "COMMITMENTS", label: openCommitments.length > 0 ? `${openCommitments.length} open commitment(s)` : "No open commitments", contribution: commitmentPenalty, fact: openCommitments.map((c) => c.code).join(", ") || "none" },
    { code: "CUSTOMER_READINESS", label: "Booking/customer readiness", contribution: Math.round(WEIGHTS.customer * (100 - customer.value)), fact: `${customer.value}/100` },
    { code: "FM", label: "Data not yet available: FM/community readiness (16)", contribution: 0, fact: "handover gates (16) not built" },
  ];
  const actions = openCommitments.slice(0, 3).map((c) => ({ action_type: "exec_simple", title: `Resolve commitment ${c.code}`, target: c.code }));

  return { value, allDrivers, actions, capped: false, trend: "FLAT", projectId: b.rows[0]?.project_id ?? null };
}

export async function computeHandoverReadiness(bookingId: string): Promise<Score> {
  const built = await build(bookingId);
  const previous = await previousValue("HANDOVER_READINESS", bookingId);
  const score: Score = {
    value: built.value,
    trend: built.capped ? "FLAT" : trendFrom(built.value, previous), // a capped state doesn't meaningfully trend against an uncapped history
    drivers: topDrivers(built.allDrivers.filter((d) => d.code !== "FM"), 3),
    confidence: built.capped ? "HIGH" : "MEDIUM",
    confidence_reason: built.capped ? "capped by an open hard gate — the real, deterministic reason, not a modeled blend" : FM_UNAVAILABLE_REASON,
    actions: built.actions,
  };
  await persistSnapshot("HANDOVER_READINESS", "booking", bookingId, built.projectId, score);
  return score;
}

/** Rule 5's `.../explain` — the full contribution table. */
export async function explainHandoverReadiness(bookingId: string): Promise<Score> {
  const built = await build(bookingId);
  const previous = await previousValue("HANDOVER_READINESS", bookingId);
  return {
    value: built.value,
    trend: built.capped ? "FLAT" : trendFrom(built.value, previous),
    drivers: built.allDrivers,
    confidence: built.capped ? "HIGH" : "MEDIUM",
    confidence_reason: built.capped ? "capped by an open hard gate — the real, deterministic reason, not a modeled blend" : FM_UNAVAILABLE_REASON,
    actions: built.actions,
  };
}

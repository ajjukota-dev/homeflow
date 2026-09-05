import { randomUUID } from "node:crypto";
import { db } from "../db";
import type { DbLike } from "../events";
import { evaluateHandover, type HandoverGateView, type GateType } from "../handover";
import { buildHandoverInput } from "../qa";
import { loadOrCreateCase, loadGateConfig, toGateClass, GATE_DB_TO_TYPE, GATE_TYPE_TO_DB, type HoCaseRow } from "./store";

export interface EvaluatedGate extends HandoverGateView {
  gate_db: string; // FINANCIAL/LEGAL/... — what routes and handover_gate_run store
  overridden: boolean;
  override_id: string | null;
}

export interface CaseView {
  case: HoCaseRow;
  gates: EvaluatedGate[];
  eligible: boolean;
  lifecycle: string;
  blockers: { gate: GateType; reason: string }[];
  input: Awaited<ReturnType<typeof buildHandoverInput>>["input"];
}

/** Rule 1 (pure evaluation) + rule 2 (override supersedes OPEN with OVERRIDDEN, never PASSED) +
 *  rule 7 (log every run). Does NOT decide SCHEDULED/COMPLETED eligibility beyond the gates
 *  themselves — core.ts's bookSlot/completeCase re-check `eligible` before acting (rule 2/5). */
export async function evaluateCase(bookingId: string, tx: DbLike = db): Promise<CaseView> {
  const hoCase = await loadOrCreateCase(bookingId, tx);
  const built = await buildHandoverInput(bookingId);
  const config = await loadGateConfig(hoCase.project_id, tx);

  // REGISTRATION rule 1 bracket: "hard, unless policy allows possession-before-registration".
  const regParams = config.REGISTRATION?.params as { allow_possession_before_registration?: boolean } | undefined;
  const input = regParams?.allow_possession_before_registration ? { ...built.input, registered: true } : built.input;

  const classOverrides = Object.fromEntries(
    Object.entries(GATE_DB_TO_TYPE).map(([dbKey, type]) => [type, toGateClass(config[dbKey]!.classification)])
  ) as Partial<Record<Exclude<GateType, "snags">, "hard" | "soft">>;
  const evald = evaluateHandover(input, classOverrides);

  // Active (non-expired) overrides for this case, most recent per gate.
  const overrides = await tx.query<{ id: string; gate: string; created_at: string }>(
    `SELECT DISTINCT ON (gate) id, gate, created_at::text AS created_at FROM handover_override
      WHERE case_id = $1 AND (valid_until IS NULL OR valid_until > now())
      ORDER BY gate, created_at DESC`,
    [hoCase.id]
  );
  const overrideByGate = new Map(overrides.rows.filter((r) => GATE_DB_TO_TYPE[r.gate]).map((r) => [GATE_DB_TO_TYPE[r.gate]!, r]));

  const gates: EvaluatedGate[] = evald.gates
    .filter((g): g is HandoverGateView & { type: Exclude<GateType, "snags"> } => g.type !== "snags")
    .map((g) => {
      const ov = overrideByGate.get(g.type);
      const overridden = g.state === "open" && !!ov;
      return { ...g, gate_db: GATE_TYPE_TO_DB[g.type], overridden, override_id: ov?.id ?? null };
    });

  const stillBlocking = gates.filter((g) => g.classification === "hard" && g.state !== "passed" && !g.overridden);
  const eligible = stillBlocking.length === 0;
  const lifecycle = eligible ? "eligible" : stillBlocking.length <= 2 ? "at_risk" : "not_eligible";
  const blockers = stillBlocking.flatMap((g) => g.blockers.map((reason) => ({ gate: g.type, reason })));

  // Persist only on change (registration/core.ts::refresh's precedent) — otherwise every GET
  // and every pipeline row would write 8 identical OPEN rows, burying rule 7's run history.
  const latestRuns = await tx.query<{ gate: string; state: string; override_id: string | null }>(
    `SELECT DISTINCT ON (gate) gate, state, override_id FROM handover_gate_run WHERE case_id = $1 ORDER BY gate, evaluated_at DESC`,
    [hoCase.id]
  );
  const latestByGate = new Map(latestRuns.rows.map((r) => [r.gate, r]));
  for (const g of gates) {
    const state = g.overridden ? "OVERRIDDEN" : g.state.toUpperCase();
    const prev = latestByGate.get(g.gate_db);
    if (prev && prev.state === state && prev.override_id === g.override_id) continue;
    await tx.query(
      `INSERT INTO handover_gate_run (id, case_id, gate, state, blockers, override_id)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
      [randomUUID(), hoCase.id, g.gate_db, state, JSON.stringify(g.blockers), g.override_id]
    );
  }

  const { predicted_date, predicted_confidence } = await predictDate(hoCase, eligible, tx);
  if (predicted_date !== hoCase.predicted_date || predicted_confidence !== hoCase.predicted_confidence) {
    await tx.query(`UPDATE handover_record SET predicted_date = $1, predicted_confidence = $2 WHERE id = $3`, [predicted_date, predicted_confidence, hoCase.id]);
  }

  return { case: { ...hoCase, predicted_date, predicted_confidence }, gates, eligible, lifecycle, blockers, input };
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

/** Rule 3: "max over gate-clearing forecasts (06 forecast for construction, 19 expected
 *  clearance, 23 registration forecast) with confidence = min of theirs." 06 has no queryable
 *  construction-completion forecast and 19's financial_clearance carries no expected-date field
 *  — both terms are UNCONFIRMED/unavailable, same flagged-gap class as 23's own rule 4 forecast.
 *  Only 23's registration.forecast_date is a real, available term today. */
async function predictDate(row: HoCaseRow, eligible: boolean, tx: DbLike): Promise<{ predicted_date: string | null; predicted_confidence: "LOW" | "MEDIUM" | "HIGH" | null }> {
  const appt = await tx.query<{ confirmed_slot: string | null }>(`SELECT confirmed_slot::text AS confirmed_slot FROM handover_appointment WHERE case_id = $1`, [row.id]);
  if (appt.rows[0]?.confirmed_slot) {
    return { predicted_date: appt.rows[0].confirmed_slot.slice(0, 10), predicted_confidence: "HIGH" };
  }
  const reg = await tx.query<{ forecast_date: string | null; forecast_confidence: "LOW" | "MEDIUM" | "HIGH" | null }>(
    `SELECT forecast_date::text AS forecast_date, forecast_confidence FROM registration_case WHERE booking_id = $1`,
    [row.booking_id]
  );
  if (reg.rows[0]?.forecast_date) {
    return { predicted_date: reg.rows[0].forecast_date, predicted_confidence: reg.rows[0].forecast_confidence };
  }
  return { predicted_date: addDays(new Date(), eligible ? 7 : 21).toISOString().slice(0, 10), predicted_confidence: "LOW" };
}

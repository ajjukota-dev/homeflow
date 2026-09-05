import { db } from "../db";
import type { DbLike } from "../events";
import { deriveGate, changeabilityScore, type ChangeGateRule, type GateState, type ProgressState } from "../gates";

// Shared loaders for the gate engine's two config inputs. Lived as private functions in
// handlers.ts until 07 needed them too (bulk-update preview runs `deriveGate` in dry-run over a
// hypothetical progress map) — moved here so handlers.ts and progress/core.ts share one copy
// instead of each re-declaring the same two SELECTs, and so neither imports the other (cycle).

export interface GateCategory { code: string; customer_label: string; customer_visible: boolean; sort_order: number }

export async function loadGateRules(tx: DbLike = db): Promise<ChangeGateRule[]> {
  const r = await tx.query<ChangeGateRule>(
    `SELECT category_code, trigger_component_code, min_state, resulting_state FROM change_gate_rule`
  );
  return r.rows;
}

export async function loadGateCategories(tx: DbLike = db): Promise<GateCategory[]> {
  const r = await tx.query<GateCategory>(
    `SELECT code, customer_label, customer_visible, sort_order FROM change_category ORDER BY sort_order`
  );
  return r.rows;
}

export async function loadProgressMap(unitId: string, tx: DbLike = db): Promise<Record<string, ProgressState>> {
  const r = await tx.query<{ component_code: string; state_code: ProgressState }>(
    `SELECT component_code, state_code FROM unit_progress WHERE unit_id = $1`,
    [unitId]
  );
  const map: Record<string, ProgressState> = {};
  for (const row of r.rows) map[row.component_code] = row.state_code;
  return map;
}

export interface DerivedGate { category_code: string; customer_label: string; customer_visible: boolean; state: GateState; reason: string }

/** Pure given its inputs — the same derivation for live reads and dry-run previews. */
export function gatesFromProgress(progress: Record<string, ProgressState>, cats: GateCategory[], rls: ChangeGateRule[]): { gates: DerivedGate[]; score: number } {
  const gates = cats.map((c) => {
    const { state, reason } = deriveGate(c.code, progress, rls);
    return { category_code: c.code, customer_label: c.customer_label, customer_visible: c.customer_visible, state, reason };
  });
  return { gates, score: changeabilityScore(gates.map((g) => g.state)) };
}

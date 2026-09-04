import { db, setState } from "./db";
import {
  deriveGate,
  changeabilityScore,
  type ChangeGateRule,
  type GateState,
  type ProgressState,
} from "./gates";
import { raiseDemandsForUnit } from "./demands-schedule";

// Pure-ish handlers (portable to Lambda). Each reads/writes the DB and derives gates.

async function rules(): Promise<ChangeGateRule[]> {
  const r = await db.query<ChangeGateRule>(
    `SELECT category_code, trigger_component_code, min_state, resulting_state FROM change_gate_rule`
  );
  return r.rows;
}

async function categories() {
  const r = await db.query<{ code: string; customer_label: string; customer_visible: boolean; sort_order: number }>(
    `SELECT code, customer_label, customer_visible, sort_order FROM change_category ORDER BY sort_order`
  );
  return r.rows;
}

async function progressFor(unitId: string): Promise<Record<string, ProgressState>> {
  const r = await db.query<{ component_code: string; state_code: ProgressState }>(
    `SELECT component_code, state_code FROM unit_progress WHERE unit_id=$1`,
    [unitId]
  );
  const map: Record<string, ProgressState> = {};
  for (const row of r.rows) map[row.component_code] = row.state_code;
  return map;
}

async function gatesForUnit(unitId: string) {
  const [cats, rls, progress] = await Promise.all([categories(), rules(), progressFor(unitId)]);
  const gates = cats.map((c) => {
    const { state, reason } = deriveGate(c.code, progress, rls);
    return {
      category_code: c.code,
      customer_label: c.customer_label,
      customer_visible: c.customer_visible,
      state,
      reason,
    };
  });
  const score = changeabilityScore(gates.map((g) => g.state as GateState));
  return { gates, score };
}

/** Sales inventory — every available unit with live gates + score (optionally by project). */
export async function listUnits(projectId?: string) {
  const units = await db.query<{
    id: string;
    unit_number: string;
    unit_type: string;
    facing: string;
    sale_status: string;
  }>(
    `SELECT id, unit_number, unit_type, facing, sale_status FROM unit
     ${projectId ? "WHERE project_id = $1" : ""} ORDER BY unit_number`,
    projectId ? [projectId] : []
  );
  const out = [];
  for (const u of units.rows) {
    const { gates, score } = await gatesForUnit(u.id);
    out.push({ ...u, score, gates });
  }
  return out;
}

/** Project/Site — one unit with its component progress + resulting gates. */
export async function getUnit(unitId: string) {
  const u = await db.query<{
    id: string;
    unit_number: string;
    unit_type: string;
    facing: string;
    sale_status: string;
  }>(`SELECT id, unit_number, unit_type, facing, sale_status FROM unit WHERE id=$1`, [unitId]);
  if (u.rows.length === 0) return null;
  const comps = await db.query<{ code: string; label: string; state_code: string }>(
    `SELECT c.code, c.label, p.state_code
       FROM component_definition c
       JOIN unit_progress p ON p.component_code=c.code AND p.unit_id=$1
       ORDER BY c.sort_order`,
    [unitId]
  );
  const { gates, score } = await gatesForUnit(unitId);
  return { ...u.rows[0], score, components: comps.rows, gates };
}

/** Project/Site writes progress → gates re-derive (the H1 loop). */
export async function setProgress(unitId: string, component: string, state: ProgressState) {
  const valid: ProgressState[] = ["not_started", "in_progress", "complete", "verified"];
  if (!valid.includes(state)) throw new Error(`invalid state ${state}`);
  await setState(unitId, component, state);
  await raiseDemandsForUnit(unitId);
  return getUnit(unitId);
}

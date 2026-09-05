import { randomUUID } from "node:crypto";
import { db } from "../db";
import { requireRole, POLICY_STUDIO_ROLES } from "../authz/requireRole";
import { AppError, type Ctx } from "../authz/types";
import type { GateConfigRow } from "./store";

// Policy Studio "Handover gate configuration" tab (25's Tabs line, 16's Config section) — the
// 8-row (per project) handover_gate_config table. QA is added as a department lead since
// Screens names "QA/Handover role" as the case-working role, same pattern 22 used for LEGAL.
const CONFIG_EDIT_ROLES = [...POLICY_STUDIO_ROLES, "QA"];

const GATE_ROW_SELECT = `SELECT id, gate, classification, overridable, override_roles, requires_approval, requires_evidence, product_types, project_id, params, effective_from, effective_to, version FROM handover_gate_config`;

export interface GateConfigFullRow extends GateConfigRow {
  id: string; product_types: string[]; project_id: string | null;
  effective_from: string; effective_to: string | null; version: number;
}

export async function listGateConfig(ctx: Ctx): Promise<GateConfigFullRow[]> {
  requireRole(ctx, [...CONFIG_EDIT_ROLES, "LEGAL", "REGISTRATION", "FM"]);
  return (await db.query<GateConfigFullRow>(`${GATE_ROW_SELECT} ORDER BY project_id NULLS FIRST, gate`)).rows;
}

export interface PutGateConfigInput {
  gate: string; classification: "HARD" | "SOFT"; overridable: boolean; override_roles: string[];
  requires_approval: boolean; requires_evidence: boolean; product_types?: string[];
  project_id?: string | null; params?: Record<string, unknown>;
}

const VALID_GATES = new Set(["FINANCIAL", "LEGAL", "REGISTRATION", "PHYSICAL", "QUALITY", "COMMITMENTS", "CUSTOMER", "FM_COMMUNITY"]);

/** New version per (gate, project_id) row rather than an in-place UPDATE — 0039's schema gives
 *  handover_gate_config its own `version`/`effective_from/to` columns for a reason (an audit
 *  trail of classification changes, since these decide what "cannot be bypassed" means); this
 *  closes the old row's effective_to instead of overwriting it. */
export async function putGateConfig(input: PutGateConfigInput, ctx: Ctx): Promise<GateConfigFullRow> {
  requireRole(ctx, CONFIG_EDIT_ROLES);
  if (!VALID_GATES.has(input.gate)) throw new AppError("validation", `gate must be one of: ${[...VALID_GATES].join(", ")}`, "gate");
  const projectId = input.project_id ?? null;
  const current = await db.query<{ version: number }>(
    `SELECT version FROM handover_gate_config WHERE gate = $1 AND project_id IS NOT DISTINCT FROM $2 AND effective_to IS NULL`,
    [input.gate, projectId]
  );
  const nextVersion = (current.rows[0]?.version ?? 0) + 1;
  await db.query(`UPDATE handover_gate_config SET effective_to = now() WHERE gate = $1 AND project_id IS NOT DISTINCT FROM $2 AND effective_to IS NULL`, [input.gate, projectId]);
  const id = randomUUID();
  await db.query(
    `INSERT INTO handover_gate_config (id, gate, classification, overridable, override_roles, requires_approval, requires_evidence, product_types, project_id, params, version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)`,
    [id, input.gate, input.classification, input.overridable, input.override_roles, input.requires_approval, input.requires_evidence, input.product_types ?? [], projectId, JSON.stringify(input.params ?? {}), nextVersion]
  );
  const r = await db.query<GateConfigFullRow>(`${GATE_ROW_SELECT} WHERE id = $1`, [id]);
  return r.rows[0]!;
}

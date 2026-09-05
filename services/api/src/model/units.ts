import { randomUUID } from "node:crypto";
import { db } from "../db";
import { appendEvent, withTx, type DbLike } from "../events";
import { nextCode } from "./codes";
import { ValidationError } from "./derive";

// Unit creation core (04 §Data, §Screens "bulk create from a range"). services/api/src/
// projects.ts's createUnit (pre-dates this spec) delegates here for a single unit; the Admin
// Units screen's bulk range create calls bulkCreateUnits directly.

export type ProductType = "APARTMENT" | "VILLA" | "PLOT" | "MIXED";

export interface UnitInput {
  unit_number: string;
  unit_type: string;
  facing: string;
  product_type?: ProductType;
  carpet_area_sqft?: number;
  plot_area_sqyd?: number;
  floor_no?: number;
  base_price_inr?: number;
}

export const DEFAULT_HIERARCHY_CODE = "DEFAULT";

/** Every project gets a fallback hierarchy node so unit creation never *requires* a real one
 * yet (never ask for a value that can be derived, CLAUDE.md) — the Admin hierarchy tree editor
 * lets a project replace it with real Phase/Tower/Floor structure. */
export async function defaultHierarchyNodeId(projectId: string, tx: DbLike = db): Promise<string> {
  const existing = await tx.query<{ id: string }>(
    `SELECT id FROM project_hierarchy_node WHERE project_id = $1 AND code = $2`,
    [projectId, DEFAULT_HIERARCHY_CODE]
  );
  if (existing.rows.length > 0) return existing.rows[0].id;
  const id = "node_" + randomUUID().slice(0, 8);
  await tx.query(
    `INSERT INTO project_hierarchy_node (id, project_id, kind, code, name, sort_order)
     VALUES ($1,$2,'PHASE',$3,'Ungrouped units',0)`,
    [id, projectId, DEFAULT_HIERARCHY_CODE]
  );
  return id;
}

/** Inserts one unit + its progress/QA scaffolding + unit.created event, inside `tx`. */
export async function insertUnit(
  tx: DbLike,
  projectId: string,
  hierarchyNodeId: string,
  input: UnitInput
): Promise<string> {
  if (!input.unit_number?.trim()) throw new ValidationError("unit_number required", "unit_number");
  const id = "u_" + randomUUID().slice(0, 8);
  const code = await nextCode(tx, "UNT");
  await tx.query(
    `INSERT INTO unit (id, project_id, unit_number, unit_type, facing, code, hierarchy_node_id,
       product_type, carpet_area_sqft, plot_area_sqyd, floor_no, base_price_inr)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      id,
      projectId,
      input.unit_number.trim(),
      input.unit_type?.trim() || "3BHK",
      input.facing?.trim() || "East",
      code,
      hierarchyNodeId,
      input.product_type ?? "VILLA",
      input.carpet_area_sqft ?? null,
      input.plot_area_sqyd ?? null,
      input.floor_no ?? null,
      input.base_price_inr ?? null,
    ]
  );
  await tx.query(
    `INSERT INTO unit_progress (unit_id, component_code, state_code)
     SELECT $1, code, 'not_started' FROM component_definition`,
    [id]
  );
  await tx.query(
    `INSERT INTO qa_evidence (unit_id, component_code, qa_verified)
     SELECT $1, code, false FROM component_definition`,
    [id]
  );
  await appendEvent(tx, {
    type: "unit.created",
    entity_type: "unit",
    entity_id: id,
    project_id: projectId,
    unit_id: id,
    payload: { unit_number: input.unit_number.trim(), code, unit_type: input.unit_type, facing: input.facing },
  });
  return id;
}

export interface BulkUnitRangeInput {
  hierarchy_node_id?: string;
  floor_from: number;
  floor_to: number;
  letter_from: string; // e.g. 'A'
  letter_to: string; // e.g. 'D'
  unit_type: string;
  facing: string;
  product_type?: ProductType;
  base_price_inr?: number;
  carpet_area_sqft?: number;
}

/** Admin → Units bulk create: e.g. floors 1-12 × units A-D (04 §Screens). */
export async function bulkCreateUnits(projectId: string, input: BulkUnitRangeInput): Promise<string[]> {
  if (input.floor_from > input.floor_to) throw new ValidationError("floor_from must be <= floor_to");
  const letters: string[] = [];
  for (let c = input.letter_from.charCodeAt(0); c <= input.letter_to.charCodeAt(0); c++) {
    letters.push(String.fromCharCode(c));
  }
  if (letters.length === 0) throw new ValidationError("letter_from must be <= letter_to");

  return withTx(undefined, async (t) => {
    const hierarchyNodeId = input.hierarchy_node_id ?? (await defaultHierarchyNodeId(projectId, t));
    const ids: string[] = [];
    for (let floor = input.floor_from; floor <= input.floor_to; floor++) {
      for (const letter of letters) {
        const id = await insertUnit(t, projectId, hierarchyNodeId, {
          unit_number: `${floor}${letter}`,
          unit_type: input.unit_type,
          facing: input.facing,
          product_type: input.product_type,
          base_price_inr: input.base_price_inr,
          carpet_area_sqft: input.carpet_area_sqft,
          floor_no: floor,
        });
        ids.push(id);
      }
    }
    return ids;
  });
}

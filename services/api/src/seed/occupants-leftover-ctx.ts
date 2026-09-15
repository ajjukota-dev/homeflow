import { db } from "../db";
import { createUnit } from "../projects";
import type { OccupantSpec } from "./occupants-ctx";
import { site } from "./occupants-ctx";
import type { Phase2Person } from "./occupants-phase2-ctx";
import { PROJECT_ID } from "./users";

// Leftover occupant pins. Meadows MT1-502 / MP-02 already exist; East Crest V114–V119 via createUnit.

export type LeftoverPerson = Phase2Person;

export const KAVYA: LeftoverPerson = {
  unit_number: "MT1-502", booking_id: "b_mt502", booking_number: "BK-MT502",
  customer_id: "c_kavya", applicant_id: "a_mt502", name: "Kavya Iyer",
  phone: "9845088806", pan: "KAVYA1234I",
  demand_ids: ["d_mt502_1", "d_mt502_2", "d_mt502_3", "d_mt502_4", "d_mt502_5"],
};
export const DEEPAK: LeftoverPerson = {
  unit_number: "MP-02", booking_id: "b_mp02", booking_number: "BK-MP02",
  customer_id: "c_deepak", applicant_id: "a_mp02", name: "Deepak Nair",
  phone: "9845088807", pan: "DEEPN5678K",
  demand_ids: ["d_mp02_1", "d_mp02_2", "d_mp02_3", "d_mp02_4", "d_mp02_5"],
};
export const ISHAAN: LeftoverPerson = {
  unit_number: "V114", booking_id: "b_v114", booking_number: "BK-V114",
  customer_id: "c_ishaan", applicant_id: "a_v114", name: "Ishaan Gupta",
  phone: "9845088808", pan: "ISHAG9012P",
  demand_ids: ["d_v114_1", "d_v114_2", "d_v114_3", "d_v114_4", "d_v114_5"],
};
export const LEELA: LeftoverPerson = {
  unit_number: "V115", booking_id: "b_v115", booking_number: "BK-V115",
  customer_id: "c_leela", applicant_id: "a_v115", name: "Leela Fernandes",
  phone: "9845088809", pan: "LEELF3456Q",
  demand_ids: ["d_v115_1", "d_v115_2", "d_v115_3", "d_v115_4", "d_v115_5"],
};
export const FARHANQ: LeftoverPerson = {
  unit_number: "V116", booking_id: "b_v116", booking_number: "BK-V116",
  customer_id: "c_farhanq", applicant_id: "a_v116", name: "Farhan Qureshi",
  phone: "9845088810", pan: "FARHQ7890R",
  demand_ids: ["d_v116_1", "d_v116_2", "d_v116_3", "d_v116_4", "d_v116_5"],
};
export const CLOSED_V117: LeftoverPerson = {
  unit_number: "V117", booking_id: "b_v117", booking_number: "BK-V117",
  customer_id: "c_v117", applicant_id: "a_v117", name: "Gita Reddy",
  phone: "9845088811", pan: "GITAR2345S",
  demand_ids: ["d_v117_1", "d_v117_2", "d_v117_3", "d_v117_4", "d_v117_5"],
};
export const ANJALI: LeftoverPerson = {
  unit_number: "V118", booking_id: "b_v118", booking_number: "BK-V118",
  customer_id: "c_anjali", applicant_id: "a_v118", name: "Anjali Bhat",
  phone: "9845088812", pan: "ANJAB6789T",
  demand_ids: ["d_v118_1", "d_v118_2", "d_v118_3", "d_v118_4", "d_v118_5"],
};
export const VIVEK: LeftoverPerson = {
  unit_number: "V119", booking_id: "b_v119", booking_number: "BK-V119",
  customer_id: "c_vivek", applicant_id: "a_v119", name: "Vivek Sharma",
  phone: "9845088813", pan: "VIVEK0123U",
  demand_ids: ["d_v119_1", "d_v119_2", "d_v119_3", "d_v119_4", "d_v119_5"],
};

const VILLA_PRICE = 12_000_000;

export async function ensureVillaInventory(unitNumber: string): Promise<void> {
  const existing = await db.query<{ id: string }>(`SELECT id FROM unit WHERE unit_number = $1`, [unitNumber]);
  if (existing.rows[0]) return;
  const node = await db.query<{ id: string }>(
    `SELECT id FROM project_hierarchy_node
      WHERE project_id = $1
      ORDER BY CASE WHEN code = 'P1' THEN 0 ELSE 1 END, sort_order, id
      LIMIT 1`,
    [PROJECT_ID]
  );
  await createUnit(
    PROJECT_ID,
    {
      unit_number: unitNumber,
      unit_type: "3BHK",
      facing: "East",
      product_type: "VILLA",
      carpet_area_sqft: 2100,
      base_price_inr: VILLA_PRICE,
      hierarchy_node_id: node.rows[0]?.id,
    },
    site
  );
}

export async function resolveOccupant(p: LeftoverPerson): Promise<OccupantSpec> {
  const r = await db.query<{ id: string; base_price_inr: string | number }>(
    `SELECT id, base_price_inr FROM unit WHERE unit_number = $1`,
    [p.unit_number]
  );
  if (!r.rows[0]) throw new Error(`seed leftover: unit ${p.unit_number} not found`);
  return {
    unit_id: r.rows[0].id,
    booking_id: p.booking_id,
    booking_number: p.booking_number,
    customer_id: p.customer_id,
    applicant_id: p.applicant_id,
    name: p.name,
    phone: p.phone,
    pan: p.pan,
    consideration: Number(r.rows[0].base_price_inr),
    demand_ids: p.demand_ids,
  };
}

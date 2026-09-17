import { db } from "../db";
import { createProspect } from "../sales/prospects";
import { bookFromInventory, confirmInventoryBooking } from "../sales/booking";
import { submitHandover, acceptHandover } from "../sales-handover/core";
import {
  FULL_CONFIRMATIONS,
  FULL_DOCS,
  acceptSeed,
  crm,
  sales,
  type OccupantSpec,
} from "./occupants-ctx";

// prospect → bookFromInventory → confirm → submitHandover → acceptHandover (accepted people only).

async function projectIdFor(unitId: string): Promise<string> {
  const r = await db.query<{ project_id: string }>(`SELECT project_id FROM unit WHERE id = $1`, [unitId]);
  if (!r.rows[0]) throw new Error(`seed: unit ${unitId} not found`);
  return r.rows[0].project_id;
}

async function ensureProspect(o: OccupantSpec): Promise<string> {
  const id = o.prospect_id ?? `prs_${o.booking_id}`;
  const existing = await db.query<{ id: string }>(`SELECT id FROM prospect WHERE id = $1`, [id]);
  if (existing.rows[0]) return id;
  await createProspect(
    { id, project_id: await projectIdFor(o.unit_id), name: o.name, phone: o.phone },
    sales
  );
  return id;
}

async function bookOccupant(o: OccupantSpec): Promise<void> {
  const prospectId = await ensureProspect(o);
  const residency = o.residency ?? "RESIDENT";
  await bookFromInventory(
    prospectId,
    {
      unit_id: o.unit_id,
      applicants: [{ display_name: o.name, phone: o.phone, pan: o.pan, residency, role: "PRIMARY" }],
      price_inr: o.consideration,
      docs: FULL_DOCS,
    },
    sales,
    {
      booking_id: o.booking_id,
      code: o.booking_number,
      applicants: [{ customer_id: o.customer_id, applicant_id: o.applicant_id }],
    }
  );
  await confirmInventoryBooking(o.booking_id, sales);
}

export async function bookAndAccept(o: OccupantSpec): Promise<void> {
  await bookOccupant(o);
  await submitHandover(
    o.booking_id,
    { confirmations: FULL_CONFIRMATIONS, commercial: { payment_plan_ref: "PP-1" }, residency: o.residency ?? "RESIDENT" },
    sales
  );
  await acceptHandover(o.booking_id, crm, acceptSeed(o));
}

/** 2.1 / 2.2: packet submitted (or later returned). Does not accept — no journey. */
export async function bookAndSubmit(o: OccupantSpec): Promise<void> {
  await bookOccupant(o);
  await submitHandover(
    o.booking_id,
    { confirmations: FULL_CONFIRMATIONS, commercial: { payment_plan_ref: "PP-1" }, residency: o.residency ?? "RESIDENT" },
    sales
  );
}

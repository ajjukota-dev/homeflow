import { db } from "../db";
import { generateDocument } from "../legal-docs";
import { confirmAvailability, bookSlot, getRegistrationCase } from "../registration/core";
import { proposeAppointment, confirmAppointment, updateChecklist, overrideGate } from "../handover/core";
import { presignHandoverSignature } from "../handover/files";
import { files } from "../ports/files";
import { verifyComponent } from "../qa";
import { setOverdueReason } from "../demands";
import { bookAndAccept } from "./occupants-book";
import { legal, crm, registration, qa, accounts, management, KARTHIK } from "./occupants-ctx";
import { resolveMeadowsOccupant } from "./occupants-phase2-ctx";
import { KAVYA, DEEPAK, ISHAAN, ensureVillaInventory, resolveOccupant } from "./occupants-leftover-ctx";
import { readyForRegistrationSlot, payThroughFlooring, executeAosIfMissing } from "./occupants-leftover-ready";

// Must-do leftover: 2.6 AOS draft, 2.7 registration slot, 2.8 handover in progress, 2.16 overdue reasons.

export async function seedKavyaAosDraft(): Promise<void> {
  await bookAndAccept(await resolveMeadowsOccupant(KAVYA));
  await generateDocument(KAVYA.booking_id, "AOS", legal);
}

export async function seedDeepakRegistrationSlot(): Promise<void> {
  await bookAndAccept(await resolveMeadowsOccupant(DEEPAK));
  await readyForRegistrationSlot(DEEPAK.booking_id);
  const dates = [
    new Date(Date.now() + 5 * 86400000).toISOString(),
    new Date(Date.now() + 7 * 86400000).toISOString(),
  ];
  await confirmAvailability(DEEPAK.booking_id, dates, crm);
  await bookSlot(
    DEEPAK.booking_id,
    { sro_office: "SRO Bengaluru", slot_datetime: dates[0]!, reference: "SRO-MP02-1" },
    registration
  );
}

async function verifyAllComponents(unitId: string): Promise<void> {
  const comps = await db.query<{ code: string }>(`SELECT code FROM component_definition ORDER BY sort_order`);
  for (const c of comps.rows) {
    await verifyComponent(unitId, c.code, "Leftover seed: QA sign-off for handover-in-progress villa.", qa);
  }
}

export async function seedIshaanHandoverInProgress(): Promise<void> {
  await ensureVillaInventory(ISHAAN.unit_number);
  const spec = await resolveOccupant(ISHAAN);
  await bookAndAccept(spec);
  await payThroughFlooring(ISHAAN.booking_id);
  await executeAosIfMissing(ISHAAN.booking_id);
  await verifyAllComponents(spec.unit_id);
  await db.query(`UPDATE unit SET utilities_ready = true WHERE id = $1`, [spec.unit_id]);
  await overrideGate(
    ISHAAN.booking_id,
    { gate: "REGISTRATION", reason: "Possession-before-registration window agreed for V114 handover appointment." },
    management
  );
  const slots = [
    new Date(Date.now() + 5 * 86400000).toISOString(),
    new Date(Date.now() + 7 * 86400000).toISOString(),
  ];
  await proposeAppointment(ISHAAN.booking_id, slots, crm);
  await confirmAppointment(
    ISHAAN.booking_id,
    { slot: slots[0]!, confirmed_by: "CRM_ON_BEHALF", note: "Ishaan confirmed the earlier slot by phone." },
    crm
  );
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  const signed = await presignHandoverSignature(ISHAAN.booking_id, { kind: "customer", content_type: "image/png" }, qa);
  await files.putBuffer(signed.key, png, "image/png");
  await updateChecklist(
    ISHAAN.booking_id,
    {
      groups: { property: { cleaning: { done: true, by: "user_qa", at: new Date().toISOString(), file_ids: [] } } },
      customer_signature_file_id: signed.key,
    },
    qa
  );
}

export async function seedKarthikOverdueReasons(): Promise<void> {
  await setOverdueReason(KARTHIK.demand_ids[2], "customer_delay", accounts, "Customer asked for more time on MEP milestone.");
  await setOverdueReason(KARTHIK.demand_ids[3], "unresponsive", accounts, "No response to flooring-milestone reminders.");
}

/** Touch the case so 2.13 named blockers persist on a registration_case row. */
export async function openRegistrationCase(bookingId: string): Promise<void> {
  await getRegistrationCase(bookingId, registration);
}

import { db } from "../db";
import { approveDocument, executeDocument, generateDocument, completeRegistration } from "../legal-docs";
import { addServiceRecord } from "../post-handover/core";
import { completeHandover } from "../qa";
import { fm, legal, registration, ROHAN } from "./occupants-ctx";
import { PROJECT_ID } from "./users";

export async function executeAos(bookingId: string): Promise<void> {
  const doc = await generateDocument(bookingId, "AOS", legal);
  if (!doc) throw new Error(`seed: AOS generate failed for ${bookingId}`);
  await approveDocument(doc.id, legal);
  await executeDocument(doc.id, legal);
}

export async function registerBooking(bookingId: string, sro: string): Promise<void> {
  await completeRegistration(bookingId, sro, registration);
}

export async function handOverBooking(bookingId: string): Promise<void> {
  await completeHandover(bookingId, fm);
}

/** Remap handler-minted check-in ids + open warranty so existing tests keep w_v113_1 / ci_v113_*. */
export async function seedRohanAfterCare(): Promise<void> {
  await db.query(`UPDATE checkin_record SET id = 'ci_v113_7' WHERE booking_id = $1 AND day = 7`, [ROHAN.booking_id]);
  await db.query(`UPDATE checkin_record SET id = 'ci_v113_30' WHERE booking_id = $1 AND day = 30`, [ROHAN.booking_id]);
  await db.query(`UPDATE checkin_record SET id = 'ci_v113_90' WHERE booking_id = $1 AND day = 90`, [ROHAN.booking_id]);
  const item = await db.query<{ id: string }>(`SELECT id FROM home_passport_item WHERE unit_id = $1 LIMIT 1`, [ROHAN.unit_id]);
  const passportId = item.rows[0]?.id ?? null;
  await db.query(
    `INSERT INTO warranty_case (id, unit_id, booking_id, project_id, passport_item_id, category, trade, severity, description, coverage, status)
     VALUES ('w_v113_1',$1,$2,$3,$4,'plumbing','plumbing','minor','Guest-bath mixer drips overnight','dlp','open')`,
    [ROHAN.unit_id, ROHAN.booking_id, PROJECT_ID, passportId]
  );
  await addServiceRecord(
    {
      unit_id: ROHAN.unit_id,
      kind: "WARRANTY_FIX",
      description: "Guest-bath mixer drips overnight",
      warranty_case_id: "w_v113_1",
    },
    fm
  );
}

import { createBooking } from "../bookings";
import { submitHandover, acceptHandover } from "../sales-handover/core";
import {
  FULL_CONFIRMATIONS,
  FULL_DOCS,
  acceptSeed,
  bookingSeed,
  crm,
  sales,
  type OccupantSpec,
} from "./occupants-ctx";

// createBooking (sales) → submitHandover (sales) → acceptHandover (crm ≠ sales).
// acceptHandover → acceptBooking → setupFunding + sales_handover.accepted → journey.

export async function bookAndAccept(o: OccupantSpec): Promise<void> {
  await createBooking(
    o.unit_id,
    { applicant: { display_name: o.name, phone: o.phone, pan: o.pan }, total_consideration: o.consideration, docs: FULL_DOCS },
    sales,
    bookingSeed(o)
  );
  await submitHandover(
    o.booking_id,
    { confirmations: FULL_CONFIRMATIONS, commercial: { payment_plan_ref: "PP-1" } },
    sales
  );
  await acceptHandover(o.booking_id, crm, acceptSeed(o));
}

/** 2.1 / 2.2: packet submitted (or later returned). Does not accept — no journey. */
export async function bookAndSubmit(o: OccupantSpec): Promise<void> {
  await createBooking(
    o.unit_id,
    { applicant: { display_name: o.name, phone: o.phone, pan: o.pan }, total_consideration: o.consideration, docs: FULL_DOCS },
    sales,
    bookingSeed(o)
  );
  await submitHandover(
    o.booking_id,
    { confirmations: FULL_CONFIRMATIONS, commercial: { payment_plan_ref: "PP-1" } },
    sales
  );
}

import { db } from "../db";
import { createLoanCase, recordLoanEvent } from "../loans/core";
import { updateCustomerResidency } from "../model/customers";
import { cancelBooking } from "../model/bookings";
import { createSnag } from "../qa/snags";
import { setOverdueReason } from "../demands";
import { bookAndAccept } from "./occupants-book";
import { banking, crm, qa, accounts } from "./occupants-ctx";
import {
  LEELA, FARHANQ, CLOSED_V117, ANJALI, VIVEK,
  ensureVillaInventory, resolveOccupant,
} from "./occupants-leftover-ctx";
import { openRegistrationCase } from "./occupants-leftover-must";

// 2.9–2.15 leftover people. 2.12 skipped: delay_reason is empty in demo seed; inventing a code
// would be SOP. createPlanRevision exists but cannot run without a real reason row.

export async function seedLeelaNriLoan(): Promise<void> {
  await ensureVillaInventory(LEELA.unit_number);
  const spec = await resolveOccupant(LEELA);
  await bookAndAccept(spec);
  await updateCustomerResidency(LEELA.customer_id, "NRI", crm);
  const loan = await createLoanCase(
    LEELA.booking_id,
    { lender_name: "ICICI", requested_amount_inr: 8_000_000 },
    banking,
    { id: "lc_v115", code: "LN-DEMO02" }
  );
  await recordLoanEvent(loan.id, { type: "DOCS_REQUESTED" }, banking);
}

export async function seedFarhanDefaultLegal(): Promise<void> {
  await ensureVillaInventory(FARHANQ.unit_number);
  await bookAndAccept(await resolveOccupant(FARHANQ));
  await db.query(
    `UPDATE demand SET due_date = CURRENT_DATE - 70, status = 'overdue' WHERE id = $1`,
    [FARHANQ.demand_ids[0]]
  );
  await setOverdueReason(FARHANQ.demand_ids[0], "cheque_bounce", accounts, "Instrument returned; legal follow-up.");
}

export async function seedClosedV117(): Promise<void> {
  await ensureVillaInventory(CLOSED_V117.unit_number);
  await bookAndAccept(await resolveOccupant(CLOSED_V117));
  await cancelBooking(CLOSED_V117.booking_id, "Customer requested cancellation before agreement.", crm);
}

export async function seedAnjaliPreRegBlocked(): Promise<void> {
  await ensureVillaInventory(ANJALI.unit_number);
  await bookAndAccept(await resolveOccupant(ANJALI));
  await openRegistrationCase(ANJALI.booking_id);
}

export async function seedVivekCriticalSnag(): Promise<void> {
  await ensureVillaInventory(VIVEK.unit_number);
  const spec = await resolveOccupant(VIVEK);
  await bookAndAccept(spec);
  await createSnag(
    {
      unit_id: spec.unit_id,
      room: "UTILITY",
      category: "ELECTRICAL",
      severity: "CRITICAL",
      description: "Exposed live wiring at the distribution board — keys blocked.",
      location: "Electrical panel",
      trade: "electrical",
    },
    qa,
    "s_v119_1"
  );
}

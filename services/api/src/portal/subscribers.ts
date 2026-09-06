import { onEvent, appendEvent, type AppendedEvent } from "../events";
import { db } from "../db";
import { randomUUID } from "node:crypto";

// 26-customer-portal.md rule 10: "system creates a DRAFT customer_update from events (p19 §12
// list); CRM publishes — never auto-published, never AI-sent (p32 §27)." This subscriber only
// ever inserts a DRAFT row; `portal/core.ts::publishUpdate` is the one path that ever flips a row
// to PUBLISHED, and only a human (CRM_UPDATE_ROLES) can call it.
//
// p19 §12's own moment list is booking+24h welcome, agreement, payment confirmations,
// construction milestones, customisation decisions, registration, handover, 7/30/90-day
// check-ins. Wired here to real events that exist today: booking.created (welcome — the "24h"
// delay itself needs a scheduler, same gap already documented for 06/12/19/21's own sweeps, so
// this drafts immediately rather than faking a delay), payment.received (payment confirmed),
// registration.completed, handover.completed. `agreement.executed`/change-request-decision
// events exist in the registry but nothing in this codebase emits them yet for a customer-facing
// milestone shape distinct from the AOS/document-factory internal flow — not wired, flagged not
// faked, same class as 12's own inert 13-rule catalogue.

let registered = false;

async function draft(bookingId: string, kind: string, title: string, body: string, sourceEventId: string): Promise<void> {
  await appendEvent(db, {
    type: "customer_update.drafted",
    entity_type: "customer_update",
    entity_id: sourceEventId,
    booking_id: bookingId,
    payload: { kind, title },
    actor_user_id: null,
    actor_kind: "SYSTEM",
  });
  await db.query(
    `INSERT INTO customer_update (id, booking_id, kind, title, body, source_event_id) VALUES ($1,$2,$3,$4,$5,$6)`,
    ["cu_" + randomUUID().slice(0, 8), bookingId, kind, title, body, sourceEventId]
  );
}

export function registerPortalSubscribers(): void {
  if (registered) return;
  registered = true;

  onEvent("booking.created", "portal.draft_welcome", async (event: AppendedEvent) => {
    if (!event.booking_id) return;
    await draft(event.booking_id, "MESSAGE", "Welcome to your Pranava Home journey", "Thank you for booking with us. We'll keep you updated at every step.", event.id);
  });

  onEvent("payment.received", "portal.draft_payment_confirmed", async (event: AppendedEvent) => {
    if (!event.booking_id) return;
    const amount = (event.payload as { amount?: number })?.amount;
    await draft(event.booking_id, "PAYMENT_CONFIRMED", "Payment received", amount ? `We've received your payment of ₹${amount.toLocaleString("en-IN")}.` : "We've received your payment.", event.id);
  });

  onEvent("registration.completed", "portal.draft_registration", async (event: AppendedEvent) => {
    if (!event.booking_id) return;
    await draft(event.booking_id, "MILESTONE", "Registration completed", "Your property registration has been completed.", event.id);
  });

  onEvent("handover.completed", "portal.draft_handover", async (event: AppendedEvent) => {
    if (!event.booking_id) return;
    await draft(event.booking_id, "MILESTONE", "Handover completed", "Congratulations — your home handover is complete.", event.id);
  });
}

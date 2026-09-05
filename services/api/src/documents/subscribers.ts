import { onEvent, withTx, type AppendedEvent } from "../events";
import { seedChecklistForBooking } from "./checklist";

// 22 rule 8's real trigger: `sales_handover.accepted` (17/04, already emitted by
// bookings-crm.ts::acceptBooking) — same after-commit subscriber pattern as journey/subscribers.ts.
// The rule's other trigger, "on residency change", has no event to hook (no code path fires one
// today) — flagged, not built.
let registered = false;

export function registerDocumentSubscribers(): void {
  if (registered) return;
  registered = true;
  onEvent("sales_handover.accepted", "documents.seed_checklist", async (event: AppendedEvent) => {
    if (!event.booking_id) return;
    await withTx(undefined, (tx) => seedChecklistForBooking(event.booking_id!, tx));
  });
}

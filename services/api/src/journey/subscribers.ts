import { onEvent, withTx, type AppendedEvent } from "../events";
import { instantiateJourneyForBooking } from "./instances";

// Rule 1: "On the sales_handover.accepted event a journey is instantiated." First real
// production subscriber wired via events/subscribers.ts's onEvent mechanism (previously only
// exercised by tests — see subscribers.ts's own header comment). Runs after commit (02 rule 4);
// opens its own transaction since it's outside the one that appended the triggering event.
let registered = false;

export function registerJourneySubscribers(): void {
  if (registered) return; // idempotent — initDb() may run once per process already
  registered = true;
  onEvent("sales_handover.accepted", "journey.instantiate", async (event: AppendedEvent) => {
    if (!event.booking_id) return;
    await withTx(undefined, (tx) => instantiateJourneyForBooking(event.booking_id!, tx));
  });
}

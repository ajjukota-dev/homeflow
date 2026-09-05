import { onEvent, withTx, type AppendedEvent } from "../events";
import { db } from "../db";
import { recomputeMatchesForUnit } from "./prospects";
import { bookingConfirmBlockers, confirmDraft } from "./booking";

// 24 rule 5 (matches follow gate changes) and rule 8 (CONFIRMED on booking-amount receipt).
// After-commit subscribers via events/subscribers.ts, same pattern as changeability/subscribers.ts.
let registered = false;

export function registerSalesSubscribers(): void {
  if (registered) return;
  registered = true;
  onEvent("gate.state_changed", "sales.recompute_matches", async (event: AppendedEvent) => {
    if (event.unit_id) await recomputeMatchesForUnit(event.unit_id);
  });
  onEvent("payment.received", "sales.confirm_on_receipt", async (event: AppendedEvent) => {
    if (!event.booking_id) return;
    const b = await db.query<{ prospect_id: string | null }>(`SELECT prospect_id FROM booking WHERE id = $1`, [event.booking_id]);
    if (!b.rows[0]?.prospect_id) return; // only inventory bookings auto-confirm; the pre-24 path is 'submitted' already
    const blockers = await bookingConfirmBlockers(event.booking_id);
    if (blockers.length > 0) return;
    await withTx(undefined, (tx) => confirmDraft(event.booking_id!, tx, { actor_user_id: null, actor_kind: "SYSTEM" }));
  });
}

import { onEvent, withTx, type AppendedEvent } from "../events";
import { db } from "../db";
import { ensureUnitSpecification } from "./revisions";

// 09 rule 1: attach the approved baseline at booking confirmation. Two confirmation signals exist:
// 24's DRAFT→CONFIRMED (`booking.status_changed`) and the pre-24 path, which inserts the booking
// as 'submitted' straight away (`booking.created`) — for it, creation IS confirmation.
let registered = false;

export function registerSpecificationSubscribers(): void {
  if (registered) return;
  registered = true;
  const attach = async (event: AppendedEvent) => {
    if (!event.unit_id) return;
    await withTx(undefined, (tx) => ensureUnitSpecification(event.unit_id!, tx, { actor_user_id: event.actor_user_id ?? null, actor_kind: "SYSTEM" }));
  };
  onEvent("booking.status_changed", "specification.attach_baseline", async (event) => {
    if (event.payload?.to === "CONFIRMED") await attach(event);
  });
  onEvent("booking.created", "specification.attach_baseline", async (event) => {
    if (!event.booking_id) return;
    const b = await db.query<{ status: string }>(`SELECT status FROM booking WHERE id = $1`, [event.booking_id]);
    if (b.rows[0] && b.rows[0].status !== "draft") await attach(event);
  });
}

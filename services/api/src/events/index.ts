// Public surface of the event log (spec 02). Handlers import from here, not from the
// individual files, so the internal split (append/subscribers/registry/audit) can change
// without touching call sites.
import type { DbClient } from "../db/types";
import { EVENT_TYPES } from "./registry";

export { appendEvent, withTx, type EventInput, type AppendedEvent, type DbLike } from "./append";
export { onEvent, clearSubscribers, retryFailedDeliveries, type EventHandler } from "./subscribers";
export { getAudit, mask, type AuditQuery, type AuditRow } from "./audit";
export { EVENT_TYPES, APPENDIX_B_NAMES, type EventTypeDef } from "./registry";

/** Boot-time seed of the event_type registry — idempotent, run once per fresh DB. */
export async function seedEventTypes(db: DbClient): Promise<void> {
  for (const t of EVENT_TYPES) {
    await db.query(
      `INSERT INTO event_type (name, family, customer_visible, built) VALUES ($1,$2,$3,$4)
       ON CONFLICT (name) DO UPDATE SET family = $2, customer_visible = $3, built = $4`,
      [t.name, t.family, t.customer_visible, t.built]
    );
  }
}

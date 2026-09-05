import { onEvent, appendEvent, type AppendedEvent } from "../events";
import { db } from "../db";

// Rule 3's "auto-close when the condition clears" needs a real-time path, not just the next
// `scanEscalations` sweep: `scannableActions` (core.ts) excludes closed/cancelled actions and
// stopped clocks by construction, so an escalation whose action closes between two sweeps would
// never be revisited to resolve it. `action.closed`/`action.cancelled` (10, real, built:true)
// fire exactly at the moment the condition clears — subscribing to them closes that gap
// immediately instead of waiting for the next sweep.
let registered = false;

export function registerEscalationSubscribers(): void {
  if (registered) return; // idempotent — initDb() may run once per process already
  registered = true;

  const autoResolve = async (event: AppendedEvent) => {
    const open = await db.query<{ id: string; project_id: string | null }>(
      `SELECT id, project_id FROM escalation WHERE action_id = $1 AND status NOT IN ('RESOLVED','CLOSED')`,
      [event.entity_id]
    );
    for (const esc of open.rows) {
      await db.query(
        `UPDATE escalation SET status = 'RESOLVED', resolved_at = now(), auto_closed = true, resolution_notes = 'Auto-resolved: condition no longer met' WHERE id = $1`,
        [esc.id]
      );
      await appendEvent(db, {
        type: "escalation.resolved",
        entity_type: "escalation",
        entity_id: esc.id,
        project_id: esc.project_id,
        payload: { auto_closed: true, reason: event.type },
        actor_user_id: null,
        actor_kind: "SYSTEM",
      });
    }
  };

  onEvent("action.closed", "escalation.auto_resolve_on_close", autoResolve);
  onEvent("action.cancelled", "escalation.auto_resolve_on_cancel", autoResolve);
}

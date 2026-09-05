import { onEvent, type AppendedEvent } from "../events";
import { db } from "../db";
import { createNotification } from "./core";

// 12-escalations-notifications.md rule 5, wired subset (see core.ts's header for what's not
// wired and why). Same registration idiom as journey/subscribers.ts (06's first production
// subscriber) — runs after commit, opens no transaction of its own since these are read-then-
// insert, not part of the triggering mutation's atomicity.
let registered = false;

export function registerNotificationSubscribers(): void {
  if (registered) return; // idempotent — initDb() may run once per process already
  registered = true;

  onEvent("action.created", "notify.action_owner", async (event: AppendedEvent) => {
    const r = await db.query<{ owner_user_id: string | null; title: string }>(`SELECT owner_user_id, title FROM action WHERE id = $1`, [event.entity_id]);
    const owner = r.rows[0]?.owner_user_id;
    if (!owner || owner === event.actor_user_id) return; // rule 5: no self-notify
    await createNotification({ user_id: owner, type: "action.created", title: `New action: ${r.rows[0]!.title}`, entity_ref: { entity_type: "action", entity_id: event.entity_id } });
  });

  onEvent("action.reassigned", "notify.action_reassigned", async (event: AppendedEvent) => {
    const newOwner = (event.payload as { new_owner_user_id?: string })?.new_owner_user_id;
    if (!newOwner || newOwner === event.actor_user_id) return;
    const r = await db.query<{ title: string }>(`SELECT title FROM action WHERE id = $1`, [event.entity_id]);
    await createNotification({ user_id: newOwner, type: "action.reassigned", title: `Reassigned to you: ${r.rows[0]?.title ?? "action"}`, entity_ref: { entity_type: "action", entity_id: event.entity_id } });
  });

  onEvent("escalation.raised", "notify.escalation_owner", async (event: AppendedEvent) => {
    const r = await db.query<{ owner_user_id: string | null; tier: string; code: string }>(`SELECT owner_user_id, tier, code FROM escalation WHERE id = $1`, [event.entity_id]);
    const owner = r.rows[0]?.owner_user_id;
    if (!owner) return;
    await createNotification({
      user_id: owner,
      type: "escalation.raised",
      title: `Escalation ${r.rows[0]!.code} raised to you (${r.rows[0]!.tier})`,
      entity_ref: { entity_type: "escalation", entity_id: event.entity_id },
      level: "ESCALATION",
    });
  });

  onEvent("escalation.tier_changed", "notify.escalation_tier_owner", async (event: AppendedEvent) => {
    const r = await db.query<{ owner_user_id: string | null; tier: string; code: string }>(`SELECT owner_user_id, tier, code FROM escalation WHERE id = $1`, [event.entity_id]);
    const owner = r.rows[0]?.owner_user_id;
    if (!owner) return;
    await createNotification({
      user_id: owner,
      type: "escalation.tier_changed",
      title: `Escalation ${r.rows[0]!.code} now at your tier (${r.rows[0]!.tier})`,
      entity_ref: { entity_type: "escalation", entity_id: event.entity_id },
      level: "ESCALATION",
    });
  });
}

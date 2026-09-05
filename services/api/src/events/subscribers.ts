// In-process event subscribers (02 rule 4): "implement propagation ... idempotent and run
// after commit; failures are logged to event_delivery_failure and retried by a job — never
// swallowed." No production subscriber is wired from this PR — propagation targets (gate
// re-evaluation, readiness recompute, action creation) belong to specs 05/07/08/10, not yet
// merged in this worktree. The mechanism itself is built and tested (subscribers.test.ts).
import { db } from "../db";
import type { AppendedEvent } from "./append";

export type EventHandler = (event: AppendedEvent) => Promise<void> | void;

interface Registration {
  name: string;
  handler: EventHandler;
}

const subscribers = new Map<string, Registration[]>();

/** Register a subscriber for one event type. `name` identifies it in event_delivery_failure. */
export function onEvent(type: string, name: string, handler: EventHandler): void {
  const list = subscribers.get(type) ?? [];
  list.push({ name, handler });
  subscribers.set(type, list);
}

/** Test-only: drop all registrations so test files don't leak subscribers into each other. */
export function clearSubscribers(): void {
  subscribers.clear();
}

export async function dispatchAll(events: AppendedEvent[]): Promise<void> {
  for (const event of events) {
    for (const reg of subscribers.get(event.type) ?? []) {
      try {
        await reg.handler(event);
      } catch (err) {
        await recordDeliveryFailure(event, reg.name, err);
      }
    }
  }
}

async function recordDeliveryFailure(event: AppendedEvent, subscriberName: string, err: unknown): Promise<void> {
  await db.query(
    `INSERT INTO event_delivery_failure (event_id, subscriber, error) VALUES ($1,$2,$3)`,
    [event.id, subscriberName, err instanceof Error ? err.message : String(err)]
  );
}

/** The retry job (02 rule 4: "retried by a job"). Re-runs unresolved failures once. */
export async function retryFailedDeliveries(): Promise<{ retried: number; resolved: number }> {
  const failures = await db.query<{ id: string; event_id: string; subscriber: string; retry_count: number }>(
    `SELECT id, event_id, subscriber, retry_count FROM event_delivery_failure WHERE resolved_at IS NULL`
  );
  let resolved = 0;
  for (const f of failures.rows) {
    const ev = await db.query<AppendedEvent & { id: string }>(
      `SELECT id::text AS id, type, entity_type, entity_id, project_id, booking_id, unit_id,
              customer_id, actor_user_id, actor_kind, payload, source_ref, correlation_id,
              occurred_at::text AS occurred_at
         FROM event WHERE id = $1`,
      [f.event_id]
    );
    if (!ev.rows[0]) continue;
    const reg = (subscribers.get(ev.rows[0].type) ?? []).find((r) => r.name === f.subscriber);
    if (!reg) continue;
    try {
      await reg.handler(ev.rows[0]);
      await db.query(
        `UPDATE event_delivery_failure SET resolved_at = now(), retry_count = retry_count + 1 WHERE id = $1`,
        [f.id]
      );
      resolved++;
    } catch {
      await db.query(`UPDATE event_delivery_failure SET retry_count = retry_count + 1 WHERE id = $1`, [f.id]);
    }
  }
  return { retried: failures.rows.length, resolved };
}

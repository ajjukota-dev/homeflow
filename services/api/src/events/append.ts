// ctx.events.append() — always inside the same DB transaction as the mutation it records
// (02 rule 1). `withTx` is the one place a handler opens that transaction; nested handler
// calls (e.g. acceptBooking → setupFunding) pass their `tx` down instead of opening a second
// one — PGlite has no nested transactions. AsyncLocalStorage carries the "events appended in
// this transaction" list across that call chain without threading an extra parameter through
// every function signature; dispatchAll() runs the in-process subscribers once the outermost
// transaction has committed (rule 4: "run after commit").
import { AsyncLocalStorage } from "node:async_hooks";
import { db } from "../db";
import { dispatchAll } from "./subscribers";

/** The subset of PGlite's query surface every handler needs — satisfied by both `db` and a `tx`. */
export type DbLike = { query: typeof db.query };

export interface EventInput {
  type: string;
  entity_type: string;
  entity_id: string;
  project_id?: string | null;
  booking_id?: string | null;
  unit_id?: string | null;
  customer_id?: string | null;
  actor_user_id?: string | null;
  actor_kind?: "USER" | "SYSTEM" | "CUSTOMER";
  payload?: Record<string, unknown>;
  source_ref?: string | null;
  correlation_id?: string | null;
}

export interface AppendedEvent extends EventInput {
  id: string;
  occurred_at: string;
}

const pendingDispatch = new AsyncLocalStorage<AppendedEvent[]>();

/** Runs `fn` inside a transaction, reusing `maybeTx` if the caller already opened one. */
export async function withTx<T>(maybeTx: DbLike | undefined, fn: (tx: DbLike) => Promise<T>): Promise<T> {
  if (maybeTx) return fn(maybeTx);
  const collector: AppendedEvent[] = [];
  const result = await pendingDispatch.run(collector, () => db.transaction((tx) => fn(tx)));
  await dispatchAll(collector);
  return result;
}

/** ctx.events.append() — insert the row, then queue it for after-commit dispatch. */
export async function appendEvent(tx: DbLike, input: EventInput): Promise<AppendedEvent> {
  const r = await tx.query<{ id: string; occurred_at: string }>(
    `INSERT INTO event
      (type, project_id, entity_type, entity_id, booking_id, unit_id, customer_id,
       actor_user_id, actor_kind, payload, source_ref, correlation_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)
     RETURNING id::text AS id, occurred_at::text AS occurred_at`,
    [
      input.type,
      input.project_id ?? null,
      input.entity_type,
      input.entity_id,
      input.booking_id ?? null,
      input.unit_id ?? null,
      input.customer_id ?? null,
      input.actor_user_id ?? null,
      input.actor_kind ?? "SYSTEM",
      JSON.stringify(input.payload ?? {}),
      input.source_ref ?? null,
      input.correlation_id ?? null,
    ]
  );
  const event: AppendedEvent = { ...input, id: r.rows[0].id, occurred_at: r.rows[0].occurred_at };
  pendingDispatch.getStore()?.push(event);
  return event;
}

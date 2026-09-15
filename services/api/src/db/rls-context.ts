import { AsyncLocalStorage } from "node:async_hooks";
import type { Actor } from "../authz/types";

// Request-scoped actor for RLS GUCs. Same ALS idiom as events/append.ts pendingDispatch —
// handlers stay Express-free; the db port reads this store. Missed call site: fail-closed,
// never implicit superuser (TODO.md R2.5 P1b).

export type RlsStore =
  | { mode: "system" }
  | { mode: "actor"; actor: Actor }
  | { mode: "closed" };

const rlsStore = new AsyncLocalStorage<RlsStore>();

export function getRlsStore(): RlsStore | undefined {
  return rlsStore.getStore();
}

/** Migrations, seed, journey dispatch, scheduler runOnce, cross-project test fixtures. */
export function runAsSystem<T>(fn: () => Promise<T>): Promise<T> {
  return rlsStore.run({ mode: "system" }, fn);
}

/** Authenticated request (and tests that simulate one). */
export function runWithActor<T>(actor: Actor, fn: () => Promise<T>): Promise<T> {
  return rlsStore.run({ mode: "actor", actor }, fn);
}

/** Prove fail-closed even when vitest's default store is system. */
export function runFailClosed<T>(fn: () => Promise<T>): Promise<T> {
  return rlsStore.run({ mode: "closed" }, fn);
}

/** requireSession: persist for the Express request; clear on finish/close. */
export function enterActor(actor: Actor): void {
  rlsStore.enterWith({ mode: "actor", actor });
}

export function enterSystem(): void {
  rlsStore.enterWith({ mode: "system" });
}

export function clearRlsStore(): void {
  rlsStore.enterWith(undefined as unknown as RlsStore);
}

export interface RlsGucs {
  realm: string;
  user_id: string;
  customer_id: string;
  project_ids: string;
  all_projects: string;
}

export const EMPTY_GUCS: RlsGucs = {
  realm: "",
  user_id: "",
  customer_id: "",
  project_ids: "",
  all_projects: "false",
};

export function gucsFromActor(actor: Actor): RlsGucs {
  const all = actor.project_ids === "ALL";
  return {
    realm: actor.kind === "CUSTOMER" ? "customer" : "staff",
    user_id: actor.user_id,
    customer_id: actor.customer_id ?? "",
    project_ids: all ? "" : actor.project_ids.join(","),
    all_projects: all ? "true" : "false",
  };
}

/** Vitest fixtures default to system; production empty store is fail-closed. */
export function resolveRlsMode(): "system" | "actor" | "closed" {
  const store = getRlsStore();
  if (store?.mode === "actor") return "actor";
  if (store?.mode === "system") return "system";
  if (store?.mode === "closed") return "closed";
  if (process.env.VITEST || process.env.NODE_ENV === "test") return "system";
  return "closed";
}

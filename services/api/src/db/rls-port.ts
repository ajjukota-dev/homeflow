import type { DbClient, QueryResult } from "./types";
import {
  resolveRlsMode,
  getRlsStore,
  gucsFromActor,
  EMPTY_GUCS,
  type RlsGucs,
} from "./rls-context";

// Wraps a db client so request-path queries SET ROLE homeflow_app + app.* GUCs.
// System mode (runAsSystem / vitest fixtures) is a pass-through superuser.
// Nested withTx reuses the open tx — GUCs are SET LOCAL once, never a second BEGIN.

type RawClient = Pick<DbClient, "query" | "exec">;

const SET_GUCS_SESSION = `SELECT set_config('app.realm', $1, false),
       set_config('app.user_id', $2, false),
       set_config('app.customer_id', $3, false),
       set_config('app.project_ids', $4, false),
       set_config('app.all_projects', $5, false)`;
const SET_GUCS_LOCAL = `SELECT set_config('app.realm', $1, true),
       set_config('app.user_id', $2, true),
       set_config('app.customer_id', $3, true),
       set_config('app.project_ids', $4, true),
       set_config('app.all_projects', $5, true)`;

function gucParams(gucs: RlsGucs): string[] {
  return [gucs.realm, gucs.user_id, gucs.customer_id, gucs.project_ids, gucs.all_projects];
}

async function applyGucs(client: RawClient, gucs: RlsGucs, local: boolean): Promise<void> {
  await client.query(`SET ROLE homeflow_app`);
  await client.query(local ? SET_GUCS_LOCAL : SET_GUCS_SESSION, gucParams(gucs));
}

async function resetRls(client: RawClient): Promise<void> {
  try {
    await client.query(`RESET ROLE`);
  } catch {
    // already postgres, or SET ROLE never succeeded
  }
  try {
    await client.query(SET_GUCS_SESSION, ["", "", "", "", ""]);
  } catch {
    // session already gone
  }
}

function gucsForCurrentStore(): RlsGucs {
  const store = getRlsStore();
  if (store?.mode === "actor") return gucsFromActor(store.actor);
  return EMPTY_GUCS;
}

function passthrough(inner: DbClient): DbClient {
  return {
    query: (sql, params) => inner.query(sql, params),
    exec: (sql) => inner.exec(sql),
    close: () => inner.close(),
    transaction: () => {
      throw new Error("nested transactions are not supported");
    },
  };
}

export function wrapWithRls(inner: DbClient): DbClient {
  return {
    async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
      const mode = resolveRlsMode();
      if (mode === "system") return inner.query<T>(sql, params);
      try {
        await applyGucs(inner, gucsForCurrentStore(), false);
        return await inner.query<T>(sql, params);
      } finally {
        await resetRls(inner);
      }
    },
    async exec(sql: string): Promise<void> {
      const mode = resolveRlsMode();
      if (mode === "system") return inner.exec(sql);
      try {
        await applyGucs(inner, gucsForCurrentStore(), false);
        await inner.exec(sql);
      } finally {
        await resetRls(inner);
      }
    },
    close: () => inner.close(),
    async transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
      const mode = resolveRlsMode();
      return inner.transaction(async (tx) => {
        if (mode === "system") return fn(passthrough(tx));
        try {
          await applyGucs(tx, gucsForCurrentStore(), true);
          return await fn(passthrough(tx));
        } finally {
          await resetRls(tx);
        }
      });
    },
  };
}

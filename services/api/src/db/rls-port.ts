import { AsyncLocalStorage } from "node:async_hooks";
import type { DbClient, DbSession, QueryResult } from "./types";
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
// Actor query/exec checkout one connection (inner.withConnection) so pg Pool cannot
// run SET ROLE on client A and SELECT on client B.
// db.query/exec during an open transaction must use that same client — a second
// pool.connect (or PGlite instance.query while instance.transaction is live) hangs
// or drops RLS. Do not wrap reuse in a second BEGIN.

type RawClient = Pick<DbClient, "query" | "exec">;

const openTx = new AsyncLocalStorage<DbClient>();

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
    withConnection: (fn) => inner.withConnection(fn),
    transaction: () => {
      throw new Error("nested transactions are not supported");
    },
  };
}

export function wrapWithRls(inner: DbClient): DbClient {
  function pinned(): DbClient | undefined {
    return openTx.getStore();
  }

  async function withConnection<T>(fn: (conn: DbSession) => Promise<T>): Promise<T> {
    const tx = pinned();
    if (tx) return fn(tx);
    const mode = resolveRlsMode();
    if (mode === "system") return inner.withConnection(fn);
    return inner.withConnection(async (conn) => {
      try {
        await applyGucs(conn, gucsForCurrentStore(), false);
        return await fn(conn);
      } finally {
        await resetRls(conn);
      }
    });
  }

  async function runInTx<T>(tx: DbClient, mode: "system" | "actor" | "closed", fn: (tx: DbClient) => Promise<T>): Promise<T> {
    if (mode === "system") {
      const wrapped = passthrough(tx);
      return openTx.run(wrapped, () => fn(wrapped));
    }
    try {
      await applyGucs(tx, gucsForCurrentStore(), true);
      const wrapped = passthrough(tx);
      return await openTx.run(wrapped, () => fn(wrapped));
    } finally {
      await resetRls(tx);
    }
  }

  return {
    query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
      const tx = pinned();
      if (tx) return tx.query<T>(sql, params);
      const mode = resolveRlsMode();
      if (mode === "system") return inner.query<T>(sql, params);
      return withConnection((conn) => conn.query<T>(sql, params));
    },
    exec(sql: string): Promise<void> {
      const tx = pinned();
      if (tx) return tx.exec(sql);
      const mode = resolveRlsMode();
      if (mode === "system") return inner.exec(sql);
      return withConnection((conn) => conn.exec(sql));
    },
    withConnection,
    close: () => inner.close(),
    async transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
      const existing = pinned();
      if (existing) return fn(existing);
      const mode = resolveRlsMode();
      return inner.transaction((tx) => runInTx(tx, mode, fn));
    },
  };
}

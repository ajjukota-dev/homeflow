import { PGlite } from "@electric-sql/pglite";
import { mkdirSync } from "node:fs";
import type { DbClient, QueryResult } from "./types";
import { SET_SESSION_TIME_ZONE_SQL } from "./session";

// In-memory (tests, one per test file/worker) or persisted to a data
// directory (dev: ./.data/pglite) — same SQL dialect as prod Postgres.
// PGlite doesn't create parent directories itself, so a first boot with
// no ./.data yet (dev laptop or container) would otherwise crash.
// `ready` gates every call on the one-time session setup (time zone — see db/session.ts);
// PGlite is a single session, so a SET issued once holds for the process. Transactions reuse
// the same session and pass an already-settled promise.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- PGlite's own Transaction/PGlite types are structurally identical (query/exec) but not a shared interface
function wrap(instance: { query: any; exec: any; close?: any; transaction?: any }, ready: Promise<unknown>): DbClient {
  return {
    async query<T>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
      await ready;
      const result = await instance.query(sql, params as unknown[]);
      return { rows: result.rows };
    },
    exec: async (sql: string) => {
      await ready;
      await instance.exec(sql);
    },
    close: async () => {
      if (instance.close) await instance.close();
    },
    transaction: async <T>(fn: (tx: DbClient) => Promise<T>) => {
      await ready;
      return instance.transaction((tx: any) => fn(wrap(tx, Promise.resolve())));
    },
  };
}

export function createPgliteClient(dataDir?: string): DbClient {
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const instance = dataDir ? new PGlite(dataDir) : new PGlite();
  return wrap(instance, instance.exec(SET_SESSION_TIME_ZONE_SQL));
}

import { PGlite } from "@electric-sql/pglite";
import { mkdirSync } from "node:fs";
import type { DbClient, QueryResult } from "./types";

// In-memory (tests, one per test file/worker) or persisted to a data
// directory (dev: ./.data/pglite) — same SQL dialect as prod Postgres.
// PGlite doesn't create parent directories itself, so a first boot with
// no ./.data yet (dev laptop or container) would otherwise crash.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- PGlite's own Transaction/PGlite types are structurally identical (query/exec) but not a shared interface
function wrap(instance: { query: any; exec: any; close?: any; transaction?: any }): DbClient {
  return {
    async query<T>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
      const result = await instance.query(sql, params as unknown[]);
      return { rows: result.rows };
    },
    exec: async (sql: string) => {
      await instance.exec(sql);
    },
    close: async () => {
      if (instance.close) await instance.close();
    },
    transaction: <T>(fn: (tx: DbClient) => Promise<T>) => instance.transaction((tx: any) => fn(wrap(tx))),
  };
}

export function createPgliteClient(dataDir?: string): DbClient {
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const instance = dataDir ? new PGlite(dataDir) : new PGlite();
  return wrap(instance);
}

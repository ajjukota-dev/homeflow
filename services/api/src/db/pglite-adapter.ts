import { PGlite } from "@electric-sql/pglite";
import { mkdirSync } from "node:fs";
import type { DbClient, QueryResult } from "./types";

// In-memory (tests, one per test file/worker) or persisted to a data
// directory (dev: ./.data/pglite) — same SQL dialect as prod Postgres.
// PGlite doesn't create parent directories itself, so a first boot with
// no ./.data yet (dev laptop or container) would otherwise crash.
export function createPgliteClient(dataDir?: string): DbClient {
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const instance = dataDir ? new PGlite(dataDir) : new PGlite();
  return {
    async query<T>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
      const result = await instance.query<T>(sql, params as unknown[]);
      return { rows: result.rows };
    },
    exec: async (sql: string) => {
      await instance.exec(sql);
    },
    close: () => instance.close(),
  };
}

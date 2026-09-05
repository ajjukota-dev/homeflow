import pg from "pg";
import type { DbClient, QueryResult } from "./types";

// Prod adapter: `pg` Pool from DATABASE_URL. Same SQL as the pglite adapter
// (03-platform-deploy.md rule 2 — parity verified by running the API suite
// against both).
export function createPgClient(connectionString: string): DbClient {
  const pool = new pg.Pool({ connectionString });
  return {
    async query<T>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
      const result = await pool.query(sql, params as unknown[]);
      return { rows: result.rows as T[] };
    },
    async exec(sql: string): Promise<void> {
      // No params → pg sends it as a simple-query, which (like PGlite's
      // .exec) allows multiple ';'-separated statements in one call.
      await pool.query(sql);
    },
    close: () => pool.end(),
  };
}

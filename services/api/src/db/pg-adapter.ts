import pg from "pg";
import type { DbClient, QueryResult } from "./types";

// Prod adapter: `pg` Pool from DATABASE_URL. Same SQL as the pglite adapter
// (03-platform-deploy.md rule 2 — parity verified by running the API suite
// against both).
export function createPgClient(connectionString: string): DbClient {
  // RDS forces TLS (rds.force_ssl=1) but signs with its own CA, which
  // Node's default trust store doesn't carry — rejectUnauthorized:false
  // still encrypts the connection, just skips CA verification. Local/CI
  // Postgres (docker, no TLS) skips this entirely.
  const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);
  const pool = new pg.Pool({
    connectionString,
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
  });
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

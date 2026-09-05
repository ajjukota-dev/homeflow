// db port (03-platform-deploy.md): one shape, two adapters (pglite, pg).
// Kept structurally compatible with PGlite's own client so ~100 existing
// call sites (`db.query(sql, params)` / `db.exec(sql)`) need no changes.

export interface QueryResult<T> {
  rows: T[];
}

export interface DbClient {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  // Multi-statement SQL, no bound params (migrations, seed scripts).
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

// db port (03-platform-deploy.md): one shape, two adapters (pglite, pg).
// Kept structurally compatible with PGlite's own client so ~100 existing
// call sites (`db.query(sql, params)` / `db.exec(sql)`) need no changes.

export interface QueryResult<T> {
  rows: T[];
}

/** query/exec only — a pinned connection, with or without an open transaction. */
export type DbSession = Pick<DbClient, "query" | "exec">;

export interface DbClient {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  // Multi-statement SQL, no bound params (migrations, seed scripts).
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
  // Runs `fn` inside one BEGIN/COMMIT (ROLLBACK on throw); `tx` is a DbClient
  // scoped to that transaction (02 rule 1: events append in the same
  // transaction as the mutation they record).
  transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T>;
  // Pin one connection for `fn` without opening a transaction. wrapWithRls uses
  // this so SET ROLE + GUCs + the statement + RESET ROLE share a client (pg Pool
  // otherwise hands each query() to a different connection).
  withConnection<T>(fn: (conn: DbSession) => Promise<T>): Promise<T>;
}

import pg from "pg";
import type { DbClient, DbSession, QueryResult } from "./types";
import { SET_SESSION_TIME_ZONE_SQL } from "./session";

// Prod adapter: `pg` Pool from DATABASE_URL. Same SQL as the pglite adapter
// (03-platform-deploy.md rule 2 — parity verified by running the API suite
// against both).
//
// 4.1b: never use pool.query for actor work. pool.query can pick a different
// client than the previous SET ROLE. Checkout one client, run the statements,
// release.

export type PgQueryable = {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
};

export type PgPoolLike = {
  connect(): Promise<PgQueryable & { release(): void }>;
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
  end(): Promise<void>;
  on(event: "connect", listener: (client: PgQueryable) => void): unknown;
};

function bindSession(client: PgQueryable): DbSession {
  return {
    async query<T>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
      const result = await client.query(sql, params as unknown[]);
      return { rows: result.rows as T[] };
    },
    async exec(sql: string): Promise<void> {
      await client.query(sql);
    },
  };
}

/** Test seam: wrap a Pool-like so wrapWithRls can prove SET ROLE + SELECT share a client. */
export function bindPgPool(pool: PgPoolLike): DbClient {
  async function withConnection<T>(fn: (conn: DbSession) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      return await fn(bindSession(client));
    } finally {
      client.release();
    }
  }
  return {
    query: (sql, params) => withConnection((c) => c.query(sql, params)),
    exec: (sql) => withConnection((c) => c.exec(sql)),
    withConnection,
    close: () => pool.end(),
    async transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      const session = bindSession(client);
      const tx: DbClient = {
        query: session.query,
        exec: session.exec,
        withConnection: (innerFn) => innerFn(session),
        close: async () => {},
        transaction: () => {
          throw new Error("nested transactions are not supported");
        },
      };
      try {
        await client.query("BEGIN");
        const result = await fn(tx);
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

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
  // Session clock per pooled connection (db/session.ts). node-pg serialises a client's queries,
  // so a SET queued on 'connect' runs before the first checkout query on that connection.
  pool.on("connect", (client) => {
    client.query(SET_SESSION_TIME_ZONE_SQL).catch((err: unknown) => {
      console.error("db: failed to set session time zone", err);
    });
  });
  return bindPgPool(pool);
}

import { describe, expect, it } from "vitest";
import { wrapWithRls } from "./rls-port";
import { bindPgPool, type PgPoolLike } from "./pg-adapter";
import { runWithActor } from "./rls-context";
import type { Actor } from "../authz/types";

// 4.1b: wrapWithRls SET ROLE + statement + RESET ROLE must share one pg Pool client.
// PGlite is a single session so rls-request.test.ts cannot prove this.

type LogEntry = { clientId: number; sql: string };

function makeRecordingPool(): PgPoolLike & { log: LogEntry[]; connectCount: number; poolQueryCount: number } {
  let nextId = 0;
  const log: LogEntry[] = [];
  let connectCount = 0;
  let poolQueryCount = 0;

  function makeClient() {
    const clientId = ++nextId;
    return {
      query: async (sql: string) => {
        log.push({ clientId, sql });
        return { rows: [{ client_id: clientId }] };
      },
      release: () => {},
    };
  }

  return {
    log,
    get connectCount() {
      return connectCount;
    },
    get poolQueryCount() {
      return poolQueryCount;
    },
    connect: async () => {
      connectCount += 1;
      return makeClient();
    },
    query: async (sql: string) => {
      poolQueryCount += 1;
      const c = makeClient();
      return c.query(sql);
    },
    end: async () => {},
    on: () => {},
  };
}

const ACTOR: Actor = {
  user_id: "user_pin",
  display_name: "Pin",
  kind: "STAFF",
  roles: ["CRM"],
  project_ids: ["p_eastcrest"],
  default_project_id: "p_eastcrest",
};

describe("4.1b pg Pool pin", () => {
  it("wrapWithRls actor query holds one checked-out client across SET ROLE + statement + RESET", async () => {
    const pool = makeRecordingPool();
    const db = wrapWithRls(bindPgPool(pool));
    await runWithActor(ACTOR, () => db.query("SELECT 1"));

    expect(pool.poolQueryCount).toBe(0);
    expect(pool.connectCount).toBe(1);
    const ids = [...new Set(pool.log.map((e) => e.clientId))];
    expect(ids).toHaveLength(1);
    const sql = pool.log.map((e) => e.sql).join("\n");
    expect(sql).toMatch(/SET ROLE homeflow_app/i);
    expect(sql).toMatch(/SELECT 1/);
    expect(sql).toMatch(/RESET ROLE/i);
  });

  it("actor exec also pins one client (not pool.query per statement)", async () => {
    const pool = makeRecordingPool();
    const db = wrapWithRls(bindPgPool(pool));
    await runWithActor(ACTOR, () => db.exec("SELECT 2"));
    expect(pool.poolQueryCount).toBe(0);
    expect(pool.connectCount).toBe(1);
    expect(new Set(pool.log.map((e) => e.clientId)).size).toBe(1);
  });

  it("db.query inside transaction stays on the same checkout (no second client)", async () => {
    const pool = makeRecordingPool();
    const db = wrapWithRls(bindPgPool(pool));
    await db.transaction(async () => {
      await db.query("SELECT nested");
    });
    expect(pool.poolQueryCount).toBe(0);
    expect(pool.connectCount).toBe(1);
    expect(new Set(pool.log.map((e) => e.clientId)).size).toBe(1);
    const sql = pool.log.map((e) => e.sql).join("\n");
    expect(sql).toMatch(/BEGIN/i);
    expect(sql).toMatch(/SELECT nested/);
    expect(sql).toMatch(/COMMIT/i);
  });
});

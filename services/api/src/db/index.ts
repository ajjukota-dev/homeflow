import { createPgliteClient } from "./pglite-adapter";
import { createPgClient } from "./pg-adapter";
import { migrate } from "./migrate";
import { seed } from "../seed";
import type { DbClient } from "./types";

export type { DbClient } from "./types";

// Adapter choice is env-driven (03-platform-deploy.md): DATABASE_URL → pg
// (prod/RDS); test runner → in-memory pglite; otherwise pglite persisted to
// ./.data/pglite (dev). Same `db.query`/`db.exec` shape either way, so the
// ~100 existing call sites (`import { db } from "./db"`) are unchanged.
function makeClient(): DbClient {
  if (process.env.DATABASE_URL) return createPgClient(process.env.DATABASE_URL);
  if (process.env.NODE_ENV === "test" || process.env.VITEST) return createPgliteClient();
  return createPgliteClient("./.data/pglite");
}

export const db: DbClient = makeClient();

export async function setState(unitId: string, component: string, state: string): Promise<void> {
  await db.query(
    `UPDATE unit_progress SET state_code=$1, updated_at=now() WHERE unit_id=$2 AND component_code=$3`,
    [state, unitId, component]
  );
}

let ready: Promise<void> | null = null;
// Applies migrations, then seeds demo data only on a fresh DB — a
// disk-persisted dev DB must survive an API restart without duplicate-key
// crashes on re-seed. Demo seed (East Crest / Karthik Iyer fixtures) must
// never write itself into a real customer DB just because it's empty on
// first boot (found in review) — require an explicit opt-in in prod.
export function initDb(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await migrate(db);
      const seedAllowed = process.env.NODE_ENV !== "production" || process.env.SEED_DEMO === "1";
      if (!seedAllowed) return;
      const { rows } = await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM project`);
      if (Number(rows[0]?.count ?? 0) === 0) {
        await seed(db);
      }
    })();
  }
  return ready;
}

// Rule 3 (03-platform-deploy.md): one DB per test file. A fresh in-memory
// pglite, migrated and seeded, independent of the module-level `db` above.
export async function createTestDb(): Promise<DbClient> {
  const testDb = createPgliteClient();
  await migrate(testDb);
  await seed(testDb);
  return testDb;
}

// GET /health (03-platform-deploy.md: "checks DB").
export async function checkHealth(): Promise<boolean> {
  try {
    await db.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

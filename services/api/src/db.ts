import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { schema } from "./schema";
import { schemaLifecycle } from "./schema-lifecycle";
import { seed } from "./seed";
import { seedIdentity } from "./seed/permissions";
import { seedUsers } from "./seed/users";

// Local Postgres (PGlite) — real SQL, no Docker. Same schema deploys to Aurora
// by re-pointing the client (architecture.md §6b).

export const db = new PGlite();

// 00-conventions.md: one `db` port, `query(sql, params)`. Added here (ahead of
// the migration-runner lane's DB port) so identity code has one thing to
// import and swap later without touching call sites.
export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<{ rows: T[] }> {
  const result = await db.query<T>(sql, params);
  return { rows: result.rows };
}

const identityMigration = readFileSync(
  fileURLToPath(new URL("../migrations/0001_identity.sql", import.meta.url)),
  "utf-8"
);

export async function setState(unitId: string, component: string, state: string) {
  await db.query(
    `UPDATE unit_progress SET state_code=$1, updated_at=now() WHERE unit_id=$2 AND component_code=$3`,
    [state, unitId, component]
  );
}

let ready: Promise<void> | null = null;
export function initDb(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await db.exec(schema + schemaLifecycle);
      // Applied here (not yet via a migration runner — 03-platform-deploy owns
      // that) so `services/api/migrations/0001_identity.sql` is live for tests.
      await db.exec(identityMigration);
      await seed(db);
      await seedIdentity();
      await seedUsers();
    })();
  }
  return ready;
}

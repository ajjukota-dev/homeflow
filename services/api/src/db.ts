import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { schema } from "./schema";
import { schemaLifecycle } from "./schema-lifecycle";
import { seed } from "./seed";
import { seedEventTypes } from "./events";

// Local Postgres (PGlite) — real SQL, no Docker. Same schema deploys to Aurora
// by re-pointing the client (architecture.md §6b).

// Migrations 0002/0003 are applied here directly because the shared SQL migration runner
// (services/api/migrations/NNNN_*.sql applied by `npm run migrate`) is a parallel lane not
// yet merged into this worktree (02/04 coordination note). The files already live at their
// spec-mandated paths so the runner picks them up unchanged once it lands.
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
function readMigration(name: string): string {
  return readFileSync(join(migrationsDir, name), "utf8");
}

export const db = new PGlite();

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
      await db.exec(
        schema + schemaLifecycle + readMigration("0002_event.sql") + readMigration("0003_canonical.sql")
      );
      await seedEventTypes(db);
      await seed(db);
    })();
  }
  return ready;
}

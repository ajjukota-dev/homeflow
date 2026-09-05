import { PGlite } from "@electric-sql/pglite";
import { schema } from "./schema";
import { schemaLifecycle } from "./schema-lifecycle";
import { seed } from "./seed";

// Local Postgres (PGlite) — real SQL, no Docker. Same schema deploys to Aurora
// by re-pointing the client (architecture.md §6b).

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
      await db.exec(schema + schemaLifecycle);
      await seed(db);
    })();
  }
  return ready;
}

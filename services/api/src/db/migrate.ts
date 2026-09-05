import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DbClient } from "./types";

// services/api/migrations/NNNN_name.sql, applied in filename order, tracked
// by filename (not a number) so parallel lanes adding their own 0001_*.sql
// never silently shadow one another (03-platform-deploy.md).
const __dirname = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = join(__dirname, "..", "..", "migrations");

export async function migrate(db: DbClient, dir: string = MIGRATIONS_DIR): Promise<string[]> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migration (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const { rows } = await db.query<{ filename: string }>(`SELECT filename FROM schema_migration`);
  const applied = new Set(rows.map((r) => r.filename));

  const newlyApplied: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(dir, file), "utf8");
    await db.exec(sql);
    await db.query(`INSERT INTO schema_migration (filename) VALUES ($1)`, [file]);
    newlyApplied.push(file);
  }
  return newlyApplied;
}

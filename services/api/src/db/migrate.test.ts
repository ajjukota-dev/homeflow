import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPgliteClient } from "./pglite-adapter";
import { MIGRATIONS_DIR, migrate } from "./migrate";
import type { DbClient } from "./types";

// Bug 11: schema_migration is filename-only. 0045 was edited in place to add
// warranty_case.created_at. A database that already applied the old file must
// still gain that column from a later migration, and a fresh database that
// already has the column must apply the same file without error.

const REPAIR = "0048_warranty_case_created_at.sql";
const dirs: string[] = [];
const clients: DbClient[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((db) => db.close()));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-migrate-"));
  dirs.push(dir);
  return dir;
}

function openDb(): DbClient {
  const db = createPgliteClient();
  clients.push(db);
  return db;
}

async function hasCreatedAt(db: DbClient): Promise<boolean> {
  const r = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'warranty_case' AND column_name = 'created_at'`
  );
  return Number(r.rows[0]?.n ?? 0) === 1;
}

function repairSql(): string {
  return readFileSync(join(MIGRATIONS_DIR, REPAIR), "utf8");
}

describe("migrate — warranty_case.created_at repair", () => {
  it("adds created_at when 0045 is already recorded and the column is missing", async () => {
    const db = openDb();
    await db.exec(`CREATE TABLE warranty_case (id text PRIMARY KEY);`);
    await db.exec(`
      CREATE TABLE schema_migration (
        filename text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await db.query(`INSERT INTO schema_migration (filename) VALUES ($1)`, ["0045_post_handover.sql"]);

    const dir = tempDir();
    writeFileSync(join(dir, "0045_post_handover.sql"), "THIS MUST NOT RUN;\n");
    writeFileSync(join(dir, REPAIR), repairSql());

    const applied = await migrate(db, dir);
    expect(applied).toEqual([REPAIR]);
    expect(await hasCreatedAt(db)).toBe(true);
  });

  it("applies the repair on a fresh database whose 0045 already added the column", async () => {
    const db = openDb();
    await db.exec(`CREATE TABLE warranty_case (id text PRIMARY KEY);`);

    const dir = tempDir();
    writeFileSync(
      join(dir, "0045_post_handover.sql"),
      "ALTER TABLE warranty_case ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();\n"
    );
    writeFileSync(join(dir, REPAIR), repairSql());

    const applied = await migrate(db, dir);
    expect(applied).toEqual(["0045_post_handover.sql", REPAIR]);
    expect(await hasCreatedAt(db)).toBe(true);
  });
});

import { describe, it, expect, beforeAll } from "vitest";
import { initDb, db } from "../db";
import { createProject } from "../projects";
import { bulkCreateUnits, defaultHierarchyNodeId } from "./units";
import { superAdminCtx } from "../authz/test-helpers";

beforeAll(async () => {
  await initDb();
});

describe("bulk unit range create (04 §Screens)", () => {
  it("creates floors x letters as a grid, each with a UNT- code and unit.created event", async () => {
    const p = await createProject({ code: "bulk1", name: "Bulk Test" }, superAdminCtx);
    const ids = await bulkCreateUnits(p.id, {
      floor_from: 1,
      floor_to: 3,
      letter_from: "A",
      letter_to: "D",
      unit_type: "2BHK",
      facing: "East",
      product_type: "APARTMENT",
      base_price_inr: 6500000,
    }, superAdminCtx);
    expect(ids).toHaveLength(12); // 3 floors x 4 letters

    const units = await db.query<{ unit_number: string; code: string; product_type: string; floor_no: number }>(
      `SELECT unit_number, code, product_type, floor_no FROM unit WHERE project_id = $1 ORDER BY unit_number`,
      [p.id]
    );
    expect(units.rows).toHaveLength(12);
    expect(units.rows.every((u) => u.code.startsWith("UNT-"))).toBe(true);
    expect(units.rows.every((u) => u.product_type === "APARTMENT")).toBe(true);
    expect(units.rows.some((u) => u.unit_number === "1A")).toBe(true);
    expect(units.rows.some((u) => u.unit_number === "3D")).toBe(true);

    const events = await db.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM event WHERE type = 'unit.created' AND project_id = $1`,
      [p.id]
    );
    expect(events.rows[0].n).toBe(12);
  });

  it("rejects an inverted range", async () => {
    const p = await createProject({ code: "bulk2", name: "Bulk Test 2" }, superAdminCtx);
    await expect(
      bulkCreateUnits(p.id, {
        floor_from: 5,
        floor_to: 1,
        letter_from: "A",
        letter_to: "B",
        unit_type: "2BHK",
        facing: "East",
      }, superAdminCtx)
    ).rejects.toThrow();
  });

  it("falls back to the project's default hierarchy node when none is supplied", async () => {
    const p = await createProject({ code: "bulk3", name: "Bulk Test 3" }, superAdminCtx);
    await bulkCreateUnits(p.id, {
      floor_from: 1,
      floor_to: 1,
      letter_from: "A",
      letter_to: "A",
      unit_type: "2BHK",
      facing: "East",
    }, superAdminCtx);
    const defaultId = await defaultHierarchyNodeId(p.id);
    const u = await db.query<{ hierarchy_node_id: string }>(
      `SELECT hierarchy_node_id FROM unit WHERE project_id = $1`,
      [p.id]
    );
    expect(u.rows[0].hierarchy_node_id).toBe(defaultId);
  });
});

describe("unit.project_id is immutable (04 rule 1 — DB trigger + handler test)", () => {
  it("rejects a direct UPDATE that changes project_id", async () => {
    const other = await createProject({ code: "otherproj", name: "Other Project" }, superAdminCtx);
    await expect(
      db.query(`UPDATE unit SET project_id = $1 WHERE id = 'u_v101'`, [other.id])
    ).rejects.toThrow();
    // the row must be untouched after the rejected update
    const u = await db.query<{ project_id: string }>(`SELECT project_id FROM unit WHERE id = 'u_v101'`);
    expect(u.rows[0].project_id).toBe("p_eastcrest");
  });

  it("allows an UPDATE that leaves project_id unchanged", async () => {
    await expect(
      db.query(`UPDATE unit SET floor_no = 7 WHERE id = 'u_v101'`)
    ).resolves.toBeTruthy();
  });
});

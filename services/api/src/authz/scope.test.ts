import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { initDb, query } from "../db";
import { resolveProjectIds, assertProjectScope } from "./scope";
import { AppError } from "./types";

// Rule 4 [E §1.6] + p37 §31.5 t1/t9: MANAGEMENT/SUPER_ADMIN see all projects;
// everyone else gets today's effective-dated project_team_assignment rows.
describe("scope", () => {
  beforeAll(async () => {
    await initDb();
  });

  it("t1: MANAGEMENT/SUPER_ADMIN bypass scoping", async () => {
    expect(await resolveProjectIds("u1", ["MANAGEMENT"], "STAFF")).toBe("ALL");
    expect(await resolveProjectIds("u2", ["SUPER_ADMIN"], "STAFF")).toBe("ALL");
  });

  it("a dedicated CRM user sees only their assigned project", async () => {
    const userId = `u_${randomUUID()}`;
    await query(`INSERT INTO "user" (id, email, display_name, status, kind) VALUES ($1,$2,'Test User','ACTIVE','STAFF')`, [
      userId,
      `${userId}@test.local`,
    ]);
    await query(
      `INSERT INTO project_team_assignment (id, project_id, user_id, department, role_scope, effective_from) VALUES ($1,'p_eastcrest',$2,'CRM','CRM','2020-01-01')`,
      [randomUUID(), userId]
    );
    const ids = await resolveProjectIds(userId, ["CRM"], "STAFF");
    expect(ids).toEqual(["p_eastcrest"]);
  });

  it("t9: an assignment that ended in the past no longer scopes the user", async () => {
    const userId = `u_${randomUUID()}`;
    await query(`INSERT INTO "user" (id, email, display_name, status, kind) VALUES ($1,$2,'Ex User','ACTIVE','STAFF')`, [
      userId,
      `${userId}@test.local`,
    ]);
    await query(
      `INSERT INTO project_team_assignment (id, project_id, user_id, department, role_scope, effective_from, effective_to)
       VALUES ($1,'p_eastcrest',$2,'CRM','CRM','2020-01-01','2020-06-30')`,
      [randomUUID(), userId]
    );
    expect(await resolveProjectIds(userId, ["CRM"], "STAFF")).toEqual([]);
  });

  it("a row outside scope reads not_found and writes forbidden [E]", () => {
    const actor = { user_id: "x", display_name: "x", kind: "STAFF" as const, roles: ["CRM"], project_ids: ["p1"], default_project_id: "p1" };
    expect(() => assertProjectScope(actor, "p2", "read")).toThrow(AppError);
    try {
      assertProjectScope(actor, "p2", "read");
    } catch (e) {
      expect((e as AppError).code).toBe("not_found");
    }
    try {
      assertProjectScope(actor, "p2", "write");
    } catch (e) {
      expect((e as AppError).code).toBe("forbidden");
    }
  });

  it("customers scope to their bookings' projects via customer_login", async () => {
    const ids = await resolveProjectIds("user_customer_demo", ["CUSTOMER"], "CUSTOMER");
    expect(ids).toEqual(["p_eastcrest"]);
  });

  it("p37-31.5-t2: a receipt's project (derived from its Booking) is visible only to its own project's scope", async () => {
    const row = await query<{ project_id: string }>(`SELECT project_id FROM demand WHERE id = 'd_v112_1'`);
    const projectId = row.rows[0].project_id; // p_eastcrest — derived, never user-supplied
    const scoped = { user_id: "x", display_name: "x", kind: "STAFF" as const, roles: ["ACCOUNTS"], project_ids: [projectId], default_project_id: projectId };
    const other = { ...scoped, project_ids: ["p_other"] };
    expect(() => assertProjectScope(scoped, projectId, "read")).not.toThrow();
    expect(() => assertProjectScope(other, projectId, "read")).toThrow(AppError);
  });
});

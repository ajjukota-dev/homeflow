import { beforeAll, describe, expect, it } from "vitest";
import { initDb, query } from "../db";
import { createAssignment, updateAssignment, listAssignments } from "./adminAssignments";
import type { Ctx } from "../authz/types";

const admin: Ctx = { actor: { user_id: "user_superadmin", display_name: "Admin", kind: "STAFF", roles: ["SUPER_ADMIN"], project_ids: "ALL", default_project_id: null } };

// Rule 8: effective-dated assignments never rewrite history (p37 §31.5 t9).
describe("adminAssignments", () => {
  beforeAll(async () => {
    await initDb();
  });

  it("closing an assignment (effective_to) keeps the original row for past reporting", async () => {
    const userRow = await query<{ id: string }>(`SELECT id FROM "user" WHERE email = 'crm@demo.pranava'`);
    const { id } = await createAssignment(
      { project_id: "p_eastcrest", user_id: userRow.rows[0].id, department: "CRM", role_scope: "CRM", effective_from: "2020-01-01" },
      admin
    );
    await updateAssignment(id, { effective_to: "2026-01-01" }, admin);

    const rows = await listAssignments(admin, "p_eastcrest");
    const closed = rows.find((r) => r.id === id);
    const asDate = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);
    expect(asDate(closed?.effective_from)).toBe("2020-01-01"); // history untouched
    expect(asDate(closed?.effective_to)).toBe("2026-01-01");
  });

  it("SALES cannot create assignments", async () => {
    const sales: Ctx = { actor: { user_id: "x", display_name: "x", kind: "STAFF", roles: ["SALES"], project_ids: "ALL", default_project_id: null } };
    await expect(
      createAssignment({ project_id: "p_eastcrest", user_id: "u1", department: "SALES", role_scope: "SALES", effective_from: "2020-01-01" }, sales)
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});

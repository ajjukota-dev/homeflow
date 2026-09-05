import { beforeAll, describe, expect, it } from "vitest";
import { initDb } from "../db";
import { getPermissionMatrix, putPermissionMatrix } from "./adminPermissions";
import { effectiveLevel } from "../authz/authorize";
import type { Ctx } from "../authz/types";

const superAdmin: Ctx = { actor: { user_id: "user_superadmin", display_name: "Admin", kind: "STAFF", roles: ["SUPER_ADMIN"], project_ids: "ALL", default_project_id: null } };
const management: Ctx = { actor: { user_id: "user_management", display_name: "M", kind: "STAFF", roles: ["MANAGEMENT"], project_ids: "ALL", default_project_id: null } };

describe("adminPermissions", () => {
  beforeAll(async () => {
    await initDb();
  });

  it("seeds the 01-identity-access.md §1.3 matrix — SALES has no WRITE on unit_readiness", async () => {
    const rows = await getPermissionMatrix(superAdmin);
    const row = rows.find((r) => r.role_code === "SALES" && r.module === "unit_readiness");
    expect(row?.level).toBe("NONE");
  });

  it("MANAGEMENT (WRITE on administration) can read the matrix but not edit it", async () => {
    await expect(getPermissionMatrix(management)).resolves.toBeDefined();
    await expect(
      putPermissionMatrix({ changes: [{ role_code: "SALES", module: "dashboard", level: "WRITE" }] }, management)
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("only SUPER_ADMIN (ADMIN on administration) can edit — new version takes effect immediately", async () => {
    await putPermissionMatrix({ changes: [{ role_code: "SALES", module: "customer_documents", level: "READ" }] }, superAdmin);
    expect(await effectiveLevel(["SALES"], "customer_documents")).toBe("READ");
  });
});

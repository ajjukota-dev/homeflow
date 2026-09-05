import { beforeAll, describe, expect, it } from "vitest";
import { initDb } from "../db";
import { authorize, effectiveLevel } from "./authorize";
import { AppError } from "./types";

// Rule 5 + Rule 7 (p44 §33.6 t3): highest level across the actor's roles,
// effective today; NONE → forbidden. Sales/CRM have no WRITE on unit_readiness.
describe("authorize", () => {
  beforeAll(async () => {
    await initDb();
  });

  it("p44-33.6-t3: SALES has no WRITE on unit_readiness", async () => {
    await expect(
      authorize({ actor: { user_id: "x", display_name: "x", kind: "STAFF", roles: ["SALES"], project_ids: "ALL", default_project_id: null } }, "unit_readiness", "WRITE")
    ).rejects.toBeInstanceOf(AppError);
  });

  it("SITE has WRITE on unit_readiness", async () => {
    const level = await authorize(
      { actor: { user_id: "x", display_name: "x", kind: "STAFF", roles: ["SITE"], project_ids: "ALL", default_project_id: null } },
      "unit_readiness",
      "WRITE"
    );
    expect(level).toBe("WRITE");
  });

  it("rule 7: SALES has no WRITE on change_gate_rule's module (snagging)", async () => {
    await expect(
      authorize({ actor: { user_id: "x", display_name: "x", kind: "STAFF", roles: ["SALES"], project_ids: "ALL", default_project_id: null } }, "snagging", "WRITE")
    ).rejects.toBeInstanceOf(AppError);
  });

  it("SUPER_ADMIN has ADMIN everywhere", async () => {
    expect(await effectiveLevel(["SUPER_ADMIN"], "administration")).toBe("ADMIN");
  });

  it("a role with no permission_matrix row is NONE, not an error", async () => {
    expect(await effectiveLevel(["NOT_A_ROLE"], "dashboard")).toBe("NONE");
  });

  it("takes the highest level across multiple roles", async () => {
    // CRM has WRITE on customer_overview, SALES has READ — max is WRITE.
    expect(await effectiveLevel(["SALES", "CRM"], "customer_overview")).toBe("WRITE");
  });
});

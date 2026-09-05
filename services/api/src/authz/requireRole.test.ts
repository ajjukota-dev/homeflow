import { describe, expect, it } from "vitest";
import { requireRole, STAFF_ROLES, SITE_SETUP_ROLES } from "./requireRole";
import { ctxWithRoles } from "./test-helpers";

describe("requireRole", () => {
  it("allows an actor whose role is in the allow-list", () => {
    expect(() => requireRole(ctxWithRoles(["SITE"]), SITE_SETUP_ROLES)).not.toThrow();
  });

  it("rejects an actor whose roles are all outside the allow-list", () => {
    expect(() => requireRole(ctxWithRoles(["SALES"]), SITE_SETUP_ROLES)).toThrow(
      expect.objectContaining({ code: "forbidden" })
    );
  });

  it("CUSTOMER is not staff — rejected on STAFF_ROLES-gated master-data reads", () => {
    expect(() => requireRole(ctxWithRoles(["CUSTOMER"]), STAFF_ROLES)).toThrow(
      expect.objectContaining({ code: "forbidden" })
    );
  });
});

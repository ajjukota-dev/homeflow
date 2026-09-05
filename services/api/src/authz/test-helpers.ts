import type { Ctx } from "./types";

// Test-only Ctx builders (R0.6) — avoids re-typing the Actor literal in every
// *.test.ts file that now threads ctx into a gated handler.
export function ctxWithRoles(roles: string[], projectIds: string[] | "ALL" = "ALL"): Ctx {
  return {
    actor: {
      user_id: "test_user",
      display_name: "Test User",
      kind: "STAFF",
      roles,
      project_ids: projectIds,
      default_project_id: null,
    },
  };
}

export function customerCtx(userId = "test_customer"): Ctx {
  return {
    actor: {
      user_id: userId,
      display_name: "Test Customer",
      kind: "CUSTOMER",
      roles: ["CUSTOMER"],
      project_ids: "ALL",
      default_project_id: null,
    },
  };
}

export const superAdminCtx = ctxWithRoles(["SUPER_ADMIN"]);

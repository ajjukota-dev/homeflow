import { describe, it, expect, beforeAll } from "vitest";
import { initDb } from "../db";
import { ctxWithRoles } from "../authz/test-helpers";
import type { Ctx } from "../authz/types";
import { createProject } from "../projects";
import { createApprovalRule, requiredApprovers, listApprovalRules } from "./matrix";

// Approval authority matrix (25-policy-studio.md rule 2). *_by/changed_by FK to "user"(id) via
// policy.changed's actor_user_id — same fake-"test_user" FK gap actions/core.test.ts and
// journey/instances.test.ts already hit; use a real seeded user (seed/users.ts).
let mgmtCtx: Ctx;

beforeAll(async () => {
  await initDb();
  mgmtCtx = { actor: { ...ctxWithRoles(["MANAGEMENT"]).actor, user_id: "user_superadmin" } };
});

describe("approvals/matrix: createApprovalRule (rule 2, publish-time overlap guard)", () => {
  it("creates a band and rejects an overlapping one for the same domain/metric/scope", async () => {
    await createApprovalRule(
      { domain: "DISCOUNT", metric: "PCT", min: 0, max: 5, approver_role: "SALES", project_id: null, effective_from: "2026-01-01" },
      mgmtCtx
    );
    await expect(
      createApprovalRule({ domain: "DISCOUNT", metric: "PCT", min: 3, max: 8, approver_role: "MANAGEMENT", project_id: null, effective_from: "2026-01-01" }, mgmtCtx)
    ).rejects.toThrow(/overlaps/);
  });

  it("does not reject a non-overlapping adjacent band", async () => {
    await createApprovalRule(
      { domain: "DISCOUNT", metric: "PCT", min: 5, max: 10, approver_role: "MANAGEMENT", project_id: null, effective_from: "2026-01-01" },
      mgmtCtx
    );
    const rules = await listApprovalRules(mgmtCtx);
    expect(rules.filter((r) => r.domain === "DISCOUNT" && r.metric === "PCT").length).toBeGreaterThanOrEqual(2);
  });

  it("a project-specific band is allowed to overlap a global band's range (override, not a conflict)", async () => {
    const project = await createProject({ code: "MTX" + Date.now(), name: "Matrix Test Project" }, mgmtCtx);
    const projectId = project.id;
    await createApprovalRule(
      { domain: "WAIVER", metric: "INR", min: 0, max: 100000, approver_role: "ACCOUNTS", project_id: null, effective_from: "2026-01-01" },
      mgmtCtx
    );
    await expect(
      createApprovalRule({ domain: "WAIVER", metric: "INR", min: 0, max: 100000, approver_role: "MANAGEMENT", project_id: projectId, effective_from: "2026-01-01" }, mgmtCtx)
    ).resolves.toBeTruthy();
  });
});

describe("approvals/matrix: requiredApprovers (rule 2 lookup)", () => {
  it("picks the band whose [min,max) contains the value", async () => {
    const r = await requiredApprovers("DISCOUNT", "PCT", 2, null);
    expect(r.approver_role).toBe("SALES"); // the 0-5 band from the first test
  });

  it("prefers a project-specific band over a global one covering the same value", async () => {
    const rows = await listApprovalRules(mgmtCtx);
    const projectRule = rows.find((r) => r.domain === "WAIVER" && r.project_id !== null)!;
    const r = await requiredApprovers("WAIVER", "INR", 50000, projectRule.project_id);
    expect(r.approver_role).toBe("MANAGEMENT"); // project override, not ACCOUNTS (the global band)
  });

  it("fails closed (throws) when no band covers the value — a gap is not 'no approval needed'", async () => {
    await expect(requiredApprovers("PLAN_REVISION", "DAYS", 999, null)).rejects.toThrow(/no approval_authority_rule covers/);
  });

  it("two global bands with the same range but adjacent (non-overlapping) date windows: only the currently-effective one is picked (advisor review — candidates[0] ordering)", async () => {
    // assertNoOverlap allows this pair (same range, non-overlapping dates — a policy change over
    // time). The effective_from/effective_to filter in requiredApprovers' query must narrow to
    // exactly one row for "today", so candidates[0]'s arbitrary DB row order never matters.
    await createApprovalRule(
      { domain: "COMMITMENT", metric: "DAYS", min: 0, max: 30, approver_role: "SITE", project_id: null, effective_from: "2020-01-01", effective_to: "2026-09-05" },
      mgmtCtx
    );
    await createApprovalRule(
      { domain: "COMMITMENT", metric: "DAYS", min: 0, max: 30, approver_role: "MANAGEMENT", project_id: null, effective_from: "2026-09-05" },
      mgmtCtx
    );
    const r = await requiredApprovers("COMMITMENT", "DAYS", 10, null);
    expect(r.approver_role).toBe("MANAGEMENT"); // the currently-effective band, not the expired one
  });

  it("product_types[] round-trips through create -> list (rule 5's mechanism, no PLOT content invented)", async () => {
    await createApprovalRule(
      { domain: "HOLD", metric: "DAYS", min: 0, max: 7, approver_role: "SITE", project_id: null, product_types: ["PLOT"], effective_from: "2026-01-01" },
      mgmtCtx
    );
    const rows = await listApprovalRules(mgmtCtx);
    const r = rows.find((x) => x.domain === "HOLD" && x.metric === "DAYS")!;
    expect(r.product_types).toEqual(["PLOT"]);
  });
});

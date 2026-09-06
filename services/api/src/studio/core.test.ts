import { describe, it, expect, beforeAll } from "vitest";
import { initDb, db } from "../db";
import { ctxWithRoles } from "../authz/test-helpers";
import type { Ctx } from "../authz/types";
import { listStudioTable, draftStudioRow, publishStudioRow, studioRowHistory, previewStudioChange } from "./core";

// Generic Studio draft/publish/history envelope (25-policy-studio.md rule 1). *_by columns FK to
// "user"(id) — same fake-"test_user" gap other Studio-adjacent test files already hit.
let mgmtCtx: Ctx, siteCtx: Ctx;

beforeAll(async () => {
  await initDb();
  mgmtCtx = { actor: { ...ctxWithRoles(["MANAGEMENT"]).actor, user_id: "user_superadmin" } };
  siteCtx = { actor: { ...ctxWithRoles(["SITE"]).actor, user_id: "user_superadmin" } };
});

describe("studio/core: registry guards (advisor review — table name is never request-controlled SQL)", () => {
  it("rejects an unregistered table on every operation", async () => {
    await expect(listStudioTable("not_a_real_table", mgmtCtx)).rejects.toThrow(/unknown Studio table/);
    await expect(draftStudioRow("not_a_real_table", null, {}, undefined, mgmtCtx)).rejects.toThrow(/unknown Studio table/);
    await expect(publishStudioRow("not_a_real_table", "pv_x", "2026-01-01", undefined, mgmtCtx)).rejects.toThrow(/unknown Studio table/);
    await expect(previewStudioChange("not_a_real_table")).rejects.toThrow(/unknown Studio table/);
  });

  it("rejects a column not on the table's editable allowlist (no arbitrary column write)", async () => {
    await expect(draftStudioRow("delay_reason", "CUSTOMER", { label: "x", not_a_real_column: "y" }, undefined, mgmtCtx)).rejects.toThrow(/not an editable column/);
  });

  it("a non-edit-role staff member can read but not draft", async () => {
    await expect(listStudioTable("delay_reason", siteCtx)).resolves.toBeDefined();
    await expect(draftStudioRow("delay_reason", null, { code: "SITE_TRIED", label: "x", category: "INTERNAL", counts_against_sla: true }, undefined, siteCtx)).rejects.toThrow(/requires one of/);
  });
});

describe("studio/core: draft -> publish -> history (rule 1)", () => {
  it("creating a new row: nothing changes until publish, then it's live and history shows it", async () => {
    const before = await listStudioTable("delay_reason", mgmtCtx);
    const draftId = await draftStudioRow("delay_reason", null, { code: "STUDIO_TEST_NEW", label: "Studio test reason", category: "INTERNAL", counts_against_sla: true }, "initial", mgmtCtx);
    const afterDraft = await listStudioTable("delay_reason", mgmtCtx);
    expect(afterDraft.length).toBe(before.length); // draft only, not live yet

    await publishStudioRow("delay_reason", draftId, "2026-01-01", "go live", mgmtCtx);
    const afterPublish = await listStudioTable("delay_reason", mgmtCtx);
    expect(afterPublish.find((r) => r.code === "STUDIO_TEST_NEW")).toMatchObject({ label: "Studio test reason", category: "INTERNAL" });

    const history = await studioRowHistory("delay_reason", "STUDIO_TEST_NEW", mgmtCtx);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ version: 1, effective_from: "2026-01-01", change_note: "go live" });
  });

  it("editing an existing row: publish upserts (UPDATE, not a duplicate INSERT) and bumps version", async () => {
    const draft1 = await draftStudioRow("delay_reason", null, { code: "STUDIO_TEST_EDIT", label: "v1", category: "INTERNAL", counts_against_sla: true }, undefined, mgmtCtx);
    await publishStudioRow("delay_reason", draft1, "2026-01-01", undefined, mgmtCtx);

    const draft2 = await draftStudioRow("delay_reason", "STUDIO_TEST_EDIT", { label: "v2 relabeled", category: "VENDOR", counts_against_sla: false }, undefined, mgmtCtx);
    await publishStudioRow("delay_reason", draft2, "2026-02-01", undefined, mgmtCtx);

    const rows = await db.query<{ label: string; category: string }>(`SELECT label, category FROM delay_reason WHERE code = 'STUDIO_TEST_EDIT'`);
    expect(rows.rows).toHaveLength(1); // one row, updated in place
    expect(rows.rows[0]).toMatchObject({ label: "v2 relabeled", category: "VENDOR" });

    const history = await studioRowHistory("delay_reason", "STUDIO_TEST_EDIT", mgmtCtx);
    expect(history.map((h) => h.version)).toEqual([1, 2]);
  });

  it("publishing the same draft twice is refused (already published)", async () => {
    const draftId = await draftStudioRow("action_type", "exec_simple", { label: "Task (re-edited)" }, undefined, mgmtCtx);
    await publishStudioRow("action_type", draftId, "2026-01-01", undefined, mgmtCtx);
    await expect(publishStudioRow("action_type", draftId, "2026-01-01", undefined, mgmtCtx)).rejects.toThrow(/already published/);
  });

  it("product_types[] round-trips through draft -> publish (rule 5's mechanism, no PLOT content invented)", async () => {
    const draftId = await draftStudioRow("delay_reason", null, { code: "STUDIO_TEST_PRODUCT", label: "Plot-only reason", category: "INTERNAL", counts_against_sla: false, product_types: ["PLOT"] }, undefined, mgmtCtx);
    await publishStudioRow("delay_reason", draftId, "2026-01-01", undefined, mgmtCtx);
    const rows = await db.query<{ product_types: string[] | null }>(`SELECT product_types FROM delay_reason WHERE code = 'STUDIO_TEST_PRODUCT'`);
    expect(rows.rows[0].product_types).toEqual(["PLOT"]);
  });

  it("publishing writes policy.changed (rule 1)", async () => {
    const draftId = await draftStudioRow("project_calendar", null, { id: "cal_studio_test", name: "Studio Test Calendar", working_days: [1, 2, 3, 4, 5], holidays: [], timezone: "Asia/Kolkata" }, undefined, mgmtCtx);
    await publishStudioRow("project_calendar", draftId, "2026-01-01", undefined, mgmtCtx);
    const evt = await db.query<{ type: string }>(`SELECT type FROM event WHERE type = 'policy.changed' AND entity_type = 'project_calendar' AND entity_id = 'cal_studio_test'`);
    expect(evt.rows).toHaveLength(1);
  });
});

describe("studio/core: sla_policy (06-timeline-sla-engine.md's Studio tab, this file's header)", () => {
  it("drafts and publishes like any other registered table: in-place UPDATE, version bumps, `code`'s UNIQUE index is never at risk", async () => {
    const draft1 = await draftStudioRow(
      "sla_policy",
      null,
      { id: "sla_studio_test", code: "STUDIO_TEST_SLA", applies_to: "TASK_CODE", target_ref: "T_STUDIO_TEST", duration_value: 5, duration_unit: "WORKING_DAYS", effective_from: "2026-01-01" },
      undefined,
      mgmtCtx
    );
    await publishStudioRow("sla_policy", draft1, "2026-01-01", undefined, mgmtCtx);

    const draft2 = await draftStudioRow("sla_policy", "sla_studio_test", { duration_value: 7 }, "extended by 2 days", mgmtCtx);
    await publishStudioRow("sla_policy", draft2, "2026-03-01", "extended by 2 days", mgmtCtx);

    const rows = await db.query<{ code: string; duration_value: number }>(`SELECT code, duration_value FROM sla_policy WHERE id = 'sla_studio_test'`);
    expect(rows.rows).toHaveLength(1); // still one row for this code — no duplicate-key violation
    expect(rows.rows[0]).toMatchObject({ code: "STUDIO_TEST_SLA", duration_value: 7 });

    const history = await studioRowHistory("sla_policy", "sla_studio_test", mgmtCtx);
    expect(history.map((h) => h.version)).toEqual([1, 2]);
  });

  it("preview-impact is real for sla_policy: counts currently open sla_clock rows against this policy", async () => {
    const draftId = await draftStudioRow(
      "sla_policy",
      null,
      { id: "sla_preview_test", code: "STUDIO_TEST_PREVIEW", applies_to: "TASK_CODE", target_ref: "T_PREVIEW_TEST", duration_value: 3, duration_unit: "WORKING_DAYS", effective_from: "2026-01-01" },
      undefined,
      mgmtCtx
    );
    await publishStudioRow("sla_policy", draftId, "2026-01-01", undefined, mgmtCtx);

    // No clocks yet — a brand-new, never-instantiated policy affects nothing live.
    await expect(previewStudioChange("sla_policy", "sla_preview_test")).resolves.toEqual({ open_sla_clocks: 0 });

    await db.query(
      `INSERT INTO sla_clock (id, subject_type, subject_id, policy_id, due_at) VALUES ('clock_studio_test', 'task_instance', 'ti_studio_test', 'sla_preview_test', now() + interval '3 days')`
    );
    await expect(previewStudioChange("sla_policy", "sla_preview_test")).resolves.toEqual({ open_sla_clocks: 1 });

    // A stopped clock (already completed) is no longer "open" — must not count.
    await db.query(`UPDATE sla_clock SET stopped_at = now(), outcome = 'ON_TIME' WHERE id = 'clock_studio_test'`);
    await expect(previewStudioChange("sla_policy", "sla_preview_test")).resolves.toEqual({ open_sla_clocks: 0 });
  });

  it("preview-impact for sla_policy requires a row_id (nothing to count against otherwise)", async () => {
    await expect(previewStudioChange("sla_policy")).rejects.toThrow(/row_id is required/);
  });
});

describe("studio/core: 2026-09-06 batch (07/08/12/14/15/17/19/24 registry-only additions)", () => {
  const NEW_TABLES = [
    "component_definition", "change_category", "escalation_rule", "escalation_ladder",
    "materiality_threshold", "score_weight", "qa_checklist_template", "snag_sla_policy",
    "contractor", "handover_checklist_rule", "return_reason", "overdue_reason", "sales_policy",
  ];

  it("every newly-registered table's declared columns are real (listStudioTable doesn't 500 on any of them)", async () => {
    for (const t of NEW_TABLES) await expect(listStudioTable(t, mgmtCtx)).resolves.toBeInstanceOf(Array);
  });

  it("change_category (08, SITE-owned): SITE can draft/publish; MANAGEMENT (not SUPER_ADMIN) is refused, department-scoping actually holds", async () => {
    const draftId = await draftStudioRow("change_category", null, { code: "STUDIO_TEST_CATEGORY", customer_label: "Studio test category", sort_order: 99 }, undefined, siteCtx);
    await publishStudioRow("change_category", draftId, "2026-01-01", undefined, siteCtx);
    const rows = await db.query<{ customer_label: string }>(`SELECT customer_label FROM change_category WHERE code = 'STUDIO_TEST_CATEGORY'`);
    expect(rows.rows[0]).toMatchObject({ customer_label: "Studio test category" });

    await expect(
      draftStudioRow("change_category", null, { code: "STUDIO_TEST_CATEGORY_2", customer_label: "x", sort_order: 1 }, undefined, mgmtCtx)
    ).rejects.toThrow(/requires one of/);
  });

  it("score_weight (14): its own effective_from/effective_to/version columns behave like risk_rule/probability_rule — in-place UPDATE, version bumps", async () => {
    const draft1 = await draftStudioRow("score_weight", null, { id: "sw_studio_test", score_type: "READINESS", component: "structural", weight: 0.3, effective_from: "2026-01-01" }, undefined, mgmtCtx);
    await publishStudioRow("score_weight", draft1, "2026-01-01", undefined, mgmtCtx);
    const draft2 = await draftStudioRow("score_weight", "sw_studio_test", { weight: 0.5 }, undefined, mgmtCtx);
    await publishStudioRow("score_weight", draft2, "2026-02-01", undefined, mgmtCtx);

    const rows = await db.query<{ weight: string }>(`SELECT weight FROM score_weight WHERE id = 'sw_studio_test'`);
    expect(rows.rows).toHaveLength(1);
    expect(Number(rows.rows[0].weight)).toBe(0.5);
    const history = await studioRowHistory("score_weight", "sw_studio_test", mgmtCtx);
    expect(history.map((h) => h.version)).toEqual([1, 2]);
  });

  it("sales_policy (24): multiple jsonb columns on one row round-trip independently through draft -> publish", async () => {
    const draftId = await draftStudioRow(
      "sales_policy",
      null,
      {
        id: "sp_studio_test",
        highly_customisable_min: 60,
        closing_soon_days: 10,
        match_stale_hours: 12,
        match_weights: { MUST_HAVE: 5, PREFERRED: 2, NOT_IMPORTANT: 0 },
        state_values: { OPEN: 1, CLOSING: 0.5 },
        must_have_hard_closed_cap: 30,
        filter_categories: { layout_flexible: "structural" },
      },
      undefined,
      mgmtCtx
    );
    await publishStudioRow("sales_policy", draftId, "2026-01-01", undefined, mgmtCtx);
    const rows = await db.query<{ match_weights: Record<string, number>; state_values: Record<string, number> }>(
      `SELECT match_weights, state_values FROM sales_policy WHERE id = 'sp_studio_test'`
    );
    expect(rows.rows[0].match_weights).toEqual({ MUST_HAVE: 5, PREFERRED: 2, NOT_IMPORTANT: 0 });
    expect(rows.rows[0].state_values).toEqual({ OPEN: 1, CLOSING: 0.5 });
  });
});

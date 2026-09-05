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

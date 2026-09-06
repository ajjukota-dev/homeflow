import { describe, it, expect, beforeAll } from "vitest";
import { initDb, db } from "../db";
import { ctxWithRoles } from "../authz/test-helpers";
import type { Ctx } from "../authz/types";
import {
  createTemplate,
  listTemplates,
  listVersions,
  createVersion,
  getVersion,
  putVersionContent,
  publishVersion,
  assignTemplateToProject,
  previewVersion,
  type VersionContentInput,
} from "./templates";

beforeAll(async () => {
  await initDb();
});

// FK'd to a real "user" row (journey_template_version.published_by) — seed/users.ts's
// demo super admin, not the fake "test_user" id test-helpers' superAdminCtx carries.
const adminCtx: Ctx = { actor: { ...ctxWithRoles(["SUPER_ADMIN"]).actor, user_id: "user_superadmin" } };
const salesCtx = ctxWithRoles(["SALES"]);

function minimalContent(overrides: Partial<VersionContentInput> = {}): VersionContentInput {
  return {
    stages: [
      {
        code: "BOOKING",
        name: "Booking",
        stream: "COMMERCIAL",
        planned_duration_days: 5,
        owner_department: "SALES",
        tasks: [
          { code: "T1", title: "Collect KYC", owner_role: "SALES", task_type: "MANDATORY", execution_type: "SIMPLE" },
        ],
      },
      {
        code: "LEGAL",
        name: "Legal",
        stream: "LEGAL",
        planned_duration_days: 10,
        owner_department: "LEGAL",
        tasks: [
          { code: "T2", title: "Draft AOS", owner_role: "LEGAL", task_type: "MANDATORY", execution_type: "SIMPLE" },
        ],
      },
    ],
    dependencies: [{ from_task_code: "T1", to_task_code: "T2", kind: "FINISH_TO_START" }],
    ...overrides,
  };
}

describe("journey templates (05-journey-templates.md)", () => {
  it("requireRole rejects a non-Policy-Studio role", async () => {
    await expect(
      createTemplate({ code: "std", name: "Pranava Standard", scope: "STANDARD" }, salesCtx)
    ).rejects.toThrow();
  });

  it("creates a STANDARD template and lists it", async () => {
    const id = await createTemplate({ code: "std_journey_1", name: "Pranava Standard", scope: "STANDARD" }, adminCtx);
    const list = await listTemplates(adminCtx);
    expect(list.some((t) => t.id === id)).toBe(true);
  });

  it("rejects a PROJECT-scope template with no project_id", async () => {
    await expect(
      createTemplate({ code: "no_proj", name: "Bad", scope: "PROJECT" }, adminCtx)
    ).rejects.toThrow(/project_id/);
  });

  it("first version of a template starts empty; putVersionContent then getVersion round-trips it", async () => {
    const templateId = await createTemplate({ code: "std_journey_2", name: "Standard 2", scope: "STANDARD" }, adminCtx);
    const versionId = await createVersion(templateId, adminCtx);
    const empty = await getVersion(versionId, adminCtx);
    expect(empty.stages).toEqual([]);

    await putVersionContent(versionId, minimalContent(), adminCtx);
    const filled = await getVersion(versionId, adminCtx);
    expect(filled.stages.map((s) => s.code)).toEqual(["BOOKING", "LEGAL"]);
    expect(filled.stages[0].tasks.map((t) => t.code)).toEqual(["T1"]);
    expect(filled.dependencies).toHaveLength(1);
  });

  it("rule 6: publish rejects an unparseable condition_expr (fail-closed)", async () => {
    const templateId = await createTemplate({ code: "bad_expr", name: "Bad Expr", scope: "STANDARD" }, adminCtx);
    const versionId = await createVersion(templateId, adminCtx);
    await putVersionContent(versionId, minimalContent({
      stages: [
        {
          code: "BOOKING", name: "Booking", stream: "COMMERCIAL", planned_duration_days: 5,
          owner_department: "SALES", condition_expr: "this is not valid",
          tasks: [{ code: "T1", title: "Collect KYC", owner_role: "SALES", task_type: "MANDATORY", execution_type: "SIMPLE" }],
        },
      ],
      dependencies: [],
    }), adminCtx);
    await expect(publishVersion(versionId, {}, adminCtx)).rejects.toThrow(/unparseable/);
  });

  it("rule 5: publish rejects a cyclic journey_dependency", async () => {
    const templateId = await createTemplate({ code: "cyclic", name: "Cyclic", scope: "STANDARD" }, adminCtx);
    const versionId = await createVersion(templateId, adminCtx);
    await putVersionContent(versionId, minimalContent({
      dependencies: [
        { from_task_code: "T1", to_task_code: "T2", kind: "FINISH_TO_START" },
        { from_task_code: "T2", to_task_code: "T1", kind: "FINISH_TO_START" },
      ],
    }), adminCtx);
    await expect(publishVersion(versionId, {}, adminCtx)).rejects.toThrow(/cycle/);
  });

  it("publishes a valid DRAFT version, stamps published_by, and emits template.version_published", async () => {
    const templateId = await createTemplate({ code: "publishable", name: "Publishable", scope: "STANDARD" }, adminCtx);
    const versionId = await createVersion(templateId, adminCtx);
    await putVersionContent(versionId, minimalContent(), adminCtx);

    const events = await db.query<{ type: string; entity_id: string }>(
      `SELECT type, entity_id FROM event WHERE type = 'template.version_published' AND entity_id = $1`,
      [versionId]
    );
    expect(events.rows).toHaveLength(0);

    const published = await publishVersion(versionId, { change_note: "initial" }, adminCtx);
    expect(published.status).toBe("PUBLISHED");

    const v = await getVersion(versionId, adminCtx);
    expect(v.status).toBe("PUBLISHED");

    const eventsAfter = await db.query<{ type: string; entity_id: string }>(
      `SELECT type, entity_id FROM event WHERE type = 'template.version_published' AND entity_id = $1`,
      [versionId]
    );
    expect(eventsAfter.rows).toHaveLength(1);
  });

  it("only a DRAFT version can be edited or published again", async () => {
    const templateId = await createTemplate({ code: "immutable", name: "Immutable", scope: "STANDARD" }, adminCtx);
    const versionId = await createVersion(templateId, adminCtx);
    await putVersionContent(versionId, minimalContent(), adminCtx);
    await publishVersion(versionId, {}, adminCtx);

    await expect(putVersionContent(versionId, minimalContent(), adminCtx)).rejects.toThrow(/DRAFT/);
    await expect(publishVersion(versionId, {}, adminCtx)).rejects.toThrow(/DRAFT/);
  });

  it("createVersion drafts-from-current: a new version copies the prior PUBLISHED version's content", async () => {
    const templateId = await createTemplate({ code: "draft_from_current", name: "Draft From Current", scope: "STANDARD" }, adminCtx);
    const v1 = await createVersion(templateId, adminCtx);
    await putVersionContent(v1, minimalContent(), adminCtx);
    await publishVersion(v1, {}, adminCtx);

    const v2 = await createVersion(templateId, adminCtx);
    const v2Content = await getVersion(v2, adminCtx);
    expect(v2Content.version).toBe(2);
    expect(v2Content.status).toBe("DRAFT");
    expect(v2Content.stages.map((s) => s.code)).toEqual(["BOOKING", "LEGAL"]);
  });

  it("listVersions returns every version of a template newest-first, for the Studio's version picker and publish-diff", async () => {
    const templateId = await createTemplate({ code: "list_versions", name: "List Versions", scope: "STANDARD" }, adminCtx);
    const v1 = await createVersion(templateId, adminCtx);
    await putVersionContent(v1, minimalContent(), adminCtx);
    await publishVersion(v1, {}, adminCtx);
    const v2 = await createVersion(templateId, adminCtx);

    const versions = await listVersions(templateId, adminCtx);
    expect(versions.map((v) => [v.version, v.status])).toEqual([
      [2, "DRAFT"],
      [1, "PUBLISHED"],
    ]);
    expect(versions.find((v) => v.id === v2)).toBeTruthy();
  });

  it("rule 1: only a PUBLISHED version can be assigned to a project; emits template.assigned_to_project", async () => {
    const templateId = await createTemplate({ code: "assignable", name: "Assignable", scope: "STANDARD" }, adminCtx);
    const draftVersion = await createVersion(templateId, adminCtx);
    await putVersionContent(draftVersion, minimalContent(), adminCtx);

    await expect(assignTemplateToProject("p_eastcrest", draftVersion, adminCtx)).rejects.toThrow(/PUBLISHED/);

    await publishVersion(draftVersion, {}, adminCtx);
    await assignTemplateToProject("p_eastcrest", draftVersion, adminCtx);

    const project = await db.query<{ journey_template_version_id: string }>(
      `SELECT journey_template_version_id FROM project WHERE id = 'p_eastcrest'`
    );
    expect(project.rows[0].journey_template_version_id).toBe(draftVersion);

    const events = await db.query<{ type: string }>(
      `SELECT type FROM event WHERE type = 'template.assigned_to_project' AND entity_id = 'p_eastcrest'`
    );
    expect(events.rows.length).toBeGreaterThan(0);
  });

  it("OFFER_MIGRATION publish over a prior PUBLISHED version emits journey.migration_offered", async () => {
    const templateId = await createTemplate({ code: "migratable", name: "Migratable", scope: "STANDARD" }, adminCtx);
    const v1 = await createVersion(templateId, adminCtx);
    await putVersionContent(v1, minimalContent(), adminCtx);
    await publishVersion(v1, {}, adminCtx);

    const v2 = await createVersion(templateId, adminCtx);
    await publishVersion(v2, { migration_rule: "OFFER_MIGRATION" }, adminCtx);

    const events = await db.query<{ type: string }>(
      `SELECT type FROM event WHERE type = 'journey.migration_offered' AND entity_id = $1`,
      [v2]
    );
    expect(events.rows).toHaveLength(1);
  });

  it("rule 3: a PROJECT-scope version cannot drop a Standard parent's mandatory stage", async () => {
    const standardId = await createTemplate({ code: "parent_std", name: "Parent Standard", scope: "STANDARD" }, adminCtx);
    const standardV1 = await createVersion(standardId, adminCtx);
    await putVersionContent(standardV1, minimalContent(), adminCtx);
    await publishVersion(standardV1, {}, adminCtx);

    const overrideId = await createTemplate(
      { code: "override_proj", name: "East Crest Override", scope: "PROJECT", project_id: "p_eastcrest", parent_template_id: standardId },
      adminCtx
    );
    const overrideV1 = await createVersion(overrideId, adminCtx);
    // Drops the LEGAL stage entirely, which the Standard parent marks mandatory by default.
    await putVersionContent(overrideV1, minimalContent({
      stages: [
        {
          code: "BOOKING", name: "Booking", stream: "COMMERCIAL", planned_duration_days: 5,
          owner_department: "SALES",
          tasks: [{ code: "T1", title: "Collect KYC", owner_role: "SALES", task_type: "MANDATORY", execution_type: "SIMPLE" }],
        },
      ],
      dependencies: [],
    }), adminCtx);

    await expect(publishVersion(overrideV1, {}, adminCtx)).rejects.toThrow(/mandatory stage/);
  });

  it("previewVersion excludes conditional stages/tasks whose condition_expr doesn't match", () => {
    const content = minimalContent({
      stages: [
        {
          code: "BOOKING", name: "Booking", stream: "COMMERCIAL", planned_duration_days: 5,
          owner_department: "SALES",
          tasks: [{ code: "T1", title: "Collect KYC", owner_role: "SALES", task_type: "MANDATORY", execution_type: "SIMPLE" }],
        },
        {
          code: "NRI_ONLY", name: "NRI paperwork", stream: "LEGAL", planned_duration_days: 3,
          owner_department: "LEGAL", condition_expr: 'customer.residency == "NRI"',
          tasks: [
            { code: "T2", title: "Base task", owner_role: "LEGAL", task_type: "MANDATORY", execution_type: "SIMPLE" },
            { code: "T3", title: "PoA only", owner_role: "LEGAL", task_type: "CONDITIONAL", execution_type: "SIMPLE", condition_expr: "unit.product_type in [VILLA,PLOT]" },
          ],
        },
      ],
      dependencies: [],
    });

    const resident = previewVersion(content, { residency: "RESIDENT", product_type: "APARTMENT" });
    expect(resident.map((s) => s.stage_code)).toEqual(["BOOKING"]);

    const nri = previewVersion(content, { residency: "NRI", product_type: "APARTMENT" });
    expect(nri.map((s) => s.stage_code)).toEqual(["BOOKING", "NRI_ONLY"]);
    expect(nri.find((s) => s.stage_code === "NRI_ONLY")?.task_codes).toEqual(["T2"]);

    const nriVilla = previewVersion(content, { residency: "NRI", product_type: "VILLA" });
    expect(nriVilla.find((s) => s.stage_code === "NRI_ONLY")?.task_codes).toEqual(["T2", "T3"]);
  });
});

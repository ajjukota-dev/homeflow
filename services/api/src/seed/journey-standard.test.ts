import { describe, it, expect, beforeAll } from "vitest";
import { initDb, db } from "../db";
import { validateForPublish } from "../journey/templates";

beforeAll(async () => {
  await initDb();
});

// Real-data regression: the hand-authored seed must itself satisfy the rules it's meant to
// demonstrate (rule 5 no cycle, rule 6 fail-closed DSL) — proves the seed isn't just
// "inserted without error" but actually publishable.
describe("seed/journey-standard: Pranava Standard passes its own publish gate", () => {
  it("validateForPublish accepts the seeded version (rules 5 + 6)", async () => {
    await expect(validateForPublish("jtv_pranava_standard_v1")).resolves.not.toThrow();
  });

  it("seeds exactly the 12 stages from 05-journey-templates.md's list, in order", async () => {
    const { rows } = await db.query<{ code: string }>(
      `SELECT code FROM journey_stage_template WHERE version_id = 'jtv_pranava_standard_v1' ORDER BY sort_order`
    );
    expect(rows.map((r) => r.code)).toEqual([
      "PRESALES", "BOOKING", "SALES_CRM_HANDOVER", "DOCS_KYC", "AGREEMENT", "PAYMENTS_FUNDING",
      "REGISTRATION", "CONSTRUCTION", "CUSTOMISATION", "READINESS_QA", "HANDOVER", "POST_HANDOVER",
    ]);
  });

  it("seeds all 19 tasks (T1-T13 + PT1-PT6) across the 12 stages", async () => {
    const { rows } = await db.query<{ count: string }>(
      `SELECT count(*)::text FROM journey_task_template
        WHERE stage_template_id IN (SELECT id FROM journey_stage_template WHERE version_id = 'jtv_pranava_standard_v1')`
    );
    expect(Number(rows[0].count)).toBe(19);
  });

  it("East Crest's Project-scope override is published and assigned to p_eastcrest", async () => {
    const project = await db.query<{ journey_template_version_id: string | null }>(
      `SELECT journey_template_version_id FROM project WHERE id = 'p_eastcrest'`
    );
    expect(project.rows[0].journey_template_version_id).toBe("jtv_eastcrest_v1");
    await expect(validateForPublish("jtv_eastcrest_v1")).resolves.not.toThrow();
  });
});

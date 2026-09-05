import { describe, it, expect, beforeAll } from "vitest";
import { initDb, db } from "../db";
import { superAdminCtx as fakeSuperAdminCtx, ctxWithRoles } from "../authz/test-helpers";
import { createProject, createUnit } from "../projects";
import type { Ctx } from "../authz/types";
import { updateProgress, getUnitProgress, previewBulkUpdate, applyBulkUpdate, scanStaleProgress } from "./core";

// 07-unit-progress-control.md. Real seeded demo users (seed/users.ts): user_site is SITE,
// user_qa is QA (WRITE on unit_readiness via the SITE column), user_sales is SALES (NONE).
const superAdminCtx: Ctx = { actor: { ...fakeSuperAdminCtx.actor, user_id: "user_superadmin" } };
function ctxAs(userId: string, roles: string[]): Ctx {
  return { actor: { ...ctxWithRoles(roles).actor, user_id: userId } };
}
const site = () => ctxAs("user_site", ["SITE"]);
const qa = () => ctxAs("user_qa", ["QA"]);
const sales = () => ctxAs("user_sales", ["SALES"]);

let PROJECT_ID: string;
let unitSeq = 0;

beforeAll(async () => {
  await initDb();
  const p = await createProject({ code: "progresstest", name: "Progress Test Project" }, superAdminCtx);
  PROJECT_ID = p.id;
});

async function freshUnit(): Promise<string> {
  unitSeq += 1;
  const u = await createUnit(PROJECT_ID, { unit_number: `P-${unitSeq}`, unit_type: "3BHK", facing: "East" }, superAdminCtx);
  return u!.id;
}

const cell = async (unitId: string, component: string, asOf?: string) =>
  (await getUnitProgress(unitId, undefined, asOf)).components.find((c) => c.component_code === component)!;

describe("updateProgress — rules 1, 2, 7 (who may write; source/who/when on every cell; before/after event)", () => {
  it("refuses SALES at the authorize layer, stamps SITE_ENTRY + updated_by for SITE, and emits progress.updated with from/to", async () => {
    const unitId = await freshUnit();
    await expect(updateProgress(unitId, "mep_first_fix", { state_code: "IN_PROGRESS" }, sales())).rejects.toThrow(/WRITE/);

    await updateProgress(unitId, "mep_first_fix", { state_code: "IN_PROGRESS" }, site());
    const c = await cell(unitId, "mep_first_fix");
    expect(c.state_code).toBe("IN_PROGRESS");
    expect(c.source).toBe("SITE_ENTRY");
    expect(c.updated_by).toBe("user_site");
    expect(c.freshness).toBe("FRESH");

    const evt = await db.query<{ payload: { from: string; to: string } }>(
      `SELECT payload FROM event WHERE unit_id = $1 AND type = 'progress.updated' ORDER BY occurred_at DESC LIMIT 1`,
      [unitId]
    );
    expect(evt.rows[0]!.payload).toMatchObject({ from: "not_started", to: "in_progress" });
  });
});

describe("rule 3 — regression from COMPLETE/VERIFIED needs a reason and is audited", () => {
  it("rejects COMPLETE → IN_PROGRESS without a reason; with one, writes progress_reopen and emits progress.reopened", async () => {
    const unitId = await freshUnit();
    await updateProgress(unitId, "mep_first_fix", { state_code: "COMPLETE" }, site());
    await expect(updateProgress(unitId, "mep_first_fix", { state_code: "IN_PROGRESS" }, site())).rejects.toThrow(/reason/);

    await updateProgress(unitId, "mep_first_fix", { state_code: "IN_PROGRESS", reason: "Conduit rerouted after leak" }, site());
    const reopen = await db.query<{ from_state: string; to_state: string; reason: string }>(`SELECT from_state, to_state, reason FROM progress_reopen WHERE unit_id = $1`, [unitId]);
    expect(reopen.rows).toEqual([{ from_state: "complete", to_state: "in_progress", reason: "Conduit rerouted after leak" }]);
    const evt = await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM event WHERE unit_id = $1 AND type = 'progress.reopened'`, [unitId]);
    expect(Number(evt.rows[0]!.count)).toBe(1);
  });
});

describe("rule 4 — VERIFIED is QA's, COMPLETE is Site's", () => {
  it("SITE cannot set VERIFIED and QA cannot declare COMPLETE; each may set their own", async () => {
    const unitId = await freshUnit();
    await expect(updateProgress(unitId, "flooring", { state_code: "VERIFIED" }, site())).rejects.toThrow(/QA/);
    await expect(updateProgress(unitId, "flooring", { state_code: "COMPLETE" }, qa())).rejects.toThrow(/SITE/);
    await updateProgress(unitId, "flooring", { state_code: "COMPLETE" }, site());
    await updateProgress(unitId, "flooring", { state_code: "VERIFIED" }, qa());
    expect((await cell(unitId, "flooring")).state_code).toBe("VERIFIED");
  });
});

describe("rule 5 — two-step bulk update with gate dry-run and exceptions", () => {
  it("preview shows the gate deltas per unit; apply skips exceptions and stamps BULK_UPDATE", async () => {
    const a = await freshUnit();
    const b = await freshUnit();
    const preview = await previewBulkUpdate(PROJECT_ID, { scope: { unit_ids: [a, b] }, component_code: "mep_first_fix", new_state: "IN_PROGRESS" }, site());
    expect(preview.affected_count).toBe(2);
    const rowA = preview.units.find((u) => u.unit_id === a)!;
    // seeded change_gate_rule: electrical closes to CLOSING once mep_first_fix is in_progress
    expect(rowA.gate_deltas).toEqual(expect.arrayContaining([{ category_code: "electrical", from: "OPEN", to: "CLOSING" }]));

    const result = await applyBulkUpdate(preview.id, { exceptions: [{ unit_id: b, reason: "Unit B under dispute" }] }, site());
    expect(result.applied).toEqual([a]);
    expect(result.excluded.map((e) => e.unit_id)).toEqual([b]);
    expect((await cell(a, "mep_first_fix")).source).toBe("BULK_UPDATE");
    expect((await cell(b, "mep_first_fix")).state_code).toBe("NOT_STARTED");

    await expect(applyBulkUpdate(preview.id, {}, site())).rejects.toThrow(/APPLIED/);
    const evt = await db.query<{ payload: { applied_count: number } }>(`SELECT payload FROM event WHERE type = 'progress.bulk_applied' AND entity_id = $1`, [preview.id]);
    expect(evt.rows[0]!.payload.applied_count).toBe(1);
  });
});

describe("rule 6 — freshness derived at read; stale sweep raises one Site action per cell", () => {
  it("flags a gate-dependent stale cell VERIFICATION_REQUIRED and a non-gated one STALE, and doesn't stack duplicate actions", async () => {
    const unitId = await freshUnit();
    await updateProgress(unitId, "mep_first_fix", { state_code: "IN_PROGRESS" }, site());
    await updateProgress(unitId, "finishing", { state_code: "IN_PROGRESS" }, site()); // no change_gate_rule triggers on finishing
    const asOf = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString(); // past the 14-day default

    expect((await cell(unitId, "mep_first_fix", asOf)).freshness).toBe("VERIFICATION_REQUIRED");
    expect((await cell(unitId, "finishing", asOf)).freshness).toBe("STALE");

    await scanStaleProgress(asOf);
    await scanStaleProgress(asOf);
    const actions = await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM action WHERE source_module = 'progress' AND unit_id = $1`, [unitId]);
    expect(Number(actions.rows[0]!.count)).toBe(2);
    const stale = await db.query<{ payload: { component: string; freshness: string } }>(`SELECT payload FROM event WHERE unit_id = $1 AND type = 'progress.stale' ORDER BY payload->>'component'`, [unitId]);
    expect(stale.rows.map((r) => r.payload)).toEqual([
      { component: "finishing", freshness: "STALE", stale_after_days: 14 },
      { component: "mep_first_fix", freshness: "VERIFICATION_REQUIRED", stale_after_days: 14 },
    ]);
  });
});

describe("rule 8 — explicit pct only for the structure family", () => {
  it("rejects pct on an interior component and accepts it on structure", async () => {
    const unitId = await freshUnit();
    await expect(updateProgress(unitId, "flooring", { state_code: "IN_PROGRESS", pct: 40 }, site())).rejects.toThrow(/pct/);
    await updateProgress(unitId, "structure", { state_code: "IN_PROGRESS", pct: 40 }, site());
    expect((await cell(unitId, "structure")).pct).toBe(40);
  });
});

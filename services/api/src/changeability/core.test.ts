import { describe, it, expect, beforeAll } from "vitest";
import { initDb, db } from "../db";
import { superAdminCtx as fakeSuperAdminCtx, ctxWithRoles } from "../authz/test-helpers";
import { createProject, createUnit } from "../projects";
import { updateProgress } from "../progress/core";
import type { Ctx } from "../authz/types";
import {
  getUnitChangeability, evaluateUnit, evaluateDryRun, getProjectChangeability, scanClosingGates, listRules, putRules, publishRules, grantException, revokeException, useException,
} from "./core";

// 08-changeability-engine.md — integration (real PGlite, real seeded rules, real 07 progress writes).
// Rule 7 (capture never blocked) is 18's behaviour — nothing here blocks a change request; the one
// hook 18 needs, `useException`, is exercised under rule 5.
const superAdminCtx: Ctx = { actor: { ...fakeSuperAdminCtx.actor, user_id: "user_superadmin" } };
function ctxAs(userId: string, roles: string[]): Ctx {
  return { actor: { ...ctxWithRoles(roles).actor, user_id: userId } };
}
const site = () => ctxAs("user_site", ["SITE"]);
const management = () => ctxAs("user_management", ["MANAGEMENT"]);
const sales = () => ctxAs("user_sales", ["SALES"]);

let PROJECT_ID: string;
let unitSeq = 0;

beforeAll(async () => {
  await initDb();
  const p = await createProject({ code: "gatetest", name: "Gate Test Project" }, superAdminCtx);
  PROJECT_ID = p.id;
});

async function freshUnit(): Promise<string> {
  unitSeq += 1;
  const u = await createUnit(PROJECT_ID, { unit_number: `G-${unitSeq}`, unit_type: "3BHK", facing: "East" }, superAdminCtx);
  return u!.id;
}

const stored = async (unitId: string, category: string) =>
  (await db.query<{ current_state: string; reason_code: string | null; source_event_id: string | null; freshness_status: string; exception_open: boolean; expected_close_at: unknown }>(
    `SELECT current_state, reason_code, source_event_id::text AS source_event_id, freshness_status, exception_open, expected_close_at::text AS expected_close_at FROM unit_change_gate WHERE unit_id = $1 AND category_code = $2`,
    [unitId, category]
  )).rows[0];

describe("rules 1 + 3 — derived from progress, re-evaluated on progress.updated, every transition logged", () => {
  it("a 07 progress write flips structural OPEN → HARD_CLOSED through the subscriber, with the source event and a log row", async () => {
    const unitId = await freshUnit();
    const m = await getUnitChangeability(unitId, sales()); // rule 8: Sales reads
    expect(m.gates.map((g) => g.state)).toEqual(["OPEN", "OPEN", "OPEN", "OPEN"]);
    expect(m.flexibility.value).toBe(100);

    await updateProgress(unitId, "structure", { state_code: "COMPLETE" }, site());
    const s = await stored(unitId, "structural");
    expect(s).toMatchObject({ current_state: "HARD_CLOSED", reason_code: "structural:structure>=complete" });
    expect(s!.source_event_id).toBeTruthy();
    const log = await db.query<{ from_state: string | null; to_state: string; trigger: string; dry_run: boolean }>(
      `SELECT from_state, to_state, trigger, dry_run FROM gate_evaluation_log WHERE unit_id = $1 AND category_code = 'structural' ORDER BY id`, [unitId]
    );
    expect(log.rows).toEqual([
      { from_state: null, to_state: "OPEN", trigger: "read", dry_run: false },
      { from_state: "OPEN", to_state: "HARD_CLOSED", trigger: "progress.updated", dry_run: false },
    ]);
    const evt = await db.query<{ payload: Record<string, unknown> }>(`SELECT payload FROM event WHERE type = 'gate.state_changed' AND unit_id = $1 ORDER BY id DESC LIMIT 1`, [unitId]);
    expect(evt.rows[0]!.payload).toMatchObject({ category_code: "structural", from: "OPEN", to: "HARD_CLOSED", trigger: "progress.updated" });
    const failures = await db.query(`SELECT id FROM event_delivery_failure WHERE subscriber = 'changeability.reevaluate'`);
    expect(failures.rows).toHaveLength(0);
  });
});

describe("rule 2 — CLOSING with expected close date from 07's forecast", () => {
  it("shows 'closes ~date' while the trigger is still not_started but forecast inside the lead window", async () => {
    const unitId = await freshUnit();
    await db.query(`UPDATE unit_progress SET planned_next_event = 'MEP first-fix start', planned_next_event_date = '2026-09-15' WHERE unit_id = $1 AND component_code = 'mep_first_fix'`, [unitId]);
    const m = await evaluateUnit(unitId, { trigger: "nightly", asOf: "2026-09-06" });
    expect(m.gates.find((g) => g.category_code === "electrical")).toMatchObject({ state: "CLOSING", expected_close_at: "2026-09-15" });
    expect(String((await stored(unitId, "electrical"))!.expected_close_at)).toContain("2026-09-15");
    const later = await evaluateUnit(unitId, { trigger: "nightly", asOf: "2026-08-01" });
    expect(later.gates.find((g) => g.category_code === "electrical")!.state).toBe("OPEN");
    const scan = await scanClosingGates("2026-09-06", PROJECT_ID);
    expect(scan.evaluated).toBeGreaterThanOrEqual(2);
    expect(scan.changed).toContain(unitId);
  });
});

describe("rule 4 — stale trigger → VERIFICATION_REQUIRED", () => {
  it("an in_progress reading older than the component's threshold taints the gate and drops confidence", async () => {
    const unitId = await freshUnit();
    await updateProgress(unitId, "mep_first_fix", { state_code: "IN_PROGRESS" }, site());
    await db.query(`UPDATE unit_progress SET updated_at = now() - interval '40 days' WHERE unit_id = $1 AND component_code = 'mep_first_fix'`, [unitId]);
    const m = await getUnitChangeability(unitId, site());
    expect(m.gates.find((g) => g.category_code === "electrical")).toMatchObject({ state: "CLOSING", freshness_status: "VERIFICATION_REQUIRED" });
    expect(m.flexibility.confidence).toBe("LOW");
    expect((await stored(unitId, "electrical"))!.freshness_status).toBe("VERIFICATION_REQUIRED");
  });
});

describe("rule 5 — HARD_CLOSED never reopens; EXCEPTION_ONLY needs authority + reason + evidence + validity", () => {
  it("grant/revoke/expire/use lifecycle with the rule's exception_authority_role", async () => {
    const unitId = await freshUnit();
    await updateProgress(unitId, "structure", { state_code: "COMPLETE" }, site());
    await updateProgress(unitId, "mep_first_fix", { state_code: "COMPLETE" }, site());
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const base = { reason: "customer paid for the extra points before first fix closed", evidence_file_keys: ["k/approval.pdf"], valid_until: future };

    await expect(grantException(unitId, { category_code: "structural", ...base }, superAdminCtx)).rejects.toThrow(/HARD_CLOSED — it cannot be reopened/);
    await expect(grantException(unitId, { category_code: "electrical", ...base }, site())).rejects.toThrow(/requires the MANAGEMENT role/);
    await expect(grantException(unitId, { category_code: "electrical", ...base, evidence_file_keys: [] }, management())).rejects.toThrow(/evidence/);
    await expect(grantException(unitId, { category_code: "electrical", ...base, reason: " " }, management())).rejects.toThrow(/reason/);
    await expect(grantException(unitId, { category_code: "electrical", ...base, valid_until: "2020-01-01" }, management())).rejects.toThrow(/future/);
    await expect(grantException(unitId, { category_code: "flooring_selection", ...base }, management())).rejects.toThrow(/is OPEN/);

    const ex = await grantException(unitId, { category_code: "electrical", ...base }, management());
    expect(ex).toMatchObject({ status: "ACTIVE", authority_role: "MANAGEMENT", granted_by: "user_management" });
    expect((await stored(unitId, "electrical"))!.exception_open).toBe(true);
    const granted = await db.query<{ payload: Record<string, unknown> }>(`SELECT payload FROM event WHERE type = 'gate.exception_granted' AND entity_id = $1`, [ex.id]);
    expect(granted.rows[0]!.payload).toMatchObject({ category_code: "electrical", authority_role: "MANAGEMENT" });
    await expect(grantException(unitId, { category_code: "electrical", ...base }, management())).rejects.toThrow(/already has an active exception/);

    await expect(revokeException(ex.id, "no longer needed", site())).rejects.toThrow(/requires the MANAGEMENT role/);
    const revoked = await revokeException(ex.id, "no longer needed", management());
    expect(revoked.status).toBe("REVOKED");
    expect((await stored(unitId, "electrical"))!.exception_open).toBe(false);
    expect((await db.query(`SELECT id FROM event WHERE type = 'gate.exception_revoked' AND entity_id = $1`, [ex.id])).rows).toHaveLength(1);

    // Expiry is derived on the next evaluation.
    const ex2 = await grantException(unitId, { category_code: "electrical", ...base }, management());
    await db.query(`UPDATE unit_gate_exception SET valid_until = now() - interval '1 day' WHERE id = $1`, [ex2.id]);
    const after = await getUnitChangeability(unitId, site());
    expect(after.gates.find((g) => g.category_code === "electrical")!.exception_open).toBe(false);
    expect((await db.query<{ status: string }>(`SELECT status FROM unit_gate_exception WHERE id = $1`, [ex2.id])).rows[0]!.status).toBe("EXPIRED");
    expect((await db.query(`SELECT id FROM event WHERE type = 'gate.exception_expired' AND entity_id = $1`, [ex2.id])).rows).toHaveLength(1);

    // 18 consumes an exception on release (p44 §33.6 t8).
    const ex3 = await grantException(unitId, { category_code: "electrical", ...base }, management());
    const used = await useException(ex3.id, "cr_test", db);
    expect(used).toMatchObject({ status: "USED", change_request_id: "cr_test" });
  });
});

describe("rule 8 — Sales/CRM/Customisation read only", () => {
  it("reads succeed, every write is forbidden", async () => {
    const unitId = await freshUnit();
    for (const c of [sales(), ctxAs("user_crm", ["CRM"]), ctxAs("user_customisation", ["CUSTOMISATION"])]) {
      expect((await getUnitChangeability(unitId, c)).gates).toHaveLength(4);
      expect(await listRules({ project_id: null, status: "PUBLISHED" }, c)).toHaveLength(7);
      await expect(putRules({ project_id: null }, [{ category_code: "structural", trigger_component_code: "structure", min_state: "verified", resulting_state: "HARD_CLOSED" }], c)).rejects.toThrow(/requires one of/);
      await expect(publishRules({ project_id: null }, "x", c)).rejects.toThrow(/requires one of/);
      await expect(grantException(unitId, { category_code: "electrical", reason: "r", evidence_file_keys: ["k"], valid_until: "2030-01-01" }, c)).rejects.toThrow();
    }
    const heat = await getProjectChangeability(PROJECT_ID, { state: "HARD_CLOSED" }, sales());
    expect(heat.length).toBeGreaterThanOrEqual(2);
    expect(heat.every((r) => r.gates.every((g) => g.state === "HARD_CLOSED"))).toBe(true);
  });
});

describe("rule 10 — dry run", () => {
  it("evaluates hypothetical progress without touching the stored gates, logging dry_run = true", async () => {
    const unitId = await freshUnit();
    await getUnitChangeability(unitId, site());
    const dry = await evaluateDryRun(unitId, { mep_first_fix: "COMPLETE" }, sales());
    expect(dry.gates.find((g) => g.category_code === "electrical")!.state).toBe("EXCEPTION_ONLY");
    expect(dry.flexibility.value).toBe(33);
    expect((await stored(unitId, "electrical"))!.current_state).toBe("OPEN");
    const log = await db.query<{ dry_run: boolean; to_state: string }>(`SELECT dry_run, to_state FROM gate_evaluation_log WHERE unit_id = $1 AND category_code = 'electrical' AND trigger = 'dry_run'`, [unitId]);
    expect(log.rows).toEqual([{ dry_run: true, to_state: "EXCEPTION_ONLY" }]);
  });
});

describe("rule 6 + rule 3 (policy.changed) — versioned publish with reason re-evaluates every unit", () => {
  it("DRAFT → PUBLISHED v2 retires v1, needs a reason, and a loosened structural rule reopens the gate with a logged transition", async () => {
    const unitId = await freshUnit();
    await updateProgress(unitId, "structure", { state_code: "COMPLETE" }, site());
    expect((await stored(unitId, "structural"))!.current_state).toBe("HARD_CLOSED");

    const current = await listRules({ project_id: null, status: "PUBLISHED" }, management());
    const loosened = current.map((r) => ({
      category_code: r.category_code, trigger_component_code: r.trigger_component_code, resulting_state: r.resulting_state,
      min_state: r.category_code === "structural" ? "verified" : r.min_state, hard_or_soft: r.hard_or_soft, closing_lead_days: r.closing_lead_days,
      exception_authority_role: r.exception_authority_role, priority: r.priority,
    }));
    const drafts = await putRules({ project_id: null }, loosened, management());
    expect(drafts.every((d) => d.status === "DRAFT" && d.version === 2)).toBe(true);
    expect((await stored(unitId, "structural"))!.current_state).toBe("HARD_CLOSED"); // drafts are not live

    await expect(publishRules({ project_id: null }, "", management())).rejects.toThrow(/reason is required/);
    const pub = await publishRules({ project_id: null }, "structural changes stay possible until QA verifies the slab", management());
    expect(pub.version).toBe(2);
    expect(pub.rules).toHaveLength(7);
    expect(pub.reevaluated).toBeGreaterThanOrEqual(unitSeq);
    expect(pub.transitions).toBeGreaterThanOrEqual(1);
    expect((await listRules({ project_id: null, status: "RETIRED" }, management())).length).toBe(7);
    expect((await stored(unitId, "structural"))!.current_state).toBe("OPEN");
    const log = await db.query<{ from_state: string; to_state: string; trigger: string }>(
      `SELECT from_state, to_state, trigger FROM gate_evaluation_log WHERE unit_id = $1 AND category_code = 'structural' AND trigger = 'policy.changed'`, [unitId]
    );
    expect(log.rows).toEqual([{ from_state: "HARD_CLOSED", to_state: "OPEN", trigger: "policy.changed" }]);
    const evt = await db.query<{ payload: Record<string, unknown> }>(`SELECT payload FROM event WHERE type = 'gate.rules_published' ORDER BY id DESC LIMIT 1`);
    expect(evt.rows[0]!.payload).toMatchObject({ version: 2, reason: "structural changes stay possible until QA verifies the slab", rule_count: 7 });

    await updateProgress(unitId, "structure", { state_code: "VERIFIED" }, ctxAs("user_qa", ["QA"]));
    expect((await stored(unitId, "structural"))!.current_state).toBe("HARD_CLOSED");
  });
});

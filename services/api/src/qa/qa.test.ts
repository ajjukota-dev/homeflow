import { describe, it, expect, beforeAll } from "vitest";
import { initDb, db } from "../db";
import { superAdminCtx as fakeSuperAdminCtx, ctxWithRoles, customerCtx } from "../authz/test-helpers";
import { createProject, createUnit } from "../projects";
import type { Ctx } from "../authz/types";
import { evaluateHandover } from "../handover";
import { snagCounts } from "../qa-snags";
import { scanEscalations } from "../escalations/core";
import { startInspection, setInspectionItems, addInspectionEvidence, verifyInspectionEvidence, completeInspection, listQaExceptions } from "./inspections";
import { createDependency, patchDependency, dependencyBlockersForUnit } from "./dependencies";
import {
  createSnag, assignSnag, startSnag, readySnag, verifySnag, customerVerifySnag, closeSnagLifecycle, reopenSnag, patchSnag, snagAnalytics, createContractor,
} from "./snags";

// 15-qa-evidence-snags.md — one test per rule. Real seeded demo users (seed/users.ts): user_site
// is SITE, user_qa is QA, user_fm is FM (the handover department); a second QA-capable actor is
// the super admin (requireRole QA|SUPER_ADMIN) for the "≠ uploader / ≠ fixer" guards.
const superAdminCtx: Ctx = { actor: { ...fakeSuperAdminCtx.actor, user_id: "user_superadmin" } };
function ctxAs(userId: string, roles: string[]): Ctx {
  return { actor: { ...ctxWithRoles(roles).actor, user_id: userId } };
}
const site = () => ctxAs("user_site", ["SITE"]);
const qa = () => ctxAs("user_qa", ["QA"]);
const fm = () => ctxAs("user_fm", ["FM"]);
const sales = () => ctxAs("user_sales", ["SALES"]);

let PROJECT_ID: string;
let unitSeq = 0;
const DAY = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  await initDb();
  const p = await createProject({ code: "qatest", name: "QA Test Project" }, superAdminCtx);
  PROJECT_ID = p.id;
});

async function freshUnit(): Promise<string> {
  unitSeq += 1;
  const u = await createUnit(PROJECT_ID, { unit_number: `Q-${unitSeq}`, unit_type: "3BHK", facing: "East" }, superAdminCtx);
  return u!.id;
}

const progressOf = async (unitId: string, component: string) =>
  (await db.query<{ state_code: string; source: string }>(`SELECT state_code, source FROM unit_progress WHERE unit_id = $1 AND component_code = $2`, [unitId, component])).rows[0]!;

const lastEvent = async (type: string, unitId: string) =>
  (await db.query<{ payload: Record<string, unknown> }>(`SELECT payload FROM event WHERE type = $1 AND unit_id = $2 ORDER BY id DESC LIMIT 1`, [type, unitId])).rows[0];

/** Runs one inspection end to end with a photo per item. */
async function runInspection(unitId: string, component: string, kind: "SITE_DECLARATION" | "QA_VERIFICATION" | "RE_INSPECTION", result: "PASS" | "FAIL", ctx: Ctx) {
  const insp = await startInspection(unitId, { component_code: component, kind }, ctx);
  const items = insp.template!.items.map((i) => ({ code: i.code, result, note: result === "FAIL" ? "hairline crack" : null }));
  await setInspectionItems(insp.id, items, ctx);
  for (const i of insp.template!.items) await addInspectionEvidence(insp.id, { item_code: i.code, kind: "PHOTO", content_type: "image/jpeg" }, ctx);
  return completeInspection(insp.id, ctx);
}

let exceptionUnit: string;

describe("rule 1 — site declaration vs independent QA verification", () => {
  it("SITE_DECLARATION pass → COMPLETE/SITE_ENTRY; QA fail → REWORK + snag per failed item + re-inspection action; re-inspection pass → VERIFIED", async () => {
    const unitId = await freshUnit();
    exceptionUnit = unitId;
    await expect(startInspection(unitId, { component_code: "flooring", kind: "QA_VERIFICATION" }, site())).rejects.toThrow(/requires one of/);
    await expect(startInspection(unitId, { component_code: "flooring", kind: "SITE_DECLARATION" }, sales())).rejects.toThrow(/WRITE/);

    const declared = await runInspection(unitId, "flooring", "SITE_DECLARATION", "PASS", site());
    expect(declared.status).toBe("PASSED");
    expect(await progressOf(unitId, "flooring")).toEqual({ state_code: "complete", source: "SITE_ENTRY" });

    const failed = await runInspection(unitId, "flooring", "QA_VERIFICATION", "FAIL", qa());
    expect(failed.status).toBe("FAILED");
    expect(failed.failure_reason).toMatch(/flooring/);
    expect(failed.action_id).toBeTruthy();
    expect(await progressOf(unitId, "flooring")).toEqual({ state_code: "rework", source: "QA_VERIFICATION" });
    const snags = await db.query<{ severity: string; status: string; category: string; inspection_id: string; raised_by_kind: string }>(
      `SELECT severity, status, category, inspection_id, raised_by_kind FROM snag WHERE unit_id = $1`, [unitId]
    );
    expect(snags.rows).toEqual([{ severity: "major", status: "open", category: "FLOORING", inspection_id: failed.id, raised_by_kind: "QA" }]);
    const action = await db.query<{ owner_role: string; title: string }>(`SELECT owner_role, title FROM action WHERE id = $1`, [failed.action_id]);
    expect(action.rows[0]).toMatchObject({ owner_role: "SITE", title: expect.stringMatching(/Re-inspect flooring/) });
    expect((await lastEvent("qa.inspection_failed", unitId))?.payload).toMatchObject({ kind: "QA_VERIFICATION", attempt_no: 1, failed_items: ["flooring"] });
    const legacy = await db.query<{ qa_verified: boolean }>(`SELECT qa_verified FROM qa_evidence WHERE unit_id = $1 AND component_code = 'flooring'`, [unitId]);
    expect(legacy.rows[0]!.qa_verified).toBe(false);

    const passed = await runInspection(unitId, "flooring", "RE_INSPECTION", "PASS", qa());
    expect(passed.status).toBe("PASSED");
    expect(passed.attempt_no).toBe(2);
    expect(await progressOf(unitId, "flooring")).toEqual({ state_code: "verified", source: "QA_VERIFICATION" });
    expect((await lastEvent("qa.inspection_passed", unitId))?.payload).toMatchObject({ kind: "RE_INSPECTION", attempt_no: 2 });
    const legacyAfter = await db.query<{ qa_verified: boolean }>(`SELECT qa_verified FROM qa_evidence WHERE unit_id = $1 AND component_code = 'flooring'`, [unitId]);
    expect(legacyAfter.rows[0]!.qa_verified).toBe(true);
  });
});

describe("rule 2 — evidence", () => {
  it("a required item cannot PASS without its configured evidence; verifier ≠ uploader; superseding keeps the old row", async () => {
    const unitId = await freshUnit();
    const insp = await startInspection(unitId, { component_code: "flooring", kind: "SITE_DECLARATION" }, site());
    await setInspectionItems(insp.id, [{ code: "flooring", result: "PASS" }], site());
    await expect(completeInspection(insp.id, site())).rejects.toMatchObject({
      blockers: ["item flooring passed without PHOTO evidence", "0 photo(s) captured, 1 required"],
    });

    const first = await addInspectionEvidence(insp.id, { item_code: "flooring", kind: "PHOTO", content_type: "image/jpeg" }, site());
    expect(first.upload.method).toBe("PUT");
    expect(first.file_key).toMatch(new RegExp(`^project/${PROJECT_ID}/qa_inspection/${insp.id}/`));
    await expect(verifyInspectionEvidence(first.evidence_id, "VERIFIED", undefined, site())).rejects.toThrow(/requires one of/);
    await expect(verifyInspectionEvidence(first.evidence_id, "VERIFIED", undefined, ctxAs("user_site", ["QA"]))).rejects.toThrow(/other than its uploader/);
    await verifyInspectionEvidence(first.evidence_id, "VERIFIED", "clear photo", qa());
    expect((await lastEvent("qa.evidence_verified", unitId))?.payload).toMatchObject({ evidence_id: first.evidence_id, item_code: "flooring" });

    const second = await addInspectionEvidence(insp.id, { item_code: "flooring", kind: "PHOTO", content_type: "image/png", supersedes: first.evidence_id }, site());
    const rows = await db.query<{ id: string; superseded_by: string | null; verification_status: string }>(
      `SELECT id, superseded_by, verification_status FROM qa_inspection_evidence WHERE inspection_id = $1 ORDER BY captured_at`, [insp.id]
    );
    expect(rows.rows).toEqual([
      { id: first.evidence_id, superseded_by: second.evidence_id, verification_status: "VERIFIED" },
      { id: second.evidence_id, superseded_by: null, verification_status: "UPLOADED" },
    ]);
    expect((await completeInspection(insp.id, site())).status).toBe("PASSED");
  });
});

describe("rule 3 — exception queue", () => {
  it("lists the component whose QA run reached attempt 2, with the (component, contractor, root cause) pattern", async () => {
    await patchSnag((await db.query<{ id: string }>(`SELECT id FROM snag WHERE unit_id = $1`, [exceptionUnit])).rows[0]!.id, { root_cause: "WORKMANSHIP" }, qa());
    const rows = await listQaExceptions(PROJECT_ID, qa());
    const row = rows.find((r) => r.unit_id === exceptionUnit && r.component_code === "flooring");
    expect(row).toMatchObject({ kind: "RE_INSPECTION", attempt_no: 2, failures_on_component: 1, pattern: { component: "flooring", contractors: [], root_causes: ["WORKMANSHIP"] } });
  });
});

describe("rule 4 — external dependencies", () => {
  it("a PENDING dependency on an ancestor node blocks every unit under it on the FM gate until DONE", async () => {
    const unitId = await freshUnit();
    const node = (await db.query<{ hierarchy_node_id: string }>(`SELECT hierarchy_node_id FROM unit WHERE id = $1`, [unitId])).rows[0]!.hierarchy_node_id;
    await expect(createDependency(PROJECT_ID, { hierarchy_node_id: node, kind: "LIFT", label: "Lift commissioning" }, sales())).rejects.toThrow(/WRITE/);
    const dep = await createDependency(PROJECT_ID, { hierarchy_node_id: node, kind: "LIFT", label: "Lift commissioning", expected_date: "2026-10-01" }, site());
    expect(dep.status).toBe("PENDING");
    const blockers = await dependencyBlockersForUnit(unitId);
    expect(blockers).toEqual(["Common area: Lift commissioning expected 2026-10-01"]);
    const fmGate = evaluateHandover({ ...READY, dependency_blockers: blockers }).gates.find((g) => g.type === "fm")!;
    expect(fmGate).toMatchObject({ classification: "soft", state: "open", blockers });

    await patchDependency(dep.id, { status: "DONE" }, fm());
    expect(await dependencyBlockersForUnit(unitId)).toEqual([]);
    const evt = await db.query<{ payload: Record<string, unknown> }>(`SELECT payload FROM event WHERE type = 'dependency.status_changed' AND entity_id = $1`, [dep.id]);
    expect(evt.rows[0]!.payload).toMatchObject({ from: "PENDING", to: "DONE", kind: "LIFT" });
  });
});

const READY = {
  readiness_value: 90, readiness_threshold: 80, utilities_ready: true, critical_snags: 0, minor_snags: 0, minor_snag_max: 2,
  qa_approved: true, financial_cleared: true, legal_executed: true, registered: true, open_commitments: [],
};

let analyticsSeeded = false;

describe("rule 5 — snag lifecycle (Appendix A statuses)", () => {
  it("OPEN → ASSIGNED → IN_PROGRESS → READY (after-photo) → VERIFIED (≠ fixer) → CLOSED → REOPENED; customer-raised needs customer verification; repeat flag", async () => {
    const unitId = await freshUnit();
    const contractor = await createContractor({ name: "Sri Balaji Tiles", trade: "flooring" }, qa());
    await expect(createSnag({ unit_id: unitId, room: "KITCHEN", category: "FLOORING", severity: "MAJOR", description: "Chipped tile" }, sales())).rejects.toThrow(/WRITE/);

    const snag = await createSnag({ unit_id: unitId, room: "KITCHEN", category: "FLOORING", severity: "MAJOR", description: "Chipped tile near sink" }, qa());
    expect(snag).toMatchObject({ status: "OPEN", severity: "MAJOR", raised_by_kind: "QA", is_repeat: false, reopen_count: 0 });
    expect(snag.code).toMatch(/^SNG-/);
    expect(snag.sla_clock_id).toBeTruthy();
    expect(snag.action_id).toBeTruthy();
    expect((await lastEvent("snag.opened", unitId))?.payload).toMatchObject({ code: snag.code, severity: "MAJOR", room: "KITCHEN" });

    await expect(startSnag(snag.id, site())).rejects.toThrow(/cannot move snag .* from OPEN to IN_PROGRESS/);
    const assigned = await assignSnag(snag.id, { contractor_id: contractor.id, assigned_to_user_id: "user_site" }, qa());
    expect(assigned).toMatchObject({ status: "ASSIGNED", contractor_id: contractor.id, assigned_to_user_id: "user_site" });
    expect((await lastEvent("snag.assigned", unitId))?.payload).toMatchObject({ contractor_id: contractor.id });
    expect((await startSnag(snag.id, site())).status).toBe("IN_PROGRESS");
    await expect(readySnag(snag.id, {}, site())).rejects.toThrow(/after-photo/);
    const ready = await readySnag(snag.id, { after_file_keys: [`project/${PROJECT_ID}/snag/${snag.id}/after.jpg`] }, site());
    expect(ready).toMatchObject({ status: "READY_FOR_VERIFICATION", ready_by_user_id: "user_site" });
    expect((await lastEvent("snag.ready_for_verification", unitId))?.payload).toMatchObject({ after_photos: 1 });

    await expect(verifySnag(snag.id, ctxAs("user_site", ["QA"]))).rejects.toThrow(/fixer cannot verify/);
    await expect(verifySnag(snag.id, ctxAs("user_crm", ["CRM"]))).rejects.toThrow(/WRITE/);
    expect((await verifySnag(snag.id, qa())).status).toBe("VERIFIED");
    expect((await lastEvent("snag.verified", unitId))?.payload).toMatchObject({ code: snag.code, from: "READY_FOR_VERIFICATION", to: "VERIFIED" });
    const closed = await closeSnagLifecycle(snag.id, qa());
    expect(closed.status).toBe("CLOSED");
    expect(closed.closed_at).toBeTruthy();
    const clock = await db.query<{ stopped_at: string | null }>(`SELECT stopped_at FROM sla_clock WHERE id = $1`, [snag.sla_clock_id]);
    expect(clock.rows[0]!.stopped_at).toBeTruthy();
    expect((await db.query<{ status: string }>(`SELECT status FROM action WHERE id = $1`, [snag.action_id])).rows[0]!.status).toBe("Closed");

    await expect(reopenSnag(snag.id, "", qa())).rejects.toThrow(/reason/);
    await expect(reopenSnag(snag.id, "crack reappeared", ctxAs("user_management", ["MANAGEMENT"]))).rejects.toThrow(/WRITE/);
    const reopened = await reopenSnag(snag.id, "crack reappeared", fm());
    expect(reopened).toMatchObject({ status: "REOPENED", reopen_count: 1, reopen_reason: "crack reappeared", closed_at: null, after_file_keys: [] });
    expect((await lastEvent("snag.reopened", unitId))?.payload).toMatchObject({ from: "CLOSED", reopen_count: 1 });
    expect((await assignSnag(snag.id, { assigned_to_user_id: "user_site" }, qa())).status).toBe("ASSIGNED");

    // Same unit + room + category within 90 days → repeat.
    const again = await createSnag({ unit_id: unitId, room: "KITCHEN", category: "FLOORING", severity: "MINOR", description: "Grout gap" }, site());
    expect(again.is_repeat).toBe(true);
    expect(again.raised_by_kind).toBe("SITE");

    // Customer-raised: CLOSED needs customer_verified_at first.
    const cust = await createSnag({ unit_id: unitId, room: "LIVING", category: "PAINTING", severity: "MINOR", description: "Paint drip on skirting", raised_by_kind: "CUSTOMER" }, fm());
    await assignSnag(cust.id, { assigned_to_user_id: "user_site" }, fm());
    await startSnag(cust.id, site());
    await readySnag(cust.id, { after_file_keys: ["k/after.jpg"] }, site());
    await verifySnag(cust.id, fm());
    await expect(closeSnagLifecycle(cust.id, fm())).rejects.toThrow(/customer verification/);
    await expect(customerVerifySnag(cust.id, sales())).rejects.toThrow(/WRITE/);
    expect((await customerVerifySnag(cust.id, customerCtx())).customer_verified_at).toBeTruthy();
    expect((await closeSnagLifecycle(cust.id, fm())).status).toBe("CLOSED");
    await expect(reopenSnag(snag.id, "not mine", customerCtx())).rejects.toThrow(/only snags they raised/);
    expect((await reopenSnag(cust.id, "still visible", customerCtx())).status).toBe("REOPENED");
    analyticsSeeded = true;
  });
});

describe("rule 6 — SLA clock by severity", () => {
  it("a CRITICAL snag's clock is due 2 calendar days after OPEN and escalates through 12's scan once overdue", async () => {
    const unitId = await freshUnit();
    const snag = await createSnag({ unit_id: unitId, room: "UTILITY", category: "ELECTRICAL", severity: "CRITICAL", description: "Exposed live wire" }, qa());
    await assignSnag(snag.id, { assigned_to_user_id: "user_site" }, qa());
    const clock = await db.query<{ started_at: string; due_at: string; policy_id: string }>(
      `SELECT started_at::text AS started_at, due_at::text AS due_at, policy_id FROM sla_clock WHERE id = $1`, [snag.sla_clock_id]
    );
    expect(clock.rows[0]!.policy_id).toBe("snag_critical");
    expect(new Date(clock.rows[0]!.due_at).getTime() - new Date(clock.rows[0]!.started_at).getTime()).toBe(2 * DAY);

    const before = await scanEscalations(new Date(new Date(clock.rows[0]!.started_at).getTime() + 12 * 60 * 60 * 1000).toISOString());
    expect(before.raised).toHaveLength(0);
    const overdue = await scanEscalations(new Date(new Date(clock.rows[0]!.due_at).getTime() + DAY).toISOString());
    expect(overdue.raised.length).toBeGreaterThan(0);
    const esc = await db.query<{ tier: string; owner_user_id: string | null; status: string }>(`SELECT tier, owner_user_id, status FROM escalation WHERE action_id = $1`, [snag.action_id]);
    expect(esc.rows).toHaveLength(1);
    expect(esc.rows[0]).toMatchObject({ owner_user_id: "user_site", status: "OPEN" });
  });
});

describe("rule 7 — handover gate inputs", () => {
  it("open CRITICAL is a hard blocker, MAJOR above policy is a soft blocker, counts come from the real snag table", async () => {
    const unitId = await freshUnit();
    await createSnag({ unit_id: unitId, room: "BATHROOM_1", category: "PLUMBING", severity: "MAJOR", description: "Leaking trap" }, qa());
    await createSnag({ unit_id: unitId, room: "BATHROOM_2", category: "PLUMBING", severity: "MAJOR", description: "Loose tap" }, qa());
    await createSnag({ unit_id: unitId, room: "BALCONY", category: "CIVIL", severity: "MINOR", description: "Hairline plaster crack" }, qa());
    expect(await snagCounts(unitId)).toEqual({ critical: 0, major: 2, minor: 1 });

    const soft = evaluateHandover({ ...READY, major_snags: 2, major_snag_max: 0 });
    expect(soft.eligible).toBe(true);
    expect(soft.gates.find((g) => g.type === "snags")).toMatchObject({ classification: "soft", state: "open", blockers: ["2 major snag(s) open, policy allows 0"] });
    expect(evaluateHandover({ ...READY, major_snags: 2, major_snag_max: 3 }).gates.find((g) => g.type === "snags")!.state).toBe("passed");
    const hard = evaluateHandover({ ...READY, critical_snags: 1 });
    expect(hard.eligible).toBe(false);
    expect(hard.blockers.map((b) => b.gate)).toEqual(expect.arrayContaining(["physical", "quality"]));
  });
});

describe("rule 8 — analytics", () => {
  it("groups by contractor/category/root cause with repeat rate, closure %, mean days to close by severity and cost", async () => {
    expect(analyticsSeeded).toBe(true);
    // Rule 5 reopened both of its closed snags; close one for real so closure % and MTTC are non-empty.
    const unitId = await freshUnit();
    const s = await createSnag({ unit_id: unitId, room: "KITCHEN", category: "FITTINGS", severity: "MAJOR", description: "Cabinet hinge loose", estimated_cost_inr: 1500 }, qa());
    await assignSnag(s.id, { assigned_to_user_id: "user_site" }, qa());
    await startSnag(s.id, site());
    await readySnag(s.id, { after_file_keys: ["k/hinge-after.jpg"] }, site());
    await verifySnag(s.id, qa());
    await closeSnagLifecycle(s.id, qa());
    await patchSnag(s.id, { actual_cost_inr: 1200, root_cause: "MATERIAL" }, qa());

    await expect(snagAnalytics(PROJECT_ID, customerCtx())).rejects.toThrow();
    const a = await snagAnalytics(PROJECT_ID, ctxAs("user_management", ["MANAGEMENT"]));
    expect(a.total).toBeGreaterThanOrEqual(8);
    expect(a.repeat_rate_pct).toBeGreaterThan(0);
    expect(a.closure_pct).toBeGreaterThan(0);
    expect(a.by_category.find((c) => c.category === "FLOORING")!.total).toBeGreaterThanOrEqual(3);
    expect(a.by_root_cause.find((c) => c.root_cause === "WORKMANSHIP")!.total).toBe(1);
    expect(a.by_contractor.find((c) => c.contractor_name === "Sri Balaji Tiles")!.total).toBe(1);
    expect(a.by_root_cause.find((c) => c.root_cause === "MATERIAL")!.total).toBe(1);
    expect(a.mean_days_to_close_by_severity).toEqual([{ severity: "MAJOR", mean_days: 0 }]);
    expect(a.cost_inr).toEqual({ estimated: 1500, actual: 1200 });
  });
});

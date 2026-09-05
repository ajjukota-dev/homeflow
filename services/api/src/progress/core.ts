import { randomUUID } from "node:crypto";
import { db } from "../db";
import { appendEvent, withTx, actorFields, type DbLike } from "../events";
import { authorize } from "../authz/authorize";
import { requireRole, STAFF_ROLES } from "../authz/requireRole";
import { AppError, type Ctx } from "../authz/types";
import { progressAtLeast, type ProgressState } from "../gates";
import { createAction } from "../actions/core";
import { raiseDemandsForUnit } from "../demands-schedule";
import { loadGateCategories, loadGateRules, loadProgressMap, gatesFromProgress, type DerivedGate } from "./gate-inputs";
import { deriveFreshness, type FreshnessStatus } from "./freshness";

// 07-unit-progress-control.md. Extends the real `unit_progress` table in place (0031_progress.sql
// header has the ALTER-not-create decision). handlers.ts's `setProgress` — the original write path
// with 5 test files and one route on it — is now a thin wrapper over `updateProgress` here, so
// every write goes through rules 1–4/7/8 regardless of entry point.
//
// Reconciliations, flagged not faked:
//  - Rule 1 says SITE/QA/MANAGEMENT/SUPER_ADMIN write; the seeded matrix (`unit_readiness`) grants
//    WRITE to SITE (+QA via the SITE column) and FM, and only READ to MANAGEMENT. Built to the
//    matrix (same discipline as 21/12/13): MANAGEMENT cannot write progress, FM can — flagged.
//  - Rule 3's "regression" = a downgrade FROM complete/verified (the spec's two literal examples).
//    Undoing a not-yet-declared state (in_progress → not_started) needs no reason.
//  - Rule 5's dry-run "calls 08's evaluator" — 08 isn't built, but the real gate engine already
//    exists (gates.ts::deriveGate over change_gate_rule), so the preview is a genuine dry run, not
//    a stub.
//  - Rule 6's "nightly job" — no scheduler exists (same gap as 06/19/21/12/13); `scanStaleProgress`
//    is directly callable with a controlled asOf, tested, not cron-wired.
//  - Rule 8's "CIVIL_STRUCTURE family" = the real seeded `structure` code (+ children via
//    parent_code). Spec's uppercase component list is a Policy Studio re-seed proposal, not applied.
//  - Reads are gated requireRole(STAFF_ROLES), matching getUnit/listUnits which already expose
//    progress to all staff — SALES has NONE on `unit_readiness`, so authorize(READ) would hide the
//    read-only console the spec's own Screens section says Sales/CRM get.

export type ProgressSource = "SITE_ENTRY" | "QA_VERIFICATION" | "BULK_UPDATE" | "IMPORT" | "SYSTEM";
export type SpecProgressState = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETE" | "VERIFIED" | "REWORK";

const DB_STATES: ProgressState[] = ["not_started", "in_progress", "complete", "verified", "rework"];

/** Accepts the spec's UPPERCASE names or the DB's lowercase ones; always returns the DB form. */
export function toDbProgressState(value: string): ProgressState {
  const lower = String(value ?? "").toLowerCase() as ProgressState;
  if (!DB_STATES.includes(lower)) throw new AppError("validation", `invalid state ${value}`, "state_code");
  return lower;
}
export function toSpecProgressState(value: ProgressState): SpecProgressState {
  return value.toUpperCase() as SpecProgressState;
}

const NEVER_WRITE = ["SALES", "CRM", "CUSTOMISATION"];

/** Rule 1: matrix WRITE at the authorize layer AND a handler-level guard (defence in depth). */
async function assertProgressWriter(ctx: Ctx): Promise<void> {
  await authorize(ctx, "unit_readiness", "WRITE");
  if (ctx.actor.roles.every((r) => NEVER_WRITE.includes(r))) {
    throw new AppError("forbidden", "Sales/CRM/Customisation may never mutate unit progress");
  }
}

/** Rule 4: VERIFIED is QA's call, COMPLETE is Site's declaration. */
function assertStateAuthority(state: ProgressState, ctx: Ctx): void {
  const roles = ctx.actor.roles;
  if (roles.includes("SUPER_ADMIN")) return;
  if (state === "verified" && !roles.includes("QA")) throw new AppError("forbidden", "VERIFIED may only be set by QA");
  if (state === "complete" && !roles.includes("SITE")) throw new AppError("forbidden", "COMPLETE may only be declared by SITE");
}

function isRegression(from: ProgressState, to: ProgressState): boolean {
  return (from === "complete" || from === "verified") && !progressAtLeast(to, from);
}

interface ComponentRow { code: string; parent_code: string | null; stale_after_days: number }

async function requireComponent(code: string, tx: DbLike): Promise<ComponentRow> {
  const r = await tx.query<ComponentRow>(`SELECT code, parent_code, stale_after_days FROM component_definition WHERE code = $1`, [code]);
  if (!r.rows[0]) throw new AppError("not_found", `unknown component ${code}`, "component_code");
  return r.rows[0];
}

/** Rule 8: only the structure family takes an explicit pct (slab count); interior pct is derived (15). */
function isStructureFamily(c: ComponentRow): boolean {
  return c.code === "structure" || c.parent_code === "structure";
}

export interface ProgressWriteInput {
  state_code: string;
  pct?: number | null;
  actual_date?: string | null;
  planned_next_event?: string | null;
  planned_next_event_date?: string | null;
  reason?: string | null;
}

/** The one write. Runs inside the caller's transaction — no withTx of its own, so bulk apply can
 *  loop it inside a single transaction (see 17's lesson on nested transactions in TODO §9). */
async function applyChange(
  tx: DbLike,
  unitId: string,
  componentCode: string,
  input: ProgressWriteInput,
  source: ProgressSource,
  ctx: Ctx
): Promise<{ from: ProgressState; to: ProgressState }> {
  const to = toDbProgressState(input.state_code);
  assertStateAuthority(to, ctx);
  const component = await requireComponent(componentCode, tx);
  if (input.pct !== undefined && input.pct !== null && !isStructureFamily(component)) {
    throw new AppError("validation", "pct is derived from checklist/evidence for interior components; explicit pct is only accepted for the structure family", "pct");
  }
  const before = await tx.query<{ state_code: ProgressState; project_id: string }>(
    `SELECT p.state_code, u.project_id FROM unit_progress p JOIN unit u ON u.id = p.unit_id WHERE p.unit_id = $1 AND p.component_code = $2`,
    [unitId, componentCode]
  );
  if (!before.rows[0]) throw new AppError("not_found", "no progress row for this unit/component");
  const from = before.rows[0].state_code;
  const projectId = before.rows[0].project_id;

  const regression = isRegression(from, to);
  if (regression && !input.reason?.trim()) {
    throw new AppError("validation", `regressing ${toSpecProgressState(from)} → ${toSpecProgressState(to)} requires a reason`, "reason");
  }

  await tx.query(
    `UPDATE unit_progress
        SET state_code = $3, pct = COALESCE($4, pct), actual_date = COALESCE($5, actual_date),
            planned_next_event = COALESCE($6, planned_next_event), planned_next_event_date = COALESCE($7, planned_next_event_date),
            source = $8, updated_by = $9, updated_at = now()
      WHERE unit_id = $1 AND component_code = $2`,
    [unitId, componentCode, to, input.pct ?? null, input.actual_date ?? null, input.planned_next_event ?? null, input.planned_next_event_date ?? null, source, ctx.actor.user_id]
  );

  if (regression) {
    await tx.query(
      `INSERT INTO progress_reopen (id, unit_id, component_code, from_state, to_state, reason, actor_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      ["pro_" + randomUUID().slice(0, 8), unitId, componentCode, from, to, input.reason!.trim(), ctx.actor.user_id]
    );
    await appendEvent(tx, {
      type: "progress.reopened", entity_type: "unit", entity_id: unitId, project_id: projectId, unit_id: unitId,
      payload: { component: componentCode, from, to, reason: input.reason!.trim() }, ...actorFields(ctx),
    });
  }
  await appendEvent(tx, {
    type: "progress.updated", entity_type: "unit", entity_id: unitId, project_id: projectId, unit_id: unitId,
    payload: { component: componentCode, from, to, source, pct: input.pct ?? null }, ...actorFields(ctx),
  });
  return { from, to };
}

/** Rules 1–4, 7, 8 for a single cell, then the milestone-demand chain (the pre-07 behaviour). */
export async function updateProgress(
  unitId: string,
  componentCode: string,
  input: ProgressWriteInput,
  ctx: Ctx,
  opts: { source?: ProgressSource; tx?: DbLike } = {}
): Promise<UnitProgressView> {
  await assertProgressWriter(ctx);
  await withTx(opts.tx, (tx) => applyChange(tx, unitId, componentCode, input, opts.source ?? "SITE_ENTRY", ctx));
  await raiseDemandsForUnit(unitId, ctx);
  return getUnitProgress(unitId);
}

export interface ProgressCell {
  component_code: string;
  label: string;
  state_code: SpecProgressState;
  pct: number | null;
  actual_date: string | null;
  planned_next_event: string | null;
  planned_next_event_date: string | null;
  source: ProgressSource;
  updated_by: string | null;
  updated_at: string;
  freshness: FreshnessStatus;
}
export interface UnitProgressView { unit_id: string; components: ProgressCell[] }

function asDate(v: unknown): string | null { return v ? new Date(v as string).toISOString().slice(0, 10) : null; }

/** Rules 2 + 6: every cell carries source/who/when and a live-derived freshness. */
export async function getUnitProgress(unitId: string, ctx?: Ctx, asOf?: string): Promise<UnitProgressView> {
  if (ctx) requireRole(ctx, STAFF_ROLES);
  const rls = await loadGateRules();
  const gateDependent = new Set(rls.map((r) => r.trigger_component_code));
  const r = await db.query<{
    component_code: string; label: string; stale_after_days: number; state_code: ProgressState; pct: number | null;
    actual_date: unknown; planned_next_event: string | null; planned_next_event_date: unknown; source: ProgressSource; updated_by: string | null; updated_at: unknown;
  }>(
    `SELECT c.code AS component_code, c.label, c.stale_after_days, p.state_code, p.pct, p.actual_date, p.planned_next_event,
            p.planned_next_event_date, p.source, p.updated_by, p.updated_at
       FROM component_definition c JOIN unit_progress p ON p.component_code = c.code AND p.unit_id = $1
      WHERE c.effective_from <= CURRENT_DATE AND (c.effective_to IS NULL OR c.effective_to > CURRENT_DATE)
      ORDER BY c.sort_order`,
    [unitId]
  );
  return {
    unit_id: unitId,
    components: r.rows.map((row) => {
      const updatedAt = new Date(row.updated_at as string).toISOString();
      return {
        component_code: row.component_code, label: row.label, state_code: toSpecProgressState(row.state_code), pct: row.pct,
        actual_date: asDate(row.actual_date), planned_next_event: row.planned_next_event, planned_next_event_date: asDate(row.planned_next_event_date),
        source: row.source, updated_by: row.updated_by, updated_at: updatedAt,
        freshness: deriveFreshness({ state: row.state_code, updatedAt, staleAfterDays: row.stale_after_days, gateDependent: gateDependent.has(row.component_code), asOf }),
      };
    }),
  };
}

export async function unitsInScope(projectId: string, scope: { node_ids?: string[]; unit_ids?: string[] }, tx: DbLike): Promise<{ id: string; unit_number: string; hierarchy_node_id: string }[]> {
  const nodeIds = scope.node_ids ?? [];
  const unitIds = scope.unit_ids ?? [];
  if (nodeIds.length === 0 && unitIds.length === 0) throw new AppError("validation", "scope needs node_ids or unit_ids", "scope");
  const r = await tx.query<{ id: string; unit_number: string; hierarchy_node_id: string }>(
    `WITH RECURSIVE sub AS (
       SELECT id FROM project_hierarchy_node WHERE id = ANY($2::text[])
       UNION ALL
       SELECT n.id FROM project_hierarchy_node n JOIN sub ON n.parent_id = sub.id
     )
     SELECT u.id, u.unit_number, u.hierarchy_node_id FROM unit u
      WHERE u.project_id = $1 AND (u.id = ANY($3::text[]) OR u.hierarchy_node_id IN (SELECT id FROM sub))
      ORDER BY u.unit_number`,
    [projectId, nodeIds, unitIds]
  );
  return r.rows;
}

/** Console matrix: units × components for a project (optionally one hierarchy subtree). */
export async function getProjectProgress(projectId: string, nodeId: string | undefined, ctx: Ctx): Promise<{ unit_id: string; unit_number: string; hierarchy_node_id: string; components: ProgressCell[] }[]> {
  requireRole(ctx, STAFF_ROLES);
  const units = nodeId
    ? await unitsInScope(projectId, { node_ids: [nodeId] }, db)
    : (await db.query<{ id: string; unit_number: string; hierarchy_node_id: string }>(`SELECT id, unit_number, hierarchy_node_id FROM unit WHERE project_id = $1 ORDER BY unit_number`, [projectId])).rows;
  const out = [];
  for (const u of units) {
    const view = await getUnitProgress(u.id);
    out.push({ unit_id: u.id, unit_number: u.unit_number, hierarchy_node_id: u.hierarchy_node_id, components: view.components });
  }
  return out;
}

export async function getProgressHistory(unitId: string, ctx: Ctx): Promise<{ type: string; occurred_at: string; actor_user_id: string | null; payload: unknown }[]> {
  requireRole(ctx, STAFF_ROLES);
  const r = await db.query<{ type: string; occurred_at: unknown; actor_user_id: string | null; payload: unknown }>(
    `SELECT type, occurred_at, actor_user_id, payload FROM event WHERE unit_id = $1 AND type LIKE 'progress.%' ORDER BY occurred_at DESC LIMIT 200`,
    [unitId]
  );
  return r.rows.map((e) => ({ ...e, occurred_at: new Date(e.occurred_at as string).toISOString() }));
}

// --- Rule 5: two-step bulk update ---

export interface BulkScope { node_ids?: string[]; unit_ids?: string[] }
export interface BulkPreviewUnit {
  unit_id: string;
  unit_number: string;
  current_state: SpecProgressState;
  no_op: boolean;
  regression: boolean;
  gate_deltas: { category_code: string; from: DerivedGate["state"]; to: DerivedGate["state"] }[];
}
export interface BulkPreview {
  id: string;
  component_code: string;
  new_state: SpecProgressState;
  units: BulkPreviewUnit[];
  affected_count: number;
  no_op_count: number;
  regression_count: number;
  requires_reason: boolean;
}

export async function previewBulkUpdate(projectId: string, input: { scope: BulkScope; component_code: string; new_state: string; reason?: string | null }, ctx: Ctx): Promise<BulkPreview> {
  await assertProgressWriter(ctx);
  const newState = toDbProgressState(input.new_state);
  assertStateAuthority(newState, ctx);
  return withTx(undefined, async (tx) => {
    await requireComponent(input.component_code, tx);
    const units = await unitsInScope(projectId, input.scope, tx);
    const [cats, rls] = await Promise.all([loadGateCategories(tx), loadGateRules(tx)]);
    const rows: BulkPreviewUnit[] = [];
    for (const u of units) {
      const current = await loadProgressMap(u.id, tx);
      const currentState = current[input.component_code] ?? "not_started";
      const before = gatesFromProgress(current, cats, rls).gates;
      const after = gatesFromProgress({ ...current, [input.component_code]: newState }, cats, rls).gates;
      const gate_deltas = before
        .map((b, i) => ({ category_code: b.category_code, from: b.state, to: after[i]!.state }))
        .filter((d) => d.from !== d.to);
      rows.push({ unit_id: u.id, unit_number: u.unit_number, current_state: toSpecProgressState(currentState), no_op: currentState === newState, regression: isRegression(currentState, newState), gate_deltas });
    }
    const id = "pbu_" + randomUUID().slice(0, 8);
    const preview: BulkPreview = {
      id, component_code: input.component_code, new_state: toSpecProgressState(newState), units: rows,
      affected_count: rows.filter((r) => !r.no_op).length,
      no_op_count: rows.filter((r) => r.no_op).length,
      regression_count: rows.filter((r) => r.regression && !r.no_op).length,
      requires_reason: rows.some((r) => r.regression && !r.no_op) && !input.reason?.trim(),
    };
    await tx.query(
      `INSERT INTO progress_bulk_update (id, project_id, scope, component_code, new_state, reason, preview, previewed_by)
       VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7::jsonb,$8)`,
      [id, projectId, JSON.stringify(input.scope), input.component_code, newState, input.reason?.trim() || null, JSON.stringify(preview), ctx.actor.user_id]
    );
    return preview;
  });
}

export interface BulkApplyResult { id: string; applied: string[]; excluded: { unit_id: string; reason: string }[]; conflicts: string[] }

/** Applies a PREVIEWED bulk update minus `exceptions`; a unit whose cell changed since the
 *  preview (a newer per-unit entry) is a conflict and is skipped, never silently overwritten. */
export async function applyBulkUpdate(id: string, input: { exceptions?: { unit_id: string; reason: string }[] }, ctx: Ctx): Promise<BulkApplyResult> {
  await assertProgressWriter(ctx);
  const exceptions = input.exceptions ?? [];
  for (const e of exceptions) if (!e.reason?.trim()) throw new AppError("validation", "each exception needs a reason", "exceptions");
  const excluded = new Set(exceptions.map((e) => e.unit_id));

  const result = await withTx(undefined, async (tx) => {
    const r = await tx.query<{ project_id: string; component_code: string; new_state: ProgressState; reason: string | null; preview: BulkPreview; status: string; previewed_at: unknown }>(
      `SELECT project_id, component_code, new_state, reason, preview, status, previewed_at FROM progress_bulk_update WHERE id = $1`,
      [id]
    );
    const pbu = r.rows[0];
    if (!pbu) throw new AppError("not_found", "bulk update not found");
    if (pbu.status !== "PREVIEWED") throw new AppError("conflict", `bulk update is ${pbu.status}`);
    assertStateAuthority(pbu.new_state, ctx);
    const targets = pbu.preview.units.filter((u) => !u.no_op && !excluded.has(u.unit_id));
    if (targets.some((u) => u.regression) && !pbu.reason) {
      throw new AppError("validation", "this bulk update regresses declared/verified cells — preview it again with a reason", "reason");
    }
    const previewedAt = new Date(pbu.previewed_at as string).getTime();
    const applied: string[] = [];
    const conflicts: string[] = [];
    for (const u of targets) {
      const cell = await tx.query<{ updated_at: unknown }>(`SELECT updated_at FROM unit_progress WHERE unit_id = $1 AND component_code = $2`, [u.unit_id, pbu.component_code]);
      if (cell.rows[0] && new Date(cell.rows[0].updated_at as string).getTime() > previewedAt) { conflicts.push(u.unit_id); continue; }
      await applyChange(tx, u.unit_id, pbu.component_code, { state_code: pbu.new_state, reason: pbu.reason }, "BULK_UPDATE", ctx);
      applied.push(u.unit_id);
    }
    await tx.query(
      `UPDATE progress_bulk_update SET status = 'APPLIED', exceptions = $2::jsonb, applied_by = $3, applied_at = now(),
              preview = preview || jsonb_build_object('conflicts', $4::jsonb) WHERE id = $1`,
      [id, JSON.stringify(exceptions), ctx.actor.user_id, JSON.stringify(conflicts)]
    );
    await appendEvent(tx, {
      type: "progress.bulk_applied", entity_type: "progress_bulk_update", entity_id: id, project_id: pbu.project_id,
      payload: { component: pbu.component_code, new_state: pbu.new_state, applied_count: applied.length, excluded_count: exceptions.length, conflict_count: conflicts.length, unit_ids: applied },
      ...actorFields(ctx),
    });
    return { id, applied, excluded: exceptions, conflicts };
  });
  for (const unitId of result.applied) await raiseDemandsForUnit(unitId, ctx);
  return result;
}

// --- Rule 6: stale sweep (directly callable; no scheduler exists — see header) ---

export async function scanStaleProgress(asOf: string = new Date().toISOString(), tx?: DbLike): Promise<{ unit_id: string; component_code: string; freshness: FreshnessStatus }[]> {
  return withTx(tx, async (t) => {
    const rls = await loadGateRules(t);
    const gateDependent = new Set(rls.map((r) => r.trigger_component_code));
    const rows = await t.query<{ unit_id: string; unit_number: string; project_id: string; component_code: string; state_code: ProgressState; updated_at: unknown; stale_after_days: number }>(
      `SELECT p.unit_id, u.unit_number, u.project_id, p.component_code, p.state_code, p.updated_at, c.stale_after_days
         FROM unit_progress p JOIN unit u ON u.id = p.unit_id JOIN component_definition c ON c.code = p.component_code
        WHERE p.state_code IN ('in_progress', 'rework')`
    );
    const flagged: { unit_id: string; component_code: string; freshness: FreshnessStatus }[] = [];
    for (const row of rows.rows) {
      const freshness = deriveFreshness({ state: row.state_code, updatedAt: new Date(row.updated_at as string).toISOString(), staleAfterDays: row.stale_after_days, gateDependent: gateDependent.has(row.component_code), asOf });
      if (freshness === "FRESH") continue;
      flagged.push({ unit_id: row.unit_id, component_code: row.component_code, freshness });
      const key = `${row.unit_id}:${row.component_code}`;
      const open = await t.query<{ id: string }>(
        `SELECT id FROM action WHERE source_module = 'progress' AND source_entity_type = 'unit_progress' AND source_entity_id = $1 AND status NOT IN ('Closed', 'Cancelled')`,
        [key]
      );
      if (open.rows[0]) continue; // already raised, still open — don't stack duplicates
      await createAction(
        {
          type: "exec_simple", title: `Verify ${row.component_code} progress on ${row.unit_number}`, project_id: row.project_id,
          source_module: "progress", source_entity_type: "unit_progress", source_entity_id: key, unit_id: row.unit_id,
          owner_role: "SITE", priority: freshness === "VERIFICATION_REQUIRED" ? "HIGH" : "MEDIUM", origin: "AUTO",
        },
        t
      );
      await appendEvent(t, {
        type: "progress.stale", entity_type: "unit", entity_id: row.unit_id, project_id: row.project_id, unit_id: row.unit_id,
        payload: { component: row.component_code, freshness, stale_after_days: row.stale_after_days },
      });
    }
    return flagged;
  });
}

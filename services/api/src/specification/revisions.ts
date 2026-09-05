import { randomUUID } from "node:crypto";
import { db } from "../db";
import { appendEvent, withTx, actorFields, type DbLike } from "../events";
import { requireRole, SITE_SETUP_ROLES, STAFF_ROLES } from "../authz/requireRole";
import { AppError, type Ctx } from "../authz/types";
import { files, assertAllowedContentType } from "../ports/files";
import { resolveBaseline, loadBaseline, type BaselineRow, type SpecItems, type SpecItemsDelta } from "./baselines";

// 09 rules 1–5: unit_specification + spec_revision chain with the superseded lock. Draft creation,
// release and as-built are 18's handlers' calls (no ctx gate — they run inside 18's transaction and
// carry its actor); the ctx-gated functions are the read API and the drawing upload.

export type RevisionKind = "BASELINE" | "CUSTOMISATION" | "AS_BUILT_CORRECTION";
export type RevisionStatus = "DRAFT" | "RELEASED" | "SUPERSEDED";
type Actor = { actor_user_id?: string | null; actor_kind?: "USER" | "SYSTEM" | "CUSTOMER" };

export interface RevisionRow {
  id: string; unit_id: string; project_id: string; revision_no: number; kind: RevisionKind; change_request_id: string | null;
  items_delta: SpecItemsDelta; drawing_file_keys: string[]; note: string | null; status: RevisionStatus;
  released_at: string | null; released_by: string | null; superseded_by_id: string | null; created_at: string;
}
const SELECT = `SELECT id, unit_id, project_id, revision_no, kind, change_request_id, items_delta, drawing_file_keys, note, status,
  released_at::text AS released_at, released_by, superseded_by_id, created_at::text AS created_at FROM spec_revision`;

export async function loadRevision(id: string, tx: DbLike = db): Promise<RevisionRow> {
  const r = await tx.query<RevisionRow>(`${SELECT} WHERE id = $1`, [id]);
  if (!r.rows[0]) throw new AppError("not_found", "spec revision not found");
  return r.rows[0];
}

/** Pure: baseline items with released deltas stacked in revision order (`null` removes a category). */
export function applyDeltas(base: SpecItems, deltas: SpecItemsDelta[]): SpecItems {
  const out: SpecItems = { ...base };
  for (const d of deltas) for (const [k, v] of Object.entries(d)) { if (v === null) delete out[k]; else out[k] = v; }
  return out;
}

/** Pure: the delta that turns `released` into `actual` — empty when they match (rule 4's "if it differs"). */
export function diffItems(released: SpecItems, actual: SpecItems): SpecItemsDelta {
  const delta: SpecItemsDelta = {};
  for (const k of new Set([...Object.keys(released), ...Object.keys(actual)])) {
    const a = released[k], b = actual[k];
    if (!b) delta[k] = null;
    else if (!a || a.spec !== b.spec || (a.brand_model ?? null) !== (b.brand_model ?? null) || (a.qty ?? null) !== (b.qty ?? null)) delta[k] = b;
  }
  return delta;
}

interface UnitSpecRow { unit_id: string; baseline_id: string; current_revision_id: string | null }

/** Rule 1: attach the approved baseline and write revision 0 (BASELINE, RELEASED). Idempotent; returns null
 *  (and does nothing) when the project has no APPROVED baseline for the unit's product/unit type. */
export async function ensureUnitSpecification(unitId: string, tx: DbLike, actor: Actor): Promise<UnitSpecRow | null> {
  const existing = await tx.query<UnitSpecRow>(`SELECT unit_id, baseline_id, current_revision_id FROM unit_specification WHERE unit_id = $1`, [unitId]);
  if (existing.rows[0]) return existing.rows[0];
  const u = (await tx.query<{ project_id: string; product_type: string; unit_type: string | null }>(`SELECT project_id, product_type, unit_type FROM unit WHERE id = $1`, [unitId])).rows[0];
  if (!u) throw new AppError("not_found", "unit not found");
  const baseline = await resolveBaseline(u, tx);
  if (!baseline) return null;
  const revId = "rev_" + randomUUID().slice(0, 8);
  await tx.query(
    `INSERT INTO spec_revision (id, unit_id, project_id, revision_no, kind, items_delta, status, released_at, released_by, created_by)
     VALUES ($1,$2,$3,0,'BASELINE','{}'::jsonb,'RELEASED',now(),$4,$4)`,
    [revId, unitId, u.project_id, actor.actor_user_id ?? null]
  );
  await tx.query(`INSERT INTO unit_specification (unit_id, baseline_id, current_revision_id) VALUES ($1,$2,$3)`, [unitId, baseline.id, revId]);
  await tx.query(`UPDATE unit SET specification_baseline_id = $2 WHERE id = $1`, [unitId, baseline.id]);
  return { unit_id: unitId, baseline_id: baseline.id, current_revision_id: revId };
}

async function unitSpec(unitId: string, tx: DbLike): Promise<UnitSpecRow> {
  const r = await tx.query<UnitSpecRow>(`SELECT unit_id, baseline_id, current_revision_id FROM unit_specification WHERE unit_id = $1`, [unitId]);
  if (!r.rows[0]) throw new AppError("conflict", "unit has no specification baseline attached (rule 1: attached at booking confirmation)");
  return r.rows[0];
}

/** Rule 2 (first half): a DRAFT revision — 18 creates one when a change request is approved. */
export async function createDraftRevision(
  unitId: string,
  input: { kind: Exclude<RevisionKind, "BASELINE">; change_request_id?: string | null; items_delta: SpecItemsDelta; note?: string | null },
  tx: DbLike,
  actor: Actor
): Promise<RevisionRow> {
  const spec = await unitSpec(unitId, tx);
  if (!input.items_delta || typeof input.items_delta !== "object") throw new AppError("validation", "items_delta is required", "items_delta");
  const b = await loadBaseline(spec.baseline_id, tx);
  const id = "rev_" + randomUUID().slice(0, 8);
  await tx.query(
    `INSERT INTO spec_revision (id, unit_id, project_id, revision_no, kind, change_request_id, items_delta, note, status, created_by)
     VALUES ($1,$2,$3, 1 + (SELECT MAX(revision_no) FROM spec_revision WHERE unit_id = $2), $4,$5,$6::jsonb,$7,'DRAFT',$8)`,
    [id, unitId, b.project_id, input.kind, input.change_request_id ?? null, JSON.stringify(input.items_delta), input.note ?? null, actor.actor_user_id ?? null]
  );
  return loadRevision(id, tx);
}

/** Rule 2 (second half): RELEASED; the previous current revision becomes SUPERSEDED → `spec_revision.superseded`,
 *  and `drawing.released` fires with unit_id so 08 observes DRAWING_RELEASED. */
export async function releaseRevision(revisionId: string, tx: DbLike, actor: Actor): Promise<RevisionRow> {
  const rev = await loadRevision(revisionId, tx);
  if (rev.status !== "DRAFT") throw new AppError("conflict", `revision ${rev.revision_no} is ${rev.status}`);
  const spec = await unitSpec(rev.unit_id, tx);
  const prevId = spec.current_revision_id;
  await tx.query(`UPDATE spec_revision SET status = 'RELEASED', released_at = now(), released_by = $2 WHERE id = $1`, [revisionId, actor.actor_user_id ?? null]);
  if (prevId) {
    const prev = await loadRevision(prevId, tx);
    await tx.query(`UPDATE spec_revision SET status = 'SUPERSEDED', superseded_by_id = $2 WHERE id = $1`, [prevId, revisionId]);
    await appendEvent(tx, {
      type: "spec_revision.superseded", entity_type: "spec_revision", entity_id: prevId, project_id: rev.project_id, unit_id: rev.unit_id,
      payload: { revision_no: prev.revision_no, superseded_by: revisionId, superseded_by_revision_no: rev.revision_no }, ...actor,
    });
  }
  await tx.query(`UPDATE unit_specification SET current_revision_id = $2 WHERE unit_id = $1`, [rev.unit_id, revisionId]);
  await appendEvent(tx, {
    type: "drawing.released", entity_type: "spec_revision", entity_id: revisionId, project_id: rev.project_id, unit_id: rev.unit_id,
    payload: { revision_no: rev.revision_no, kind: rev.kind, change_request_id: rev.change_request_id, categories: Object.keys(rev.items_delta), drawings: rev.drawing_file_keys.length }, ...actor,
  });
  return loadRevision(revisionId, tx);
}

/** Rule 4: on AS_BUILT_CLOSED, record what was actually built. Returns null when it matches the released spec. */
export async function recordAsBuilt(
  unitId: string,
  input: { change_request_id?: string | null; as_built_items: SpecItems; drawing_file_keys?: string[]; note?: string | null },
  tx: DbLike,
  actor: Actor
): Promise<RevisionRow | null> {
  const current = await currentItems(unitId, tx);
  const delta = diffItems(current, input.as_built_items);
  if (Object.keys(delta).length === 0) return null;
  const draft = await createDraftRevision(unitId, { kind: "AS_BUILT_CORRECTION", change_request_id: input.change_request_id, items_delta: delta, note: input.note ?? "As-built correction" }, tx, actor);
  if (input.drawing_file_keys?.length) await tx.query(`UPDATE spec_revision SET drawing_file_keys = $2::text[] WHERE id = $1`, [draft.id, input.drawing_file_keys]);
  const released = await releaseRevision(draft.id, tx, actor);
  await appendEvent(tx, {
    type: "as_built.recorded", entity_type: "spec_revision", entity_id: released.id, project_id: released.project_id, unit_id: unitId,
    payload: { revision_no: released.revision_no, change_request_id: input.change_request_id ?? null, corrected_categories: Object.keys(delta) }, ...actor,
  });
  return released;
}

/** Materialised current specification: baseline + every released/superseded delta in order. */
export async function currentItems(unitId: string, tx: DbLike = db): Promise<SpecItems> {
  const spec = await unitSpec(unitId, tx);
  const b = await loadBaseline(spec.baseline_id, tx);
  const r = await tx.query<{ items_delta: SpecItemsDelta }>(`SELECT items_delta FROM spec_revision WHERE unit_id = $1 AND status IN ('RELEASED','SUPERSEDED') ORDER BY revision_no`, [unitId]);
  return applyDeltas(b.items, r.rows.map((x) => x.items_delta));
}

export interface RevisionView extends RevisionRow {
  is_current: boolean;
  banner: string | null;
  drawings: { key: string; url: string }[];
}

/** Rule 3: every drawing read carries its revision number and a "superseded" banner when not current. */
async function viewOf(rev: RevisionRow, currentId: string | null): Promise<RevisionView> {
  const is_current = rev.id === currentId;
  let banner: string | null = null;
  if (rev.status === "SUPERSEDED") {
    const by = rev.superseded_by_id ? await loadRevision(rev.superseded_by_id) : null;
    banner = `Superseded${by ? ` by Rev ${by.revision_no}` : ""} — read-only, not the current released revision`;
  } else if (rev.status === "DRAFT") banner = "Draft — not yet released";
  const drawings = await Promise.all(rev.drawing_file_keys.map(async (key) => ({ key, url: await files.getPresigned(key) })));
  return { ...rev, is_current, banner, drawings };
}

export async function getRevision(id: string, ctx: Ctx): Promise<RevisionView> {
  requireRole(ctx, STAFF_ROLES);
  const rev = await loadRevision(id);
  const spec = await db.query<{ current_revision_id: string | null }>(`SELECT current_revision_id FROM unit_specification WHERE unit_id = $1`, [rev.unit_id]);
  return viewOf(rev, spec.rows[0]?.current_revision_id ?? null);
}

export interface UnitSpecificationView {
  unit_id: string;
  baseline: BaselineRow | null;
  current_revision: RevisionView | null;
  current_items: SpecItems;
  history: RevisionView[];
  blocker: string | null;
}

/** GET /units/:id/specification — baseline + current revision + history (rule 3 banners on each). */
export async function getUnitSpecification(unitId: string, ctx: Ctx): Promise<UnitSpecificationView> {
  requireRole(ctx, STAFF_ROLES);
  const u = (await db.query<{ project_id: string; product_type: string; unit_type: string | null }>(`SELECT project_id, product_type, unit_type FROM unit WHERE id = $1`, [unitId])).rows[0];
  if (!u) throw new AppError("not_found", "unit not found");
  const spec = (await db.query<UnitSpecRow>(`SELECT unit_id, baseline_id, current_revision_id FROM unit_specification WHERE unit_id = $1`, [unitId])).rows[0];
  if (!spec) {
    const approved = await resolveBaseline(u);
    return {
      unit_id: unitId, baseline: null, current_revision: null, current_items: {}, history: [],
      blocker: approved ? "No specification attached yet — attaches at booking confirmation" : `No APPROVED specification baseline for ${u.product_type}${u.unit_type ? ` / ${u.unit_type}` : ""} in this project`,
    };
  }
  const baseline = await loadBaseline(spec.baseline_id);
  const rows = (await db.query<RevisionRow>(`${SELECT} WHERE unit_id = $1 ORDER BY revision_no DESC`, [unitId])).rows;
  const history = await Promise.all(rows.map((r) => viewOf(r, spec.current_revision_id)));
  return { unit_id: unitId, baseline, current_revision: history.find((h) => h.is_current) ?? null, current_items: await currentItems(unitId), history, blocker: null };
}

/** Rule 5: presigned drawing upload (PDF/image ≤ 25 MB via the files port) onto a DRAFT revision only —
 *  rule 3's lock: released/superseded revisions never change. */
export async function addDrawing(revisionId: string, input: { content_type: string }, ctx: Ctx): Promise<{ revision: RevisionRow; key: string; upload: Awaited<ReturnType<typeof files.putPresigned>> }> {
  requireRole(ctx, SITE_SETUP_ROLES);
  const rev = await loadRevision(revisionId);
  if (rev.status !== "DRAFT") throw new AppError("conflict", `revision ${rev.revision_no} is ${rev.status} and read-only`);
  if (!input.content_type) throw new AppError("validation", "content_type is required", "content_type");
  assertAllowedContentType(input.content_type);
  const ext = input.content_type === "application/pdf" ? "pdf" : input.content_type.split("/")[1]!;
  const key = `project/${rev.project_id}/spec_revision/${revisionId}/${randomUUID()}.${ext}`;
  const upload = await files.putPresigned(key, input.content_type);
  await db.query(`UPDATE spec_revision SET drawing_file_keys = array_append(drawing_file_keys, $2) WHERE id = $1`, [revisionId, key]);
  return { revision: await loadRevision(revisionId), key, upload };
}

/** Convenience for callers outside a transaction (tests, future 18 handlers running standalone). */
export const withSpecTx = <T>(fn: (tx: DbLike) => Promise<T>) => withTx(undefined, fn);
export { actorFields };

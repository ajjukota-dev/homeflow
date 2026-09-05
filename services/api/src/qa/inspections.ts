import { randomUUID } from "node:crypto";
import { db } from "../db";
import { appendEvent, withTx, actorFields, type DbLike } from "../events";
import { authorize } from "../authz/authorize";
import { requireRole } from "../authz/requireRole";
import { AppError, type Ctx } from "../authz/types";
import { createAction } from "../actions/core";
import { updateProgress } from "../progress/core";
import { files, assertAllowedContentType } from "../ports/files";
import { resolveTemplate, type TemplateItem, type TemplateRow } from "./templates";
import { insertSnag } from "./snags";

// 15-qa-evidence-snags.md rules 1–3. `qa_inspection` + `qa_inspection_evidence` are new; the
// legacy `qa_evidence` (unit, component) → qa_verified flag that 14's readiness and the handover
// gate read is kept in step by every QA PASS/FAIL here, so the two never disagree.
//
// Reconciliations, flagged not faked:
//  - Rule 1's state writes go through 07's updateProgress (its own transaction, sequenced after
//    the inspection's — see sales-handover/core.ts for why nested withTx deadlocks on PGlite).
//    07's assertStateAuthority already enforces COMPLETE→SITE / VERIFIED→QA; the kind→role check
//    here mirrors it so a SITE user can't start a QA_VERIFICATION either.
//  - Rule 2's "evidence verified by QA ≠ uploader" is enforced on verifyEvidence; a PASS needs
//    every required item's configured evidence present and not REJECTED — it does not require
//    the evidence to be VERIFIED first (QA's own inspection photos would need a second QA).
//  - Rule 1's re-inspection action is `exec_simple` owned by SITE (the party that reworks), not
//    a QA-owned verification — the QA re-inspection is the next QA_VERIFICATION/RE_INSPECTION run.

export type InspectionKind = "SITE_DECLARATION" | "QA_VERIFICATION" | "RE_INSPECTION";
export type ItemResult = "PASS" | "FAIL" | "NA";

export interface InspectionItem { code: string; result: ItemResult; note?: string | null }

export interface InspectionRow {
  id: string; unit_id: string; project_id: string; component_code: string; kind: InspectionKind; template_id: string | null;
  status: "SCHEDULED" | "IN_PROGRESS" | "PASSED" | "FAILED"; inspector_user_id: string | null;
  started_at: string; completed_at: string | null; items: InspectionItem[]; attempt_no: number; failure_reason: string | null; action_id: string | null;
}

export interface EvidenceRow {
  id: string; inspection_id: string; item_code: string; file_key: string; kind: string; captured_at: string; captured_by: string;
  gps: Record<string, unknown> | null; verification_status: "UPLOADED" | "VERIFIED" | "REJECTED"; verified_by: string | null; superseded_by: string | null;
}

const SELECT = `SELECT id, unit_id, project_id, component_code, kind, template_id, status, inspector_user_id, started_at::text AS started_at,
  completed_at::text AS completed_at, items, attempt_no, failure_reason, action_id FROM qa_inspection`;
const EVIDENCE_SELECT = `SELECT id, inspection_id, item_code, file_key, kind, captured_at::text AS captured_at, captured_by, gps, verification_status,
  verified_by, superseded_by FROM qa_inspection_evidence`;

async function loadInspection(id: string, tx: DbLike = db): Promise<InspectionRow> {
  const r = await tx.query<InspectionRow>(`${SELECT} WHERE id = $1`, [id]);
  if (!r.rows[0]) throw new AppError("not_found", "inspection not found");
  return r.rows[0];
}

async function assertInspector(ctx: Ctx, kind: InspectionKind): Promise<void> {
  await authorize(ctx, "unit_readiness", "WRITE");
  requireRole(ctx, kind === "SITE_DECLARATION" ? ["SITE", "SUPER_ADMIN"] : ["QA", "SUPER_ADMIN"]);
}

export async function startInspection(unitId: string, input: { component_code: string; kind: InspectionKind }, ctx: Ctx): Promise<InspectionRow & { template: TemplateRow | null }> {
  if (!["SITE_DECLARATION", "QA_VERIFICATION", "RE_INSPECTION"].includes(input.kind)) throw new AppError("validation", `invalid kind ${input.kind}`, "kind");
  await assertInspector(ctx, input.kind);
  const unit = await db.query<{ project_id: string; product_type: string }>(`SELECT project_id, product_type FROM unit WHERE id = $1`, [unitId]);
  if (!unit.rows[0]) throw new AppError("not_found", "unit not found");
  const comp = await db.query<{ code: string }>(`SELECT code FROM component_definition WHERE code = $1`, [input.component_code]);
  if (!comp.rows[0]) throw new AppError("validation", `unknown component ${input.component_code}`, "component_code");
  const open = await db.query<{ id: string }>(
    `SELECT id FROM qa_inspection WHERE unit_id = $1 AND component_code = $2 AND status IN ('SCHEDULED','IN_PROGRESS')`,
    [unitId, input.component_code]
  );
  if (open.rows[0]) throw new AppError("conflict", `inspection ${open.rows[0].id} is already open for this component`);

  const template = await resolveTemplate(input.component_code, unit.rows[0].product_type);
  // Rule 3's attempt counter: QA runs on the same component count together; site declarations count separately.
  const prior = await db.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM qa_inspection WHERE unit_id = $1 AND component_code = $2 AND (kind = 'SITE_DECLARATION') = ($3 = 'SITE_DECLARATION')`,
    [unitId, input.component_code, input.kind]
  );
  const id = "insp_" + randomUUID().slice(0, 8);
  await db.query(
    `INSERT INTO qa_inspection (id, unit_id, project_id, component_code, kind, template_id, inspector_user_id, attempt_no)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, unitId, unit.rows[0].project_id, input.component_code, input.kind, template?.id ?? null, ctx.actor.user_id, (prior.rows[0]?.n ?? 0) + 1]
  );
  return { ...(await loadInspection(id)), template };
}

export async function getInspection(id: string, ctx: Ctx): Promise<InspectionRow & { template: TemplateRow | null; evidence: EvidenceRow[] }> {
  await authorize(ctx, "unit_readiness", "READ");
  const insp = await loadInspection(id);
  const template = insp.template_id
    ? (await db.query<TemplateRow>(`SELECT id, component_code, product_types, items, min_photos, version, effective_from::text AS effective_from, effective_to::text AS effective_to FROM qa_checklist_template WHERE id = $1`, [insp.template_id])).rows[0] ?? null
    : null;
  const evidence = (await db.query<EvidenceRow>(`${EVIDENCE_SELECT} WHERE inspection_id = $1 ORDER BY captured_at`, [id])).rows;
  return { ...insp, template, evidence };
}

async function templateFor(insp: InspectionRow, tx: DbLike = db): Promise<TemplateRow | null> {
  if (!insp.template_id) return null;
  const r = await tx.query<TemplateRow>(`SELECT id, component_code, product_types, items, min_photos, version, effective_from::text AS effective_from, effective_to::text AS effective_to FROM qa_checklist_template WHERE id = $1`, [insp.template_id]);
  return r.rows[0] ?? null;
}

export async function setInspectionItems(id: string, items: InspectionItem[], ctx: Ctx): Promise<InspectionRow> {
  const insp = await loadInspection(id);
  await assertInspector(ctx, insp.kind);
  if (insp.status !== "IN_PROGRESS" && insp.status !== "SCHEDULED") throw new AppError("conflict", `inspection is ${insp.status}`);
  if (!Array.isArray(items)) throw new AppError("validation", "items must be a list", "items");
  const template = await templateFor(insp);
  const known = new Map((template?.items ?? []).map((i) => [i.code, i]));
  for (const it of items) {
    if (!["PASS", "FAIL", "NA"].includes(it.result)) throw new AppError("validation", `invalid result ${it.result} for ${it.code}`, "items");
    if (template && !known.has(it.code)) throw new AppError("validation", `unknown checklist item ${it.code}`, "items");
    if (known.get(it.code)?.required && it.result === "NA") throw new AppError("validation", `required item ${it.code} cannot be NA`, "items");
  }
  await db.query(`UPDATE qa_inspection SET items = $2::jsonb, status = 'IN_PROGRESS' WHERE id = $1`, [id, JSON.stringify(items)]);
  return loadInspection(id);
}

/** Rule 2: mint the storage key + PUT URL, record the row. `supersedes` replaces an earlier upload
 *  (kept, marked superseded_by) — there is deliberately no delete path. */
export async function addInspectionEvidence(
  id: string,
  input: { item_code: string; kind: "PHOTO" | "TEST_REPORT" | "CERTIFICATE"; content_type: string; gps?: Record<string, unknown> | null; supersedes?: string | null },
  ctx: Ctx
) {
  const insp = await loadInspection(id);
  await assertInspector(ctx, insp.kind);
  if (insp.status === "PASSED" || insp.status === "FAILED") throw new AppError("conflict", `inspection is ${insp.status}`);
  if (!["PHOTO", "TEST_REPORT", "CERTIFICATE"].includes(input.kind)) throw new AppError("validation", `invalid evidence kind ${input.kind}`, "kind");
  if (!input.content_type) throw new AppError("validation", "content_type is required", "content_type");
  assertAllowedContentType(input.content_type);
  const template = await templateFor(insp);
  if (template && !template.items.some((i) => i.code === input.item_code)) throw new AppError("validation", `unknown checklist item ${input.item_code}`, "item_code");

  const ext = input.content_type.split("/")[1] ?? "bin";
  const key = `project/${insp.project_id}/qa_inspection/${id}/${randomUUID()}.${ext}`;
  const upload = await files.putPresigned(key, input.content_type);
  const evidenceId = "qev_" + randomUUID().slice(0, 8);
  await withTx(undefined, async (tx) => {
    if (input.supersedes) {
      const old = await tx.query<{ id: string }>(`SELECT id FROM qa_inspection_evidence WHERE id = $1 AND inspection_id = $2`, [input.supersedes, id]);
      if (!old.rows[0]) throw new AppError("not_found", "evidence to supersede not found");
    }
    await tx.query(
      `INSERT INTO qa_inspection_evidence (id, inspection_id, item_code, file_key, kind, captured_by, gps) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [evidenceId, id, input.item_code, key, input.kind, ctx.actor.user_id, input.gps ? JSON.stringify(input.gps) : null]
    );
    if (input.supersedes) await tx.query(`UPDATE qa_inspection_evidence SET superseded_by = $2 WHERE id = $1`, [input.supersedes, evidenceId]);
  });
  return { evidence_id: evidenceId, file_key: key, upload };
}

export async function verifyInspectionEvidence(evidenceId: string, decision: "VERIFIED" | "REJECTED", note: string | undefined, ctx: Ctx): Promise<void> {
  await authorize(ctx, "unit_readiness", "WRITE");
  requireRole(ctx, ["QA", "SUPER_ADMIN"]);
  const ev = await db.query<{ inspection_id: string; captured_by: string; project_id: string; unit_id: string; item_code: string }>(
    `SELECT e.inspection_id, e.captured_by, i.project_id, i.unit_id, e.item_code
       FROM qa_inspection_evidence e JOIN qa_inspection i ON i.id = e.inspection_id WHERE e.id = $1`,
    [evidenceId]
  );
  if (!ev.rows[0]) throw new AppError("not_found", "evidence not found");
  if (ev.rows[0].captured_by === ctx.actor.user_id) throw new AppError("forbidden", "evidence must be verified by someone other than its uploader");
  await withTx(undefined, async (tx) => {
    await tx.query(`UPDATE qa_inspection_evidence SET verification_status = $2, verified_by = $3, verified_at = now() WHERE id = $1`, [evidenceId, decision, ctx.actor.user_id]);
    if (decision === "VERIFIED") {
      await appendEvent(tx, {
        type: "qa.evidence_verified", entity_type: "qa_inspection", entity_id: ev.rows[0].inspection_id, project_id: ev.rows[0].project_id, unit_id: ev.rows[0].unit_id,
        payload: { evidence_id: evidenceId, item_code: ev.rows[0].item_code, note: note ?? null }, ...actorFields(ctx),
      });
    }
  });
}

interface Outcome { passed: boolean; failedItems: TemplateItem[]; blockers: string[] }

/** Rules 1+2 decided together: what's missing (blocks completion) vs what failed (a FAILED result). */
function evaluate(insp: InspectionRow, template: TemplateRow | null, evidence: EvidenceRow[]): Outcome {
  const items = template?.items ?? [];
  const answered = new Map(insp.items.map((i) => [i.code, i]));
  const live = evidence.filter((e) => !e.superseded_by && e.verification_status !== "REJECTED");
  const blockers: string[] = [];
  const failedItems: TemplateItem[] = [];
  for (const item of items) {
    const a = answered.get(item.code);
    if (item.required && !a) { blockers.push(`item ${item.code} has no result`); continue; }
    if (a?.result === "FAIL") failedItems.push(item);
    if (a?.result === "PASS" && item.evidence !== "NONE" && !live.some((e) => e.item_code === item.code && e.kind === item.evidence)) {
      blockers.push(`item ${item.code} passed without ${item.evidence} evidence`);
    }
  }
  if (!template) {
    for (const a of insp.items) if (a.result === "FAIL") failedItems.push({ code: a.code, label: a.code, evidence: "NONE", required: true });
  }
  const photos = live.filter((e) => e.kind === "PHOTO").length;
  if (template && photos < template.min_photos) blockers.push(`${photos} photo(s) captured, ${template.min_photos} required`);
  return { passed: failedItems.length === 0, failedItems, blockers };
}

export async function completeInspection(id: string, ctx: Ctx): Promise<InspectionRow> {
  const insp = await loadInspection(id);
  await assertInspector(ctx, insp.kind);
  if (insp.status !== "IN_PROGRESS" && insp.status !== "SCHEDULED") throw new AppError("conflict", `inspection is ${insp.status}`);
  const template = await templateFor(insp);
  const evidence = (await db.query<EvidenceRow>(`${EVIDENCE_SELECT} WHERE inspection_id = $1`, [id])).rows;
  const outcome = evaluate(insp, template, evidence);
  if (outcome.blockers.length > 0) {
    const err = new AppError("validation", `inspection cannot be completed: ${outcome.blockers.join("; ")}`, "items") as AppError & { blockers: string[] };
    err.blockers = outcome.blockers;
    throw err;
  }

  const unit = (await db.query<{ unit_number: string }>(`SELECT unit_number FROM unit WHERE id = $1`, [insp.unit_id])).rows[0];
  const isQa = insp.kind !== "SITE_DECLARATION";
  const failureReason = outcome.passed ? null : `Failed items: ${outcome.failedItems.map((i) => i.code).join(", ")}`;

  await withTx(undefined, async (tx) => {
    let actionId: string | null = null;
    if (!outcome.passed && isQa) {
      for (const item of outcome.failedItems) {
        const note = insp.items.find((i) => i.code === item.code)?.note;
        await insertSnag(
          {
            unit_id: insp.unit_id, room: "OTHER", category: item.category ?? "OTHER", severity: item.severity ?? "MAJOR",
            description: `${item.label}${note ? ` — ${note}` : ""}`, raised_by_kind: "QA", inspection_id: id,
          },
          { user_id: ctx.actor.user_id, kind: "USER" },
          tx
        );
      }
      actionId = await createAction(
        {
          type: "exec_simple", title: `Re-inspect ${insp.component_code} on ${unit?.unit_number ?? insp.unit_id} (attempt ${insp.attempt_no + 1})`,
          project_id: insp.project_id, source_module: "qa", source_entity_type: "qa_inspection", source_entity_id: id, unit_id: insp.unit_id,
          owner_role: "SITE", priority: "HIGH", origin: "AUTO", created_by: ctx.actor.user_id,
        },
        tx
      );
    }
    await tx.query(
      `UPDATE qa_inspection SET status = $2, completed_at = now(), failure_reason = $3, action_id = $4 WHERE id = $1`,
      [id, outcome.passed ? "PASSED" : "FAILED", failureReason, actionId]
    );
    if (isQa) {
      // Legacy (unit, component) flag that 14's readiness + the handover gate still read.
      await tx.query(
        `INSERT INTO qa_evidence (unit_id, component_code, qa_verified, evidence_note, verified_at)
         VALUES ($1,$2,$3,$4,now())
         ON CONFLICT (unit_id, component_code) DO UPDATE SET qa_verified = $3, evidence_note = $4, verified_at = now()`,
        [insp.unit_id, insp.component_code, outcome.passed, `QA inspection ${id} ${outcome.passed ? "passed" : "failed"}`]
      );
    }
    await appendEvent(tx, {
      type: outcome.passed ? "qa.inspection_passed" : "qa.inspection_failed", entity_type: "unit", entity_id: insp.unit_id,
      project_id: insp.project_id, unit_id: insp.unit_id,
      payload: { inspection_id: id, component: insp.component_code, kind: insp.kind, attempt_no: insp.attempt_no, failed_items: outcome.failedItems.map((i) => i.code) },
      ...actorFields(ctx),
    });
  });

  // Rule 1's 07 state write — its own transaction, after the inspection's (nested withTx deadlocks on PGlite).
  if (outcome.passed) {
    await updateProgress(insp.unit_id, insp.component_code, { state_code: isQa ? "VERIFIED" : "COMPLETE" }, ctx, { source: isQa ? "QA_VERIFICATION" : "SITE_ENTRY" });
  } else if (isQa) {
    await updateProgress(insp.unit_id, insp.component_code, { state_code: "REWORK", reason: failureReason }, ctx, { source: "QA_VERIFICATION" });
  }
  return loadInspection(id);
}

export async function listInspectionsForUnit(unitId: string, ctx: Ctx): Promise<InspectionRow[]> {
  await authorize(ctx, "unit_readiness", "READ");
  return (await db.query<InspectionRow>(`${SELECT} WHERE unit_id = $1 ORDER BY started_at DESC`, [unitId])).rows;
}

/** Rule 3: attempt_no ≥ 2, or a component FAILED twice, with the (component, contractor, root
 *  cause) pattern from the snags those inspections raised. */
export async function listQaExceptions(projectId: string, ctx: Ctx) {
  await authorize(ctx, "unit_readiness", "READ");
  const r = await db.query<{
    id: string; unit_id: string; unit_number: string; component_code: string; kind: string; status: string; attempt_no: number; failure_reason: string | null;
    failures_on_component: number; contractors: string[] | null; root_causes: string[] | null;
  }>(
    `WITH fails AS (
       SELECT unit_id, component_code, COUNT(*) FILTER (WHERE status = 'FAILED')::int AS failures
         FROM qa_inspection WHERE project_id = $1 AND kind <> 'SITE_DECLARATION' GROUP BY unit_id, component_code
     )
     SELECT i.id, i.unit_id, u.unit_number, i.component_code, i.kind, i.status, i.attempt_no, i.failure_reason,
            f.failures AS failures_on_component,
            (SELECT array_agg(DISTINCT c.name) FROM snag s JOIN contractor c ON c.id = s.contractor_id
              WHERE s.unit_id = i.unit_id AND s.inspection_id IN (SELECT id FROM qa_inspection WHERE unit_id = i.unit_id AND component_code = i.component_code)) AS contractors,
            (SELECT array_agg(DISTINCT s.root_cause) FROM snag s
              WHERE s.root_cause IS NOT NULL AND s.inspection_id IN (SELECT id FROM qa_inspection WHERE unit_id = i.unit_id AND component_code = i.component_code)) AS root_causes
       FROM qa_inspection i
       JOIN unit u ON u.id = i.unit_id
       JOIN fails f ON f.unit_id = i.unit_id AND f.component_code = i.component_code
      WHERE i.project_id = $1 AND i.kind <> 'SITE_DECLARATION' AND (i.attempt_no >= 2 OR f.failures >= 2)
        AND i.id = (SELECT id FROM qa_inspection x WHERE x.unit_id = i.unit_id AND x.component_code = i.component_code AND x.kind <> 'SITE_DECLARATION' ORDER BY started_at DESC LIMIT 1)
      ORDER BY f.failures DESC, i.attempt_no DESC, u.unit_number`,
    [projectId]
  );
  return r.rows.map((row) => ({
    ...row,
    pattern: { component: row.component_code, contractors: row.contractors ?? [], root_causes: row.root_causes ?? [] },
  }));
}

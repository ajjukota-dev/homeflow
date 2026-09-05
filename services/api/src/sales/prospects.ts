import { randomUUID } from "node:crypto";
import { db } from "../db";
import { appendEvent, withTx, actorFields, type DbLike } from "../events";
import { requireRole, STAFF_ROLES } from "../authz/requireRole";
import { AppError, type Ctx } from "../authz/types";
import { nextCode } from "../model/codes";
import { evaluateUnit } from "../changeability/core";
import { computeMatch, type Importance, type MatchNeed } from "./match";
import { loadSalesPolicy } from "./policy";

// 24-sales-inventory-discovery.md: prospects, personalisation needs (rule 4 inputs), persisted
// requirement matches (rule 5) and lost-deal analytics (rule 9).

const SALES_WRITE_ROLES = ["SALES", "MANAGEMENT", "SUPER_ADMIN"];
const IMPORTANCES: Importance[] = ["MUST_HAVE", "PREFERRED", "NOT_IMPORTANT"];

export interface ProspectRow {
  id: string; code: string; project_id: string; name: string; phone: string | null; email: string | null; source: string | null;
  sales_owner_user_id: string | null; status: "ACTIVE" | "BOOKED" | "LOST"; lost_reason: string | null; customer_id: string | null; created_at: string;
}
const SELECT = `SELECT id, code, project_id, name, phone, email, source, sales_owner_user_id, status, lost_reason, customer_id, created_at::text AS created_at FROM prospect`;

export async function loadProspect(id: string, tx: DbLike = db): Promise<ProspectRow> {
  const r = await tx.query<ProspectRow>(`${SELECT} WHERE id = $1`, [id]);
  if (!r.rows[0]) throw new AppError("not_found", "prospect not found");
  return r.rows[0];
}

export async function listProspects(projectId: string, status: string | undefined, ctx: Ctx): Promise<ProspectRow[]> {
  requireRole(ctx, STAFF_ROLES);
  const r = await db.query<ProspectRow>(`${SELECT} WHERE project_id = $1 ${status ? "AND status = $2" : ""} ORDER BY created_at DESC`, status ? [projectId, status.toUpperCase()] : [projectId]);
  return r.rows;
}

export async function getProspect(id: string, ctx: Ctx): Promise<ProspectRow & { needs: MatchNeed[] }> {
  requireRole(ctx, STAFF_ROLES);
  const p = await loadProspect(id);
  return { ...p, needs: await needsForProspect(id) };
}

export async function createProspect(input: { project_id: string; name: string; phone?: string | null; email?: string | null; source?: string | null }, ctx: Ctx): Promise<ProspectRow> {
  requireRole(ctx, SALES_WRITE_ROLES);
  if (!input.project_id || !input.name?.trim()) throw new AppError("validation", "project_id and name are required");
  const id = "prs_" + randomUUID().slice(0, 8);
  await withTx(undefined, async (tx) => {
    const code = await nextCode(tx, "PRS");
    await tx.query(
      `INSERT INTO prospect (id, code, project_id, name, phone, email, source, sales_owner_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, code, input.project_id, input.name.trim(), input.phone ?? null, input.email ?? null, input.source ?? null, ctx.actor.user_id]
    );
    await appendEvent(tx, { type: "prospect.created", entity_type: "prospect", entity_id: id, project_id: input.project_id, payload: { code, source: input.source ?? null }, ...actorFields(ctx) });
  });
  return loadProspect(id);
}

export async function needsForProspect(prospectId: string, tx: DbLike = db): Promise<MatchNeed[]> {
  const r = await tx.query<MatchNeed>(`SELECT category_code, importance, note FROM prospect_personalisation_need WHERE prospect_id = $1 ORDER BY category_code`, [prospectId]);
  return r.rows;
}

/** PUT: the complete needs list (Must Have / Preferred / Not Important per category). */
export async function putNeeds(prospectId: string, needs: MatchNeed[], ctx: Ctx): Promise<MatchNeed[]> {
  requireRole(ctx, SALES_WRITE_ROLES);
  const p = await loadProspect(prospectId);
  if (!Array.isArray(needs)) throw new AppError("validation", "needs must be a list", "needs");
  for (const n of needs) {
    if (!IMPORTANCES.includes(n.importance)) throw new AppError("validation", `invalid importance ${n.importance}`, "needs");
    const cat = await db.query<{ code: string }>(`SELECT code FROM change_category WHERE code = $1`, [n.category_code]);
    if (!cat.rows[0]) throw new AppError("validation", `unknown category ${n.category_code}`, "needs");
  }
  await withTx(undefined, async (tx) => {
    await tx.query(`DELETE FROM prospect_personalisation_need WHERE prospect_id = $1`, [prospectId]);
    for (const n of needs) {
      await tx.query(
        `INSERT INTO prospect_personalisation_need (id, prospect_id, category_code, importance, note, captured_by) VALUES ($1,$2,$3,$4,$5,$6)`,
        ["need_" + randomUUID().slice(0, 8), prospectId, n.category_code, n.importance, n.note ?? null, ctx.actor.user_id]
      );
    }
    await tx.query(`UPDATE prospect SET updated_at = now() WHERE id = $1`, [prospectId]);
    await appendEvent(tx, { type: "need.captured", entity_type: "prospect", entity_id: prospectId, project_id: p.project_id, payload: { needs: needs.map((n) => `${n.category_code}:${n.importance}`) }, ...actorFields(ctx) });
    // Needs changed → every stored match for this prospect is stale; recompute eagerly.
    const units = await tx.query<{ unit_id: string }>(`SELECT unit_id FROM unit_requirement_match WHERE prospect_id = $1`, [prospectId]);
    for (const u of units.rows) await computeAndStoreMatch(prospectId, u.unit_id, tx);
  });
  return needsForProspect(prospectId);
}

export interface StoredMatch { prospect_id: string; unit_id: string; score: number; explanation: unknown[]; disclaimer: string; computed_at: string; freshness: "FRESH" | "STALE" | "VERIFICATION_REQUIRED" }

/** Rule 4 over live 08 gates, persisted for rule 5. Internal — no ctx gate — so 08's subscriber can call it. */
export async function computeAndStoreMatch(prospectId: string, unitId: string, tx: DbLike = db): Promise<StoredMatch> {
  const p = await loadProspect(prospectId, tx);
  const policy = await loadSalesPolicy(p.project_id, tx);
  const needs = await needsForProspect(prospectId, tx);
  const matrix = await evaluateUnit(unitId, { trigger: "read", tx });
  const m = computeMatch(needs, matrix.gates.map((g) => ({ category_code: g.category_code, customer_label: g.customer_label, state: g.state, reason_text: g.reason_text, expected_close_at: g.expected_close_at, freshness_status: g.freshness_status })), policy);
  await tx.query(
    `INSERT INTO unit_requirement_match (prospect_id, unit_id, score, explanation, computed_at) VALUES ($1,$2,$3,$4::jsonb,now())
     ON CONFLICT (prospect_id, unit_id) DO UPDATE SET score = $3, explanation = $4::jsonb, computed_at = now()`,
    [prospectId, unitId, m.score, JSON.stringify(m.explanation)]
  );
  await appendEvent(tx, { type: "match.computed", entity_type: "prospect", entity_id: prospectId, project_id: p.project_id, unit_id: unitId, payload: { score: m.score, stale_inputs: m.stale_inputs } });
  return { prospect_id: prospectId, unit_id: unitId, score: m.score, explanation: m.explanation, disclaimer: m.disclaimer, computed_at: new Date().toISOString(), freshness: m.stale_inputs ? "VERIFICATION_REQUIRED" : "FRESH" };
}

/** GET /prospects/:id/matches?unit_ids — computes (and stores) for the requested units, else
 *  returns the stored set with rule 5's staleness derived at read. */
export async function getMatches(prospectId: string, unitIds: string[] | undefined, ctx: Ctx): Promise<StoredMatch[]> {
  requireRole(ctx, STAFF_ROLES);
  const p = await loadProspect(prospectId);
  if (unitIds && unitIds.length > 0) {
    const out: StoredMatch[] = [];
    for (const u of unitIds) out.push(await withTx(undefined, (tx) => computeAndStoreMatch(prospectId, u, tx)));
    return out.sort((a, b) => b.score - a.score);
  }
  const policy = await loadSalesPolicy(p.project_id);
  const r = await db.query<{ unit_id: string; score: number; explanation: unknown[]; computed_at: string; age_hours: number }>(
    `SELECT unit_id, score, explanation, computed_at::text AS computed_at, EXTRACT(EPOCH FROM (now() - computed_at)) / 3600 AS age_hours
       FROM unit_requirement_match WHERE prospect_id = $1 ORDER BY score DESC`,
    [prospectId]
  );
  return r.rows.map((m) => ({
    prospect_id: prospectId, unit_id: m.unit_id, score: m.score, explanation: m.explanation, disclaimer: "Compatibility reflects current site status and is not an engineering approval.",
    computed_at: m.computed_at, freshness: Number(m.age_hours) > policy.match_stale_hours ? "STALE" : "FRESH",
  }));
}

/** Rule 5's trigger: a gate moved on a unit → recompute for every active prospect holding a stored match on it. */
export async function recomputeMatchesForUnit(unitId: string): Promise<number> {
  const r = await db.query<{ prospect_id: string }>(
    `SELECT m.prospect_id FROM unit_requirement_match m JOIN prospect p ON p.id = m.prospect_id WHERE m.unit_id = $1 AND p.status = 'ACTIVE'`,
    [unitId]
  );
  for (const row of r.rows) await withTx(undefined, (tx) => computeAndStoreMatch(row.prospect_id, unitId, tx));
  return r.rows.length;
}

/** Rule 9: lost prospects keep their needs. */
export async function markProspectLost(id: string, reason: string, ctx: Ctx): Promise<ProspectRow> {
  requireRole(ctx, SALES_WRITE_ROLES);
  if (!reason?.trim()) throw new AppError("validation", "reason is required", "reason");
  const p = await loadProspect(id);
  if (p.status !== "ACTIVE") throw new AppError("conflict", `prospect is ${p.status}`);
  await db.query(`UPDATE prospect SET status = 'LOST', lost_reason = $2, updated_at = now() WHERE id = $1`, [id, reason.trim()]);
  return loadProspect(id);
}

export async function lostRequirementAnalytics(projectId: string, ctx: Ctx) {
  requireRole(ctx, STAFF_ROLES);
  const r = await db.query<{ category_code: string; importance: string; lost: number; total: number }>(
    `SELECT n.category_code, n.importance,
            COUNT(*) FILTER (WHERE p.status = 'LOST')::int AS lost, COUNT(*)::int AS total
       FROM prospect_personalisation_need n JOIN prospect p ON p.id = n.prospect_id
      WHERE p.project_id = $1 GROUP BY n.category_code, n.importance ORDER BY lost DESC, total DESC`,
    [projectId]
  );
  const totals = await db.query<{ lost: number; total: number }>(`SELECT COUNT(*) FILTER (WHERE status = 'LOST')::int AS lost, COUNT(*)::int AS total FROM prospect WHERE project_id = $1`, [projectId]);
  return { project_id: projectId, prospects: totals.rows[0]!, by_requirement: r.rows };
}

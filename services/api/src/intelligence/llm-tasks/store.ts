import { randomUUID } from "node:crypto";
import { db } from "../../db";
import { appendEvent, withTx } from "../../events";
import { requireRole, STAFF_ROLES } from "../../authz/requireRole";
import { AppError, type Ctx } from "../../authz/types";
import type { LlmCompleteResult } from "../../llm";

// 31-intelligence.md rule 5: "every call logs tokens/cost; a monthly budget cap (env) stops LLM
// tasks (features keep working rule-based)." `llm_call` (03) already logs every raw call
// unconditionally via the `llm` port's own `withLogging` wrapper — this budget check runs BEFORE
// that call, against the already-logged spend, so an exceeded budget means "don't place the call
// at all" rather than "place it and refuse to log it."
//
// No dedicated `permission_matrix` module exists for LLM suggestions (same gap class already
// logged for 27's `management_config`) — accept/reject gated on any staff role rather than
// inventing a matrix row nothing else populates yet.

async function monthlySpendInr(): Promise<number> {
  const r = await db.query<{ total: number }>(`SELECT COALESCE(SUM(cost_inr), 0)::float8 AS total FROM llm_call WHERE created_at >= date_trunc('month', now())`);
  return r.rows[0]?.total ?? 0;
}

/** Returns true if a new LLM call is within budget. Emits `llm.budget_exhausted` at most once per
 *  calendar month (checked against the event log itself) rather than on every over-budget call. */
export async function withinBudget(): Promise<boolean> {
  const raw = process.env.LLM_MONTHLY_BUDGET_INR;
  if (raw === undefined || raw === "") return true; // no cap configured — unlimited, matches dev/test default
  const cap = Number(raw);
  if (Number.isNaN(cap)) return true;
  const spend = await monthlySpendInr();
  if (spend < cap) return true;
  const already = await db.query(`SELECT 1 FROM event WHERE type = 'llm.budget_exhausted' AND occurred_at >= date_trunc('month', now()) LIMIT 1`);
  if (!already.rows[0]) {
    await withTx(undefined, async (tx) => {
      await appendEvent(tx, {
        type: "llm.budget_exhausted", entity_type: "llm_task", entity_id: "budget",
        payload: { spend_inr: spend, cap_inr: cap },
        actor_user_id: null, actor_kind: "SYSTEM",
      });
    });
  }
  return false;
}

export type LlmTaskKind = "COMMITMENT_DETECTION" | "COMMUNICATION_SUMMARY" | "SENTIMENT" | "DOCUMENT_FIELD_EXTRACTION" | "DOCUMENT_INCONSISTENCY" | "SNAG_ROOT_CAUSE_SUGGESTION";

export interface LlmTaskRow {
  id: string; kind: LlmTaskKind; input_ref: string; output: Record<string, unknown>; confidence: number | null;
  model: string; tokens: number; cost_inr: number; reviewed_by: string | null; accepted: boolean | null; at: string;
}
const SELECT = `SELECT id, kind, input_ref, output, confidence, model, tokens, cost_inr, reviewed_by, accepted, at::text AS at FROM llm_task`;

/** Records one LLM output as a suggestion — never applied to any business table until a human
 *  calls `acceptSuggestion` (rule 7). `result`/`purpose` come straight from the `llm` port's own
 *  `complete()` call, already logged to `llm_call` by that port's `withLogging` wrapper. */
export async function createSuggestion(kind: LlmTaskKind, inputRef: string, output: Record<string, unknown>, confidence: number | null, result: LlmCompleteResult): Promise<LlmTaskRow> {
  const id = "llmt_" + randomUUID().slice(0, 8);
  await withTx(undefined, async (tx) => {
    await tx.query(
      `INSERT INTO llm_task (id, kind, input_ref, output, confidence, model, tokens, cost_inr) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8)`,
      [id, kind, inputRef, JSON.stringify(output), confidence, process.env.OPENAI_MODEL ?? "fake", result.tokens, result.cost_inr]
    );
    await appendEvent(tx, {
      type: "llm.suggestion_created", entity_type: "llm_task", entity_id: id, payload: { kind, input_ref: inputRef },
      actor_user_id: null, actor_kind: "SYSTEM",
    });
  });
  return loadSuggestion(id);
}

export async function loadSuggestion(id: string): Promise<LlmTaskRow> {
  const r = await db.query<LlmTaskRow>(`${SELECT} WHERE id = $1`, [id]);
  if (!r.rows[0]) throw new AppError("not_found", "not_found");
  return r.rows[0];
}

export async function listSuggestions(kind: LlmTaskKind | undefined, accepted: boolean | undefined, ctx: Ctx): Promise<LlmTaskRow[]> {
  requireRole(ctx, STAFF_ROLES);
  const conds: string[] = [];
  const params: unknown[] = [];
  if (kind) { params.push(kind); conds.push(`kind = $${params.length}`); }
  if (accepted !== undefined) { params.push(accepted); conds.push(`accepted = $${params.length}`); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const r = await db.query<LlmTaskRow>(`${SELECT} ${where} ORDER BY at DESC`, params);
  return r.rows;
}

/** rule 7's accept/reject — marks the row reviewed and fires the matching event. Does NOT apply
 *  the suggestion to any business table itself (e.g. creating a commitment); each LLM-task module
 *  performs its own kind-specific apply step after calling this, inside its own transaction. */
export async function reviewSuggestion(id: string, decision: "accepted" | "rejected", ctx: Ctx): Promise<LlmTaskRow> {
  requireRole(ctx, STAFF_ROLES);
  const task = await loadSuggestion(id);
  if (task.accepted !== null) throw new AppError("conflict", "already reviewed");
  await withTx(undefined, async (tx) => {
    await tx.query(`UPDATE llm_task SET accepted = $2, reviewed_by = $3 WHERE id = $1`, [id, decision === "accepted", ctx.actor.user_id]);
    await appendEvent(tx, {
      type: decision === "accepted" ? "llm.suggestion_accepted" : "llm.suggestion_rejected",
      entity_type: "llm_task", entity_id: id, payload: { kind: task.kind },
      actor_user_id: ctx.actor.user_id, actor_kind: "USER",
    });
  });
  return loadSuggestion(id);
}

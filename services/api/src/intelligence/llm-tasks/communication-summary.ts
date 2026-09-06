import { db } from "../../db";
import { llm } from "../../llm";
import { AppError, type Ctx } from "../../authz/types";
import { withinBudget, createSuggestion, reviewSuggestion, loadSuggestion, type LlmTaskRow } from "./store";

// 31-intelligence.md rule 5, 2nd bullet: "Communication summary & sentiment (29) — stored as
// suggestions; ... only accepted values feed scores (explainability)." `communication.sentiment`/
// `.summary` are real columns 29's own migration already declared "31, unused until built" — this
// is that build. Accepting writes straight into those columns (a single UPDATE, no withTx needed)
// so `intelligence/customer-health.ts`'s own `SELECT ... WHERE sentiment = 'NEGATIVE'` query reads
// only human-reviewed values, never raw LLM output — the explainability rule enforced by which
// column gets written, not by a runtime check.

async function loadBody(communicationId: string): Promise<string> {
  const r = await db.query<{ body: string }>(`SELECT body FROM communication WHERE id = $1`, [communicationId]);
  if (!r.rows[0]) throw new AppError("not_found", "communication not found");
  return r.rows[0].body;
}

export async function createSummarySuggestion(communicationId: string): Promise<LlmTaskRow> {
  if (!(await withinBudget())) throw new AppError("conflict", "LLM monthly budget exhausted for this month — rule-based features are unaffected");
  const body = await loadBody(communicationId);
  const result = await llm.complete({
    system: "Summarize this customer communication in one sentence, for an internal staff reader. Facts only, no speculation.",
    user: body,
    json_schema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] },
    purpose: "communication_summary",
  });
  const output = (result.json ?? {}) as Record<string, unknown>;
  return createSuggestion("COMMUNICATION_SUMMARY", communicationId, output, null, result);
}

export async function createSentimentSuggestion(communicationId: string): Promise<LlmTaskRow> {
  if (!(await withinBudget())) throw new AppError("conflict", "LLM monthly budget exhausted for this month — rule-based features are unaffected");
  const body = await loadBody(communicationId);
  const result = await llm.complete({
    system: "Classify the customer's sentiment in this communication as exactly one of POSITIVE, NEUTRAL, NEGATIVE.",
    user: body,
    json_schema: { type: "object", properties: { sentiment: { type: "string", enum: ["POSITIVE", "NEUTRAL", "NEGATIVE"] }, confidence: { type: "number" } }, required: ["sentiment"] },
    purpose: "sentiment",
  });
  const output = (result.json ?? {}) as Record<string, unknown>;
  const confidence = typeof output.confidence === "number" ? output.confidence : null;
  return createSuggestion("SENTIMENT", communicationId, output, confidence, result);
}

async function applyAndReview(id: string, ctx: Ctx, column: "summary" | "sentiment", override: string | undefined, expectedKind: "COMMUNICATION_SUMMARY" | "SENTIMENT"): Promise<LlmTaskRow> {
  const task = await loadSuggestion(id);
  if (task.kind !== expectedKind) throw new AppError("validation", `not a ${expectedKind.toLowerCase()} suggestion`);
  const value = override ?? (task.output[column] as string | undefined);
  if (!value) throw new AppError("validation", `no ${column} value to accept — pass an override`);
  await db.query(`UPDATE communication SET ${column} = $2 WHERE id = $1`, [task.input_ref, value]);
  return reviewSuggestion(id, "accepted", ctx);
}

export async function acceptSummary(id: string, ctx: Ctx, override?: string): Promise<LlmTaskRow> {
  return applyAndReview(id, ctx, "summary", override, "COMMUNICATION_SUMMARY");
}

export async function acceptSentiment(id: string, ctx: Ctx, override?: string): Promise<LlmTaskRow> {
  return applyAndReview(id, ctx, "sentiment", override, "SENTIMENT");
}

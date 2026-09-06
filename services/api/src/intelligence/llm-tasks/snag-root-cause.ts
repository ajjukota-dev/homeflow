import { db } from "../../db";
import { llm } from "../../llm";
import { AppError, type Ctx } from "../../authz/types";
import { withinBudget, createSuggestion, reviewSuggestion, loadSuggestion, type LlmTaskRow } from "./store";

// 31-intelligence.md rule 5, 4th bullet: "Snag root-cause suggestion (15) from description +
// photos (text only initially)." `snag.root_cause` IS a real, writable column — added by 15's own
// migration (0032_qa.sql), alongside `room`/`category` (both real too, contrary to a claim in 30's
// own `post-handover/warranty.ts` header comment that snag "has no room field" — checked the
// actual schema before writing this, found that claim stale; logged in TODO.md rather than
// silently reopening spec 30's landed PR to fix a comment). Accepting a suggestion here writes the
// human-reviewed root cause into `snag.root_cause` directly — a single UPDATE, no withTx needed,
// same "write only on accept" discipline as `communication-summary.ts`'s own sentiment/summary
// columns. Photos are out of scope per the spec's own "(text only initially)".

export async function createRootCauseSuggestion(snagId: string): Promise<LlmTaskRow> {
  if (!(await withinBudget())) throw new AppError("conflict", "LLM monthly budget exhausted for this month — rule-based features are unaffected");
  const snag = await db.query<{ description: string; trade: string; location: string; severity: string }>(
    `SELECT description, trade, location, severity FROM snag WHERE id = $1`,
    [snagId]
  );
  if (!snag.rows[0]) throw new AppError("not_found", "snag not found");

  const result = await llm.complete({
    system: "You suggest a likely root cause for a construction QA snag, from its description alone (no photos). Be specific and grounded only in the text given — never invent facts not present in it.",
    user: `trade: ${snag.rows[0].trade}; location: ${snag.rows[0].location}; severity: ${snag.rows[0].severity}; description: ${snag.rows[0].description}`,
    json_schema: { type: "object", properties: { root_cause: { type: "string" }, confidence: { type: "number" } }, required: ["root_cause"] },
    purpose: "snag_root_cause",
  });
  const output = (result.json ?? {}) as Record<string, unknown>;
  const confidence = typeof output.confidence === "number" ? output.confidence : null;
  return createSuggestion("SNAG_ROOT_CAUSE_SUGGESTION", snagId, output, confidence, result);
}

export async function acceptRootCauseSuggestion(id: string, ctx: Ctx, override?: string): Promise<LlmTaskRow> {
  const task = await loadSuggestion(id);
  if (task.kind !== "SNAG_ROOT_CAUSE_SUGGESTION") throw new AppError("validation", "not a snag-root-cause suggestion");
  const rootCause = override ?? (task.output.root_cause as string | undefined);
  if (!rootCause) throw new AppError("validation", "no root_cause value to accept — pass an override");
  await db.query(`UPDATE snag SET root_cause = $2 WHERE id = $1`, [task.input_ref, rootCause]);
  return reviewSuggestion(id, "accepted", ctx);
}

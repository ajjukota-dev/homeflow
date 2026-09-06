import { db } from "../../db";
import { llm } from "../../llm";
import { createCommitment, type CreateCommitmentInput } from "../../commitments/core";
import { AppError, type Ctx } from "../../authz/types";
import { withinBudget, createSuggestion, reviewSuggestion, loadSuggestion, type LlmTaskRow } from "./store";

// 31-intelligence.md rule 5, 1st bullet: "Commitment detection on logged communications (29),
// proposes {description, category, due_date?, beneficiary} → CRM accepts/edits → 13 DRAFT
// commitment." Temperature 0, JSON-schema output (rule 5's own requirement). The proposal is
// never applied verbatim — `acceptCommitmentDetection` always takes CRM's own edited fields
// (rule 5's literal "accepts/edits"), not the raw LLM json, so the fake-adapter's `{fake: true,
// echo}` shape in tests never needs to resemble a real commitment.

const JSON_SCHEMA = {
  type: "object",
  properties: {
    description: { type: "string" },
    category: { type: "string", enum: ["MODIFICATION", "COMMERCIAL", "TIMELINE", "COMPLIMENTARY_ITEM", "SPECIFICATION_UPGRADE", "SERVICE", "OTHER"] },
    due_date: { type: ["string", "null"] },
    beneficiary: { type: "string", enum: ["CUSTOMER", "INTERNAL"] },
    confidence: { type: "number" },
  },
  required: ["description", "category", "beneficiary"],
};

export async function createCommitmentDetectionSuggestion(communicationId: string): Promise<LlmTaskRow> {
  if (!(await withinBudget())) throw new AppError("conflict", "LLM monthly budget exhausted for this month — rule-based features are unaffected");
  const c = await db.query<{ body: string; customer_id: string; booking_id: string | null }>(
    `SELECT body, customer_id, booking_id FROM communication WHERE id = $1`,
    [communicationId]
  );
  if (!c.rows[0]) throw new AppError("not_found", "communication not found");

  const result = await llm.complete({
    system: "You extract explicit promises a staff member made to a customer, from a logged communication. Return only a promise that was actually stated, never inferred beyond the text. If no promise was made, set description to an empty string.",
    user: c.rows[0].body,
    json_schema: JSON_SCHEMA,
    purpose: "commitment_detection",
  });
  const output = (result.json ?? {}) as Record<string, unknown>;
  const confidence = typeof output.confidence === "number" ? output.confidence : null;
  return createSuggestion("COMMITMENT_DETECTION", communicationId, output, confidence, result);
}

export async function acceptCommitmentDetection(id: string, edits: CreateCommitmentInput, ctx: Ctx): Promise<{ commitment_id: string }> {
  const task = await loadSuggestion(id);
  if (task.kind !== "COMMITMENT_DETECTION") throw new AppError("validation", "not a commitment-detection suggestion");
  const commitment = await createCommitment(edits, ctx); // its own withTx — never nested inside reviewSuggestion's
  await reviewSuggestion(id, "accepted", ctx);
  return { commitment_id: commitment.id };
}

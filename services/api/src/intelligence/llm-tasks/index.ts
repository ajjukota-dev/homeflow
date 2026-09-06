import { AppError, type Ctx } from "../../authz/types";
import { createCommitmentDetectionSuggestion, acceptCommitmentDetection } from "./commitment-detection";
import { createSummarySuggestion, createSentimentSuggestion, acceptSummary, acceptSentiment } from "./communication-summary";
import { createFieldExtractionSuggestion, createInconsistencySuggestion, acceptDocumentSuggestion } from "./document-intelligence";
import { createRootCauseSuggestion, acceptRootCauseSuggestion } from "./snag-root-cause";
import { listSuggestions, reviewSuggestion, loadSuggestion, type LlmTaskKind, type LlmTaskRow } from "./store";
import type { CreateCommitmentInput } from "../../commitments/core";

export type { LlmTaskKind, LlmTaskRow } from "./store";
export { listSuggestions, loadSuggestion } from "./store";

// Single dispatch point for `POST /llm/tasks {kind, input_ref}` (rule 5's own API shape) — each
// kind's real prompt/context-building lives in its own file; this just routes by kind, the same
// "one call site per line, config elsewhere" discipline `forecast/probability.ts::computeProbability`
// already established for its own dispatch.

export async function createTask(kind: LlmTaskKind, inputRef: string): Promise<LlmTaskRow> {
  switch (kind) {
    case "COMMITMENT_DETECTION": return createCommitmentDetectionSuggestion(inputRef);
    case "COMMUNICATION_SUMMARY": return createSummarySuggestion(inputRef);
    case "SENTIMENT": return createSentimentSuggestion(inputRef);
    case "DOCUMENT_FIELD_EXTRACTION": return createFieldExtractionSuggestion(inputRef);
    case "DOCUMENT_INCONSISTENCY": return createInconsistencySuggestion(inputRef);
    case "SNAG_ROOT_CAUSE_SUGGESTION": return createRootCauseSuggestion(inputRef);
  }
}

export interface AcceptBody {
  commitment?: CreateCommitmentInput; // required when accepting a COMMITMENT_DETECTION suggestion
  override?: string; // optional edited text for COMMUNICATION_SUMMARY/SENTIMENT/SNAG_ROOT_CAUSE_SUGGESTION
}

/** Rule 7's accept/reject — dispatches the kind-specific apply step (rule 5: "CRM accepts/edits"
 *  for commitments; a straight accept for the rest). Reject never applies anything, just marks
 *  the row reviewed via `reviewSuggestion` directly. */
export async function acceptTask(id: string, ctx: Ctx, body: AcceptBody): Promise<LlmTaskRow | { commitment_id: string }> {
  const task = await loadSuggestion(id);
  switch (task.kind) {
    case "COMMITMENT_DETECTION": {
      if (!body.commitment) throw new AppError("validation", "commitment (edited fields) is required to accept a commitment-detection suggestion", "commitment");
      return acceptCommitmentDetection(id, body.commitment, ctx);
    }
    case "COMMUNICATION_SUMMARY": return acceptSummary(id, ctx, body.override);
    case "SENTIMENT": return acceptSentiment(id, ctx, body.override);
    case "DOCUMENT_FIELD_EXTRACTION": return acceptDocumentSuggestion(id, ctx, "DOCUMENT_FIELD_EXTRACTION");
    case "DOCUMENT_INCONSISTENCY": return acceptDocumentSuggestion(id, ctx, "DOCUMENT_INCONSISTENCY");
    case "SNAG_ROOT_CAUSE_SUGGESTION": return acceptRootCauseSuggestion(id, ctx, body.override);
  }
}

export async function rejectTask(id: string, ctx: Ctx): Promise<LlmTaskRow> {
  return reviewSuggestion(id, "rejected", ctx);
}

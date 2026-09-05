// llm port (03-platform-deploy.md): provider-agnostic completion, logged
// to llm_call (purpose, tokens, cost) on every call. Rules-first — this is
// only reached where the PDF says AI (p18 §10).

export interface LlmCompleteInput {
  system: string;
  user: string;
  json_schema?: object;
  purpose: string; // logged to llm_call — which feature/decision this call served
}

export interface LlmCompleteResult {
  text?: string;
  json?: unknown;
  tokens: number;
  cost_inr: number;
}

export interface LlmPort {
  complete(input: LlmCompleteInput): Promise<LlmCompleteResult>;
}

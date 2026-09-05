import type { LlmCompleteInput, LlmCompleteResult, LlmPort } from "./types";

// Test adapter: deterministic, no network, zero cost.
export function createFakeLlmAdapter(): LlmPort {
  return {
    async complete(input: LlmCompleteInput): Promise<LlmCompleteResult> {
      const tokens = input.system.length + input.user.length;
      if (input.json_schema) {
        return { json: { fake: true, echo: input.user }, tokens, cost_inr: 0 };
      }
      return { text: `fake-response-to: ${input.user}`, tokens, cost_inr: 0 };
    },
  };
}

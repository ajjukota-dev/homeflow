import { randomUUID } from "node:crypto";
import { db } from "../db";
import { createFakeLlmAdapter } from "./fake-adapter";
import { createOpenAiAdapter } from "./openai-adapter";
import type { LlmPort } from "./types";

export type { LlmCompleteInput, LlmCompleteResult, LlmPort } from "./types";
export { costInr } from "./pricing";

function baseAdapter(): LlmPort {
  const apiKey = process.env.OPENAI_API_KEY;
  return apiKey ? createOpenAiAdapter(apiKey) : createFakeLlmAdapter();
}

// Every call logged to llm_call (03-platform-deploy.md) regardless of
// adapter, so the fake adapter's zero-cost calls show up in tests too.
function withLogging(adapter: LlmPort): LlmPort {
  return {
    async complete(input) {
      const result = await adapter.complete(input);
      await db.query(`INSERT INTO llm_call (id, purpose, model, tokens, cost_inr) VALUES ($1,$2,$3,$4,$5)`, [
        randomUUID(),
        input.purpose,
        process.env.OPENAI_MODEL ?? "fake",
        result.tokens,
        result.cost_inr,
      ]);
      return result;
    },
  };
}

export const llm: LlmPort = withLogging(baseAdapter());

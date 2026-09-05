import OpenAI from "openai";
import { costInr } from "./pricing";
import type { LlmCompleteInput, LlmCompleteResult, LlmPort } from "./types";

const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

// Prod adapter (Amarsh's OpenAI key — 03-platform-deploy.md, TODO §7 #9).
export function createOpenAiAdapter(apiKey: string): LlmPort {
  const client = new OpenAI({ apiKey });
  return {
    async complete(input: LlmCompleteInput): Promise<LlmCompleteResult> {
      const response = await client.chat.completions.create({
        model: MODEL,
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user },
        ],
        response_format: input.json_schema ? { type: "json_object" } : undefined,
      });

      const content = response.choices[0]?.message.content ?? "";
      const inputTokens = response.usage?.prompt_tokens ?? 0;
      const outputTokens = response.usage?.completion_tokens ?? 0;
      const result = { tokens: inputTokens + outputTokens, cost_inr: costInr(inputTokens, outputTokens) };

      return input.json_schema ? { ...result, json: JSON.parse(content) } : { ...result, text: content };
    },
  };
}

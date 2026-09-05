import { describe, expect, it } from "vitest";
import { db, initDb } from "../db";
import { llm } from "./index";

// S8 acceptance spike (03-platform-deploy.md): one call classified through
// the llm port, logged to llm_call with tokens and cost. No OPENAI_API_KEY
// is set in the test env, so this exercises the real llm.complete() ->
// withLogging() -> fake adapter path end to end against the DB port.
describe("llm port — logging", () => {
  it("logs purpose, tokens and cost to llm_call on every completion", async () => {
    await initDb();

    const result = await llm.complete({
      system: "Classify this communication into a commitment candidate.",
      user: "Customer said they will pay the structure demand by Friday.",
      purpose: "commitment_candidate_classification",
    });
    expect(result.tokens).toBeGreaterThan(0);
    expect(result.cost_inr).toBe(0);

    const { rows } = await db.query<{ purpose: string; tokens: number; cost_inr: string }>(
      `SELECT purpose, tokens, cost_inr FROM llm_call WHERE purpose = 'commitment_candidate_classification'`
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].tokens).toBeGreaterThan(0);
  });
});

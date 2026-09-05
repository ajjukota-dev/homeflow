// gpt-4o-mini published pricing (USD per 1M tokens). USD_TO_INR is an
// [ours] fixed approximation, not a live FX rate — good enough for the
// llm_call cost column to be directionally right; revisit if this needs
// to reconcile against an actual OpenAI invoice.
const PRICE_PER_1M_INPUT_USD = 0.15;
const PRICE_PER_1M_OUTPUT_USD = 0.6;
const USD_TO_INR = 83;

export function costInr(inputTokens: number, outputTokens: number): number {
  const usd =
    (inputTokens / 1_000_000) * PRICE_PER_1M_INPUT_USD + (outputTokens / 1_000_000) * PRICE_PER_1M_OUTPUT_USD;
  return Math.round(usd * USD_TO_INR * 10_000) / 10_000;
}

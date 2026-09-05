import type { DbLike } from "../events";

// Human ids PREFIX-000001 from a per-prefix atomic sequence (00-conventions.md "Codes";
// 04 §Data: BKG-000001 / CUS- / UNT-). Must run inside the caller's transaction (`tx`) so a
// rolled-back mutation doesn't burn a code — sequence gaps are fine, reused codes are not.
export async function nextCode(tx: DbLike, prefix: string): Promise<string> {
  const r = await tx.query<{ next_value: string }>(
    `INSERT INTO code_sequence (prefix, next_value) VALUES ($1, 2)
     ON CONFLICT (prefix) DO UPDATE SET next_value = code_sequence.next_value + 1
     RETURNING (next_value - 1)::text AS next_value`,
    [prefix]
  );
  return `${prefix}-${r.rows[0].next_value.padStart(6, "0")}`;
}

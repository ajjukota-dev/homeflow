import { query } from "../db";
import { effectiveLevel } from "./authorize";
import { levelAtLeast, type Level } from "./levels";
import type { Ctx } from "./types";

// Rule 6: one place nulls fields whose field_sensitivity.min_level exceeds the
// actor's level for that module — never a per-handler branch. Nested rows
// (Emergent's `milestones`/`payments`/`events`/`schedule.milestones`,
// emergent-business-rules.md §1.5) are masked one level deep.
const NESTED_ARRAY_KEYS = ["milestones", "payments", "events"];

interface SensitivityRow {
  field: string;
  min_level: Level;
}

function unsuffixedTwin(field: string): string | null {
  return field.endsWith("_inr") ? field.slice(0, -4) : null;
}

function maskFieldsInPlace(row: Record<string, unknown>, sensitivity: SensitivityRow[], actorLevel: Level): void {
  for (const s of sensitivity) {
    if (levelAtLeast(actorLevel, s.min_level)) continue;
    if (s.field in row) row[s.field] = null;
    const twin = unsuffixedTwin(s.field);
    if (twin && twin in row) row[twin] = null;
  }
  for (const key of NESTED_ARRAY_KEYS) {
    const value = row[key];
    if (Array.isArray(value)) {
      row[key] = value.map((item) => {
        if (!item || typeof item !== "object") return item;
        const itemCopy = { ...(item as Record<string, unknown>) };
        maskFieldsInPlace(itemCopy, sensitivity, actorLevel);
        return itemCopy;
      });
    }
  }
  const schedule = row["schedule"];
  if (schedule && typeof schedule === "object" && Array.isArray((schedule as Record<string, unknown>).milestones)) {
    const scheduleCopy = { ...(schedule as Record<string, unknown>) };
    scheduleCopy.milestones = (scheduleCopy.milestones as unknown[]).map((item) => {
      if (!item || typeof item !== "object") return item;
      const itemCopy = { ...(item as Record<string, unknown>) };
      maskFieldsInPlace(itemCopy, sensitivity, actorLevel);
      return itemCopy;
    });
    row["schedule"] = scheduleCopy;
  }
}

/** Rule 6: mask financial/PII fields on `row` for `module` per the actor's effective level. */
export async function mask<T extends Record<string, unknown>>(ctx: Ctx, module: string, row: T): Promise<T> {
  const [actorLevel, sensRows] = await Promise.all([
    effectiveLevel(ctx.actor.roles, module),
    query<SensitivityRow>(`SELECT field, min_level FROM field_sensitivity WHERE module = $1`, [module]),
  ]);
  const copy: Record<string, unknown> = { ...row };
  maskFieldsInPlace(copy, sensRows.rows, actorLevel);
  return copy as T;
}

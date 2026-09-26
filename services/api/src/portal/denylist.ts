// 26-customer-portal.md rule 2: "projection, not permission" — the portal API never returns raw
// internal rows. This is the shared enforcement mechanism: every portal.test.ts area test runs its
// response through `assertNoDenylistedKeys`, which walks the FULL object tree (not just top-level
// keys) so a nested internal field can't sneak in through a joined sub-object either.

export const CUSTOMER_DENYLIST = [
  "owner_user_id",
  "owner_role",
  "reason_code",
  "root_cause",
  "vendor",
  "contractor",
  "internal_note",
  "internal_notes",
  "before_note",
  "after_note",
  "verifier_role",
  "approver_role",
  "raised_by_user_id",
  "created_by",
  "changed_by",
  "actor_user_id",
  "sla_clock_id",
  "gate_summary_at_request",
  "data_snapshot",
  "selected_clauses",
] as const;

// `forecast_*` is denylisted by prefix, not exact match (p18 §11 "unapproved forecasts") — any
// key starting with it must never appear unless the caller has explicitly published it elsewhere
// (this codebase has no such path yet, so today it's a flat ban within portal responses).
const FORECAST_PREFIX = "forecast_";

// Exact names miss close spellings (`vendor` does not stop `vendor_contact`,
// `internal_notes` does not stop `internal_notes_v2`). A key is blocked when it
// equals a denylisted name or continues it with `_…`, plus the forecast_ prefix.
function isDenylisted(key: string): boolean {
  const normalized = key.toLowerCase();
  if (normalized.startsWith(FORECAST_PREFIX)) return true;
  return (CUSTOMER_DENYLIST as readonly string[]).some(
    (name) => normalized === name || normalized.startsWith(`${name}_`)
  );
}

/** Walks `value` recursively (objects, arrays) and throws on the first denylisted key found
 *  anywhere in the tree. Used both by tests (proving a real projection is clean) and can be
 *  wrapped around any new projection during development to catch a leak before it ships. */
export function assertNoDenylistedKeys(value: unknown, path = "$"): void {
  if (value === null || value === undefined || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoDenylistedKeys(v, `${path}[${i}]`));
    return;
  }
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (isDenylisted(key)) throw new Error(`denylisted key "${key}" found at ${path}.${key}`);
    assertNoDenylistedKeys(v, `${path}.${key}`);
  }
}

/** Drop denylisted keys anywhere in a customer payload. Safe fields are kept. */
export function redactDenylisted<T>(value: T): T {
  if (value === null || value === undefined || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => redactDenylisted(item)) as T;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isDenylisted(key)) continue;
    out[key] = redactDenylisted(child);
  }
  return out as T;
}

export function hasDenylistedKeys(value: unknown): boolean {
  try {
    assertNoDenylistedKeys(value);
    return false;
  } catch {
    return true;
  }
}

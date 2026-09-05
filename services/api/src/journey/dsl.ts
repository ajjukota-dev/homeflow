// Conditional-stage/task expression DSL — spec 05 [E §2.5]: `^scope.field (==|!=|in|not in) value$`.
// Pure, framework-free (CLAUDE.md "explicit boundaries"). Fail-closed: an unparseable
// expression throws rather than defaulting to "always true"/"always false" — Emergent
// failed open on this (silently skipped bad conditions); the PDF asks for governed config,
// so a bad expression must block template publish (rule 6), not silently misbehave at runtime.

export type ConditionScope = "customer" | "booking" | "unit" | "project";
export type ConditionOp = "==" | "!=" | "in" | "not in";
export type ConditionValue = string | number | boolean | (string | number)[];

export interface ParsedCondition {
  scope: ConditionScope;
  field: string;
  op: ConditionOp;
  value: ConditionValue;
}

export class ConditionExprError extends Error {}

const SCOPES: ConditionScope[] = ["customer", "booking", "unit", "project"];
// "not in" must be tried before "in" or the regex would split "not in" on the bare "in".
const EXPR_PATTERN = /^([a-zA-Z_]+)\.([a-zA-Z_][a-zA-Z0-9_]*)\s+(==|!=|not in|in)\s+(.+)$/;

export function parseConditionExpr(expr: string): ParsedCondition {
  const trimmed = expr.trim();
  const match = EXPR_PATTERN.exec(trimmed);
  if (!match) throw new ConditionExprError(`unparseable condition expression: "${expr}"`);
  const [, scope, field, op, rawValue] = match;
  if (!SCOPES.includes(scope as ConditionScope)) {
    throw new ConditionExprError(`unknown scope "${scope}" in condition expression: "${expr}"`);
  }
  return { scope: scope as ConditionScope, field, op: op as ConditionOp, value: parseValue(rawValue.trim(), op as ConditionOp) };
}

function parseValue(raw: string, op: ConditionOp): ConditionValue {
  if (op === "in" || op === "not in") {
    if (!raw.startsWith("[") || !raw.endsWith("]")) {
      throw new ConditionExprError(`"${op}" requires a bracketed list, got: ${raw}`);
    }
    const inner = raw.slice(1, -1).trim();
    return inner === "" ? [] : inner.split(",").map((v) => parseScalar(v.trim()) as string | number);
  }
  return parseScalar(raw);
}

function parseScalar(raw: string): string | number | boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) return raw.slice(1, -1);
  // Bare identifier (e.g. an enum code like VILLA) is also a string literal — quoting is
  // optional for tokens that can't be mistaken for a number/boolean.
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(raw)) return raw;
  throw new ConditionExprError(`unparseable value: "${raw}"`);
}

/** Throws ConditionExprError on anything unparseable — the fail-closed publish gate (rule 6). */
export function validateConditionExpr(expr: string): void {
  parseConditionExpr(expr);
}

/** Evaluates a parsed condition against a scoped context, e.g.
 * { booking: { has_change_requests: true }, customer: {...}, unit: {...}, project: {...} }. */
export function evaluateCondition(expr: string, context: Partial<Record<ConditionScope, Record<string, unknown>>>): boolean {
  const { scope, field, op, value } = parseConditionExpr(expr);
  const actual = context[scope]?.[field];
  switch (op) {
    case "==":
      return actual === value;
    case "!=":
      return actual !== value;
    case "in":
      return Array.isArray(value) && value.includes(actual as string | number);
    case "not in":
      return Array.isArray(value) && !value.includes(actual as string | number);
  }
}

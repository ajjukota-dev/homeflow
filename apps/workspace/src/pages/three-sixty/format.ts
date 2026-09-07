// 28-360-views.md — small formatting helpers shared by TabPanel's generic renderer and the
// 360 overview screens (unit/booking/customer). No domain logic: just presentation of values
// whose shape belongs to another spec (rule "content of tabs is owned by their specs").
import { formatINR } from "../../ui/MoneyFigure";
import type { Score, ScoreDriver } from "./api";
import type { ScoreDriver as CardDriver } from "@homeflow/ui";

export function prettifyKey(key: string): string {
  return key
    .replace(/_inr$/, "")
    .replace(/_id$/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function looksLikeDate(key: string, value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (!/(_at|_date|date)$/i.test(key)) return false;
  return !Number.isNaN(Date.parse(value));
}

export function formatCell(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (looksLikeDate(key, value)) {
    return new Date(value as string).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  }
  if (typeof value === "number" && /amount|inr|price|cost|contribution/i.test(key)) return formatINR(value);
  if (typeof value === "number") return value.toLocaleString("en-IN");
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
  if (typeof value === "object") return "—";
  return String(value);
}

const HIDE_KEY = /^id$|_id$|payload$/i;
const PRIORITY = ["number", "code", "title", "name", "label", "status", "state", "category", "priority", "amount_inr", "reason", "description"];

/** Picks a small set of friendly columns from an unknown row shape — preferring human-facing
 *  fields (number/code/title/status/…) over raw ids, capped so a summary table stays scannable. */
export function pickColumns(rows: Record<string, unknown>[]): string[] {
  const allKeys = new Set<string>();
  for (const r of rows.slice(0, 20)) for (const k of Object.keys(r)) allKeys.add(k);
  const visible = [...allKeys].filter((k) => !HIDE_KEY.test(k));
  visible.sort((a, b) => {
    const ai = PRIORITY.findIndex((p) => a.includes(p));
    const bi = PRIORITY.findIndex((p) => b.includes(p));
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  return visible.slice(0, 6);
}

/** Adapts the shared 14-readiness-scores `Score` contract to `@homeflow/ui`'s `ScoreCard` — the
 *  first component in this codebase to actually render that contract on screen. */
export function scoreCardProps(score: Score): { value: string; trend: { direction: "up" | "down" | "flat"; label: string }; drivers: [CardDriver, CardDriver, CardDriver]; confidence: "high" | "medium" | "low" } {
  const top: ScoreDriver[] = [...score.drivers].sort((a, b) => b.contribution - a.contribution).slice(0, 3);
  while (top.length < 3) top.push({ code: "none", label: "No further drivers", contribution: 0, fact: "" });
  const drivers = top.map((d): CardDriver => ({ label: d.fact || d.label, impact: d.contribution > 0 ? "positive" : d.contribution < 0 ? "negative" : "neutral" })) as [CardDriver, CardDriver, CardDriver];
  return {
    value: `${Math.round(score.value)}`,
    trend: { direction: score.trend === "UP" ? "up" : score.trend === "DOWN" ? "down" : "flat", label: score.trend === "UP" ? "Improving" : score.trend === "DOWN" ? "Declining" : "Steady" },
    drivers,
    confidence: score.confidence.toLowerCase() as "high" | "medium" | "low",
  };
}

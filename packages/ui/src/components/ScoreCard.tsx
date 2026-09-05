import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "../lib/cn";
import { Button } from "./Button";

export interface ScoreDriver {
  label: string;
  impact: "positive" | "negative" | "neutral";
}

export interface ScoreCardAction {
  label: string;
  onClick: () => void;
}

export interface ScoreCardProps {
  label: string;
  value: string;
  trend?: { direction: "up" | "down" | "flat"; label: string };
  /** Exactly the explainability contract (p8 §6): value, trend, 3 drivers, confidence, actions. */
  drivers: [ScoreDriver, ScoreDriver, ScoreDriver];
  confidence: "high" | "medium" | "low";
  actions?: ScoreCardAction[];
  className?: string;
}

const TREND_ICON = { up: TrendingUp, down: TrendingDown, flat: Minus } as const;
const DRIVER_DOT = {
  positive: "bg-ok",
  negative: "bg-danger",
  neutral: "bg-fg-subtle",
} as const;

/** ScoreCard — a score with its "why" (drivers) and confidence, never a bare hero number.
 * No score ships without drivers/confidence/actions (spec: "No number without a why"). */
export function ScoreCard({ label, value, trend, drivers, confidence, actions, className }: ScoreCardProps) {
  const TrendIcon = trend ? TREND_ICON[trend.direction] : null;
  return (
    <div className={cn("rounded-card border border-line bg-surface p-4", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-ws-sm text-fg-muted">{label}</p>
        <span className="rounded-pill bg-surface-raised px-2 py-0.5 text-ws-xs text-fg-muted">
          {confidence} confidence
        </span>
      </div>
      <div className="mt-1 flex items-end gap-2">
        <span className="hf-tnum font-heading text-ws-xl font-semibold text-fg">{value}</span>
        {trend && TrendIcon ? (
          <span
            className={cn(
              "mb-1 inline-flex items-center gap-1 text-ws-xs font-medium",
              trend.direction === "up" && "text-ok",
              trend.direction === "down" && "text-danger",
              trend.direction === "flat" && "text-fg-muted",
            )}
          >
            <TrendIcon className="size-3.5" aria-hidden />
            {trend.label}
          </span>
        ) : null}
      </div>
      <ul className="mt-3 flex flex-col gap-1.5">
        {drivers.map((driver) => (
          <li key={driver.label} className="flex items-center gap-2 text-ws-sm text-fg-muted">
            <span className={cn("size-1.5 rounded-full", DRIVER_DOT[driver.impact])} aria-hidden />
            {driver.label}
          </li>
        ))}
      </ul>
      {actions?.length ? (
        <div className="mt-4 flex gap-2">
          {actions.map((action) => (
            <Button key={action.label} variant="secondary" size="sm" onClick={action.onClick}>
              {action.label}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

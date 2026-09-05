import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn";

/** Badge — a neutral label/count chip (tags, counters). For state, use StatusChip instead:
 * status is never colour alone, and Badge carries no icon slot for that reason. */
const badgeVariants = cva("inline-flex items-center rounded-pill px-2 py-0.5 text-ws-xs font-medium", {
  variants: {
    tone: {
      neutral: "bg-surface-raised text-fg-muted border border-line",
      accent: "bg-accent-soft text-accent",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

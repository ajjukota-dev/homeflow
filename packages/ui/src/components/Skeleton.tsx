import * as React from "react";
import { cn } from "../lib/cn";

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Shape hint so the skeleton reads as the content it stands in for. */
  variant?: "text" | "block" | "circle";
}

/** Skeleton — shaped like the content it replaces (never a bare spinner). Pair with
 * `skeletonCrossfade` from `motion.ts` to fade into the loaded content. */
export function Skeleton({ className, variant = "block", ...props }: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={cn(
        "animate-pulse bg-line/70",
        variant === "text" && "h-3.5 w-full rounded",
        variant === "block" && "h-20 w-full rounded-card",
        variant === "circle" && "size-10 rounded-full",
        className,
      )}
      {...props}
    />
  );
}

import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn";

/** Card — a solid surface container (subtle border + panel shadow, no glass). Added during the
 * R1 screen migration: docs/specs/32-design-system.md's original primitive list didn't include
 * a generic container, but every workspace page needs one. */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-card border border-line bg-surface shadow-panel", className)} {...props} />;
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 pt-5", className)} {...props} />;
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5", className)} {...props} />;
}

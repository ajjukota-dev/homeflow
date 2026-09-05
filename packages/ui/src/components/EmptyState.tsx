import type { LucideIcon } from "lucide-react";
import { cn } from "../lib/cn";
import { Button } from "./Button";

export interface EmptyStateAction {
  label: string;
  onClick: () => void;
}

export interface EmptyStateProps {
  icon?: LucideIcon;
  /** Message that names what's missing — never a generic "No data". */
  message: string;
  /** One action, per spec ("message + one action") — resist adding a second. */
  action?: EmptyStateAction;
  className?: string;
}

/** EmptyState — for a list/table with zero rows. `error` conditions use the same shape but the
 * caller should pass problem + recovery copy (see the Table `error` state for a paired example). */
export function EmptyState({ icon: Icon, message, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center gap-3 px-6 py-12 text-center", className)}>
      {Icon ? <Icon className="size-8 text-fg-subtle" aria-hidden /> : null}
      <p className="max-w-sm text-ws-body text-fg-muted">{message}</p>
      {action ? (
        <Button variant="secondary" size="sm" onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}

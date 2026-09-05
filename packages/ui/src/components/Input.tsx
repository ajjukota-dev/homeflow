import * as React from "react";
import { CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import { cn } from "../lib/cn";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Visual state beyond plain default/disabled — pairs with an icon, never colour alone. */
  status?: "error" | "success" | "loading";
}

const STATUS_ICON = { error: AlertCircle, success: CheckCircle2, loading: Loader2 } as const;
const STATUS_CLASS = {
  error: "border-danger focus-visible:outline-danger",
  success: "border-ok focus-visible:outline-ok",
  loading: "border-line",
} as const;

/** Input — text field with the seven control states. Use inside `Field` for label/hint/error. */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, status, disabled, ...props }, ref) => {
    const Icon = status ? STATUS_ICON[status] : null;
    return (
      <div className="relative">
        <input
          ref={ref}
          disabled={disabled}
          className={cn(
            "h-10 w-full rounded-control border border-line bg-surface px-3 text-ws-body text-fg",
            "placeholder:text-fg-subtle transition-colors duration-micro ease-ds-out",
            "hover:border-fg-subtle",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            "disabled:cursor-not-allowed disabled:bg-surface-raised disabled:text-fg-subtle disabled:opacity-70",
            status ? STATUS_CLASS[status] : "",
            Icon ? "pr-9" : "",
            className,
          )}
          {...props}
        />
        {Icon ? (
          <Icon
            className={cn(
              "pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2",
              status === "error" && "text-danger",
              status === "success" && "text-ok",
              status === "loading" && "animate-spin text-fg-muted",
            )}
            aria-hidden
          />
        ) : null}
      </div>
    );
  },
);
Input.displayName = "Input";

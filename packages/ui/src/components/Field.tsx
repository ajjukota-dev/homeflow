import * as React from "react";
import { cn } from "../lib/cn";

export interface FieldProps {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}

/** Field — label + hint/error + required marker wrapping one control (Input/Select/etc).
 * Renders the control's error state message; the control itself still needs `aria-invalid`. */
export function Field({ label, htmlFor, hint, error, required, className, children }: FieldProps) {
  const hintId = hint ? `${htmlFor}-hint` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-ws-sm font-medium text-fg">
        {label}
        {required ? (
          <span className="ml-0.5 text-danger" aria-hidden>
            *
          </span>
        ) : null}
      </label>
      {React.isValidElement(children)
        ? React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
            id: htmlFor,
            "aria-describedby": [hintId, errorId].filter(Boolean).join(" ") || undefined,
            "aria-invalid": error ? true : undefined,
            "aria-required": required || undefined,
          })
        : children}
      {error ? (
        <p id={errorId} className="text-ws-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-ws-xs text-fg-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

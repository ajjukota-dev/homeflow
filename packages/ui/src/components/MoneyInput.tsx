import * as React from "react";
import { cn } from "../lib/cn";

/** Formats a rupee amount with Indian digit grouping: 12345678 -> "1,23,45,678.00". */
export function formatInr(amount: number): string {
  const [whole, fraction = "00"] = Math.abs(amount).toFixed(2).split(".");
  const lastThree = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + lastThree : lastThree;
  return `${amount < 0 ? "-" : ""}${grouped}.${fraction}`;
}

function parseInr(raw: string): number {
  const cleaned = raw.replace(/[^0-9.-]/g, "");
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : 0;
}

export interface MoneyInputProps {
  id?: string;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  status?: "error" | "success";
  className?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "aria-required"?: boolean;
}

const STATUS_CLASS = {
  error: "border-danger focus-visible:outline-danger",
  success: "border-ok focus-visible:outline-ok",
} as const;

/** MoneyInput — ₹ amounts with Indian grouping, edits as plain digits while focused, formats on
 * blur (docs/specs/00-conventions.md: money numeric(14,2) INR). */
export const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(
  ({ value, onChange, disabled, status, className, ...aria }, ref) => {
    const [editing, setEditing] = React.useState(false);
    const [draft, setDraft] = React.useState(String(value));

    return (
      <div className={cn("relative", className)}>
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ws-body text-fg-muted">
          ₹
        </span>
        <input
          ref={ref}
          type="text"
          inputMode="decimal"
          disabled={disabled}
          value={editing ? draft : formatInr(value)}
          onFocus={() => {
            setDraft(value ? String(value) : "");
            setEditing(true);
          }}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            onChange(parseInr(draft));
            setEditing(false);
          }}
          className={cn(
            "h-10 w-full rounded-control border border-line bg-surface pl-7 pr-3 text-ws-body text-fg hf-tnum",
            "transition-colors duration-micro ease-ds-out hover:border-fg-subtle",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            "disabled:cursor-not-allowed disabled:bg-surface-raised disabled:text-fg-subtle disabled:opacity-70",
            status ? STATUS_CLASS[status] : "",
          )}
          {...aria}
        />
      </div>
    );
  },
);
MoneyInput.displayName = "MoneyInput";

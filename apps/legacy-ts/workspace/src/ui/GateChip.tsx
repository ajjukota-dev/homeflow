import { CircleDot, CircleDashed, CircleSlash, Circle, MinusCircle } from "lucide-react";
import { cn } from "../lib/utils";

/** The 5 changeability gate states (foundation/gates.md A.1) — icon + label + tone.
 *  Colour is never the sole signal. */
export type GateState =
  | "OPEN"
  | "CLOSING"
  | "CONDITIONAL"
  | "EXCEPTION_ONLY"
  | "HARD_CLOSED";

const meta: Record<GateState, { label: string; Icon: typeof Circle; className: string }> = {
  OPEN: { label: "Open", Icon: CircleDot, className: "text-ontrack bg-ontrack/10" },
  CLOSING: { label: "Closing", Icon: CircleDashed, className: "text-due bg-due/10" },
  CONDITIONAL: { label: "Conditional", Icon: MinusCircle, className: "text-atrisk bg-atrisk/10" },
  EXCEPTION_ONLY: { label: "Exception only", Icon: CircleSlash, className: "text-atrisk bg-atrisk/10" },
  HARD_CLOSED: { label: "Hard closed", Icon: Circle, className: "text-overdue bg-overdue/10" },
};

export function GateChip({ state, note }: { state: GateState; note?: string }) {
  const m = meta[state];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-footnote font-medium",
        m.className
      )}
      title={note ?? m.label}
    >
      <m.Icon className="h-3.5 w-3.5" aria-hidden />
      {m.label}
      {note ? <span className="text-fg-subtle font-normal">· {note}</span> : null}
    </span>
  );
}

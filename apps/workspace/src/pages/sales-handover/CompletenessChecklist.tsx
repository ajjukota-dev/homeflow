import { CircleAlert } from "lucide-react";
import { cn } from "../../lib/utils";
import type { ChecklistItemResult } from "./api";

// handover_checklist_rule.item_code (seed/handover-checklist.ts) is Policy-Studio-configurable
// data, not a fixed spec enum — so unlike labels.ts's lookup tables this is a humanizer, not a
// dictionary. Document items are already human-readable ("Booking Form"); field/confirmation
// items are snake_case; the commercial-approval blocker carries a ":DOMAIN" suffix.
export function checklistItemLabel(code: string): string {
  if (code.includes(":")) {
    const [base, domain] = code.split(":");
    return `${checklistItemLabel(base)} (${domain.charAt(0)}${domain.slice(1).toLowerCase()})`;
  }
  if (code.includes(" ")) return code;
  return code
    .split("_")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** 17-sales-crm-handover.md: completeness score + which required items still block submission.
 *  Shared between the Sales edit form and the CRM review panel — same shape either side. */
export function CompletenessChecklist({ score, detail }: { score: number | null; detail: ChecklistItemResult[] | null }) {
  if (score == null || detail == null) return null;
  const missing = detail.filter((d) => d.required && !d.satisfied);
  return (
    <div className="rounded-lg border border-line bg-surface-raised p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-ws-sm font-medium text-fg">Completeness</h3>
        <span className={cn("text-ws-sm font-semibold", score >= 100 ? "text-ok-fg" : score >= 60 ? "text-warn-fg" : "text-danger-fg")}>{score}%</span>
      </div>
      {missing.length === 0 ? (
        <p className="text-footnote text-fg-muted">Every required item is satisfied.</p>
      ) : (
        <ul className="flex flex-col gap-1 text-footnote text-fg-muted">
          {missing.map((d) => (
            <li key={d.item_code} className="flex items-center gap-1.5">
              <CircleAlert className="size-3.5 shrink-0 text-warn-fg" aria-hidden />
              {checklistItemLabel(d.item_code)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

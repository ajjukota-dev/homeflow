// 28-360-views.md rule 4 — sticky Project 360 header, used by Unit360/Booking360/Customer360.
// The project switcher itself (01) already lives in Workspace.tsx's sidebar (rule 9) — this
// header shows the current project's figures, it doesn't duplicate that selector's state.
import { useEffect, useState } from "react";
import { CircleAlert } from "lucide-react";
import { Skeleton } from "@homeflow/ui";
import { threeSixtyApi, type ProjectHeaderView } from "../pages/three-sixty/api";
import { formatINR } from "../ui/MoneyFigure";
import { cn } from "../lib/utils";

function Figure({ label, value, tone, title }: { label: string; value: string; tone?: "warn" | "danger"; title?: string }) {
  return (
    <div className="flex min-w-[7rem] flex-col gap-0.5" title={title}>
      <span className="text-caption uppercase tracking-wide text-fg-subtle">{label}</span>
      <span className={cn("hf-tnum text-subhead font-semibold text-fg", tone === "warn" && "text-atrisk", tone === "danger" && "text-overdue")}>{value}</span>
    </div>
  );
}

/** Sticky project-level strip: name/code, portfolio mix, and the 6 rule-4 figures. Renders
 *  compactly at 375 px (a horizontally-scrolling figure row) per rule 6. */
export function Project360Header({ projectId }: { projectId: string }) {
  const [header, setHeader] = useState<ProjectHeaderView | null | undefined>(undefined);
  const [error, setError] = useState(false);

  useEffect(() => {
    setHeader(undefined);
    setError(false);
    threeSixtyApi.getProjectHeader(projectId).then(setHeader).catch(() => setError(true));
  }, [projectId]);

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-4 py-3 text-footnote text-overdue">
        <CircleAlert className="h-4 w-4" /> Couldn't load the project header.
      </div>
    );
  }
  if (!header) {
    return (
      <div className="rounded-lg border border-line bg-surface px-4 py-3">
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  return (
    <div className="sticky top-0 z-10 -mx-4 border-b border-line bg-surface px-4 py-3 sm:-mx-6 sm:px-6 md:-mx-10 md:px-10">
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <h2 className="text-headline font-semibold text-fg">{header.name}</h2>
        <span className="text-caption text-fg-subtle">{header.code}</span>
      </div>
      <div className="flex gap-6 overflow-x-auto pb-1">
        <Figure label="Units sold" value={`${header.units_sold} / ${header.units_total}`} title="Sold / total units in this project" />
        <Figure label="Available" value={String(header.units_available)} />
        <Figure label="True risk" value={formatINR(header.true_risk_inr)} tone={header.true_risk_inr > 0 ? "warn" : undefined} />
        <Figure
          label="Unit readiness"
          value={header.unit_readiness_avg === null ? "—" : `${Math.round(header.unit_readiness_avg)}`}
        />
        <Figure
          label="Open escalations"
          value={String(header.open_material_escalations)}
          tone={header.open_material_escalations > 0 ? "danger" : undefined}
        />
        <Figure
          label="Next month forecast"
          value={header.next_month_forecast_inr === null ? "No access" : formatINR(header.next_month_forecast_inr)}
        />
        <Figure
          label="Actual to date"
          value={header.actual_to_date_inr === null ? "No access" : formatINR(header.actual_to_date_inr)}
        />
        <Figure label="Handovers due 30d" value="—" title={header.handovers_due_30d_reason} />
      </div>
    </div>
  );
}

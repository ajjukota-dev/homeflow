import { Check } from "lucide-react";
import { STAGE_STATUS_TONE } from "@/lib/journey";
import { STATUS_PILL_CLASS } from "@/lib/constants";
import { stageColorForName } from "@/lib/stageColors";
import StageInfoPopover from "@/components/journey/StageInfoPopover";

/**
 * Horizontal progress rail — one tile per stage, tinted by the stage's
 * department colour (blue Sales, indigo CRM, violet Legal, teal Accounts,
 * cyan Registration, slate Site, orange QA, green Handover). Completed /
 * In-Progress / Not-Started state is still shown via the existing pill.
 */
export default function ProgressRail({ journey }) {
  const stages = (journey?.stages || []).slice().sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
  const pct = journey?.journey_percentage ?? 0;
  const currentIdx = stages.findIndex((s) => s.status === "In Progress");

  return (
    <div className="rounded-md border border-warm-100 bg-white p-4" data-testid="journey-progress-rail">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Journey progress</div>
          <div className="font-heading text-lg font-semibold text-slate-900" data-testid="journey-percentage">
            {pct.toFixed?.(1) ?? pct}%
          </div>
        </div>
        <div className="text-[11px] text-slate-500">
          {currentIdx >= 0 ? (
            <span>
              Current stage:{" "}
              <span className="font-medium text-navy-900">
                {stages[currentIdx]?.name || "—"}
              </span>
            </span>
          ) : (
            <span>Journey complete</span>
          )}
        </div>
      </div>

      <ol className="grid grid-cols-4 sm:grid-cols-8 gap-2" data-testid="journey-stage-strip">
        {stages.map((s) => {
          const t = STAGE_STATUS_TONE[s.status] || "grey";
          const c = stageColorForName(s.name);
          const done = s.status === "Completed";
          const current = s.status === "In Progress";
          return (
            <li
              key={s.id}
              className="rounded-lg overflow-hidden border border-warm-100 bg-white flex flex-col"
              data-testid={`journey-stage-${s.sequence}`}
            >
              {/* Saturated stage header band — white text + white info icon */}
              <div
                className="px-2 py-2 flex items-center justify-between gap-1 min-h-[40px]"
                style={{ background: c.bg }}
              >
                <span
                  className="text-[11px] font-semibold truncate text-white leading-tight"
                  title={s.name}
                >
                  {s.name}
                </span>
                <StageInfoPopover stageName={s.name} onLight={false} />
              </div>
              {/* White content area: sequence badge, status pill */}
              <div className="flex-1 p-2.5 flex flex-col items-center text-center">
                <div
                  className={[
                    "h-6 w-6 rounded-full border-2 flex items-center justify-center bg-white",
                    done ? "text-green-600" : current ? "text-blue-600 ring-4 ring-blue-100" : "text-slate-500",
                  ].join(" ")}
                  style={{ borderColor: done ? "#16A34A" : current ? "#3B82F6" : c.bg }}
                >
                  {done ? <Check className="h-3.5 w-3.5" /> : (
                    <span className="text-[10px] font-bold" style={{ color: c.bg }}>{s.sequence}</span>
                  )}
                </div>
                <div className="mt-1.5">
                  <span className={`${STATUS_PILL_CLASS[t]} !text-[9px] !py-0`}>
                    <span>{s.status}</span>
                  </span>
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="mt-3 h-1.5 bg-warm-100 rounded-full overflow-hidden">
        <div
          className="h-full transition-all"
          style={{ width: `${Math.min(100, pct)}%`, background: "var(--brand)" }}
          aria-hidden
        />
      </div>
    </div>
  );
}

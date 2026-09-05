import { Zap, Clock, User as UserIcon } from "lucide-react";
import StatusPill from "@/components/StatusPill";
import { EXECUTION_ICONS, PRIORITY_TONE, TASK_STATUS_TONE, displayTaskStatus, pickNextBestActions } from "@/lib/journey";
import { formatDate } from "@/lib/format";

export default function NextBestActions({ journey, currentUserId, onOpenTask }) {
  const items = pickNextBestActions(journey, currentUserId, 3);
  if (items.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-4 text-center text-sm text-gray-500" data-testid="nba-empty">
        No open tasks — the journey is complete or all remaining work is cancelled.
      </div>
    );
  }
  return (
    <div className="rounded-md border border-gray-200 bg-white overflow-hidden" data-testid="next-best-actions">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-amber-500" />
          <div className="text-sm font-medium text-gray-900">Next best actions</div>
        </div>
        <div className="text-[11px] text-gray-500">Prioritised for this journey</div>
      </div>
      <ul className="divide-y divide-gray-100">
        {items.map((t) => {
          const Icon = EXECUTION_ICONS[t.execution_type] || EXECUTION_ICONS.Simple;
          const status = displayTaskStatus(t);
          return (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => onOpenTask?.(t.id)}
                className="w-full text-left flex items-start gap-3 px-4 py-3 hover:bg-brand-50/40 focus:outline-none focus:bg-brand-50/60"
                data-testid={`nba-item-${t.id}`}
              >
                <div className="mt-0.5 h-7 w-7 rounded-md bg-brand-50 text-navy-900 flex items-center justify-center shrink-0">
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="text-sm font-medium text-gray-900 truncate">{t.title}</div>
                    <StatusPill status={status} tone={TASK_STATUS_TONE[status]} />
                    {t.priority && t.priority !== "Medium" && (
                      <StatusPill status={t.priority} tone={PRIORITY_TONE[t.priority]} />
                    )}
                  </div>
                  <div className="mt-0.5 text-[11px] text-gray-500 flex items-center gap-3 flex-wrap">
                    <span>{t._stage?.name} · {t._sub?.name}</span>
                    {t.due_date && (
                      <span className={[
                        "inline-flex items-center gap-1",
                        t.overdue ? "text-red-700 font-medium" : ""
                      ].join(" ")}>
                        <Clock className="h-3 w-3" /> Due {formatDate(t.due_date)}
                      </span>
                    )}
                    {t.owner_user_id ? (
                      <span className="inline-flex items-center gap-1"><UserIcon className="h-3 w-3" /> Assigned</span>
                    ) : (
                      <span className="text-amber-700">Unassigned</span>
                    )}
                  </div>
                  {t.blocker_reason && (
                    <div className="mt-1 text-[11px] text-red-700 truncate">⚠ {t.blocker_reason}</div>
                  )}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

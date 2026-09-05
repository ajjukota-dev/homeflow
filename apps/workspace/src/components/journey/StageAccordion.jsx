import { useState } from "react";
import { ChevronDown, ChevronRight, Clock } from "lucide-react";

import StatusPill from "@/components/StatusPill";
import {
  EXECUTION_ICONS,
  STAGE_STATUS_TONE,
  TASK_STATUS_TONE,
  displayTaskStatus,
} from "@/lib/journey";
import { formatDate } from "@/lib/format";
import { stageColorForName } from "@/lib/stageColors";
import StageInfoPopover from "@/components/journey/StageInfoPopover";

export default function StageAccordion({ journey, onOpenTask }) {
  const stages = (journey?.stages || []).slice().sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
  if (!stages.length) {
    return <div className="text-sm text-gray-500">No stages configured for this journey.</div>;
  }
  return (
    <div className="space-y-3" data-testid="journey-stage-accordion">
      {stages.map((s) => (
        <StageBlock key={s.id} stage={s} onOpenTask={onOpenTask} />
      ))}
    </div>
  );
}

function StageBlock({ stage, onOpenTask }) {
  const [open, setOpen] = useState(stage.status === "In Progress");
  const totalTasks = (stage.subprocesses || []).reduce(
    (n, sub) => n + (sub.tasks?.filter((t) => t.status !== "Cancelled").length || 0),
    0,
  );
  const doneTasks = (stage.subprocesses || []).reduce(
    (n, sub) => n + (sub.tasks?.filter((t) => t.status === "Completed").length || 0),
    0,
  );
  const tone = STAGE_STATUS_TONE[stage.status] || "grey";
  const color = stageColorForName(stage.name);

  return (
    <section
      className="rounded-md border border-warm-100 bg-white overflow-hidden"
      data-testid={`stage-block-${stage.sequence}`}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left cursor-pointer select-none"
        style={{ background: color.bg, color: color.text }}
        aria-expanded={open}
        data-testid={`stage-toggle-${stage.sequence}`}
      >
        <div className="flex items-center gap-2 min-w-0">
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-white" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-white" />
          )}
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-mono text-[11px] rounded px-1.5 py-0.5 bg-white/20 text-white font-semibold">
              S{stage.sequence}
            </span>
            <span className="font-semibold text-sm truncate text-white">{stage.name || "—"}</span>
            <StageInfoPopover stageName={stage.name} onLight={false} />
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-[11px] text-white/80 tabular-nums">
            {doneTasks}/{totalTasks} tasks
          </span>
          <StatusPill status={stage.status} tone={tone} testId={`stage-status-${stage.sequence}`} />
        </div>
      </div>

      {open && (
        <div className="border-t border-warm-100 p-3 space-y-3 bg-warm-50/40">
          {(stage.subprocesses || []).map((sub) => (
            <SubBlock key={sub.id} sub={sub} stageColor={color} onOpenTask={onOpenTask} />
          ))}
        </div>
      )}
    </section>
  );
}

function SubBlock({ sub, stageColor, onOpenTask }) {
  const tasks = (sub.tasks || []).slice().sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
  return (
    <div className="rounded-md border border-warm-100 bg-white overflow-hidden" data-testid={`subprocess-${sub.id}`}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-warm-100 bg-white">
        <div className="min-w-0">
          <div className="text-xs font-medium text-slate-900 truncate">{sub.name || "Subprocess"}</div>
          <div className="text-[10px] text-slate-500">Sub-process</div>
        </div>
        <StatusPill status={sub.status} tone={STAGE_STATUS_TONE[sub.status] || "grey"} />
      </div>
      {tasks.length === 0 ? (
        <div className="p-3 text-xs text-slate-500">No tasks for this sub-process.</div>
      ) : (
        <ul className="divide-y divide-warm-100">
          {tasks.map((t) => (
            <TaskRow key={t.id} task={t} stageColor={stageColor} onOpenTask={onOpenTask} />
          ))}
        </ul>
      )}
    </div>
  );
}

function TaskRow({ task, stageColor, onOpenTask }) {
  const Icon = EXECUTION_ICONS[task.execution_type] || EXECUTION_ICONS.Simple;
  const status = displayTaskStatus(task);
  const tone = TASK_STATUS_TONE[status] || "grey";
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpenTask?.(task.id)}
        className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-brand-50/40 focus:outline-none focus:bg-brand-50/60"
        data-testid={`task-row-${task.id}`}
      >
        <span
          aria-hidden
          className="h-2 w-2 rounded-full shrink-0"
          style={{ background: stageColor?.dot || "#94A3B8" }}
        />
        <div className="h-6 w-6 rounded bg-warm-50 text-slate-700 flex items-center justify-center shrink-0">
          <Icon className="h-3 w-3" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-slate-900 truncate" data-testid={`task-row-title-${task.id}`}>{task.title}</span>
            {task.execution_type && (
              <span className="text-[10px] uppercase tracking-wide text-slate-500">{task.execution_type}</span>
            )}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500 flex items-center gap-3 flex-wrap">
            {task.due_date && (
              <span className={task.overdue ? "text-red-700 font-medium" : ""}>
                <Clock className="inline h-3 w-3 mr-0.5" /> Due {formatDate(task.due_date)}
              </span>
            )}
            {!task.owner_user_id && <span className="text-amber-700">Unassigned</span>}
            {task.blocker_reason && (
              <span className="text-red-700 truncate">⚠ Blocked</span>
            )}
          </div>
        </div>
        <StatusPill status={status} tone={tone} />
      </button>
    </li>
  );
}

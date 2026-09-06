import { Badge, Button } from "@homeflow/ui";
import { Plus } from "lucide-react";
import type { StageDef, TaskDef } from "./JourneyTemplateStudio";

/** One stage within its stream's swimlane row: stage summary + its task cards. Task cards are
 * intentionally compact (code, title, execution type, conditional badge) — full fields live in
 * the edit drawer, same list-then-drawer split as Queues.tsx and GenericTableEditor. */
export function JourneyTemplateStageCard({
  stage,
  canEdit,
  onEditStage,
  onAddTask,
  onEditTask,
}: {
  stage: StageDef;
  canEdit: boolean;
  onEditStage: () => void;
  onAddTask: () => void;
  onEditTask: (task: TaskDef) => void;
}) {
  return (
    <div className="flex w-72 flex-col gap-2 rounded-lg border border-line bg-surface p-3">
      <button type="button" onClick={onEditStage} className="flex flex-col items-start gap-1 rounded-lg text-left transition-colors duration-micro hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
        <div className="flex w-full items-center justify-between gap-2">
          <span className="text-caption text-fg-subtle">{stage.code}</span>
          <div className="flex items-center gap-1">
            {!stage.is_mandatory && <Badge>Conditional</Badge>}
            {stage.customer_visible === false && <Badge>Internal only</Badge>}
          </div>
        </div>
        <div className="font-semibold">{stage.name}</div>
        {stage.customer_name && stage.customer_name !== stage.name && <div className="text-footnote text-fg-muted">Customer sees: "{stage.customer_name}"</div>}
        <div className="text-footnote text-fg-subtle">
          {stage.planned_duration_days}d · {stage.owner_department}
        </div>
        {stage.condition_expr && <div className="truncate text-caption text-fg-subtle" title={stage.condition_expr}>if {stage.condition_expr}</div>}
      </button>

      <ul className="flex flex-col gap-1 border-t border-line pt-2">
        {stage.tasks
          .slice()
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
          .map((task) => (
            <li key={task.code}>
              <button
                type="button"
                onClick={() => onEditTask(task)}
                className="flex w-full items-center justify-between gap-2 rounded-lg px-1.5 py-1 text-left text-footnote transition-colors duration-micro hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                <span className="min-w-0 truncate">
                  <span className="text-fg-subtle">{task.code}</span> {task.title}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  {task.task_type === "CONDITIONAL" && <Badge>Cond.</Badge>}
                  <Badge>{task.execution_type}</Badge>
                </span>
              </button>
            </li>
          ))}
      </ul>

      {canEdit && (
        <Button size="sm" variant="ghost" className="w-fit" onClick={onAddTask}>
          <Plus className="mr-1 size-3.5" aria-hidden /> Add task
        </Button>
      )}
    </div>
  );
}

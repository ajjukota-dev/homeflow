import { useState } from "react";
import { Badge, Button } from "@homeflow/ui";
import { GitBranch } from "lucide-react";
import type { DependencyDef, DependencyKind } from "./JourneyTemplateStudio";

// Extracted from JourneyTemplateVersionEditor to keep that file under CLAUDE.md's 200-line
// split guideline — this section (list + add form) is a self-contained unit.
export function JourneyTemplateDependencies({
  dependencies,
  taskCodes,
  editable,
  onAdd,
  onRemove,
}: {
  dependencies: DependencyDef[];
  taskCodes: string[];
  editable: boolean;
  onAdd: (dep: DependencyDef) => void;
  onRemove: (dep: DependencyDef) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [kind, setKind] = useState<DependencyKind>("FINISH_TO_START");
  const [lag, setLag] = useState("0");

  function submit() {
    if (!from || !to || from === to) return;
    onAdd({ from_task_code: from, to_task_code: to, kind, lag_days: Number(lag) || 0 });
    setAdding(false);
    setFrom("");
    setTo("");
    setLag("0");
  }

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-line p-3">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-caption font-semibold uppercase tracking-wide text-fg-subtle">
          <GitBranch className="size-3.5" aria-hidden /> Dependencies
        </h3>
        {editable && !adding && taskCodes.length >= 2 && (
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
            Add dependency
          </Button>
        )}
      </div>

      {dependencies.length === 0 && !adding && <p className="text-footnote text-fg-subtle">No task dependencies configured.</p>}

      <ul className="flex flex-col gap-1">
        {dependencies.map((d) => (
          <li key={`${d.from_task_code}-${d.to_task_code}`} className="flex items-center gap-2 text-footnote">
            <span className="font-mono">{d.from_task_code}</span>
            <span className="text-fg-subtle">→</span>
            <span className="font-mono">{d.to_task_code}</span>
            <Badge>{d.kind === "FINISH_TO_START" ? "FS" : "SS"}</Badge>
            {(d.lag_days ?? 0) > 0 && <span className="text-fg-subtle">+{d.lag_days}d lag</span>}
            {editable && (
              <button onClick={() => onRemove(d)} className="text-fg-subtle underline hover:text-danger" aria-label={`Remove dependency ${d.from_task_code} to ${d.to_task_code}`}>
                remove
              </button>
            )}
          </li>
        ))}
      </ul>

      {adding && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2">
          <select value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 rounded-control border border-line bg-surface px-2 text-footnote" aria-label="From task">
            <option value="">From task…</option>
            {taskCodes.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select value={to} onChange={(e) => setTo(e.target.value)} className="h-9 rounded-control border border-line bg-surface px-2 text-footnote" aria-label="To task">
            <option value="">To task…</option>
            {taskCodes.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select value={kind} onChange={(e) => setKind(e.target.value as DependencyKind)} className="h-9 rounded-control border border-line bg-surface px-2 text-footnote" aria-label="Dependency kind">
            <option value="FINISH_TO_START">Finish → Start</option>
            <option value="START_TO_START">Start → Start</option>
          </select>
          <input
            type="number"
            min={0}
            value={lag}
            onChange={(e) => setLag(e.target.value)}
            className="h-9 w-20 rounded-control border border-line bg-surface px-2 text-footnote"
            aria-label="Lag days"
          />
          <Button size="sm" disabled={!from || !to || from === to} onClick={submit}>
            Add
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
            Cancel
          </Button>
        </div>
      )}
    </section>
  );
}

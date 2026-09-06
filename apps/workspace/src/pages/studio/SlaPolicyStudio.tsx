import { useEffect, useState } from "react";
import { Button, Skeleton, EmptyState, PageHeader, Badge } from "@homeflow/ui";
import { Timer, History } from "lucide-react";
import { studioApi, type StudioRow } from "./api";
import { SlaPolicyDrawer } from "./SlaPolicyDrawer";
import { HistoryDrawer } from "./HistoryDrawer";

/** Policy Studio's SLA policies tab (06-timeline-sla-engine.md Screens) — a bespoke screen, not
 *  GenericTableEditor, so the publish flow can show real open-sla_clock impact (studio/core.ts's
 *  sla_policy design note) before a duration/pause/escalation change goes live. */
export function SlaPolicyStudio({ canEdit }: { canEdit: boolean }) {
  const [rows, setRows] = useState<StudioRow[] | null>(null);
  const [delayReasonCodes, setDelayReasonCodes] = useState<string[]>([]);
  const [error, setError] = useState(false);
  const [editing, setEditing] = useState<StudioRow | null | "new" | undefined>(undefined);
  const [historyFor, setHistoryFor] = useState<string | null>(null);

  function load() {
    setError(false);
    studioApi.listTable("sla_policy").then(setRows).catch(() => setError(true));
  }
  useEffect(() => {
    load();
    studioApi
      .listTable("delay_reason")
      .then((r) => setDelayReasonCodes(r.map((d) => d.code as string)))
      .catch(() => setDelayReasonCodes([]));
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="SLA policies"
        description="How long each task/action/stage has before it's Due Soon, At Risk or Overdue (06-timeline-sla-engine.md)."
        actions={canEdit ? <Button onClick={() => setEditing("new")}>New policy</Button> : undefined}
      />

      {error && <EmptyState icon={Timer} message="Couldn't load SLA policies." action={{ label: "Retry", onClick: load }} />}
      {!error && rows === null && (
        <div className="flex flex-col gap-2">
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      )}
      {!error && rows && rows.length === 0 && (
        <EmptyState icon={Timer} message="No SLA policies yet." action={canEdit ? { label: "Add the first policy", onClick: () => setEditing("new") } : undefined} />
      )}
      {!error && rows && rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full border-collapse text-left text-caption">
            <thead className="sticky top-0 bg-surface-2 text-footnote">
              <tr>
                <th className="whitespace-nowrap p-2">Code</th>
                <th className="whitespace-nowrap p-2">Applies to</th>
                <th className="whitespace-nowrap p-2">Target</th>
                <th className="whitespace-nowrap p-2">Duration</th>
                <th className="whitespace-nowrap p-2">Due-soon lead</th>
                <th className="whitespace-nowrap p-2">Effective</th>
                <th className="whitespace-nowrap p-2">v</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id as string} className="border-t border-line">
                  <td className="whitespace-nowrap p-2 font-medium">{String(r.code)}</td>
                  <td className="whitespace-nowrap p-2">
                    <Badge tone="neutral">{String(r.applies_to)}</Badge>
                  </td>
                  <td className="whitespace-nowrap p-2">{String(r.target_ref)}</td>
                  <td className="whitespace-nowrap p-2">
                    {String(r.duration_value)} {String(r.duration_unit).replace("_", " ").toLowerCase()}
                  </td>
                  <td className="whitespace-nowrap p-2">{String(r.due_soon_lead_days)}d</td>
                  <td className="whitespace-nowrap p-2">
                    {String(r.effective_from).slice(0, 10)}
                    {r.effective_to ? ` → ${String(r.effective_to).slice(0, 10)}` : ""}
                  </td>
                  <td className="whitespace-nowrap p-2">{String(r.version)}</td>
                  <td className="whitespace-nowrap p-2 text-right">
                    <button
                      onClick={() => setHistoryFor(r.id as string)}
                      aria-label={`History for ${r.code}`}
                      className="mr-2 rounded-lg p-1.5 text-fg-muted hover:bg-surface-2"
                    >
                      <History className="h-4 w-4" />
                    </button>
                    {canEdit && (
                      <Button size="sm" variant="secondary" onClick={() => setEditing(r)}>
                        Edit
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing !== undefined && (
        <SlaPolicyDrawer
          policy={editing === "new" ? null : editing}
          delayReasonCodes={delayReasonCodes}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            load();
          }}
        />
      )}
      {historyFor && <HistoryDrawer table="sla_policy" rowId={historyFor} onClose={() => setHistoryFor(null)} />}
    </div>
  );
}

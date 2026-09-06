import { useEffect, useState } from "react";
import { Drawer, DrawerContent, KeyValue, StatusChip, Button, Skeleton, Field, Textarea } from "@homeflow/ui";
import { ExternalLink } from "lucide-react";
import { journeyApi, type TaskDetail, type ClockStatus } from "./api";
import { ActionDrawer } from "../../components/ActionDrawer/ActionDrawer";

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function fmtAt(d: string): string {
  return new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Stage/Task detail (06-timeline-sla-engine.md Screens: "dates, clock with pause history,
 *  dependencies, evidence link to the Action"). Dependencies render as a plain text list, not SVG
 *  connectors — same cut Journey Template Studio's dependency editor already made, for the same
 *  reason (no fixed pixel geometry here to anchor a line to). */
export function StageTaskDetailDrawer({ taskInstanceId, onClose, onChanged }: { taskInstanceId: string | null; onClose: () => void; onChanged?: () => void }) {
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [error, setError] = useState(false);
  const [viewingAction, setViewingAction] = useState<string | null>(null);
  const [reopenReason, setReopenReason] = useState("");
  const [reopening, setReopening] = useState(false);

  function load() {
    if (!taskInstanceId) return;
    setError(false);
    journeyApi.getTaskDetail(taskInstanceId).then(setDetail).catch(() => setError(true));
  }

  useEffect(() => {
    setDetail(null);
    setReopenReason("");
    if (taskInstanceId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskInstanceId]);

  async function reopen() {
    if (!taskInstanceId || !reopenReason.trim()) return;
    setReopening(true);
    try {
      await journeyApi.reopenTask(taskInstanceId, reopenReason.trim());
      onChanged?.();
      load();
      setReopenReason("");
    } finally {
      setReopening(false);
    }
  }

  return (
    <>
      <Drawer open={!!taskInstanceId} onOpenChange={(o) => !o && onClose()}>
        <DrawerContent open={!!taskInstanceId} title={detail?.title ?? "Task"} width={480}>
          <div className="flex flex-col gap-5 p-6">
            {error && <p className="text-footnote text-danger">Couldn't load this task.</p>}
            {!error && !detail && (
              <div className="flex flex-col gap-2">
                <Skeleton />
                <Skeleton />
                <Skeleton />
              </div>
            )}
            {detail && (
              <>
                <div>
                  <div className="text-ws-body font-semibold text-fg">{detail.title}</div>
                  {detail.customer_title && detail.customer_title !== detail.title && (
                    <div className="text-footnote text-fg-muted">Customer sees: "{detail.customer_title}"</div>
                  )}
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-footnote text-fg-muted">{detail.status}</span>
                    {detail.clock && <StatusChip status={detail.clock.status as ClockStatus} />}
                  </div>
                </div>

                <div>
                  <h3 className="mb-2 text-ws-sm font-medium text-fg">Dates</h3>
                  <KeyValue
                    items={[
                      { key: "Baseline", value: `${fmtDate(detail.baseline_start)} – ${fmtDate(detail.baseline_end)}` },
                      { key: "Planned", value: `${fmtDate(detail.planned_start)} – ${fmtDate(detail.planned_end)}` },
                      { key: "Forecast", value: `${fmtDate(detail.forecast_start)} – ${fmtDate(detail.forecast_end)}` },
                      { key: "Actual", value: detail.actual_start ? `${fmtDate(detail.actual_start)} – ${fmtDate(detail.actual_end)}` : "Not started" },
                    ]}
                  />
                </div>

                {detail.clock && (
                  <div>
                    <h3 className="mb-2 text-ws-sm font-medium text-fg">SLA clock</h3>
                    <KeyValue
                      items={[
                        { key: "Due", value: fmtAt(detail.clock.due_at) },
                        { key: "Outcome", value: detail.clock.outcome ?? "Running" },
                      ]}
                    />
                    <div className="mt-3 flex flex-col gap-1.5">
                      {detail.clock.events.map((e, i) => (
                        <div key={i} className="flex items-center gap-2 text-footnote">
                          <span className="w-16 shrink-0 font-medium text-fg">{e.kind}</span>
                          <span className="text-fg-muted">{fmtAt(e.at)}</span>
                          {e.reason && <span className="text-fg-muted">— {e.reason}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(detail.depends_on.length > 0 || detail.blocks.length > 0) && (
                  <div>
                    <h3 className="mb-2 text-ws-sm font-medium text-fg">Dependencies</h3>
                    {detail.depends_on.length > 0 && (
                      <p className="text-footnote text-fg-muted">
                        Depends on: {detail.depends_on.map((d) => d.task_code).join(", ")}
                      </p>
                    )}
                    {detail.blocks.length > 0 && (
                      <p className="text-footnote text-fg-muted">Blocks: {detail.blocks.map((d) => d.task_code).join(", ")}</p>
                    )}
                  </div>
                )}

                {detail.action_id && (
                  <Button variant="secondary" size="sm" onClick={() => setViewingAction(detail.action_id)} className="self-start">
                    <ExternalLink className="h-4 w-4" /> View evidence & action
                  </Button>
                )}

                {detail.status === "Closed" && (
                  <div className="rounded-lg border border-line p-3">
                    <h3 className="mb-2 text-ws-sm font-medium text-fg">Reopen</h3>
                    <Field label="Reason for reopening" htmlFor="reopen-reason">
                      <Textarea id="reopen-reason" value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} rows={2} />
                    </Field>
                    <Button size="sm" onClick={reopen} disabled={!reopenReason.trim() || reopening} className="mt-2">
                      {reopening ? "Reopening…" : "Reopen task"}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </DrawerContent>
      </Drawer>
      <ActionDrawer actionId={viewingAction} onClose={() => setViewingAction(null)} onChanged={() => { load(); onChanged?.(); }} />
    </>
  );
}

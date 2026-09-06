import { useEffect, useState } from "react";
import { PageHeader, Button, Skeleton, EmptyState, Segmented, StatusChip, Field, Textarea } from "@homeflow/ui";
import { ArrowLeft, Route } from "lucide-react";
import { ApiError } from "../../auth/api";
import { journeyApi, type Journey, type JourneyStage, type ClockStatus } from "./api";
import { STREAMS } from "../studio/JourneyTemplateStudio";
import { StageStatusChip, type StageStatus } from "./StageStatusChip";
import { StageTaskDetailDrawer } from "./StageTaskDetailDrawer";
import { PlanRevisionDialog } from "./PlanRevisionDialog";

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function VarianceNote({ label, days }: { label: string; days: number }) {
  if (days === 0) return null;
  return (
    <span className={days > 0 ? "text-overdue" : "text-ontrack"}>
      {label} {days > 0 ? "+" : ""}
      {days}d
    </span>
  );
}

/** Customer/Booking Journey Timeline (06-timeline-sla-engine.md Screens). Internal layer shows
 *  every stage/task; the customer layer toggle filters to customer_visible and swaps in
 *  customer_name/customer_title — "the same component the portal uses" per the spec, though the
 *  portal app itself (my-pranava-home) isn't built yet, so this toggle is a preview of that
 *  filter, not yet a shared component with a real portal consumer. */
export function JourneyTimeline({ bookingId, onBack }: { bookingId: string; onBack: () => void }) {
  const [journey, setJourney] = useState<Journey | null | undefined>(undefined);
  const [error, setError] = useState(false);
  const [layer, setLayer] = useState<"internal" | "customer">("internal");
  const [openingTask, setOpeningTask] = useState<string | null>(null);
  const [revising, setRevising] = useState(false);
  const [lifecyclePrompt, setLifecyclePrompt] = useState<"hold" | "resume" | "close" | null>(null);
  const [reason, setReason] = useState("");
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    setError(false);
    journeyApi
      .getForBooking(bookingId)
      .then(setJourney)
      .catch((e) => {
        // getForBooking 404s with not_found when a booking simply has no journey yet (e.g. not
        // accepted by CRM) — that's the honest empty state below, not a load failure.
        if (e instanceof ApiError && e.code === "not_found") setJourney(null);
        else setError(true);
      });
  }
  useEffect(load, [bookingId]);

  async function confirmLifecycle() {
    if (!journey || !lifecyclePrompt || !reason.trim()) return;
    setBusy(true);
    setLifecycleError(null);
    try {
      if (lifecyclePrompt === "hold") await journeyApi.hold(journey.id, reason.trim());
      if (lifecyclePrompt === "resume") await journeyApi.resume(journey.id, reason.trim());
      if (lifecyclePrompt === "close") await journeyApi.close(journey.id, reason.trim());
      setLifecyclePrompt(null);
      setReason("");
      load();
    } catch (e) {
      setLifecycleError(e instanceof ApiError ? (e.code === "forbidden" ? "You don't have access for this action." : e.message) : "Couldn't complete this action.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <button onClick={onBack} className="inline-flex w-fit items-center gap-1.5 text-subhead font-medium text-fg-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      {error && <EmptyState icon={Route} message="Couldn't load this journey." action={{ label: "Retry", onClick: load }} />}
      {!error && journey === undefined && (
        <div className="flex flex-col gap-2">
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      )}
      {!error && journey === null && <EmptyState icon={Route} message="No journey has started for this booking yet." />}

      {journey && (
        <>
          <PageHeader
            title="Journey timeline"
            description={`Started ${fmtDate(journey.started_at)}${journey.hold_reason ? ` · On hold: ${journey.hold_reason}` : ""}`}
            actions={
              // flex-wrap: found live-verifying at 375px — this row (Segmented + up to 3
              // buttons) overflowed the viewport horizontally with no wrap, which CLAUDE.md's
              // "body must never scroll horizontally" rule forbids.
              <div className="flex flex-wrap items-center gap-2">
                <Segmented aria-label="Layer" value={layer} onChange={setLayer} options={[{ value: "internal", label: "Internal" }, { value: "customer", label: "Customer view" }]} />
                <Button variant="secondary" size="sm" onClick={() => setRevising(true)}>
                  Revise plan
                </Button>
                {journey.status === "ACTIVE" && (
                  <>
                    <Button variant="secondary" size="sm" onClick={() => setLifecyclePrompt("hold")}>
                      Hold
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => setLifecyclePrompt("close")}>
                      Close
                    </Button>
                  </>
                )}
                {journey.status === "ON_HOLD" && (
                  <Button size="sm" onClick={() => setLifecyclePrompt("resume")}>
                    Resume
                  </Button>
                )}
              </div>
            }
          />

          <div className="flex items-center gap-2">
            <StatusChip status={journey.health as ClockStatus} />
            <span className="text-footnote text-fg-muted">{journey.status}</span>
          </div>

          {lifecyclePrompt && (
            <div className="rounded-lg border border-line bg-surface-raised p-4">
              <Field label={`Reason to ${lifecyclePrompt} this journey`} htmlFor="lifecycle-reason" required>
                <Textarea id="lifecycle-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} autoFocus />
              </Field>
              {lifecycleError && (
                <p role="alert" className="mt-2 text-footnote text-danger">
                  {lifecycleError}
                </p>
              )}
              <div className="mt-2 flex justify-end gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setLifecyclePrompt(null);
                    setReason("");
                    setLifecycleError(null);
                  }}
                  disabled={busy}
                >
                  Cancel
                </Button>
                <Button size="sm" onClick={confirmLifecycle} disabled={!reason.trim() || busy}>
                  {busy ? "Saving…" : `Confirm ${lifecyclePrompt}`}
                </Button>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-6">
            {STREAMS.map((stream) => {
              const stages = journey.stages
                .filter((s) => s.stream === stream.value)
                .filter((s) => layer === "internal" || s.customer_visible);
              if (stages.length === 0) return null;
              return (
                <div key={stream.value}>
                  <h2 className="mb-2 text-ws-sm font-semibold uppercase tracking-wide text-fg-muted">{stream.label}</h2>
                  <div className="flex flex-col gap-3">
                    {stages.map((stage) => (
                      <StageCard key={stage.stage_code} stage={stage} layer={layer} onOpenTask={setOpeningTask} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <StageTaskDetailDrawer taskInstanceId={openingTask} onClose={() => setOpeningTask(null)} onChanged={load} />
          {revising && (
            <PlanRevisionDialog
              journeyIds={[journey.id]}
              stageOptions={journey.stages.map((s) => ({ value: s.stage_code, label: s.name }))}
              onClose={() => setRevising(false)}
              onSaved={() => {
                setRevising(false);
                load();
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

function StageCard({ stage, layer, onOpenTask }: { stage: JourneyStage; layer: "internal" | "customer"; onOpenTask: (id: string) => void }) {
  const tasks = layer === "internal" ? stage.tasks : stage.tasks.filter((t) => t.customer_visible);
  const displayName = layer === "customer" ? stage.customer_name ?? stage.name : stage.name;
  return (
    <div className="rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-ws-body font-semibold text-fg">{displayName}</div>
          <div className="text-footnote text-fg-muted">
            Planned {fmtDate(stage.planned_start)} – {fmtDate(stage.planned_end)}
            {" · "}
            <VarianceNote label="variance" days={stage.variance_days} />
            {stage.variance_days !== 0 && stage.slippage_days !== 0 && " "}
            <VarianceNote label="slippage" days={stage.slippage_days} />
            {stage.variance_days === 0 && stage.slippage_days === 0 && "on plan"}
          </div>
        </div>
        <StageStatusChip status={stage.status as StageStatus} />
      </div>
      {tasks.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {tasks.map((t) => (
            <li key={t.task_instance_id}>
              <button
                onClick={() => onOpenTask(t.task_instance_id)}
                className="flex w-full items-center justify-between gap-2 rounded-control px-2 py-1.5 text-left text-ws-sm hover:bg-surface-raised"
              >
                <span className="text-fg">{layer === "customer" ? t.customer_title ?? t.title : t.title}</span>
                {t.clock_status && <StatusChip status={t.clock_status} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

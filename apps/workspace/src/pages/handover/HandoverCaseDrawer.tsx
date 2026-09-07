import { useCallback, useEffect, useState } from "react";
import { CircleCheck, CircleAlert, Circle, ShieldAlert } from "lucide-react";
import { Drawer, DrawerContent, Badge, Button, Skeleton, EmptyState, Field, Textarea, Input, Dialog, DialogContent } from "@homeflow/ui";
import { ApiError } from "../../auth/api";
import { useAuth } from "../../auth/AuthContext";
import { SignaturePad } from "../../components/SignaturePad";
import { gateTypeLabel, gateRunStateLabel } from "../../lib/labels";
import { formatIstDateTime } from "../../lib/utils";
import { handoverApi, resolveGateConfig, type HandoverView, type EvaluatedGate, type GateConfigRow } from "./api";

// 16-handover-gates.md Screens: "case view with eight gate cards..., appointment scheduler,
// digital checklist..., complete/close buttons disabled with reasons listed."
export const HANDOVER_WRITE_ROLES = ["QA", "FM", "MANAGEMENT", "SUPER_ADMIN"];
const APPOINTMENT_ROLES = [...HANDOVER_WRITE_ROLES, "CRM"];

function humanize(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const GROUP_LABEL: Record<string, string> = {
  property: "Property", keys: "Keys", access: "Access", utilities: "Utilities", documents: "Documents",
};

function GateStateIcon({ gate }: { gate: EvaluatedGate }) {
  if (gate.overridden) return <ShieldAlert className="size-4 text-due" aria-hidden />;
  if (gate.state === "passed") return <CircleCheck className="size-4 text-ontrack" aria-hidden />;
  return gate.classification === "hard" ? <CircleAlert className="size-4 text-overdue" aria-hidden /> : <Circle className="size-4 text-fg-subtle" aria-hidden />;
}

function GateCard({ gate, config, canWrite, onOverride }: {
  gate: EvaluatedGate; config: GateConfigRow | null; canWrite: boolean;
  onOverride: (gate: EvaluatedGate) => void;
}) {
  const stateLabel = gate.overridden ? "Overridden" : gateRunStateLabel(gate.state);
  const canOverride = canWrite && !!config?.overridable && gate.state === "open" && !gate.overridden;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center justify-between">
        <span className="text-footnote font-semibold text-fg">{gateTypeLabel(gate.type)}</span>
        <Badge tone={gate.classification === "hard" ? "accent" : "neutral"}>{gate.classification === "hard" ? "Hard" : "Soft"}</Badge>
      </div>
      <div className="flex items-center gap-1.5 text-footnote">
        <GateStateIcon gate={gate} />
        <span>{stateLabel}</span>
      </div>
      {gate.blockers.length > 0 && (
        <ul className="list-disc pl-5 text-caption text-fg-muted">
          {gate.blockers.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      )}
      {gate.state === "open" && !gate.overridden && (
        canOverride ? (
          <Button size="sm" variant="secondary" onClick={() => onOverride(gate)}>
            Override
          </Button>
        ) : config && !config.overridable ? (
          <p className="text-caption text-fg-subtle">Cannot be overridden.</p>
        ) : null
      )}
    </div>
  );
}

function OverrideDialog({ gate, config, bookingId, onClose, onDone }: {
  gate: EvaluatedGate; config: GateConfigRow | null; bookingId: string; onClose: () => void; onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("");
  const [approver, setApprover] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!reason.trim()) return setError("A reason is required.");
    const evidenceIds = evidence.split(",").map((s) => s.trim()).filter(Boolean);
    if (config?.requires_evidence && evidenceIds.length === 0) return setError("Evidence is required for this gate.");
    if (config?.requires_approval && !approver.trim()) return setError("A second approver's user id is required for this gate.");
    setBusy(true);
    setError(null);
    try {
      await handoverApi.override(bookingId, {
        gate: gate.gate_db, reason: reason.trim(),
        evidence_file_ids: evidenceIds.length ? evidenceIds : undefined,
        approved_by_user_id: approver.trim() || undefined,
      });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Override ${gateTypeLabel(gate.type)}`} description="Requires a reason and is visible on every later screen and in the audit log (rule 2).">
        <div className="flex flex-col gap-3">
          <Field label="Reason" htmlFor="ov-reason" required>
            <Textarea id="ov-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
          </Field>
          {config?.requires_evidence && (
            <Field label="Evidence reference(s)" htmlFor="ov-evidence" required hint="Comma-separated — no file upload flow is wired here yet.">
              <Input id="ov-evidence" value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="e.g. site photo, waiver letter ref" />
            </Field>
          )}
          {config?.requires_approval && (
            <Field label="Approver (a second person's user id)" htmlFor="ov-approver" required>
              <Input id="ov-approver" value={approver} onChange={(e) => setApprover(e.target.value)} placeholder="user_management" />
            </Field>
          )}
          {error && <p role="alert" className="text-footnote text-overdue">{error}</p>}
          <div className="flex gap-2">
            <Button onClick={submit} loading={busy}>Confirm override</Button>
            <Button variant="ghost" onClick={onClose} disabled={busy}>Never mind</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AppointmentPanel({ view, bookingId, canWrite, onChanged }: { view: HandoverView; bookingId: string; canWrite: boolean; onChanged: () => void }) {
  const [slotA, setSlotA] = useState("");
  const [slotB, setSlotB] = useState("");
  const [rescheduleReason, setRescheduleReason] = useState("");
  const [rescheduleSlot, setRescheduleSlot] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const appt = view.appointment;

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  }

  if (!appt || appt.proposed_slots.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        {!view.eligible && <p className="text-footnote text-fg-muted">Propose slots once all hard gates pass or are overridden (rule 4).</p>}
        {canWrite && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input type="datetime-local" aria-label="First proposed slot" value={slotA} onChange={(e) => setSlotA(e.target.value)} />
            <Input type="datetime-local" aria-label="Second proposed slot" value={slotB} onChange={(e) => setSlotB(e.target.value)} />
            <Button disabled={!view.eligible || !slotA || !slotB} loading={busy} onClick={() => run(() => handoverApi.proposeAppointment(bookingId, [new Date(slotA).toISOString(), new Date(slotB).toISOString()]))}>
              Propose slots
            </Button>
          </div>
        )}
        {error && <p role="alert" className="text-footnote text-overdue">{error}</p>}
      </div>
    );
  }

  if (!appt.confirmed_slot) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-footnote text-fg-muted">Proposed slots — confirm one:</p>
        <div className="flex flex-wrap gap-2">
          {appt.proposed_slots.map((s) => (
            <Button key={s} size="sm" variant="secondary" loading={busy} onClick={() => run(() => handoverApi.confirmAppointment(bookingId, { slot: s, confirmed_by: "CRM_ON_BEHALF", note: "Confirmed on customer's behalf" }))}>
              {formatIstDateTime(s)}
            </Button>
          ))}
        </div>
        {error && <p role="alert" className="text-footnote text-overdue">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-footnote text-fg">
        Confirmed for {formatIstDateTime(appt.confirmed_slot)} ({appt.confirmed_by === "CRM_ON_BEHALF" ? "CRM on behalf" : "customer portal"})
      </p>
      {appt.rescheduled_count > 0 && <p className="text-caption text-fg-muted">Rescheduled {appt.rescheduled_count} time(s).</p>}
      {canWrite && (
        <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-raised p-3 sm:flex-row sm:items-end">
          <Field label="New slot" htmlFor="resched-slot">
            <Input id="resched-slot" type="datetime-local" value={rescheduleSlot} onChange={(e) => setRescheduleSlot(e.target.value)} />
          </Field>
          <Field label="Reason" htmlFor="resched-reason" required>
            <Input id="resched-reason" value={rescheduleReason} onChange={(e) => setRescheduleReason(e.target.value)} />
          </Field>
          <Button
            size="sm"
            disabled={!rescheduleSlot || !rescheduleReason.trim()}
            loading={busy}
            onClick={() => run(() => handoverApi.rescheduleAppointment(bookingId, { slot: new Date(rescheduleSlot).toISOString(), reason: rescheduleReason.trim() }))}
          >
            Reschedule
          </Button>
        </div>
      )}
      {error && <p role="alert" className="text-footnote text-overdue">{error}</p>}
    </div>
  );
}

function ChecklistPanel({ view, bookingId, canWrite, onChanged }: { view: HandoverView; bookingId: string; canWrite: boolean; onChanged: () => void }) {
  const { me } = useAuth();
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const checklist = view.checklist;

  async function toggle(group: string, item: string, done: boolean) {
    setBusyItem(`${group}.${item}`);
    setError(null);
    try {
      const existing = checklist.groups[group]?.[item];
      await handoverApi.updateChecklist(bookingId, {
        groups: { [group]: { [item]: { done, by: me?.user.display_name ?? null, at: new Date().toISOString(), file_ids: existing?.file_ids ?? [] } } },
      });
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That didn't work.");
    } finally {
      setBusyItem(null);
    }
  }

  async function sign(field: "customer_signature_file_id" | "company_signature_file_id", dataUrl: string | null) {
    setError(null);
    try {
      await handoverApi.updateChecklist(bookingId, { [field]: dataUrl });
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That didn't work.");
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {Object.entries(checklist.groups).map(([group, items]) => (
        <div key={group}>
          <h3 className="mb-2 text-footnote font-semibold uppercase tracking-wide text-fg-subtle">{GROUP_LABEL[group] ?? humanize(group)}</h3>
          <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {Object.entries(items).map(([item, val]) => (
              <li key={item}>
                <label className="flex items-center gap-2 text-footnote text-fg">
                  <input
                    type="checkbox"
                    checked={val.done}
                    disabled={!canWrite || busyItem === `${group}.${item}`}
                    onChange={(e) => toggle(group, item, e.target.checked)}
                  />
                  {humanize(item)}
                </label>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SignaturePad
          label="Customer signature"
          signedFileId={checklist.customer_signature_file_id}
          disabled={!canWrite}
          onSign={(d) => sign("customer_signature_file_id", d)}
          onClear={() => sign("customer_signature_file_id", null)}
        />
        <SignaturePad
          label="Company signature"
          signedFileId={checklist.company_signature_file_id}
          disabled={!canWrite}
          onSign={(d) => sign("company_signature_file_id", d)}
          onClear={() => sign("company_signature_file_id", null)}
        />
      </div>
      {error && <p role="alert" className="text-footnote text-overdue">{error}</p>}
    </div>
  );
}

function DetailBody({ view, bookingId, canWrite, canSchedule, onChanged }: { view: HandoverView; bookingId: string; canWrite: boolean; canSchedule: boolean; onChanged: () => void }) {
  const [configs, setConfigs] = useState<GateConfigRow[]>([]);
  const [overrideTarget, setOverrideTarget] = useState<EvaluatedGate | null>(null);
  const [busy, setBusy] = useState<"complete" | "close" | "evaluate" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    handoverApi.gateConfig().then(setConfigs).catch(() => setConfigs([]));
  }, []);

  const keysDone = !!(view.checklist.groups.keys?.all_handed_over?.done);
  const hasSignatures = !!view.checklist.customer_signature_file_id && !!view.checklist.company_signature_file_id;
  const completeBlockers: string[] = [];
  if (!view.eligible) completeBlockers.push("All hard gates must be passed or overridden");
  if (!keysDone) completeBlockers.push("Keys checklist item 'All handed over' must be done");
  if (!hasSignatures) completeBlockers.push("Both customer and company signatures are required");
  const canComplete = completeBlockers.length === 0 && view.case.status !== "COMPLETED" && view.case.status !== "CLOSED";

  async function run(key: "complete" | "close" | "evaluate", fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That didn't work.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-ws-xs font-medium ${view.eligible ? "bg-ok-soft text-ok-fg" : "bg-warn-soft text-warn-fg"}`}>
          {view.eligible ? <CircleCheck className="size-3.5" aria-hidden /> : <CircleAlert className="size-3.5" aria-hidden />}
          {view.eligible ? "Eligible for keys" : "Not eligible yet"}
        </span>
        <Badge tone="neutral">{view.case.status.replace(/_/g, " ")}</Badge>
        {view.case.predicted_date && (
          <span className="text-footnote text-fg-muted">
            Predicted {view.case.predicted_date} ({view.case.predicted_confidence?.toLowerCase() ?? "low"} confidence)
          </span>
        )}
        <Button size="sm" variant="ghost" loading={busy === "evaluate"} onClick={() => run("evaluate", () => handoverApi.evaluate(bookingId))}>
          Re-evaluate
        </Button>
      </div>

      <section>
        <h2 className="mb-3 text-title3 font-semibold">Gates</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {view.gates.map((g) => (
            <GateCard
              key={g.type}
              gate={g}
              config={resolveGateConfig(configs, view.case.project_id, g.gate_db)}
              canWrite={canWrite}
              onOverride={setOverrideTarget}
            />
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-title3 font-semibold">Appointment</h2>
        <AppointmentPanel view={view} bookingId={bookingId} canWrite={canSchedule} onChanged={onChanged} />
      </section>

      <section>
        <h2 className="mb-3 text-title3 font-semibold">Digital checklist</h2>
        <ChecklistPanel view={view} bookingId={bookingId} canWrite={canWrite} onChanged={onChanged} />
      </section>

      {error && <p role="alert" className="text-footnote text-overdue">{error}</p>}

      <div className="flex flex-col gap-2 border-t border-line pt-4">
        {!canComplete && view.case.status !== "COMPLETED" && view.case.status !== "CLOSED" && (
          <ul className="list-disc pl-5 text-footnote text-fg-muted">
            {completeBlockers.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          {view.case.status !== "COMPLETED" && view.case.status !== "CLOSED" && (
            <Button disabled={!canComplete || !canWrite} loading={busy === "complete"} onClick={() => run("complete", () => handoverApi.complete(bookingId))}>
              Complete handover
            </Button>
          )}
          {view.case.status === "COMPLETED" && (
            <Button variant="secondary" loading={busy === "close"} disabled={!canWrite} onClick={() => run("close", () => handoverApi.close(bookingId))}>
              Close case
            </Button>
          )}
          {view.case.status === "COMPLETED" && <span className="self-center text-footnote font-medium text-ontrack">Keys issued</span>}
          {view.case.status === "CLOSED" && <span className="self-center text-footnote font-medium text-fg-muted">Case closed</span>}
        </div>
      </div>

      {overrideTarget && (
        <OverrideDialog
          gate={overrideTarget}
          config={resolveGateConfig(configs, view.case.project_id, overrideTarget.gate_db)}
          bookingId={bookingId}
          onClose={() => setOverrideTarget(null)}
          onDone={() => {
            setOverrideTarget(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

export function HandoverCaseDrawer({ bookingId, roles, onClose }: { bookingId: string | null; roles: string[]; onClose: () => void }) {
  const [view, setView] = useState<HandoverView | null>(null);
  const [error, setError] = useState(false);
  const canWrite = roles.some((r) => HANDOVER_WRITE_ROLES.includes(r));
  const canSchedule = roles.some((r) => APPOINTMENT_ROLES.includes(r));

  const load = useCallback(() => {
    if (!bookingId) return;
    setError(false);
    handoverApi.getCase(bookingId).then(setView).catch(() => setError(true));
  }, [bookingId]);

  useEffect(() => {
    setView(null);
    if (bookingId) load();
  }, [bookingId, load]);

  return (
    <Drawer open={bookingId !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DrawerContent open={bookingId !== null} title={view ? `${view.case.code} · ${view.customer_name ?? "—"} · Villa ${view.unit_number}` : "Handover case"} width={640}>
        <div className="p-6">
          {error ? (
            <EmptyState icon={CircleAlert} message="Couldn't load this handover case." action={{ label: "Retry", onClick: load }} />
          ) : view === null ? (
            <div className="flex flex-col gap-2">
              <Skeleton />
              <Skeleton />
              <Skeleton />
            </div>
          ) : (
            <DetailBody view={view} bookingId={bookingId!} canWrite={canWrite} canSchedule={canSchedule} onChanged={load} />
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

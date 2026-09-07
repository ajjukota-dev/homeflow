import { useCallback, useEffect, useState } from "react";
import { Drawer, DrawerContent, Button, Badge, Skeleton, EmptyState, Select, SelectTrigger, SelectOptions, Input } from "@homeflow/ui";
import { CheckCircle2, XCircle, Landmark, Plus, Trash2 } from "lucide-react";
import { ApiError } from "../../auth/api";
import { formatIstDateTime } from "../../lib/utils";
import { registrationApi, type RegCase, type ChecklistTemplate } from "./api";
import { STATUS_META, HARD_READINESS_KEYS, READINESS_LABELS } from "./labels";
import { ExecutionPanel } from "./ExecutionPanel";

// core.ts's own REGISTRATION_ROLES/AVAILABILITY_ROLES — mirrored here rather than imported
// (backend-only module) for client-side gating, same pattern as documents/DocumentDrawer.tsx's
// local WRITE_ROLES.
const REGISTRATION_ROLES = ["REGISTRATION", "LEGAL", "MANAGEMENT", "SUPER_ADMIN"];
const AVAILABILITY_ROLES = [...REGISTRATION_ROLES, "CRM"];

function ReadinessCard({ readiness }: { readiness: RegCase["readiness"] }) {
  return (
    <div>
      <h3 className="mb-2 text-footnote font-semibold uppercase tracking-wide text-fg-subtle">Readiness (7 gate READY; availability is separate)</h3>
      <ul className="flex flex-col gap-1.5">
        {HARD_READINESS_KEYS.map((key) => {
          const f = readiness[key];
          const Icon = f.ok ? CheckCircle2 : XCircle;
          return (
            <li key={key} className="flex items-start gap-2 text-footnote">
              <Icon className={`mt-0.5 size-4 shrink-0 ${f.ok ? "text-ontrack" : "text-overdue"}`} aria-hidden />
              <span><span className="font-medium text-fg">{READINESS_LABELS[key]}:</span> <span className="text-fg-muted">{f.fact}</span></span>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex items-start gap-2 border-t border-line pt-2 text-footnote">
        {readiness.customer_availability.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ontrack" aria-hidden /> : <XCircle className="mt-0.5 size-4 shrink-0 text-fg-subtle" aria-hidden />}
        <span><span className="font-medium text-fg">{READINESS_LABELS.customer_availability}:</span> <span className="text-fg-muted">{readiness.customer_availability.fact}</span></span>
      </div>
    </div>
  );
}

function AvailabilityPanel({ reg, canWrite, onChanged }: { reg: RegCase; canWrite: boolean; onChanged: () => void }) {
  const [dates, setDates] = useState<string[]>(reg.proposed_availability_dates?.length ? reg.proposed_availability_dates : [""]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eligible = reg.status === "READY" || reg.status === "AVAILABILITY_CONFIRMED";

  if (!canWrite && !reg.proposed_availability_dates?.length) return null;

  async function submit() {
    const cleaned = dates.map((d) => d.trim()).filter(Boolean);
    if (cleaned.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await registrationApi.confirmAvailability(reg.booking_id, cleaned);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't confirm availability.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h3 className="mb-2 text-footnote font-semibold uppercase tracking-wide text-fg-subtle">Customer availability</h3>
      {reg.proposed_availability_dates?.length ? (
        <p className="mb-2 text-footnote text-fg-muted">Proposed: {reg.proposed_availability_dates.join(", ")}</p>
      ) : (
        <p className="mb-2 text-footnote text-fg-muted">No dates proposed yet.</p>
      )}
      {canWrite && eligible && (
        <div className="flex flex-col gap-2">
          {dates.map((d, i) => (
            <div key={i} className="flex items-center gap-2">
              <input type="date" value={d} onChange={(e) => setDates(dates.map((x, idx) => (idx === i ? e.target.value : x)))} className="rounded-lg border border-line bg-surface px-3 py-2 text-body" />
              <Button variant="ghost" size="sm" onClick={() => setDates(dates.filter((_, idx) => idx !== i))}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          <Button variant="ghost" size="sm" className="self-start" onClick={() => setDates([...dates, ""])}><Plus className="mr-1 h-4 w-4" />Add date</Button>
          {error && <p role="alert" className="text-footnote text-overdue">{error}</p>}
          <Button size="sm" className="self-start" onClick={submit} disabled={busy}>{busy ? "Saving…" : "Confirm availability"}</Button>
        </div>
      )}
      {canWrite && !eligible && <p className="text-footnote text-fg-subtle">Case must be READY before availability can be confirmed.</p>}
    </div>
  );
}

function SlotPanel({ reg, template, canWrite, onChanged }: { reg: RegCase; template: ChecklistTemplate | null; canWrite: boolean; onChanged: () => void }) {
  const [sroOffice, setSroOffice] = useState(reg.sro_office ?? "");
  const [slotDatetime, setSlotDatetime] = useState(reg.slot_datetime?.slice(0, 16) ?? "");
  const [reference, setReference] = useState(reg.slot_reference ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allHardOk = HARD_READINESS_KEYS.every((k) => reg.readiness[k].ok);
  const canBook = allHardOk && !!reg.proposed_availability_dates?.length && (reg.status === "READY" || reg.status === "AVAILABILITY_CONFIRMED");
  const canReschedule = reg.status === "SLOT_BOOKED";
  const sroOptions = template?.sro_offices ?? [];

  async function book() {
    if (!sroOffice.trim() || !slotDatetime) return;
    setBusy(true);
    setError(null);
    try {
      await registrationApi.bookSlot(reg.booking_id, { sro_office: sroOffice.trim(), slot_datetime: new Date(slotDatetime).toISOString(), reference: reference.trim() });
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't book the slot.");
    } finally {
      setBusy(false);
    }
  }

  async function reschedule() {
    if (!slotDatetime || !reason.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await registrationApi.reschedule(reg.booking_id, { slot_datetime: new Date(slotDatetime).toISOString(), reason: reason.trim() });
      setReason("");
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't reschedule.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h3 className="mb-2 text-footnote font-semibold uppercase tracking-wide text-fg-subtle">SRO slot</h3>
      {reg.slot_datetime ? (
        <p className="mb-2 text-footnote text-fg-muted">Booked: {formatIstDateTime(reg.slot_datetime)} · {reg.sro_office}{reg.slot_reference ? ` · ref ${reg.slot_reference}` : ""}</p>
      ) : (
        <p className="mb-2 text-footnote text-fg-muted">No slot booked yet.</p>
      )}

      {canWrite && canBook && (
        <div className="flex flex-col gap-2">
          {sroOptions.length > 0 ? (
            <Select value={sroOffice} onValueChange={setSroOffice}>
              <SelectTrigger placeholder="SRO office" />
              <SelectOptions options={sroOptions.map((o) => ({ value: o, label: o }))} />
            </Select>
          ) : (
            // sro_offices ships empty until Policy Studio is configured for this project/jurisdiction
            // (23-registration.md's own Build note) — free-text fallback instead of a broken dropdown.
            <Input value={sroOffice} onChange={(e) => setSroOffice(e.target.value)} placeholder="SRO office (not yet configured in Policy Studio — type it)" />
          )}
          <input type="datetime-local" value={slotDatetime} onChange={(e) => setSlotDatetime(e.target.value)} className="rounded-lg border border-line bg-surface px-3 py-2 text-body" />
          <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Booking reference (optional)" />
          {error && <p role="alert" className="text-footnote text-overdue">{error}</p>}
          <Button size="sm" className="self-start" onClick={book} disabled={busy || !sroOffice.trim() || !slotDatetime}>{busy ? "Booking…" : "Book slot"}</Button>
        </div>
      )}
      {canWrite && !canBook && !canReschedule && (
        <p className="text-footnote text-fg-subtle">Readiness and confirmed availability are required before booking.</p>
      )}

      {canWrite && canReschedule && (
        <div className="mt-2 flex flex-col gap-2 border-t border-line pt-2">
          <p className="text-caption font-semibold uppercase tracking-wide text-fg-subtle">Reschedule</p>
          <input type="datetime-local" value={slotDatetime} onChange={(e) => setSlotDatetime(e.target.value)} className="rounded-lg border border-line bg-surface px-3 py-2 text-body" />
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)" />
          {error && <p role="alert" className="text-footnote text-overdue">{error}</p>}
          <Button size="sm" variant="ghost" className="self-start" onClick={reschedule} disabled={busy || !slotDatetime || !reason.trim()}>{busy ? "Saving…" : "Reschedule"}</Button>
        </div>
      )}

      {reg.slot_history.length > 0 && (
        <div className="mt-3 border-t border-line pt-2">
          <p className="mb-1 text-caption font-semibold uppercase tracking-wide text-fg-subtle">History</p>
          <ul className="flex flex-col gap-1">
            {reg.slot_history.map((h, i) => (
              // `by` is a raw user_id with no display-name resolution reachable by REGISTRATION/
              // LEGAL roles (GET /api/users requires "administration" WRITE) — omitted rather than
              // shown raw (CLAUDE.md: never render a raw id).
              <li key={i} className="text-footnote text-fg-muted">
                {formatIstDateTime(h.at)} — {h.from ? `${formatIstDateTime(h.from)} → ` : ""}{formatIstDateTime(h.to)}{h.reason ? ` (${h.reason})` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ChecklistPanel({ reg, template, canWrite, onChanged }: { reg: RegCase; template: ChecklistTemplate | null; canWrite: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  if (reg.status !== "SLOT_BOOKED" && reg.status !== "EXECUTED" && reg.status !== "COMPLETED") return null;
  const items = template?.day_of_items ?? [];

  async function toggle(key: string, value: boolean) {
    setBusy(key);
    try {
      await registrationApi.updateDayOfChecklist(reg.booking_id, { [key]: value });
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <h3 className="mb-2 text-footnote font-semibold uppercase tracking-wide text-fg-subtle">Day-of checklist</h3>
      {items.length === 0 && <p className="text-footnote text-fg-muted">No day-of checklist items configured for this project's jurisdiction yet.</p>}
      <ul className="flex flex-col gap-1.5">
        {items.map((item) => {
          const done = !!reg.day_of_checklist[item.key];
          return (
            <li key={item.key} className="flex items-center gap-2 text-footnote">
              <input
                type="checkbox"
                id={`dayof-${item.key}`}
                checked={done}
                disabled={!canWrite || reg.status !== "SLOT_BOOKED" || busy === item.key}
                onChange={(e) => toggle(item.key, e.target.checked)}
              />
              <label htmlFor={`dayof-${item.key}`} className={done ? "text-fg" : "text-fg-muted"}>{item.label}</label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function CaseDrawer({ bookingId, roles, onClose, onChanged }: { bookingId: string | null; roles: string[]; onClose: () => void; onChanged?: () => void }) {
  const canWrite = roles.some((r) => REGISTRATION_ROLES.includes(r));
  const canConfirmAvailability = roles.some((r) => AVAILABILITY_ROLES.includes(r));
  const [reg, setReg] = useState<RegCase | null>(null);
  const [template, setTemplate] = useState<ChecklistTemplate | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    if (!bookingId) return;
    setError(false);
    Promise.all([registrationApi.get(bookingId), registrationApi.listChecklistTemplates()])
      .then(([r, templates]) => {
        setReg(r);
        // Best-effort client-side match of loadTemplate's project -> jurisdiction -> global
        // fallback (the jurisdiction itself isn't available client-side); used only to render
        // checklist labels/SRO options, never to enforce the gate (server re-checks on every write).
        setTemplate(templates.find((t) => t.project_id === r.project_id) ?? templates.find((t) => t.project_id === null) ?? null);
      })
      .catch(() => setError(true));
  }, [bookingId]);

  useEffect(() => { setReg(null); load(); }, [bookingId, load]);

  function notifyThenReload() { load(); onChanged?.(); }

  return (
    <Drawer open={bookingId !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DrawerContent open={bookingId !== null} title={reg ? reg.code : "Registration"} width={640}>
        {error && <EmptyState icon={Landmark} message="Couldn't reach the API on :3001." />}
        {!error && !reg && (
          <div className="flex flex-col gap-3">
            <Skeleton variant="text" /><Skeleton variant="text" /><Skeleton variant="text" />
          </div>
        )}
        {!error && reg && (
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={STATUS_META[reg.status].className}>{STATUS_META[reg.status].label}</Badge>
              {reg.forecast_date && <Badge className="bg-surface-2 text-fg-subtle">Forecast {reg.forecast_date}</Badge>}
            </div>

            <ReadinessCard readiness={reg.readiness} />
            <AvailabilityPanel reg={reg} canWrite={canConfirmAvailability} onChanged={notifyThenReload} />
            <SlotPanel reg={reg} template={template} canWrite={canWrite} onChanged={notifyThenReload} />
            <ChecklistPanel reg={reg} template={template} canWrite={canWrite} onChanged={notifyThenReload} />
            <ExecutionPanel reg={reg} canWrite={canWrite} onChanged={notifyThenReload} />
          </div>
        )}
      </DrawerContent>
    </Drawer>
  );
}

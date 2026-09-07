import { useEffect, useState } from "react";
import { Button, Input, Select, SelectTrigger, SelectOptions } from "@homeflow/ui";
import { ExternalLink } from "lucide-react";
import { ApiError } from "../../auth/api";
import { documentsApi, type DocumentRow } from "../documents/api";
import { registrationApi, type RegCase } from "./api";

/** Execution (rule 5) + completion (rule 3) — split from CaseDrawer.tsx to keep that file under
 *  the SOLID single-responsibility line length. */
export function ExecutionPanel({ reg, canWrite, onChanged }: { reg: RegCase; canWrite: boolean; onChanged: () => void }) {
  const [executedOn, setExecutedOn] = useState(new Date().toISOString().slice(0, 10));
  const [docNumber, setDocNumber] = useState(reg.registration_document_number ?? "");
  const [representative, setRepresentative] = useState(reg.company_representative ?? "");
  const [stampDuty, setStampDuty] = useState(reg.stamp_duty_inr?.toString() ?? "");
  const [regFee, setRegFee] = useState(reg.registration_fee_inr?.toString() ?? "");
  const [notes, setNotes] = useState(reg.outcome_notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [deeds, setDeeds] = useState<DocumentRow[] | null>(null);
  const [deedId, setDeedId] = useState("");
  const [sroReference, setSroReference] = useState(reg.sro_reference ?? "");
  const [registeredDeed, setRegisteredDeed] = useState<DocumentRow | null>(null);

  const missingDayOf = Object.entries(reg.day_of_checklist).filter(([, v]) => !v).map(([k]) => k);

  useEffect(() => {
    if (reg.status !== "EXECUTED") return;
    documentsApi.list({ booking_id: reg.booking_id, family_code: "SALE_DEED" }).then((docs) => setDeeds(docs.filter((d) => d.status === "FINAL" || d.status === "ARCHIVED")));
  }, [reg.status, reg.booking_id]);

  useEffect(() => {
    if (reg.status !== "COMPLETED" || !reg.registered_deed_file_id) return;
    documentsApi.get(reg.registered_deed_file_id).then(setRegisteredDeed).catch(() => setRegisteredDeed(null));
  }, [reg.status, reg.registered_deed_file_id]);

  async function execute() {
    if (!docNumber.trim()) { setError("Registration document number is required (also needed to complete the case)."); return; }
    setBusy(true);
    setError(null);
    try {
      await registrationApi.execute(reg.booking_id, {
        executed_on: executedOn,
        registration_document_number: docNumber.trim(),
        company_representative: representative.trim() || undefined,
        stamp_duty_inr: stampDuty ? Number(stampDuty) : undefined,
        registration_fee_inr: regFee ? Number(regFee) : undefined,
        outcome_notes: notes.trim() || undefined,
      });
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't record execution.");
    } finally {
      setBusy(false);
    }
  }

  async function complete() {
    if (!deedId || !sroReference.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await registrationApi.complete(reg.booking_id, { deed_document_id: deedId, sro_reference: sroReference.trim() });
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't complete the case.");
    } finally {
      setBusy(false);
    }
  }

  if (reg.status === "SLOT_BOOKED") {
    if (!canWrite) return null;
    return (
      <div>
        <h3 className="mb-2 text-footnote font-semibold uppercase tracking-wide text-fg-subtle">Record execution</h3>
        {missingDayOf.length > 0 && (
          <p className="mb-2 text-footnote text-overdue">Blocked — day-of checklist incomplete: {missingDayOf.join(", ")}</p>
        )}
        <div className="flex flex-col gap-2">
          <input type="date" value={executedOn} onChange={(e) => setExecutedOn(e.target.value)} className="rounded-lg border border-line bg-surface px-3 py-2 text-body" />
          <Input value={docNumber} onChange={(e) => setDocNumber(e.target.value)} placeholder="Registration document number" />
          <Input value={representative} onChange={(e) => setRepresentative(e.target.value)} placeholder="Company representative (optional)" />
          <Input value={stampDuty} onChange={(e) => setStampDuty(e.target.value)} placeholder="Stamp duty (INR, optional)" type="number" />
          <Input value={regFee} onChange={(e) => setRegFee(e.target.value)} placeholder="Registration fee (INR, optional)" type="number" />
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Outcome notes (optional)" />
          {error && <p role="alert" className="text-footnote text-overdue">{error}</p>}
          <Button size="sm" className="self-start" onClick={execute} disabled={busy || missingDayOf.length > 0 || !docNumber.trim()}>{busy ? "Recording…" : "Record execution"}</Button>
        </div>
      </div>
    );
  }

  if (reg.status === "EXECUTED") {
    if (!canWrite) return null;
    return (
      <div>
        <h3 className="mb-2 text-footnote font-semibold uppercase tracking-wide text-fg-subtle">Complete registration</h3>
        <p className="mb-2 text-footnote text-fg-muted">Registration document {reg.registration_document_number ?? "—"}, executed {reg.executed_on ?? "—"}.</p>
        {deeds === null && <p className="text-footnote text-fg-muted">Loading sale deed…</p>}
        {deeds !== null && deeds.length === 0 && (
          <p className="text-footnote text-overdue">No FINAL or ARCHIVED sale deed found for this booking in the Document Factory — generate and execute one there first.</p>
        )}
        {deeds !== null && deeds.length > 0 && (
          <div className="flex flex-col gap-2">
            <Select value={deedId} onValueChange={setDeedId}>
              <SelectTrigger placeholder="Sale deed document" />
              <SelectOptions options={deeds.map((d) => ({ value: d.id, label: `${d.code} · v${d.version}` }))} />
            </Select>
            {deedId && (
              <a href={`/api/files/${deeds.find((d) => d.id === deedId)?.pdf_file_key}`} target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-1 text-footnote font-medium text-accent underline">
                View deed <ExternalLink className="size-3.5" aria-hidden />
              </a>
            )}
            <Input value={sroReference} onChange={(e) => setSroReference(e.target.value)} placeholder="SRO reference" />
            {error && <p role="alert" className="text-footnote text-overdue">{error}</p>}
            <Button size="sm" className="self-start" onClick={complete} disabled={busy || !deedId || !sroReference.trim()}>{busy ? "Completing…" : "Complete registration"}</Button>
          </div>
        )}
      </div>
    );
  }

  if (reg.status === "COMPLETED") {
    return (
      <div>
        <h3 className="mb-2 text-footnote font-semibold uppercase tracking-wide text-fg-subtle">Completed</h3>
        <p className="text-footnote text-fg-muted">
          Document {reg.registration_document_number ?? "—"} · SRO ref {reg.sro_reference ?? "—"}{reg.completed_at ? ` · ${reg.completed_at.slice(0, 10)}` : ""}
        </p>
        {registeredDeed?.pdf_file_key && (
          <a href={`/api/files/${registeredDeed.pdf_file_key}`} target="_blank" rel="noreferrer" className="mt-1 inline-flex w-fit items-center gap-1 text-footnote font-medium text-accent underline">
            Registered sale deed <ExternalLink className="size-3.5" aria-hidden />
          </a>
        )}
      </div>
    );
  }

  return null;
}

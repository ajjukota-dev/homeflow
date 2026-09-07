import { useCallback, useEffect, useState } from "react";
import { Button, Input, Textarea, Select, SelectTrigger, SelectOptions, EmptyState } from "@homeflow/ui";
import { ScrollText, Plus } from "lucide-react";
import { ApiError } from "../../auth/api";
import { postHandoverApi, type ServiceHistoryRow } from "./api";

const KINDS = ["MAINTENANCE", "INSPECTION", "UPGRADE"];

function AddRecordForm({ unitId, onAdded }: { unitId: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("MAINTENANCE");
  const [description, setDescription] = useState("");
  const [costInr, setCostInr] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Plus className="mr-1.5 size-4" aria-hidden /> Add service record
      </Button>
    );
  }

  async function add() {
    if (!description.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await postHandoverApi.addServiceRecord({ unit_id: unitId, kind, description: description.trim(), cost_inr: costInr ? Number(costInr) : null });
      setOpen(false);
      setDescription(""); setCostInr("");
      onAdded();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-2 p-3">
      <Select value={kind} onValueChange={setKind}>
        <SelectTrigger placeholder="Kind" />
        <SelectOptions options={KINDS.map((k) => ({ value: k, label: k }))} />
      </Select>
      <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What was done" rows={2} />
      <Input value={costInr} onChange={(e) => setCostInr(e.target.value)} placeholder="Cost (INR, optional)" type="number" />
      {error && <p role="alert" className="text-footnote text-overdue">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        <Button size="sm" onClick={add} disabled={busy || !description.trim()}>{busy ? "Saving…" : "Save"}</Button>
      </div>
    </div>
  );
}

/** Screens: "service history" — append-only, visible in the portal passport (26) too. WARRANTY_FIX
 *  records are written automatically by `resolveWarrantyCase`, never entered here by hand — this
 *  form only covers the other 3 kinds a warranty case doesn't already produce.
 *
 *  `event_type` carries two vocabularies (30's own backend build note): dotted legacy names
 *  (`unit.handover_completed` etc.) alongside the newer `kind` values this spec's own inserts use.
 *  Shown honestly — `kind` first when present, the raw legacy `event_type` only as a fallback,
 *  never invented into a fake unified label. */
export function ServiceHistoryPanel({ unitId, canWrite }: { unitId: string; canWrite: boolean }) {
  const [rows, setRows] = useState<ServiceHistoryRow[] | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    setError(false);
    postHandoverApi.serviceHistory(unitId).then(setRows).catch(() => setError(true));
  }, [unitId]);

  useEffect(load, [load]);

  if (error) return <EmptyState icon={ScrollText} message="Couldn't reach the API on :3001." action={{ label: "Retry", onClick: load }} />;
  if (rows === null) return <p className="text-footnote text-fg-muted">Loading…</p>;

  return (
    <div className="flex flex-col gap-3">
      {canWrite && <AddRecordForm unitId={unitId} onAdded={load} />}
      {rows.length === 0 ? (
        <p className="text-footnote text-fg-muted">No service history recorded yet.</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.id} className="rounded-lg border border-line p-3 text-footnote">
              <p className="font-semibold text-fg">{r.kind ?? r.event_type}{r.cost_inr ? ` · ₹${Number(r.cost_inr).toLocaleString("en-IN")}` : ""}</p>
              <p className="text-fg-muted">{r.description}</p>
              <p className="text-caption text-fg-subtle">{r.actor} · {String(r.occurred_at).slice(0, 10)}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

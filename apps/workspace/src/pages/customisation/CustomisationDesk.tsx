import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardBody, Button, Dialog, DialogContent, Field, Select, SelectTrigger, SelectOptions, Input, Textarea } from "@homeflow/ui";
import { Hammer } from "lucide-react";
import { api } from "../../api";
import { ApiError } from "../../auth/api";
import { changeRequestsApi, type ChangeRequest, type CrStatus } from "./api";
import { CR_STATUS_ORDER, CR_STATUS_LABEL, CHANGE_CATEGORIES, CATEGORY_LABEL } from "./labels";
import { CrDrawer } from "./CrDrawer";

// 18-change-requests.md Screens: "Customisation desk (Customisation role): kanban by status".
// Every one of the state machine's 17 statuses gets its own column (rather than collapsing
// terminal ones away) — the row scrolls horizontally like Control Tower's own tab row
// (shrink-0/whitespace-nowrap on each column; the same fix this session already made for
// tab rows applies equally to kanban columns sharing an overflow-x-auto parent).
const WRITE_ROLES = ["CUSTOMISATION", "MANAGEMENT", "SUPER_ADMIN"]; // mirrors change-requests/capture.ts's CUSTOMISATION_DESK_ROLES exactly

function RaiseRequestDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [bookings, setBookings] = useState<{ id: string; unit_number: string; applicant_name?: string | null; booking_number: string }[]>([]);
  const [bookingId, setBookingId] = useState("");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [category, setCategory] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) api.listBookings("active").then(setBookings).catch(() => setBookings([]));
  }, [open]);

  function reset() {
    setBookingId(""); setTitle(""); setSummary(""); setCategory(""); setError(null);
  }

  async function submit() {
    if (!bookingId || !title.trim()) return setError("A booking and a title are required.");
    setBusy(true);
    setError(null);
    try {
      await changeRequestsApi.raise(bookingId, { title: title.trim(), summary: summary.trim() || undefined, primary_category_code: category || undefined, raised_by_kind: "CUSTOMISATION" });
      setOpen(false);
      reset();
      onCreated();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <Button onClick={() => setOpen(true)}>+ Raise request</Button>
      <DialogContent title="Raise a change request" description="Capture is never blocked by a closed gate — it is routed (rule 1).">
        <div className="flex flex-col gap-3">
          <Field label="Booking" htmlFor="cr-booking" required>
            <Select value={bookingId} onValueChange={setBookingId}>
              <SelectTrigger id="cr-booking" placeholder="Select a booking" />
              <SelectOptions options={bookings.map((b) => ({ value: b.id, label: `Villa ${b.unit_number} — ${b.applicant_name ?? "—"} (${b.booking_number})` }))} />
            </Select>
          </Field>
          <Field label="Category" htmlFor="cr-category" hint="Determines which gate this request is routed against.">
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id="cr-category" placeholder="Select a category" />
              <SelectOptions options={CHANGE_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))} />
            </Select>
          </Field>
          <Field label="Title" htmlFor="cr-title" required>
            <Input id="cr-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Flooring upgrade" />
          </Field>
          <Field label="Summary" htmlFor="cr-summary">
            <Textarea id="cr-summary" value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} />
          </Field>
          {error && <p role="alert" className="text-footnote text-overdue">{error}</p>}
          <Button onClick={submit} disabled={busy || !bookingId || !title.trim()}>{busy ? "Raising…" : "Raise request"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CrCard({ cr, onOpen }: { cr: ChangeRequest; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="w-full rounded-lg border border-line bg-surface p-3 text-left transition-colors hover:border-accent">
      <div className="text-caption font-medium uppercase tracking-wide text-fg-subtle">{cr.code}</div>
      <div className="mt-1 text-subhead font-semibold text-fg">{cr.title}</div>
      <div className="mt-1 text-footnote text-fg-muted">
        Villa {cr.unit_number ?? "—"} · {cr.booking_number ?? "—"}
      </div>
    </button>
  );
}

/** 18-change-requests.md's primary Screen. Detail (feasibility/costing/approvals/quotation/
 *  payment/release/execution/QA/as-built/economics) lives in CrDrawer.tsx. */
export function CustomisationDesk({ projectId, roles }: { projectId: string; roles: string[] }) {
  const canWrite = roles.some((r) => WRITE_ROLES.includes(r));
  const [items, setItems] = useState<ChangeRequest[] | null>(null);
  const [error, setError] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!projectId) return;
    setError(false);
    changeRequestsApi.list({ project_id: projectId }).then(setItems).catch(() => setError(true));
  }, [projectId]);

  useEffect(load, [load]);

  const byStatus = useMemo(() => {
    const map = new Map<CrStatus, ChangeRequest[]>();
    for (const it of items ?? []) {
      if (!map.has(it.status)) map.set(it.status, []);
      map.get(it.status)!.push(it);
    }
    return map;
  }, [items]);

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-large font-bold">Customisation desk</h1>
          <p className="mt-1 max-w-2xl text-subhead text-fg-muted">
            Every customer change request, one board — capture, feasibility, costing, approval, quotation, release, QA, as-built.
          </p>
        </div>
        {canWrite && <RaiseRequestDialog onCreated={load} />}
      </header>

      {error && (
        <Card>
          <CardBody className="text-subhead text-overdue">Couldn't reach the API on :3001.</CardBody>
        </Card>
      )}
      {!error && items === null && (
        <div className="flex gap-3 overflow-x-auto" aria-busy="true" aria-label="Loading change requests">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-48 w-64 shrink-0 animate-pulse rounded-xl border border-line bg-surface-2" />
          ))}
        </div>
      )}
      {!error && items !== null && items.length === 0 && (
        <Card>
          <CardBody className="flex flex-col items-center gap-2 py-10 text-center">
            <Hammer className="h-8 w-8 text-fg-subtle" />
            <p className="text-subhead text-fg-muted">No change requests yet for this project.</p>
          </CardBody>
        </Card>
      )}
      {!error && items !== null && items.length > 0 && (
        <div className="overflow-x-auto pb-2">
          <div className="flex gap-3">
            {CR_STATUS_ORDER.filter((s) => (byStatus.get(s)?.length ?? 0) > 0).map((status) => (
              <div key={status} className="w-72 shrink-0">
                <div className="mb-2 flex items-center gap-2 px-1">
                  <h2 className="text-footnote font-semibold uppercase tracking-wide text-fg-subtle">{CR_STATUS_LABEL[status]}</h2>
                  <span className="rounded-full bg-surface-2 px-1.5 text-caption text-fg-muted">{byStatus.get(status)!.length}</span>
                </div>
                <div className="flex flex-col gap-2">
                  {byStatus.get(status)!.map((cr) => (
                    <CrCard key={cr.id} cr={cr} onOpen={() => setOpenId(cr.id)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <CrDrawer crId={openId} roles={roles} onClose={() => setOpenId(null)} onChanged={load} />
    </div>
  );
}

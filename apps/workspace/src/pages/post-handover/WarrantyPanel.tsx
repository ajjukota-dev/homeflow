import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Input, Textarea, Select, SelectTrigger, SelectOptions, EmptyState } from "@homeflow/ui";
import { Wrench, Plus } from "lucide-react";
import { ApiError } from "../../auth/api";
import { postHandoverApi, WARRANTY_STATUS_LABEL, type WarrantyCaseRow, type WarrantyStatus, type Contractor } from "./api";

const SEVERITIES = ["CRITICAL", "MAJOR", "MINOR"];
const STATUS_TONE: Record<WarrantyStatus, string> = {
  open: "bg-due/10 text-due", triaged: "bg-accent/10 text-accent", assigned: "bg-accent/10 text-accent",
  in_progress: "bg-accent/10 text-accent", resolved: "bg-ontrack/10 text-ontrack",
  closed: "bg-surface-2 text-fg-subtle", rejected: "bg-overdue/10 text-overdue",
};

function CreateCaseForm({ unitId, bookingId, onCreated }: { unitId: string; bookingId: string; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("");
  const [trade, setTrade] = useState("");
  const [severity, setSeverity] = useState("MINOR");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Plus className="mr-1.5 size-4" aria-hidden /> Raise warranty case
      </Button>
    );
  }

  async function create() {
    if (!category.trim() || !trade.trim() || !description.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await postHandoverApi.createWarrantyCase({ unit_id: unitId, booking_id: bookingId, category: category.trim(), trade: trade.trim(), severity, description: description.trim(), raised_by_kind: "FM" });
      setOpen(false);
      setCategory(""); setTrade(""); setDescription("");
      onCreated();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't raise the case.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-2 p-3">
      <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Category (e.g. WATERPROOFING)" />
      <Input value={trade} onChange={(e) => setTrade(e.target.value)} placeholder="Trade (e.g. plumbing)" />
      <Select value={severity} onValueChange={setSeverity}>
        <SelectTrigger placeholder="Severity" />
        <SelectOptions options={SEVERITIES.map((s) => ({ value: s, label: s }))} />
      </Select>
      <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What's wrong?" rows={2} />
      {error && <p role="alert" className="text-footnote text-overdue">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        <Button size="sm" onClick={create} disabled={busy || !category.trim() || !trade.trim() || !description.trim()}>{busy ? "Raising…" : "Raise case"}</Button>
      </div>
    </div>
  );
}

function CaseActions({ c, contractors, onChanged }: { c: WarrantyCaseRow; contractors: Contractor[]; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contractorId, setContractorId] = useState("");
  const [quoteInr, setQuoteInr] = useState("");
  const [waiveReason, setWaiveReason] = useState("");
  const [costInr, setCostInr] = useState("");
  const [rootCause, setRootCause] = useState("");
  const [rejectReason, setRejectReason] = useState("");

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

  return (
    <div className="mt-2 flex flex-col gap-2 border-t border-line pt-2 text-footnote">
      {error && <p role="alert" className="text-overdue">{error}</p>}

      {c.status === "open" && (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => run(() => postHandoverApi.triage(c.id))} disabled={busy}>Triage</Button>
          <Input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Reject reason" className="max-w-[220px]" />
          <Button size="sm" variant="ghost" onClick={() => run(() => postHandoverApi.reject(c.id, rejectReason))} disabled={busy || !rejectReason.trim()}>Reject</Button>
        </div>
      )}

      {c.status === "triaged" && (
        <>
          <p className="text-fg-muted">{c.in_coverage ? `In coverage (${c.coverage_basis})` : "Out of coverage — needs a quote or an FM waiver before assignment"}</p>
          {!c.in_coverage && !c.quote_inr && (
            <div className="flex gap-2">
              <Input value={quoteInr} onChange={(e) => setQuoteInr(e.target.value)} placeholder="Quote (INR)" type="number" className="max-w-[160px]" />
              <Button size="sm" onClick={() => run(() => postHandoverApi.quote(c.id, Number(quoteInr)))} disabled={busy || !quoteInr}>Issue quote</Button>
            </div>
          )}
          {!c.in_coverage && c.quote_inr && !c.quote_accepted_at && !c.waived_reason && (
            <div className="flex flex-wrap items-center gap-2">
              <span>Quote ₹{Number(c.quote_inr).toLocaleString("en-IN")}</span>
              <Button size="sm" onClick={() => run(() => postHandoverApi.acceptQuote(c.id))} disabled={busy}>Record acceptance</Button>
              <Input value={waiveReason} onChange={(e) => setWaiveReason(e.target.value)} placeholder="Waiver reason" className="max-w-[200px]" />
              <Button size="sm" variant="ghost" onClick={() => run(() => postHandoverApi.waiveQuote(c.id, waiveReason))} disabled={busy || !waiveReason.trim()}>Waive</Button>
            </div>
          )}
          {(c.in_coverage || c.quote_accepted_at || c.waived_reason) && (
            <div className="flex gap-2">
              <Select value={contractorId} onValueChange={setContractorId}>
                <SelectTrigger placeholder="Contractor" className="max-w-[200px]" />
                <SelectOptions options={contractors.map((ct) => ({ value: ct.id, label: ct.name }))} />
              </Select>
              <Button size="sm" onClick={() => run(() => postHandoverApi.assign(c.id, contractorId))} disabled={busy || !contractorId}>Assign</Button>
            </div>
          )}
        </>
      )}

      {c.status === "assigned" && (
        <Button size="sm" onClick={() => run(() => postHandoverApi.start(c.id))} disabled={busy}>Start work</Button>
      )}

      {c.status === "in_progress" && (
        <div className="flex flex-wrap gap-2">
          <Input value={costInr} onChange={(e) => setCostInr(e.target.value)} placeholder="Cost (INR, optional)" type="number" className="max-w-[160px]" />
          <Input value={rootCause} onChange={(e) => setRootCause(e.target.value)} placeholder="Root cause (optional)" className="max-w-[200px]" />
          <Button size="sm" onClick={() => run(() => postHandoverApi.resolve(c.id, { cost_inr: costInr ? Number(costInr) : null, root_cause_code: rootCause.trim() || null }))} disabled={busy}>Resolve</Button>
        </div>
      )}

      {c.status === "resolved" && (
        <div className="flex flex-wrap items-center gap-2">
          {c.raised_by_kind === "CUSTOMER_PORTAL" && !c.customer_verified_at && (
            <span className="text-fg-subtle">Waiting on customer verification before this can close.</span>
          )}
          {(c.raised_by_kind !== "CUSTOMER_PORTAL" || c.customer_verified_at) && (
            <Button size="sm" onClick={() => run(() => postHandoverApi.close(c.id))} disabled={busy}>Close case</Button>
          )}
        </div>
      )}
    </div>
  );
}

/** Screens: "warranty cases table" inside the case view. Full rule 2/3 lifecycle
 *  (open→triaged→assigned→in_progress→resolved→closed, or rejected) driven from
 *  `post-handover/warranty.ts`'s own real state machine — every transition button here maps
 *  1:1 to a real server-side `assertFrom` guard, no client-only status faking. */
export function WarrantyPanel({ unitId, bookingId, canWrite }: { unitId: string; bookingId: string; canWrite: boolean }) {
  const [cases, setCases] = useState<WarrantyCaseRow[] | null>(null);
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(false);
    Promise.all([postHandoverApi.warrantyCases({ unit_id: unitId }), postHandoverApi.contractors()])
      .then(([c, ct]) => { setCases(c); setContractors(ct); })
      .catch(() => setError(true));
  }, [unitId]);

  useEffect(load, [load]);

  if (error) return <EmptyState icon={Wrench} message="Couldn't reach the API on :3001." action={{ label: "Retry", onClick: load }} />;
  if (cases === null) return <p className="text-footnote text-fg-muted">Loading…</p>;

  return (
    <div className="flex flex-col gap-3">
      {canWrite && <CreateCaseForm unitId={unitId} bookingId={bookingId} onCreated={load} />}

      {cases.length === 0 ? (
        <p className="text-footnote text-fg-muted">No warranty work raised for this home.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {cases.map((c) => (
            <li key={c.id} className="rounded-lg border border-line p-3">
              <button className="flex w-full items-start justify-between gap-2 text-left" onClick={() => setExpanded(expanded === c.id ? null : c.id)}>
                <div>
                  <p className="text-footnote font-semibold text-fg">{c.category} · {c.trade}</p>
                  <p className="text-caption text-fg-muted">{c.description}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Badge className={STATUS_TONE[c.status]}>{WARRANTY_STATUS_LABEL[c.status]}</Badge>
                  <span className="text-caption text-fg-subtle">{c.severity}{c.in_coverage === false ? " · Chargeable" : c.in_coverage ? " · Covered" : ""}</span>
                </div>
              </button>
              {expanded === c.id && canWrite && c.status !== "closed" && c.status !== "rejected" && (
                <CaseActions c={c} contractors={contractors} onChanged={load} />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

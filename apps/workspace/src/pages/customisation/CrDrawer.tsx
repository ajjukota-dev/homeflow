import { useCallback, useEffect, useState } from "react";
import { Drawer, DrawerContent, KeyValue, Badge, Button, Skeleton, EmptyState, Field, Textarea, Input, Select, SelectTrigger, SelectOptions } from "@homeflow/ui";
import { CircleAlert } from "lucide-react";
import { ApiError } from "../../auth/api";
import { formatINR } from "../../ui/MoneyFigure";
import { formatIstDateTime } from "../../lib/utils";
import { changeRequestsApi, type ChangeRequest, type CrItem, type Quotation, type CrApproval, type CrExecutionAction, type CrEconomics } from "./api";
import { CR_STATUS_LABEL, CATEGORY_LABEL } from "./labels";
import { ItemsEditor } from "./ItemsEditor";

const CUSTOMISATION_DESK_ROLES = ["CUSTOMISATION", "MANAGEMENT", "SUPER_ADMIN"]; // mirrors change-requests/capture.ts
const WAIVER_AUTHORITY_ROLES = ["MANAGEMENT", "SUPER_ADMIN"]; // mirrors change-requests/release.ts's WAIVER_AUTHORITY_ROLES
const CANCEL_ROLES = ["MANAGEMENT", "SUPER_ADMIN"]; // mirrors change-requests/cancellation.ts's CANCEL_ROLES

function fmtDate(d: string | null): string {
  return d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";
}

type Bundle = { cr: ChangeRequest; items: CrItem[]; quotation: Quotation | null; approvals: CrApproval[]; executions: CrExecutionAction[]; economics: CrEconomics | null };

async function loadBundle(id: string): Promise<Bundle> {
  const cr = await changeRequestsApi.get(id);
  const [items, approvals, executions] = await Promise.all([
    changeRequestsApi.items(id).catch(() => []),
    changeRequestsApi.approvals(id).catch(() => []),
    changeRequestsApi.executionActions(id).catch(() => []),
  ]);
  const quotation = cr.quotation_id ? await changeRequestsApi.quotation(cr.quotation_id).catch(() => null) : null;
  const economics = items.length > 0 ? await changeRequestsApi.economics(id).catch(() => null) : null;
  return { cr, items, quotation, approvals, executions, economics };
}

function GateSummary({ cr }: { cr: ChangeRequest }) {
  const entries = Object.entries(cr.gate_summary_at_request);
  if (entries.length === 0) return null;
  return (
    <div>
      <h3 className="mb-1 text-ws-sm font-medium text-fg">Gate summary at request</h3>
      <div className="flex flex-wrap gap-1.5">
        {entries.map(([cat, state]) => (
          <Badge key={cat}>{CATEGORY_LABEL[cat] ?? cat}: {state}</Badge>
        ))}
      </div>
    </div>
  );
}

function FeasibilityPanel({ cr, roles, onDone }: { cr: ChangeRequest; roles: string[]; onDone: () => void }) {
  const canWrite = roles.some((r) => ["CUSTOMISATION", "SITE", "MANAGEMENT", "SUPER_ADMIN"].includes(r));
  const [result, setResult] = useState<"FEASIBLE" | "FEASIBLE_WITH_CONDITIONS" | "NOT_FEASIBLE">("FEASIBLE");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canWrite) return null;
  async function submit() {
    if (!notes.trim()) return setError("Technical notes are required.");
    setBusy(true);
    setError(null);
    try {
      await changeRequestsApi.feasibility(cr.id, { result, technical_notes: notes.trim() });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface-raised p-3">
      <h3 className="text-ws-sm font-medium text-fg">Feasibility review (rule 2)</h3>
      <Field label="Result" htmlFor="cr-feas-result">
        <Select value={result} onValueChange={(v) => setResult(v as typeof result)}>
          <SelectTrigger id="cr-feas-result" />
          <SelectOptions options={[
            { value: "FEASIBLE", label: "Feasible" },
            { value: "FEASIBLE_WITH_CONDITIONS", label: "Feasible with conditions" },
            { value: "NOT_FEASIBLE", label: "Not feasible" },
          ]} />
        </Select>
      </Field>
      <Field label="Technical notes" htmlFor="cr-feas-notes" required>
        <Textarea id="cr-feas-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </Field>
      {error && <p role="alert" className="text-footnote text-overdue">{error}</p>}
      <Button size="sm" onClick={submit} disabled={busy}>{busy ? "Saving…" : "Record feasibility"}</Button>
    </div>
  );
}

function ImpactAndSubmitPanel({ cr, roles, hasItems, onDone }: { cr: ChangeRequest; roles: string[]; hasItems: boolean; onDone: () => void }) {
  const canWrite = roles.some((r) => CUSTOMISATION_DESK_ROLES.includes(r));
  const [costInr, setCostInr] = useState(cr.impact?.cost_inr ?? 0);
  const [scheduleDays, setScheduleDays] = useState(cr.impact?.schedule_days ?? 0);
  const [risk, setRisk] = useState<"LOW" | "MEDIUM" | "HIGH">(cr.impact?.technical_risk ?? "LOW");
  const [handoverImpact, setHandoverImpact] = useState<"NONE" | "DELAYS_HANDOVER" | "BLOCKS_HANDOVER">(cr.impact?.handover_impact ?? "NONE");
  const [notes, setNotes] = useState(cr.impact?.notes ?? "");
  const [exceptionId, setExceptionId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canWrite) return null;
  const needsException = Object.values(cr.gate_summary_at_request).includes("EXCEPTION_ONLY") && !cr.exception_id;

  async function saveImpact() {
    setBusy(true); setError(null);
    try {
      await changeRequestsApi.setImpact(cr.id, { cost_inr: costInr, schedule_days: scheduleDays, technical_risk: risk, handover_impact: handoverImpact, notes });
      onDone();
    } catch (e) { setError(e instanceof ApiError ? e.message : "That didn't work."); } finally { setBusy(false); }
  }
  async function linkException() {
    if (!exceptionId.trim()) return setError("An exception id is required.");
    setBusy(true); setError(null);
    try { await changeRequestsApi.linkException(cr.id, exceptionId.trim()); onDone(); } catch (e) { setError(e instanceof ApiError ? e.message : "That didn't work."); } finally { setBusy(false); }
  }
  async function submitForApproval() {
    setBusy(true); setError(null);
    try { await changeRequestsApi.submitForApproval(cr.id); onDone(); } catch (e) { setError(e instanceof ApiError ? e.message : "That didn't work."); } finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface-raised p-3">
      <h3 className="text-ws-sm font-medium text-fg">Impact assessment (rule 3 — all four dimensions are mandatory)</h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label="Cost (₹)" htmlFor="cr-impact-cost"><Input id="cr-impact-cost" type="number" value={costInr} onChange={(e) => setCostInr(Number(e.target.value) || 0)} /></Field>
        <Field label="Schedule impact (days)" htmlFor="cr-impact-days"><Input id="cr-impact-days" type="number" value={scheduleDays} onChange={(e) => setScheduleDays(Number(e.target.value) || 0)} /></Field>
        <Field label="Technical risk" htmlFor="cr-impact-risk">
          <Select value={risk} onValueChange={(v) => setRisk(v as typeof risk)}>
            <SelectTrigger id="cr-impact-risk" />
            <SelectOptions options={[{ value: "LOW", label: "Low" }, { value: "MEDIUM", label: "Medium" }, { value: "HIGH", label: "High" }]} />
          </Select>
        </Field>
        <Field label="Handover impact" htmlFor="cr-impact-handover">
          <Select value={handoverImpact} onValueChange={(v) => setHandoverImpact(v as typeof handoverImpact)}>
            <SelectTrigger id="cr-impact-handover" />
            <SelectOptions options={[{ value: "NONE", label: "None" }, { value: "DELAYS_HANDOVER", label: "Delays handover" }, { value: "BLOCKS_HANDOVER", label: "Blocks handover" }]} />
          </Select>
        </Field>
        <Field label="Notes" htmlFor="cr-impact-notes" className="sm:col-span-2"><Textarea id="cr-impact-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></Field>
      </div>
      {error && <p role="alert" className="text-footnote text-overdue">{error}</p>}
      <Button size="sm" variant="secondary" onClick={saveImpact} disabled={busy}>{busy ? "Saving…" : "Save impact"}</Button>

      {needsException && (
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <p className="text-footnote text-fg-muted">
            One category is EXCEPTION_ONLY — a gate exception (08) must be linked before this can be submitted for approval.
            No exception picker is wired here yet; paste the exception id from the 08 grant flow.
          </p>
          <Field label="Exception id" htmlFor="cr-exception-id"><Input id="cr-exception-id" value={exceptionId} onChange={(e) => setExceptionId(e.target.value)} /></Field>
          <Button size="sm" variant="secondary" onClick={linkException} disabled={busy}>Link exception</Button>
        </div>
      )}

      <Button size="sm" onClick={submitForApproval} disabled={busy || !hasItems || !cr.impact} className="mt-1">
        Submit for approval
      </Button>
    </div>
  );
}

function ApprovalsPanel({ cr, approvals, roles, onDone }: { cr: ChangeRequest; approvals: CrApproval[]; roles: string[]; onDone: () => void }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function decide(actionId: string, decision: "APPROVE" | "REJECT") {
    if (decision === "REJECT" && !note.trim()) return setError("A reason is required to reject.");
    setBusyId(actionId); setError(null);
    try { await changeRequestsApi.decideApproval(actionId, decision, note.trim() || undefined); onDone(); } catch (e) { setError(e instanceof ApiError ? e.message : "That didn't work."); } finally { setBusyId(null); }
  }

  if (approvals.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-raised p-3">
      <h3 className="text-ws-sm font-medium text-fg">Approvals (rule 4 — approver ≠ requester ≠ coster)</h3>
      {approvals.map((a) => (
        <div key={a.id} className="flex items-center justify-between gap-2 border-t border-line pt-2 first:border-t-0 first:pt-0">
          <div className="text-footnote text-fg">
            {a.approver_role} — <Badge>{a.decision}</Badge>
          </div>
          {a.decision === "PENDING" && roles.some((r) => r === a.approver_role || r === "SUPER_ADMIN") && (
            <div className="flex gap-1.5">
              <Button size="sm" onClick={() => decide(a.action_id, "APPROVE")} disabled={busyId === a.action_id}>Approve</Button>
              <Button size="sm" variant="danger" onClick={() => decide(a.action_id, "REJECT")} disabled={busyId === a.action_id}>Reject</Button>
            </div>
          )}
        </div>
      ))}
      {cr.status === "AWAITING_APPROVAL" && (
        <Field label="Note (required to reject)" htmlFor="cr-approval-note"><Textarea id="cr-approval-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} /></Field>
      )}
      {error && <p role="alert" className="text-footnote text-overdue">{error}</p>}
    </div>
  );
}

function QuotationPanel({ cr, quotation, roles, onDone }: { cr: ChangeRequest; quotation: Quotation | null; roles: string[]; onDone: () => void }) {
  const canWrite = roles.some((r) => CUSTOMISATION_DESK_ROLES.includes(r));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function issue() {
    setBusy(true); setError(null);
    try { await changeRequestsApi.issueQuotation(cr.id); onDone(); } catch (e) { setError(e instanceof ApiError ? e.message : "That didn't work."); } finally { setBusy(false); }
  }
  async function accept() {
    setBusy(true); setError(null);
    try { await changeRequestsApi.acceptQuotation(quotation!.id, "SIGNED_COPY"); onDone(); } catch (e) { setError(e instanceof ApiError ? e.message : "That didn't work."); } finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-raised p-3">
      <h3 className="text-ws-sm font-medium text-fg">Quotation (rule 5)</h3>
      {quotation ? (
        <>
          <KeyValue items={[
            { key: "Version", value: `v${quotation.version}` },
            { key: "Total", value: formatINR(quotation.total_inr) },
            { key: "Valid until", value: fmtDate(quotation.valid_until) },
            { key: "Status", value: <Badge>{quotation.status}</Badge> },
          ]} />
          {cr.status === "AWAITING_CUSTOMER" && quotation.status === "ISSUED" && canWrite && (
            <p className="text-footnote text-fg-muted">Rule 5: acceptance is via portal or a signed copy CRM records on the customer's behalf.</p>
          )}
        </>
      ) : (
        <p className="text-footnote text-fg-muted">No quotation issued yet.</p>
      )}
      {error && <p role="alert" className="text-footnote text-overdue">{error}</p>}
      {canWrite && cr.status === "AWAITING_CUSTOMER" && !quotation && (
        <Button size="sm" onClick={issue} disabled={busy}>{busy ? "Issuing…" : "Issue quotation"}</Button>
      )}
      {canWrite && cr.status === "AWAITING_CUSTOMER" && quotation?.status === "ISSUED" && (
        <Button size="sm" onClick={accept} disabled={busy}>{busy ? "Recording…" : "Record signed-copy acceptance"}</Button>
      )}
    </div>
  );
}

function PaymentPanel({ cr, roles, onDone }: { cr: ChangeRequest; roles: string[]; onDone: () => void }) {
  const canConfirm = roles.some((r) => CUSTOMISATION_DESK_ROLES.includes(r));
  const canWaive = roles.some((r) => WAIVER_AUTHORITY_ROLES.includes(r));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true); setError(null);
    try { await changeRequestsApi.confirmPayment(cr.id); onDone(); } catch (e) { setError(e instanceof ApiError ? e.message : "That didn't work."); } finally { setBusy(false); }
  }
  async function waive() {
    if (!reason.trim()) return setError("A reason is required to waive.");
    setBusy(true); setError(null);
    try { await changeRequestsApi.waivePayment(cr.id, reason.trim()); onDone(); } catch (e) { setError(e instanceof ApiError ? e.message : "That didn't work."); } finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-raised p-3">
      <h3 className="text-ws-sm font-medium text-fg">Payment gate (rule 6)</h3>
      <p className="text-footnote text-fg-muted">Confirm once a receipt (19) covers the gate, or waive with a reason.</p>
      {error && <p role="alert" className="text-footnote text-overdue">{error}</p>}
      {canConfirm && <Button size="sm" onClick={confirm} disabled={busy}>{busy ? "Checking…" : "Confirm payment received"}</Button>}
      {canWaive && (
        <div className="flex flex-col gap-2 border-t border-line pt-2">
          <Field label="Waiver reason" htmlFor="cr-waiver-reason"><Textarea id="cr-waiver-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} /></Field>
          <Button size="sm" variant="secondary" onClick={waive} disabled={busy}>Waive payment</Button>
        </div>
      )}
    </div>
  );
}

function ReleaseAndExecutionPanel({ cr, executions, roles, onDone }: { cr: ChangeRequest; executions: CrExecutionAction[]; roles: string[]; onDone: () => void }) {
  const canWrite = roles.some((r) => CUSTOMISATION_DESK_ROLES.includes(r));
  const canClose = roles.some((r) => ["SALES", "CRM", "ACCOUNTS", "BANKING", "LEGAL", "REGISTRATION", "SITE", "QA", "CUSTOMISATION", "FM", "MANAGEMENT", "SUPER_ADMIN"].includes(r)); // mirrors execution.ts's STAFF_ROLES
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function release() {
    setBusyId("release"); setError(null);
    try { await changeRequestsApi.release(cr.id); onDone(); } catch (e) { setError(e instanceof ApiError ? e.message : "That didn't work."); } finally { setBusyId(null); }
  }
  async function closeAction(actionId: string) {
    setBusyId(actionId); setError(null);
    try { await changeRequestsApi.closeExecutionAction(actionId); onDone(); } catch (e) { setError(e instanceof ApiError ? e.message : "That didn't work."); } finally { setBusyId(null); }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-raised p-3">
      <h3 className="text-ws-sm font-medium text-fg">Release &amp; execution (rules 7-8)</h3>
      {error && <p role="alert" className="text-footnote text-overdue">{error}</p>}
      {canWrite && cr.status === "APPROVED" && (
        <Button size="sm" onClick={release} disabled={busyId === "release"}>{busyId === "release" ? "Releasing…" : "Release (creates spec revision + execution actions)"}</Button>
      )}
      {executions.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {executions.map((x) => (
            <div key={x.action_id} className="flex items-center justify-between gap-2 border-t border-line pt-1.5 first:border-t-0 first:pt-0">
              <div className="text-footnote text-fg">{x.title} — <Badge>{x.status}</Badge></div>
              {canClose && x.status !== "Closed" && x.status !== "Cancelled" && (
                <Button size="sm" variant="secondary" onClick={() => closeAction(x.action_id)} disabled={busyId === x.action_id}>Close</Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function QaAndAcceptancePanel({ cr, roles, onDone }: { cr: ChangeRequest; roles: string[]; onDone: () => void }) {
  const canLink = roles.some((r) => [...CUSTOMISATION_DESK_ROLES, "QA"].includes(r));
  const canVerify = roles.some((r) => ["QA", "MANAGEMENT", "SUPER_ADMIN"].includes(r));
  const canAccept = roles.some((r) => ["CRM", "MANAGEMENT", "SUPER_ADMIN"].includes(r));
  const canAsBuilt = roles.some((r) => CUSTOMISATION_DESK_ROLES.includes(r));
  const [inspectionId, setInspectionId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await action(); onDone(); } catch (e) { setError(e instanceof ApiError ? e.message : "That didn't work."); } finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-raised p-3">
      <h3 className="text-ws-sm font-medium text-fg">QA &amp; acceptance (rule 8)</h3>
      {error && <p role="alert" className="text-footnote text-overdue">{error}</p>}
      {cr.status === "READY_FOR_QA" && !cr.qa_inspection_id && canLink && (
        <div className="flex flex-col gap-2">
          <p className="text-footnote text-fg-muted">
            The QA link is manual — 08's change categories and 07's progress components don't map 1:1.
            Paste the QA inspection (15) id for this unit.
          </p>
          <Field label="QA inspection id" htmlFor="cr-qa-id"><Input id="cr-qa-id" value={inspectionId} onChange={(e) => setInspectionId(e.target.value)} /></Field>
          <Button size="sm" variant="secondary" onClick={() => run(() => changeRequestsApi.linkQaInspection(cr.id, inspectionId.trim()))} disabled={busy || !inspectionId.trim()}>Link inspection</Button>
        </div>
      )}
      {cr.status === "READY_FOR_QA" && cr.qa_inspection_id && canVerify && (
        <Button size="sm" onClick={() => run(() => changeRequestsApi.qaVerify(cr.id))} disabled={busy}>Mark QA verified</Button>
      )}
      {cr.status === "QA_VERIFIED" && canAccept && (
        <Button size="sm" onClick={() => run(() => changeRequestsApi.customerAccept(cr.id))} disabled={busy}>Record customer acceptance</Button>
      )}
      {cr.status === "CUSTOMER_ACCEPTED" && canAsBuilt && (
        <Button size="sm" onClick={() => run(() => changeRequestsApi.asBuiltClose(cr.id))} disabled={busy}>Close as-built (updates the unit's Digital Twin)</Button>
      )}
    </div>
  );
}

function WithdrawOrCancelPanel({ cr, roles, onDone }: { cr: ChangeRequest; roles: string[]; onDone: () => void }) {
  const preRelease = ["REQUESTED", "FEASIBILITY_REVIEW", "COSTING", "AWAITING_APPROVAL", "AWAITING_CUSTOMER", "AWAITING_PAYMENT", "APPROVED"];
  const postRelease = ["IN_PROGRESS", "READY_FOR_QA", "QA_VERIFIED", "CUSTOMER_ACCEPTED"];
  const canWithdraw = roles.some((r) => CUSTOMISATION_DESK_ROLES.includes(r)) && preRelease.includes(cr.status);
  const canCancel = roles.some((r) => CANCEL_ROLES.includes(r)) && postRelease.includes(cr.status);
  const [reason, setReason] = useState("");
  const [abortiveCost, setAbortiveCost] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  if (!canWithdraw && !canCancel) return null;

  async function withdraw() {
    setBusy(true); setError(null);
    try { await changeRequestsApi.withdraw(cr.id); onDone(); } catch (e) { setError(e instanceof ApiError ? e.message : "That didn't work."); } finally { setBusy(false); }
  }
  async function cancel() {
    if (!reason.trim()) return setError("A reason is required to cancel.");
    setBusy(true); setError(null);
    try { await changeRequestsApi.cancel(cr.id, reason.trim(), abortiveCost); onDone(); } catch (e) { setError(e instanceof ApiError ? e.message : "That didn't work."); } finally { setBusy(false); }
  }

  return (
    <div className="border-t border-line pt-3">
      {canWithdraw && <Button size="sm" variant="danger" onClick={withdraw} disabled={busy}>Withdraw request</Button>}
      {canCancel && !open && <Button size="sm" variant="danger" onClick={() => setOpen(true)}>Cancel (rule 9)</Button>}
      {canCancel && open && (
        <div className="mt-2 flex flex-col gap-2">
          <Field label="Reason" htmlFor="cr-cancel-reason" required><Textarea id="cr-cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} /></Field>
          <Field label="Abortive cost (₹)" htmlFor="cr-cancel-cost"><Input id="cr-cancel-cost" type="number" min={0} value={abortiveCost} onChange={(e) => setAbortiveCost(Number(e.target.value) || 0)} /></Field>
          {error && <p role="alert" className="text-footnote text-overdue">{error}</p>}
          <Button size="sm" variant="danger" onClick={cancel} disabled={busy}>{busy ? "Cancelling…" : "Confirm cancel"}</Button>
        </div>
      )}
    </div>
  );
}

function DetailBody({ bundle, roles, onChanged }: { bundle: Bundle; roles: string[]; onChanged: () => void }) {
  const { cr, items, quotation, approvals, executions, economics } = bundle;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{CR_STATUS_LABEL[cr.status]}</Badge>
        {cr.primary_category_code && <Badge>{CATEGORY_LABEL[cr.primary_category_code] ?? cr.primary_category_code}</Badge>}
        <Badge>{cr.freeze_state_at_request === "POST_FREEZE" ? "Post-freeze" : "Pre-freeze"}</Badge>
      </div>

      <p className="text-subhead text-fg-muted">{cr.summary || "No summary provided."}</p>

      <KeyValue items={[
        { key: "Unit", value: cr.unit_number ?? "—" },
        { key: "Booking", value: cr.booking_number ?? "—" },
        { key: "Raised", value: `${fmtDate(cr.created_at)} · ${cr.raised_by_kind}` },
      ]} />

      <GateSummary cr={cr} />

      {cr.feasibility && (
        <div>
          <h3 className="mb-1 text-ws-sm font-medium text-fg">Feasibility</h3>
          <p className="text-footnote text-fg-muted">{cr.feasibility.result} — {cr.feasibility.technical_notes}</p>
        </div>
      )}
      {cr.status === "FEASIBILITY_REVIEW" && <FeasibilityPanel cr={cr} roles={roles} onDone={onChanged} />}

      {(cr.status === "COSTING" || items.length > 0) && (
        <div>
          <h3 className="mb-2 text-ws-sm font-medium text-fg">Line items</h3>
          {cr.status === "COSTING" ? (
            <ItemsEditor crId={cr.id} projectId={cr.project_id} primaryCategory={cr.primary_category_code} existing={items} onSaved={onChanged} />
          ) : items.length > 0 ? (
            <ul className="flex flex-col gap-1 text-footnote text-fg-muted">
              {items.map((it) => (
                <li key={it.id}>{it.description} — {it.qty} × {formatINR(it.unit_price_inr)} ({CATEGORY_LABEL[it.category_code] ?? it.category_code})</li>
              ))}
            </ul>
          ) : (
            <p className="text-footnote text-fg-muted">No line items.</p>
          )}
        </div>
      )}
      {cr.status === "COSTING" && <ImpactAndSubmitPanel cr={cr} roles={roles} hasItems={items.length > 0} onDone={onChanged} />}

      {cr.impact && cr.status !== "COSTING" && (
        <div>
          <h3 className="mb-1 text-ws-sm font-medium text-fg">Impact</h3>
          <p className="text-footnote text-fg-muted">
            {formatINR(cr.impact.cost_inr)} · {cr.impact.schedule_days}d schedule · {cr.impact.technical_risk} risk · {cr.impact.handover_impact}
          </p>
        </div>
      )}

      {(cr.status === "AWAITING_APPROVAL" || approvals.length > 0) && <ApprovalsPanel cr={cr} approvals={approvals} roles={roles} onDone={onChanged} />}

      {(cr.status === "AWAITING_CUSTOMER" || cr.status === "AWAITING_PAYMENT" || quotation) && <QuotationPanel cr={cr} quotation={quotation} roles={roles} onDone={onChanged} />}

      {cr.status === "AWAITING_PAYMENT" && <PaymentPanel cr={cr} roles={roles} onDone={onChanged} />}

      {(cr.status === "APPROVED" || cr.status === "RELEASED" || cr.status === "IN_PROGRESS" || executions.length > 0) && (
        <ReleaseAndExecutionPanel cr={cr} executions={executions} roles={roles} onDone={onChanged} />
      )}

      {(cr.status === "READY_FOR_QA" || cr.status === "QA_VERIFIED" || cr.status === "CUSTOMER_ACCEPTED") && <QaAndAcceptancePanel cr={cr} roles={roles} onDone={onChanged} />}

      {economics && (
        <div>
          <h3 className="mb-1 text-ws-sm font-medium text-fg">Economics (rule 10)</h3>
          <KeyValue items={[
            { key: "Price", value: formatINR(economics.price_inr) },
            { key: "Vendor cost", value: formatINR(economics.vendor_cost_inr) },
            { key: "Tax", value: formatINR(economics.tax_inr) },
            { key: "Contribution", value: formatINR(economics.contribution_inr) },
          ]} />
        </div>
      )}

      {cr.cancel_reason && (
        <p className="text-footnote text-fg-muted">Cancelled: {cr.cancel_reason}{cr.abortive_cost_inr ? ` — abortive cost ${formatINR(cr.abortive_cost_inr)}` : ""}</p>
      )}

      <div className="text-caption text-fg-subtle">Updated {formatIstDateTime(cr.updated_at)}</div>

      <WithdrawOrCancelPanel cr={cr} roles={roles} onDone={onChanged} />
    </div>
  );
}

export function CrDrawer({ crId, roles, onClose, onChanged }: { crId: string | null; roles: string[]; onClose: () => void; onChanged?: () => void }) {
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    if (!crId) return;
    setError(false);
    loadBundle(crId).then(setBundle).catch(() => setError(true));
  }, [crId]);

  useEffect(() => {
    setBundle(null);
    if (crId) load();
  }, [crId, load]);

  function handleChanged() {
    load();
    onChanged?.();
  }

  return (
    <Drawer open={crId !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DrawerContent open={crId !== null} title={bundle ? `${bundle.cr.code} · ${bundle.cr.title}` : "Change request"} width={640}>
        <div className="p-6">
          {error ? (
            <EmptyState icon={CircleAlert} message="Couldn't load this change request." action={{ label: "Retry", onClick: load }} />
          ) : bundle === null ? (
            <div className="flex flex-col gap-2">
              <Skeleton />
              <Skeleton />
            </div>
          ) : (
            <DetailBody bundle={bundle} roles={roles} onChanged={handleChanged} />
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

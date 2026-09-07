import { useCallback, useEffect, useState } from "react";
import { Drawer, DrawerContent, KeyValue, Badge, Button, Skeleton, EmptyState, Textarea, Select, SelectTrigger, SelectOptions } from "@homeflow/ui";
import { FileText } from "lucide-react";
import { ApiError } from "../../auth/api";
import { formatIstDateTime } from "../../lib/utils";
import { documentsApi, type DocumentRow, type DeviationRow, type DocumentApproval, type ApprovalStage } from "./api";
import { DOCUMENT_STATUS_LABEL, documentStatusTone, prettifyCode, APPROVAL_STAGE_LABEL } from "./labels";

const WRITE_ROLES = ["LEGAL", "SUPER_ADMIN"]; // mirrors documents/workflow.ts's "documents" module WRITE (LEGAL only)
const STAGES: ApprovalStage[] = ["INTERNAL_REVIEW", "LEGAL", "COMMERCIAL"];

function ApprovalsStepper({ approvals }: { approvals: DocumentApproval[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      {STAGES.map((stage) => {
        const decision = approvals.find((a) => a.stage === stage);
        return (
          <div key={stage} className="flex items-center justify-between text-footnote">
            <span className="text-fg-muted">{APPROVAL_STAGE_LABEL[stage]}</span>
            {decision ? (
              <Badge className={decision.decision === "APPROVED" ? "bg-ontrack/10 text-ontrack" : "bg-overdue/10 text-overdue"}>
                {decision.decision === "APPROVED" ? "Approved" : "Rejected"} · {formatIstDateTime(decision.at)}
              </Badge>
            ) : (
              <Badge className="bg-surface-2 text-fg-subtle">Pending</Badge>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DeviationsPanel({ doc, deviations, canWrite, onChanged }: { doc: DocumentRow; deviations: DeviationRow[]; canWrite: boolean; onChanged: () => void }) {
  const negotiable = doc.selected_clauses.filter((c) => c.type === "NEGOTIABLE_WITH_APPROVAL");
  const [clauseCode, setClauseCode] = useState("");
  const [proposed, setProposed] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function raise() {
    if (!clauseCode || !proposed.trim() || !reason.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await documentsApi.raiseDeviation(doc.id, { clause_code: clauseCode, proposed: proposed.trim(), reason: reason.trim() });
      setClauseCode(""); setProposed(""); setReason("");
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't raise deviation.");
    } finally {
      setBusy(false);
    }
  }

  async function decide(id: string, approve: boolean) {
    setBusy(true);
    setError(null);
    try {
      await (approve ? documentsApi.approveDeviation(id) : documentsApi.rejectDeviation(id));
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't decide deviation.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-footnote font-semibold uppercase tracking-wide text-fg-subtle">Deviations (rule 5 — no self-approval)</h3>
      {deviations.length === 0 && <p className="text-footnote text-fg-muted">No deviations raised on this document.</p>}
      {deviations.map((d) => (
        <div key={d.id} className="rounded-lg border border-line p-3">
          <div className="flex items-center justify-between">
            <span className="text-footnote font-semibold">{d.clause_code}</span>
            <Badge className={d.status === "APPROVED" ? "bg-ontrack/10 text-ontrack" : d.status === "REJECTED" ? "bg-overdue/10 text-overdue" : "bg-due/10 text-due"}>{d.status}</Badge>
          </div>
          <p className="mt-1 text-footnote text-fg-muted">Reason: {d.reason}</p>
          <p className="mt-1 whitespace-pre-wrap text-footnote">{d.proposed}</p>
          {canWrite && d.status === "RAISED" && (
            <div className="mt-2 flex gap-2">
              <Button size="sm" onClick={() => decide(d.id, true)} disabled={busy}>Approve</Button>
              <Button size="sm" variant="ghost" onClick={() => decide(d.id, false)} disabled={busy}>Reject</Button>
            </div>
          )}
        </div>
      ))}
      {canWrite && negotiable.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-line p-3">
          <p className="text-caption font-semibold uppercase tracking-wide text-fg-subtle">Raise a new deviation</p>
          <Select value={clauseCode} onValueChange={setClauseCode}>
            <SelectTrigger placeholder="Select a negotiable clause" />
            <SelectOptions options={negotiable.map((c) => ({ value: c.code, label: c.title }))} />
          </Select>
          <Textarea value={proposed} onChange={(e) => setProposed(e.target.value)} placeholder="Proposed replacement text" rows={2} />
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" rows={2} />
          {error && <p role="alert" className="text-footnote text-overdue">{error}</p>}
          <Button size="sm" onClick={raise} disabled={busy || !clauseCode || !proposed.trim() || !reason.trim()}>Raise deviation</Button>
        </div>
      )}
    </div>
  );
}

function ExecutionForm({ doc, canWrite, onChanged }: { doc: DocumentRow; canWrite: boolean; onChanged: () => void }) {
  const [mode, setMode] = useState<"ESIGN" | "WET_SIGNATURE" | "REGISTRATION">("WET_SIGNATURE");
  const [executedOn, setExecutedOn] = useState(new Date().toISOString().slice(0, 10));
  const [sroReference, setSroReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function record() {
    if (mode === "REGISTRATION" && !sroReference.trim()) return setError("SRO reference is required for Registration mode.");
    setBusy(true);
    setError(null);
    try {
      await documentsApi.recordExecution(doc.id, { mode, executed_on: executedOn, sro_reference: mode === "REGISTRATION" ? sroReference.trim() : undefined });
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't record execution.");
    } finally {
      setBusy(false);
    }
  }

  if (!canWrite) return <p className="text-footnote text-fg-muted">Only Legal can record execution.</p>;
  return (
    <div className="flex flex-col gap-2">
      <Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
        <SelectTrigger />
        <SelectOptions options={[{ value: "ESIGN", label: "eSign" }, { value: "WET_SIGNATURE", label: "Wet signature" }, { value: "REGISTRATION", label: "Registration" }]} />
      </Select>
      <input type="date" value={executedOn} onChange={(e) => setExecutedOn(e.target.value)} className="rounded-lg border border-line bg-surface px-3 py-2 text-body" />
      {mode === "REGISTRATION" && (
        <input value={sroReference} onChange={(e) => setSroReference(e.target.value)} placeholder="SRO reference" className="rounded-lg border border-line bg-surface px-3 py-2 text-body" />
      )}
      {error && <p role="alert" className="text-footnote text-overdue">{error}</p>}
      <Button size="sm" onClick={record} disabled={busy}>{busy ? "Recording…" : "Record execution"}</Button>
    </div>
  );
}

export function DocumentDrawer({ documentId, roles, onClose, onChanged }: { documentId: string | null; roles: string[]; onClose: () => void; onChanged?: () => void }) {
  const canWrite = roles.some((r) => WRITE_ROLES.includes(r));
  const [doc, setDoc] = useState<DocumentRow | null>(null);
  const [approvals, setApprovals] = useState<DocumentApproval[]>([]);
  const [deviations, setDeviations] = useState<DeviationRow[]>([]);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!documentId) return;
    setError(false);
    Promise.all([documentsApi.get(documentId), documentsApi.approvals(documentId), documentsApi.deviations(documentId)])
      .then(([d, a, dev]) => { setDoc(d); setApprovals(a); setDeviations(dev); })
      .catch(() => setError(true));
  }, [documentId]);

  useEffect(() => { setDoc(null); load(); }, [documentId, load]);

  function notifyThenReload() { load(); onChanged?.(); }

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setNotice(null);
    try {
      await fn();
      notifyThenReload();
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : "That didn't work.");
    }
    setBusy(null);
  }

  return (
    <Drawer open={documentId !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DrawerContent open={documentId !== null} title={doc ? `${doc.code} · ${prettifyCode(doc.family_code)}` : "Document"} width={640}>
        {error && <EmptyState icon={FileText} message="Couldn't reach the API on :3001." />}
        {!error && !doc && (
          <div className="flex flex-col gap-3">
            <Skeleton variant="text" /><Skeleton variant="text" /><Skeleton variant="text" />
          </div>
        )}
        {!error && doc && (
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={documentStatusTone(doc.status)}>{DOCUMENT_STATUS_LABEL[doc.status]}</Badge>
              {doc.is_draft_watermarked && <Badge className="bg-overdue/10 text-overdue">DRAFT — NOT FOR EXECUTION</Badge>}
              <Badge className="bg-surface-2 text-fg-subtle">v{doc.version}</Badge>
              {doc.checksum && <Badge className="bg-surface-2 text-fg-subtle font-mono">{doc.checksum.slice(0, 12)}</Badge>}
            </div>

            <KeyValue
              items={[
                { key: "Booking", value: doc.booking_number ?? "—" },
                { key: "Unit", value: doc.unit_number ?? "—" },
                { key: "Customer", value: doc.customer_name ?? "—" },
                { key: "Generated", value: formatIstDateTime(doc.generated_at) },
              ]}
            />

            {doc.redline_summary && (doc.redline_summary.fields_changed.length > 0 || doc.redline_summary.clauses_added.length > 0 || doc.redline_summary.clauses_removed.length > 0) && (
              <div>
                <h3 className="mb-1 text-footnote font-semibold uppercase tracking-wide text-fg-subtle">Redline vs previous version</h3>
                {doc.redline_summary.fields_changed.length > 0 && <p className="text-footnote text-fg-muted">Fields changed: {doc.redline_summary.fields_changed.join(", ")}</p>}
                {doc.redline_summary.clauses_added.length > 0 && <p className="text-footnote text-fg-muted">Clauses added: {doc.redline_summary.clauses_added.join(", ")}</p>}
                {doc.redline_summary.clauses_removed.length > 0 && <p className="text-footnote text-fg-muted">Clauses removed: {doc.redline_summary.clauses_removed.join(", ")}</p>}
              </div>
            )}

            {doc.pdf_file_key && (
              // local-routes.ts's GET /api/files/* is a wildcard over the whole slash-separated
              // key — encoding the key (which itself contains "/") would break that match.
              <a href={`/api/files/${doc.pdf_file_key}`} target="_blank" rel="noreferrer" className="text-footnote font-medium text-accent underline">
                View PDF
              </a>
            )}

            <div>
              <h3 className="mb-2 text-footnote font-semibold uppercase tracking-wide text-fg-subtle">Approvals</h3>
              <ApprovalsStepper approvals={approvals} />
            </div>

            {notice && <p role="alert" className="text-footnote text-overdue">{notice}</p>}

            {canWrite && (
              <div className="flex flex-wrap gap-2">
                {doc.status === "DRAFT" && (
                  <Button size="sm" onClick={() => run("submit", () => documentsApi.submitForReview(doc.id))} disabled={busy === "submit"}>Submit for review</Button>
                )}
                {doc.status === "INTERNAL_REVIEW" && (
                  <>
                    <Button size="sm" onClick={() => run("ir-approve", () => documentsApi.approve(doc.id, "INTERNAL_REVIEW"))} disabled={busy === "ir-approve"}>Approve internal review</Button>
                    <Button size="sm" variant="ghost" onClick={() => run("ir-reject", () => documentsApi.reject(doc.id, "INTERNAL_REVIEW"))} disabled={busy === "ir-reject"}>Reject</Button>
                  </>
                )}
                {doc.status === "AWAITING_APPROVAL" && (
                  <>
                    {!approvals.some((a) => a.stage === "LEGAL") && (
                      <Button size="sm" onClick={() => run("legal-approve", () => documentsApi.approve(doc.id, "LEGAL"))} disabled={busy === "legal-approve"}>Approve (Legal)</Button>
                    )}
                    {!approvals.some((a) => a.stage === "COMMERCIAL") && (
                      <Button size="sm" onClick={() => run("commercial-approve", () => documentsApi.approve(doc.id, "COMMERCIAL"))} disabled={busy === "commercial-approve"}>Approve (Commercial)</Button>
                    )}
                    <Button size="sm" onClick={() => run("send-customer", () => documentsApi.sendCustomerReview(doc.id))} disabled={busy === "send-customer"}>Send for customer review</Button>
                  </>
                )}
                {doc.status === "CUSTOMER_REVIEW" && (
                  <Button size="sm" onClick={() => run("approve-exec", () => documentsApi.approveForExecution(doc.id))} disabled={busy === "approve-exec"}>Approve for execution</Button>
                )}
                {doc.status === "FINAL" && (
                  <Button size="sm" onClick={() => run("archive", () => documentsApi.archive(doc.id))} disabled={busy === "archive"}>Archive</Button>
                )}
              </div>
            )}

            {doc.status === "APPROVED_FOR_EXECUTION" && (
              <div>
                <h3 className="mb-2 text-footnote font-semibold uppercase tracking-wide text-fg-subtle">Record execution</h3>
                <ExecutionForm doc={doc} canWrite={canWrite} onChanged={notifyThenReload} />
              </div>
            )}

            <DeviationsPanel doc={doc} deviations={deviations} canWrite={canWrite} onChanged={notifyThenReload} />
          </div>
        )}
      </DrawerContent>
    </Drawer>
  );
}

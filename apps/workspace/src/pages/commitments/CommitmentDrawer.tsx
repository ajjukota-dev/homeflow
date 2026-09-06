import { useEffect, useState } from "react";
import { Drawer, DrawerContent, KeyValue, Badge, Button, Skeleton, EmptyState, Field, Textarea, Input, Select, SelectTrigger, SelectOptions, Tooltip, TooltipProvider } from "@homeflow/ui";
import { CircleAlert, Info } from "lucide-react";
import { ApiError } from "../../auth/api";
import { commitmentsApi, type CommitmentDetail, type BreachRootCause } from "./api";
import { CommitmentStatusChip } from "./CommitmentStatusChip";
import { commitmentCategoryLabel, breachRootCauseLabel } from "../../lib/labels";

// 13-promise-ledger.md Screens: "row → detail drawer (timeline, dependencies, evidence upload,
// recovery plan, root cause)". No client-side role/ownership simulation for which action buttons
// are enabled — same "let the server say no" precedent as ActionDrawer/TransitionActions; every
// status-eligible action renders, and a 403 surfaces as the inline error below.
//
// Evidence: `fulfilCommitment` requires a real, non-empty `evidence_file_ids[]`, but no
// presigned-upload flow is wired to any UI anywhere in this codebase yet (ActionDrawer's own
// comment flags the same gap). Rather than leave "Fulfil" permanently dead in this drawer, the
// field below records freeform evidence *references* (what was done / where proof lives), honestly
// labelled as not a real upload — the same trade-off, applied to the one place the codebase can't
// avoid asking for evidence at all.

const ROOT_CAUSES: BreachRootCause[] = ["DEPENDENCY", "RESOURCE", "VENDOR", "SCOPE_MISUNDERSTOOD", "OVERPROMISED", "CUSTOMER", "FORCE_MAJEURE"];

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
function fmtAt(d: string): string {
  return new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
function fmtMoney(n: number | null): string {
  return n == null ? "—" : `₹${n.toLocaleString("en-IN")}`;
}

type PendingAction = "approve" | "activate" | "fulfil" | "waive" | "set-at-risk" | "recovery-plan" | "root-cause" | null;

function ConfidenceBadge({ score, drivers }: { score: number; drivers: { label: string; delta: number }[] }) {
  const tone = score >= 70 ? "bg-ok-soft text-ok-fg" : score >= 40 ? "bg-warn-soft text-warn-fg" : "bg-danger-soft text-danger-fg";
  const trigger = (
    <span className={`inline-flex items-center gap-1 rounded-pill px-2.5 py-1 text-ws-xs font-medium ${tone}`}>
      Confidence {score}
      <Info className="size-3" aria-hidden />
    </span>
  );
  if (drivers.length === 0) return trigger;
  // Local TooltipProvider, not just the app-root one in main.tsx: keeps this component correct
  // in isolation too (Radix's Tooltip throws without one — the crash a first draft of
  // CommitmentDrawer.test.tsx caught before this fix). Nesting providers is safe in Radix.
  return (
    <TooltipProvider>
      <Tooltip
        content={
          <ul className="flex flex-col gap-0.5">
            {drivers.map((d, i) => (
              <li key={i}>
                {d.label} ({d.delta > 0 ? "+" : ""}
                {d.delta})
              </li>
            ))}
          </ul>
        }
      >
        {trigger}
      </Tooltip>
    </TooltipProvider>
  );
}

function DetailBody({ c, onChanged }: { c: CommitmentDetail; onChanged: () => void }) {
  const [pending, setPending] = useState<PendingAction>(null);
  const [evidenceRefs, setEvidenceRefs] = useState("");
  const [crmNote, setCrmNote] = useState("");
  const [customerConfirmed, setCustomerConfirmed] = useState(false);
  const [reason, setReason] = useState("");
  const [recoveryPlan, setRecoveryPlan] = useState("");
  const [recoveryDue, setRecoveryDue] = useState("");
  const [rootCause, setRootCause] = useState<BreachRootCause>("OVERPROMISED");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetForm() {
    setPending(null);
    setEvidenceRefs("");
    setCrmNote("");
    setCustomerConfirmed(false);
    setReason("");
    setRecoveryPlan("");
    setRecoveryDue("");
    setError(null);
  }

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      resetForm();
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  }

  const buttons: { key: PendingAction; label: string; variant: "primary" | "secondary" | "danger"; immediate?: boolean }[] = [];
  if (c.status === "DRAFT") buttons.push({ key: "approve", label: "Approve", variant: "primary", immediate: true });
  if (c.status === "APPROVED") buttons.push({ key: "activate", label: "Activate", variant: "primary", immediate: true });
  if (c.status === "ACTIVE" || c.status === "AT_RISK") buttons.push({ key: "fulfil", label: "Fulfil", variant: "primary" });
  if (c.status === "ACTIVE") buttons.push({ key: "set-at-risk", label: "Flag at risk", variant: "secondary" });
  if (c.status === "AT_RISK") buttons.push({ key: "recovery-plan", label: "Record recovery plan", variant: "secondary" });
  if (c.status === "BREACHED") buttons.push({ key: "root-cause", label: "Record root cause", variant: "secondary" });
  if (c.status !== "FULFILLED" && c.status !== "WAIVED_CANCELLED") buttons.push({ key: "waive", label: "Waive / cancel", variant: "danger" });

  function click(b: (typeof buttons)[number]) {
    if (busy) return;
    if (b.immediate) {
      void run(() => (b.key === "approve" ? commitmentsApi.approve(c.id) : commitmentsApi.activate(c.id)));
      return;
    }
    setPending(b.key);
    setError(null);
  }

  function confirm() {
    if (pending === "fulfil") {
      const ids = evidenceRefs.split(",").map((s) => s.trim()).filter(Boolean);
      if (ids.length === 0) return setError("At least one evidence reference is required.");
      if (c.customer_facing && !customerConfirmed && !crmNote.trim()) {
        return setError("Customer-facing commitments need the customer's confirmation, or a CRM confirmation note.");
      }
      void run(() => commitmentsApi.fulfil(c.id, { evidence_file_ids: ids, customer_confirmed_at: customerConfirmed ? new Date().toISOString() : null, crm_confirmation_note: crmNote.trim() || null }));
    } else if (pending === "waive") {
      if (!reason.trim()) return setError("A reason is required to waive a commitment.");
      void run(() => commitmentsApi.waive(c.id, reason.trim()));
    } else if (pending === "set-at-risk") {
      void run(() => commitmentsApi.setAtRisk(c.id, reason.trim()));
    } else if (pending === "recovery-plan") {
      if (!recoveryPlan.trim() || !recoveryDue) return setError("Both a recovery plan and a due date are required.");
      void run(() => commitmentsApi.recordRecoveryPlan(c.id, recoveryPlan.trim(), recoveryDue));
    } else if (pending === "root-cause") {
      void run(() => commitmentsApi.recordRootCause(c.id, rootCause));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <CommitmentStatusChip status={c.status} />
        <Badge>{commitmentCategoryLabel(c.category)}</Badge>
        {c.customer_facing && <Badge>Customer-facing</Badge>}
        <ConfidenceBadge score={c.confidence} drivers={c.confidence_drivers} />
      </div>

      <p className="text-subhead text-fg-muted">{c.description}</p>

      {error && !pending && (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-footnote text-danger-fg">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}

      <KeyValue
        items={[
          { key: "Owner", value: c.owner_user_id ?? "Unassigned" },
          { key: "Department", value: c.responsible_department ?? "—" },
          { key: "Due date", value: fmtDate(c.due_date) },
          { key: "Financial impact", value: fmtMoney(c.financial_impact_inr) },
          { key: "Beneficiary", value: c.beneficiary === "CUSTOMER" ? "Customer" : "Internal" },
          { key: "Source", value: c.source },
        ]}
      />

      {c.status === "AT_RISK" && c.at_risk_reason && (
        // Backend never clears at_risk_reason once set (audit trail, not live state) — the Timeline
        // below already carries it historically with a timestamp once status moves on.
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-footnote text-warn-fg">At risk: {c.at_risk_reason}</p>
      )}
      {(c.recovery_plan || c.recovery_due_date) && (
        <div>
          <h3 className="mb-1 text-ws-sm font-medium text-fg">Recovery plan</h3>
          <p className="text-footnote text-fg-muted">
            {c.recovery_plan ?? "—"}
            {c.recovery_due_date ? ` — due ${fmtDate(c.recovery_due_date)}` : ""}
          </p>
        </div>
      )}
      {c.breach_root_cause && (
        <p className="text-footnote text-fg-muted">Root cause: {breachRootCauseLabel(c.breach_root_cause)}</p>
      )}
      {c.status === "FULFILLED" && (
        <div>
          <h3 className="mb-1 text-ws-sm font-medium text-fg">Fulfilled</h3>
          <p className="text-footnote text-fg-muted">
            {fmtAt(c.fulfilled_at!)} · Evidence: {c.fulfilled_evidence_file_ids.join(", ")}
          </p>
          {c.crm_confirmation_note && <p className="text-footnote text-fg-muted">CRM note: {c.crm_confirmation_note}</p>}
        </div>
      )}
      {c.status === "WAIVED_CANCELLED" && c.waived_reason && (
        <p className="text-footnote text-fg-muted">Waived: {c.waived_reason}</p>
      )}

      {c.depends_on.length > 0 && (
        <div>
          <h3 className="mb-1 text-ws-sm font-medium text-fg">Dependencies</h3>
          {/* Plain text list, not connector lines — same cut journey/StageTaskDetailDrawer.tsx
              already made (no fixed pixel geometry here to anchor a line to). */}
          <p className="text-footnote text-fg-muted">{c.depends_on.map((d) => `${d.type} #${d.id}`).join(", ")}</p>
        </div>
      )}

      {c.transitions.length > 0 && (
        <section>
          <h3 className="mb-2 text-ws-sm font-medium text-fg">Timeline</h3>
          <ul className="flex flex-col gap-1.5 text-footnote text-fg-muted">
            {c.transitions.map((t) => (
              <li key={t.id}>
                {t.from_status} → {t.to_status} · {fmtAt(t.at)}
                {t.reason ? ` · ${t.reason}` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}

      {buttons.length > 0 && (
        <div className="flex flex-col gap-3 border-t border-line pt-4">
          <div role="group" aria-label="Available actions" className="flex flex-wrap gap-2">
            {buttons.map((b) => (
              <Button key={b.key} size="sm" variant={b.variant} disabled={busy} onClick={() => click(b)}>
                {b.label}
              </Button>
            ))}
          </div>

          {pending === "fulfil" && (
            <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-raised p-3">
              <Field label="Evidence reference(s)" htmlFor="cmt-evidence" required hint="Comma-separated — no file upload flow is wired here yet, so record what was done or where proof lives.">
                <Input id="cmt-evidence" value={evidenceRefs} onChange={(e) => setEvidenceRefs(e.target.value)} placeholder="e.g. site photo 12-Sep, WhatsApp confirmation" />
              </Field>
              {c.customer_facing && (
                <>
                  <label className="flex items-center gap-2 text-footnote text-fg">
                    <input type="checkbox" checked={customerConfirmed} onChange={(e) => setCustomerConfirmed(e.target.checked)} />
                    Customer has confirmed this today
                  </label>
                  <Field label="CRM confirmation note" htmlFor="cmt-crm-note" hint="Alternative to customer confirmation above">
                    <Textarea id="cmt-crm-note" value={crmNote} onChange={(e) => setCrmNote(e.target.value)} rows={2} />
                  </Field>
                </>
              )}
              {error && <p role="alert" className="text-footnote text-danger">{error}</p>}
              <div className="flex gap-2">
                <Button size="sm" onClick={confirm} loading={busy}>Confirm fulfil</Button>
                <Button size="sm" variant="ghost" onClick={resetForm} disabled={busy}>Never mind</Button>
              </div>
            </div>
          )}

          {(pending === "waive" || pending === "set-at-risk") && (
            <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-raised p-3">
              <Textarea placeholder={pending === "waive" ? "Reason (required)" : "Reason (optional)"} value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
              {error && <p role="alert" className="text-footnote text-danger">{error}</p>}
              <div className="flex gap-2">
                <Button size="sm" variant={pending === "waive" ? "danger" : "secondary"} onClick={confirm} loading={busy}>
                  Confirm {pending === "waive" ? "waive" : "flag at risk"}
                </Button>
                <Button size="sm" variant="ghost" onClick={resetForm} disabled={busy}>Never mind</Button>
              </div>
            </div>
          )}

          {pending === "recovery-plan" && (
            <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-raised p-3">
              <Field label="Recovery plan" htmlFor="cmt-recovery-plan" required>
                <Textarea id="cmt-recovery-plan" value={recoveryPlan} onChange={(e) => setRecoveryPlan(e.target.value)} rows={2} />
              </Field>
              <Field label="Recovery due date" htmlFor="cmt-recovery-due" required>
                <Input id="cmt-recovery-due" type="date" value={recoveryDue} onChange={(e) => setRecoveryDue(e.target.value)} />
              </Field>
              {error && <p role="alert" className="text-footnote text-danger">{error}</p>}
              <div className="flex gap-2">
                <Button size="sm" onClick={confirm} loading={busy}>Save recovery plan</Button>
                <Button size="sm" variant="ghost" onClick={resetForm} disabled={busy}>Never mind</Button>
              </div>
            </div>
          )}

          {pending === "root-cause" && (
            <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-raised p-3">
              <Field label="Root cause" htmlFor="cmt-root-cause" required>
                <Select value={rootCause} onValueChange={(v) => setRootCause(v as BreachRootCause)}>
                  <SelectTrigger id="cmt-root-cause" />
                  <SelectOptions options={ROOT_CAUSES.map((r) => ({ value: r, label: breachRootCauseLabel(r) }))} />
                </Select>
              </Field>
              {error && <p role="alert" className="text-footnote text-danger">{error}</p>}
              <div className="flex gap-2">
                <Button size="sm" onClick={confirm} loading={busy}>Save root cause</Button>
                <Button size="sm" variant="ghost" onClick={resetForm} disabled={busy}>Never mind</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function CommitmentDrawer({ commitmentId, onClose, onChanged }: { commitmentId: string | null; onClose: () => void; onChanged?: () => void }) {
  const [detail, setDetail] = useState<CommitmentDetail | null>(null);
  const [error, setError] = useState(false);

  function load() {
    if (!commitmentId) return;
    setError(false);
    commitmentsApi.get(commitmentId).then(setDetail).catch(() => setError(true));
  }

  useEffect(() => {
    setDetail(null);
    if (commitmentId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commitmentId]);

  function handleChanged() {
    load();
    onChanged?.();
  }

  return (
    <Drawer open={commitmentId !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DrawerContent open={commitmentId !== null} title={detail ? `${detail.code} · ${commitmentCategoryLabel(detail.category)}` : "Commitment"} width={480}>
        <div className="p-6">
          {error ? (
            <EmptyState icon={CircleAlert} message="Couldn't load this commitment." action={{ label: "Retry", onClick: load }} />
          ) : detail === null ? (
            <div className="flex flex-col gap-2">
              <Skeleton />
              <Skeleton />
            </div>
          ) : (
            <DetailBody c={detail} onChanged={handleChanged} />
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Landmark,
  Plus,
  ShieldCheck,
  ShieldAlert,
  Ban,
  AlertOctagon,
  CheckCircle2,
  Building2,
  Phone,
} from "lucide-react";

import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatINR } from "@/lib/format";
import { LOAN_STAGE_TONE, LOAN_EVENT_META, canManageLoan } from "@/lib/phase6";
import { isSuperAdmin } from "@/lib/collab";
import StatusPill from "@/components/StatusPill";
import CollaborationPanel from "@/components/CollaborationPanel";
import CanAccess from "@/components/rbac/CanAccess";
import RestrictedField from "@/components/rbac/RestrictedField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function LoanTab({ customerId, bookings }) {
  const { user } = useAuth();
  const confirmed = useMemo(
    () => (bookings || []).filter((b) => b.status === "Confirmed"),
    [bookings],
  );
  const [bookingId, setBookingId] = useState(confirmed[0]?.id || null);
  const [loan, setLoan] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showSanction, setShowSanction] = useState(false);
  const [showDisburse, setShowDisburse] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [showBlocker, setShowBlocker] = useState(false);

  useEffect(() => {
    if (!bookingId && confirmed[0]) setBookingId(confirmed[0].id);
  }, [confirmed, bookingId]);

  const load = async () => {
    if (!bookingId) return;
    setLoading(true);
    setNotFound(false);
    try {
      const r = await api.get(`/loans/booking/${bookingId}`);
      setLoan(r.data);
    } catch (e) {
      if (e?.response?.status === 404) { setLoan(null); setNotFound(true); }
      else apiErrorToast(e);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [bookingId]);

  if (confirmed.length === 0) return <EmptyPanel label="No Confirmed bookings yet." icon={Landmark} />;

  return (
    <div className="grid xl:grid-cols-[minmax(0,1fr)_360px] gap-6" data-testid="loan-tab">
      <div className="space-y-4 min-w-0">
        {confirmed.length > 1 && (
          <BookingPicker bookings={confirmed} value={bookingId} onChange={setBookingId} />
        )}

        {loading ? (
          <div className="text-xs text-gray-500 p-6">Loading loan…</div>
        ) : notFound ? (
          <NoLoanEmpty canCreate={canManageLoan(user)} onCreate={() => setShowCreate(true)} />
        ) : loan && (
          <>
            <LoanHeader loan={loan} />
            {loan.blocker && (
              <div className="rounded-md border border-red-200 bg-red-50 text-red-900 px-3 py-2 text-sm flex items-start gap-2" data-testid="loan-blocker-banner">
                <AlertOctagon className="h-4 w-4 mt-0.5 shrink-0" />
                <div className="flex-1"><span className="font-medium">Blocker:</span> {loan.blocker}</div>
                {canManageLoan(user) && (
                  <Button size="sm" variant="ghost" onClick={async () => {
                    try { await api.post(`/loans/${loan.id}/clear-blocker`); toast.success("Blocker cleared"); load(); }
                    catch (e) { apiErrorToast(e); }
                  }} data-testid="loan-clear-blocker">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Clear
                  </Button>
                )}
              </div>
            )}

            {canManageLoan(user) && loan.current_stage !== "Rejected" && loan.current_stage !== "Fully Disbursed" && (
              <CanAccess module="loans" action="write">
                <div className="flex flex-wrap items-center gap-2">
                  {(loan.current_stage === "Application" || loan.current_stage === "Sanction Pending") && (
                    <Button size="sm" onClick={() => setShowSanction(true)} data-testid="loan-record-sanction-btn">
                      <ShieldCheck className="h-3.5 w-3.5" /> Record sanction
                    </Button>
                  )}
                  {(loan.current_stage === "Sanctioned" || loan.current_stage === "Partially Disbursed" || loan.current_stage === "Disbursement Pending") && (
                    <Button size="sm" onClick={() => setShowDisburse(true)} data-testid="loan-record-disbursement-btn">
                      <Plus className="h-3.5 w-3.5" /> Record disbursement
                    </Button>
                  )}
                  {!loan.blocker && (
                    <Button size="sm" variant="outline" onClick={() => setShowBlocker(true)} data-testid="loan-record-blocker-btn">
                      <ShieldAlert className="h-3.5 w-3.5" /> Record blocker
                    </Button>
                  )}
                  {isSuperAdmin(user) && (
                    <Button size="sm" variant="ghost" onClick={() => setShowReject(true)} className="text-red-700" data-testid="loan-reject-btn">
                      <Ban className="h-3.5 w-3.5" /> Reject loan
                    </Button>
                  )}
                </div>
              </CanAccess>
            )}

            <LoanTimeline events={loan.events || []} />
          </>
        )}

        {/* Modals */}
        {bookingId && (
          <CreateLoanModal open={showCreate} onClose={() => setShowCreate(false)} bookingId={bookingId} onSaved={() => { setShowCreate(false); load(); }} />
        )}
        {loan && (
          <>
            <SanctionModal open={showSanction} onClose={() => setShowSanction(false)} loan={loan} onSaved={() => { setShowSanction(false); load(); }} />
            <DisbursementModal open={showDisburse} onClose={() => setShowDisburse(false)} loan={loan} onSaved={() => { setShowDisburse(false); load(); }} />
            <ReasonModal open={showReject} title="Reject loan" desc="Rejecting cancels the loan case and flips FC.bank_disbursement_applicable back to false. Reason is audit-logged." onClose={() => setShowReject(false)} onSubmit={async (reason) => { try { await api.post(`/loans/${loan.id}/reject`, { reason }); toast.success("Loan rejected"); setShowReject(false); load(); } catch (e) { apiErrorToast(e); } }} testId="loan-reject-modal" />
            <ReasonModal open={showBlocker} title="Record blocker" desc="Blocker text will show as a banner on the loan and be appended to the timeline." fieldLabel="Blocker text" onClose={() => setShowBlocker(false)} onSubmit={async (blocker_text) => { try { await api.post(`/loans/${loan.id}/record-blocker`, { blocker_text }); toast.success("Blocker recorded"); setShowBlocker(false); load(); } catch (e) { apiErrorToast(e); } }} testId="loan-blocker-modal" />
          </>
        )}
      </div>

      {loan && (
        <CollaborationPanel entityType="loan_case" entityId={loan.id} entityTitle={`Loan · ${loan.bank_name}`} />
      )}
    </div>
  );
}

function EmptyPanel({ label, icon: Icon }) {
  return (
    <div className="rounded-md border border-gray-200 bg-white p-6 text-center">
      <Icon className="h-6 w-6 text-gray-300 mx-auto" />
      <div className="mt-2 text-sm text-gray-700">{label}</div>
    </div>
  );
}

function BookingPicker({ bookings, value, onChange }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-500 uppercase tracking-wide">Booking</span>
      <Select value={value || ""} onValueChange={onChange}>
        <SelectTrigger className="h-8 w-72 text-sm"><SelectValue placeholder="Select a booking…" /></SelectTrigger>
        <SelectContent>
          {bookings.map((b) => <SelectItem key={b.id} value={b.id}><span className="font-mono text-xs">{b.code}</span></SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function NoLoanEmpty({ canCreate, onCreate }) {
  return (
    <div className="rounded-md border border-dashed border-gray-300 bg-white p-6 text-center" data-testid="loan-empty">
      <Landmark className="h-6 w-6 text-gray-300 mx-auto" />
      <div className="mt-2 text-sm text-gray-700">No loan case for this booking.</div>
      <div className="text-xs text-gray-500 mt-1">Loans are opt-in per booking. If the customer is self-funding, no case is required.</div>
      {canCreate && (
        <CanAccess module="loans" action="write">
          <Button size="sm" className="mt-3" onClick={onCreate} data-testid="loan-add-btn">
            <Plus className="h-3.5 w-3.5" /> Add loan case
          </Button>
        </CanAccess>
      )}
    </div>
  );
}

function LoanHeader({ loan }) {
  const requested = loan.requested_amount_inr || 0;
  const sanctioned = loan.sanctioned_amount_inr || 0;
  const disbursed = loan.disbursed_amount_inr || 0;
  const disbPct = sanctioned > 0 ? Math.round((disbursed / sanctioned) * 100) : 0;
  return (
    <div className="rounded-md border border-gray-200 bg-white overflow-hidden" data-testid="loan-header">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-gray-900 flex items-center gap-1.5">
            <Landmark className="h-4 w-4 text-navy-900" />
            {loan.bank_name}
            {loan.bank_branch && <span className="text-xs text-gray-500 font-normal">· {loan.bank_branch}</span>}
          </div>
          {loan.bank_rm_name && (
            <div className="text-[11px] text-gray-500 flex items-center gap-1 mt-0.5">
              <Phone className="h-3 w-3" /> RM: {loan.bank_rm_name}
              {loan.bank_rm_contact && <span className="font-mono ml-1">· {loan.bank_rm_contact}</span>}
            </div>
          )}
        </div>
        <StatusPill status={loan.current_stage} tone={LOAN_STAGE_TONE[loan.current_stage] || "grey"} testId="loan-stage-pill" />
      </div>
      <div className="grid grid-cols-3 divide-x divide-gray-100">
        <Metric label="Requested" value={<RestrictedField value={requested} module="customer_loan" format="inr" />} testId="loan-metric-requested" />
        <Metric label="Sanctioned" value={sanctioned == null ? <RestrictedField value={null} module="customer_loan" /> : (sanctioned ? formatINR(sanctioned) : "—")} sub={loan.sanction_date ? `on ${formatDate(loan.sanction_date)}` : ""} testId="loan-metric-sanctioned" />
        <Metric label="Disbursed" value={<RestrictedField value={disbursed} module="customer_loan" format="inr" />} sub={sanctioned ? `${disbPct}% of sanctioned` : ""} tone={disbursed > 0 ? "green" : "default"} testId="loan-metric-disbursed" />
      </div>
      {sanctioned > 0 && (
        <div className="px-4 py-2 border-t border-gray-100">
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${disbPct}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, sub, tone = "default", testId }) {
  const c = tone === "green" ? "text-emerald-700" : tone === "red" ? "text-red-700" : "text-gray-900";
  return (
    <div className="p-4" data-testid={testId}>
      <div className="text-xs uppercase tracking-wide text-slate-600 font-semibold">{label}</div>
      <div className={`font-heading text-lg font-semibold mt-1 tabular-nums ${c}`}>{value}</div>
      {sub && <div className="text-[11px] text-gray-500 mt-0.5 truncate">{sub}</div>}
    </div>
  );
}

function LoanTimeline({ events }) {
  if (!events.length) return <div className="text-xs text-gray-500 italic">No events yet.</div>;
  return (
    <div className="rounded-md border border-gray-200 bg-white" data-testid="loan-timeline">
      <div className="px-4 py-3 border-b border-gray-100 text-sm font-medium text-gray-900">Timeline</div>
      <ul className="divide-y divide-gray-100">
        {events.map((e) => {
          const meta = LOAN_EVENT_META[e.event_type] || { tone: "grey", label: e.event_type };
          return (
            <li key={e.id} className="px-4 py-3 flex items-start gap-3" data-testid={`loan-event-${e.id.slice(0, 8)}`}>
              <StatusPill status={meta.label} tone={meta.tone} />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-gray-900">
                  {e.amount_inr ? <span className="tabular-nums font-medium">{formatINR(e.amount_inr)}</span> : null}
                  {e.reference_no && <span className="font-mono text-[11px] text-gray-500 ml-2">{e.reference_no}</span>}
                </div>
                {e.notes && <div className="text-[11px] text-gray-600 mt-0.5">{e.notes}</div>}
              </div>
              <div className="text-[10px] text-gray-500 whitespace-nowrap">{formatDate(e.event_date)}</div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CreateLoanModal({ open, onClose, bookingId, onSaved }) {
  const [f, setF] = useState({ bank_name: "", bank_branch: "", bank_rm_name: "", bank_rm_contact: "", requested_amount_inr: "", notes: "" });
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setF({ bank_name: "", bank_branch: "", bank_rm_name: "", bank_rm_contact: "", requested_amount_inr: "", notes: "" }); }, [open]);
  const submit = async () => {
    if (!f.bank_name.trim() || !f.requested_amount_inr) return toast.error("Bank name + requested amount required");
    setSaving(true);
    try {
      await api.post("/loans", { booking_id: bookingId, ...f, requested_amount_inr: parseFloat(f.requested_amount_inr) });
      toast.success("Loan case created. FC bank flag set to Applicable.");
      onSaved?.();
    } catch (e) { apiErrorToast(e); }
    finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose?.()}>
      <DialogContent className="max-w-lg" data-testid="loan-create-modal">
        <DialogHeader>
          <DialogTitle>Add loan case</DialogTitle>
          <DialogDescription>Opening a loan case flips FC.bank_disbursement_applicable = true — the FC checklist will require disbursement before approval.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Bank name *"><Input value={f.bank_name} onChange={(e) => setF((s) => ({ ...s, bank_name: e.target.value }))} data-testid="loan-input-bank" className="h-9" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Branch"><Input value={f.bank_branch} onChange={(e) => setF((s) => ({ ...s, bank_branch: e.target.value }))} data-testid="loan-input-branch" className="h-9" /></Field>
            <Field label="Requested amount (₹) *"><Input type="number" value={f.requested_amount_inr} onChange={(e) => setF((s) => ({ ...s, requested_amount_inr: e.target.value }))} data-testid="loan-input-requested" className="h-9" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="RM name"><Input value={f.bank_rm_name} onChange={(e) => setF((s) => ({ ...s, bank_rm_name: e.target.value }))} className="h-9" /></Field>
            <Field label="RM contact"><Input value={f.bank_rm_contact} onChange={(e) => setF((s) => ({ ...s, bank_rm_contact: e.target.value }))} className="h-9" /></Field>
          </div>
          <Field label="Notes"><Textarea value={f.notes} onChange={(e) => setF((s) => ({ ...s, notes: e.target.value }))} className="min-h-[60px] text-sm" /></Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving} data-testid="loan-create-submit">{saving ? "Creating…" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SanctionModal({ open, onClose, loan, onSaved }) {
  const [f, setF] = useState({ sanctioned_amount_inr: "", sanction_date: "", sanction_validity_date: "", notes: "" });
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setF({ sanctioned_amount_inr: String(loan.requested_amount_inr || ""), sanction_date: new Date().toISOString().slice(0, 10), sanction_validity_date: "", notes: "" }); }, [open, loan]);
  const submit = async () => {
    if (!f.sanctioned_amount_inr || !f.sanction_date) return toast.error("Sanctioned amount + date required");
    setSaving(true);
    try {
      await api.post(`/loans/${loan.id}/record-sanction`, {
        sanctioned_amount_inr: parseFloat(f.sanctioned_amount_inr),
        sanction_date: new Date(f.sanction_date).toISOString(),
        sanction_validity_date: f.sanction_validity_date ? new Date(f.sanction_validity_date).toISOString() : null,
        notes: f.notes || null,
      });
      toast.success("Sanction recorded");
      onSaved?.();
    } catch (e) { apiErrorToast(e); }
    finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose?.()}>
      <DialogContent data-testid="loan-sanction-modal">
        <DialogHeader><DialogTitle>Record loan sanction</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Field label="Sanctioned amount (₹) *"><Input type="number" value={f.sanctioned_amount_inr} onChange={(e) => setF((s) => ({ ...s, sanctioned_amount_inr: e.target.value }))} className="h-9" data-testid="loan-sanction-amount" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Sanction date *"><Input type="date" value={f.sanction_date} onChange={(e) => setF((s) => ({ ...s, sanction_date: e.target.value }))} className="h-9" data-testid="loan-sanction-date" /></Field>
            <Field label="Validity date"><Input type="date" value={f.sanction_validity_date} onChange={(e) => setF((s) => ({ ...s, sanction_validity_date: e.target.value }))} className="h-9" /></Field>
          </div>
          <Field label="Notes"><Textarea value={f.notes} onChange={(e) => setF((s) => ({ ...s, notes: e.target.value }))} className="min-h-[60px] text-sm" /></Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving} data-testid="loan-sanction-submit">{saving ? "Saving…" : "Record sanction"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DisbursementModal({ open, onClose, loan, onSaved }) {
  const remaining = Math.max(0, (loan.sanctioned_amount_inr || 0) - (loan.disbursed_amount_inr || 0));
  const [f, setF] = useState({ amount_inr: "", event_date: "", reference_no: "", notes: "" });
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setF({ amount_inr: String(remaining), event_date: new Date().toISOString().slice(0, 10), reference_no: "", notes: "" }); }, [open, remaining]);
  const submit = async () => {
    if (!f.amount_inr || !f.event_date) return toast.error("Amount + date required");
    setSaving(true);
    try {
      await api.post(`/loans/${loan.id}/record-disbursement`, {
        amount_inr: parseFloat(f.amount_inr),
        event_date: new Date(f.event_date).toISOString(),
        reference_no: f.reference_no || null,
        notes: f.notes || null,
      });
      toast.success("Disbursement recorded");
      onSaved?.();
    } catch (e) { apiErrorToast(e); }
    finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose?.()}>
      <DialogContent data-testid="loan-disburse-modal">
        <DialogHeader><DialogTitle>Record disbursement</DialogTitle><DialogDescription>Remaining sanctioned: {formatINR(remaining)}. If cumulative disbursement matches sanctioned (±1%), stage flips to Fully Disbursed.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount (₹) *"><Input type="number" value={f.amount_inr} onChange={(e) => setF((s) => ({ ...s, amount_inr: e.target.value }))} className="h-9" data-testid="loan-disburse-amount" /></Field>
            <Field label="Date *"><Input type="date" value={f.event_date} onChange={(e) => setF((s) => ({ ...s, event_date: e.target.value }))} className="h-9" data-testid="loan-disburse-date" /></Field>
          </div>
          <Field label="Reference no."><Input value={f.reference_no} onChange={(e) => setF((s) => ({ ...s, reference_no: e.target.value }))} className="h-9" data-testid="loan-disburse-ref" /></Field>
          <Field label="Notes"><Textarea value={f.notes} onChange={(e) => setF((s) => ({ ...s, notes: e.target.value }))} className="min-h-[60px] text-sm" /></Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving} data-testid="loan-disburse-submit">{saving ? "Saving…" : "Record disbursement"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReasonModal({ open, onClose, onSubmit, title, desc, fieldLabel = "Reason", testId }) {
  const [text, setText] = useState("");
  useEffect(() => { if (open) setText(""); }, [open]);
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose?.()}>
      <DialogContent data-testid={testId}>
        <DialogHeader><DialogTitle>{title}</DialogTitle>{desc && <DialogDescription>{desc}</DialogDescription>}</DialogHeader>
        <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={fieldLabel} className="min-h-[80px] text-sm" data-testid={`${testId}-input`} />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSubmit(text.trim())} disabled={!text.trim()} data-testid={`${testId}-submit`}>Submit</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="text-[11px] text-gray-600">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

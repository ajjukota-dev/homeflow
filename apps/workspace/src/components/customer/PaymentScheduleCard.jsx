import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Wand2,
  Plus,
  ShieldCheck,
  ShieldAlert,
  Ban,
  ChevronDown,
  ChevronRight,
  CalendarDays,
} from "lucide-react";

import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatINR, formatINRFull } from "@/lib/format";
import { MILESTONE_STATUS_TONE, PAYMENT_STATUS_TONE, SCHEDULE_TEMPLATES, canManageFinance, canRecordPayment, canWaive } from "@/lib/financials";
import StatusPill from "@/components/StatusPill";
import RecordPaymentDialog from "@/components/customer/RecordPaymentDialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

/**
 * Payment schedule + milestones + linked payments.
 * Displays each milestone as an expandable row that reveals its linked payments.
 */
export default function PaymentScheduleCard({ bookingId, schedule, payments, loading, onChanged }) {
  const { user } = useAuth();
  const canFinance = canManageFinance(user);
  const canRecord = canRecordPayment(user);

  const paymentsByMilestone = useMemo(() => {
    const m = {};
    for (const p of payments || []) {
      const k = p.milestone_id || "__unlinked__";
      (m[k] = m[k] || []).push(p);
    }
    return m;
  }, [payments]);

  const [expanded, setExpanded] = useState({});
  const [showGenerate, setShowGenerate] = useState(false);
  const [templateChoice, setTemplateChoice] = useState(SCHEDULE_TEMPLATES[0]);
  const [generatingTpl, setGeneratingTpl] = useState(null);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [payDialogFor, setPayDialogFor] = useState(null); // { milestoneId, milestoneName, balance }
  const [waiveModal, setWaiveModal] = useState(null); // { paymentId, mode: "waive" | "dispute" }
  const [reasonText, setReasonText] = useState("");
  const [busyIds, setBusyIds] = useState(new Set());

  const setBusy = (id, v) =>
    setBusyIds((prev) => {
      const next = new Set(prev);
      v ? next.add(id) : next.delete(id);
      return next;
    });

  if (!bookingId) return null;

  const isEmpty = schedule && (schedule.milestones || []).length === 0;
  const total = schedule?.total_agreement_value_inr || 0;
  const openGenerate = async () => {
    setShowGenerate(true);
  };

  const onGenerateTemplate = async () => {
    try {
      const r = await api.post(`/payment-schedules/generate-template`, {
        booking_id: bookingId,
        template_name: templateChoice,
      });
      setGeneratingTpl(r.data);
    } catch (e) {
      apiErrorToast(e);
    }
  };

  const onSaveGenerated = async () => {
    if (!generatingTpl) return;
    setSavingSchedule(true);
    try {
      await api.post(`/payment-schedules`, {
        booking_id: bookingId,
        template_used: generatingTpl.template_used,
        total_agreement_value_inr: generatingTpl.total_agreement_value_inr,
        total_tax_inr: 0,
        milestones: generatingTpl.milestones,
      });
      toast.success("Payment schedule created");
      setShowGenerate(false);
      setGeneratingTpl(null);
      onChanged?.();
    } catch (e) {
      apiErrorToast(e);
    } finally {
      setSavingSchedule(false);
    }
  };

  const onVerify = async (paymentId) => {
    setBusy(paymentId, true);
    try {
      await api.post(`/payments/${paymentId}/verify`);
      toast.success("Payment verified. Journey task T7 auto-completed if this was the booking amount.");
      onChanged?.();
    } catch (e) {
      apiErrorToast(e);
    } finally {
      setBusy(paymentId, false);
    }
  };

  const onSubmitReason = async () => {
    if (!waiveModal) return;
    const { paymentId, mode } = waiveModal;
    if (!reasonText.trim()) {
      toast.error("Reason is required");
      return;
    }
    setBusy(paymentId, true);
    try {
      await api.post(`/payments/${paymentId}/${mode}`, { reason: reasonText.trim() });
      toast.success(mode === "waive" ? "Payment waived" : "Payment disputed");
      setWaiveModal(null);
      setReasonText("");
      onChanged?.();
    } catch (e) {
      apiErrorToast(e);
    } finally {
      setBusy(paymentId, false);
    }
  };

  return (
    <div className="rounded-md border border-gray-200 bg-white overflow-hidden" data-testid="fin-schedule-card">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-gray-900 flex items-center gap-1.5">
            <CalendarDays className="h-4 w-4 text-navy-900" />
            Payment schedule
          </div>
          <div className="text-[11px] text-gray-500">
            {schedule?.template_used ? `Template: ${schedule.template_used}` : "No template applied"}
            {schedule?.total_agreement_value_inr ? ` · ${formatINRFull(schedule.total_agreement_value_inr)}` : ""}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isEmpty && canFinance && (
            <Button size="sm" variant="outline" onClick={openGenerate} data-testid="fin-generate-template-btn">
              <Wand2 className="h-3.5 w-3.5" /> Apply template…
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="p-6 text-xs text-gray-500">Loading schedule…</div>
      ) : !schedule ? (
        <div className="p-6 text-xs text-gray-500">Schedule not available.</div>
      ) : isEmpty ? (
        <div className="p-6 text-center">
          <div className="text-sm text-gray-700">No milestones yet.</div>
          <div className="text-xs text-gray-500 mt-1">
            {canFinance
              ? "Apply a 30-40-30 / Construction Linked / Handover Bias template to seed milestones."
              : "Accounts will apply a milestone template to this booking."}
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr className="text-xs uppercase tracking-wide text-slate-600 font-semibold">
                <th className="h-9 px-3 text-left w-6"></th>
                <th className="h-9 px-3 text-left font-normal">Milestone</th>
                <th className="h-9 px-3 text-left font-normal">Due</th>
                <th className="h-9 px-3 text-right font-normal">Demand</th>
                <th className="h-9 px-3 text-right font-normal">Received</th>
                <th className="h-9 px-3 text-right font-normal">Balance</th>
                <th className="h-9 px-3 text-left font-normal">Status</th>
                <th className="h-9 px-3 text-right font-normal">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(schedule.milestones || []).map((m) => {
                const isOpen = expanded[m.id];
                const paysForMilestone = paymentsByMilestone[m.id] || [];
                const canPay = canRecord && m.balance_inr > 0 && m.status !== "Waived";
                return (
                  <>
                    <tr key={m.id} className="hover:bg-gray-50" data-testid={`fin-milestone-row-${m.sequence}`}>
                      <td className="px-3 py-2 align-top">
                        <button
                          type="button"
                          onClick={() => setExpanded((s) => ({ ...s, [m.id]: !s[m.id] }))}
                          className="text-gray-400 hover:text-gray-700"
                          aria-label="Expand"
                          data-testid={`fin-milestone-expand-${m.sequence}`}
                        >
                          {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        </button>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <div className="text-sm text-gray-900 font-medium flex items-center gap-1.5">
                          <span className="text-[10px] text-gray-400 font-mono">{String(m.sequence).padStart(2, "0")}</span>
                          {m.milestone_name}
                          {m.is_booking_amount && (
                            <span className="text-[9px] uppercase tracking-wide bg-brand-50 text-navy-900 rounded px-1 py-0.5">Booking</span>
                          )}
                        </div>
                        {m.notes && <div className="text-[11px] text-gray-500 mt-0.5">{m.notes}</div>}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <div className="text-xs text-gray-700">{formatDate(m.due_date)}</div>
                        {m.days_delta > 0 && m.status !== "Paid" && m.status !== "Waived" && (
                          <div className="text-[11px] text-red-700 font-medium mt-0.5">{m.days_delta}d overdue</div>
                        )}
                      </td>
                      <td className="px-3 py-2 align-top text-right tabular-nums">{formatINR(m.total_due_inr)}</td>
                      <td className="px-3 py-2 align-top text-right tabular-nums">
                        {formatINR(m.received_verified_inr)}
                        {m.received_pending_inr > 0 && (
                          <div className="text-[11px] text-amber-700">+{formatINR(m.received_pending_inr)} pending</div>
                        )}
                      </td>
                      <td className="px-3 py-2 align-top text-right tabular-nums font-medium">{formatINR(m.balance_inr)}</td>
                      <td className="px-3 py-2 align-top">
                        <StatusPill status={m.status} tone={MILESTONE_STATUS_TONE[m.status] || "grey"} testId={`fin-milestone-status-${m.sequence}`} />
                      </td>
                      <td className="px-3 py-2 align-top text-right">
                        {canPay && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setPayDialogFor({ milestoneId: m.id, milestoneName: m.milestone_name, balance: m.balance_inr })}
                            data-testid={`fin-record-payment-${m.sequence}`}
                          >
                            <Plus className="h-3.5 w-3.5" /> Record
                          </Button>
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-gray-50/50">
                        <td colSpan={8} className="px-3 py-2">
                          <PaymentSublist
                            payments={paysForMilestone}
                            canFinance={canFinance}
                            canWaivePayment={canWaive(user)}
                            onVerify={onVerify}
                            onDispute={(pid) => { setWaiveModal({ paymentId: pid, mode: "dispute" }); setReasonText(""); }}
                            onWaive={(pid) => { setWaiveModal({ paymentId: pid, mode: "waive" }); setReasonText(""); }}
                            busyIds={busyIds}
                          />
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
            <tfoot className="bg-gray-50 border-t border-gray-100">
              <tr>
                <td className="px-3 py-2"></td>
                <td className="px-3 py-2 text-xs uppercase text-gray-500 tracking-wide">Total</td>
                <td className="px-3 py-2"></td>
                <td className="px-3 py-2 text-right tabular-nums font-medium">{formatINR(total)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-emerald-700 font-medium">
                  {formatINR((schedule.milestones || []).reduce((s, m) => s + (m.received_verified_inr || 0), 0))}
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-medium">
                  {formatINR((schedule.milestones || []).reduce((s, m) => s + (m.balance_inr || 0), 0))}
                </td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Generate template dialog */}
      <Dialog open={showGenerate} onOpenChange={(v) => { if (!v) { setShowGenerate(false); setGeneratingTpl(null); } }}>
        <DialogContent className="max-w-lg" data-testid="fin-generate-dialog">
          <DialogHeader>
            <DialogTitle>Apply a payment template</DialogTitle>
            <DialogDescription>
              Pick a milestone template. You can preview before saving — nothing is written until you confirm.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Select value={templateChoice} onValueChange={setTemplateChoice}>
              <SelectTrigger data-testid="fin-generate-template-select"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SCHEDULE_TEMPLATES.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={onGenerateTemplate} data-testid="fin-generate-preview-btn">
              Preview
            </Button>
            {generatingTpl && (
              <div className="rounded-md border border-gray-200 bg-gray-50 p-3 space-y-2">
                <div className="text-xs text-gray-500">Preview · {generatingTpl.template_used} · {formatINR(generatingTpl.total_agreement_value_inr)}</div>
                <ul className="space-y-1 text-sm">
                  {generatingTpl.milestones.map((m, idx) => (
                    <li key={idx} className="flex items-center justify-between">
                      <span className="text-gray-900">
                        <span className="font-mono text-[10px] text-gray-400 mr-1">{String(m.sequence).padStart(2, "0")}</span>
                        {m.milestone_name}
                        {m.is_booking_amount && <span className="text-[9px] uppercase tracking-wide bg-brand-50 text-navy-900 rounded px-1 py-0.5 ml-1.5">Booking</span>}
                      </span>
                      <span className="text-xs text-gray-500">{formatDate(m.due_date)}</span>
                      <span className="tabular-nums font-medium text-gray-900">{formatINR(m.demand_amount_inr)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setShowGenerate(false); setGeneratingTpl(null); }}>Cancel</Button>
            <Button onClick={onSaveGenerated} disabled={!generatingTpl || savingSchedule} data-testid="fin-generate-save-btn">
              {savingSchedule ? "Saving…" : "Save schedule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Record payment dialog */}
      <RecordPaymentDialog
        open={Boolean(payDialogFor)}
        onClose={() => setPayDialogFor(null)}
        bookingId={bookingId}
        milestoneId={payDialogFor?.milestoneId}
        milestoneName={payDialogFor?.milestoneName}
        balance={payDialogFor?.balance}
        onSaved={() => { setPayDialogFor(null); onChanged?.(); }}
      />

      {/* Dispute / Waive reason */}
      <Dialog open={Boolean(waiveModal)} onOpenChange={(v) => { if (!v) { setWaiveModal(null); setReasonText(""); } }}>
        <DialogContent data-testid="fin-reason-dialog">
          <DialogHeader>
            <DialogTitle>{waiveModal?.mode === "waive" ? "Waive payment" : "Dispute payment"}</DialogTitle>
            <DialogDescription>
              {waiveModal?.mode === "waive"
                ? "Waiving marks this payment as absorbed. Reason is audit-logged and visible to Management."
                : "Disputing flags the payment for follow-up with the customer. Reason is required."}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={reasonText}
            onChange={(e) => setReasonText(e.target.value)}
            placeholder="Reason…"
            className="min-h-[80px] text-sm"
            data-testid="fin-reason-textarea"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setWaiveModal(null); setReasonText(""); }}>Cancel</Button>
            <Button onClick={onSubmitReason} disabled={!reasonText.trim()} data-testid="fin-reason-submit">
              Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PaymentSublist({ payments, canFinance, canWaivePayment, onVerify, onDispute, onWaive, busyIds }) {
  if (!payments.length) {
    return <div className="text-xs text-gray-500 italic py-1 pl-6">No payments recorded against this milestone yet.</div>;
  }
  return (
    <div className="pl-6 pr-2">
      <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Payments</div>
      <ul className="divide-y divide-gray-200 border border-gray-200 rounded-md bg-white">
        {payments.map((p) => {
          const isBusy = busyIds.has(p.id);
          return (
            <li key={p.id} className="flex items-center gap-3 px-3 py-2 text-sm" data-testid={`fin-payment-row-${p.id.slice(0, 8)}`}>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-gray-900 tabular-nums">
                  {formatINR(p.amount_inr + (p.tax_inr || 0))}
                  <span className="text-[10px] uppercase tracking-wide text-gray-400 ml-2">{p.payment_mode}</span>
                  {p.reference_no && <span className="font-mono text-[10px] text-gray-500 ml-1.5">{p.reference_no}</span>}
                </div>
                <div className="text-[11px] text-gray-500">
                  {formatDate(p.payment_date)}
                  {p.verification_notes && <span> · <span className="italic">{p.verification_notes}</span></span>}
                </div>
              </div>
              <StatusPill status={p.verification_status} tone={PAYMENT_STATUS_TONE[p.verification_status] || "grey"} />
              {canFinance && p.verification_status === "Pending" && (
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => onVerify(p.id)} disabled={isBusy} data-testid={`fin-payment-verify-${p.id.slice(0, 8)}`}>
                    <ShieldCheck className="h-3.5 w-3.5" /> Verify
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onDispute(p.id)} disabled={isBusy} data-testid={`fin-payment-dispute-${p.id.slice(0, 8)}`}>
                    <ShieldAlert className="h-3.5 w-3.5" /> Dispute
                  </Button>
                </div>
              )}
              {canWaivePayment && p.verification_status !== "Waived" && p.verification_status !== "Verified" && (
                <Button size="sm" variant="ghost" onClick={() => onWaive(p.id)} disabled={isBusy} className="text-gray-500" data-testid={`fin-payment-waive-${p.id.slice(0, 8)}`}>
                  <Ban className="h-3.5 w-3.5" /> Waive
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

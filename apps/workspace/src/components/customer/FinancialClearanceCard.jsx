import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ShieldCheck, ShieldAlert, ClipboardCheck } from "lucide-react";

import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { FC_CHECKLIST_ITEMS, FC_STATUS_TONE, canManageFinance } from "@/lib/financials";
import StatusPill from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

/**
 * Financial Clearance card — Accounts approves the booking's financial readiness.
 * Approved FC is the Registration gate (consumed by Phase 6).
 */
export default function FinancialClearanceCard({ bookingId, fc, tds, onChanged }) {
  const { user } = useAuth();
  const canManage = canManageFinance(user);
  const [saving, setSaving] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const disabled = !fc || fc.status === "Approved" || !canManage;

  const bankApplicable = Boolean(fc?.checklist?.bank_disbursement_applicable);
  const unmet = useMemo(() => {
    if (!fc) return [];
    const required = ["ledger_reconciled", "due_amounts_paid", "tds_verified", "other_charges_cleared", "exceptions_approved"];
    if (bankApplicable) required.push("bank_disbursement_received");
    return required.filter((k) => !fc.checklist?.[k]);
  }, [fc, bankApplicable]);

  if (!bookingId) return null;
  if (!fc) return (
    <div className="rounded-md border border-gray-200 bg-white p-4 text-xs text-gray-500" data-testid="fin-fc-loading">
      Loading financial clearance…
    </div>
  );

  const tdsBlockingReason =
    tds && tds.verification_status !== "Verified" && tds.applicability !== "Not Applicable"
      ? "TDS record must be Verified or Not Applicable before you can tick tds_verified."
      : null;

  const toggleItem = async (key, val) => {
    if (disabled) return;
    setSaving(true);
    try {
      await api.patch(`/financial-clearances/${fc.id}/checklist`, { [key]: val });
      onChanged?.();
    } catch (e) {
      apiErrorToast(e);
    } finally {
      setSaving(false);
    }
  };

  const approve = async () => {
    setSaving(true);
    try {
      await api.post(`/financial-clearances/${fc.id}/approve`);
      toast.success("Financial clearance approved — Registration gate open.");
      onChanged?.();
    } catch (e) {
      apiErrorToast(e);
    } finally {
      setSaving(false);
    }
  };

  const reject = async () => {
    if (!rejectReason.trim()) return toast.error("Reason is required");
    setSaving(true);
    try {
      await api.post(`/financial-clearances/${fc.id}/reject`, { reason: rejectReason.trim() });
      toast.success("Financial clearance rejected");
      setShowRejectModal(false); setRejectReason("");
      onChanged?.();
    } catch (e) {
      apiErrorToast(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-md border border-gray-200 bg-white overflow-hidden" data-testid="fin-fc-card">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-gray-900 flex items-center gap-1.5">
            <ClipboardCheck className="h-4 w-4 text-navy-900" />
            Financial clearance
          </div>
          <div className="text-[11px] text-gray-500">Accounts sign-off unblocking Registration. Approved FC is required by Phase 6.</div>
        </div>
        <StatusPill status={fc.status} tone={FC_STATUS_TONE[fc.status] || "grey"} testId="fin-fc-status" />
      </div>

      <div className="p-4 space-y-3">
        <ul className="rounded-md border border-gray-200 divide-y divide-gray-100">
          {FC_CHECKLIST_ITEMS.map((item) => {
            const isBank = item.key === "bank_disbursement_received";
            const skipped = isBank && !bankApplicable;
            const checked = Boolean(fc.checklist?.[item.key]);
            const isBlocked =
              (item.key === "tds_verified" && tdsBlockingReason && !checked) || skipped;
            return (
              <li key={item.key} className="flex items-start gap-2 px-3 py-2">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => toggleItem(item.key, e.target.checked)}
                  disabled={disabled || isBlocked}
                  className="mt-0.5 h-3.5 w-3.5"
                  data-testid={`fin-fc-item-${item.key}`}
                />
                <div className="flex-1 min-w-0">
                  <div className={`text-sm ${skipped ? "text-gray-400 line-through" : "text-gray-900"}`}>
                    {item.label}
                  </div>
                  {item.key === "tds_verified" && tdsBlockingReason && !checked && (
                    <div className="text-[11px] text-amber-700 mt-0.5">{tdsBlockingReason}</div>
                  )}
                  {skipped && (
                    <div className="text-[11px] text-gray-500 mt-0.5">Skipped — bank disbursement not applicable to this booking.</div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        {fc.rejection_reason && fc.status === "Rejected" && (
          <div className="rounded-md border border-red-200 bg-red-50 text-red-800 text-xs p-2">
            Rejected: {fc.rejection_reason}
          </div>
        )}

        {fc.status === "Approved" && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 text-emerald-800 text-xs p-2 flex items-center gap-1">
            <ShieldCheck className="h-3.5 w-3.5" /> Approved on {formatDate(fc.approved_at)} — Registration gate open.
          </div>
        )}

        {canManage && fc.status !== "Approved" && (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={approve}
              disabled={saving || unmet.length > 0}
              title={unmet.length ? `Complete: ${unmet.join(", ")}` : "Approve financial clearance"}
              data-testid="fin-fc-approve"
            >
              <ShieldCheck className="h-3.5 w-3.5" /> Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowRejectModal(true)}
              disabled={saving}
              data-testid="fin-fc-reject"
            >
              <ShieldAlert className="h-3.5 w-3.5" /> Reject
            </Button>
            {unmet.length > 0 && (
              <span className="text-[11px] text-gray-500 truncate">
                {unmet.length} item{unmet.length === 1 ? "" : "s"} pending
              </span>
            )}
          </div>
        )}
      </div>

      <Dialog open={showRejectModal} onOpenChange={(v) => { if (!v) { setShowRejectModal(false); setRejectReason(""); } }}>
        <DialogContent data-testid="fin-fc-reject-dialog">
          <DialogHeader>
            <DialogTitle>Reject financial clearance</DialogTitle>
            <DialogDescription>Reason is audit-logged and visible to CRM.</DialogDescription>
          </DialogHeader>
          <Textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            className="min-h-[80px] text-sm"
            data-testid="fin-fc-reject-reason"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setShowRejectModal(false); setRejectReason(""); }}>Cancel</Button>
            <Button onClick={reject} disabled={!rejectReason.trim() || saving} data-testid="fin-fc-reject-submit">Reject</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

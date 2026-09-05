import { useState } from "react";
import { toast } from "sonner";
import { Receipt, Upload, ShieldCheck, ShieldAlert, FileText, RotateCcw } from "lucide-react";

import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatINR } from "@/lib/format";
import { TDS_APPLICABILITY_TONE, TDS_VERIFICATION_TONE, canManageTDS, canVerifyTDS } from "@/lib/financials";
import StatusPill from "@/components/StatusPill";
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

/**
 * TDS record card. Applicability drives task T8. Applicable + verified → T8 completed.
 */
export default function TDSCard({ bookingId, tds, onChanged }) {
  const { user } = useAuth();
  const canManage = canManageTDS(user);
  const canVerify = canVerifyTDS(user);
  const [showNAModal, setShowNAModal] = useState(false);
  const [naReason, setNaReason] = useState("");
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [verifyNotes, setVerifyNotes] = useState("");
  const [decision, setDecision] = useState("Verified");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});

  if (!bookingId) return null;
  if (!tds) return (
    <div className="rounded-md border border-gray-200 bg-white p-4 text-xs text-gray-500" data-testid="fin-tds-loading">
      Loading TDS record…
    </div>
  );

  const readonly = tds.applicability === "Not Applicable";
  const canFillFields = canManage && !readonly;

  const startEdit = () => {
    setForm({
      tds_amount_inr: tds.tds_amount_inr ?? "",
      challan_number: tds.challan_number ?? "",
      challan_date: tds.challan_date ? tds.challan_date.slice(0, 10) : "",
      pan_number: tds.pan_number ?? "",
    });
    setEditing(true);
  };

  const setApplicability = async (val) => {
    if (val === "Not Applicable") {
      setShowNAModal(true);
      return;
    }
    setSaving(true);
    try {
      await api.post(`/tds/${tds.id}/set-applicability`, { applicability: "Applicable" });
      toast.success("TDS marked Applicable. Task T8 reset to Not Started.");
      onChanged?.();
    } catch (e) {
      apiErrorToast(e);
    } finally {
      setSaving(false);
    }
  };

  const submitNA = async () => {
    if (!naReason.trim()) return toast.error("Reason is required");
    setSaving(true);
    try {
      await api.post(`/tds/${tds.id}/set-applicability`, { applicability: "Not Applicable", na_reason: naReason.trim() });
      toast.success("TDS marked Not Applicable. Task T8 cancelled.");
      setShowNAModal(false); setNaReason("");
      onChanged?.();
    } catch (e) {
      apiErrorToast(e);
    } finally {
      setSaving(false);
    }
  };

  const saveFields = async () => {
    setSaving(true);
    try {
      const payload = {
        tds_amount_inr: form.tds_amount_inr === "" ? null : parseFloat(form.tds_amount_inr),
        challan_number: form.challan_number || null,
        challan_date: form.challan_date ? new Date(form.challan_date).toISOString() : null,
        pan_number: form.pan_number || null,
      };
      await api.patch(`/tds/${tds.id}`, payload);
      toast.success("TDS details saved");
      setEditing(false);
      onChanged?.();
    } catch (e) {
      apiErrorToast(e);
    } finally {
      setSaving(false);
    }
  };

  const uploadChallan = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      await api.post(`/tds/${tds.id}/upload-challan`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("Challan uploaded");
      onChanged?.();
    } catch (err) {
      apiErrorToast(err);
    } finally {
      setSaving(false);
    }
  };

  const submitVerify = async () => {
    setSaving(true);
    try {
      await api.post(`/tds/${tds.id}/verify`, { decision, notes: verifyNotes.trim() || null });
      toast.success(decision === "Verified" ? "TDS verified. Task T8 auto-completed." : "TDS rejected — comment posted on T8.");
      setShowVerifyModal(false); setVerifyNotes("");
      onChanged?.();
    } catch (e) {
      apiErrorToast(e);
    } finally {
      setSaving(false);
    }
  };

  const readyToVerify = Boolean(
    tds.applicability === "Applicable" &&
    tds.tds_amount_inr && tds.challan_number && tds.challan_date && tds.pan_number && tds.uploaded_attachment_id
  );

  return (
    <div className="rounded-md border border-gray-200 bg-white overflow-hidden" data-testid="fin-tds-card">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-gray-900 flex items-center gap-1.5">
            <Receipt className="h-4 w-4 text-navy-900" />
            TDS · Section 194IA
          </div>
          <div className="text-[11px] text-gray-500">Buyer deducts TDS on booking amount. Managed by Accounts; drives task T8.</div>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill status={tds.applicability} tone={TDS_APPLICABILITY_TONE[tds.applicability] || "grey"} testId="fin-tds-applicability" />
          {tds.applicability === "Applicable" && (
            <StatusPill status={tds.verification_status} tone={TDS_VERIFICATION_TONE[tds.verification_status] || "grey"} testId="fin-tds-verification-status" />
          )}
        </div>
      </div>

      <div className="p-4 space-y-3">
        {/* Applicability toggle */}
        {canManage && tds.verification_status !== "Verified" && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-500 uppercase tracking-wide mr-2">Applicability</span>
            <Button
              size="sm"
              variant={tds.applicability === "Applicable" ? "default" : "outline"}
              onClick={() => setApplicability("Applicable")}
              disabled={saving || tds.applicability === "Applicable"}
              data-testid="fin-tds-set-applicable"
            >
              Applicable
            </Button>
            <Button
              size="sm"
              variant={tds.applicability === "Not Applicable" ? "default" : "outline"}
              onClick={() => setApplicability("Not Applicable")}
              disabled={saving || tds.applicability === "Not Applicable"}
              data-testid="fin-tds-set-na"
            >
              Not Applicable
            </Button>
            {tds.applicability === "Not Applicable" && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setApplicability("Applicable")}
                disabled={saving}
                className="text-navy-900"
                data-testid="fin-tds-restore"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Undo Not Applicable
              </Button>
            )}
          </div>
        )}

        {tds.applicability === "Not Applicable" && (
          <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm">
            <div className="text-gray-700">This TDS record has been marked <span className="font-medium">Not Applicable</span>.</div>
            {tds.na_reason && <div className="mt-1 text-xs text-gray-600 italic">"{tds.na_reason}"</div>}
            <div className="mt-1 text-[11px] text-gray-500">Journey task T8 was cancelled and does not block Registration.</div>
          </div>
        )}

        {tds.applicability !== "Not Applicable" && (
          <>
            {!editing ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 rounded-md border border-gray-200 bg-gray-50/60 p-3">
                <Field label="TDS amount">{tds.tds_amount_inr ? formatINR(tds.tds_amount_inr) : <span className="text-amber-700">—</span>}</Field>
                <Field label="Challan #">{tds.challan_number || <span className="text-amber-700">—</span>}</Field>
                <Field label="Challan date">{tds.challan_date ? formatDate(tds.challan_date) : <span className="text-amber-700">—</span>}</Field>
                <Field label="Customer PAN">{tds.pan_number || <span className="text-amber-700">—</span>}</Field>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 rounded-md border border-brand-200 bg-brand-50/40 p-3">
                <Field label="TDS amount">
                  <Input type="number" value={form.tds_amount_inr} onChange={(e) => setForm((s) => ({ ...s, tds_amount_inr: e.target.value }))} className="h-8 text-sm" data-testid="fin-tds-input-amount" />
                </Field>
                <Field label="Challan #">
                  <Input value={form.challan_number} onChange={(e) => setForm((s) => ({ ...s, challan_number: e.target.value }))} className="h-8 text-sm" data-testid="fin-tds-input-challan" />
                </Field>
                <Field label="Challan date">
                  <Input type="date" value={form.challan_date} onChange={(e) => setForm((s) => ({ ...s, challan_date: e.target.value }))} className="h-8 text-sm" data-testid="fin-tds-input-date" />
                </Field>
                <Field label="Customer PAN">
                  <Input value={form.pan_number} onChange={(e) => setForm((s) => ({ ...s, pan_number: e.target.value.toUpperCase() }))} className="h-8 text-sm uppercase" placeholder="ABCDE1234F" maxLength={10} data-testid="fin-tds-input-pan" />
                </Field>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {canFillFields && !editing && tds.verification_status !== "Verified" && (
                <Button size="sm" variant="outline" onClick={startEdit} data-testid="fin-tds-edit">
                  Edit fields
                </Button>
              )}
              {canFillFields && editing && (
                <>
                  <Button size="sm" onClick={saveFields} disabled={saving} data-testid="fin-tds-save">Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
                </>
              )}
              {canFillFields && tds.verification_status !== "Verified" && (
                <>
                  <label className="inline-flex items-center gap-2">
                    <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={uploadChallan} data-testid="fin-tds-upload-input" />
                    <Button size="sm" variant="outline" onClick={(e) => e.currentTarget.previousSibling?.click()} disabled={saving} data-testid="fin-tds-upload-btn">
                      <Upload className="h-3.5 w-3.5" /> {tds.uploaded_attachment_id ? "Replace challan" : "Upload challan"}
                    </Button>
                  </label>
                  {tds.uploaded_attachment_id && (
                    <span className="text-[11px] text-gray-500 inline-flex items-center gap-1">
                      <FileText className="h-3 w-3" /> Challan attached
                    </span>
                  )}
                </>
              )}
              {canVerify && tds.applicability === "Applicable" && tds.verification_status !== "Verified" && (
                <div className="ml-auto flex gap-1">
                  <Button
                    size="sm"
                    onClick={() => { setDecision("Verified"); setShowVerifyModal(true); }}
                    disabled={!readyToVerify || saving}
                    title={readyToVerify ? "Verify challan" : "Fill amount, challan #, challan date, PAN, and upload a challan to verify"}
                    data-testid="fin-tds-verify-btn"
                  >
                    <ShieldCheck className="h-3.5 w-3.5" /> Verify
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { setDecision("Rejected"); setShowVerifyModal(true); }}
                    disabled={saving}
                    data-testid="fin-tds-reject-btn"
                  >
                    <ShieldAlert className="h-3.5 w-3.5" /> Reject
                  </Button>
                </div>
              )}
              {tds.verification_status === "Verified" && (
                <div className="ml-auto text-[11px] text-emerald-700 inline-flex items-center gap-1">
                  <ShieldCheck className="h-3.5 w-3.5" /> Verified · Task T8 auto-completed
                </div>
              )}
            </div>

            {tds.verification_notes && tds.verification_status === "Rejected" && (
              <div className="rounded-md border border-red-200 bg-red-50 text-red-800 text-xs p-2">
                Rejected: {tds.verification_notes}
              </div>
            )}
          </>
        )}
      </div>

      {/* Not Applicable reason modal */}
      <Dialog open={showNAModal} onOpenChange={(v) => { if (!v) { setShowNAModal(false); setNaReason(""); } }}>
        <DialogContent data-testid="fin-tds-na-dialog">
          <DialogHeader>
            <DialogTitle>Mark TDS Not Applicable</DialogTitle>
            <DialogDescription>
              A reason is required and is audit-logged. Journey task T8 will be cancelled and will not block Registration.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={naReason}
            onChange={(e) => setNaReason(e.target.value)}
            placeholder="e.g. Consideration below ₹50L threshold — Section 194IA not attracted."
            className="min-h-[80px] text-sm"
            data-testid="fin-tds-na-reason"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setShowNAModal(false); setNaReason(""); }}>Cancel</Button>
            <Button onClick={submitNA} disabled={!naReason.trim() || saving} data-testid="fin-tds-na-submit">Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Verify modal */}
      <Dialog open={showVerifyModal} onOpenChange={(v) => { if (!v) { setShowVerifyModal(false); setVerifyNotes(""); } }}>
        <DialogContent data-testid="fin-tds-verify-dialog">
          <DialogHeader>
            <DialogTitle>{decision === "Verified" ? "Verify TDS challan" : "Reject TDS challan"}</DialogTitle>
            <DialogDescription>
              {decision === "Verified"
                ? "This will mark the TDS record Verified and auto-complete journey task T8."
                : "Rejecting posts a comment on task T8 with your notes. The customer will need to re-submit a valid challan."}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={verifyNotes}
            onChange={(e) => setVerifyNotes(e.target.value)}
            placeholder={decision === "Verified" ? "Notes (optional)" : "Reason for rejection (recommended)"}
            className="min-h-[60px] text-sm"
            data-testid="fin-tds-verify-notes"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setShowVerifyModal(false); setVerifyNotes(""); }}>Cancel</Button>
            <Button onClick={submitVerify} disabled={saving} data-testid="fin-tds-verify-submit">
              {decision === "Verified" ? "Verify" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-600 font-semibold">{label}</div>
      <div className="text-sm text-gray-900 mt-0.5">{children}</div>
    </div>
  );
}

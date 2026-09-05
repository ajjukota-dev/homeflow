import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Scale, Upload, FileText, ShieldCheck, ShieldAlert, GitCommit, Ban } from "lucide-react";

import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { LEGAL_STATUS_TONE, canManageLegal } from "@/lib/phase6";
import StatusPill from "@/components/StatusPill";
import CollaborationPanel from "@/components/CollaborationPanel";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function LegalTab({ customerId, bookings }) {
  const { user } = useAuth();
  const confirmed = useMemo(
    () => (bookings || []).filter((b) => b.status === "Confirmed"),
    [bookings],
  );
  const [bookingId, setBookingId] = useState(confirmed[0]?.id || null);
  const [legal, setLegal] = useState(null);
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showDeviation, setShowDeviation] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [showApprove, setShowApprove] = useState(false);
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!bookingId && confirmed[0]) setBookingId(confirmed[0].id);
  }, [confirmed, bookingId]);

  const load = async () => {
    if (!bookingId) return;
    setLoading(true);
    try {
      const [r, v] = await Promise.all([
        api.get(`/legal/booking/${bookingId}`),
        api.get(`/legal/booking/${bookingId}`).then(async (rr) =>
          rr.data?.id ? await api.get(`/legal/${rr.data.id}/versions`) : { data: [] }
        ),
      ]);
      setLegal(r.data);
      setVersions(v.data || []);
    } catch (e) { apiErrorToast(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [bookingId]);

  if (confirmed.length === 0) {
    return (
      <div className="rounded-md border border-gray-200 bg-white p-6 text-center" data-testid="legal-empty">
        <Scale className="h-6 w-6 text-gray-300 mx-auto" />
        <div className="mt-2 text-sm text-gray-700">No Confirmed bookings yet.</div>
      </div>
    );
  }

  const canManage = canManageLegal(user);

  const onUpload = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f || !legal) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      await api.post(`/legal/${legal.id}/upload-draft`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("Draft uploaded" + (legal.status === "Not Started" ? " · Journey task T5 auto-completed" : ""));
      load();
    } catch (err) { apiErrorToast(err); }
    finally { setUploading(false); }
  };

  const submitReview = async () => {
    try { await api.post(`/legal/${legal.id}/submit-for-review`); toast.success("Submitted for review"); load(); }
    catch (e) { apiErrorToast(e); }
  };
  const resolveDev = async () => {
    try { await api.post(`/legal/${legal.id}/resolve-deviations`); toast.success("Deviations resolved"); load(); }
    catch (e) { apiErrorToast(e); }
  };

  return (
    <div className="grid xl:grid-cols-[minmax(0,1fr)_360px] gap-6" data-testid="legal-tab">
      <div className="space-y-4 min-w-0">
        {confirmed.length > 1 && (
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500 uppercase tracking-wide">Booking</span>
            <Select value={bookingId || ""} onValueChange={setBookingId}>
              <SelectTrigger className="h-8 w-72 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {confirmed.map((b) => <SelectItem key={b.id} value={b.id}><span className="font-mono text-xs">{b.code}</span></SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}

        {loading ? (
          <div className="text-xs text-gray-500 p-6">Loading legal…</div>
        ) : legal && (
          <>
            <div className="rounded-md border border-gray-200 bg-white overflow-hidden" data-testid="legal-header">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-gray-900 flex items-center gap-1.5">
                    <Scale className="h-4 w-4 text-navy-900" />
                    Sale agreement
                  </div>
                  <div className="text-[11px] text-gray-500">Latest v{legal.latest_version} · {legal.version_count} version{legal.version_count === 1 ? "" : "s"}</div>
                </div>
                <StatusPill status={legal.status} tone={LEGAL_STATUS_TONE[legal.status] || "grey"} testId="legal-status-pill" />
              </div>

              <div className="p-4 space-y-3">
                {legal.latest_draft && (
                  <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 flex items-center gap-2 text-sm">
                    <FileText className="h-3.5 w-3.5 text-gray-500" />
                    <span className="font-medium text-gray-900 truncate flex-1">{legal.latest_draft.filename}</span>
                    <span className="text-[11px] text-gray-500">v{legal.latest_version} · {formatDate(legal.latest_draft.uploaded_at)}</span>
                  </div>
                )}
                {legal.deviation_notes && legal.status === "Deviations Raised" && (
                  <div className="rounded-md border border-orange-200 bg-orange-50 text-orange-900 p-3 text-sm" data-testid="legal-deviation-notes">
                    <div className="text-xs uppercase tracking-wide font-medium mb-1">Deviations raised</div>
                    <div className="whitespace-pre-wrap">{legal.deviation_notes}</div>
                  </div>
                )}
                {legal.rejection_reason && legal.status === "Rejected" && (
                  <div className="rounded-md border border-red-200 bg-red-50 text-red-900 p-3 text-sm">
                    <div className="text-xs uppercase tracking-wide font-medium mb-1">Rejected</div>
                    <div>{legal.rejection_reason}</div>
                  </div>
                )}
                {legal.status === "Approved" && (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 text-emerald-900 p-3 text-sm inline-flex items-center gap-1.5" data-testid="legal-approved-banner">
                    <ShieldCheck className="h-3.5 w-3.5" /> Approved {legal.approved_at ? `on ${formatDate(legal.approved_at)}` : ""} — Journey task T6 auto-completed.
                  </div>
                )}

                {canManage && legal.status !== "Approved" && (
                  <div className="flex flex-wrap items-center gap-2">
                    <input type="file" ref={fileRef} onChange={onUpload} accept=".pdf,.docx,.doc" className="hidden" data-testid="legal-file-input" />
                    <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading} data-testid="legal-upload-btn">
                      <Upload className="h-3.5 w-3.5" /> {uploading ? "Uploading…" : legal.latest_draft ? "Upload new version" : "Upload draft"}
                    </Button>
                    {(legal.status === "Draft Uploaded" || legal.status === "Deviations Raised") && (
                      <Button size="sm" variant="outline" onClick={submitReview} data-testid="legal-submit-review-btn">
                        Submit for review
                      </Button>
                    )}
                    {legal.status === "Deviations Raised" && (
                      <Button size="sm" variant="outline" onClick={resolveDev} data-testid="legal-resolve-btn">
                        Resolve deviations
                      </Button>
                    )}
                    {(legal.status === "Draft Uploaded" || legal.status === "Under Review") && legal.latest_draft && (
                      <Button size="sm" variant="outline" onClick={() => setShowDeviation(true)} data-testid="legal-raise-dev-btn">
                        <ShieldAlert className="h-3.5 w-3.5" /> Raise deviation
                      </Button>
                    )}
                    {(legal.status === "Draft Uploaded" || legal.status === "Under Review" || legal.status === "Deviations Raised") && legal.latest_draft && (
                      <>
                        <Button size="sm" onClick={() => setShowApprove(true)} data-testid="legal-approve-btn">
                          <ShieldCheck className="h-3.5 w-3.5" /> Approve
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setShowReject(true)} className="text-red-700" data-testid="legal-reject-btn">
                          <Ban className="h-3.5 w-3.5" /> Reject
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            {versions.length > 0 && (
              <div className="rounded-md border border-gray-200 bg-white overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 text-sm font-medium text-gray-900 flex items-center gap-1.5">
                  <GitCommit className="h-4 w-4 text-gray-500" /> Version history
                </div>
                <ul className="divide-y divide-gray-100">
                  {versions.map((v) => (
                    <li key={v.id} className="px-4 py-2 flex items-center gap-3 text-sm" data-testid={`legal-version-${v.version}`}>
                      <span className="text-[10px] uppercase tracking-wide bg-gray-100 rounded px-1.5 py-0.5 text-gray-700 font-medium">v{v.version}</span>
                      <span className="text-gray-900 truncate flex-1">{v.attachment?.filename || "—"}</span>
                      <span className="text-[11px] text-gray-500">{formatDate(v.uploaded_at)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        {legal && (
          <>
            <ReasonModal
              open={showDeviation} onClose={() => setShowDeviation(false)}
              title="Raise deviation" desc="Legal deviation blocks approval until resolved."
              fieldLabel="Deviation notes…"
              onSubmit={async (deviation_notes) => { try { await api.post(`/legal/${legal.id}/raise-deviation`, { deviation_notes }); toast.success("Deviation raised"); setShowDeviation(false); load(); } catch (e) { apiErrorToast(e); } }}
              testId="legal-dev-modal"
            />
            <ReasonModal
              open={showReject} onClose={() => setShowReject(false)}
              title="Reject legal draft" desc="Rejection reverse-cascades T5 + T6 if they were previously completed."
              onSubmit={async (reason) => { try { await api.post(`/legal/${legal.id}/reject`, { reason }); toast.success("Legal rejected"); setShowReject(false); load(); } catch (e) { apiErrorToast(e); } }}
              testId="legal-reject-modal"
            />
            <ReasonModal
              open={showApprove} onClose={() => setShowApprove(false)}
              title="Approve legal draft" desc="Approving marks the draft final and cascades journey tasks T5 + T6 to Completed."
              fieldLabel="Approval notes (optional)…"
              allowEmpty
              onSubmit={async (notes) => { try { await api.post(`/legal/${legal.id}/approve`, { notes: notes || null }); toast.success("Approved · T5+T6 cascade fired"); setShowApprove(false); load(); } catch (e) { apiErrorToast(e); } }}
              testId="legal-approve-modal"
            />
          </>
        )}
      </div>

      {legal && (
        <CollaborationPanel entityType="legal_record" entityId={legal.id} entityTitle="Legal record" />
      )}
    </div>
  );
}

function ReasonModal({ open, onClose, onSubmit, title, desc, fieldLabel = "Reason", testId, allowEmpty = false }) {
  const [text, setText] = useState("");
  useEffect(() => { if (open) setText(""); }, [open]);
  const disabled = allowEmpty ? false : !text.trim();
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose?.()}>
      <DialogContent data-testid={testId}>
        <DialogHeader><DialogTitle>{title}</DialogTitle>{desc && <DialogDescription>{desc}</DialogDescription>}</DialogHeader>
        <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={fieldLabel} className="min-h-[80px] text-sm" data-testid={`${testId}-input`} />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSubmit(text.trim())} disabled={disabled} data-testid={`${testId}-submit`}>Submit</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

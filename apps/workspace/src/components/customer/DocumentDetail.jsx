import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Upload, ShieldCheck, ShieldX, AlertTriangle, Download, X, Loader2 } from "lucide-react";

import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import { downloadAttachment } from "@/lib/downloadAttachment";
import { useAuth, isSuperAdmin } from "@/lib/auth";
import StatusPill from "@/components/StatusPill";
import CollaborationPanel from "@/components/CollaborationPanel";
import { formatDateTime, formatDate } from "@/lib/format";
import { DOC_STATUS_TONE, canManageDocuments, canVerifyDocument } from "@/lib/documents";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import MissingFileChip from "@/components/rbac/MissingFileChip";

export default function DocumentDetail({ docId, open, onClose, onChanged }) {
  const { user } = useAuth();
  const [doc, setDoc] = useState(null);
  const [versions, setVersions] = useState([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const [verifyMode, setVerifyMode] = useState(null); // 'Verified' | 'Rejected' | null
  const [notes, setNotes] = useState("");
  const [naOpen, setNaOpen] = useState(false);
  const [naReason, setNaReason] = useState("");

  const load = useCallback(async () => {
    if (!docId) return;
    try {
      const r = await api.get(`/documents/${docId}`);
      setDoc(r.data);
      const v = await api.get(`/documents/${docId}/versions`);
      setVersions(v.data || []);
    } catch (e) {
      apiErrorToast(e);
    }
  }, [docId]);

  useEffect(() => { if (open && docId) { load(); setVerifyMode(null); setNotes(""); } }, [open, docId, load]);

  if (!open || !doc) return open ? (
    <Sheet open={open} onOpenChange={(v) => !v && onClose?.()}>
      <SheetContent side="right" className="sm:max-w-lg" data-testid="document-detail-loading">
        <SheetHeader>
          <SheetTitle>Loading document…</SheetTitle>
          <SheetDescription>Please wait</SheetDescription>
        </SheetHeader>
        <div className="p-6"><Loader2 className="h-4 w-4 animate-spin" /></div>
      </SheetContent>
    </Sheet>
  ) : null;

  const canManage = canManageDocuments(user);
  const canVerify = canVerifyDocument(user, doc.category);

  const onUpload = () => fileRef.current?.click();

  const onFileChosen = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", f);
      await api.post(`/documents/${doc.id}/upload`, form, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("New version uploaded");
      await load();
      onChanged?.();
    } catch (err) {
      apiErrorToast(err);
    } finally {
      setUploading(false);
    }
  };

  const runVerify = async (decision) => {
    setBusy(true);
    try {
      await api.post(`/documents/${doc.id}/verify`, { decision, notes: notes.trim() || undefined });
      toast.success(`Marked ${decision}`);
      setVerifyMode(null);
      setNotes("");
      await load();
      onChanged?.();
    } catch (e) {
      apiErrorToast(e);
    } finally {
      setBusy(false);
    }
  };

  const markNa = async () => {
    if (!naReason.trim()) return;
    setBusy(true);
    try {
      await api.post(`/documents/${doc.id}/mark-na`, { reason: naReason.trim() });
      toast.success("Marked N/A");
      setNaOpen(false); setNaReason("");
      await load();
      onChanged?.();
    } catch (e) {
      apiErrorToast(e);
    } finally {
      setBusy(false);
    }
  };

  const markRequired = async () => {
    setBusy(true);
    try {
      await api.post(`/documents/${doc.id}/mark-required`);
      toast.success("Restored to Required");
      await load(); onChanged?.();
    } catch (e) { apiErrorToast(e); } finally { setBusy(false); }
  };

  const markExpired = async () => {
    setBusy(true);
    try {
      await api.post(`/documents/${doc.id}/mark-expired`);
      toast.success("Marked expired");
      await load(); onChanged?.();
    } catch (e) { apiErrorToast(e); } finally { setBusy(false); }
  };

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose?.()}>
      <SheetContent side="right" className="sm:max-w-2xl w-full p-0 overflow-y-auto" data-testid="document-detail">
        <SheetHeader className="px-5 py-3 border-b border-gray-200">
          <SheetTitle className="text-base font-heading font-semibold text-gray-900" data-testid="document-detail-title">{doc.title}</SheetTitle>
          <SheetDescription className="text-xs text-gray-500 flex items-center gap-2">
            <span>{doc.category}</span>
            {doc.required && <span className="text-red-600">· Required</span>}
            <span>·</span>
            <StatusPill status={doc.status} tone={DOC_STATUS_TONE[doc.status]} />
          </SheetDescription>
        </SheetHeader>

        <div className="p-5 space-y-4">
          {doc.na_reason && (
            <div className="rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-xs text-gray-700 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5" />
              <div><span className="font-semibold">Not applicable —</span> {doc.na_reason}</div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {canManage && (
              <>
                <Button size="sm" variant="outline" onClick={onUpload} disabled={uploading || doc.applicable === false} data-testid="doc-upload-btn">
                  <Upload className="h-3.5 w-3.5" /> {uploading ? "Uploading…" : (doc.latest_version > 0 ? "Upload new version" : "Upload")}
                </Button>
                <input type="file" ref={fileRef} className="hidden" onChange={onFileChosen} accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx,.csv" />
                {doc.applicable === false ? (
                  <Button size="sm" variant="outline" onClick={markRequired} disabled={busy} data-testid="doc-mark-required">Restore to Required</Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setNaOpen(true)} data-testid="doc-mark-na">Mark N/A</Button>
                )}
                <Button size="sm" variant="ghost" onClick={markExpired} disabled={busy} data-testid="doc-mark-expired">Mark expired</Button>
              </>
            )}
            {canVerify && doc.latest_attachment_id && doc.status !== "Verified" && doc.status !== "Rejected" && (
              <>
                <Button size="sm" onClick={() => setVerifyMode("Verified")} disabled={busy} data-testid="doc-verify">
                  <ShieldCheck className="h-3.5 w-3.5" /> Verify
                </Button>
                <Button size="sm" variant="outline" onClick={() => setVerifyMode("Rejected")} disabled={busy} data-testid="doc-reject">
                  <ShieldX className="h-3.5 w-3.5" /> Reject
                </Button>
              </>
            )}
          </div>

          {verifyMode && (
            <div className="rounded-md border border-gray-200 bg-gray-50 p-3 space-y-2" data-testid="doc-verify-panel">
              <div className="text-xs font-medium">Provide {verifyMode === "Verified" ? "verification" : "rejection"} notes (optional)</div>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="text-xs min-h-[60px]" data-testid="doc-verify-notes" />
              <div className="flex gap-2 justify-end">
                <Button size="sm" variant="ghost" onClick={() => { setVerifyMode(null); setNotes(""); }}>Cancel</Button>
                <Button size="sm" onClick={() => runVerify(verifyMode)} disabled={busy} data-testid="doc-verify-confirm">{verifyMode}</Button>
              </div>
            </div>
          )}

          <div className="rounded-md border border-gray-200 bg-white overflow-hidden" data-testid="doc-versions">
            <div className="px-3 py-2 border-b border-gray-100 text-xs font-medium text-gray-900">Version history</div>
            {versions.length === 0 ? (
              <div className="p-3 text-xs text-gray-500">No uploads yet.</div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {versions.map((v) => (
                  <li key={v.id} className="flex items-center justify-between px-3 py-2 gap-3">
                    <div className="min-w-0">
                      <div className="text-sm text-gray-900">v{v.version}
                        <span className="text-[11px] text-gray-500 ml-2">Uploaded by {v._uploaded_by_name || "—"} on {formatDateTime(v.uploaded_at)}</span>
                      </div>
                      {v.verified_at && (
                        <div className="text-[11px] text-gray-500">Verified by {v._verified_by_name || "—"} on {formatDateTime(v.verified_at)}</div>
                      )}
                      {v.comments && <div className="text-[11px] text-gray-600 italic">"{v.comments}"</div>}
                    </div>
                    <StatusPill status={v.verification_status} />
                    <button
                      type="button"
                      onClick={() => downloadAttachment({ id: v.attachment_id, filename: v._attachment_filename, file_missing: v._file_missing })}
                      disabled={v._file_missing}
                      className={
                        "text-xs inline-flex items-center gap-1 " +
                        (v._file_missing
                          ? "text-gray-400 cursor-not-allowed"
                          : "text-navy-900 hover:underline")
                      }
                      data-testid={`doc-version-download-${v.version}`}
                    >
                      <Download className="h-3 w-3" /> Download
                      {v._file_missing && <MissingFileChip className="ml-1" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border border-gray-200 rounded-md p-3">
            <div className="text-xs font-medium text-gray-900 mb-2">Collaboration</div>
            <CollaborationPanel entityType="document" entityId={doc.id} entityTitle={doc.title} inline />
          </div>
        </div>

        {/* Mark N/A dialog */}
        <Dialog open={naOpen} onOpenChange={setNaOpen}>
          <DialogContent data-testid="doc-na-dialog">
            <DialogHeader>
              <DialogTitle>Mark as Not Applicable</DialogTitle>
              <DialogDescription>Reason will be recorded on the checklist.</DialogDescription>
            </DialogHeader>
            <Textarea value={naReason} onChange={(e) => setNaReason(e.target.value)} className="text-sm min-h-[80px]" data-testid="doc-na-reason" />
            <DialogFooter>
              <Button variant="ghost" onClick={() => setNaOpen(false)}>Cancel</Button>
              <Button onClick={markNa} disabled={!naReason.trim() || busy} data-testid="doc-na-confirm">Mark N/A</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SheetContent>
    </Sheet>
  );
}

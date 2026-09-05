import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Upload, Download, ShieldCheck, Trash2, LayoutGrid, List } from "lucide-react";

import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import { downloadAttachment } from "@/lib/downloadAttachment";
import { useAuth } from "@/lib/auth";
import {
  CATEGORY_OPTIONS,
  VISIBILITY_OPTIONS,
  VERIFICATION_STATUS_OPTIONS,
  VERIFICATION_TONE,
  canPostCustomerVisible,
  canVerify,
  formatBytes,
  ALLOWED_UPLOAD_EXTENSIONS,
  MAX_UPLOAD_BYTES,
} from "@/lib/collab";
import StatusPill from "@/components/StatusPill";
import { relTime } from "@/lib/relativeTime";
import CanAccess from "@/components/rbac/CanAccess";
import MissingFileChip from "@/components/rbac/MissingFileChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const downloadAtt = (att) => downloadAttachment(att);

export default function FilesTab({ entityType, entityId }) {
  const { user } = useAuth();
  const [files, setFiles] = useState([]);
  const [users, setUsers] = useState({});
  const [loading, setLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [verify, setVerify] = useState(null); // attachment being verified
  const [view, setView] = useState("list");

  const refresh = async () => {
    setLoading(true);
    try {
      const [a, u] = await Promise.all([
        api.get("/attachments", { params: { entity_type: entityType, entity_id: entityId } }),
        api.get("/users/assignable"),
      ]);
      setFiles(a.data || []);
      setUsers(Object.fromEntries((u.data || []).map((x) => [x.id, x])));
    } catch (e) {
      apiErrorToast(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, entityId]);

  // Group by filename to indicate version history
  const grouped = useMemo(() => {
    const map = new Map();
    for (const f of files) {
      if (!map.has(f.filename)) map.set(f.filename, []);
      map.get(f.filename).push(f);
    }
    for (const arr of map.values()) arr.sort((a, b) => b.version - a.version);
    return Array.from(map.values()); // [ [latest, older...], ... ]
  }, [files]);

  const del = async (f) => {
    if (!window.confirm(`Delete ${f.filename}?`)) return;
    try {
      await api.delete(`/attachments/${f.id}`);
      toast.success("Deleted");
      refresh();
    } catch (e) {
      apiErrorToast(e);
    }
  };

  return (
    <div className="space-y-3" data-testid="files-tab">
      <div className="flex items-center justify-between">
        <div className="text-xs text-gray-500">{files.length} file{files.length === 1 ? "" : "s"}</div>
        <div className="flex items-center gap-1.5">
          <div className="inline-flex rounded-md border border-gray-200 overflow-hidden">
            <button type="button" onClick={() => setView("list")} className={["px-2 py-1", view === "list" ? "bg-gray-900 text-white" : "text-gray-600"].join(" ")} data-testid="files-view-list">
              <List className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={() => setView("grid")} className={["px-2 py-1", view === "grid" ? "bg-gray-900 text-white" : "text-gray-600"].join(" ")} data-testid="files-view-grid">
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
          </div>
          <CanAccess module={entityType === "customer" ? "customer_documents" : "documents"} action="write">
            <Button size="sm" onClick={() => setUploadOpen(true)} className="h-8 bg-brand-500 hover:bg-brand-600 text-white" data-testid="files-upload-button">
              <Upload className="h-3.5 w-3.5" /> Upload
            </Button>
          </CanAccess>
        </div>
      </div>

      {loading ? (
        <div className="py-6 text-center text-xs text-gray-500">Loading files…</div>
      ) : files.length === 0 ? (
        <div className="py-8 text-center text-xs text-gray-500 border border-dashed border-gray-200 rounded-md">
          No files yet. Upload one above.
        </div>
      ) : view === "list" ? (
        <div className="rounded-md border border-gray-200 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <Th>Filename</Th>
                <Th>Category</Th>
                <Th className="text-right">Size</Th>
                <Th>Uploaded</Th>
                <Th>Version</Th>
                <Th>Verification</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {grouped.map((versions) => {
                const latest = versions[0];
                return (
                  <FileRow
                    key={latest.filename}
                    latest={latest}
                    older={versions.slice(1)}
                    users={users}
                    onVerify={() => setVerify(latest)}
                    onDelete={() => del(latest)}
                    onRefresh={refresh}
                    currentUser={user}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {grouped.map((versions) => {
            const latest = versions[0];
            const uploader = users[latest.uploaded_by];
            return (
              <div key={latest.filename} className="rounded-md border border-gray-200 bg-white p-3" data-testid={`file-card-${latest.filename}`}>
                <div className="text-xs font-medium text-gray-900 truncate">{latest.filename}</div>
                <div className="text-[11px] text-gray-500 mt-0.5">v{latest.version} · {formatBytes(latest.size_bytes)}</div>
                <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                  <StatusPill status={latest.category} tone="grey" />
                  <StatusPill status={latest.verification_status} tone={VERIFICATION_TONE[latest.verification_status]} />
                  {latest.file_missing && <MissingFileChip />}
                </div>
                <div className="mt-2 text-[10px] text-gray-500">{uploader?.name || "?"} · {relTime(latest.uploaded_at)}</div>
                <div className="mt-2 flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => downloadAtt(latest)}
                    disabled={latest.file_missing}
                    className={
                      "text-[11px] " +
                      (latest.file_missing
                        ? "text-gray-400 cursor-not-allowed"
                        : "text-navy-900 hover:underline")
                    }
                    data-testid={`file-download-${latest.filename}`}
                  >
                    <Download className="h-3 w-3 inline" /> Download
                  </button>
                  {canVerify(user) && (
                    <button type="button" onClick={() => setVerify(latest)} className="text-[11px] text-gray-700 hover:underline" data-testid={`file-verify-${latest.filename}`}>
                      <ShieldCheck className="h-3 w-3 inline" /> Verify
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        entityType={entityType}
        entityId={entityId}
        user={user}
        onUploaded={refresh}
      />

      <VerifyDialog attachment={verify} onOpenChange={() => setVerify(null)} onDone={refresh} user={user} />
    </div>
  );
}

function Th({ children, className = "" }) {
  return <th className={["h-9 px-3 text-left text-xs uppercase tracking-wide text-slate-600 font-semibold", className].join(" ")}>{children}</th>;
}

function FileRow({ latest, older, users, onVerify, onDelete, onRefresh, currentUser }) {
  const [showOlder, setShowOlder] = useState(false);
  const uploader = users[latest.uploaded_by];

  return (
    <>
      <tr className="h-10 border-t border-gray-100" data-testid={`file-row-${latest.filename}`}>
        <td className="px-3">
          <div className="text-sm text-gray-900 font-medium truncate max-w-[220px]" title={latest.filename}>
            {latest.filename}
          </div>
          {latest.description && <div className="text-[10px] text-gray-500 truncate max-w-[220px]">{latest.description}</div>}
          {latest.file_missing && <div className="mt-0.5"><MissingFileChip /></div>}
        </td>
        <td className="px-3"><StatusPill status={latest.category} tone="grey" /></td>
        <td className="px-3 text-right text-xs text-gray-700 tabular-nums">{formatBytes(latest.size_bytes)}</td>
        <td className="px-3 text-[11px] text-gray-600">
          <div>{uploader?.name || "Unknown"}</div>
          <div className="text-[10px] text-gray-400">{relTime(latest.uploaded_at)}</div>
        </td>
        <td className="px-3 text-sm">
          v{latest.version}
          {older.length > 0 && (
            <button type="button" onClick={() => setShowOlder((s) => !s)} className="ml-1 text-[10px] text-navy-900 hover:underline" data-testid={`file-history-${latest.filename}`}>
              ({showOlder ? "hide" : `v1–v${older[0].version} available`})
            </button>
          )}
        </td>
        <td className="px-3">
          <StatusPill status={latest.verification_status} tone={VERIFICATION_TONE[latest.verification_status]} />
        </td>
        <td className="px-3 text-right">
          <button
            type="button"
            onClick={() => downloadAtt(latest)}
            disabled={latest.file_missing}
            className={
              "text-[11px] mr-2 " +
              (latest.file_missing
                ? "text-gray-400 cursor-not-allowed"
                : "text-navy-900 hover:underline")
            }
            data-testid={`file-download-${latest.filename}`}
          >
            <Download className="h-3 w-3 inline" /> Download
          </button>
          {canVerify(currentUser) && (
            <button type="button" onClick={onVerify} className="text-[11px] text-gray-700 hover:underline mr-2" data-testid={`file-verify-${latest.filename}`}>
              <ShieldCheck className="h-3 w-3 inline" /> Verify
            </button>
          )}
          {(latest.uploaded_by === currentUser?.id || currentUser?.role?.is_super_admin) && (
            <button type="button" onClick={onDelete} className="text-[11px] text-red-700 hover:underline" data-testid={`file-delete-${latest.filename}`}>
              <Trash2 className="h-3 w-3 inline" /> Delete
            </button>
          )}
        </td>
      </tr>
      {showOlder && older.map((o) => (
        <tr key={o.id} className="h-9 border-t border-gray-100 bg-gray-50/60" data-testid={`file-older-${o.filename}-v${o.version}`}>
          <td className="px-3 text-sm text-gray-600 pl-8">↳ v{o.version}</td>
          <td className="px-3"><StatusPill status={o.category} tone="grey" /></td>
          <td className="px-3 text-right text-[11px] text-gray-500 tabular-nums">{formatBytes(o.size_bytes)}</td>
          <td className="px-3 text-[10px] text-gray-500">{users[o.uploaded_by]?.name} · {relTime(o.uploaded_at)}</td>
          <td className="px-3 text-sm text-gray-600">v{o.version}</td>
          <td className="px-3"><StatusPill status={o.verification_status} tone={VERIFICATION_TONE[o.verification_status]} /></td>
          <td className="px-3 text-right">
            <button type="button" onClick={() => downloadAtt(o)} className="text-[11px] text-navy-900 hover:underline">
              <Download className="h-3 w-3 inline" /> Download
            </button>
          </td>
        </tr>
      ))}
    </>
  );
}

function UploadDialog({ open, onOpenChange, entityType, entityId, user, onUploaded }) {
  const [file, setFile] = useState(null);
  const [category, setCategory] = useState("Other");
  const [visibility, setVisibility] = useState("Internal");
  const [description, setDescription] = useState("");
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);

  const reset = () => {
    setFile(null);
    setCategory("Other");
    setVisibility("Internal");
    setDescription("");
    setProgress(0);
    setUploading(false);
  };

  const submit = async () => {
    if (!file) return;
    const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (!ALLOWED_UPLOAD_EXTENSIONS.includes(ext)) {
      toast.error("Extension not allowed");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error("File exceeds 25 MB");
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("entity_type", entityType);
      form.append("entity_id", entityId);
      form.append("category", category);
      form.append("visibility", visibility);
      if (description.trim()) form.append("description", description.trim());
      await api.post("/attachments", form, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (evt) => {
          if (evt.total) setProgress(Math.round((evt.loaded / evt.total) * 100));
        },
      });
      toast.success("Uploaded");
      reset();
      onOpenChange(false);
      onUploaded?.();
    } catch (e) {
      apiErrorToast(e);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-md" data-testid="file-upload-dialog">
        <DialogHeader>
          <DialogTitle>Upload file</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">File</Label>
            <Input
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              accept={ALLOWED_UPLOAD_EXTENSIONS.join(",")}
              data-testid="file-upload-input"
            />
            <div className="text-[10px] text-gray-500">Allowed: {ALLOWED_UPLOAD_EXTENSIONS.join(", ")} · Max 25 MB.</div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger data-testid="file-upload-category"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Visibility</Label>
              <Select value={visibility} onValueChange={setVisibility}>
                <SelectTrigger data-testid="file-upload-visibility"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {VISIBILITY_OPTIONS.map((v) => (
                    <SelectItem key={v} value={v} disabled={v === "Customer Visible" && !canPostCustomerVisible(user)}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Description</Label>
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} data-testid="file-upload-description" />
          </div>
          {uploading && (
            <div className="h-1 rounded bg-gray-200 overflow-hidden">
              <div className="h-full bg-navy-900 transition-all" style={{ width: `${progress}%` }} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" onClick={submit} disabled={!file || uploading} className="bg-brand-500 hover:bg-brand-600 text-white" data-testid="file-upload-submit">
            {uploading ? "Uploading…" : "Upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VerifyDialog({ attachment, onOpenChange, onDone, user }) {
  const [status, setStatus] = useState("Verified");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (attachment) {
      setStatus(attachment.verification_status === "Verified" ? "Verified" : "Verified");
      setNotes(attachment.verification_notes || "");
    }
  }, [attachment]);

  if (!attachment) return null;
  const allowed = canVerify(user);

  const submit = async () => {
    if (!allowed) return;
    setSaving(true);
    try {
      await api.patch(`/attachments/${attachment.id}/verify`, { verification_status: status, verification_notes: notes || null });
      toast.success(`Marked ${status}`);
      onDone?.();
      onOpenChange(false);
    } catch (e) {
      apiErrorToast(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={Boolean(attachment)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="file-verify-dialog">
        <DialogHeader>
          <DialogTitle>Verify {attachment.filename}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger data-testid="file-verify-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                {VERIFICATION_STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Notes</Label>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="file-verify-notes" />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" onClick={submit} disabled={!allowed || saving} className="bg-brand-500 hover:bg-brand-600 text-white" data-testid="file-verify-submit">
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

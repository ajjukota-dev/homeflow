import { useEffect, useMemo, useState, useRef } from "react";
import { toast } from "sonner";
import { ClipboardCheck, Plus, Upload, CheckCircle2, Ban, RotateCcw, ShieldCheck } from "lucide-react";

import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { canManageSnag, canVerifySnag, SNAG_ROOMS, SNAG_CATEGORIES, SNAG_SEVERITIES, SNAG_SEVERITY_TONE, SNAG_STATUS_TONE } from "@/lib/phase7";
import { formatDate } from "@/lib/format";
import StatusPill from "@/components/StatusPill";
import CollaborationPanel from "@/components/CollaborationPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

export default function SnagsTab({ customerId, bookings }) {
  const { user } = useAuth();
  const confirmed = useMemo(() => (bookings || []).filter((b) => b.status === "Confirmed"), [bookings]);
  const [bookingId, setBookingId] = useState(confirmed[0]?.id || null);
  const [snags, setSnags] = useState([]);
  const [selected, setSelected] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [severityFilter, setSeverityFilter] = useState("__all__");
  const [statusFilter, setStatusFilter] = useState("__all__");

  useEffect(() => { if (!bookingId && confirmed[0]) setBookingId(confirmed[0].id); }, [confirmed, bookingId]);

  const load = async () => {
    if (!bookingId) return;
    try {
      const r = await api.get("/snags", { params: { booking_id: bookingId } });
      setSnags(r.data || []);
    } catch (e) { apiErrorToast(e); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [bookingId]);

  const filtered = snags.filter((s) => (severityFilter === "__all__" || s.severity === severityFilter) && (statusFilter === "__all__" || s.status === statusFilter));

  const counts = {
    total: snags.length,
    critical: snags.filter((s) => s.severity === "Critical" && s.status !== "Closed").length,
    major: snags.filter((s) => s.severity === "Major" && s.status !== "Closed").length,
    minor: snags.filter((s) => s.severity === "Minor" && s.status !== "Closed").length,
  };

  if (confirmed.length === 0) {
    return <div className="rounded-md border border-gray-200 bg-white p-6 text-center" data-testid="snag-empty"><ClipboardCheck className="h-6 w-6 text-gray-300 mx-auto" /><div className="mt-2 text-sm text-gray-700">No Confirmed bookings yet.</div></div>;
  }

  return (
    <div className="grid xl:grid-cols-[minmax(0,1fr)_360px] gap-6" data-testid="snags-tab">
      <div className="space-y-4 min-w-0">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          {confirmed.length > 1 && (
            <Select value={bookingId || ""} onValueChange={setBookingId}>
              <SelectTrigger className="h-8 w-56 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>{confirmed.map((b) => <SelectItem key={b.id} value={b.id}><span className="font-mono text-xs">{b.code}</span></SelectItem>)}</SelectContent>
            </Select>
          )}
          {canManageSnag(user) && (
            <Button size="sm" onClick={() => setShowCreate(true)} data-testid="snag-add-btn"><Plus className="h-3.5 w-3.5" /> Add snag</Button>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <StatBox label="Total" value={counts.total} tone="grey" />
          <StatBox label="Critical Open" value={counts.critical} tone={counts.critical > 0 ? "darkred" : "grey"} testId="snag-count-critical" />
          <StatBox label="Major Open" value={counts.major} tone={counts.major > 0 ? "red" : "grey"} />
          <StatBox label="Minor Open" value={counts.minor} tone={counts.minor > 0 ? "amber" : "grey"} />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Select value={severityFilter} onValueChange={setSeverityFilter}>
            <SelectTrigger className="h-7 w-36 text-xs"><SelectValue placeholder="Severity" /></SelectTrigger>
            <SelectContent><SelectItem value="__all__">All severities</SelectItem>{SNAG_SEVERITIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-7 w-48 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent><SelectItem value="__all__">All statuses</SelectItem>{["Open", "Assigned", "In Progress", "Ready for Verification", "Closed", "Reopened"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </div>

        <div className="rounded-md border border-gray-200 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr className="text-xs uppercase tracking-wide text-slate-600 font-semibold">
                <th className="h-8 px-3 text-left font-normal">Code</th>
                <th className="h-8 px-3 text-left font-normal">Room</th>
                <th className="h-8 px-3 text-left font-normal">Category</th>
                <th className="h-8 px-3 text-left font-normal">Description</th>
                <th className="h-8 px-3 text-left font-normal">Severity</th>
                <th className="h-8 px-3 text-left font-normal">Status</th>
                <th className="h-8 px-3 text-left font-normal">Due</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 ? <tr><td colSpan={7} className="p-4 text-xs text-gray-500">No snags match this filter.</td></tr>
              : filtered.map((s) => (
                <tr key={s.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setSelected(s)} data-testid={`snag-row-${s.code}`}>
                  <td className="px-3 py-2 font-mono text-[11px] text-gray-700">{s.code}</td>
                  <td className="px-3 py-2 text-xs text-gray-800">{s.room}</td>
                  <td className="px-3 py-2 text-xs text-gray-700">{s.category}</td>
                  <td className="px-3 py-2 text-xs text-gray-700 truncate max-w-[280px]">{s.description}</td>
                  <td className="px-3 py-2"><StatusPill status={s.severity} tone={SNAG_SEVERITY_TONE[s.severity] || "grey"} /></td>
                  <td className="px-3 py-2"><StatusPill status={s.status} tone={SNAG_STATUS_TONE[s.status] || "grey"} /></td>
                  <td className="px-3 py-2 text-xs text-gray-600 tabular-nums">{s.due_date ? formatDate(s.due_date) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <CreateSnagModal open={showCreate} onClose={() => setShowCreate(false)} bookingId={bookingId} onCreated={load} />
        <SnagDetailModal open={!!selected} onClose={() => setSelected(null)} snag={selected} onChanged={load} />
      </div>
      <CollaborationPanel entityType="snag" entityId={selected?.id} entityTitle={selected ? `Snag ${selected.code}` : "Snag"} />
    </div>
  );
}

function StatBox({ label, value, tone, testId }) {
  const cls = tone === "darkred" ? "border-rose-300 bg-rose-50 text-rose-800"
    : tone === "red" ? "border-red-200 bg-red-50 text-red-700"
    : tone === "amber" ? "border-amber-200 bg-amber-50 text-amber-800"
    : "border-gray-200 bg-white text-gray-700";
  return <div className={`rounded-md border p-2.5 ${cls}`} data-testid={testId}>
    <div className="text-[10px] uppercase tracking-wide">{label}</div>
    <div className="text-lg font-semibold tabular-nums">{value}</div>
  </div>;
}

function CreateSnagModal({ open, onClose, bookingId, onCreated }) {
  const [f, setF] = useState({ room: "Living", category: "Civil", severity: "Minor", description: "", contractor_name: "", due_date: "" });
  const [file, setFile] = useState(null);
  useEffect(() => { if (open) { setF({ room: "Living", category: "Civil", severity: "Minor", description: "", contractor_name: "", due_date: "" }); setFile(null); } }, [open]);
  const submit = async () => {
    if (!f.description.trim() || !bookingId) return;
    const fd = new FormData();
    fd.append("booking_id", bookingId);
    fd.append("room", f.room); fd.append("category", f.category); fd.append("severity", f.severity);
    fd.append("description", f.description.trim());
    if (f.contractor_name) fd.append("contractor_name", f.contractor_name);
    if (f.due_date) fd.append("due_date", new Date(f.due_date).toISOString());
    if (file) fd.append("before_photo", file);
    try {
      await api.post("/snags", fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("Snag created");
      onClose(); onCreated?.();
    } catch (e) { apiErrorToast(e); }
  };
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose?.()}>
      <DialogContent data-testid="snag-create-modal">
        <DialogHeader><DialogTitle>Add snag</DialogTitle><DialogDescription>Critical snags will block Handover until closed.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div><label className="text-[11px] text-gray-600">Room</label><Select value={f.room} onValueChange={(v) => setF((s) => ({ ...s, room: v }))}><SelectTrigger className="h-8 text-xs" data-testid="snag-create-room"><SelectValue /></SelectTrigger><SelectContent>{SNAG_ROOMS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent></Select></div>
            <div><label className="text-[11px] text-gray-600">Category</label><Select value={f.category} onValueChange={(v) => setF((s) => ({ ...s, category: v }))}><SelectTrigger className="h-8 text-xs" data-testid="snag-create-category"><SelectValue /></SelectTrigger><SelectContent>{SNAG_CATEGORIES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent></Select></div>
            <div><label className="text-[11px] text-gray-600">Severity</label><Select value={f.severity} onValueChange={(v) => setF((s) => ({ ...s, severity: v }))}><SelectTrigger className="h-8 text-xs" data-testid="snag-create-severity"><SelectValue /></SelectTrigger><SelectContent>{SNAG_SEVERITIES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent></Select></div>
          </div>
          <div><label className="text-[11px] text-gray-600">Description *</label><Textarea value={f.description} onChange={(e) => setF((s) => ({ ...s, description: e.target.value }))} className="min-h-[60px] text-sm" data-testid="snag-create-desc" /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="text-[11px] text-gray-600">Contractor (optional)</label><Input value={f.contractor_name} onChange={(e) => setF((s) => ({ ...s, contractor_name: e.target.value }))} className="h-8 text-sm" /></div>
            <div><label className="text-[11px] text-gray-600">Due date</label><Input type="date" value={f.due_date} onChange={(e) => setF((s) => ({ ...s, due_date: e.target.value }))} className="h-8 text-sm" /></div>
          </div>
          <div><label className="text-[11px] text-gray-600">Before-photo (optional)</label><Input type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} className="h-8 text-xs" /></div>
        </div>
        <DialogFooter><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={!f.description.trim()} data-testid="snag-create-submit">Create</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SnagDetailModal({ open, onClose, snag, onChanged }) {
  const { user } = useAuth();
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [detail, setDetail] = useState(null);
  const [showVerify, setShowVerify] = useState(false);
  const [showReopen, setShowReopen] = useState(false);

  useEffect(() => {
    if (!snag) return;
    api.get(`/snags/${snag.id}`).then((r) => setDetail(r.data)).catch((e) => apiErrorToast(e));
  }, [snag]);

  if (!open || !snag) return null;
  const d = detail || snag;

  const act = async (path, body) => {
    try {
      await api.post(`/snags/${d.id}/${path}`, body);
      toast.success("Updated");
      const r = await api.get(`/snags/${d.id}`); setDetail(r.data);
      onChanged?.();
    } catch (e) { apiErrorToast(e); }
  };

  const uploadAfter = async (e) => {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f) return;
    setUploading(true);
    try {
      const fd = new FormData(); fd.append("file", f);
      await api.post(`/snags/${d.id}/upload-after-photo`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("After-photo uploaded");
      const r = await api.get(`/snags/${d.id}`); setDetail(r.data);
      onChanged?.();
    } catch (err) { apiErrorToast(err); }
    finally { setUploading(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose?.()}>
      <DialogContent className="max-w-2xl" data-testid="snag-detail-modal">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><span className="font-mono text-sm">{d.code}</span><StatusPill status={d.severity} tone={SNAG_SEVERITY_TONE[d.severity] || "grey"} /><StatusPill status={d.status} tone={SNAG_STATUS_TONE[d.status] || "grey"} /></DialogTitle>
          <DialogDescription>{d.room} · {d.category}{d._owner ? ` · Owner: ${d._owner.name}` : ""}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="text-sm text-gray-800">{d.description}</div>
          {d.reopen_reason && <div className="rounded-md border border-orange-200 bg-orange-50 text-orange-900 p-2 text-xs">Reopened: {d.reopen_reason}</div>}
          <div className="text-[11px] text-gray-500">Contractor: {d.contractor_name || "—"} · Due: {d.due_date ? formatDate(d.due_date) : "—"}{d.closed_date ? ` · Closed: ${formatDate(d.closed_date)}` : ""}</div>
          <div className="flex flex-wrap gap-2">
            {canManageSnag(user) && d.status === "Open" && <Button size="sm" onClick={() => act("assign", { owner_user_id: user.id })} data-testid="snag-assign-me-btn">Assign to me</Button>}
            {canManageSnag(user) && (d.status === "Assigned" || d.status === "Reopened") && <Button size="sm" onClick={() => act("start")} data-testid="snag-start-btn">Start</Button>}
            {canManageSnag(user) && d.status === "In Progress" && (
              <>
                <input type="file" ref={fileRef} onChange={uploadAfter} accept=".jpg,.jpeg,.png,.pdf" className="hidden" />
                <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading} data-testid="snag-upload-after-btn"><Upload className="h-3.5 w-3.5" /> {uploading ? "Uploading…" : "Upload after-photo"}</Button>
                <Button size="sm" onClick={() => act("submit-for-verification")} disabled={!d.after_photo_attachment_id} data-testid="snag-submit-verify-btn"><CheckCircle2 className="h-3.5 w-3.5" /> Submit for verification</Button>
              </>
            )}
            {canVerifySnag(user) && d.status === "Ready for Verification" && (
              <>
                <Button size="sm" onClick={() => act("verify", { decision: "Verified" })} data-testid="snag-verify-approve-btn"><ShieldCheck className="h-3.5 w-3.5" /> Verify & Close</Button>
                <Button size="sm" variant="outline" onClick={() => act("verify", { decision: "Rejected" })} className="text-red-700" data-testid="snag-verify-reject-btn"><Ban className="h-3.5 w-3.5" /> Reject</Button>
              </>
            )}
            {(d.status === "Verified" || d.status === "Closed") && <Button size="sm" variant="ghost" onClick={() => setShowReopen(true)} data-testid="snag-reopen-btn"><RotateCcw className="h-3.5 w-3.5" /> Reopen</Button>}
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded border border-gray-200 p-2"><div className="uppercase text-gray-500 mb-1">Before</div>{d.before_photo_attachment_id ? <div className="text-gray-700">{d._before_photo?.filename || d.before_photo_attachment_id.slice(0, 8)}</div> : <div className="text-gray-400">—</div>}</div>
            <div className="rounded border border-gray-200 p-2"><div className="uppercase text-gray-500 mb-1">After</div>{d.after_photo_attachment_id ? <div className="text-gray-700">{d._after_photo?.filename || d.after_photo_attachment_id.slice(0, 8)}</div> : <div className="text-gray-400">—</div>}</div>
          </div>
        </div>
        <ReasonModal open={showReopen} onClose={() => setShowReopen(false)} title="Reopen snag" onSubmit={async (r) => { await act("reopen", { reason: r }); setShowReopen(false); }} />
      </DialogContent>
    </Dialog>
  );
}

function ReasonModal({ open, onClose, title, onSubmit }) {
  const [t, setT] = useState("");
  useEffect(() => { if (open) setT(""); }, [open]);
  return <Dialog open={open} onOpenChange={(v) => !v && onClose?.()}>
    <DialogContent><DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
      <Textarea value={t} onChange={(e) => setT(e.target.value)} placeholder="Reason…" className="min-h-[60px] text-sm" data-testid="snag-reopen-reason" />
      <DialogFooter><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => onSubmit(t.trim())} disabled={!t.trim()} data-testid="snag-reopen-submit">Submit</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Building2, Upload, CheckCircle2, ImageIcon, RotateCcw } from "lucide-react";

import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import { useAuth, isSuperAdmin } from "@/lib/auth";
import { canManageReadiness } from "@/lib/phase7";
import { formatDate } from "@/lib/format";
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

export default function UnitReadinessTab({ customerId, bookings }) {
  const { user } = useAuth();
  const confirmed = useMemo(() => (bookings || []).filter((b) => b.status === "Confirmed"), [bookings]);
  const [bookingId, setBookingId] = useState(confirmed[0]?.id || null);
  const [ur, setUr] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showDeclare, setShowDeclare] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => { if (!bookingId && confirmed[0]) setBookingId(confirmed[0].id); }, [confirmed, bookingId]);

  const load = async () => {
    if (!bookingId) return;
    setLoading(true);
    try {
      const r = await api.get(`/unit-readiness/booking/${bookingId}`);
      setUr(r.data);
    } catch (e) { apiErrorToast(e); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [bookingId]);

  if (confirmed.length === 0) {
    return <div className="rounded-md border border-gray-200 bg-white p-6 text-center" data-testid="ur-empty">
      <Building2 className="h-6 w-6 text-gray-300 mx-auto" /><div className="mt-2 text-sm text-gray-700">No Confirmed bookings yet.</div>
    </div>;
  }

  const canManage = canManageReadiness(user);
  const photosCount = ur?.photo_attachment_ids?.length || 0;
  const canDeclare = canManage && ur && !ur.ready_for_qa && ur.overall_score >= 85 && photosCount >= 2;

  const patchComponent = async (name, percent, notes) => {
    try {
      await api.patch(`/unit-readiness/${ur.id}/component`, { component_name: name, percent, notes });
      load();
    } catch (e) { apiErrorToast(e); }
  };

  const onUploadPhoto = async (e) => {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f || !ur) return;
    setUploading(true);
    try {
      const fd = new FormData(); fd.append("file", f);
      await api.post(`/unit-readiness/${ur.id}/upload-photo`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("Photo uploaded");
      load();
    } catch (err) { apiErrorToast(err); }
    finally { setUploading(false); }
  };

  const resetReady = async () => {
    if (!ur || !isSuperAdmin(user)) return;
    try {
      await api.post(`/unit-readiness/${ur.id}/reset-ready`);
      toast.success("Reset — T11 reversed");
      load();
    } catch (e) { apiErrorToast(e); }
  };

  return (
    <div className="grid xl:grid-cols-[minmax(0,1fr)_360px] gap-6" data-testid="unit-readiness-tab">
      <div className="space-y-4 min-w-0">
        {confirmed.length > 1 && (
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500 uppercase tracking-wide">Booking</span>
            <Select value={bookingId || ""} onValueChange={setBookingId}>
              <SelectTrigger className="h-8 w-72 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>{confirmed.map((b) => <SelectItem key={b.id} value={b.id}><span className="font-mono text-xs">{b.code}</span></SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}

        {loading ? <div className="text-xs text-gray-500 p-6">Loading…</div>
        : ur && (
          <>
            <div className="rounded-md border border-gray-200 bg-white p-4" data-testid="ur-header">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs uppercase text-gray-500 tracking-wide">Overall Score</div>
                  <div className="font-heading text-4xl font-semibold text-gray-900 tabular-nums mt-1" data-testid="ur-overall-score">{ur.overall_score?.toFixed(1) || "0.0"}<span className="text-lg text-gray-500">%</span></div>
                </div>
                <div className="flex items-center gap-2">
                  {ur.ready_for_qa && (
                    <span className="inline-flex items-center gap-1 text-emerald-700 text-sm font-medium" data-testid="ur-ready-badge">
                      <CheckCircle2 className="h-4 w-4" /> Ready for QA {ur.ready_declared_at ? `— ${formatDate(ur.ready_declared_at)}` : ""}
                    </span>
                  )}
                  {ur.ready_for_qa && isSuperAdmin(user) && (
                    <Button size="sm" variant="ghost" onClick={resetReady} data-testid="ur-reset-ready">
                      <RotateCcw className="h-3.5 w-3.5" /> Reset
                    </Button>
                  )}
                  {!ur.ready_for_qa && (
                    <Button size="sm" onClick={() => setShowDeclare(true)} disabled={!canDeclare}
                      title={canDeclare ? "" : `Requires score ≥ 85 and ≥ 2 photos (${ur.overall_score?.toFixed(1)}%, ${photosCount} photo${photosCount === 1 ? "" : "s"})`}
                      data-testid="ur-declare-btn">
                      Declare Ready-for-QA
                    </Button>
                  )}
                </div>
              </div>
              <div className="mt-3 h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className={"h-full " + (ur.overall_score >= 85 ? "bg-emerald-500" : ur.overall_score >= 50 ? "bg-amber-500" : "bg-gray-400")} style={{ width: `${Math.min(100, ur.overall_score || 0)}%` }} />
              </div>
              <div className="mt-2 text-[11px] text-gray-500">{ur.ready_notes || "Track construction progress by component. Score ≥ 85 + ≥ 2 photos unlocks Ready-for-QA."}</div>
            </div>

            <div className="rounded-md border border-gray-200 bg-white overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 text-sm font-medium text-gray-900">Components</div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr className="text-xs uppercase tracking-wide text-slate-600 font-semibold">
                    <th className="h-8 px-3 text-left font-normal">Component</th>
                    <th className="h-8 px-3 text-right font-normal">Weight</th>
                    <th className="h-8 px-3 text-left font-normal">Progress</th>
                    <th className="h-8 px-3 text-right font-normal">Contribution</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(ur.components || []).map((c) => (
                    <ComponentRow key={c.name} comp={c} onSet={patchComponent} disabled={!canManage || ur.ready_for_qa} />
                  ))}
                </tbody>
              </table>
            </div>

            <div className="rounded-md border border-gray-200 bg-white p-4" data-testid="ur-photos">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-medium text-gray-900 flex items-center gap-1.5"><ImageIcon className="h-4 w-4 text-navy-900" /> Readiness photos <span className="text-[11px] text-gray-500 ml-1">({photosCount})</span></div>
                {canManage && !ur.ready_for_qa && (
                  <>
                    <input type="file" ref={fileRef} onChange={onUploadPhoto} accept=".jpg,.jpeg,.png,.pdf" className="hidden" data-testid="ur-photo-input" />
                    <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading} data-testid="ur-upload-photo-btn">
                      <Upload className="h-3.5 w-3.5" /> {uploading ? "Uploading…" : "Upload photo"}
                    </Button>
                  </>
                )}
              </div>
              {photosCount === 0 ? <div className="text-xs text-gray-500">No photos yet. Upload at least 2 to enable Declare-Ready.</div>
              : <div className="text-[11px] text-gray-500">Photos are stored as attachments (entity_type=unit_readiness).</div>}
            </div>

            <DeclareModal open={showDeclare} onClose={() => setShowDeclare(false)}
              onSubmit={async (name, notes) => {
                try {
                  await api.post(`/unit-readiness/${ur.id}/declare-ready-for-qa`, { site_engineer_name: name, ready_notes: notes || null });
                  toast.success("Declared Ready-for-QA · T11 cascade fired");
                  setShowDeclare(false); load();
                } catch (e) { apiErrorToast(e); }
              }} />
          </>
        )}
      </div>
      {ur && <CollaborationPanel entityType="unit_readiness" entityId={ur.id} entityTitle="Unit Readiness" />}
    </div>
  );
}

function ComponentRow({ comp, onSet, disabled }) {
  const [pct, setPct] = useState(comp.percent || 0);
  const [notes, setNotes] = useState(comp.notes || "");
  useEffect(() => { setPct(comp.percent || 0); setNotes(comp.notes || ""); }, [comp.percent, comp.notes]);
  const contribution = ((comp.weight || 0) * (comp.percent || 0)).toFixed(2);
  const commit = () => {
    const n = Math.max(0, Math.min(100, parseInt(pct || 0, 10)));
    if (n !== (comp.percent || 0) || (notes || "") !== (comp.notes || "")) onSet(comp.name, n, notes || null);
  };
  return (
    <tr>
      <td className="px-3 py-2 text-sm text-gray-900">{comp.name}</td>
      <td className="px-3 py-2 text-right text-xs text-gray-600 tabular-nums">{(comp.weight * 100).toFixed(0)}%</td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <Input type="number" min="0" max="100" value={pct} onChange={(e) => setPct(e.target.value)} onBlur={commit} disabled={disabled} className="h-7 w-20 text-sm" data-testid={`ur-comp-${comp.name.toLowerCase().replace(/\s+/g, "-")}-pct`} />
          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden max-w-[120px]">
            <div className={"h-full " + (pct >= 85 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-gray-400")} style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={commit} disabled={disabled} placeholder="Notes…" className="h-7 flex-1 text-xs" />
        </div>
      </td>
      <td className="px-3 py-2 text-right text-xs text-gray-700 tabular-nums">{contribution}</td>
    </tr>
  );
}

function DeclareModal({ open, onClose, onSubmit }) {
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  useEffect(() => { if (open) { setName(""); setNotes(""); } }, [open]);
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose?.()}>
      <DialogContent data-testid="ur-declare-modal">
        <DialogHeader><DialogTitle>Declare Ready-for-QA</DialogTitle><DialogDescription>Cascade-completes journey task T11 on success.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div><label className="text-[11px] text-gray-600">Site engineer name *</label><Input value={name} onChange={(e) => setName(e.target.value)} className="h-9" data-testid="ur-declare-name" /></div>
          <div><label className="text-[11px] text-gray-600">Notes (optional)</label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-[60px] text-sm" /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => name.trim() && onSubmit(name.trim(), notes.trim())} disabled={!name.trim()} data-testid="ur-declare-submit">Declare</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

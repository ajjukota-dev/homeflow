import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { KeyRound, Calendar, ShieldAlert, CheckCircle2 } from "lucide-react";

import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { canManageHandover, canOverrideHandover, HANDOVER_GATE_TONE, HANDOVER_STATUS_TONE } from "@/lib/phase7";
import { formatDate, formatDateTime } from "@/lib/format";
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

export default function HandoverTab({ customerId, bookings }) {
  const { user } = useAuth();
  const confirmed = useMemo(() => (bookings || []).filter((b) => b.status === "Confirmed"), [bookings]);
  const [bookingId, setBookingId] = useState(confirmed[0]?.id || null);
  const [h, setH] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showFinal, setShowFinal] = useState(false);
  const [showAck, setShowAck] = useState(false);
  const [showOverride, setShowOverride] = useState(false);

  useEffect(() => { if (!bookingId && confirmed[0]) setBookingId(confirmed[0].id); }, [confirmed, bookingId]);

  const load = async () => {
    if (!bookingId) return;
    setLoading(true);
    try {
      const r = await api.get(`/handovers/booking/${bookingId}`);
      setH(r.data);
    } catch (e) { apiErrorToast(e); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [bookingId]);

  if (confirmed.length === 0) return <div className="rounded-md border border-gray-200 bg-white p-6 text-center"><KeyRound className="h-6 w-6 text-gray-300 mx-auto" /><div className="mt-2 text-sm text-gray-700">No Confirmed bookings yet.</div></div>;

  const canManage = canManageHandover(user);
  const canOverride = canOverrideHandover(user);
  const gate = h?.gate_status || "Red";
  const canAck = h && (gate === "Green" || !!h.override) && h.status !== "Executed" && h.status !== "Closed";

  return (
    <div className="grid xl:grid-cols-[minmax(0,1fr)_360px] gap-6" data-testid="handover-tab">
      <div className="space-y-4 min-w-0">
        {confirmed.length > 1 && (
          <Select value={bookingId || ""} onValueChange={setBookingId}>
            <SelectTrigger className="h-8 w-72 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>{confirmed.map((b) => <SelectItem key={b.id} value={b.id}><span className="font-mono text-xs">{b.code}</span></SelectItem>)}</SelectContent>
          </Select>
        )}
        {loading ? <div className="text-xs text-gray-500 p-6">Loading…</div>
        : h && (
          <>
            <div className="rounded-md border border-gray-200 bg-white p-4" data-testid="handover-header">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <div className="text-xs uppercase text-gray-500 tracking-wide">Readiness</div>
                  <div className="font-heading text-4xl font-semibold text-gray-900 tabular-nums mt-1" data-testid="handover-readiness-score">{h.readiness_score?.toFixed(1)}<span className="text-lg text-gray-500">%</span></div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill status={h.gate_status} tone={HANDOVER_GATE_TONE[h.gate_status] || "grey"} testId="handover-gate-pill" />
                  <StatusPill status={h.status} tone={HANDOVER_STATUS_TONE[h.status] || "grey"} />
                  {canOverride && !h.override && <Button size="sm" variant="outline" onClick={() => setShowOverride(true)} data-testid="handover-override-btn"><ShieldAlert className="h-3.5 w-3.5" /> Override</Button>}
                </div>
              </div>
              {h.gate_blockers?.length > 0 && (
                <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-2.5" data-testid="handover-blockers-list">
                  <div className="text-[11px] uppercase text-red-800 font-medium mb-1">Gate blockers</div>
                  <ul className="text-xs text-red-700 space-y-0.5 list-disc list-inside">
                    {h.gate_blockers.map((b, i) => <li key={i}>{b}</li>)}
                  </ul>
                </div>
              )}
              {h.override && (
                <div className="mt-3 rounded-md border border-purple-200 bg-purple-50 p-2 text-xs text-purple-900">
                  <b>Override active.</b> Reason: {h.override.reason}. Bypassed: {h.override.mandatory_gates_bypassed?.join(", ") || "—"}
                </div>
              )}
            </div>

            <div className="rounded-md border border-gray-200 bg-white p-4 space-y-3" data-testid="handover-schedule">
              <div className="text-sm font-medium text-gray-900 flex items-center gap-1.5"><Calendar className="h-4 w-4 text-navy-900" /> Schedule</div>
              <div className="grid grid-cols-3 gap-3 text-xs">
                <div><div className="text-gray-500 uppercase text-[10px]">Proposed</div><div className="text-gray-900">{h.scheduled?.proposed_date ? formatDate(h.scheduled.proposed_date) : "—"}</div></div>
                <div><div className="text-gray-500 uppercase text-[10px]">Customer preferred</div><div className="text-gray-900">{h.scheduled?.customer_preferred_date ? formatDate(h.scheduled.customer_preferred_date) : "—"}</div></div>
                <div><div className="text-gray-500 uppercase text-[10px]">Final</div><div className="text-gray-900">{h.scheduled?.final_date ? `${formatDate(h.scheduled.final_date)} ${h.scheduled.final_time || ""}` : "—"}</div></div>
              </div>
              {canManage && h.status !== "Executed" && h.status !== "Closed" && (
                <div className="flex gap-2 flex-wrap">
                  <Button size="sm" variant="outline" onClick={() => setShowFinal(true)} data-testid="handover-set-final-btn">Set final date</Button>
                  {canAck && <Button size="sm" onClick={() => setShowAck(true)} data-testid="handover-ack-btn"><CheckCircle2 className="h-3.5 w-3.5" /> Record acknowledgement</Button>}
                </div>
              )}
            </div>

            {h.date_revision_history?.length > 0 && (
              <div className="rounded-md border border-gray-200 bg-white p-4" data-testid="handover-revision-history">
                <div className="text-sm font-medium text-gray-900 mb-2">Date revision history</div>
                <ul className="space-y-2 text-xs">
                  {h.date_revision_history.map((r, i) => (
                    <li key={i} className="border-l-2 border-gray-200 pl-2">
                      <div className="text-gray-900">{r.field_name}: <span className="text-gray-500">{r.previous_value ? formatDate(r.previous_value) : "—"}</span> → <span className="font-medium">{formatDate(r.new_value)}</span></div>
                      <div className="text-[11px] text-gray-500">{r.reason} · {formatDateTime(r.changed_at)}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {h.acknowledgement && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3" data-testid="handover-ack-recorded">
                <div className="text-sm font-medium text-emerald-900">Acknowledged by {h.acknowledgement.customer_confirmed_by_name}</div>
                <div className="text-[11px] text-emerald-800">{formatDateTime(h.acknowledgement.customer_confirmed_at)}{h.acknowledgement.agreed_open_items ? ` · Open items: ${h.acknowledgement.agreed_open_items}` : ""}</div>
              </div>
            )}

            {h.status === "Executed" && <PostHandoverCard h={h} onChanged={load} />}
            {h.status === "Closed" && <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 flex items-center gap-2"><CheckCircle2 className="h-4 w-4" /> <b>Closed.</b> Post-handover complete on {formatDate(h.post_handover?.closure_confirmed_at)}.</div>}

            <SetFinalDateModal open={showFinal} onClose={() => setShowFinal(false)} h={h} onDone={load} />
            <AckModal open={showAck} onClose={() => setShowAck(false)} h={h} onDone={load} />
            <OverrideModal open={showOverride} onClose={() => setShowOverride(false)} h={h} onDone={load} />
          </>
        )}
      </div>
      {h && <CollaborationPanel entityType="handover" entityId={h.id} entityTitle="Handover" />}
    </div>
  );
}

function PostHandoverCard({ h, onChanged }) {
  const { user } = useAuth();
  const items = [
    ["facility_intro_done", "Facility intro done"],
    ["maintenance_setup_done", "Maintenance setup done"],
    ["owner_record_transferred", "Owner record transferred"],
    ["warranties_shared", "Warranties shared"],
    ["pending_snag_monitoring", "Pending snag monitoring set up"],
  ];
  const set = async (key, val) => {
    try { await api.patch(`/handovers/${h.id}/post-handover`, { [key]: val }); onChanged?.(); }
    catch (e) { apiErrorToast(e); }
  };
  const allTrue = items.every(([k]) => h.post_handover?.[k]);
  const close = async () => {
    try { await api.post(`/handovers/${h.id}/close`); toast.success("Handover Closed"); onChanged?.(); }
    catch (e) { apiErrorToast(e); }
  };
  return (
    <div className="rounded-md border border-gray-200 bg-white p-4 space-y-2" data-testid="handover-post-card">
      <div className="text-sm font-medium text-gray-900">Post-handover</div>
      <ul className="space-y-1 text-sm">
        {items.map(([k, label]) => (
          <li key={k} className="flex items-center gap-2">
            <input type="checkbox" checked={!!h.post_handover?.[k]} onChange={(e) => set(k, e.target.checked)} className="h-3.5 w-3.5" data-testid={`handover-post-${k}`} />
            <span className={h.post_handover?.[k] ? "text-gray-500 line-through" : "text-gray-900"}>{label}</span>
          </li>
        ))}
      </ul>
      {canManageHandover(user) && <Button size="sm" onClick={close} disabled={!allTrue} data-testid="handover-close-btn">Close Handover</Button>}
    </div>
  );
}

function SetFinalDateModal({ open, onClose, h, onDone }) {
  const [f, setF] = useState({ final_date: "", final_time: "10:00", reason: "" });
  useEffect(() => { if (open) setF({ final_date: "", final_time: "10:00", reason: "" }); }, [open]);
  const submit = async () => {
    if (!f.final_date || !f.reason.trim()) return;
    try { await api.post(`/handovers/${h.id}/set-final-date`, { final_date: new Date(f.final_date).toISOString(), final_time: f.final_time, reason: f.reason.trim() }); toast.success("Saved"); onClose(); onDone?.(); }
    catch (e) { apiErrorToast(e); }
  };
  return <Dialog open={open} onOpenChange={(v) => !v && onClose?.()}>
    <DialogContent data-testid="handover-final-modal">
      <DialogHeader><DialogTitle>Set final handover date</DialogTitle><DialogDescription>Changing the date is captured in the revision history.</DialogDescription></DialogHeader>
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <div><label className="text-[11px] text-gray-600">Final date *</label><Input type="date" value={f.final_date} onChange={(e) => setF((s) => ({ ...s, final_date: e.target.value }))} className="h-9" data-testid="handover-final-date" /></div>
          <div><label className="text-[11px] text-gray-600">Time *</label><Input type="time" value={f.final_time} onChange={(e) => setF((s) => ({ ...s, final_time: e.target.value }))} className="h-9" data-testid="handover-final-time" /></div>
        </div>
        <div><label className="text-[11px] text-gray-600">Reason *</label><Textarea value={f.reason} onChange={(e) => setF((s) => ({ ...s, reason: e.target.value }))} className="min-h-[60px] text-sm" data-testid="handover-final-reason" /></div>
      </div>
      <DialogFooter><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={!f.final_date || !f.reason.trim()} data-testid="handover-final-submit">Save</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function AckModal({ open, onClose, h, onDone }) {
  const [name, setName] = useState(""); const [items, setItems] = useState(""); const [comments, setComments] = useState(""); const [file, setFile] = useState(null);
  useEffect(() => { if (open) { setName(""); setItems(""); setComments(""); setFile(null); } }, [open]);
  const submit = async () => {
    if (!name.trim()) return;
    const fd = new FormData();
    fd.append("customer_confirmed_by_name", name.trim());
    if (items) fd.append("agreed_open_items", items);
    if (comments) fd.append("comments", comments);
    if (file) fd.append("signature_file", file);
    try { await api.post(`/handovers/${h.id}/record-acknowledgement`, fd, { headers: { "Content-Type": "multipart/form-data" } }); toast.success("Handover Executed · T13 cascade fired"); onClose(); onDone?.(); }
    catch (e) { apiErrorToast(e); }
  };
  return <Dialog open={open} onOpenChange={(v) => !v && onClose?.()}>
    <DialogContent data-testid="handover-ack-modal">
      <DialogHeader><DialogTitle>Record customer acknowledgement</DialogTitle><DialogDescription>Cascade-completes T13 + sets Unit status to Handed Over.</DialogDescription></DialogHeader>
      <div className="space-y-2">
        <div><label className="text-[11px] text-gray-600">Customer name *</label><Input value={name} onChange={(e) => setName(e.target.value)} className="h-9" data-testid="handover-ack-name" /></div>
        <div><label className="text-[11px] text-gray-600">Agreed open items</label><Textarea value={items} onChange={(e) => setItems(e.target.value)} className="min-h-[50px] text-sm" data-testid="handover-ack-items" /></div>
        <div><label className="text-[11px] text-gray-600">Comments</label><Textarea value={comments} onChange={(e) => setComments(e.target.value)} className="min-h-[50px] text-sm" /></div>
        <div><label className="text-[11px] text-gray-600">Signature (optional)</label><Input type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} className="h-8 text-xs" /></div>
      </div>
      <DialogFooter><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={!name.trim()} data-testid="handover-ack-submit">Record</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function OverrideModal({ open, onClose, h, onDone }) {
  const GATES = ["Financial clearance", "Registration", "Unit readiness", "Critical snags", "Documents", "Commitments"];
  const [reason, setReason] = useState(""); const [checks, setChecks] = useState({});
  useEffect(() => { if (open) { setReason(""); setChecks({}); } }, [open]);
  const submit = async () => {
    const bypassed = Object.entries(checks).filter(([, v]) => v).map(([k]) => k);
    if (!reason.trim() || bypassed.length === 0) return;
    try { await api.post(`/handovers/${h.id}/override`, { reason: reason.trim(), mandatory_gates_bypassed: bypassed }); toast.success("Override recorded"); onClose(); onDone?.(); }
    catch (e) { apiErrorToast(e); }
  };
  return <Dialog open={open} onOpenChange={(v) => !v && onClose?.()}>
    <DialogContent data-testid="handover-override-modal">
      <DialogHeader><DialogTitle>Override handover gate</DialogTitle><DialogDescription>Selected gates will be treated as bypassed. Original blockers are preserved in audit.</DialogDescription></DialogHeader>
      <div className="space-y-2">
        <div><label className="text-[11px] text-gray-600">Reason *</label><Textarea value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-[60px] text-sm" data-testid="handover-override-reason" /></div>
        <div className="grid grid-cols-2 gap-1">
          {GATES.map((g) => (
            <label key={g} className="flex items-center gap-2 text-xs text-gray-800">
              <input type="checkbox" checked={!!checks[g]} onChange={(e) => setChecks((s) => ({ ...s, [g]: e.target.checked }))} data-testid={`handover-override-gate-${g.replace(/\s+/g, "-").toLowerCase()}`} />{g}
            </label>
          ))}
        </div>
      </div>
      <DialogFooter><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={!reason.trim()} data-testid="handover-override-submit">Apply override</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

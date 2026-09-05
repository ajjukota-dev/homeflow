import { useEffect, useState } from "react";
import { toast } from "sonner";

import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/collab";
import { formatDateTime } from "@/lib/format";
import { ESC_SEVERITIES, ESC_SEVERITY_TONE, ESC_STATUS_TONE } from "@/lib/phase8";
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

export default function EscalationDetailModal({ open, onClose, escalation, manual = false, defaultCustomerId, onChanged }) {
  const { user } = useAuth();
  const [d, setD] = useState(escalation);
  const [showResolve, setShowResolve] = useState(false);
  const [showReopen, setShowReopen] = useState(false);
  // Manual creation state
  const [customers, setCustomers] = useState([]);
  const [depts, setDepts] = useState([]);
  const [mF, setMF] = useState({ customer_id: defaultCustomerId || "", department_id: "", severity: "Medium", title: "", description: "" });

  useEffect(() => { setD(escalation); }, [escalation]);
  useEffect(() => {
    if (!manual || !open) return;
    setMF({ customer_id: defaultCustomerId || "", department_id: "", severity: "Medium", title: "", description: "" });
    Promise.all([api.get("/customers"), api.get("/departments")]).then(([c, dp]) => { setCustomers(c.data || []); setDepts(dp.data || []); });
  }, [manual, open, defaultCustomerId]);

  const createManual = async () => {
    if (!mF.customer_id || !mF.department_id || !mF.title.trim()) return;
    try {
      await api.post("/escalations", { ...mF, title: mF.title.trim(), description: mF.description.trim() });
      toast.success("Escalation created");
      onClose(); onChanged?.();
    } catch (e) { apiErrorToast(e); }
  };

  const act = async (path, body) => {
    if (!d) return;
    try {
      const r = await api.post(`/escalations/${d.id}/${path}`, body || {});
      toast.success("Updated");
      setD(r.data);
      onChanged?.();
    } catch (e) { apiErrorToast(e); }
  };

  if (manual) {
    return <Dialog open={open} onOpenChange={(v) => !v && onClose?.()}>
      <DialogContent data-testid="esc-manual-modal" className="max-w-lg">
        <DialogHeader><DialogTitle>Create manual escalation</DialogTitle><DialogDescription>rule_key will be set to "manual".</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div><label className="text-[11px] text-gray-600">Customer *</label>
            <Select value={mF.customer_id} onValueChange={(v) => setMF((s) => ({ ...s, customer_id: v }))}>
              <SelectTrigger className="h-9 text-sm" data-testid="esc-manual-customer"><SelectValue placeholder="Select…" /></SelectTrigger>
              <SelectContent>{customers.map((c) => <SelectItem key={c.id} value={c.id}><span className="font-mono text-[11px] mr-1">{c.code}</span>{c.primary_name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="text-[11px] text-gray-600">Department *</label>
              <Select value={mF.department_id} onValueChange={(v) => setMF((s) => ({ ...s, department_id: v }))}>
                <SelectTrigger className="h-8 text-xs" data-testid="esc-manual-dept"><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>{depts.map((dep) => <SelectItem key={dep.id} value={dep.id}>{dep.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><label className="text-[11px] text-gray-600">Severity *</label>
              <Select value={mF.severity} onValueChange={(v) => setMF((s) => ({ ...s, severity: v }))}>
                <SelectTrigger className="h-8 text-xs" data-testid="esc-manual-severity"><SelectValue /></SelectTrigger>
                <SelectContent>{ESC_SEVERITIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div><label className="text-[11px] text-gray-600">Title *</label><Input value={mF.title} onChange={(e) => setMF((s) => ({ ...s, title: e.target.value }))} className="h-9 text-sm" data-testid="esc-manual-title" /></div>
          <div><label className="text-[11px] text-gray-600">Description</label><Textarea value={mF.description} onChange={(e) => setMF((s) => ({ ...s, description: e.target.value }))} className="min-h-[70px] text-sm" data-testid="esc-manual-desc" /></div>
        </div>
        <DialogFooter><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={createManual} disabled={!mF.customer_id || !mF.department_id || !mF.title.trim()} data-testid="esc-manual-submit">Create</Button></DialogFooter>
      </DialogContent>
    </Dialog>;
  }

  if (!open || !d) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose?.()}>
      <DialogContent className="max-w-2xl" data-testid="esc-detail-modal">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="font-mono text-sm">{d.code}</span>
            <StatusPill status={d.severity} tone={ESC_SEVERITY_TONE[d.severity] || "grey"} />
            <StatusPill status={d.status} tone={ESC_STATUS_TONE[d.status] || "grey"} />
          </DialogTitle>
          <DialogDescription>{d._customer?.code} · {d._customer?.primary_name} · {d._department?.name} · rule={d.rule_key}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="text-sm text-gray-900 font-medium">{d.title}</div>
          <div className="text-xs text-gray-700 whitespace-pre-wrap">{d.description || <span className="text-gray-400">No description.</span>}</div>
          {d.resolution_notes && <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-900">Resolution: {d.resolution_notes}</div>}
          <div className="flex flex-wrap gap-2">
            {d.status === "Open" && <Button size="sm" onClick={() => act("acknowledge")} data-testid="esc-ack-btn">Acknowledge</Button>}
            {(d.status === "Open" || d.status === "Acknowledged") && <Button size="sm" variant="outline" onClick={() => act("start")} data-testid="esc-start-btn">Start</Button>}
            {(d.status === "Open" || d.status === "Acknowledged") && <Button size="sm" variant="outline" onClick={() => act("assign", { owner_user_id: user.id })} data-testid="esc-assign-btn">Assign to me</Button>}
            {(d.status === "Open" || d.status === "Acknowledged" || d.status === "In Progress") && <Button size="sm" variant="outline" onClick={() => setShowResolve(true)} data-testid="esc-resolve-btn">Resolve</Button>}
            {(d.status === "Resolved" || d.status === "In Progress") && (isSuperAdmin(user) || user?.role?.code === "MANAGEMENT") && <Button size="sm" variant="outline" onClick={() => act("close")} data-testid="esc-close-btn">Close</Button>}
            {(d.status === "Resolved" || d.status === "Closed") && <Button size="sm" variant="ghost" onClick={() => setShowReopen(true)} data-testid="esc-reopen-btn">Reopen</Button>}
          </div>
          <div className="text-[11px] text-gray-500 grid grid-cols-2 gap-2 pt-2 border-t border-gray-100">
            <div>Created: {formatDateTime(d.created_at)}</div>
            {d.acknowledged_at && <div>Acknowledged: {formatDateTime(d.acknowledged_at)}</div>}
            {d.resolved_at && <div>Resolved: {formatDateTime(d.resolved_at)}</div>}
            {d.closed_at && <div>Closed: {formatDateTime(d.closed_at)}</div>}
          </div>
          <div className="pt-2 border-t border-gray-100"><CollaborationPanel entityType="escalation" entityId={d.id} entityTitle={d.code} /></div>
        </div>
        <ResolveModal open={showResolve} onClose={() => setShowResolve(false)} onSubmit={async (n) => { await act("resolve", { resolution_notes: n }); setShowResolve(false); }} />
        <ResolveModal open={showReopen} onClose={() => setShowReopen(false)} title="Reopen escalation" placeholder="Reason for reopening…" onSubmit={async (n) => { await act("reopen", { reason: n }); setShowReopen(false); }} />
      </DialogContent>
    </Dialog>
  );
}

function ResolveModal({ open, onClose, onSubmit, title = "Resolve escalation", placeholder = "Resolution notes…" }) {
  const [t, setT] = useState("");
  useEffect(() => { if (open) setT(""); }, [open]);
  return <Dialog open={open} onOpenChange={(v) => !v && onClose?.()}>
    <DialogContent>
      <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
      <Textarea value={t} onChange={(e) => setT(e.target.value)} placeholder={placeholder} className="min-h-[70px] text-sm" data-testid="esc-resolve-input" />
      <DialogFooter><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => onSubmit(t.trim())} disabled={!t.trim()} data-testid="esc-resolve-submit">Submit</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

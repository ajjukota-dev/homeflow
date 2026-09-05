import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Upload } from "lucide-react";

import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/collab";
import { COMM_CHANNELS, COMM_DIRECTIONS } from "@/lib/phase8";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

export default function LogCommunicationModal({ open, onClose, customerId, onCreated }) {
  const { user } = useAuth();
  const canSetVisible = isSuperAdmin(user) || ["CRM", "MANAGEMENT"].includes(user?.role?.code);
  const [customers, setCustomers] = useState([]);
  const _nowLocal = () => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16); // YYYY-MM-DDTHH:mm
  };
  const [f, setF] = useState({
    customer_id: customerId || "", channel: "Phone", direction: "Inbound",
    subject: "", summary: "",
    communicated_at: _nowLocal(),
    follow_up_required: false, follow_up_date: "",
    customer_visible: false,
  });
  const [file, setFile] = useState(null);

  useEffect(() => {
    if (!open) return;
    setF({ customer_id: customerId || "", channel: "Phone", direction: "Inbound", subject: "", summary: "", communicated_at: _nowLocal(), follow_up_required: false, follow_up_date: "", customer_visible: false });
    setFile(null);
    if (!customerId) api.get("/customers").then((r) => setCustomers(r.data || []));
  }, [open, customerId]);

  const submit = async () => {
    if (!f.customer_id || !f.subject.trim() || !f.summary.trim() || !f.communicated_at) return;
    const fd = new FormData();
    fd.append("customer_id", f.customer_id);
    fd.append("channel", f.channel); fd.append("direction", f.direction);
    fd.append("subject", f.subject.trim()); fd.append("summary", f.summary.trim());
    fd.append("communicated_at", new Date(f.communicated_at).toISOString());
    fd.append("follow_up_required", f.follow_up_required ? "true" : "false");
    if (f.follow_up_date) fd.append("follow_up_date", new Date(f.follow_up_date).toISOString());
    fd.append("customer_visible", f.customer_visible ? "true" : "false");
    if (file) fd.append("file", file);
    try {
      await api.post("/communications", fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("Communication logged");
      onClose(); onCreated?.();
    } catch (e) { apiErrorToast(e); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose?.()}>
      <DialogContent data-testid="comm-log-modal" className="max-w-lg">
        <DialogHeader><DialogTitle>Log Communication</DialogTitle><DialogDescription>Capture every customer touch.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          {!customerId && (
            <div>
              <label className="text-[11px] text-gray-600">Customer *</label>
              <Select value={f.customer_id} onValueChange={(v) => setF((s) => ({ ...s, customer_id: v }))}>
                <SelectTrigger className="h-9 text-sm" data-testid="comm-log-customer"><SelectValue placeholder="Select customer…" /></SelectTrigger>
                <SelectContent>{customers.map((c) => <SelectItem key={c.id} value={c.id}><span className="font-mono text-[11px] mr-1">{c.code}</span>{c.primary_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div><label className="text-[11px] text-gray-600">Channel *</label><Select value={f.channel} onValueChange={(v) => setF((s) => ({ ...s, channel: v }))}><SelectTrigger className="h-8 text-xs" data-testid="comm-log-channel"><SelectValue /></SelectTrigger><SelectContent>{COMM_CHANNELS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></div>
            <div><label className="text-[11px] text-gray-600">Direction *</label><Select value={f.direction} onValueChange={(v) => setF((s) => ({ ...s, direction: v }))}><SelectTrigger className="h-8 text-xs" data-testid="comm-log-direction"><SelectValue /></SelectTrigger><SelectContent>{COMM_DIRECTIONS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></div>
          </div>
          <div><label className="text-[11px] text-gray-600">Subject *</label><Input value={f.subject} onChange={(e) => setF((s) => ({ ...s, subject: e.target.value }))} className="h-9 text-sm" data-testid="comm-log-subject" /></div>
          <div><label className="text-[11px] text-gray-600">Date &amp; Time *</label><Input type="datetime-local" value={f.communicated_at} onChange={(e) => setF((s) => ({ ...s, communicated_at: e.target.value }))} className="h-9 text-sm" data-testid="comm-log-communicated-at" /></div>
          <div><label className="text-[11px] text-gray-600">Summary *</label><Textarea value={f.summary} onChange={(e) => setF((s) => ({ ...s, summary: e.target.value }))} className="min-h-[70px] text-sm" data-testid="comm-log-summary" /></div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-gray-800">
              <input type="checkbox" checked={f.follow_up_required} onChange={(e) => setF((s) => ({ ...s, follow_up_required: e.target.checked }))} data-testid="comm-log-followup" />
              Follow-up required
            </label>
            {f.follow_up_required && <Input type="date" value={f.follow_up_date} onChange={(e) => setF((s) => ({ ...s, follow_up_date: e.target.value }))} className="h-8 w-40 text-xs" />}
          </div>
          {canSetVisible && (
            <label className="flex items-center gap-2 text-xs text-gray-800">
              <input type="checkbox" checked={f.customer_visible} onChange={(e) => setF((s) => ({ ...s, customer_visible: e.target.checked }))} data-testid="comm-log-visible" />
              Visible to customer (portal)
            </label>
          )}
          <div><label className="text-[11px] text-gray-600 flex items-center gap-1"><Upload className="h-3 w-3" /> Attachment (optional)</label><Input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} className="h-8 text-xs" /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={!f.customer_id || !f.subject.trim() || !f.summary.trim() || !f.communicated_at} data-testid="comm-log-submit">Log</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

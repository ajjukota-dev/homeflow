import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Plus, PhoneCall, Mail, MessageCircle, Users } from "lucide-react";

import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import { COMM_CHANNELS, COMM_DIRECTIONS } from "@/lib/phase8";
import LogCommunicationModal from "@/components/customer/LogCommunicationModal";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";

const CH_ICON = { Phone: PhoneCall, Email: Mail, WhatsApp: MessageCircle, SMS: MessageCircle, Meeting: Users, "In-person": Users, Portal: MessageCircle };

export default function CommunicationsPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [channel, setChannel] = useState("__all__");
  const [direction, setDirection] = useState("__all__");
  const [followup, setFollowup] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showLog, setShowLog] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const params = {};
      if (channel !== "__all__") params.channel = channel;
      if (direction !== "__all__") params.direction = direction;
      if (followup) params.follow_up_outstanding = true;
      const r = await api.get("/communications", { params });
      setRows(r.data || []);
    } catch (e) { apiErrorToast(e); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [channel, direction, followup]);

  return (
    <div className="space-y-6" data-testid="communications-page">
      <PageHeader title="Communications" subtitle="Every customer conversation — logged and searchable."
        actions={<Button size="sm" onClick={() => setShowLog(true)} data-testid="comm-log-btn"><Plus className="h-3.5 w-3.5" /> Log Communication</Button>} />
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={channel} onValueChange={setChannel}>
          <SelectTrigger className="h-8 w-40 text-sm" data-testid="comm-channel-filter"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="__all__">All channels</SelectItem>{COMM_CHANNELS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={direction} onValueChange={setDirection}>
          <SelectTrigger className="h-8 w-36 text-sm" data-testid="comm-direction-filter"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="__all__">Both directions</SelectItem>{COMM_DIRECTIONS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-xs text-gray-700">
          <input type="checkbox" checked={followup} onChange={(e) => setFollowup(e.target.checked)} data-testid="comm-followup-toggle" />
          Follow-up outstanding
        </label>
      </div>
      <div className="rounded-md border border-gray-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="text-xs uppercase tracking-wide text-slate-600 font-semibold">
              <th className="h-9 px-3 text-left font-normal">Code</th>
              <th className="h-9 px-3 text-left font-normal">Customer</th>
              <th className="h-9 px-3 text-left font-normal">Channel</th>
              <th className="h-9 px-3 text-left font-normal">Direction</th>
              <th className="h-9 px-3 text-left font-normal">Subject</th>
              <th className="h-9 px-3 text-left font-normal">By</th>
              <th className="h-9 px-3 text-left font-normal">Follow-up</th>
              <th className="h-9 px-3 text-left font-normal">When</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? <tr><td colSpan={8} className="p-4 text-xs text-gray-500">Loading…</td></tr>
            : rows.length === 0 ? <tr><td colSpan={8} className="p-4 text-xs text-gray-500">No communications match this filter.</td></tr>
            : rows.map((r) => {
              const Icon = CH_ICON[r.channel] || MessageCircle;
              return (
                <tr key={r.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => r._customer?.id && navigate(`/customers/${r._customer.id}?tab=communications`)} data-testid={`comm-row-${r.code}`}>
                  <td className="px-3 py-2 font-mono text-[11px] text-gray-700">{r.code}</td>
                  <td className="px-3 py-2">{r._customer?.id ? (<><span className="font-mono text-[11px] text-gray-500 mr-1.5">{r._customer.code}</span><span className="text-sm text-gray-900">{r._customer.primary_name}</span></>) : "—"}</td>
                  <td className="px-3 py-2 text-xs text-gray-800 flex items-center gap-1.5"><Icon className="h-3 w-3" /> {r.channel}</td>
                  <td className="px-3 py-2 text-xs"><span className={r.direction === "Inbound" ? "text-blue-700" : "text-gray-700"}>{r.direction}</span></td>
                  <td className="px-3 py-2 text-sm text-gray-800 truncate max-w-[300px]">{r.subject}</td>
                  <td className="px-3 py-2 text-xs text-gray-700 truncate max-w-[120px]">{r._employee?.name || "—"}</td>
                  <td className="px-3 py-2 text-[11px]">{r.follow_up_required ? <span className="rounded-full px-1.5 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 tabular-nums">Due {r.follow_up_date ? new Date(r.follow_up_date).toLocaleDateString() : "—"}</span> : <span className="text-gray-400">—</span>}</td>
                  <td className="px-3 py-2 text-xs text-gray-600 tabular-nums">{r.communicated_at ? formatDateTime(r.communicated_at) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <LogCommunicationModal open={showLog} onClose={() => setShowLog(false)} onCreated={load} />
    </div>
  );
}

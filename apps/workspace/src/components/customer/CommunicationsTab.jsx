import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, PhoneCall, Mail, MessageCircle, Users, CheckCircle2 } from "lucide-react";

import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import LogCommunicationModal from "@/components/customer/LogCommunicationModal";

const CH_ICON = { Phone: PhoneCall, Email: Mail, WhatsApp: MessageCircle, SMS: MessageCircle, Meeting: Users, "In-person": Users, Portal: MessageCircle };

export default function CommunicationsTab({ customerId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showLog, setShowLog] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/communications", { params: { customer_id: customerId } });
      setRows(r.data || []);
    } catch (e) { apiErrorToast(e); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (customerId) load(); /* eslint-disable-next-line */ }, [customerId]);

  const completeFollowUp = async (id) => {
    try { await api.post(`/communications/${id}/complete-follow-up`); toast.success("Follow-up marked complete"); load(); }
    catch (e) { apiErrorToast(e); }
  };

  return (
    <div className="space-y-4" data-testid="communications-tab">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-500">{rows.length} record{rows.length === 1 ? "" : "s"}</div>
        <Button size="sm" onClick={() => setShowLog(true)} data-testid="ctab-log-btn"><Plus className="h-3.5 w-3.5" /> Log Communication</Button>
      </div>
      <div className="rounded-md border border-gray-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="text-xs uppercase tracking-wide text-slate-600 font-semibold">
              <th className="h-8 px-3 text-left font-normal">When</th>
              <th className="h-8 px-3 text-left font-normal">Channel</th>
              <th className="h-8 px-3 text-left font-normal">Direction</th>
              <th className="h-8 px-3 text-left font-normal">Subject</th>
              <th className="h-8 px-3 text-left font-normal">Summary</th>
              <th className="h-8 px-3 text-left font-normal">By</th>
              <th className="h-8 px-3 text-left font-normal">Follow-up</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? <tr><td colSpan={7} className="p-4 text-xs text-gray-500">Loading…</td></tr>
            : rows.length === 0 ? <tr><td colSpan={7} className="p-4 text-xs text-gray-500">No communications logged yet.</td></tr>
            : rows.map((r) => {
              const Icon = CH_ICON[r.channel] || MessageCircle;
              return (
                <tr key={r.id} data-testid={`ctab-comm-${r.code}`}>
                  <td className="px-3 py-2 text-xs text-gray-700 tabular-nums whitespace-nowrap">{formatDateTime(r.communicated_at)}</td>
                  <td className="px-3 py-2 text-xs text-gray-800 flex items-center gap-1.5"><Icon className="h-3 w-3" /> {r.channel}</td>
                  <td className="px-3 py-2 text-xs">{r.direction}</td>
                  <td className="px-3 py-2 text-sm text-gray-800 truncate max-w-[240px]">{r.subject}</td>
                  <td className="px-3 py-2 text-xs text-gray-700 truncate max-w-[320px]">{r.summary}</td>
                  <td className="px-3 py-2 text-xs text-gray-700 truncate max-w-[120px]">{r._employee?.name || "—"}</td>
                  <td className="px-3 py-2 text-[11px]">
                    {r.follow_up_required ? (
                      <div className="flex items-center gap-2">
                        <span className="rounded-full px-1.5 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 tabular-nums whitespace-nowrap">Due {r.follow_up_date ? new Date(r.follow_up_date).toLocaleDateString() : "—"}</span>
                        <button className="text-emerald-700 hover:underline inline-flex items-center gap-0.5" onClick={() => completeFollowUp(r.id)} data-testid={`ctab-followup-done-${r.code}`}><CheckCircle2 className="h-3 w-3" /> Done</button>
                      </div>
                    ) : <span className="text-gray-400">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <LogCommunicationModal open={showLog} customerId={customerId} onClose={() => setShowLog(false)} onCreated={load} />
    </div>
  );
}

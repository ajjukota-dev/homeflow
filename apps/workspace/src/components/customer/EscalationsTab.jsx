import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";

import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import StatusPill from "@/components/StatusPill";
import { ESC_SEVERITY_TONE, ESC_STATUS_TONE } from "@/lib/phase8";
import EscalationDetailModal from "@/components/escalation/EscalationDetailModal";

export default function EscalationsTab({ customerId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [showManual, setShowManual] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/escalations", { params: { customer_id: customerId } });
      setRows(r.data || []);
    } catch (e) { apiErrorToast(e); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (customerId) load(); /* eslint-disable-next-line */ }, [customerId]);

  const counts = useMemo(() => {
    const open = rows.filter((r) => ["Open", "Acknowledged", "In Progress"].includes(r.status));
    return {
      total: rows.length,
      open: open.length,
      critical: open.filter((r) => r.severity === "Critical").length,
      high: open.filter((r) => r.severity === "High").length,
    };
  }, [rows]);

  return (
    <div className="space-y-4" data-testid="escalations-tab">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-xs text-gray-600">
          <span>Total: <span className="font-medium text-gray-900 tabular-nums">{counts.total}</span></span>
          <span>Open: <span className={"font-medium tabular-nums " + (counts.open > 0 ? "text-red-700" : "text-gray-900")}>{counts.open}</span></span>
          {counts.critical > 0 && <span>Critical: <span className="font-medium tabular-nums text-rose-700">{counts.critical}</span></span>}
          {counts.high > 0 && <span>High: <span className="font-medium tabular-nums text-red-700">{counts.high}</span></span>}
        </div>
        <Button size="sm" onClick={() => setShowManual(true)} data-testid="etab-manual-btn"><Plus className="h-3.5 w-3.5" /> New escalation</Button>
      </div>
      <div className="rounded-md border border-gray-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="text-xs uppercase tracking-wide text-slate-600 font-semibold">
              <th className="h-8 px-3 text-left font-normal">Code</th>
              <th className="h-8 px-3 text-left font-normal">Severity</th>
              <th className="h-8 px-3 text-left font-normal">Status</th>
              <th className="h-8 px-3 text-left font-normal">Rule</th>
              <th className="h-8 px-3 text-left font-normal">Title</th>
              <th className="h-8 px-3 text-left font-normal">Department</th>
              <th className="h-8 px-3 text-left font-normal">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? <tr><td colSpan={7} className="p-4 text-xs text-gray-500">Loading…</td></tr>
            : rows.length === 0 ? <tr><td colSpan={7} className="p-4 text-xs text-gray-500">No escalations for this customer.</td></tr>
            : rows.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setSelected(r)} data-testid={`etab-row-${r.code}`}>
                <td className="px-3 py-2 font-mono text-[11px] text-gray-700">{r.code}</td>
                <td className="px-3 py-2"><StatusPill status={r.severity} tone={ESC_SEVERITY_TONE[r.severity] || "grey"} /></td>
                <td className="px-3 py-2"><StatusPill status={r.status} tone={ESC_STATUS_TONE[r.status] || "grey"} /></td>
                <td className="px-3 py-2 text-[11px] text-gray-500 font-mono">{r.rule_key}</td>
                <td className="px-3 py-2 text-sm text-gray-800 truncate max-w-[300px]">{r.title}</td>
                <td className="px-3 py-2 text-xs text-gray-700">{r._department?.name || "—"}</td>
                <td className="px-3 py-2 text-xs text-gray-600 tabular-nums">{formatDate(r.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <EscalationDetailModal open={!!selected} onClose={() => setSelected(null)} escalation={selected} onChanged={load} />
      <EscalationDetailModal open={showManual} manual defaultCustomerId={customerId} onClose={() => setShowManual(false)} onChanged={load} />
    </div>
  );
}

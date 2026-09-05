import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/collab";
import PageHeader from "@/components/PageHeader";
import StatusPill from "@/components/StatusPill";
import { ESC_SEVERITIES, ESC_SEVERITY_TONE, ESC_STATUS_TONE } from "@/lib/phase8";
import EscalationDetailModal from "@/components/escalation/EscalationDetailModal";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";

const TAB_META = {
  open:      { label: "Open",     testId: "esc-tab-open",     status: "open" },
  resolved:  { label: "Resolved", testId: "esc-tab-resolved", status: "Resolved" },
  all:       { label: "All",      testId: "esc-tab-all",      status: null },
};
const TAB_ORDER = ["open", "resolved", "all"];

export default function EscalationsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [tab, setTab] = useState(() => {
    const q = new URLSearchParams(window.location.search).get("t");
    return TAB_ORDER.includes(q) ? q : "open";
  });
  const [rows, setRows] = useState([]);
  const [severity, setSeverity] = useState("__all__");
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showManual, setShowManual] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const params = {};
      const st = TAB_META[tab].status;
      if (st) params.status = st;
      if (severity !== "__all__") params.severity = severity;
      const r = await api.get("/escalations", { params });
      setRows(r.data || []);
    } catch (e) { apiErrorToast(e); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tab, severity]);

  const setTabWithUrl = (next) => {
    setTab(next);
    const params = new URLSearchParams(window.location.search);
    params.set("t", next);
    window.history.replaceState(null, "", `?${params.toString()}`);
  };

  return (
    <div className="space-y-6" data-testid="escalations-page">
      <PageHeader title="Escalations" subtitle="Rule-based + manual escalations across departments."
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={async () => {
              try { const r = await api.post("/escalations/scan"); toast.success(`Scan · created ${r.data.created}, closed ${r.data.auto_closed}`); load(); }
              catch (e) { apiErrorToast(e); }
            }} data-testid="esc-scan-btn">Run scan</Button>
            <Button size="sm" onClick={() => setShowManual(true)} data-testid="esc-manual-btn">New manual</Button>
          </div>
        } />

      <div className="border-b border-gray-200 flex items-center gap-1">
        {TAB_ORDER.map((k) => {
          const active = tab === k;
          return <button key={k} type="button" onClick={() => setTabWithUrl(k)}
            className={["px-4 py-2 -mb-px border-b-2 text-xs font-medium", active ? "border-navy-900 text-navy-900" : "border-transparent text-gray-600 hover:text-gray-900"].join(" ")}
            data-testid={TAB_META[k].testId}>{TAB_META[k].label}</button>;
        })}
        <div className="ml-auto">
          <Select value={severity} onValueChange={setSeverity}>
            <SelectTrigger className="h-8 w-40 text-xs" data-testid="esc-severity-filter"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="__all__">All severities</SelectItem>{ESC_SEVERITIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      <div className="rounded-md border border-gray-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="text-xs uppercase tracking-wide text-slate-600 font-semibold">
              <th className="h-9 px-3 text-left font-normal">Code</th>
              <th className="h-9 px-3 text-left font-normal">Severity</th>
              <th className="h-9 px-3 text-left font-normal">Status</th>
              <th className="h-9 px-3 text-left font-normal">Customer</th>
              <th className="h-9 px-3 text-left font-normal">Department</th>
              <th className="h-9 px-3 text-left font-normal">Rule</th>
              <th className="h-9 px-3 text-left font-normal">Title</th>
              <th className="h-9 px-3 text-left font-normal">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? <tr><td colSpan={8} className="p-4 text-xs text-gray-500">Loading…</td></tr>
            : rows.length === 0 ? <tr><td colSpan={8} className="p-4 text-xs text-gray-500">No escalations match this filter.</td></tr>
            : rows.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setSelected(r)} data-testid={`esc-row-${r.code}`}>
                <td className="px-3 py-2 font-mono text-[11px] text-gray-700">{r.code}</td>
                <td className="px-3 py-2"><StatusPill status={r.severity} tone={ESC_SEVERITY_TONE[r.severity] || "grey"} /></td>
                <td className="px-3 py-2"><StatusPill status={r.status} tone={ESC_STATUS_TONE[r.status] || "grey"} /></td>
                <td className="px-3 py-2">{r._customer?.id ? (<><span className="font-mono text-[11px] text-gray-500 mr-1.5">{r._customer.code}</span><span className="text-sm text-gray-900">{r._customer.primary_name}</span></>) : "—"}</td>
                <td className="px-3 py-2 text-xs text-gray-700">{r._department?.name || "—"}</td>
                <td className="px-3 py-2 text-[11px] text-gray-500 font-mono">{r.rule_key}</td>
                <td className="px-3 py-2 text-sm text-gray-800 truncate max-w-[260px]">{r.title}</td>
                <td className="px-3 py-2 text-xs text-gray-600 tabular-nums">{formatDate(r.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <EscalationDetailModal open={!!selected} onClose={() => setSelected(null)} escalation={selected} onChanged={load} />
      <EscalationDetailModal open={showManual} manual onClose={() => setShowManual(false)} onChanged={load} />
    </div>
  );
}

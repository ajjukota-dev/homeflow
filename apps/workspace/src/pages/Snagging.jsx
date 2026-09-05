import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import { formatDate } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import StatusPill from "@/components/StatusPill";
import { SNAG_SEVERITIES, SNAG_STATUSES, SNAG_SEVERITY_TONE, SNAG_STATUS_TONE } from "@/lib/phase7";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function SnaggingPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [severity, setSeverity] = useState("__all__");
  const [status, setStatus] = useState("__all__");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const params = {};
      if (severity !== "__all__") params.severity = severity;
      if (status !== "__all__") params.status = status;
      const r = await api.get("/snags", { params });
      setRows(r.data || []);
    } catch (e) { apiErrorToast(e); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [severity, status]);

  return (
    <div className="space-y-6" data-testid="snagging-page">
      <PageHeader title="Snagging" subtitle="Every snag across every unit — critical open items block Handover." />
      <div className="flex items-center gap-3">
        <span className="text-xs uppercase tracking-wide text-slate-600 font-semibold">Severity</span>
        <Select value={severity} onValueChange={setSeverity}>
          <SelectTrigger className="h-8 w-40 text-sm" data-testid="snags-severity-filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All</SelectItem>
            {SNAG_SEVERITIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-xs uppercase tracking-wide text-slate-600 font-semibold ml-3">Status</span>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-8 w-56 text-sm" data-testid="snags-status-filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All</SelectItem>
            {SNAG_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="rounded-md border border-gray-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="text-xs uppercase tracking-wide text-slate-600 font-semibold">
              <th className="h-9 px-3 text-left font-normal">Code</th>
              <th className="h-9 px-3 text-left font-normal">Customer</th>
              <th className="h-9 px-3 text-left font-normal">Project · Unit</th>
              <th className="h-9 px-3 text-left font-normal">Room</th>
              <th className="h-9 px-3 text-left font-normal">Category</th>
              <th className="h-9 px-3 text-left font-normal">Severity</th>
              <th className="h-9 px-3 text-left font-normal">Status</th>
              <th className="h-9 px-3 text-left font-normal">Owner</th>
              <th className="h-9 px-3 text-left font-normal">Due</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? <tr><td colSpan={9} className="p-4 text-xs text-gray-500">Loading…</td></tr>
            : rows.length === 0 ? <tr><td colSpan={9} className="p-4 text-xs text-gray-500">No snags match this filter.</td></tr>
            : rows.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50 cursor-pointer"
                onClick={() => r._customer?.id && navigate(`/customers/${r._customer.id}?tab=snags`)}
                data-testid={`snag-row-${r.id.slice(0, 8)}`}>
                <td className="px-3 py-2 font-mono text-[11px] text-gray-700">{r.code}</td>
                <td className="px-3 py-2">
                  {r._customer?.id ? (<><span className="font-mono text-[11px] text-gray-500 mr-1.5">{r._customer.code}</span><span className="text-sm text-gray-900">{r._customer.primary_name}</span></>) : "—"}
                </td>
                <td className="px-3 py-2 text-xs text-gray-700 font-mono">{r._project?.code || "—"} · {r._unit?.code || "—"}</td>
                <td className="px-3 py-2 text-xs text-gray-700">{r.room}</td>
                <td className="px-3 py-2 text-xs text-gray-700">{r.category}</td>
                <td className="px-3 py-2"><StatusPill status={r.severity} tone={SNAG_SEVERITY_TONE[r.severity] || "grey"} /></td>
                <td className="px-3 py-2"><StatusPill status={r.status} tone={SNAG_STATUS_TONE[r.status] || "grey"} /></td>
                <td className="px-3 py-2 text-xs text-gray-700 truncate max-w-[140px]">{r._owner?.name || <span className="text-gray-400">Unassigned</span>}</td>
                <td className="px-3 py-2 text-xs text-gray-600 tabular-nums">{r.due_date ? formatDate(r.due_date) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";

import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import { formatDate } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function UnitReadinessPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [readyFilter, setReadyFilter] = useState("__all__");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const params = {};
      if (readyFilter === "ready") params.ready_for_qa = true;
      if (readyFilter === "not_ready") params.ready_for_qa = false;
      const r = await api.get("/unit-readiness", { params });
      setRows(r.data || []);
    } catch (e) { apiErrorToast(e); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [readyFilter]);

  return (
    <div className="space-y-6" data-testid="unit-readiness-page">
      <PageHeader title="Unit Readiness" subtitle="Component-level construction progress across every Confirmed booking." />
      <div className="flex items-center gap-3">
        <span className="text-xs uppercase tracking-wide text-slate-600 font-semibold">Ready for QA</span>
        <Select value={readyFilter} onValueChange={setReadyFilter}>
          <SelectTrigger className="h-8 w-56 text-sm" data-testid="ur-ready-filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All</SelectItem>
            <SelectItem value="ready">Ready-for-QA</SelectItem>
            <SelectItem value="not_ready">Not yet ready</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="rounded-md border border-gray-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="text-xs uppercase tracking-wide text-slate-600 font-semibold">
              <th className="h-9 px-3 text-left font-normal">Customer</th>
              <th className="h-9 px-3 text-left font-normal">Project · Unit</th>
              <th className="h-9 px-3 text-right font-normal">Overall Score</th>
              <th className="h-9 px-3 text-left font-normal">Ready-for-QA</th>
              <th className="h-9 px-3 text-left font-normal">Site Engineer</th>
              <th className="h-9 px-3 text-left font-normal">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? <tr><td colSpan={6} className="p-4 text-xs text-gray-500">Loading…</td></tr>
            : rows.length === 0 ? <tr><td colSpan={6} className="p-4 text-xs text-gray-500">No records match this filter.</td></tr>
            : rows.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50 cursor-pointer"
                onClick={() => r._customer?.id && navigate(`/customers/${r._customer.id}?tab=unit-readiness`)}
                data-testid={`ur-row-${r.id.slice(0, 8)}`}>
                <td className="px-3 py-2">
                  {r._customer?.id ? (<><span className="font-mono text-[11px] text-gray-500 mr-1.5">{r._customer.code}</span><span className="text-sm text-gray-900">{r._customer.primary_name}</span></>) : "—"}
                </td>
                <td className="px-3 py-2 text-xs text-gray-700 font-mono">{r._project?.code || "—"} · {r._unit?.code || "—"}</td>
                <td className="px-3 py-2 text-right">
                  <span className={"tabular-nums font-medium " + (r.overall_score >= 85 ? "text-emerald-700" : r.overall_score >= 50 ? "text-amber-700" : "text-gray-600")}>
                    {r.overall_score?.toFixed(1) || "0.0"}%
                  </span>
                </td>
                <td className="px-3 py-2">
                  {r.ready_for_qa ? (
                    <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 font-medium"><CheckCircle2 className="h-3 w-3" /> Yes</span>
                  ) : (
                    <span className="text-[11px] text-gray-500">Not yet</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-gray-700 truncate max-w-[180px]">{r.site_engineer_name || <span className="text-gray-400">—</span>}</td>
                <td className="px-3 py-2 text-xs text-gray-600 tabular-nums">{r.updated_at ? formatDate(r.updated_at) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

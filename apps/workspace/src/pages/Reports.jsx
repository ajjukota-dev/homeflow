import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Download } from "lucide-react";

import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { REPORT_TYPES } from "@/lib/phase8";

export default function ReportsPage() {
  const [active, setActive] = useState(REPORT_TYPES[0].key);
  const [window_, setWindow_] = useState(30);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const meta = useMemo(() => REPORT_TYPES.find((r) => r.key === active), [active]);

  const url = (fmt = "json") => {
    let path = `/reports/${active}?format=${fmt}`;
    if (meta.supportsWindow) path += `&window=${window_}`;
    return path;
  };

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get(url("json"));
      setRows(Array.isArray(r.data) ? r.data : []);
    } catch (e) { apiErrorToast(e); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [active, window_]);

  const exportCsv = async () => {
    try {
      const resp = await api.get(url("csv"), { responseType: "blob" });
      const blob = new Blob([resp.data], { type: "text/csv" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${active}${meta.supportsWindow ? `-${window_}d` : ""}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) { apiErrorToast(e); }
  };

  const columns = rows[0] ? Object.keys(rows[0]) : [];

  return (
    <div className="space-y-6" data-testid="reports-page">
      <PageHeader title="Reports" subtitle="Read-only, JSON + CSV." />
      <div className="grid xl:grid-cols-[220px_minmax(0,1fr)] gap-6">
        {/* Sidebar */}
        <aside className="space-y-1" data-testid="reports-sidebar">
          {REPORT_TYPES.map((r) => (
            <button key={r.key} type="button" onClick={() => setActive(r.key)}
              className={["w-full text-left rounded-md px-3 py-2 text-sm transition-colors",
                active === r.key ? "bg-navy-900 text-white" : "text-gray-800 hover:bg-gray-100"].join(" ")}
              data-testid={`reports-tab-${r.key}`}>
              {r.label}
            </button>
          ))}
        </aside>
        {/* Main */}
        <div className="space-y-3 min-w-0">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="text-base font-medium text-gray-900" data-testid="reports-active-title">{meta.label}</div>
              <div className="text-xs text-gray-500">{meta.description}</div>
            </div>
            <div className="flex items-center gap-2">
              {meta.supportsWindow && (
                <Select value={String(window_)} onValueChange={(v) => setWindow_(parseInt(v, 10))}>
                  <SelectTrigger className="h-8 w-28 text-xs" data-testid="reports-window"><SelectValue /></SelectTrigger>
                  <SelectContent>{[30, 60, 90].map((w) => <SelectItem key={w} value={String(w)}>{w} days</SelectItem>)}</SelectContent>
                </Select>
              )}
              <Button size="sm" variant="outline" onClick={exportCsv} data-testid="reports-export-btn"><Download className="h-3.5 w-3.5" /> Export CSV</Button>
            </div>
          </div>
          <div className="rounded-md border border-gray-200 bg-white overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="text-xs uppercase tracking-wide text-slate-600 font-semibold">
                  {columns.length === 0 ? <th className="h-9 px-3 text-left font-normal">Column</th>
                  : columns.map((c) => <th key={c} className="h-9 px-3 text-left font-normal whitespace-nowrap">{c.replace(/_/g, " ")}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? <tr><td colSpan={Math.max(1, columns.length)} className="p-4 text-xs text-gray-500">Loading…</td></tr>
                : rows.length === 0 ? <tr><td colSpan={Math.max(1, columns.length)} className="p-4 text-xs text-gray-500">No rows.</td></tr>
                : rows.map((r, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    {columns.map((c) => <td key={c} className="px-3 py-1.5 text-xs text-gray-800 whitespace-nowrap">{formatCell(r[c])}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatCell(v) {
  if (v === true) return "Yes";
  if (v === false) return "No";
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") return v.toLocaleString();
  return String(v);
}

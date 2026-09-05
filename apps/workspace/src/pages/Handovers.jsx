import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import { formatDate } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import StatusPill from "@/components/StatusPill";
import { HANDOVER_GATE_TONE } from "@/lib/phase7";

const TAB_META = {
  ready: { label: "Ready", testId: "handover-tab-ready", params: { ready: true } },
  atrisk: { label: "At Risk", testId: "handover-tab-atrisk", params: { at_risk: true } },
  done: { label: "Executed / Closed", testId: "handover-tab-done", params: { executed: true } },
};
const TAB_ORDER = ["ready", "atrisk", "done"];

export default function HandoversPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState(() => {
    const q = new URLSearchParams(window.location.search).get("t");
    return TAB_ORDER.includes(q) ? q : "atrisk";
  });
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/handovers", { params: TAB_META[tab].params });
      setRows(r.data || []);
    } catch (e) { apiErrorToast(e); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    load();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [tab]);

  const setTabWithUrl = (next) => {
    setTab(next);
    const params = new URLSearchParams(window.location.search);
    params.set("t", next);
    window.history.replaceState(null, "", `?${params.toString()}`);
  };

  return (
    <div className="space-y-6" data-testid="handovers-page">
      <PageHeader title="Handovers" subtitle="Every handover — readiness score, gates, dates, and execution." />

      <div className="border-b border-gray-200 flex items-center gap-1">
        {TAB_ORDER.map((k) => {
          const active = tab === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => setTabWithUrl(k)}
              className={[
                "px-4 py-2 -mb-px border-b-2 text-xs font-medium",
                active ? "border-navy-900 text-navy-900" : "border-transparent text-gray-600 hover:text-gray-900",
              ].join(" ")}
              data-testid={TAB_META[k].testId}
            >
              {TAB_META[k].label}
            </button>
          );
        })}
      </div>

      <div className="rounded-md border border-gray-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="text-xs uppercase tracking-wide text-slate-600 font-semibold">
              <th className="h-9 px-3 text-left font-normal">Customer</th>
              <th className="h-9 px-3 text-left font-normal">Project · Unit</th>
              <th className="h-9 px-3 text-right font-normal">Readiness</th>
              <th className="h-9 px-3 text-left font-normal">Gate</th>
              <th className="h-9 px-3 text-left font-normal">Proposed</th>
              <th className="h-9 px-3 text-left font-normal">Final</th>
              <th className="h-9 px-3 text-left font-normal">Blockers</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? <tr><td colSpan={7} className="p-4 text-xs text-gray-500">Loading…</td></tr>
            : rows.length === 0 ? <tr><td colSpan={7} className="p-4 text-xs text-gray-500">Nothing in this bucket.</td></tr>
            : rows.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50 cursor-pointer"
                onClick={() => r._customer?.id && navigate(`/customers/${r._customer.id}?tab=handover`)}
                data-testid={`handover-row-${r.id.slice(0, 8)}`}>
                <td className="px-3 py-2">
                  {r._customer?.id ? (<><span className="font-mono text-[11px] text-gray-500 mr-1.5">{r._customer.code}</span><span className="text-sm text-gray-900">{r._customer.primary_name}</span></>) : "—"}
                </td>
                <td className="px-3 py-2 text-xs text-gray-700 font-mono">{r._project?.code || "—"} · {r._unit?.code || "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums font-medium text-gray-900">{r.readiness_score?.toFixed(1)}%</td>
                <td className="px-3 py-2"><StatusPill status={r.gate_status} tone={HANDOVER_GATE_TONE[r.gate_status] || "grey"} /></td>
                <td className="px-3 py-2 text-xs text-gray-700 tabular-nums">{r.scheduled?.proposed_date ? formatDate(r.scheduled.proposed_date) : "—"}</td>
                <td className="px-3 py-2 text-xs text-gray-700 tabular-nums">{r.scheduled?.final_date ? formatDate(r.scheduled.final_date) : "—"}</td>
                <td className="px-3 py-2 text-xs text-red-700">
                  {r.gate_blockers?.length > 0 ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-red-50 border border-red-200 px-1.5 py-0.5 text-[10px] tabular-nums" data-testid={`handover-blockers-${r.id.slice(0, 8)}`}>
                      {r.gate_blockers.length}
                    </span>
                  ) : <span className="text-emerald-700">None</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

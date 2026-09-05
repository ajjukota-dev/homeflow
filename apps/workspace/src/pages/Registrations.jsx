import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import { formatDate } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import StatusPill from "@/components/StatusPill";
import { REG_STATUS_TONE } from "@/lib/phase6";

const TAB_META = {
  month: { label: "This Month", testId: "reg-tab-month" },
  blocked: { label: "Blocked", testId: "reg-tab-blocked" },
  all: { label: "All", testId: "reg-tab-all" },
};
const TAB_ORDER = ["month", "blocked", "all"];

export default function RegistrationsPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState(() => {
    const q = new URLSearchParams(window.location.search).get("t");
    return TAB_ORDER.includes(q) ? q : "month";
  });
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState({ month: 0, blocked: 0 });

  const load = async () => {
    setLoading(true);
    try {
      const params = {};
      if (tab === "month") params.this_month = true;
      if (tab === "blocked") params.blocked = true;
      const r = await api.get("/registrations", { params });
      setRows(r.data || []);
    } catch (e) {
      apiErrorToast(e);
    } finally {
      setLoading(false);
    }
  };

  const loadCounts = async () => {
    try {
      const [m, b] = await Promise.all([
        api.get("/registrations/counts/this-month"),
        api.get("/registrations/counts/blocked"),
      ]);
      setCounts({ month: m.data?.count || 0, blocked: b.data?.count || 0 });
    } catch {
      /* handled globally */
    }
  };

  useEffect(() => {
    load();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [tab]);

  useEffect(() => {
    loadCounts();
  }, []);

  const columns = useMemo(
    () => [
      { key: "customer", label: "Customer" },
      { key: "project", label: "Project · Unit" },
      { key: "status", label: "Status" },
      { key: "sro", label: "SRO office" },
      { key: "slot", label: "Slot date" },
      ...(tab === "blocked"
        ? [{ key: "blockers", label: "Blockers" }]
        : [{ key: "ref", label: "Slot ref." }]),
      { key: "updated", label: "Updated" },
    ],
    [tab],
  );

  const setTabWithUrl = (next) => {
    setTab(next);
    const params = new URLSearchParams(window.location.search);
    params.set("t", next);
    window.history.replaceState(null, "", `?${params.toString()}`);
  };

  return (
    <div className="space-y-6" data-testid="registrations-page">
      <PageHeader
        title="Registrations"
        subtitle="Sub-registrar slots and readiness — including blockers that are stopping SRO booking."
      />

      <div className="border-b border-gray-200 flex items-center gap-1">
        {TAB_ORDER.map((k) => {
          const active = tab === k;
          const badge =
            k === "month" ? counts.month : k === "blocked" ? counts.blocked : null;
          return (
            <button
              key={k}
              type="button"
              onClick={() => setTabWithUrl(k)}
              className={[
                "px-4 py-2 -mb-px border-b-2 text-xs font-medium flex items-center gap-1.5",
                active
                  ? "border-navy-900 text-navy-900"
                  : "border-transparent text-gray-600 hover:text-gray-900",
              ].join(" ")}
              data-testid={TAB_META[k].testId}
            >
              {TAB_META[k].label}
              {badge !== null && badge > 0 && (
                <span
                  className={[
                    "text-[10px] tabular-nums rounded-full px-1.5 py-0.5",
                    k === "blocked"
                      ? active
                        ? "bg-red-600 text-white"
                        : "bg-red-100 text-red-700"
                      : active
                      ? "bg-navy-900 text-white"
                      : "bg-gray-100 text-gray-700",
                  ].join(" ")}
                >
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="rounded-md border border-gray-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="text-xs uppercase tracking-wide text-slate-600 font-semibold">
              {columns.map((c) => (
                <th key={c.key} className="h-9 px-3 text-left font-normal">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={columns.length} className="p-4 text-xs text-gray-500">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="p-4 text-xs text-gray-500">
                  {tab === "month"
                    ? "No registrations with slot date this month."
                    : tab === "blocked"
                    ? "Nothing blocked — every Not-Started registration is ready to confirm availability."
                    : "No registration records yet."}
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const blockers = [];
                if (r.readiness) {
                  if (!r.readiness.legal_ready) blockers.push("Legal");
                  if (!r.readiness.tds_ready) blockers.push("TDS");
                  if (!r.readiness.fc_ready) blockers.push("FC");
                }
                return (
                  <tr
                    key={r.id}
                    className="hover:bg-gray-50 cursor-pointer"
                    onClick={() =>
                      r._customer?.id &&
                      navigate(`/customers/${r._customer.id}?tab=registration`)
                    }
                    data-testid={`registration-row-${r.id.slice(0, 8)}`}
                  >
                    <td className="px-3 py-2">
                      {r._customer?.id ? (
                        <>
                          <span className="font-mono text-[11px] text-gray-500 mr-1.5">
                            {r._customer.code}
                          </span>
                          <span className="text-sm text-gray-900">
                            {r._customer.primary_name}
                          </span>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-700 font-mono">
                      {r._project?.code || "—"} · {r._unit?.code || "—"}
                    </td>
                    <td className="px-3 py-2">
                      <StatusPill
                        status={r.status}
                        tone={REG_STATUS_TONE[r.status] || "grey"}
                      />
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-700 truncate max-w-[180px]">
                      {r.sro_office || <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-700 tabular-nums">
                      {r.slot_date ? (
                        <>
                          {formatDate(r.slot_date)}
                          {r.slot_time ? (
                            <span className="text-[11px] text-gray-500 ml-1">
                              {r.slot_time}
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    {tab === "blocked" ? (
                      <td className="px-3 py-2">
                        {blockers.length === 0 ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700">
                            <CheckCircle2 className="h-3 w-3" /> Ready
                          </span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {blockers.map((b) => (
                              <span
                                key={b}
                                className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide rounded-full px-1.5 py-0.5 bg-red-50 text-red-700 border border-red-200"
                                data-testid={`registration-blocker-${b.toLowerCase()}`}
                              >
                                <AlertTriangle className="h-2.5 w-2.5" />
                                {b}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                    ) : (
                      <td className="px-3 py-2 text-xs text-gray-700 font-mono truncate max-w-[140px]">
                        {r.slot_reference_no || (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                    )}
                    <td className="px-3 py-2 text-xs text-gray-600 tabular-nums">
                      {r.updated_at ? formatDate(r.updated_at) : "—"}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

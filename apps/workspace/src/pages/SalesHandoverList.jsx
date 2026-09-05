import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowUpRight } from "lucide-react";

import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import StatusPill from "@/components/StatusPill";
import { HANDOVER_STATUS_TONE } from "@/lib/documents";
import { formatDate, formatDateTime } from "@/lib/format";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

const TABS = [
  { key: "all", label: "All" },
  { key: "submitted", label: "Awaiting Acceptance" },
  { key: "returned", label: "Returned" },
  { key: "accepted", label: "Accepted" },
];

export default function SalesHandoverList() {
  const location = useLocation();
  const navigate = useNavigate();
  const currentTab = useMemo(() => {
    const q = new URLSearchParams(location.search).get("t") || "all";
    return TABS.some((t) => t.key === q) ? q : "all";
  }, [location.search]);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const params = {};
        if (currentTab === "submitted") params.status = "Submitted";
        if (currentTab === "returned") params.status = "Returned";
        if (currentTab === "accepted") params.status = "Accepted";
        const r = await api.get("/sales-handovers", { params });
        if (!alive) return;
        setRows(r.data || []);
      } catch (e) {
        apiErrorToast(e);
      } finally {
        alive && setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [currentTab]);

  const setTab = (v) => {
    if (v === currentTab) return;
    const next = new URLSearchParams(location.search);
    if (v === "all") next.delete("t"); else next.set("t", v);
    navigate({ pathname: location.pathname, search: next.toString() }, { replace: true });
  };

  return (
    <div className="space-y-6" data-testid="sales-handover-list">
      <PageHeader
        title="Sales Handover"
        subtitle="Sales-to-CRM handover queue. Submitted handovers await CRM acceptance."
      />
      <Tabs value={currentTab} onValueChange={setTab}>
        <TabsList data-testid="sales-handover-tabs">
          {TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key} data-testid={`sh-tab-${t.key}`}>{t.label}</TabsTrigger>
          ))}
        </TabsList>
        {TABS.map((t) => (
          <TabsContent key={t.key} value={t.key} className="mt-4">
            <HandoverTable rows={rows} loading={loading} tabKey={t.key} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function HandoverTable({ rows, loading, tabKey }) {
  if (loading) return <div className="text-sm text-gray-500">Loading handovers…</div>;
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-10 text-center text-sm text-gray-500" data-testid={`sh-empty-${tabKey}`}>
        No handovers in this view.
      </div>
    );
  }
  return (
    <div className="rounded-md border border-gray-200 bg-white overflow-hidden" data-testid={`sh-table-${tabKey}`}>
      <table className="w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <Th>Booking</Th>
            <Th>Customer</Th>
            <Th>Project / Unit</Th>
            <Th>Status</Th>
            <Th>Submitted</Th>
            <Th>Accepted</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {rows.map((h) => (
            <tr key={h.id} className="h-11 border-t border-gray-100" data-testid={`sh-row-${h._booking?.code}`}>
              <td className="px-3 font-mono text-xs">{h._booking?.code || "—"}</td>
              <td className="px-3">
                <Link to={`/customers/${h._customer?.id}?tab=overview`} className="text-navy-900 hover:underline text-xs">
                  <span className="font-mono text-gray-500 mr-1">{h._customer?.code}</span>
                  {h._customer?.primary_name}
                </Link>
              </td>
              <td className="px-3 text-sm text-gray-700 truncate max-w-[240px]">
                {h._project?.name || "—"} <span className="text-gray-400 mx-1">·</span> <span className="font-mono">{h._unit?.code}</span>
              </td>
              <td className="px-3"><StatusPill status={h.status} tone={HANDOVER_STATUS_TONE[h.status]} /></td>
              <td className="px-3 text-sm text-gray-600">{h.submitted_at ? formatDate(h.submitted_at) : "—"}</td>
              <td className="px-3 text-sm text-gray-600">{h.accepted_at ? formatDate(h.accepted_at) : "—"}</td>
              <td className="px-3">
                <Link to={`/sales-handover/${h.booking_id}`} className="text-xs text-navy-900 hover:underline inline-flex items-center gap-1" data-testid={`sh-open-${h._booking?.code}`}>
                  Open <ArrowUpRight className="h-3 w-3" />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children }) {
  return <th className="h-9 px-3 text-left text-xs uppercase tracking-wide text-slate-600 font-semibold">{children}</th>;
}

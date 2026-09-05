import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowUpRight, Users2, AlertOctagon } from "lucide-react";

import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import StatusPill from "@/components/StatusPill";
import { JOURNEY_STATUS_TONE, RISK_TONE } from "@/lib/journey";
import { stageColorForName } from "@/lib/stageColors";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

const TABS = [
  { key: "all", label: "All" },
  { key: "my", label: "My" },
  { key: "new", label: "New Bookings" },
  { key: "atrisk", label: "At Risk" },
  { key: "escalated", label: "Escalated" },
];

export default function CustomerJourneys() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const currentTab = useMemo(() => {
    const q = new URLSearchParams(location.search).get("t") || "all";
    return TABS.some((t) => t.key === q) ? q : "all";
  }, [location.search]);

  const [journeys, setJourneys] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const params = {};
        if (currentTab === "new") params.stage_status = "new_bookings";
        if (currentTab === "atrisk") params.risk = "High";
        const r = await api.get(`/journeys`, { params });
        if (!alive) return;
        setJourneys(r.data || []);
      } catch (e) {
        apiErrorToast(e);
      } finally {
        alive && setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [currentTab]);

  const filtered = useMemo(() => {
    if (currentTab === "my") {
      return journeys.filter(
        (j) => j.sales_owner_id === user?.id || j.crm_owner_id === user?.id,
      );
    }
    return journeys;
  }, [journeys, currentTab, user]);

  const setTab = (v) => {
    if (v === currentTab) return;
    const next = new URLSearchParams(location.search);
    if (v === "all") next.delete("t"); else next.set("t", v);
    navigate({ pathname: location.pathname, search: next.toString() }, { replace: true });
  };

  return (
    <div className="space-y-6" data-testid="customer-journeys-page">
      <PageHeader
        title="Customer Journeys"
        subtitle="Every confirmed booking becomes a journey with 8 stages, 12+ tasks and full audit trail."
      />

      <Tabs value={currentTab} onValueChange={setTab}>
        <TabsList data-testid="customer-journeys-tabs">
          {TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key} data-testid={`journeys-tab-${t.key}`}>{t.label}</TabsTrigger>
          ))}
        </TabsList>

        {TABS.map((t) => (
          <TabsContent key={t.key} value={t.key} className="mt-4">
            {t.key === "escalated" ? (
              <EscalatedPlaceholder />
            ) : (
              <JourneyTable journeys={filtered} loading={loading} tabKey={t.key} />
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function JourneyTable({ journeys, loading, tabKey }) {
  if (loading) return <div className="text-sm text-gray-500">Loading journeys…</div>;
  if (journeys.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-10 text-center text-sm text-gray-500" data-testid={`journeys-empty-${tabKey}`}>
        No journeys in this view.
      </div>
    );
  }
  return (
    <div className="rounded-md border border-gray-200 bg-white overflow-hidden" data-testid={`journeys-table-${tabKey}`}>
      <table className="w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <Th>Customer</Th>
            <Th>Project</Th>
            <Th>Unit</Th>
            <Th>Current stage</Th>
            <Th right>Progress</Th>
            <Th>Status</Th>
            <Th>Risk</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {journeys.map((j) => (
            <tr key={j.id} className="h-11 border-t border-gray-100" data-testid={`journey-row-${j.id}`}>
              <td className="px-3">
                <Link
                  to={`/customers/${j.customer?.id}?tab=journey`}
                  className="text-navy-900 hover:underline text-sm"
                  data-testid={`journey-row-customer-${j.customer?.code}`}
                >
                  <span className="font-mono text-[11px] text-gray-500 mr-2">{j.customer?.code}</span>
                  {j.customer?.primary_name || "—"}
                </Link>
              </td>
              <td className="px-3 text-sm text-gray-700">{j.project?.name || "—"}</td>
              <td className="px-3 font-mono text-[11px] text-gray-600">{j.unit?.code || "—"}</td>
              <td className="px-3 text-sm truncate max-w-[240px]">
                {j.current_stage?.name ? (() => {
                  const sc = stageColorForName(j.current_stage.name);
                  return (
                    <span
                      className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-semibold text-white"
                      style={{ background: sc.bg }}
                      data-testid={`journey-current-stage-${j.id}`}
                    >
                      {j.current_stage.name}
                    </span>
                  );
                })() : (
                  <span className="text-slate-500">—</span>
                )}
                {j.current_subprocess?.name && (
                  <span className="text-slate-400 ml-1"> · {j.current_subprocess.name}</span>
                )}
              </td>
              <td className="px-3 text-right tabular-nums text-sm">{(j.journey_percentage || 0).toFixed(0)}%</td>
              <td className="px-3"><StatusPill status={j.status} tone={JOURNEY_STATUS_TONE[j.status]} /></td>
              <td className="px-3"><StatusPill status={j.risk_level || "Low"} tone={RISK_TONE[j.risk_level] || "grey"} /></td>
              <td className="px-3">
                <Link
                  to={`/customers/${j.customer?.id}?tab=journey`}
                  className="text-xs text-navy-900 hover:underline inline-flex items-center gap-1"
                >
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

function EscalatedPlaceholder() {
  return (
    <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-10 flex flex-col items-center text-center" data-testid="journeys-escalated-placeholder">
      <div className="h-12 w-12 rounded-full bg-amber-50 text-amber-700 flex items-center justify-center mb-3">
        <AlertOctagon className="h-5 w-5" />
      </div>
      <div className="font-heading text-base font-semibold text-gray-900">Escalations arrive in Phase 8</div>
      <div className="text-xs text-gray-500 max-w-md mt-1">
        The escalation rules engine (age-based SLA, ownership drift, missed handover) is scoped for a later phase. Journeys will surface here once escalation rules are configured.
      </div>
    </div>
  );
}

function Th({ children, right }) {
  return (
    <th
      className={[
        "h-9 px-3 text-xs uppercase tracking-wide text-slate-600 font-semibold",
        right ? "text-right" : "text-left",
      ].join(" ")}
    >
      {children}
    </th>
  );
}

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  IndianRupee, ShieldAlert, KeyRound, Siren, Handshake, CheckCircle2, ArrowRight, Activity, TrendingUp,
} from "lucide-react";

import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import { formatINR } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import { ESC_SEVERITY_TONE } from "@/lib/phase8";
import StatusPill from "@/components/StatusPill";

const SEV_ICON = { Critical: ShieldAlert, High: Siren, Medium: Activity, Low: CheckCircle2 };

export default function ExecDashboard() {
  const [summary, setSummary] = useState(null);
  const [exceptions, setExceptions] = useState([]);
  const [forecast, setForecast] = useState({ 30: [], 60: [], 90: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [s, ex, f30, f60, f90] = await Promise.all([
          api.get("/exec-dashboard/summary"),
          api.get("/exec-dashboard/exceptions"),
          api.get("/reports/handover-forecast", { params: { window: 30 } }),
          api.get("/reports/handover-forecast", { params: { window: 60 } }),
          api.get("/reports/handover-forecast", { params: { window: 90 } }),
        ]);
        if (cancelled) return;
        setSummary(s.data);
        setExceptions(ex.data || []);
        setForecast({ 30: f30.data || [], 60: (f60.data || []).filter((r) => !(f30.data || []).some((a) => a.unit === r.unit && a.customer_code === r.customer_code)), 90: (f90.data || []).filter((r) => !(f60.data || []).some((a) => a.unit === r.unit && a.customer_code === r.customer_code)) });
      } catch (e) { apiErrorToast(e); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading || !summary) return <div className="p-6 text-xs text-gray-500">Loading exec dashboard…</div>;

  const m = summary;

  return (
    <div className="space-y-6" data-testid="exec-dashboard">
      <PageHeader title="Executive dashboard" subtitle="What's on fire, what's earning, and what's coming — one page." />

      {/* 6 headline metrics */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <ExecCard label="Active Journeys" value={m.active_journeys} icon={Handshake} tone="positive" testId="exec-active-journeys" />
        <ExecCard label="Handovers Ready This Month" value={m.handovers_ready_this_month} icon={KeyRound} tone="positive" testId="exec-ho-ready-month" />
        <ExecCard label="Handovers At Risk (30d)" value={m.handovers_at_risk_30d} icon={ShieldAlert} tone="risk" testId="exec-ho-atrisk-30d" />
        <ExecCard label="Revenue at Risk" value={formatINR(m.revenue_at_risk_inr || 0)} icon={IndianRupee} tone="risk" testId="exec-revenue-risk" />
        <ExecCard label="Critical Escalations Open" value={m.escalations_open_critical} icon={Siren} tone="risk" testId="exec-esc-critical" />
        <ExecCard label="Broken Commitments Overdue" value={m.broken_commitments_overdue} icon={Activity} tone="risk" testId="exec-commit-overdue" />
      </div>

      {/* Exceptions panel */}
      <div className="rounded-md border border-gray-200 bg-white" data-testid="exec-exceptions-panel">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <div className="text-sm font-medium text-gray-900">Management exception queue</div>
          <div className="text-[11px] text-gray-500 tabular-nums">{exceptions.length} items</div>
        </div>
        <div className="max-h-[320px] overflow-y-auto divide-y divide-gray-100">
          {exceptions.length === 0
            ? <div className="p-4 text-xs text-gray-500">Nothing flagged. Steady state.</div>
            : exceptions.map((ex, i) => {
              const Icon = SEV_ICON[ex.severity] || Activity;
              return (
                <Link key={i} to={ex.customer_id ? `/customers/${ex.customer_id}` : "#"} className="flex items-start gap-3 px-4 py-2.5 hover:bg-gray-50" data-testid={`exec-exception-${i}`}>
                  <Icon className={"h-3.5 w-3.5 mt-0.5 shrink-0 " + (ex.severity === "Critical" ? "text-rose-600" : ex.severity === "High" ? "text-red-600" : ex.severity === "Medium" ? "text-amber-600" : "text-gray-500")} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-900 truncate">{ex.title}</div>
                    <div className="text-[11px] text-gray-500 truncate">{ex.customer_code ? `${ex.customer_code} · ${ex.customer_name}` : "System"}{" · "}{ex.type}{" · "}{ex.age_days}d</div>
                  </div>
                  <StatusPill status={ex.severity} tone={ESC_SEVERITY_TONE[ex.severity] || "grey"} />
                </Link>
              );
            })}
        </div>
      </div>

      {/* 30 / 60 / 90 forecast strip */}
      <div className="grid md:grid-cols-3 gap-3" data-testid="exec-forecast-strip">
        {[30, 60, 90].map((w) => (
          <div key={w} className="rounded-md border border-gray-200 bg-white">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <div className="text-sm font-medium text-gray-900">{w}-day handover forecast</div>
              <Link to={`/reports?report=handover-forecast&window=${w}`} className="text-[11px] text-navy-900 hover:underline inline-flex items-center gap-0.5">View <ArrowRight className="h-3 w-3" /></Link>
            </div>
            <div className="divide-y divide-gray-100 max-h-[220px] overflow-y-auto">
              {forecast[w].length === 0 ? <div className="p-3 text-[11px] text-gray-500">No handovers in this window.</div>
              : forecast[w].slice(0, 6).map((r, i) => (
                <div key={i} className="px-4 py-2 text-xs flex items-center gap-2">
                  <span className="tabular-nums text-gray-600">{r.planned_handover}</span>
                  <span className="flex-1 text-gray-900 truncate">{r.customer_name}</span>
                  <span className={"rounded-full px-1.5 py-0.5 text-[10px] " + (r.gate_status === "Green" ? "bg-emerald-50 text-emerald-700" : r.gate_status === "Amber" ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700")}>{r.gate_status}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Bottleneck stages */}
      <div className="rounded-md border border-gray-200 bg-white" data-testid="exec-bottlenecks">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-navy-900" />
          <div className="text-sm font-medium text-gray-900">Bottleneck stages</div>
          <div className="text-[11px] text-gray-500">Median cycle time — completed stages</div>
        </div>
        <div className="p-4 space-y-2">
          {m.top_5_bottleneck_stages.length === 0 ? <div className="text-[11px] text-gray-500">Not enough completed stages yet.</div>
          : m.top_5_bottleneck_stages.map((b, i) => {
            const maxDays = Math.max(...m.top_5_bottleneck_stages.map((x) => x.median_cycle_days)) || 1;
            const w = (b.median_cycle_days / maxDays) * 100;
            return (
              <div key={i} className="text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-gray-900">{b.stage}</span>
                  <span className="text-gray-600 tabular-nums">{b.median_cycle_days}d <span className="text-gray-400">(n={b.n})</span></span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mt-1">
                  <div className="h-full bg-navy-900" style={{ width: `${w}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ExecCard({ label, value, icon: Icon, tone = "neutral", testId }) {
  // Map legacy → new tokens
  const t =
    tone === "danger" ? "risk" :
    tone === "warning" ? "attention" :
    tone === "info" ? "neutral" :
    tone === "default" ? "neutral" :
    tone === "positive" || tone === "attention" || tone === "risk" || tone === "neutral" ? tone :
    "neutral";

  const bg =
    t === "risk" ? "bg-red-50" :
    t === "attention" ? "bg-amber-50" :
    t === "positive" ? "bg-green-50" :
    "bg-blue-50";

  const stripe =
    t === "risk" ? "bg-red-500" :
    t === "attention" ? "bg-amber-500" :
    t === "positive" ? "bg-green-500" :
    "bg-blue-500";

  const iconTone =
    t === "risk" ? "text-red-600" :
    t === "attention" ? "text-amber-600" :
    t === "positive" ? "text-green-600" :
    "text-blue-600";

  return (
    <div
      className={`relative overflow-hidden rounded-xl border border-warm-100 ${bg} pt-4 pl-4 pr-4 pb-3.5`}
      style={{ boxShadow: "0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)" }}
      data-testid={testId}
    >
      <span aria-hidden className={`absolute left-0 top-0 bottom-0 w-1 ${stripe}`} />
      <div className="flex items-center justify-between text-[11px] uppercase tracking-wider font-semibold text-slate-500">
        <span>{label}</span>
        <Icon className={`h-4 w-4 ${iconTone}`} />
      </div>
      <div className="font-heading text-4xl leading-[1.1] font-bold text-slate-900 tabular-nums mt-2">{value}</div>
    </div>
  );
}

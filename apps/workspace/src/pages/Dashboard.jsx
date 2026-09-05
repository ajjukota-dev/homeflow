import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  ArrowRight,
  Users2,
  Building2,
  ClipboardList,
  LayoutGrid,
  Route as RouteIcon,
  AlertCircle,
  Clock,
  ShieldCheck,
  BadgeCheck,
  KeyRound,
  Zap,
  Handshake,
  FileText,
  IndianRupee,
  Receipt,
  Landmark,
  Banknote,
  Scale,
  FileSignature,
  ShieldAlert,
  ClipboardCheck,
  Siren,
  MessageCircle,
} from "lucide-react";

import { api } from "@/lib/api";
import { useAuth, isSuperAdmin } from "@/lib/auth";
import { formatINR, formatDate } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import StatusPill from "@/components/StatusPill";
import { stageColorForName } from "@/lib/stageColors";

const STAGE_COLORS = [
  "bg-navy-700",
  "bg-blue-600",
  "bg-cyan-600",
  "bg-teal-600",
  "bg-emerald-600",
  "bg-amber-600",
  "bg-orange-600",
  "bg-rose-600",
];

function StatCard({ label, value, sub, icon: Icon, to, tone = "neutral", testId, sublinkLabel = "View" }) {
  // Map legacy tone names → new theme tokens (positive | neutral | attention | risk)
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

  const inner = (
    <div
      className={`relative overflow-hidden rounded-xl border border-warm-100 ${bg} pt-4 pl-4 pr-4 pb-3.5 transition-shadow hover:shadow-md`}
      style={{ boxShadow: "0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)" }}
      data-testid={testId}
    >
      <span aria-hidden className={`absolute left-0 top-0 bottom-0 w-1 ${stripe}`} />
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">{label}</div>
        {Icon && <Icon className={`h-4 w-4 ${iconTone}`} />}
      </div>
      <div className="font-heading text-4xl leading-[1.1] font-bold text-slate-900 mt-2 tabular-nums">{value}</div>
      <div className="mt-1.5 flex items-center justify-between">
        <div className="text-xs text-slate-500 truncate">{sub || ""}</div>
        {to && (
          <span className="text-[11px] font-medium inline-flex items-center gap-0.5" style={{ color: "var(--brand)" }}>
            {sublinkLabel} <ArrowRight className="h-3 w-3" />
          </span>
        )}
      </div>
    </div>
  );
  return to ? <Link to={to} className="block">{inner}</Link> : inner;
}

export default function Dashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [bookings, setBookings] = useState([]);
  const [projects, setProjects] = useState([]);
  const [journeys, setJourneys] = useState([]);
  const [taskCounts, setTaskCounts] = useState({ overdue: 0, awaiting_verification: 0, awaiting_approval: 0 });
  const [phase4Counts, setPhase4Counts] = useState({ commitments_overdue: 0, documents_pending: 0, handovers_awaiting: 0 });
  const [phase5, setPhase5] = useState({
    total_overdue_inr: 0,
    bookings_with_overdue: 0,
    tds_pending_verification: 0,
    financial_clearances_pending: 0,
    due_this_week: 0,
    overdue_30: 0,
  });
  const [phase6, setPhase6] = useState({
    loans_awaiting_sanction: 0,
    loans_pending_disbursement: 0,
    legal_pending_approval: 0,
    registrations_this_month: 0,
    registrations_blocked: 0,
  });
  const [phase7, setPhase7] = useState({
    snags_critical_open: 0,
    snags_awaiting_verification: 0,
    ur_near_ready: 0,
    handovers_ready_month: 0,
    handovers_at_risk: 0,
  });
  const [phase8, setPhase8] = useState({
    escalations_by_severity: { Low: 0, Medium: 0, High: 0, Critical: 0 },
    escalations_open_total: 0,
    followups_overdue: 0,
  });

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const [pRes, uRes, cRes, bRes, jRes, tcRes, coRes, dpRes, haRes, cdRes, cdw, co30, lAS, lPD, lgPA, rTM, rBK, sCO, sAV, urNR, hRM, hAR, eCnt, fuO] = await Promise.all([
          api.get("/projects"),
          api.get("/units"),
          api.get("/customers"),
          api.get("/bookings"),
          api.get("/journeys", { params: { status: "Active" } }),
          api.get("/tasks/counts"),
          api.get("/commitments/counts/overdue"),
          api.get("/documents/counts/pending-verification"),
          api.get("/sales-handovers/counts/awaiting-acceptance"),
          api.get("/collections/dashboard"),
          api.get("/collections/counts/due-this-week"),
          api.get("/collections/counts/overdue-30"),
          api.get("/loans/counts/awaiting-sanction"),
          api.get("/loans/counts/pending-disbursement"),
          api.get("/legal/counts/pending-approval"),
          api.get("/registrations/counts/this-month"),
          api.get("/registrations/counts/blocked"),
          api.get("/snags/counts/critical-open"),
          api.get("/snags/counts/awaiting-verification"),
          api.get("/unit-readiness/counts/near-ready"),
          api.get("/handovers/counts/ready-this-month"),
          api.get("/handovers/counts/at-risk"),
          api.get("/escalations/counts"),
          api.get("/communications/counts/followups-overdue"),
        ]);
        if (cancelled) return;
        setProjects(pRes.data);
        setJourneys(jRes.data || []);
        setTaskCounts(tcRes.data || { overdue: 0, awaiting_verification: 0, awaiting_approval: 0 });
        setPhase4Counts({
          commitments_overdue: coRes.data?.count || 0,
          documents_pending: dpRes.data?.count || 0,
          handovers_awaiting: haRes.data?.count || 0,
        });
        setPhase5({
          total_overdue_inr: cdRes.data?.total_overdue_inr || 0,
          bookings_with_overdue: cdRes.data?.bookings_with_overdue || 0,
          tds_pending_verification: cdRes.data?.tds_pending_verification || 0,
          financial_clearances_pending: cdRes.data?.financial_clearances_pending || 0,
          due_this_week: cdw.data?.count || 0,
          overdue_30: co30.data?.count || 0,
        });
        setPhase6({
          loans_awaiting_sanction: lAS.data?.count || 0,
          loans_pending_disbursement: lPD.data?.count || 0,
          legal_pending_approval: lgPA.data?.count || 0,
          registrations_this_month: rTM.data?.count || 0,
          registrations_blocked: rBK.data?.count || 0,
        });
        setPhase7({
          snags_critical_open: sCO.data?.count || 0,
          snags_awaiting_verification: sAV.data?.count || 0,
          ur_near_ready: urNR.data?.count || 0,
          handovers_ready_month: hRM.data?.count || 0,
          handovers_at_risk: hAR.data?.count || 0,
        });
        setPhase8({
          escalations_by_severity: eCnt.data?.by_severity || { Low: 0, Medium: 0, High: 0, Critical: 0 },
          escalations_open_total: eCnt.data?.open_total || 0,
          followups_overdue: fuO.data?.count || 0,
        });

        // New bookings this month
        const now = new Date();
        const thisMonth = (bRes.data || []).filter((b) => {
          if (!b.booking_date) return false;
          const d = new Date(b.booking_date);
          return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        }).length;

        // Expected handover in 30 days
        const in30 = (jRes.data || []).filter((j) => {
          if (!j.expected_handover_date) return false;
          const d = new Date(j.expected_handover_date);
          const diff = (d - now) / (1000 * 60 * 60 * 24);
          return diff >= 0 && diff <= 30;
        }).length;

        setStats({
          projects: pRes.data.length,
          units: uRes.data.length,
          available: uRes.data.filter((x) => x.status === "Available").length,
          booked: uRes.data.filter((x) => x.status === "Booked").length,
          registered: uRes.data.filter((x) => x.status === "Registered").length,
          handed: uRes.data.filter((x) => x.status === "Handed Over").length,
          customers: cRes.data.length,
          bookings: bRes.data.length,
          confirmed: bRes.data.filter((x) => x.status === "Confirmed").length,
          draft: bRes.data.filter((x) => x.status === "Draft").length,
          cancelled: bRes.data.filter((x) => x.status === "Cancelled").length,
          activeJourneys: (jRes.data || []).length,
          newBookingsThisMonth: thisMonth,
          handoverIn30: in30,
          agreementTotal: bRes.data
            .filter((x) => x.status !== "Cancelled")
            .reduce((s, x) => s + (x.agreement_value_inr || 0), 0),
        });
        setBookings(bRes.data.slice(0, 6));
      } catch {
        /* handled globally */
      }
    };
    run();
    return () => { cancelled = true; };
  }, []);

  const byStage = useMemo(() => {
    const buckets = {};
    for (const j of journeys) {
      const name = j.current_stage?.name || "—";
      buckets[name] = (buckets[name] || 0) + 1;
    }
    const total = Object.values(buckets).reduce((s, v) => s + v, 0) || 1;
    return { buckets, total };
  }, [journeys]);

  return (
    <div className="space-y-6" data-testid="dashboard-page">
      <PageHeader
        title={`Good day, ${user?.name?.split(" ")[0] || "there"}.`}
        subtitle={`${user?.role?.name} · ${user?.department?.name || "—"}`}
      />

      {!stats ? (
        <div className="text-sm text-gray-500">Loading…</div>
      ) : (
        <>
          {/* Phase 3: 6 KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatCard
              label="Active Journeys"
              value={stats.activeJourneys}
              sub="Live customer flows"
              icon={RouteIcon}
              to="/customer-journeys"
              tone="positive"
              testId="stat-active-journeys"
            />
            <StatCard
              label="New Bookings"
              value={stats.newBookingsThisMonth}
              sub="This month"
              icon={ClipboardList}
              to="/customer-journeys?t=new"
              tone="neutral"
              testId="stat-new-bookings"
            />
            <StatCard
              label="Overdue Tasks"
              value={taskCounts.overdue}
              sub="Past SLA"
              icon={AlertCircle}
              to="/tasks?t=overdue"
              tone="risk"
              testId="stat-overdue-tasks"
            />
            <StatCard
              label="Awaiting Verification"
              value={taskCounts.awaiting_verification}
              sub="Evidence to review"
              icon={ShieldCheck}
              to="/tasks?t=queue"
              tone="attention"
              testId="stat-awaiting-verification"
            />
            <StatCard
              label="Awaiting Approval"
              value={taskCounts.awaiting_approval}
              sub="Needs sign-off"
              icon={BadgeCheck}
              to="/tasks?t=approvals"
              tone="attention"
              testId="stat-awaiting-approval"
            />
            <StatCard
              label="Handover in 30d"
              value={stats.handoverIn30}
              sub="Expected"
              icon={KeyRound}
              to="/customer-journeys"
              tone="neutral"
              testId="stat-handover-30d"
            />
          </div>

          {/* Phase 4: three additional Sales/CRM cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <StatCard
              label="Commitments Overdue"
              value={phase4Counts.commitments_overdue}
              sub="Past target date"
              icon={AlertCircle}
              to="/commitments?t=overdue"
              tone="risk"
              testId="stat-commitments-overdue"
            />
            <StatCard
              label="Documents Pending Verification"
              value={phase4Counts.documents_pending}
              sub="Received / Under Review"
              icon={FileText}
              to="/documents?status=Under Review"
              tone="attention"
              testId="stat-documents-pending"
            />
            <StatCard
              label="Handovers Awaiting CRM"
              value={phase4Counts.handovers_awaiting}
              sub="Submitted, needs acceptance"
              icon={Handshake}
              to="/sales-handover?t=submitted"
              tone="attention"
              testId="stat-handovers-awaiting"
            />
          </div>

          {/* Phase 5: four Collections cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              label="Overdue Payments"
              value={formatINR(phase5.total_overdue_inr)}
              sub={`${phase5.bookings_with_overdue} booking${phase5.bookings_with_overdue === 1 ? "" : "s"} · ${phase5.overdue_30} milestone${phase5.overdue_30 === 1 ? "" : "s"} 30d+`}
              icon={AlertCircle}
              to="/collections?t=ageing"
              tone="risk"
              testId="stat-overdue-payments"
            />
            <StatCard
              label="Due This Week"
              value={phase5.due_this_week}
              sub="Milestones coming due"
              icon={Clock}
              to="/collections"
              tone="attention"
              testId="stat-due-this-week"
            />
            <StatCard
              label="TDS Pending"
              value={phase5.tds_pending_verification}
              sub="Applicable & awaiting verify"
              icon={Receipt}
              to="/collections"
              tone="attention"
              testId="stat-tds-pending"
            />
            <StatCard
              label="Financial Clearances Pending"
              value={phase5.financial_clearances_pending}
              sub="Blocking Registration"
              icon={IndianRupee}
              to="/collections"
              tone="attention"
              testId="stat-fc-pending"
            />
          </div>

          {/* Phase 6: four Loan / Legal / Registration cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              label="Loans Awaiting Sanction"
              value={phase6.loans_awaiting_sanction}
              sub="Application / Sanction Pending"
              icon={Landmark}
              to="/loans?t=awaiting-sanction"
              tone="neutral"
              testId="stat-loans-awaiting-sanction"
            />
            <StatCard
              label="Loans Pending Disbursement"
              value={phase6.loans_pending_disbursement}
              sub="Sanctioned but not fully paid"
              icon={Banknote}
              to="/loans?t=pending-disbursement"
              tone="attention"
              testId="stat-loans-pending-disbursement"
            />
            <StatCard
              label="Legal Pending Approval"
              value={phase6.legal_pending_approval}
              sub="Under review / deviations"
              icon={Scale}
              to="/legal"
              tone="attention"
              testId="stat-legal-pending-approval"
            />
            <StatCard
              label="Registrations This Month"
              value={phase6.registrations_this_month}
              sub={
                phase6.registrations_blocked > 0
                  ? `${phase6.registrations_blocked} blocked`
                  : "SRO slots this month"
              }
              icon={FileSignature}
              to="/registrations?t=month"
              tone={phase6.registrations_blocked > 0 ? "attention" : "neutral"}
              testId="stat-registrations-this-month"
            />
          </div>

          {/* Phase 7: five Snagging / Readiness / Handover cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <StatCard
              label="Snags — Critical Open"
              value={phase7.snags_critical_open}
              sub="Blocks Handover"
              icon={ShieldAlert}
              to="/snagging?severity=Critical"
              tone="risk"
              testId="stat-snags-critical-open"
            />
            <StatCard
              label="Snags — Awaiting Verification"
              value={phase7.snags_awaiting_verification}
              sub="Needs QA sign-off"
              icon={ClipboardCheck}
              to="/snagging?status=Ready+for+Verification"
              tone="attention"
              testId="stat-snags-awaiting-verification"
            />
            <StatCard
              label="UR ≥ 85% Not Declared"
              value={phase7.ur_near_ready}
              sub="Close to Ready-for-QA"
              icon={Building2}
              to="/unit-readiness"
              tone="attention"
              testId="stat-ur-near-ready"
            />
            <StatCard
              label="Handovers Ready This Month"
              value={phase7.handovers_ready_month}
              sub="Gate=Green + final date in month"
              icon={KeyRound}
              to="/handovers?t=ready"
              tone="positive"
              testId="stat-handovers-ready-month"
            />
            <StatCard
              label="Handovers At Risk"
              value={phase7.handovers_at_risk}
              sub="Amber/Red · next 30d"
              icon={ShieldAlert}
              to="/handovers?t=atrisk"
              tone="risk"
              testId="stat-handovers-at-risk"
            />
          </div>

          {/* Phase 8: Escalations + Communications */}
          <div className="grid grid-cols-2 md:grid-cols-2 gap-3">
            <Link
              to="/escalations?t=open"
              className="relative overflow-hidden rounded-xl border border-warm-100 bg-red-50 pt-4 pl-4 pr-4 pb-3.5 block transition-shadow hover:shadow-md"
              style={{ boxShadow: "0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)" }}
              data-testid="stat-escalations-open"
            >
              <span aria-hidden className="absolute left-0 top-0 bottom-0 w-1 bg-red-500" />
              <div className="flex items-center justify-between text-[11px] uppercase tracking-wider font-semibold text-slate-500">
                <span>Escalations — Open</span>
                <Siren className="h-4 w-4 text-red-600" />
              </div>
              <div className="flex items-center gap-2 mt-2">
                <div className="font-heading text-4xl leading-[1.1] font-bold text-slate-900 tabular-nums">{phase8.escalations_open_total}</div>
                <div className="flex-1 flex items-center h-3 rounded-full overflow-hidden bg-white/70 min-w-[60px]">
                  {phase8.escalations_open_total > 0 && ["Critical", "High", "Medium", "Low"].map((k) => {
                    const v = phase8.escalations_by_severity[k] || 0;
                    if (!v) return null;
                    const cls = k === "Critical" ? "bg-rose-600" : k === "High" ? "bg-red-500" : k === "Medium" ? "bg-amber-500" : "bg-slate-400";
                    const w = (v / phase8.escalations_open_total) * 100;
                    return <div key={k} className={cls} style={{ width: `${w}%`, height: "100%" }} title={`${k}: ${v}`} />;
                  })}
                </div>
              </div>
              <div className="text-[11px] text-slate-500 mt-1.5 tabular-nums flex flex-wrap gap-x-2">
                <span>Cri {phase8.escalations_by_severity.Critical}</span>
                <span>Hi {phase8.escalations_by_severity.High}</span>
                <span>Med {phase8.escalations_by_severity.Medium}</span>
                <span>Lo {phase8.escalations_by_severity.Low}</span>
              </div>
            </Link>
            <StatCard
              label="Follow-ups Overdue"
              value={phase8.followups_overdue}
              sub="Communications past their date"
              icon={MessageCircle}
              to="/communications?followup=1"
              tone="risk"
              testId="stat-followups-overdue"
            />
          </div>

          {/* Journeys by stage strip */}
          <div className="rounded-md border border-gray-200 bg-white p-4" data-testid="journeys-by-stage">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-sm font-medium text-gray-900 flex items-center gap-1.5">
                  <Zap className="h-4 w-4 text-amber-500" /> Journeys by stage
                </div>
                <div className="text-xs text-gray-500">Where each active journey currently sits</div>
              </div>
              <div className="text-[11px] text-gray-500 tabular-nums">
                Total: <span className="font-medium text-gray-900">{stats.activeJourneys}</span>
              </div>
            </div>
            {stats.activeJourneys === 0 ? (
              <div className="text-xs text-gray-500 py-3">No active journeys yet. Confirm a Draft booking to instantiate one.</div>
            ) : (
              <>
                <div className="flex h-2 rounded-full overflow-hidden bg-warm-100">
                  {Object.entries(byStage.buckets).map(([name, count]) => {
                    const c = stageColorForName(name);
                    return (
                      <div
                        key={name}
                        style={{ width: `${(count * 100) / byStage.total}%`, background: c.bg }}
                        title={`${name}: ${count}`}
                      />
                    );
                  })}
                </div>
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
                  {Object.entries(byStage.buckets).map(([name, count]) => {
                    const c = stageColorForName(name);
                    return (
                      <div
                        key={name}
                        className="rounded-lg overflow-hidden border border-warm-100 bg-white flex flex-col"
                        data-testid={`byStage-${name}`}
                      >
                        {/* Saturated stage header — white text */}
                        <div
                          className="px-2 py-1.5 text-[11px] font-semibold truncate text-white"
                          style={{ background: c.bg }}
                          title={name}
                        >
                          {name}
                        </div>
                        <div className="px-2 py-2 font-heading text-2xl font-bold text-slate-900 tabular-nums">
                          {count}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* Master-data mini-stats (kept from Phase 1) */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Projects" value={stats.projects} sub={`${projects.filter((p) => p.status === "Active").length} active`} icon={Building2} testId="stat-projects" />
            <StatCard label="Units" value={stats.units} sub={`${stats.available} available · ${stats.booked} booked`} icon={LayoutGrid} testId="stat-units" />
            <StatCard label="Customers" value={stats.customers} sub="With applicants" icon={Users2} testId="stat-customers" />
            <StatCard label="Bookings" value={stats.bookings} sub={`${stats.confirmed} confirmed · ${stats.draft} draft`} icon={ClipboardList} testId="stat-bookings" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 rounded-md border border-gray-200 bg-white" data-testid="dashboard-recent-bookings">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                <div>
                  <div className="text-sm font-medium text-gray-900">Recent bookings</div>
                  <div className="text-xs text-gray-500">Top 6 by creation</div>
                </div>
                {isSuperAdmin(user) && (
                  <Link to="/admin/bookings" className="text-xs font-medium text-navy-900 hover:underline flex items-center gap-1">
                    Open bookings <ArrowUpRight className="h-3.5 w-3.5" />
                  </Link>
                )}
              </div>
              <div className="divide-y divide-gray-100">
                {bookings.length === 0 && <div className="p-4 text-sm text-gray-500">No bookings yet.</div>}
                {bookings.map((b) => (
                  <div key={b.id} className="flex items-center justify-between px-4 py-2.5" data-testid={`dashboard-booking-${b.code}`}>
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="font-mono text-[11px] text-gray-500 w-24 shrink-0">{b.code}</div>
                      <div className="min-w-0">
                        <div className="text-sm text-gray-900 truncate">{formatINR(b.agreement_value_inr)}</div>
                        <div className="text-[11px] text-gray-500 truncate">Booking amount {formatINR(b.booking_amount_inr)}</div>
                      </div>
                    </div>
                    <StatusPill status={b.status} testId={`dashboard-booking-status-${b.code}`} />
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-md border border-gray-200 bg-white" data-testid="dashboard-pipeline">
              <div className="px-4 py-3 border-b border-gray-100">
                <div className="text-sm font-medium text-gray-900">Unit pipeline</div>
                <div className="text-xs text-gray-500">Across all projects</div>
              </div>
              <dl className="p-4 space-y-2 text-sm">
                <PipelineRow label="Available" value={stats.available} tone="grey" />
                <PipelineRow label="Booked" value={stats.booked} tone="blue" />
                <PipelineRow label="Registered" value={stats.registered} tone="purple" />
                <PipelineRow label="Handed Over" value={stats.handed} tone="green" />
                <div className="pt-2 mt-2 border-t border-gray-100 flex items-baseline justify-between">
                  <dt className="text-xs uppercase text-gray-500">Booked agreement value</dt>
                  <dd className="font-heading text-base font-semibold text-gray-900">{formatINR(stats.agreementTotal)}</dd>
                </div>
              </dl>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function PipelineRow({ label, value, tone }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <StatusPill status={label} tone={tone} />
      </div>
      <div className="font-heading text-sm font-semibold text-gray-900 tabular-nums">{value}</div>
    </div>
  );
}

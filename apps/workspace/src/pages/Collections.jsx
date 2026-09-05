import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  IndianRupee,
  AlertOctagon,
  TrendingUp,
  Receipt,
  Clock,
  FileText,
} from "lucide-react";

import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import { formatDate, formatINR } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import StatusPill from "@/components/StatusPill";
import RestrictedField from "@/components/rbac/RestrictedField";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AGEING_BUCKETS, MILESTONE_STATUS_TONE, PAYMENT_STATUS_TONE } from "@/lib/financials";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const TABS = [
  { key: "dashboard", label: "Dashboard" },
  { key: "ageing", label: "Ageing" },
  { key: "payments", label: "All Payments" },
];

export default function CollectionsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const currentTab = useMemo(() => {
    const q = new URLSearchParams(location.search).get("t") || "dashboard";
    return TABS.some((t) => t.key === q) ? q : "dashboard";
  }, [location.search]);

  const setTab = (v) => {
    if (v === currentTab) return;
    const next = new URLSearchParams(location.search);
    if (v === "dashboard") next.delete("t"); else next.set("t", v);
    navigate({ pathname: location.pathname, search: next.toString() }, { replace: true });
  };

  return (
    <div className="space-y-6" data-testid="collections-page">
      <PageHeader
        title="Collections"
        subtitle="Every ₹ owed, received, and overdue — across every booking."
      />
      <Tabs value={currentTab} onValueChange={setTab}>
        <TabsList data-testid="collections-tabs">
          {TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key} data-testid={`col-tab-${t.key}`}>{t.label}</TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="dashboard" className="mt-4">
          <DashboardTab />
        </TabsContent>
        <TabsContent value="ageing" className="mt-4">
          <AgeingTab />
        </TabsContent>
        <TabsContent value="payments" className="mt-4">
          <PaymentsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ------------------ Dashboard ------------------
function DashboardTab() {
  const [data, setData] = useState(null);
  const [ageing, setAgeing] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        const [d, a] = await Promise.all([
          api.get("/collections/dashboard"),
          api.get("/collections/ageing"),
        ]);
        setData(d.data);
        setAgeing(a.data);
      } catch (e) {
        apiErrorToast(e);
      }
    })();
  }, []);

  if (!data) return <div className="text-sm text-gray-500">Loading…</div>;

  return (
    <div className="space-y-6" data-testid="col-dashboard">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <BigMetric label="Total due" value={<RestrictedField value={data.total_due_inr} module="collections" format="inr" />} icon={IndianRupee} testId="col-metric-due" />
        <BigMetric label="Received" value={<RestrictedField value={data.total_received_inr} module="collections" format="inr" />} tone="green" icon={TrendingUp} testId="col-metric-received" />
        <BigMetric label="Outstanding" value={<RestrictedField value={data.total_outstanding_inr} module="collections" format="inr" />} testId="col-metric-outstanding" />
        <BigMetric label="Overdue" value={<RestrictedField value={data.total_overdue_inr} module="collections" format="inr" />} sub={`${data.bookings_with_overdue} booking${data.bookings_with_overdue === 1 ? "" : "s"}`} tone={data.total_overdue_inr > 0 ? "red" : "grey"} icon={AlertOctagon} testId="col-metric-overdue" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-md border border-gray-200 bg-white p-4" data-testid="col-tds-pending">
          <div className="flex items-center gap-2">
            <Receipt className="h-4 w-4 text-purple-600" />
            <div className="text-sm font-medium text-gray-900">TDS pending verification</div>
          </div>
          <div className="font-heading text-3xl font-semibold text-gray-900 mt-2 tabular-nums">{data.tds_pending_verification}</div>
          <div className="text-[11px] text-gray-500 mt-1">Applicable TDS records with challan not yet verified.</div>
        </div>
        <div className="rounded-md border border-gray-200 bg-white p-4" data-testid="col-fc-pending">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-navy-900" />
            <div className="text-sm font-medium text-gray-900">Financial clearances pending</div>
          </div>
          <div className="font-heading text-3xl font-semibold text-gray-900 mt-2 tabular-nums">{data.financial_clearances_pending}</div>
          <div className="text-[11px] text-gray-500 mt-1">Bookings waiting on Accounts sign-off before Registration.</div>
        </div>
      </div>

      {/* Ageing bucket strip */}
      {ageing && (
        <div className="rounded-md border border-gray-200 bg-white overflow-hidden" data-testid="col-ageing-strip">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-gray-900 flex items-center gap-1.5">
                <Clock className="h-4 w-4 text-orange-600" />
                Ageing at a glance
              </div>
              <div className="text-[11px] text-gray-500">Overdue milestones bucketed by days past due.</div>
            </div>
          </div>
          <div className="grid grid-cols-7 divide-x divide-gray-100">
            {AGEING_BUCKETS.map((b) => {
              const bucket = ageing.buckets[b] || { count: 0, amount: 0 };
              const heavy = bucket.count > 0;
              const toneClass = b === "Current" ? "text-gray-700"
                : b === "1-7" || b === "8-15" ? "text-amber-700"
                : b === "16-30" ? "text-orange-700"
                : "text-red-700";
              return (
                <div key={b} className="p-3 text-center">
                  <div className="text-xs uppercase tracking-wide text-slate-600 font-semibold">{b}{b !== "90+" && b !== "Current" ? " days" : ""}</div>
                  <div className={`font-heading text-2xl font-semibold mt-1 tabular-nums ${heavy ? toneClass : "text-gray-400"}`}>{bucket.count}</div>
                  <div className="text-[11px] text-gray-500 tabular-nums mt-0.5"><RestrictedField value={bucket.amount} module="collections" format="inr" /></div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------ Ageing ------------------
function AgeingTab() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [buckets, setBuckets] = useState({});
  const [bucketFilter, setBucketFilter] = useState("__all__");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const r = await api.get("/collections/ageing");
        setRows(r.data.rows || []);
        setBuckets(r.data.buckets || {});
      } catch (e) {
        apiErrorToast(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    if (bucketFilter === "__all__") return rows;
    return rows.filter((r) => r.ageing_bucket === bucketFilter);
  }, [rows, bucketFilter]);

  const openFinancials = (r) => {
    if (r?.customer?.id) navigate(`/customers/${r.customer.id}?tab=financials`);
  };

  return (
    <div className="space-y-4" data-testid="col-ageing-tab">
      <div className="flex items-center gap-3">
        <span className="text-xs uppercase tracking-wide text-slate-600 font-semibold">Bucket</span>
        <Select value={bucketFilter} onValueChange={setBucketFilter}>
          <SelectTrigger className="h-8 w-40 text-sm" data-testid="col-ageing-filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All buckets</SelectItem>
            {AGEING_BUCKETS.map((b) => (
              <SelectItem key={b} value={b}>{b} days{buckets[b] ? ` (${buckets[b].count})` : ""}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border border-gray-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="text-xs uppercase tracking-wide text-slate-600 font-semibold">
              <th className="h-9 px-3 text-left font-normal">Customer</th>
              <th className="h-9 px-3 text-left font-normal">Unit</th>
              <th className="h-9 px-3 text-left font-normal">Milestone</th>
              <th className="h-9 px-3 text-left font-normal">Due</th>
              <th className="h-9 px-3 text-right font-normal">Days overdue</th>
              <th className="h-9 px-3 text-right font-normal">Balance</th>
              <th className="h-9 px-3 text-left font-normal">Bucket</th>
              <th className="h-9 px-3 text-left font-normal">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={8} className="p-4 text-xs text-gray-500">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="p-4 text-xs text-gray-500">No overdue milestones for this filter.</td></tr>
            ) : (
              filtered.map((r) => (
                <tr
                  key={r.milestone_id}
                  className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => openFinancials(r)}
                  data-testid={`col-ageing-row-${r.milestone_id.slice(0, 8)}`}
                >
                  <td className="px-3 py-2">
                    {r.customer ? (
                      <span className="text-navy-900 hover:underline" data-testid={`col-ageing-cust-${r.customer.code}`}>
                        <span className="font-mono text-[11px] text-gray-500 mr-1.5">{r.customer.code}</span>
                        <span>{r.customer.primary_name}</span>
                      </span>
                    ) : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-700 font-mono">{r.unit?.code || "—"}</td>
                  <td className="px-3 py-2">
                    <div className="text-sm text-gray-900">{r.milestone_name}</div>
                    <div className="text-[11px] text-gray-500">{r.project?.code}</div>
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-700">{formatDate(r.due_date)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-red-700 font-medium">{r.days_overdue}d</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium"><RestrictedField value={r.balance_inr} module="collections" format="inr" /></td>
                  <td className="px-3 py-2">
                    <StatusPill status={`${r.ageing_bucket}${r.ageing_bucket !== "Current" && r.ageing_bucket !== "90+" ? "d" : ""}`} tone={r.ageing_bucket === "Current" ? "grey" : r.days_overdue >= 30 ? "red" : r.days_overdue >= 15 ? "orange" : "amber"} />
                  </td>
                  <td className="px-3 py-2">
                    <StatusPill status={r.status} tone={MILESTONE_STATUS_TONE[r.status] || "grey"} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ------------------ All Payments ------------------
function PaymentsTab() {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState("__all__");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const params = {};
      if (status !== "__all__") params.status = status;
      const r = await api.get("/payments", { params });
      setRows(r.data || []);
    } catch (e) {
      apiErrorToast(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [status]);

  return (
    <div className="space-y-4" data-testid="col-payments-tab">
      <div className="flex items-center gap-3">
        <span className="text-xs uppercase tracking-wide text-slate-600 font-semibold">Status</span>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-8 w-40 text-sm" data-testid="col-payments-filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All statuses</SelectItem>
            <SelectItem value="Pending">Pending</SelectItem>
            <SelectItem value="Verified">Verified</SelectItem>
            <SelectItem value="Rejected">Rejected</SelectItem>
            <SelectItem value="Disputed">Disputed</SelectItem>
            <SelectItem value="Waived">Waived</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border border-gray-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="text-xs uppercase tracking-wide text-slate-600 font-semibold">
              <th className="h-9 px-3 text-left font-normal">Date</th>
              <th className="h-9 px-3 text-left font-normal">Booking</th>
              <th className="h-9 px-3 text-left font-normal">Customer</th>
              <th className="h-9 px-3 text-left font-normal">Mode</th>
              <th className="h-9 px-3 text-left font-normal">Reference</th>
              <th className="h-9 px-3 text-right font-normal">Amount</th>
              <th className="h-9 px-3 text-left font-normal">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={7} className="p-4 text-xs text-gray-500">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="p-4 text-xs text-gray-500">No payments yet.</td></tr>
            ) : (
              rows.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50" data-testid={`col-payment-row-${p.id.slice(0, 8)}`}>
                  <td className="px-3 py-2 text-xs text-gray-700">{formatDate(p.payment_date)}</td>
                  <td className="px-3 py-2 text-xs">
                    {p._booking?.id ? (
                      <Link to={`/bookings/${p._booking.id}`} className="text-navy-900 hover:underline font-mono">{p._booking.code}</Link>
                    ) : "—"}
                  </td>
                  <td className="px-3 py-2 text-sm">
                    {p._customer?.id ? (
                      <Link to={`/customers/${p._customer.id}?tab=financials`} className="text-navy-900 hover:underline">
                        <span className="font-mono text-[11px] text-gray-500 mr-1.5">{p._customer.code}</span>
                        {p._customer.primary_name}
                      </Link>
                    ) : "—"}
                  </td>
                  <td className="px-3 py-2 text-[11px] uppercase text-gray-600 tracking-wide">{p.payment_mode}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-gray-700">{p.reference_no || "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">
                    {p.amount_inr == null ? (
                      <RestrictedField value={null} module="collections" testId="col-payment-amount-restricted" />
                    ) : (
                      formatINR(p.amount_inr + (p.tax_inr || 0))
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <StatusPill status={p.verification_status} tone={PAYMENT_STATUS_TONE[p.verification_status] || "grey"} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BigMetric({ label, value, sub, icon: Icon, tone = "default", testId }) {
  const toneCls =
    tone === "danger" || tone === "red" ? "border-red-200 bg-red-50/50" :
    tone === "green" ? "border-emerald-200 bg-emerald-50/50" :
    "border-gray-200 bg-white";
  const iconCls =
    tone === "danger" || tone === "red" ? "text-red-600" :
    tone === "green" ? "text-emerald-600" :
    "text-gray-400";
  const valueCls =
    tone === "danger" || tone === "red" ? "text-red-800" :
    tone === "green" ? "text-emerald-800" :
    "text-gray-900";
  return (
    <div className={`rounded-md border p-4 ${toneCls}`} data-testid={testId}>
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wide text-slate-600 font-semibold">{label}</div>
        {Icon && <Icon className={`h-4 w-4 ${iconCls}`} />}
      </div>
      <div className={`font-heading text-2xl font-semibold mt-1 tabular-nums ${valueCls}`}>{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}

import { CircleDollarSign, TrendingUp, AlertOctagon, CalendarClock } from "lucide-react";

import { formatINR, formatINRFull, formatDate } from "@/lib/format";
import StatusPill from "@/components/StatusPill";
import RestrictedField from "@/components/rbac/RestrictedField";

/**
 * Read-only header card. Shows the aggregated financial pulse for the customer.
 * Data source: GET /api/collections/customer/{customer_id}
 */
export default function FinancialSnapshot({ snapshot }) {
  if (!snapshot) {
    return (
      <div className="rounded-md border border-gray-200 bg-white p-4 text-xs text-gray-500" data-testid="fin-snapshot-loading">
        Loading financial snapshot…
      </div>
    );
  }

  const {
    agreement_value_inr,
    received_verified_inr,
    received_pending_inr,
    outstanding_inr,
    overdue_inr,
    next_due_milestone,
    tds_status,
    financial_clearance_status,
  } = snapshot;

  const paidPct = agreement_value_inr > 0
    ? Math.min(100, Math.round((received_verified_inr / agreement_value_inr) * 100))
    : 0;

  return (
    <div className="rounded-md border border-gray-200 bg-white overflow-hidden" data-testid="fin-snapshot">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-gray-900 flex items-center gap-1.5">
            <CircleDollarSign className="h-4 w-4 text-navy-900" />
            Financial snapshot
          </div>
          <div className="text-[11px] text-gray-500">Rolls up every booking for this customer.</div>
        </div>
        <div className="hidden md:flex items-center gap-2">
          {tds_status?.applicability && (
            <StatusPill status={`TDS: ${tds_status.applicability}`} tone={tds_status.applicability === "Applicable" ? "blue" : "grey"} testId="fin-snapshot-tds" />
          )}
          {financial_clearance_status && (
            <StatusPill status={`FC: ${financial_clearance_status}`} tone={financial_clearance_status === "Approved" ? "green" : financial_clearance_status === "Rejected" ? "red" : "amber"} testId="fin-snapshot-fc" />
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-gray-100 border-b border-gray-100">
        <Metric label="Agreement value" value={<RestrictedField value={agreement_value_inr} module="customer_financials" format="inr" />} sub={agreement_value_inr == null ? "" : formatINRFull(agreement_value_inr)} testId="fin-metric-agreement" />
        <Metric label="Received (verified)" value={<RestrictedField value={received_verified_inr} module="customer_financials" format="inr" />} sub={received_pending_inr == null ? "" : (received_pending_inr > 0 ? `+ ${formatINR(received_pending_inr)} pending` : "All confirmed")} tone="green" icon={TrendingUp} testId="fin-metric-received" />
        <Metric label="Outstanding" value={<RestrictedField value={outstanding_inr} module="customer_financials" format="inr" />} sub={outstanding_inr == null ? "" : `${100 - paidPct}% of agreement`} testId="fin-metric-outstanding" />
        <Metric label="Overdue" value={<RestrictedField value={overdue_inr} module="customer_financials" format="inr" />} sub={overdue_inr == null ? "" : (overdue_inr > 0 ? "Immediate action" : "Nothing overdue")} tone={overdue_inr > 0 ? "red" : "grey"} icon={AlertOctagon} testId="fin-metric-overdue" />
      </div>

      <div className="px-4 py-3">
        <div className="flex items-center justify-between mb-1.5">
          <div className="text-xs uppercase tracking-wide text-slate-600 font-semibold">Payment progress</div>
          <div className="text-[11px] tabular-nums text-gray-700 font-medium">{paidPct}% paid</div>
        </div>
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-emerald-500" style={{ width: `${paidPct}%` }} />
        </div>
        {next_due_milestone && (
          <div className="mt-3 flex items-center gap-2 text-xs text-gray-700" data-testid="fin-next-due">
            <CalendarClock className="h-3.5 w-3.5 text-amber-600" />
            <span className="font-medium">Next due:</span>
            <span>{next_due_milestone.name}</span>
            <span className="text-gray-500">·</span>
            <span>{formatDate(next_due_milestone.due_date)}</span>
            <span className="text-gray-500">·</span>
            <span className="tabular-nums"><RestrictedField value={next_due_milestone.balance_inr} module="customer_financials" format="inr" /></span>
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value, sub, tone = "default", icon: Icon, testId }) {
  const valueTone =
    tone === "green" ? "text-emerald-700" :
    tone === "red" ? "text-red-700" :
    "text-gray-900";
  return (
    <div className="p-4" data-testid={testId}>
      <div className="text-xs uppercase tracking-wide text-slate-600 font-semibold flex items-center gap-1">
        {Icon && <Icon className="h-3 w-3" />}
        {label}
      </div>
      <div className={`font-heading text-lg font-semibold mt-1 tabular-nums ${valueTone}`}>{value}</div>
      <div className="text-[11px] text-gray-500 mt-0.5 truncate">{sub}</div>
    </div>
  );
}

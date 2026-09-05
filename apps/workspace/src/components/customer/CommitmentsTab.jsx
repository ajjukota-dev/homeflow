import { Link } from "react-router-dom";
import { AlertOctagon } from "lucide-react";

import StatusPill from "@/components/StatusPill";
import { COMMITMENT_STATUS_TONE, displayCommitmentStatus, APPROVAL_STATUS_TONE } from "@/lib/documents";
import { formatDate, formatINR } from "@/lib/format";

export default function CommitmentsTab({ rows, loading, tabKey = "list", onOpen, showCustomerColumn = false }) {
  if (loading) return <div className="text-sm text-gray-500">Loading commitments…</div>;
  if (!rows || rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-8 text-center text-sm text-gray-500" data-testid={`commit-empty-${tabKey}`}>
        No commitments in this view.
      </div>
    );
  }
  return (
    <div className="rounded-md border border-gray-200 bg-white overflow-hidden" data-testid={`commit-table-${tabKey}`}>
      <table className="w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <Th>Code</Th>
            {showCustomerColumn && <Th>Customer</Th>}
            <Th>Category</Th>
            <Th>Description</Th>
            <Th>Target date</Th>
            <Th right>Impact</Th>
            <Th>Approval</Th>
            <Th>Delivery</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const status = displayCommitmentStatus(c);
            return (
              <tr key={c.id} className={["h-11 border-t border-gray-100 hover:bg-brand-50/30 cursor-pointer", c.overdue ? "border-l-4 border-l-red-500" : ""].join(" ")}
                  onClick={() => onOpen?.(c)}
                  data-testid={`commit-row-${c.code}`}>
                <td className="px-3 font-mono text-xs">{c.code}</td>
                {showCustomerColumn && (
                  <td className="px-3 text-sm">
                    <Link to={`/customers/${c._customer?.id}?tab=commitments`} className="text-navy-900 hover:underline" onClick={(e) => e.stopPropagation()}>
                      <span className="font-mono text-gray-500 mr-1">{c._customer?.code}</span>{c._customer?.primary_name}
                    </Link>
                  </td>
                )}
                <td className="px-3 text-sm text-gray-700">{c.category}</td>
                <td className="px-3 text-sm text-gray-800 truncate max-w-[280px]">{c.description}</td>
                <td className="px-3 text-sm">
                  {c.target_date ? (
                    <span className={c.overdue ? "text-red-700 font-medium inline-flex items-center gap-1" : "text-gray-600"}>
                      {c.overdue && <AlertOctagon className="h-3 w-3" />} {formatDate(c.target_date)}
                    </span>
                  ) : <span className="text-gray-400">—</span>}
                </td>
                <td className="px-3 text-right text-xs tabular-nums">{c.financial_impact_inr != null ? formatINR(c.financial_impact_inr) : "—"}</td>
                <td className="px-3"><StatusPill status={c.approval_status} tone={APPROVAL_STATUS_TONE[c.approval_status]} /></td>
                <td className="px-3"><StatusPill status={status} tone={COMMITMENT_STATUS_TONE[status]} /></td>
                <td className="px-3 text-[11px] text-navy-900">Open</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, right }) {
  return <th className={["h-9 px-3 text-xs uppercase tracking-wide text-slate-600 font-semibold", right ? "text-right" : "text-left"].join(" ")}>{children}</th>;
}

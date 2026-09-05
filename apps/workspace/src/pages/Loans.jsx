import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import { formatINR } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import StatusPill from "@/components/StatusPill";
import { LOAN_STAGE_TONE } from "@/lib/phase6";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const STAGES = ["Application", "Sanction Pending", "Sanctioned", "Disbursement Pending", "Partially Disbursed", "Fully Disbursed", "Closed", "Rejected"];

export default function LoansPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [stage, setStage] = useState("__all__");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const params = {};
      if (stage !== "__all__") params.stage = stage;
      const r = await api.get("/loans", { params });
      setRows(r.data || []);
    } catch (e) { apiErrorToast(e); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [stage]);

  return (
    <div className="space-y-6" data-testid="loans-page">
      <PageHeader title="Loans" subtitle="Every bank loan for every booking — sanction, disbursement, blockers." />
      <div className="flex items-center gap-3">
        <span className="text-xs uppercase tracking-wide text-slate-600 font-semibold">Stage</span>
        <Select value={stage} onValueChange={setStage}>
          <SelectTrigger className="h-8 w-56 text-sm" data-testid="loans-stage-filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All stages</SelectItem>
            {STAGES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border border-gray-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="text-xs uppercase tracking-wide text-slate-600 font-semibold">
              <th className="h-9 px-3 text-left font-normal">Customer</th>
              <th className="h-9 px-3 text-left font-normal">Project · Unit</th>
              <th className="h-9 px-3 text-left font-normal">Bank</th>
              <th className="h-9 px-3 text-right font-normal">Sanctioned</th>
              <th className="h-9 px-3 text-right font-normal">Disbursed</th>
              <th className="h-9 px-3 text-left font-normal">Stage</th>
              <th className="h-9 px-3 text-left font-normal">Blocker</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={7} className="p-4 text-xs text-gray-500">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="p-4 text-xs text-gray-500">No loan cases match this filter.</td></tr>
            ) : rows.map((r) => (
              <tr
                key={r.id}
                className="hover:bg-gray-50 cursor-pointer"
                onClick={() => r._customer?.id && navigate(`/customers/${r._customer.id}?tab=loan`)}
                data-testid={`loan-row-${r.id.slice(0, 8)}`}
              >
                <td className="px-3 py-2">
                  {r._customer?.id ? (
                    <>
                      <span className="font-mono text-[11px] text-gray-500 mr-1.5">{r._customer.code}</span>
                      <span className="text-sm text-gray-900">{r._customer.primary_name}</span>
                    </>
                  ) : "—"}
                </td>
                <td className="px-3 py-2 text-xs text-gray-700 font-mono">
                  {r._project?.code || "—"} · {r._unit?.code || "—"}
                </td>
                <td className="px-3 py-2 text-sm text-gray-900">{r.bank_name}{r.bank_branch ? <span className="text-[11px] text-gray-500 ml-1">· {r.bank_branch}</span> : null}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.sanctioned_amount_inr ? formatINR(r.sanctioned_amount_inr) : <span className="text-amber-700">—</span>}</td>
                <td className="px-3 py-2 text-right tabular-nums text-emerald-700 font-medium">{formatINR(r.disbursed_amount_inr || 0)}</td>
                <td className="px-3 py-2"><StatusPill status={r.current_stage} tone={LOAN_STAGE_TONE[r.current_stage] || "grey"} /></td>
                <td className="px-3 py-2 text-xs text-red-700 truncate max-w-[220px]">{r.blocker || <span className="text-gray-400">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

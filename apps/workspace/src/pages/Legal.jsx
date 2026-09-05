import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import { formatDate } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import StatusPill from "@/components/StatusPill";
import { LEGAL_STATUS_TONE } from "@/lib/phase6";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const STATUSES = [
  "Not Started",
  "Draft Uploaded",
  "Under Review",
  "Deviations Raised",
  "Approved",
  "Rejected",
];

export default function LegalPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState("__all__");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const params = {};
      if (status !== "__all__") params.status = status;
      const r = await api.get("/legal", { params });
      setRows(r.data || []);
    } catch (e) {
      apiErrorToast(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [status]);

  return (
    <div className="space-y-6" data-testid="legal-page">
      <PageHeader
        title="Legal"
        subtitle="Every sale agreement draft, review, and approval — one row per Confirmed booking."
      />
      <div className="flex items-center gap-3">
        <span className="text-xs uppercase tracking-wide text-slate-600 font-semibold">Status</span>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-8 w-56 text-sm" data-testid="legal-status-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All statuses</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border border-gray-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="text-xs uppercase tracking-wide text-slate-600 font-semibold">
              <th className="h-9 px-3 text-left font-normal">Customer</th>
              <th className="h-9 px-3 text-left font-normal">Project · Unit</th>
              <th className="h-9 px-3 text-left font-normal">Status</th>
              <th className="h-9 px-3 text-left font-normal">Latest draft</th>
              <th className="h-9 px-3 text-left font-normal">Notes / reason</th>
              <th className="h-9 px-3 text-left font-normal">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={6} className="p-4 text-xs text-gray-500">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-4 text-xs text-gray-500">
                  No legal records match this filter.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const note =
                  r.status === "Rejected"
                    ? r.rejection_reason
                    : r.status === "Deviations Raised"
                    ? r.deviation_notes
                    : r.status === "Approved"
                    ? r.approval_notes
                    : null;
                return (
                  <tr
                    key={r.id}
                    className="hover:bg-gray-50 cursor-pointer"
                    onClick={() =>
                      r._customer?.id && navigate(`/customers/${r._customer.id}?tab=legal`)
                    }
                    data-testid={`legal-row-${r.id.slice(0, 8)}`}
                  >
                    <td className="px-3 py-2">
                      {r._customer?.id ? (
                        <>
                          <span className="font-mono text-[11px] text-gray-500 mr-1.5">
                            {r._customer.code}
                          </span>
                          <span className="text-sm text-gray-900">{r._customer.primary_name}</span>
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
                        tone={LEGAL_STATUS_TONE[r.status] || "grey"}
                      />
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-700">
                      {r.latest_version ? (
                        <>
                          <span className="font-medium text-gray-900">v{r.latest_version}</span>
                          {r.latest_draft?.filename ? (
                            <span className="text-[11px] text-gray-500 ml-1.5 truncate inline-block max-w-[220px] align-bottom">
                              · {r.latest_draft.filename}
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs truncate max-w-[280px]">
                      {note ? (
                        <span
                          className={
                            r.status === "Rejected"
                              ? "text-red-700"
                              : r.status === "Deviations Raised"
                              ? "text-orange-700"
                              : "text-gray-600"
                          }
                        >
                          {note}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
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

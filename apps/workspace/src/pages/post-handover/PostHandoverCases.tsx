import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, EmptyState, Skeleton, Segmented } from "@homeflow/ui";
import { HeartHandshake } from "lucide-react";
import { postHandoverApi, CASE_STATUS_LABEL, type PostHandoverCaseListRow, type CaseStatus } from "./api";
import { CaseDrawer } from "./CaseDrawer";

const STATUS_TONE: Record<CaseStatus, string> = {
  ONBOARDING: "bg-due/10 text-due",
  IN_DLP: "bg-accent/10 text-accent",
  DLP_CLOSED: "bg-surface-2 text-fg-subtle",
  CLOSED: "bg-ontrack/10 text-ontrack",
};

function moveInProgress(row: PostHandoverCaseListRow): { done: number; total: number } {
  const values = Object.values(row.move_in_tasks);
  return { done: values.filter((t) => t.done).length, total: values.length };
}

/** 30-post-handover.md Screens: "Post-handover (FM/CRM): cases list (onboarding progress, open
 *  warranty cases, DLP windows remaining)". Replaces the legacy PostHandover.tsx, which read a
 *  different, simpler backend (pre-30 warranty.ts: 2-status cases, no move-in checklist, no
 *  passport/advocacy) — this spec's own Files line says to replace it outright, not add a tab
 *  alongside it (unlike 23's LegalWorkspace, which kept its legacy AOS flow running). */
export function PostHandoverCases({ projectId, roles }: { projectId: string; roles: string[] }) {
  const [rows, setRows] = useState<PostHandoverCaseListRow[] | null>(null);
  const [error, setError] = useState(false);
  const [status, setStatus] = useState<CaseStatus | "ALL">("ALL");
  const [openBookingId, setOpenBookingId] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!projectId) return;
    setError(false);
    postHandoverApi
      .listCases({ project_id: projectId })
      .then(setRows)
      .catch(() => setError(true));
  }, [projectId]);

  useEffect(load, [load]);

  const filtered = useMemo(() => (rows ?? []).filter((r) => status === "ALL" || r.status === status), [rows, status]);
  const loading = rows === null && !error;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-large font-bold">After keys</h1>
        <p className="mt-1 max-w-2xl text-subhead text-fg-muted">
          Move-in onboarding, defect-liability windows, warranty cases, and the home's permanent service history.
        </p>
      </div>

      {error && <EmptyState icon={HeartHandshake} message="Couldn't reach the API on :3001." action={{ label: "Retry", onClick: load }} />}

      {!error && (
        <Segmented
          aria-label="Filter by status"
          value={status}
          onChange={(v) => setStatus(v)}
          options={[
            { value: "ALL", label: "All" },
            { value: "ONBOARDING", label: "Onboarding" },
            { value: "IN_DLP", label: "In DLP" },
            { value: "DLP_CLOSED", label: "DLP closed" },
            { value: "CLOSED", label: "Closed" },
          ]}
        />
      )}

      {!error && loading && <div className="flex flex-col gap-2"><Skeleton /><Skeleton /><Skeleton /></div>}

      {!error && !loading && filtered.length === 0 && (
        <EmptyState icon={HeartHandshake} message="No homes match this filter yet." />
      )}

      {!error && !loading && filtered.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-footnote">
            <thead className="bg-surface-2">
              <tr className="text-caption uppercase tracking-wide text-fg-subtle">
                <th className="p-3 text-left">Unit</th>
                <th className="p-3 text-left">Customer</th>
                <th className="p-3 text-left">Status</th>
                <th className="p-3 text-left">Move-in tasks</th>
                <th className="p-3 text-left">Open warranty cases</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const p = moveInProgress(r);
                return (
                  <tr key={r.id} className="cursor-pointer border-t border-line hover:bg-surface-2" onClick={() => setOpenBookingId(r.booking_id)}>
                    <td className="p-3 font-semibold text-fg">{r.unit_number}</td>
                    <td className="p-3 text-fg-muted">{r.customer_name ?? "—"}</td>
                    <td className="p-3">
                      <Badge className={STATUS_TONE[r.status]}>{CASE_STATUS_LABEL[r.status]}</Badge>
                    </td>
                    <td className="p-3 text-fg-muted">{p.done}/{p.total} done</td>
                    <td className="p-3">
                      {r.open_warranty_cases > 0 ? (
                        <Badge className="bg-overdue/10 text-overdue">{r.open_warranty_cases} open</Badge>
                      ) : (
                        <span className="text-fg-subtle">None</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <CaseDrawer bookingId={openBookingId} roles={roles} onClose={() => setOpenBookingId(null)} onChanged={load} />
    </div>
  );
}

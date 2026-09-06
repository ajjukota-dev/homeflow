import { useEffect, useState } from "react";
import { PageHeader, Table, type TableColumn, Badge } from "@homeflow/ui";
import { commitmentsApi, type Commitment, type CommitmentStatus } from "./api";
import { CommitmentDrawer } from "./CommitmentDrawer";
import { CommitmentStatusChip } from "./CommitmentStatusChip";
import { commitmentCategoryLabel } from "../../lib/labels";

// 13-promise-ledger.md Screens: "Promise Ledger (CRM): table with status chips, due, owner, ₹
// impact, confidence with drivers tooltip, customer-facing badge; filters; row → detail drawer."
// No "New commitment" button here — creation naturally happens in a booking's own context
// (Customer360's Commitments section below has one), same reasoning ProjectJourneyControl has no
// "create journey" button (the real creation path is an event, not a form on this screen).
const STATUSES: CommitmentStatus[] = ["DRAFT", "APPROVED", "ACTIVE", "AT_RISK", "BREACHED", "FULFILLED", "WAIVED_CANCELLED"];

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
function fmtMoney(n: number | null): string {
  return n == null ? "—" : `₹${n.toLocaleString("en-IN")}`;
}

export function PromiseLedger({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<Commitment[] | null>(null);
  const [error, setError] = useState(false);
  const [statusFilter, setStatusFilter] = useState<CommitmentStatus | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  function load() {
    if (!projectId) return;
    setError(false);
    commitmentsApi.list({ project_id: projectId }).then(setRows).catch(() => setError(true));
  }
  useEffect(() => {
    setRows(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const visible = (rows ?? []).filter((r) => !statusFilter || r.status === statusFilter);

  const columns: TableColumn<Commitment>[] = [
    {
      key: "code",
      header: "Code",
      width: 200,
      render: (r) => (
        <button onClick={() => setOpenId(r.id)} className="text-left font-medium text-accent hover:underline">
          {r.code}
        </button>
      ),
    },
    { key: "description", header: "Promise", render: (r) => <span className="truncate">{r.description}</span> },
    { key: "category", header: "Category", width: 160, render: (r) => <Badge>{commitmentCategoryLabel(r.category)}</Badge> },
    { key: "status", header: "Status", width: 150, render: (r) => <CommitmentStatusChip status={r.status} /> },
    { key: "due", header: "Due", width: 120, render: (r) => fmtDate(r.due_date) },
    { key: "owner", header: "Owner", width: 140, render: (r) => r.owner_user_id ?? "Unassigned" },
    { key: "impact", header: "₹ impact", width: 120, render: (r) => fmtMoney(r.financial_impact_inr) },
    { key: "confidence", header: "Confidence", width: 110, render: (r) => `${r.confidence}` },
    { key: "customer_facing", header: "", width: 130, render: (r) => (r.customer_facing ? <Badge>Customer-facing</Badge> : null) },
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Promise Ledger"
        description="Every commitment made to a customer or internally — status, owner, due date, and the confidence behind it (13-promise-ledger.md)."
      />

      {rows && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-footnote text-fg-muted">Filter:</span>
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter((prev) => (prev === s ? null : s))}
              className={`rounded-pill border px-2.5 py-1 text-footnote font-medium ${statusFilter === s ? "border-accent bg-accent-soft text-accent-soft-fg" : "border-line text-fg-muted"}`}
            >
              {s.replace("_", " ")}
            </button>
          ))}
        </div>
      )}

      <Table
        columns={columns}
        rows={visible}
        getRowId={(r) => r.id}
        loading={!error && rows === null}
        error={error ? { message: "Couldn't load commitments for this project.", onRetry: load } : undefined}
        emptyMessage="No commitments on this project yet."
      />

      <CommitmentDrawer commitmentId={openId} onClose={() => setOpenId(null)} onChanged={load} />
    </div>
  );
}

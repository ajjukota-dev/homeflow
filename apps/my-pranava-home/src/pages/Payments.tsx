import { useCallback } from "react";
import { portalApi } from "../portal-api";
import { useArea } from "../lib/useArea";
import { formatINR, formatDate, cn } from "../lib/utils";

/** 26-customer-portal.md rule 5: schedule with trigger wording, dues, receipts, TDS, loan
 *  summary. No online payment (Not in this feature). */
export function Payments() {
  const { data, loading, error, reload } = useArea(useCallback(() => portalApi.payments(), []));

  return (
    <div className="mx-auto min-h-screen w-full max-w-md px-5 pb-24">
      <header className="pt-10 pb-2">
        <h1 className="text-large font-bold">Payments</h1>
      </header>

      {loading && (
        <div className="mt-4 flex flex-col gap-3" role="status" aria-label="Loading">
          <div className="h-32 w-full animate-pulse rounded-xl bg-surface-2" />
        </div>
      )}

      {!loading && error && (
        <div className="mt-4 rounded-xl border border-line bg-surface p-5 text-center shadow-card">
          <p className="text-body text-fg-muted">We couldn't load your payments just now.</p>
          <button onClick={reload} className="mt-3 text-footnote font-medium text-accent">
            Try again
          </button>
        </div>
      )}

      {!loading && !error && data && (
        <>
          <section className="mt-4 rounded-xl border border-line bg-surface p-5 shadow-card">
            <div className="flex items-center justify-between">
              <span className="text-body text-fg-muted">Paid</span>
              <span className="text-title font-bold">{formatINR(data.paid_total)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-body text-fg-muted">Remaining</span>
              <span className="text-body font-semibold">{formatINR(data.remaining_total)}</span>
            </div>
            <ol className="mt-5 divide-y divide-line">
              {data.schedule.map((line) => (
                <li key={line.milestone_label} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-body font-semibold">{line.milestone_label}</div>
                      <p className="mt-0.5 text-footnote text-fg-muted">{line.why_now}</p>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-body font-semibold tabular-nums">{formatINR(line.amount)}</div>
                      <div
                        className={cn(
                          "mt-1 text-caption font-medium",
                          line.status === "Paid" ? "text-ontrack" : line.status === "Upcoming" ? "text-fg-subtle" : "text-due"
                        )}
                      >
                        {line.status}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {data.receipts.length > 0 && (
            <section className="mt-6">
              <h2 className="mb-3 text-title font-semibold">Receipts</h2>
              <div className="rounded-xl border border-line bg-surface p-2 shadow-card">
                {data.receipts.map((r) => (
                  <div key={r.receipt_id} className="flex items-center justify-between border-b border-line px-3 py-3 last:border-b-0">
                    <span className="text-body">{formatDate(r.date)}</span>
                    <span className="font-mono text-body font-semibold tabular-nums text-ontrack">{formatINR(r.amount)} · Received</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {data.tds.length > 0 && (
            <section className="mt-6">
              <h2 className="mb-3 text-title font-semibold">TDS</h2>
              <div className="rounded-xl border border-line bg-surface p-2 shadow-card">
                {data.tds.map((t, i) => (
                  <div key={i} className="flex items-center justify-between border-b border-line px-3 py-3 last:border-b-0">
                    <span className="text-body">{t.status}</span>
                    {t.amount != null && <span className="font-mono text-footnote tabular-nums text-fg-muted">{formatINR(t.amount)}</span>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {data.loan_summary && (
            <section className="mt-6">
              <h2 className="mb-3 text-title font-semibold">Loan</h2>
              <div className="rounded-xl border border-line bg-surface p-5 shadow-card">
                <p className="text-body font-semibold">{data.loan_summary.lender ?? "Lender not set"}</p>
                <p className="mt-1 text-footnote text-fg-muted">{data.loan_summary.stage}</p>
                {data.loan_summary.sanctioned_amount_inr != null && (
                  <p className="mt-1 text-footnote text-fg-muted">Sanctioned {formatINR(data.loan_summary.sanctioned_amount_inr)}</p>
                )}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

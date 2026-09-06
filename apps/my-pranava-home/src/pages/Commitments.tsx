import { useCallback } from "react";
import { AreaScreen } from "../components/AreaScreen";
import { portalApi } from "../portal-api";
import { useArea } from "../lib/useArea";
import { formatDate } from "../lib/utils";

/** 26-customer-portal.md rule 8: customer-facing only — description, promised date, status.
 *  Never root cause or owner (rule 2's denylist). */
export function Commitments({ onBack }: { onBack: () => void }) {
  const { data, loading, error, reload } = useArea(useCallback(() => portalApi.commitments(), []));

  return (
    <AreaScreen title="Commitments" onBack={onBack} loading={loading} error={error} onRetry={reload} empty={!data || data.length === 0}>
      {data && (
        <div className="rounded-xl border border-line bg-surface p-2 shadow-card">
          {data.map((c, i) => (
            <div key={i} className="border-b border-line px-3 py-3 last:border-b-0">
              <p className="text-body font-semibold">{c.description}</p>
              <p className="mt-1 text-footnote text-fg-muted">
                {c.promised_date ? `By ${formatDate(c.promised_date)}` : "Date to be confirmed"} · {c.status}
              </p>
            </div>
          ))}
        </div>
      )}
    </AreaScreen>
  );
}

import { useCallback } from "react";
import { AreaScreen } from "../components/AreaScreen";
import { portalApi } from "../portal-api";
import { useArea } from "../lib/useArea";
import { formatDate } from "../lib/utils";

/** 26-customer-portal.md rule 10: published updates feed (never auto-published, never AI-sent —
 *  every row here was published by CRM). */
export function Updates({ onBack }: { onBack: () => void }) {
  const { data, loading, error, reload } = useArea(useCallback(() => portalApi.updates(), []));

  return (
    <AreaScreen title="Updates" onBack={onBack} loading={loading} error={error} onRetry={reload} empty={!data || data.length === 0}>
      {data && (
        <div className="rounded-xl border border-line bg-surface p-2 shadow-card">
          {data.map((u) => (
            <div key={u.id} className="border-b border-line px-3 py-3 last:border-b-0">
              <p className="text-body font-semibold">{u.title}</p>
              <p className="mt-1 text-footnote text-fg-muted">{u.body}</p>
              <p className="mt-1 text-caption text-fg-subtle">{formatDate(u.published_at)}</p>
            </div>
          ))}
        </div>
      )}
    </AreaScreen>
  );
}

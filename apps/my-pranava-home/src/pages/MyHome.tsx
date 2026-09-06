import { useCallback } from "react";
import { AreaScreen } from "../components/AreaScreen";
import { portalApi } from "../portal-api";
import { useArea } from "../lib/useArea";

/** 26-customer-portal.md "My Home" screen: unit, hierarchy, as-built spec, drawings. Drawing
 *  browsing isn't built yet (backend flags it, not faked) — surfaced as an empty section. */
export function MyHome({ onBack }: { onBack: () => void }) {
  const { data, loading, error, reload } = useArea(useCallback(() => portalApi.myHome(), []));

  return (
    <AreaScreen title="My Home" onBack={onBack} loading={loading} error={error} onRetry={reload} empty={!data}>
      {data && (
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-line bg-surface p-5 shadow-card">
            <p className="text-body font-semibold">
              Villa {data.unit_number} · {data.unit_type}
            </p>
            <p className="mt-1 text-footnote text-fg-muted">
              {data.project_name} · {data.facing} facing
            </p>
          </div>

          {data.as_built_spec.length > 0 && (
            <section>
              <h2 className="mb-3 text-title font-semibold">As-built spec</h2>
              <div className="rounded-xl border border-line bg-surface p-2 shadow-card">
                {data.as_built_spec.map((s, i) => (
                  <div key={i} className="flex items-center justify-between border-b border-line px-3 py-3 last:border-b-0">
                    <span className="text-body">{s.category}</span>
                    <span className="text-footnote text-fg-muted">{s.brand_model ?? s.spec}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </AreaScreen>
  );
}

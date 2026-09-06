import { useCallback } from "react";
import { AreaScreen } from "../components/AreaScreen";
import { portalApi } from "../portal-api";
import { useArea } from "../lib/useArea";
import { formatDate } from "../lib/utils";

/** 26-customer-portal.md rule 9: equipment, serials, manuals, warranties, as-built spec, service
 *  history. */
export function Passport({ onBack }: { onBack: () => void }) {
  const { data, loading, error, reload } = useArea(useCallback(() => portalApi.passport(), []));

  return (
    <AreaScreen title="Home Passport" onBack={onBack} loading={loading} error={error} onRetry={reload} empty={!data}>
      {data && (
        <div className="flex flex-col gap-4">
          <section>
            <h2 className="mb-3 text-title font-semibold">Equipment</h2>
            {data.equipment.length === 0 ? (
              <div className="rounded-xl border border-line bg-surface p-5 shadow-card">
                <p className="text-footnote text-fg-muted">Equipment details appear here as they're installed.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-line bg-surface p-2 shadow-card">
                {data.equipment.map((item, i) => (
                  <div key={i} className="border-b border-line px-3 py-3 last:border-b-0">
                    <p className="text-body font-semibold">{item.name}</p>
                    <p className="text-footnote text-fg-muted">
                      {[item.brand_model, item.paint_tile_code, item.warranty_months ? `${item.warranty_months}-month warranty` : null].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>

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

          {data.service_history.length > 0 && (
            <section>
              <h2 className="mb-3 text-title font-semibold">Service history</h2>
              <div className="rounded-xl border border-line bg-surface p-2 shadow-card">
                {data.service_history.map((h, i) => (
                  <div key={i} className="border-b border-line px-3 py-3 last:border-b-0">
                    <p className="text-body font-semibold">{h.description}</p>
                    <p className="text-footnote text-fg-muted">{formatDate(h.occurred_at)}</p>
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

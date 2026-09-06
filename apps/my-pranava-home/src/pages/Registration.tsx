import { useCallback, useState } from "react";
import { AreaScreen } from "../components/AreaScreen";
import { portalApi } from "../portal-api";
import { useArea } from "../lib/useArea";
import { formatDate, formatDateTime } from "../lib/utils";

/** 26-customer-portal.md rule 6: what's needed, slot confirm, deed. */
export function Registration({ onBack }: { onBack: () => void }) {
  const { data, loading, error, reload } = useArea(useCallback(() => portalApi.registration(), []));
  const [selected, setSelected] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function confirm() {
    if (!selected) return;
    setConfirming(true);
    try {
      await portalApi.confirmRegistration([selected]);
      reload();
    } finally {
      setConfirming(false);
    }
  }

  return (
    <AreaScreen title="Registration" onBack={onBack} loading={loading} error={error} onRetry={reload} empty={!data}>
      {data && (
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-line bg-surface p-5 shadow-card">
            <p className="text-body font-semibold">{data.status}</p>
            {data.sro_office && <p className="mt-1 text-footnote text-fg-muted">{data.sro_office}</p>}
            {data.slot && <p className="mt-1 text-footnote text-fg-muted">Confirmed slot: {formatDateTime(data.slot)}</p>}
          </div>

          {data.outstanding.length > 0 && (
            <div className="rounded-xl border border-line bg-surface p-5 shadow-card">
              <p className="text-body font-semibold">What's still needed</p>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-footnote text-fg-muted">
                {data.outstanding.map((o, i) => (
                  <li key={i}>{o}</li>
                ))}
              </ul>
            </div>
          )}

          {!data.slot && data.proposed_dates.length > 0 && (
            <div className="rounded-xl border border-line bg-surface p-5 shadow-card">
              <p className="text-body font-semibold">Confirm a date that works for you</p>
              <div className="mt-3 flex flex-col gap-2">
                {data.proposed_dates.map((d) => (
                  <button
                    key={d}
                    onClick={() => setSelected(d)}
                    className={`rounded-lg border px-3 py-2 text-left text-body ${selected === d ? "border-accent bg-accent/10" : "border-line"}`}
                  >
                    {formatDate(d)}
                  </button>
                ))}
              </div>
              <button
                onClick={confirm}
                disabled={!selected || confirming}
                className="mt-3 w-full rounded-full bg-accent px-4 py-2.5 text-body font-medium text-accent-fg disabled:opacity-50"
              >
                {confirming ? "Confirming…" : "Confirm this date"}
              </button>
            </div>
          )}
        </div>
      )}
    </AreaScreen>
  );
}

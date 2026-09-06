import { useCallback, useState } from "react";
import { Plus } from "lucide-react";
import { AreaScreen } from "../components/AreaScreen";
import { portalApi } from "../portal-api";
import { useArea } from "../lib/useArea";
import { formatINR } from "../lib/utils";

/** 26-customer-portal.md rule 7: raise customisation (customer-visible categories only), see
 *  feasibility outcome, quotation accept, snags raised at walkthrough. Service requests (30) are
 *  post-handover and not built yet — the API already flags this, surfaced as an empty section. */
export function Requests({ onBack }: { onBack: () => void }) {
  const { data, loading, error, reload } = useArea(useCallback(() => portalApi.requests(), []));
  const [raising, setRaising] = useState(false);
  const [category, setCategory] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  async function raise() {
    if (!category || !title.trim()) return;
    setBusy(true);
    try {
      await portalApi.raiseRequest({ primary_category_code: category, title: title.trim() });
      setRaising(false);
      setTitle("");
      setCategory("");
      reload();
    } finally {
      setBusy(false);
    }
  }

  async function acceptQuote(id: string) {
    await portalApi.acceptQuotation(id);
    reload();
  }

  return (
    <AreaScreen title="Requests" onBack={onBack} loading={loading} error={error} onRetry={reload}>
      {data && (
        <div className="flex flex-col gap-4">
          {!raising ? (
            <button
              onClick={() => setRaising(true)}
              disabled={data.raisable_categories.length === 0}
              className="flex items-center justify-center gap-1.5 rounded-full bg-accent px-4 py-2.5 text-body font-medium text-accent-fg disabled:opacity-50"
            >
              <Plus className="h-4 w-4" /> Raise a customisation request
            </button>
          ) : (
            <div className="rounded-xl border border-line bg-surface p-4 shadow-card">
              <label className="text-footnote font-medium text-fg-muted">Category</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1 w-full rounded-lg border border-line bg-surface p-2 text-body">
                <option value="">Choose a category</option>
                {data.raisable_categories.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
              <label className="mt-3 block text-footnote font-medium text-fg-muted">What would you like?</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full rounded-lg border border-line bg-surface p-2 text-body" />
              <div className="mt-3 flex gap-2">
                <button onClick={() => setRaising(false)} className="flex-1 rounded-full border border-line px-4 py-2 text-body font-medium">
                  Cancel
                </button>
                <button
                  onClick={raise}
                  disabled={!category || !title.trim() || busy}
                  className="flex-1 rounded-full bg-accent px-4 py-2 text-body font-medium text-accent-fg disabled:opacity-50"
                >
                  {busy ? "Sending…" : "Submit"}
                </button>
              </div>
            </div>
          )}

          <section>
            <h2 className="mb-3 text-title font-semibold">Your requests</h2>
            {data.requests.length === 0 ? (
              <div className="rounded-xl border border-line bg-surface p-5 shadow-card">
                <p className="text-footnote text-fg-muted">Nothing raised yet.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-line bg-surface p-2 shadow-card">
                {data.requests.map((r) => (
                  <div key={r.id} className="border-b border-line px-3 py-3 last:border-b-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-body font-semibold">{r.title}</p>
                        <p className="text-footnote text-fg-muted">
                          {r.code} · {r.status}
                        </p>
                      </div>
                    </div>
                    {r.quotation && (
                      <div className="mt-2 rounded-lg bg-surface-2 p-3">
                        <p className="text-footnote">
                          Quotation: <span className="font-semibold">{formatINR(r.quotation.total_inr)}</span> · {r.quotation.status}
                        </p>
                        {r.quotation.status === "ISSUED" && (
                          <button onClick={() => acceptQuote(r.quotation!.id)} className="mt-2 rounded-full bg-accent px-3 py-1.5 text-footnote font-medium text-accent-fg">
                            Accept quotation
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {data.snags.length > 0 && (
            <section>
              <h2 className="mb-3 text-title font-semibold">Snags from your walkthrough</h2>
              <div className="rounded-xl border border-line bg-surface p-2 shadow-card">
                {data.snags.map((s, i) => (
                  <div key={i} className="flex items-center justify-between border-b border-line px-3 py-3 last:border-b-0">
                    <div>
                      <p className="text-body font-semibold">{s.location}</p>
                      <p className="text-footnote text-fg-muted">{s.trade}</p>
                    </div>
                    <span className={`text-footnote font-medium ${s.status === "Fixed" ? "text-ontrack" : "text-due"}`}>{s.status}</span>
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

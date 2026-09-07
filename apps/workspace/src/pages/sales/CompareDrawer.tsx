import { useEffect, useState } from "react";
import { Dialog, DialogContent, Skeleton, Select, SelectTrigger, SelectOptions } from "@homeflow/ui";
import { salesApi, type CompareResult, type Prospect } from "./api";
import { CATEGORY_LABEL } from "./labels";
import { MoneyFigure } from "../../ui/MoneyFigure";
import { GateChip } from "../../ui/GateChip";
import { ScoreDial } from "../../ui/ScoreDial";
import { possessionLabel } from "./labels";

/** 24-sales-inventory-discovery.md rule 1 Screen "Compare (3-4 units)". Optional prospect
 *  selector re-runs the same rule-4 match scoring per column when chosen. */
export function CompareDrawer({
  unitIds,
  prospects,
  onClose,
}: {
  unitIds: string[] | null;
  prospects: Prospect[];
  onClose: () => void;
}) {
  const [prospectId, setProspectId] = useState<string>("");
  const [result, setResult] = useState<CompareResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!unitIds) {
      setResult(null);
      setError(null);
      setProspectId("");
      return;
    }
    setResult(null);
    setError(null);
    salesApi
      .compare(unitIds, prospectId || undefined)
      .then(setResult)
      .catch((e) => setError(e?.message ?? "Couldn't compare these units."));
  }, [unitIds, prospectId]);

  return (
    <Dialog open={!!unitIds} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title="Compare units"
        description="Side by side: current gate status, flexibility, and — with a prospect selected — requirement match."
        className="max-w-4xl"
      >
        <div className="mb-4 max-w-xs">
          <Select value={prospectId} onValueChange={setProspectId}>
            <SelectTrigger placeholder="Score against a prospect (optional)" />
            <SelectOptions options={[{ value: "", label: "No prospect selected" }, ...prospects.map((p) => ({ value: p.id, label: `${p.name} (${p.code})` }))]} />
          </Select>
        </div>

        {error && <p role="alert" className="text-subhead text-overdue">{error}</p>}

        {!error && !result && (
          <div className="flex gap-4 overflow-x-auto" aria-busy="true" aria-label="Loading comparison">
            {(unitIds ?? []).map((id) => (
              <Skeleton key={id} className="h-96 w-64 shrink-0" />
            ))}
          </div>
        )}

        {result && (
          <>
            <div className="flex gap-4 overflow-x-auto pb-2">
              {result.units.map((u) => (
                <div key={u.unit_id} className="w-64 shrink-0 rounded-xl border border-line bg-surface p-4">
                  <h3 className="text-title3 font-semibold">Villa {u.unit_number}</h3>
                  <p className="text-footnote text-fg-muted">
                    {u.unit_type} · {u.facing} facing
                  </p>
                  <div className="mt-3">
                    {u.price_inr !== null ? <MoneyFigure amount={u.price_inr} /> : <span className="text-footnote text-fg-subtle">Price not set</span>}
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-2 gap-y-1 text-footnote">
                    <dt className="text-fg-subtle">Carpet area</dt>
                    <dd className="text-right text-fg">{u.carpet_area_sqft ? `${u.carpet_area_sqft.toLocaleString("en-IN")} sqft` : "—"}</dd>
                    <dt className="text-fg-subtle">Construction</dt>
                    <dd className="text-right text-fg">{Math.round(u.construction_pct)}%</dd>
                  </dl>
                  <p className="mt-2 text-footnote text-fg-muted">{possessionLabel(u.expected_possession_window)}</p>

                  <div className="mt-3 flex items-center gap-2">
                    <ScoreDial value={u.flexibility.value} size={44} />
                    <span className="text-footnote text-fg-muted">Flexibility</span>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {u.gates.map((g) => (
                      <GateChip key={g.category_code} state={g.display_state} note={g.customer_label} />
                    ))}
                  </div>

                  {u.match && (
                    <div className="mt-4 border-t border-line pt-3">
                      <div className="flex items-center justify-between">
                        <span className="text-footnote font-semibold uppercase tracking-wide text-fg-subtle">Match</span>
                        <span className="text-title3 font-bold text-accent">{Math.round(u.match.score)}</span>
                      </div>
                      {u.match.stale_inputs && (
                        <p className="mt-1 text-caption text-atrisk">Needs may be out of date — recheck with the prospect.</p>
                      )}
                      <ul className="mt-2 flex flex-col gap-1">
                        {u.match.explanation.map((ex, i) => (
                          <li key={i} className="text-caption text-fg-muted">
                            <span className="font-medium text-fg">{CATEGORY_LABEL[ex.category] ?? ex.category}:</span> {ex.text}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </div>
            {result.disclaimer && <p className="mt-4 text-caption text-fg-subtle">{result.disclaimer}</p>}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

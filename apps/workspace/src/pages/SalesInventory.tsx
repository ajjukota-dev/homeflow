import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Home } from "lucide-react";
import { api, type Unit } from "../api";
import { Card, CardBody } from "../ui/Card";
import { GateChip } from "../ui/GateChip";
import { ScoreDial } from "../ui/ScoreDial";
import { Button } from "../ui/Button";
import { saleStatusLabel } from "../lib/labels";

/** Pitch-angle logic (sales/spec.md §1.3) — derived from the live score. */
function pitchAngle(score: number): string {
  if (score >= 80) return "Best for a buyer who wants to personalise";
  if (score >= 45) return "Personalise soon — windows closing";
  if (score >= 25) return "Best for fast possession";
  return "Move-in ready";
}

/** Sales — inventory with live changeability. Read-only: Sales never edits physics. */
export function SalesInventory({ projectId, onBook }: { projectId: string; onBook: (u: Unit) => void }) {
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    return api
      .listUnits(projectId)
      .then(setUnits)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [projectId]);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-large font-bold">Inventory</h1>
          <p className="mt-1 max-w-xl text-subhead text-fg-muted">
            Live customisation windows per villa. Read-only — change progress on the Site screen,
            then refresh to watch the gates move.
          </p>
        </div>
        <Button variant="tinted" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          Refresh
        </Button>
      </header>

      {error ? (
        <Card>
          <CardBody className="text-subhead text-overdue">
            Couldn’t reach the API. Is the backend running on :3001?
          </CardBody>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {loading
            ? [0, 1, 2].map((i) => (
                <div key={i} className="h-72 animate-pulse rounded-xl border border-line bg-surface-2" />
              ))
            : units.map((u) => (
                <Card key={u.id} className="overflow-hidden">
                  <div className="flex h-32 items-center justify-center bg-surface-2 text-fg-subtle">
                    <Home className="h-9 w-9" aria-hidden />
                  </div>
                  <CardBody>
                    <div className="flex items-start justify-between">
                      <div>
                        <h2 className="text-title3 font-semibold">Villa {u.unit_number}</h2>
                        <p className="text-footnote text-fg-muted">
                          {u.unit_type} · {u.facing} facing
                        </p>
                      </div>
                      <ScoreDial value={u.score} size={56} />
                    </div>
                    <p className="mt-3 text-footnote text-fg-subtle">{pitchAngle(u.score)}</p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {u.gates
                        .filter((g) => g.customer_visible)
                        .map((g) => (
                          <GateChip key={g.category_code} state={g.state} />
                        ))}
                    </div>
                    <div className="mt-4">
                      {u.sale_status === "available" ? (
                        <Button size="sm" className="w-full" onClick={() => onBook(u)}>
                          Book this villa
                        </Button>
                      ) : (
                        <span className="inline-block rounded-full bg-surface-2 px-3 py-1 text-footnote font-medium text-fg-muted">
                          {saleStatusLabel(u.sale_status)}
                        </span>
                      )}
                    </div>
                  </CardBody>
                </Card>
              ))}
        </div>
      )}
    </div>
  );
}

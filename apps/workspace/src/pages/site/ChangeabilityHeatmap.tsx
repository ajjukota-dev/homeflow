import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardBody, Tooltip, TooltipProvider } from "@homeflow/ui";
import { GateChip, type GateState } from "../../ui/GateChip";
import { changeabilityApi, type ProjectChangeabilityRow } from "./changeability-api";

const STATES: GateState[] = ["OPEN", "CLOSING", "CONDITIONAL", "EXCEPTION_ONLY", "HARD_CLOSED"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// expected_close_at is a date-only string (no time component) — lib/utils.ts's own
// formatIstDateTime is for full timestamps and would print a misleading "00:00".
function formatDateOnly(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** 08-changeability-engine.md Screens: "Project changeability heatmap (Site/Management)" — units
 *  x categories, five-state chips (icon + label, never colour only, via the existing GateChip).
 *  Category labels are derived from the first unit's own matrix (customer_label lives per-gate on
 *  GET /units/:id/changeability, not on the project-level row) rather than hard-coded, so a future
 *  Policy Studio re-seed of change_category needs no matching frontend edit. */
export function ChangeabilityHeatmap({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<ProjectChangeabilityRow[] | null>(null);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [error, setError] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [stateFilter, setStateFilter] = useState<GateState | "ALL">("ALL");
  const [mobileUnit, setMobileUnit] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!projectId) return;
    setError(false);
    changeabilityApi
      .project(projectId)
      .then(async (r) => {
        setRows(r);
        const firstUnit = r[0]?.unit_id;
        if (firstUnit) {
          const matrix = await changeabilityApi.unit(firstUnit);
          setLabels(Object.fromEntries(matrix.gates.map((g) => [g.category_code, g.customer_label])));
        }
      })
      .catch(() => setError(true));
  }, [projectId]);

  useEffect(load, [load]);

  const categories = useMemo(() => {
    const codes = new Set<string>();
    for (const r of rows ?? []) for (const g of r.gates) codes.add(g.category_code);
    return Array.from(codes);
  }, [rows]);

  const visibleRows = useMemo(
    () =>
      (rows ?? []).filter((r) =>
        r.gates.some((g) => {
          if (categoryFilter !== "ALL" && g.category_code !== categoryFilter) return false;
          if (stateFilter !== "ALL" && g.state !== stateFilter) return false;
          return true;
        })
      ),
    [rows, categoryFilter, stateFilter]
  );

  if (error) {
    return (
      <Card>
        <CardBody className="text-subhead text-overdue">Couldn't reach the API on :3001.</CardBody>
      </Card>
    );
  }
  if (rows === null) {
    return (
      <div className="grid grid-cols-1 gap-2" aria-busy="true" aria-label="Loading changeability heatmap">
        {[0, 1, 2].map((i) => <div key={i} className="h-14 animate-pulse rounded-xl border border-line bg-surface-2" />)}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <Card>
        <CardBody className="py-10 text-center text-subhead text-fg-muted">No units in this project yet.</CardBody>
      </Card>
    );
  }

  const mobileRow = mobileUnit ? rows.find((r) => r.unit_id === mobileUnit) : null;

  return (
    <TooltipProvider>
      <div>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-footnote">
            <option value="ALL">Every category</option>
            {categories.map((c) => <option key={c} value={c}>{labels[c] ?? c}</option>)}
          </select>
          <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value as typeof stateFilter)} className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-footnote">
            <option value="ALL">Every state</option>
            {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {/* Desktop/tablet grid */}
        <Card className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[640px] text-footnote">
            <thead>
              <tr className="text-caption uppercase tracking-wide text-fg-subtle">
                <th className="p-2 text-left">Unit</th>
                <th className="p-2 text-left">Flexibility</th>
                {categories.map((c) => <th key={c} className="p-2 text-left">{labels[c] ?? c}</th>)}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.unit_id} className="border-t border-line">
                  <td className="p-2 font-semibold">{row.unit_number}</td>
                  <td className="p-2 tabular-nums text-fg-muted">{Math.round(row.flexibility)}%</td>
                  {categories.map((c) => {
                    const g = row.gates.find((x) => x.category_code === c);
                    return <td key={c} className="p-2">{g ? <GateCell gate={g} label={labels[c] ?? c} /> : "—"}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        {/* Mobile: unit list -> per-unit gate list (same shape as the Progress console's own mobile view) */}
        <div className="md:hidden">
          {!mobileRow ? (
            <div className="flex flex-col gap-2">
              {visibleRows.map((row) => (
                <button key={row.unit_id} onClick={() => setMobileUnit(row.unit_id)} className="flex items-center justify-between rounded-xl border border-line bg-surface p-3 text-left">
                  <span className="font-semibold">{row.unit_number}</span>
                  <span className="text-caption text-fg-muted">{Math.round(row.flexibility)}% flexible</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <button onClick={() => setMobileUnit(null)} className="text-left text-footnote font-medium text-accent">← All units</button>
              <h2 className="text-title3 font-semibold">{mobileRow.unit_number}</h2>
              {mobileRow.gates.map((g) => (
                <Card key={g.category_code}>
                  <CardBody className="flex items-center justify-between">
                    <span className="font-medium">{labels[g.category_code] ?? g.category_code}</span>
                    <GateCell gate={g} label={labels[g.category_code] ?? g.category_code} />
                  </CardBody>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}

function GateCell({ gate, label }: { gate: ProjectChangeabilityRow["gates"][number]; label: string }) {
  const note = gate.state === "CLOSING" && gate.expected_close_at ? `closes ~${formatDateOnly(gate.expected_close_at)}` : gate.exception_open ? "exception active" : gate.freshness_status === "VERIFICATION_REQUIRED" ? "verification required" : undefined;
  const tip = `${label}${gate.expected_close_at ? ` · expected close ${formatDateOnly(gate.expected_close_at)}` : ""}${gate.freshness_status === "VERIFICATION_REQUIRED" ? " · a trigger reading is stale" : ""}`;
  return (
    <Tooltip content={tip}>
      <span>
        <GateChip state={gate.state} note={note} />
      </span>
    </Tooltip>
  );
}

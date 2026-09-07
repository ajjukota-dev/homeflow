import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardBody, Button, Tooltip, TooltipProvider } from "@homeflow/ui";
import { formatIstDateTime, cn } from "../../lib/utils";
import { modelApi, type HierarchyNode } from "../../api-model";
import { progressApi, type UnitProgressRow, type ProgressCell, type SpecProgressState, type Freshness } from "./api";
import { STATE_META, FRESHNESS_META, WRITE_ROLES } from "./labels";
import { CellEditDialog } from "./CellEditDialog";
import { BulkUpdateDrawer } from "./BulkUpdateDrawer";

const STATE_FILTERS: (SpecProgressState | "ALL")[] = ["ALL", "NOT_STARTED", "IN_PROGRESS", "COMPLETE", "VERIFIED", "REWORK"];
const FRESHNESS_FILTERS: (Freshness | "ALL")[] = ["ALL", "FRESH", "STALE", "VERIFICATION_REQUIRED"];

// The structure family is the real seeded `structure` component plus any child of it via
// parent_code — the demo's 4-component set (structure/mep_first_fix/flooring/finishing) has no
// separately-seeded children of `structure`, so the console treats exactly `structure` as the
// pct-eligible one (rule 8).
function isStructureFamily(componentCode: string): boolean {
  return componentCode === "structure";
}

/** 07-unit-progress-control.md Screens: "Project Unit Status Console" — grid units x components,
 *  filters, bulk-update drawer, reopen (regression) handled inline in the cell edit dialog. */
export function ProgressConsole({ projectId, roles }: { projectId: string; roles: string[] }) {
  const [rows, setRows] = useState<UnitProgressRow[]>([]);
  const [nodes, setNodes] = useState<HierarchyNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [componentFilter, setComponentFilter] = useState("ALL");
  const [stateFilter, setStateFilter] = useState<SpecProgressState | "ALL">("ALL");
  const [freshnessFilter, setFreshnessFilter] = useState<Freshness | "ALL">("ALL");
  const [editing, setEditing] = useState<{ unitId: string; unitNumber: string; cell: ProgressCell } | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [mobileUnit, setMobileUnit] = useState<string | null>(null);

  const canWrite = roles.some((r) => WRITE_ROLES.includes(r));

  const load = useCallback(() => {
    if (!projectId) return;
    setLoading(true);
    setError(false);
    Promise.all([progressApi.projectProgress(projectId), modelApi.listHierarchy(projectId)])
      .then(([r, h]) => { setRows(r); setNodes(h); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(load, [load]);

  const components = useMemo(() => {
    const first = rows[0]?.components ?? [];
    return first.map((c) => ({ code: c.component_code, label: c.label }));
  }, [rows]);

  const visibleRows = useMemo(
    () =>
      rows.filter((r) =>
        r.components.some((c) => {
          if (componentFilter !== "ALL" && c.component_code !== componentFilter) return false;
          if (stateFilter !== "ALL" && c.state_code !== stateFilter) return false;
          if (freshnessFilter !== "ALL" && c.freshness !== freshnessFilter) return false;
          return true;
        })
      ),
    [rows, componentFilter, stateFilter, freshnessFilter]
  );

  function updateLocalUnit(unitId: string, components: ProgressCell[]) {
    setRows((prev) => prev.map((r) => (r.unit_id === unitId ? { ...r, components } : r)));
  }

  if (error) {
    return (
      <Card>
        <CardBody className="text-subhead text-overdue">Couldn't reach the API on :3001.</CardBody>
      </Card>
    );
  }
  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-2" aria-busy="true" aria-label="Loading progress console">
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
          <select value={componentFilter} onChange={(e) => setComponentFilter(e.target.value)} className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-footnote">
            <option value="ALL">Every component</option>
            {components.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
          </select>
          <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value as typeof stateFilter)} className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-footnote">
            {STATE_FILTERS.map((s) => <option key={s} value={s}>{s === "ALL" ? "Every state" : STATE_META[s].label}</option>)}
          </select>
          <select value={freshnessFilter} onChange={(e) => setFreshnessFilter(e.target.value as typeof freshnessFilter)} className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-footnote">
            {FRESHNESS_FILTERS.map((f) => <option key={f} value={f}>{f === "ALL" ? "Every freshness" : FRESHNESS_META[f].label}</option>)}
          </select>
          {canWrite && (
            <Button size="sm" variant="secondary" onClick={() => setBulkOpen(true)} className="ml-auto">
              Bulk update
            </Button>
          )}
        </div>

        {/* Desktop/tablet grid */}
        <Card className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[640px] text-footnote">
            <thead>
              <tr className="text-caption uppercase tracking-wide text-fg-subtle">
                <th className="p-2 text-left">Unit</th>
                {components.map((c) => <th key={c.code} className="p-2 text-left">{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.unit_id} className="border-t border-line">
                  <td className="p-2 font-semibold">{row.unit_number}</td>
                  {row.components.map((c) => (
                    <td key={c.component_code} className="p-2">
                      <Cell cell={c} onClick={canWrite ? () => setEditing({ unitId: row.unit_id, unitNumber: row.unit_number, cell: c }) : undefined} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        {/* Mobile: unit list -> per-unit checklist (spec's own explicit mobile layout, not a squeezed grid) */}
        <div className="md:hidden">
          {!mobileRow ? (
            <div className="flex flex-col gap-2">
              {visibleRows.map((row) => (
                <button
                  key={row.unit_id}
                  onClick={() => setMobileUnit(row.unit_id)}
                  className="flex items-center justify-between rounded-xl border border-line bg-surface p-3 text-left"
                >
                  <span className="font-semibold">{row.unit_number}</span>
                  <span className="flex gap-1">
                    {row.components.map((c) => {
                      const m = STATE_META[c.state_code];
                      return <m.Icon key={c.component_code} className={cn("h-4 w-4", m.className.split(" ")[0])} aria-hidden />;
                    })}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <Button size="sm" variant="ghost" onClick={() => setMobileUnit(null)}>← All units</Button>
              <h2 className="text-title3 font-semibold">{mobileRow.unit_number}</h2>
              {mobileRow.components.map((c) => (
                <Card key={c.component_code}>
                  <CardBody>
                    <div className="mb-2 flex items-center justify-between">
                      <span className="font-medium">{c.label}</span>
                      <Cell cell={c} onClick={canWrite ? () => setEditing({ unitId: mobileRow.unit_id, unitNumber: mobileRow.unit_number, cell: c }) : undefined} />
                    </div>
                    <p className="text-caption text-fg-muted">
                      {c.updated_by_name ?? "—"} · {formatIstDateTime(c.updated_at)}
                    </p>
                  </CardBody>
                </Card>
              ))}
            </div>
          )}
        </div>

        {editing && (
          <CellEditDialog
            open
            unitId={editing.unitId}
            unitNumber={editing.unitNumber}
            cell={editing.cell}
            roles={roles}
            isStructureFamily={isStructureFamily(editing.cell.component_code)}
            onClose={() => setEditing(null)}
            onSaved={(components) => { updateLocalUnit(editing.unitId, components); setEditing(null); }}
          />
        )}

        <BulkUpdateDrawer
          open={bulkOpen}
          onOpenChange={setBulkOpen}
          projectId={projectId}
          roles={roles}
          components={components}
          nodes={nodes}
          onApplied={load}
        />
      </div>
    </TooltipProvider>
  );
}

function Cell({ cell, onClick }: { cell: ProgressCell; onClick?: () => void }) {
  const state = STATE_META[cell.state_code];
  const fresh = FRESHNESS_META[cell.freshness];
  const content = (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-footnote font-medium",
        state.className,
        onClick && "cursor-pointer hover:opacity-80"
      )}
    >
      <state.Icon className="h-3.5 w-3.5" aria-hidden />
      {state.label}
      {fresh.Icon && <fresh.Icon className={cn("h-3.5 w-3.5", fresh.className)} aria-hidden />}
    </span>
  );
  const trigger = onClick ? (
    <button onClick={onClick} className="text-left">{content}</button>
  ) : (
    content
  );
  return (
    <Tooltip content={`${cell.source} · ${cell.updated_by_name ?? "—"} · ${formatIstDateTime(cell.updated_at)}${cell.freshness !== "FRESH" ? ` · ${fresh.label}` : ""}`}>
      {trigger}
    </Tooltip>
  );
}

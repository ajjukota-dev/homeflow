import { useCallback, useEffect, useState } from "react";
import { Card, CardBody, Button, EmptyState, Skeleton } from "@homeflow/ui";
import { RefreshCw, Home, Scale, Clock } from "lucide-react";
import { salesApi, type InventoryUnit, type Prospect } from "./api";
import { NAMED_FILTERS, possessionLabel } from "./labels";
import { GateChip } from "../../ui/GateChip";
import { ScoreDial } from "../../ui/ScoreDial";
import { MoneyFigure } from "../../ui/MoneyFigure";
import { CompareDrawer } from "./CompareDrawer";
import { BookUnitDialog } from "./BookUnitDialog";

const BOOK_ROLES = ["SALES", "CRM", "SUPER_ADMIN"]; // sales/booking.ts's real authorize("sales_handover", "WRITE") grant — MANAGEMENT is READ-only there

function UnitCard({
  unit,
  selected,
  onToggleCompare,
  onBook,
  canBook,
}: {
  unit: InventoryUnit;
  selected: boolean;
  onToggleCompare: () => void;
  onBook: () => void;
  canBook: boolean;
}) {
  return (
    <Card className={selected ? "overflow-hidden ring-2 ring-accent" : "overflow-hidden"}>
      <div className="flex h-24 items-center justify-center bg-surface-2 text-fg-subtle">
        <Home className="h-8 w-8" aria-hidden />
      </div>
      <CardBody>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-title3 font-semibold text-fg">Villa {unit.unit_number}</h3>
            <p className="text-footnote text-fg-muted">
              {unit.unit_type} · {unit.facing} facing
            </p>
          </div>
          <ScoreDial value={unit.flexibility.value} size={48} label="Flex" />
        </div>

        <div className="mt-2">{unit.price_inr !== null ? <MoneyFigure amount={unit.price_inr} /> : <span className="text-footnote text-fg-subtle">Price not set</span>}</div>
        <p className="mt-1 text-footnote text-fg-muted">{possessionLabel(unit.expected_possession_window)}</p>

        {unit.closing_soon && (
          <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-due/10 px-2 py-0.5 text-caption font-medium text-due">
            <Clock className="h-3 w-3" /> Closing soon
          </p>
        )}

        <div className="mt-3 flex flex-wrap gap-1.5">
          {unit.gates.slice(0, 4).map((g) => (
            <GateChip key={g.category_code} state={g.display_state} note={g.customer_label} />
          ))}
        </div>

        <div className="mt-4 flex gap-2">
          <Button variant="secondary" size="sm" className="flex-1" onClick={onToggleCompare}>
            <Scale className="h-3.5 w-3.5" /> {selected ? "Remove" : "Compare"}
          </Button>
          {canBook && unit.sale_status === "AVAILABLE" && (
            <Button size="sm" className="flex-1" onClick={onBook}>
              Book
            </Button>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

/** 24-sales-inventory-discovery.md rule 1/2/3 Screen "Sales Inventory grid" — additive to the
 *  pre-24 SalesInventory.tsx (kept unchanged for its own e2e coverage): named filters, compare
 *  tray (3-4 units), closing-soon ribbon, real flexibility/gate/possession data. */
export function InventoryGrid({ projectId, roles, prospects }: { projectId: string; roles: string[]; prospects: Prospect[] }) {
  const [units, setUnits] = useState<InventoryUnit[] | null>(null);
  const [error, setError] = useState(false);
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [bookUnit, setBookUnit] = useState<InventoryUnit | null>(null);

  const canBook = roles.some((r) => BOOK_ROLES.includes(r));

  const load = useCallback(() => {
    if (!projectId) return;
    setError(false);
    salesApi.inventory(projectId, { filters: activeFilters.length ? activeFilters : undefined }).then(setUnits).catch(() => setError(true));
  }, [projectId, activeFilters]);
  useEffect(load, [load]);

  function toggleFilter(key: string) {
    setActiveFilters((cur) => (cur.includes(key) ? cur.filter((f) => f !== key) : [...cur, key]));
  }

  function toggleCompare(unitId: string) {
    setSelected((cur) => {
      if (cur.includes(unitId)) return cur.filter((id) => id !== unitId);
      if (cur.length >= 4) return cur; // rule 1: compare is 3-4 units only
      return [...cur, unitId];
    });
  }

  const closingSoonCount = (units ?? []).filter((u) => u.closing_soon).length;

  return (
    <div>
      <header className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-title2 font-bold text-fg">Inventory</h2>
          <p className="mt-1 max-w-xl text-footnote text-fg-muted">
            Live changeability, named filters, and side-by-side comparison — read-only physics, same matrix as Site.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={load}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </header>

      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Named filters">
        {NAMED_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => toggleFilter(f.key)}
            aria-pressed={activeFilters.includes(f.key)}
            className={
              activeFilters.includes(f.key)
                ? "rounded-full border border-accent bg-accent/10 px-3 py-1 text-footnote font-medium text-accent"
                : "rounded-full border border-line bg-surface px-3 py-1 text-footnote font-medium text-fg-muted hover:border-fg-subtle"
            }
          >
            {f.label}
            {f.key === "closing_soon" && closingSoonCount > 0 ? ` (${closingSoonCount})` : ""}
          </button>
        ))}
      </div>

      {error && (
        <Card>
          <CardBody className="text-subhead text-overdue">Couldn't reach the API on :3001.</CardBody>
        </Card>
      )}
      {!error && units === null && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="Loading inventory">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-72" />
          ))}
        </div>
      )}
      {!error && units !== null && units.length === 0 && (
        <EmptyState icon={Home} message="No units match the selected filters." />
      )}
      {!error && units !== null && units.length > 0 && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {units.map((u) => (
            <UnitCard
              key={u.unit_id}
              unit={u}
              selected={selected.includes(u.unit_id)}
              onToggleCompare={() => toggleCompare(u.unit_id)}
              onBook={() => setBookUnit(u)}
              canBook={canBook}
            />
          ))}
        </div>
      )}

      {selected.length >= 3 && (
        <div className="fixed bottom-6 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-full border border-line bg-surface px-5 py-3 shadow-panel">
          <span className="text-footnote font-medium text-fg">{selected.length} unit{selected.length > 1 ? "s" : ""} selected</span>
          <Button size="sm" onClick={() => setCompareOpen(true)}>Compare</Button>
          <Button size="sm" variant="secondary" onClick={() => setSelected([])}>Clear</Button>
        </div>
      )}

      <CompareDrawer unitIds={compareOpen ? selected : null} prospects={prospects} onClose={() => setCompareOpen(false)} />
      <BookUnitDialog unit={bookUnit} prospects={prospects} onClose={() => setBookUnit(null)} onBooked={load} />
    </div>
  );
}

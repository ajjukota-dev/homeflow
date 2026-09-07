import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { api, type ProgressState, type Unit } from "../api";
import { Card, CardBody, Segmented, Button, Tabs, TabsList, TabsTrigger } from "@homeflow/ui";
import { GateChip } from "../ui/GateChip";
import { ScoreDial } from "../ui/ScoreDial";
import { cn } from "../lib/utils";
import { ProgressConsole } from "./site/ProgressConsole";
import { ChangeabilityHeatmap } from "./site/ChangeabilityHeatmap";
import { WRITE_ROLES } from "./site/labels";

const STATES: { value: ProgressState; label: string }[] = [
  { value: "not_started", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "complete", label: "Complete" },
  { value: "verified", label: "Verified" },
];

const inputCls = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-subhead outline-none focus:border-accent";

/** Project / Site — create units + record physical progress; gates re-derive server-side (H1).
 *  07-unit-progress-control.md's "Project Unit Status Console" (grid, filters, bulk update,
 *  freshness) lives in the "Console" tab; "By villa" keeps this page's own pre-existing single-
 *  unit segmented-control view (still useful for a quick one-cell update on-site). */
export function SiteProgress({ projectId, roles }: { projectId: string; roles: string[] }) {
  const canWrite = roles.some((r) => WRITE_ROLES.includes(r));
  const [tab, setTab] = useState<"villa" | "console" | "changeability">("villa");
  const [units, setUnits] = useState<Unit[]>([]);
  const [unit, setUnit] = useState<Unit | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [uNumber, setUNumber] = useState("");
  const [uType, setUType] = useState("3BHK");
  const [uFacing, setUFacing] = useState("East");

  const load = useCallback(() => {
    if (!projectId) return;
    setLoading(true);
    api
      .listUnits(projectId)
      .then((u) => {
        setUnits(u);
        return u[0] ? api.getUnit(u[0].id).then(setUnit) : setUnit(null);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  async function createUnit() {
    if (!uNumber.trim()) return;
    const created = await api.createUnit(projectId, { unit_number: uNumber, unit_type: uType, facing: uFacing });
    setUNumber("");
    setAddOpen(false);
    const list = await api.listUnits(projectId);
    setUnits(list);
    setUnit(await api.getUnit(created.id));
  }

  async function pick(id: string) {
    setUnit(await api.getUnit(id));
  }
  async function setState(component: string, state: ProgressState) {
    if (!unit) return;
    setSaving(component);
    try {
      setUnit(await api.setProgress(unit.id, component, state));
    } finally {
      setSaving(null);
    }
  }

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-large font-bold">Unit Progress Control</h1>
        <p className="mt-1 max-w-2xl text-subhead text-fg-muted">
          Record construction progress. Changeability gates re-derive automatically — Sales sees
          it instantly. You own physical truth; Sales can only read it.
        </p>
      </header>

      <div className="mb-6 overflow-x-auto">
        <Tabs value={tab} onValueChange={(v) => setTab(v as "villa" | "console" | "changeability")}>
          <TabsList className="flex-nowrap">
            <TabsTrigger value="villa" className="shrink-0 whitespace-nowrap">By villa</TabsTrigger>
            <TabsTrigger value="console" className="shrink-0 whitespace-nowrap">Console</TabsTrigger>
            <TabsTrigger value="changeability" className="shrink-0 whitespace-nowrap">Changeability</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {tab === "console" && <ProgressConsole projectId={projectId} roles={roles} />}
      {tab === "changeability" && <ChangeabilityHeatmap projectId={projectId} />}

      {tab === "villa" && (
      <>
      {error && (
        <Card>
          <CardBody className="text-subhead text-overdue">
            Couldn’t reach the API. Is the backend running on :3001?
          </CardBody>
        </Card>
      )}

      {loading && !error && <SkeletonRows />}

      {!loading && !error && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {units.map((u) => (
              <button
                key={u.id}
                onClick={() => pick(u.id)}
                aria-pressed={unit?.id === u.id}
                className={cn(
                  "min-h-9 rounded-full border px-4 text-subhead font-semibold transition-colors",
                  unit?.id === u.id
                    ? "border-transparent bg-fg text-surface"
                    : "border-line bg-surface text-fg hover:bg-surface-2"
                )}
              >
                {u.unit_number}
              </button>
            ))}
            {!addOpen && (
              <Button size="sm" variant="secondary" onClick={() => setAddOpen(true)}>
                <Plus className="h-4 w-4" /> New unit
              </Button>
            )}
          </div>

          {addOpen && (
            <Card className="mb-6">
              <CardBody className="flex flex-wrap items-end gap-3">
                <label className="flex-1">
                  <span className="mb-1 block text-caption text-fg-muted">Unit number</span>
                  <input className={inputCls} value={uNumber} onChange={(e) => setUNumber(e.target.value)} placeholder="e.g. V112" autoFocus />
                </label>
                <label>
                  <span className="mb-1 block text-caption text-fg-muted">Type</span>
                  <input className={cn(inputCls, "w-28")} value={uType} onChange={(e) => setUType(e.target.value)} />
                </label>
                <label>
                  <span className="mb-1 block text-caption text-fg-muted">Facing</span>
                  <input className={cn(inputCls, "w-24")} value={uFacing} onChange={(e) => setUFacing(e.target.value)} />
                </label>
                <Button size="sm" onClick={createUnit}>Create</Button>
                <Button size="sm" variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
              </CardBody>
            </Card>
          )}

          {!unit && units.length === 0 && !addOpen && (
            <Card>
              <CardBody className="py-10 text-center text-subhead text-fg-muted">
                No units in this project yet. Add your first villa to start tracking progress.
              </CardBody>
            </Card>
          )}

          {unit && (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Card>
              <CardBody>
                <h2 className="mb-4 text-title3 font-semibold">
                  {unit.unit_number}
                  <span className="ml-2 text-subhead font-normal text-fg-muted">
                    {unit.unit_type} · {unit.facing} facing
                  </span>
                </h2>
                <div className="flex flex-col gap-5">
                  {unit.components?.map((c) => (
                    <div key={c.code}>
                      <div className="mb-2 flex items-center gap-2 text-subhead text-fg-muted">
                        {c.label}
                        {saving === c.code && <span className="text-caption text-fg-subtle">saving…</span>}
                      </div>
                      {canWrite ? (
                        <Segmented
                          aria-label={`${c.label} progress`}
                          options={STATES}
                          value={c.state_code}
                          onChange={(s) => setState(c.code, s)}
                        />
                      ) : (
                        <span className="inline-flex rounded-full bg-surface-2 px-3 py-1.5 text-subhead font-medium text-fg">
                          {STATES.find((s) => s.value === c.state_code)?.label ?? c.state_code}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardBody>
                <h2 className="text-title3 font-semibold">Resulting changeability</h2>
                <p className="mt-1 text-footnote text-fg-muted">
                  Derived live from the progress on the left.
                </p>
                <div className="my-5 flex items-center gap-4">
                  <ScoreDial value={unit.score} size={84} />
                  <div className="text-subhead text-fg-muted">
                    Customisation flexibility index for this villa.
                  </div>
                </div>
                <div className="flex flex-col gap-2.5">
                  {unit.gates.map((g) => (
                    <div key={g.category_code} className="flex items-center justify-between gap-3">
                      <span className="text-body">{g.customer_label}</span>
                      <GateChip state={g.state} note={g.state !== "OPEN" ? g.reason : undefined} />
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          </div>
          )}
        </>
      )}
      </>
      )}
    </div>
  );
}

function SkeletonRows() {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2" aria-busy="true" aria-label="Loading">
      {[0, 1].map((i) => (
        <div key={i} className="h-64 animate-pulse rounded-xl border border-line bg-surface-2" />
      ))}
    </div>
  );
}

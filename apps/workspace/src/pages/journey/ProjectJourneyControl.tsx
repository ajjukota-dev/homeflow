import { useEffect, useState } from "react";
import { PageHeader, Table, type TableColumn, Checkbox, Button, Badge, Card, CardBody } from "@homeflow/ui";
import { journeyApi, type ProjectJourneyControl as ProjectJourneyControlData, type JourneyControlRow } from "./api";
import { PlanRevisionDialog } from "./PlanRevisionDialog";

function fmtDate(d: string): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

const HEALTH_TONE: Record<string, string> = {
  ON_TRACK: "text-ontrack",
  DUE_SOON: "text-due",
  AT_RISK: "text-overdue",
  OVERDUE: "text-overdue",
};

/** Project Journey Control (06-timeline-sla-engine.md Screens): "table of journeys with health,
 *  current stage per stream, forecast handover, slippage; filters; bulk plan revision (e.g. tower
 *  slab delay shifts N journeys with one reason)." Bulk revision reuses PlanRevisionDialog with
 *  every checked journey's id — no dedicated bulk backend endpoint, per plan-revision.ts's own
 *  header note. */
export function ProjectJourneyControl({ projectId }: { projectId: string }) {
  const [data, setData] = useState<ProjectJourneyControlData | null>(null);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [healthFilter, setHealthFilter] = useState<string | null>(null);
  const [revising, setRevising] = useState(false);

  function load() {
    if (!projectId) return;
    setError(false);
    journeyApi.getProjectControl(projectId).then(setData).catch(() => setError(true));
  }
  useEffect(() => {
    setData(null);
    setSelected(new Set());
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const rows = (data?.journeys ?? []).filter((j) => !healthFilter || j.health === healthFilter);
  const selectedRows = rows.filter((r) => selected.has(r.journey_id));
  const commonStageOptions =
    selectedRows.length > 0
      ? selectedRows[0].current_stage_per_stream.map((s) => ({ value: s.stage_code, label: s.name }))
      : rows[0]?.current_stage_per_stream.map((s) => ({ value: s.stage_code, label: s.name })) ?? [];

  function toggle(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const columns: TableColumn<JourneyControlRow>[] = [
    {
      key: "select",
      header: "",
      width: 40,
      render: (row) => <Checkbox checked={selected.has(row.journey_id)} onCheckedChange={(c) => toggle(row.journey_id, c === true)} aria-label={`Select ${row.customer_name}`} />,
    },
    {
      key: "customer",
      header: "Customer / unit",
      render: (row) => (
        <div>
          <div className="font-medium text-fg">{row.customer_name}</div>
          <div className="text-footnote text-fg-muted">{row.unit_number} · {row.booking_number}</div>
        </div>
      ),
    },
    {
      key: "health",
      header: "Health",
      width: 120,
      render: (row) => <span className={HEALTH_TONE[row.health] ?? "text-fg"}>{row.health.replace("_", " ")}</span>,
    },
    {
      key: "current_stage",
      header: "Current stage per stream",
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.current_stage_per_stream.length === 0 ? (
            <span className="text-fg-muted">All streams closed</span>
          ) : (
            row.current_stage_per_stream.map((s) => (
              <Badge key={s.stream}>{s.name}</Badge>
            ))
          )}
        </div>
      ),
    },
    { key: "planned", header: "Planned handover", width: 140, render: (row) => fmtDate(row.planned_handover) },
    { key: "forecast", header: "Forecast handover", width: 140, render: (row) => fmtDate(row.forecast_handover) },
    {
      key: "slippage",
      header: "Slippage",
      width: 100,
      render: (row) => (row.slippage_days === 0 ? <span className="text-fg-muted">On plan</span> : <span className={row.slippage_days > 0 ? "text-overdue" : "text-ontrack"}>{row.slippage_days > 0 ? "+" : ""}{row.slippage_days}d</span>),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Project Journey Control"
        description="Every journey on this project — health, current stage per stream, forecast handover, and slippage (06-timeline-sla-engine.md)."
        actions={
          selected.size > 0 ? (
            <Button size="sm" onClick={() => setRevising(true)}>
              Revise plan for {selected.size} journey{selected.size === 1 ? "" : "s"}
            </Button>
          ) : undefined
        }
      />

      {data && data.top_delay_reasons.length > 0 && (
        <Card>
          <CardBody>
            <div className="mb-2 text-ws-sm font-medium text-fg">Top delay reasons on this project</div>
            <div className="flex flex-wrap gap-2">
              {data.top_delay_reasons.map((r) => (
                <Badge key={r.code}>{r.label} · {r.count}</Badge>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      {data && (
        <div className="flex items-center gap-2">
          <span className="text-footnote text-fg-muted">Filter:</span>
          {["ON_TRACK", "DUE_SOON", "AT_RISK", "OVERDUE"].map((h) => (
            <button
              key={h}
              onClick={() => setHealthFilter((prev) => (prev === h ? null : h))}
              className={`rounded-pill border px-2.5 py-1 text-footnote font-medium ${healthFilter === h ? "border-accent bg-accent-soft text-accent-soft-fg" : "border-line text-fg-muted"}`}
            >
              {h.replace("_", " ")}
            </button>
          ))}
        </div>
      )}

      <Table
        columns={columns}
        rows={rows}
        getRowId={(r) => r.journey_id}
        loading={!error && data === null}
        error={error ? { message: "Couldn't load journeys for this project.", onRetry: load } : undefined}
        emptyMessage="No journeys have started for this project yet."
      />

      {revising && (
        <PlanRevisionDialog
          journeyIds={Array.from(selected)}
          stageOptions={commonStageOptions}
          onClose={() => setRevising(false)}
          onSaved={() => {
            setRevising(false);
            setSelected(new Set());
            load();
          }}
        />
      )}
    </div>
  );
}

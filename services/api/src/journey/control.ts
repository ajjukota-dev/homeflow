import { db } from "../db";
import { requireRole, STAFF_ROLES } from "../authz/requireRole";
import { readVersionContent, type Stream } from "./templates";
import { asDateStr } from "./calendar";
import type { Ctx } from "../authz/types";

// Project Journey Control (06-timeline-sla-engine.md Screens): "table of journeys with health,
// current stage per stream, forecast handover, slippage; ... Management sees slippage by stage
// and delay reason across the Project" (p47 §34.7 t10). One query per journey rather than a
// single mega-join — same style as getJourneyForBooking (instances.ts) — with the per-template
// stage-label lookup cached across journeys that share a template_version_id (the common case:
// every booking on a project starts from the same published version until it's replaced).

export interface JourneyControlRow {
  journey_id: string;
  booking_id: string;
  booking_number: string;
  unit_number: string;
  customer_name: string;
  health: string;
  status: string;
  current_stage_per_stream: { stream: Stream; stage_code: string; name: string; status: string }[];
  planned_handover: string;
  forecast_handover: string;
  slippage_days: number;
}

export interface ProjectJourneyControlResult {
  journeys: JourneyControlRow[];
  top_delay_reasons: { code: string; label: string; count: number }[];
}

const ALL_STREAMS: Stream[] = ["COMMERCIAL", "LEGAL", "FINANCE", "CONSTRUCTION", "HANDOVER", "POST_HANDOVER"];
const OPEN_STAGE_STATUSES = ["NOT_STARTED", "IN_PROGRESS", "WAITING", "BLOCKED"];

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(a).getTime() - new Date(b).getTime()) / (24 * 60 * 60 * 1000));
}

export async function getProjectJourneyControl(projectId: string, ctx: Ctx): Promise<ProjectJourneyControlResult> {
  requireRole(ctx, STAFF_ROLES);

  const journeys = await db.query<{
    id: string; booking_id: string; booking_number: string; unit_number: string; customer_name: string;
    health: string; status: string; template_version_id: string;
  }>(
    `SELECT ji.id, ji.booking_id, b.booking_number, u.unit_number, c.display_name AS customer_name,
            ji.health, ji.status, ji.template_version_id
       FROM journey_instance ji
       JOIN booking b ON b.id = ji.booking_id
       JOIN unit u ON u.id = b.unit_id
       JOIN booking_applicant ba ON ba.booking_id = b.id AND ba.role = 'primary'
       JOIN customer c ON c.id = ba.customer_id
      WHERE ji.project_id = $1
      ORDER BY b.booking_number`,
    [projectId]
  );

  const stageNameCache = new Map<string, Map<string, { name: string; stream: Stream }>>();
  async function stageLabelsFor(templateVersionId: string): Promise<Map<string, { name: string; stream: Stream }>> {
    const cached = stageNameCache.get(templateVersionId);
    if (cached) return cached;
    const { stages } = await readVersionContent(templateVersionId, db);
    const map = new Map(stages.map((s) => [s.code, { name: s.name, stream: s.stream }]));
    stageNameCache.set(templateVersionId, map);
    return map;
  }

  const rows: JourneyControlRow[] = [];
  for (const j of journeys.rows) {
    const labels = await stageLabelsFor(j.template_version_id);
    const stages = await db.query<{ stage_code: string; status: string; baseline_start: string | Date; planned_end: string | Date; forecast_end: string | Date }>(
      `SELECT stage_code, status, baseline_start, planned_end, forecast_end FROM stage_instance WHERE journey_id = $1 ORDER BY baseline_start`,
      [j.id]
    );

    const perStream = new Map<Stream, { stage_code: string; status: string }>();
    for (const s of stages.rows) {
      const label = labels.get(s.stage_code);
      if (!label) continue;
      if (OPEN_STAGE_STATUSES.includes(s.status) && !perStream.has(label.stream)) {
        perStream.set(label.stream, { stage_code: s.stage_code, status: s.status });
      }
    }
    const current_stage_per_stream = ALL_STREAMS.filter((stream) => perStream.has(stream)).map((stream) => {
      const cur = perStream.get(stream)!;
      return { stream, stage_code: cur.stage_code, name: labels.get(cur.stage_code)?.name ?? cur.stage_code, status: cur.status };
    });

    const plannedEnd = stages.rows.length ? stages.rows.reduce((max, s) => (asDateStr(s.planned_end) > max ? asDateStr(s.planned_end) : max), "") : "";
    const forecastEnd = stages.rows.length ? stages.rows.reduce((max, s) => (asDateStr(s.forecast_end) > max ? asDateStr(s.forecast_end) : max), "") : "";

    rows.push({
      journey_id: j.id,
      booking_id: j.booking_id,
      booking_number: j.booking_number,
      unit_number: j.unit_number,
      customer_name: j.customer_name,
      health: j.health,
      status: j.status,
      current_stage_per_stream,
      planned_handover: plannedEnd,
      forecast_handover: forecastEnd,
      slippage_days: plannedEnd && forecastEnd ? daysBetween(forecastEnd, plannedEnd) : 0,
    });
  }

  const reasonCounts = await db.query<{ code: string; label: string; count: string }>(
    `SELECT dr.code, dr.label, COUNT(*) AS count
       FROM timeline_plan_revision tpr
       JOIN journey_instance ji ON ji.id = tpr.journey_id
       JOIN delay_reason dr ON dr.code = tpr.reason_code
      WHERE ji.project_id = $1
      GROUP BY dr.code, dr.label
      ORDER BY count DESC
      LIMIT 5`,
    [projectId]
  );

  return {
    journeys: rows,
    top_delay_reasons: reasonCounts.rows.map((r) => ({ code: r.code, label: r.label, count: Number(r.count) })),
  };
}

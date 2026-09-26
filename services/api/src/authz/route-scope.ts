import type { Response, NextFunction } from "express";
import { failHttp } from "./httpError";
import { assertProjectScope } from "./scope";
import { projectIdOf } from "./route-scope-lookup";
import type { AuthedRequest } from "../auth/middleware";
import type { Actor } from "./types";

// Project-data routes used to stop at requireRole. This gate runs after the session
// is loaded and calls assertProjectScope for every id that belongs to a project.
// A missing id is left to the handler (so a wrong role on a fake id stays forbidden).
// Management and Super Admin carry project_ids ALL and pass straight through.

type Mode = "read" | "write";

const PATH_RULES: Array<{ re: RegExp; entity: string }> = [
  { re: /^\/api\/portal\/requests\/quotations\/([^/]+)/, entity: "quotation" },
  { re: /^\/api\/portal\/requests\/service\/([^/]+)/, entity: "warranty_case" },
  { re: /^\/api\/portal\/documents\/([^/]+)/, entity: "customer_document" },
  { re: /^\/api\/portal\/advocacy\/([^/]+)/, entity: "advocacy" },
  { re: /^\/api\/portal\/check-ins\/([^/]+)/, entity: "customer_check_in" },
  { re: /^\/api\/portal\/bookings\/([^/]+)/, entity: "booking" },
  { re: /^\/api\/bookings\/([^/]+)/, entity: "booking" },
  { re: /^\/api\/registration\/([^/]+)/, entity: "booking" },
  { re: /^\/api\/handover\/([^/]+)/, entity: "booking" },
  { re: /^\/api\/units\/([^/]+)/, entity: "unit" },
  { re: /^\/api\/projects\/([^/]+)/, entity: "project" },
  { re: /^\/api\/teams\/([^/]+)\/day$/, entity: "project" },
  { re: /^\/api\/customisation-policy\/([^/]+)/, entity: "project" },
  { re: /^\/api\/customers\/([^/]+)/, entity: "customer" },
  { re: /^\/api\/demands\/([^/]+)/, entity: "demand" },
  { re: /^\/api\/actions\/([^/]+)/, entity: "action" },
  { re: /^\/api\/warranty-cases\/([^/]+)/, entity: "warranty_case" },
  { re: /^\/api\/loans\/([^/]+)/, entity: "loan_case" },
  { re: /^\/api\/receipts\/([^/]+)/, entity: "receipt" },
  { re: /^\/api\/tds\/([^/]+)/, entity: "tds_record" },
  { re: /^\/api\/waivers\/([^/]+)/, entity: "waiver" },
  { re: /^\/api\/journeys\/([^/]+)/, entity: "journey" },
  { re: /^\/api\/task-instances\/([^/]+)/, entity: "task" },
  { re: /^\/api\/escalations\/([^/]+)/, entity: "escalation" },
  { re: /^\/api\/commitments\/([^/]+)/, entity: "commitment" },
  { re: /^\/api\/post-handover\/([^/]+)/, entity: "post_handover_case" },
  { re: /^\/api\/interventions\/([^/]+)/, entity: "intervention" },
  { re: /^\/api\/payment-plans\/([^/]+)/, entity: "payment_plan" },
  { re: /^\/api\/scenarios\/([^/]+)/, entity: "forecast_scenario" },
  { re: /^\/api\/forecast-lines\/([^/]+)/, entity: "forecast_line" },
  { re: /^\/api\/specification-baselines\/([^/]+)/, entity: "specification_baseline" },
  { re: /^\/api\/spec-revisions\/([^/]+)/, entity: "spec_revision" },
  { re: /^\/api\/inspections\/([^/]+)/, entity: "qa_inspection" },
  { re: /^\/api\/snags\/([^/]+)/, entity: "snag" },
  { re: /^\/api\/holds\/([^/]+)/, entity: "hold" },
  { re: /^\/api\/prospects\/([^/]+)/, entity: "prospect" },
  { re: /^\/api\/change-requests\/([^/]+)/, entity: "change_request" },
  { re: /^\/api\/quotations\/([^/]+)/, entity: "quotation" },
  { re: /^\/api\/change-request-executions\/([^/]+)/, entity: "action" },
  { re: /^\/api\/change-request-approvals\/([^/]+)/, entity: "action" },
  { re: /^\/api\/documents\/([^/]+)/, entity: "document" },
  { re: /^\/api\/deviations\/([^/]+)/, entity: "document_deviation" },
  { re: /^\/api\/customer-documents\/([^/]+)/, entity: "customer_document" },
  { re: /^\/api\/customer-updates\/([^/]+)/, entity: "customer_update" },
  { re: /^\/api\/communication-templates\/([^/]+)/, entity: "communication_template" },
  { re: /^\/api\/communications\/([^/]+)/, entity: "communication" },
  { re: /^\/api\/document-templates\/([^/]+)/, entity: "doc_factory_template" },
  { re: /^\/api\/journey-template-versions\/([^/]+)/, entity: "journey_template_version" },
  { re: /^\/api\/journey-templates\/([^/]+)/, entity: "journey_template" },
  { re: /^\/api\/dependencies\/([^/]+)/, entity: "external_dependency" },
  { re: /^\/api\/gate-exceptions\/([^/]+)/, entity: "unit_gate_exception" },
  { re: /^\/api\/progress\/bulk\/([^/]+)/, entity: "progress_bulk" },
  { re: /^\/api\/advocacy\/([^/]+)/, entity: "advocacy" },
  { re: /^\/api\/checkins\/([^/]+)/, entity: "checkin_record" },
];

const STUDIO_PROJECT_TABLES = ["cash_target", "customer_visibility_rule", "dlp_policy", "handover_checklist_rule", "sales_policy"] as const;

const NOTE_ENTITY: Record<string, string> = {
  booking: "booking",
  unit: "unit",
  customer: "customer",
  project: "project",
  demand: "demand",
  action: "action",
};

function modeOf(method: string): Mode {
  return method === "GET" || method === "HEAD" ? "read" : "write";
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value;
  if (Array.isArray(value) && typeof value[0] === "string" && value[0].trim()) return value[0];
  return undefined;
}

async function scopeId(actor: Actor, entity: string, id: string, mode: Mode): Promise<void> {
  const projectId = await projectIdOf(entity, id);
  if (!projectId) return;
  assertProjectScope(actor, projectId, mode);
}

/** Block a project-data read (not_found) or write (forbidden) outside the actor's projects. */
export async function assertRequestProjectScope(
  actor: Actor,
  method: string,
  path: string,
  queryParams: Record<string, unknown> = {},
  body: Record<string, unknown> | null = null
): Promise<void> {
  const mode = modeOf(method);
  const pathname = path.split("?")[0] ?? path;

  const studioRow = pathname.match(
    /^\/api\/studio\/(cash_target|customer_visibility_rule|dlp_policy|handover_checklist_rule|sales_policy)\/([^/]+)/
  );
  if (studioRow && (STUDIO_PROJECT_TABLES as readonly string[]).includes(studioRow[1]!)) {
    await scopeId(actor, studioRow[1]!, studioRow[2]!, mode);
  } else {
    const periodCalendar = pathname.match(/^\/api\/studio\/period_calendar\/([^/]+)/);
    if (periodCalendar?.[1]) {
      await scopeId(actor, "project", periodCalendar[1], mode);
    } else {
      for (const rule of PATH_RULES) {
        const match = pathname.match(rule.re);
        if (!match?.[1]) continue;
        await scopeId(actor, rule.entity, match[1], mode);
        break;
      }
    }
  }

  const projectId = asString(queryParams.project_id) ?? asString(body?.project_id);
  if (projectId) assertProjectScope(actor, projectId, mode);

  const unitId = asString(queryParams.unit_id) ?? asString(body?.unit_id);
  if (unitId) await scopeId(actor, "unit", unitId, mode);

  const bookingId = asString(queryParams.booking_id) ?? asString(body?.booking_id);
  if (bookingId) await scopeId(actor, "booking", bookingId, mode);

  const entityType = asString(queryParams.entity_type) ?? asString(body?.entity_type);
  const entityId = asString(queryParams.entity_id) ?? asString(body?.entity_id);
  const noted = entityType ? NOTE_ENTITY[entityType] : undefined;
  if (noted && entityId) await scopeId(actor, noted, entityId, mode);
}

export function projectScopeGate(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!req.actor) {
    next();
    return;
  }
  const body = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : null;
  assertRequestProjectScope(req.actor, req.method, req.path, req.query as Record<string, unknown>, body)
    .then(() => next())
    .catch((err) => failHttp(res, err));
}

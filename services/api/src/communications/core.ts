import { randomUUID } from "node:crypto";
import { db } from "../db";
import { appendEvent, withTx, actorFields, type DbLike } from "../events";
import { authorize } from "../authz/authorize";
import { requireRole } from "../authz/requireRole";
import { AppError, type Ctx } from "../authz/types";
import { nextCode } from "../model/codes";
import { createAction } from "../actions/core";
import { startClock } from "../journey/sla";
import type { CalendarRow } from "../journey/calendar";
import { mailer } from "../mail";
import { createNotification } from "../notifications/core";
import { renderTemplateBody, loadCommunicationTemplate } from "./templates";

// 29-communications.md rules 1, 2, 4, 5, 6, 8. Gated on the "communications" permission module
// (MANAGEMENT READ, SALES/CRM WRITE, everyone else NONE per the seeded matrix — trusted over the
// spec's screen list, same discipline 08/24/15/27's own role findings already established).

export type Channel = "CALL" | "EMAIL" | "WHATSAPP" | "SMS" | "MEETING" | "NOTICE" | "PORTAL_UPDATE";
export type Direction = "INBOUND" | "OUTBOUND";
export type Visibility = "INTERNAL" | "CUSTOMER_VISIBLE";

export interface CommunicationRow {
  id: string; code: string; customer_id: string; booking_id: string | null; project_id: string | null;
  channel: Channel; direction: Direction; visibility: Visibility; subject: string | null; body: string;
  template_id: string | null; occurred_at: string; logged_by: string | null;
  follow_up_required: boolean; follow_up_due: string | null; follow_up_action_id: string | null;
  attachments: string[]; linked_entity: { entity_type: string; entity_id: string } | null;
  published_to_portal_at: string | null; customer_update_id: string | null;
}
const SELECT = `SELECT id, code, customer_id, booking_id, project_id, channel, direction, visibility, subject, body,
  template_id, occurred_at::text AS occurred_at, logged_by, follow_up_required, follow_up_due::text AS follow_up_due,
  follow_up_action_id, attachments, linked_entity, published_to_portal_at::text AS published_to_portal_at, customer_update_id
  FROM communication`;

async function loadCommunication(id: string, handle: DbLike = db): Promise<CommunicationRow> {
  const r = await handle.query<CommunicationRow>(`${SELECT} WHERE id = $1`, [id]);
  if (!r.rows[0]) throw new AppError("not_found", "communication not found");
  return r.rows[0];
}

async function customerBooking(customerId: string, bookingId: string | undefined | null, handle: DbLike): Promise<{ project_id: string | null; booking_id: string | null }> {
  if (bookingId) {
    const r = await handle.query<{ project_id: string }>(`SELECT project_id FROM booking WHERE id = $1`, [bookingId]);
    if (!r.rows[0]) throw new AppError("not_found", "booking not found");
    return { project_id: r.rows[0].project_id, booking_id: bookingId };
  }
  return { project_id: null, booking_id: null };
}

/** Rule 6: an inbound communication with `follow_up_required` gets a real CRM action, and (unlike
 *  every other `createAction` call site outside `journey/instances.ts`/`qa/snags.ts`) a real
 *  sla_clock — the 48h-unresolved escalation (`escalation_rule.customer_query_48h`, seeded
 *  `wired: true` by this build) needs one, per escalations/core.ts's own documented mechanism
 *  (`scannableActions` only picks up sla_clock-backed actions). */
async function createFollowUpAction(
  input: { communicationId: string; customerId: string; bookingId: string | null; projectId: string | null; subject: string | null },
  ctx: Ctx,
  tx: DbLike
): Promise<{ actionId: string; dueAt: string }> {
  const policy = (await tx.query<{ id: string; duration_value: number; duration_unit: "WORKING_DAYS" | "CALENDAR_DAYS" | "HOURS" }>(
    `SELECT id, duration_value, duration_unit FROM sla_policy WHERE code = 'customer_query_response'`
  )).rows[0];
  const calendarRow = (await tx.query<CalendarRow>(`SELECT working_days, holidays FROM project_calendar ORDER BY id LIMIT 1`)).rows[0]
    ?? { working_days: [1, 2, 3, 4, 5], holidays: [] };
  const clockId = policy ? await startClock({ subject_type: "communication", subject_id: input.communicationId, policy, calendar: calendarRow }, tx) : null;

  const actionId = await createAction(
    {
      type: "exec_simple",
      title: `Follow up: ${input.subject?.trim() || "customer query"}`,
      project_id: input.projectId,
      source_module: "customer_query",
      source_entity_type: "communication",
      source_entity_id: input.communicationId,
      booking_id: input.bookingId,
      customer_id: input.customerId,
      owner_role: "CRM",
      priority: "MEDIUM",
      sla_clock_id: clockId,
      origin: ctx.actor.kind === "STAFF" ? "MANUAL" : "AUTO",
      created_by: ctx.actor.user_id,
    },
    tx
  );
  const dueAt = (await tx.query<{ due_at: string }>(`SELECT due_at::text AS due_at FROM sla_clock WHERE id = $1`, [clockId])).rows[0]?.due_at
    ?? new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  return { actionId, dueAt };
}

export interface LogCommunicationInput {
  customer_id: string; booking_id?: string | null; channel: Channel; direction: Direction;
  subject?: string | null; body: string; occurred_at?: string; follow_up_required?: boolean;
  attachments?: string[]; linked_entity?: { entity_type: string; entity_id: string } | null;
}

/** POST /communications — rule 1's manual log (calls/WhatsApp/SMS/meetings) and the shared
 *  insert path `sendEmail`/portal-update auto-logging also use. Always starts INTERNAL — rule 2
 *  says only `publishToPortal` may flip visibility, never this call directly. */
export async function logCommunication(input: LogCommunicationInput, ctx: Ctx): Promise<CommunicationRow> {
  await authorize(ctx, "communications", "WRITE");
  if (!input.customer_id?.trim()) throw new AppError("validation", "customer_id is required", "customer_id");
  if (!input.body?.trim()) throw new AppError("validation", "body is required", "body");

  return withTx(undefined, async (tx) => {
    const customer = await tx.query<{ id: string }>(`SELECT id FROM customer WHERE id = $1`, [input.customer_id]);
    if (!customer.rows[0]) throw new AppError("not_found", "customer not found");
    const { project_id, booking_id } = await customerBooking(input.customer_id, input.booking_id, tx);

    const id = "com_" + randomUUID().slice(0, 8);
    const code = await nextCode(tx, "COM");

    let followUpActionId: string | null = null;
    let followUpDue: string | null = null;
    if (input.direction === "INBOUND" && input.follow_up_required) {
      const f = await createFollowUpAction({ communicationId: id, customerId: input.customer_id, bookingId: booking_id, projectId: project_id, subject: input.subject ?? null }, ctx, tx);
      followUpActionId = f.actionId;
      followUpDue = f.dueAt;
    }

    await tx.query(
      `INSERT INTO communication
        (id, code, customer_id, booking_id, project_id, channel, direction, subject, body, occurred_at,
         logged_by, follow_up_required, follow_up_due, follow_up_action_id, attachments, linked_entity)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10, now()),$11,$12,$13,$14,$15::text[],$16::jsonb)`,
      [
        id, code, input.customer_id, booking_id, project_id, input.channel, input.direction, input.subject ?? null, input.body,
        input.occurred_at ?? null, ctx.actor.kind === "STAFF" ? ctx.actor.user_id : null,
        !!input.follow_up_required, followUpDue, followUpActionId, input.attachments ?? [],
        input.linked_entity ? JSON.stringify(input.linked_entity) : null,
      ]
    );
    await appendEvent(tx, {
      type: input.direction === "INBOUND" ? "customer_contact.response_received" : "customer_contact.sent",
      entity_type: "communication", entity_id: id, project_id: project_id ?? undefined, booking_id: booking_id ?? undefined,
      payload: { channel: input.channel, direction: input.direction }, ...actorFields(ctx),
    });
    return loadCommunication(id, tx);
  });
}

/** POST /communications/send-email — rule 5: outbound email via the mailer port (03), auto-logged. */
export async function sendCommunicationEmail(
  input: { customer_id: string; booking_id?: string | null; to: string; template_id?: string; body?: string; subject?: string },
  ctx: Ctx
): Promise<CommunicationRow> {
  await authorize(ctx, "communications", "WRITE");
  if (!input.template_id && !input.body?.trim()) throw new AppError("validation", "template_id or body is required");

  let subject = input.subject ?? "";
  let body = input.body ?? "";
  let templateId: string | null = null;
  if (input.template_id) {
    const t = await loadCommunicationTemplate(input.template_id);
    if (t.status !== "APPROVED") throw new AppError("conflict", `template is ${t.status}, not APPROVED`);
    templateId = t.id;
    subject = t.subject ?? subject;
    body = t.body;
    if (input.booking_id) {
      subject = (await renderTemplateBody(subject, input.booking_id)).text;
      body = (await renderTemplateBody(body, input.booking_id)).text;
    }
  }

  await checkFrequencyGuardrail(input.customer_id, input.template_id, ctx);

  // Rule 1 ("every customer touch is logged") requires the row to exist before the customer sees
  // the message — send-then-log left an unlogged email on any insert failure. Validate/insert
  // first, send the mail last (mailer.send is not a DB call, so it's safe inside withTx).
  return withTx(undefined, async (tx) => {
    const customer = await tx.query<{ id: string }>(`SELECT id FROM customer WHERE id = $1`, [input.customer_id]);
    if (!customer.rows[0]) throw new AppError("not_found", "customer not found");
    const { project_id, booking_id } = await customerBooking(input.customer_id, input.booking_id, tx);
    const id = "com_" + randomUUID().slice(0, 8);
    const code = await nextCode(tx, "COM");
    await tx.query(
      `INSERT INTO communication (id, code, customer_id, booking_id, project_id, channel, direction, subject, body, logged_by, template_id)
       VALUES ($1,$2,$3,$4,$5,'EMAIL','OUTBOUND',$6,$7,$8,$9)`,
      [id, code, input.customer_id, booking_id, project_id, subject, body, ctx.actor.user_id, templateId]
    );
    await appendEvent(tx, {
      type: "customer_contact.sent", entity_type: "communication", entity_id: id, project_id: project_id ?? undefined, booking_id: booking_id ?? undefined,
      payload: { channel: "EMAIL", template_id: templateId }, ...actorFields(ctx),
    });
    await mailer.send({ to: input.to, subject, text: body, html: body });
    return loadCommunication(id, tx);
  });
}

/** Rule 4: frequency guardrails — a purpose with no configured row fails open (no ceiling), same
 *  "empty config narrows nothing, doesn't block" call as 27's materiality thresholds, not 19's
 *  WAIVER-bands fail-closed (a guardrail is a courtesy cap, not a financial control). Override
 *  requires CRM lead + reason — modeled as `overrideReason` present + a CRM/MANAGEMENT/SUPER_ADMIN
 *  actor, same seniority-has-no-role-value simplification as elsewhere. */
export async function checkFrequencyGuardrail(customerId: string, templateId: string | undefined, ctx: Ctx, overrideReason?: string): Promise<void> {
  if (!templateId) return;
  const t = await loadCommunicationTemplate(templateId);
  const g = (await db.query<{ max_per_customer_per_window: number; window_days: number }>(
    `SELECT max_per_customer_per_window, window_days FROM frequency_guardrail WHERE purpose = $1`,
    [t.purpose]
  )).rows[0];
  if (!g) return;
  const count = (await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM communication WHERE customer_id = $1 AND template_id IN (SELECT id FROM communication_template WHERE purpose = $2)
       AND occurred_at >= now() - ($3 || ' days')::interval AND direction = 'OUTBOUND'`,
    [customerId, t.purpose, g.window_days]
  )).rows[0];
  if (Number(count?.n ?? 0) < g.max_per_customer_per_window) return;
  if (overrideReason?.trim()) {
    requireRole(ctx, ["CRM", "MANAGEMENT", "SUPER_ADMIN"]);
    return;
  }
  throw new AppError("conflict", `frequency guardrail: already sent ${count?.n} of ${g.max_per_customer_per_window} allowed in the last ${g.window_days} days for ${t.purpose}`);
}

/** POST /communications/:id/publish-to-portal — rule 2: only CRM (+ MANAGEMENT/SUPER_ADMIN) may
 *  publish a communication as customer-visible, and only into the portal feed (26) that already
 *  exists for exactly this purpose — `customer_update` (rule 10 of 26's own Build note), not a new
 *  mechanism. Requires a booking (the portal feed is booking-scoped); a customer-only communication
 *  with no booking has nowhere in the portal to appear, flagged not guessed. */
export async function publishCommunicationToPortal(id: string, ctx: Ctx): Promise<CommunicationRow> {
  requireRole(ctx, ["CRM", "MANAGEMENT", "SUPER_ADMIN"]);
  const c = await loadCommunication(id);
  if (c.visibility === "CUSTOMER_VISIBLE") throw new AppError("conflict", "already published");
  if (!c.booking_id) throw new AppError("validation", "communication has no booking_id — nowhere in the portal feed to appear", "booking_id");

  await withTx(undefined, async (tx) => {
    const updateId = "cup_" + randomUUID().slice(0, 8);
    await tx.query(
      `INSERT INTO customer_update (id, booking_id, kind, title, body, published_by, published_at, status)
       VALUES ($1,$2,'MESSAGE',$3,$4,$5,now(),'PUBLISHED')`,
      [updateId, c.booking_id, c.subject ?? "Update from your team", c.body, ctx.actor.user_id]
    );
    await tx.query(
      `UPDATE communication SET visibility = 'CUSTOMER_VISIBLE', published_to_portal_at = now(), customer_update_id = $2 WHERE id = $1`,
      [id, updateId]
    );
    await appendEvent(tx, {
      type: "communication.published", entity_type: "communication", entity_id: id, project_id: c.project_id ?? undefined, booking_id: c.booking_id ?? undefined,
      payload: { customer_update_id: updateId }, ...actorFields(ctx),
    });
    const login = await tx.query<{ user_id: string }>(`SELECT user_id FROM customer_login WHERE booking_id = $1 LIMIT 1`, [c.booking_id]);
    if (login.rows[0]) {
      await createNotification({ user_id: login.rows[0].user_id, type: "communication.published", title: c.subject ?? "You have a new update", entity_ref: { entity_type: "communication", entity_id: id } }, tx);
    }
  });
  return loadCommunication(id);
}

export async function listCustomerCommunications(customerId: string, filter: { channel?: string; visibility?: string }, ctx: Ctx): Promise<CommunicationRow[]> {
  await authorize(ctx, "communications", "READ");
  const r = await db.query<CommunicationRow>(
    `${SELECT} WHERE customer_id = $1 AND ($2::text IS NULL OR channel = $2) AND ($3::text IS NULL OR visibility = $3) ORDER BY occurred_at DESC`,
    [customerId, filter.channel ?? null, filter.visibility ?? null]
  );
  return r.rows;
}

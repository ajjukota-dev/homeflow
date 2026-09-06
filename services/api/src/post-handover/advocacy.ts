import { randomUUID } from "node:crypto";
import { db } from "../db";
import { appendEvent, withTx, actorFields, onEvent, type AppendedEvent } from "../events";
import { requireRole } from "../authz/requireRole";
import { createAction } from "../actions/core";
import { nextCode } from "../model/codes";
import { AppError, type Ctx } from "../authz/types";
import { CRM_UPDATE_ROLES } from "../portal/core";

// 30-post-handover.md rule 6 — CRM-only, matching 26's own `CRM_UPDATE_ROLES` precedent exactly
// (reused directly rather than a second constant with the same 3 roles).

export interface AdvocacyRow {
  id: string; booking_id: string; kind: "REFERRAL" | "TESTIMONIAL" | "REVIEW"; status: string;
  content: string | null; referred_prospect_id: string | null; at: string;
}
const SELECT = `SELECT id, booking_id, kind, status, content, referred_prospect_id, at::text AS at FROM advocacy`;

/** "CRM publishes the invite — no auto-send" (rule 6, p32 §27): this is the one place a real
 *  invite is created; the DAY_90-score trigger below only surfaces an eligible-customer action
 *  for CRM to act on, it never calls this itself. */
export async function inviteAdvocacy(bookingId: string, kind: "REFERRAL" | "TESTIMONIAL" | "REVIEW", ctx: Ctx): Promise<AdvocacyRow> {
  requireRole(ctx, CRM_UPDATE_ROLES);
  const id = randomUUID();
  await withTx(undefined, async (tx) => {
    await tx.query(`INSERT INTO advocacy (id, booking_id, kind, status, invited_by) VALUES ($1,$2,$3,'INVITED',$4)`, [id, bookingId, kind, ctx.actor.user_id]);
    await appendEvent(tx, {
      type: "advocacy.invited", entity_type: "advocacy", entity_id: id, booking_id: bookingId,
      payload: { kind }, ...actorFields(ctx),
    });
  });
  return (await db.query<AdvocacyRow>(`${SELECT} WHERE id = $1`, [id])).rows[0];
}

/** Rule 6: a REFERRAL response creates a real prospect (24) with source REFERRAL. Inserted
 *  directly on the `prospect` table (24's own shape/code convention) rather than calling
 *  `sales/prospects.ts::createProspect` — that function role-gates on `SALES_WRITE_ROLES`
 *  (SALES/MANAGEMENT/SUPER_ADMIN), which doesn't include CRM even though CRM is exactly who owns
 *  advocacy (rule 6); already authorized above via `CRM_UPDATE_ROLES` for this advocacy-specific
 *  write, so re-gating through a different module's narrower list would incorrectly block CRM
 *  from a case the seeded matrix doesn't actually address. It also opens its own `withTx`, which
 *  would deadlock nested inside this one (the 17/18/26 lesson) — flagged, not silently worked
 *  around either way. */
export async function respondAdvocacy(id: string, input: { status: "RECEIVED" | "PUBLISHED" | "DECLINED"; content?: string | null; referred_prospect_name?: string | null }, ctx: Ctx): Promise<AdvocacyRow> {
  requireRole(ctx, CRM_UPDATE_ROLES);
  const row = (await db.query<AdvocacyRow & { project_id?: string }>(`${SELECT} WHERE id = $1`, [id])).rows[0];
  if (!row) throw new AppError("not_found", "not_found");
  let referredProspectId: string | null = row.referred_prospect_id;

  await withTx(undefined, async (tx) => {
    if (row.kind === "REFERRAL" && input.status === "RECEIVED" && input.referred_prospect_name && !referredProspectId) {
      const b = await tx.query<{ project_id: string }>(`SELECT project_id FROM booking WHERE id = $1`, [row.booking_id]);
      referredProspectId = "prs_" + randomUUID().slice(0, 8);
      const code = await nextCode(tx, "PRS");
      await tx.query(
        `INSERT INTO prospect (id, code, project_id, name, source, sales_owner_user_id) VALUES ($1,$2,$3,$4,'REFERRAL',$5)`,
        [referredProspectId, code, b.rows[0].project_id, input.referred_prospect_name, ctx.actor.user_id]
      );
      await appendEvent(tx, { type: "prospect.created", entity_type: "prospect", entity_id: referredProspectId, project_id: b.rows[0].project_id, payload: { code, source: "REFERRAL" }, ...actorFields(ctx) });
    }
    await tx.query(`UPDATE advocacy SET status = $2, content = $3, referred_prospect_id = $4 WHERE id = $1`, [id, input.status, input.content ?? row.content, referredProspectId]);
    await appendEvent(tx, {
      type: "advocacy.received", entity_type: "advocacy", entity_id: id, booking_id: row.booking_id,
      payload: { status: input.status, referred_prospect_id: referredProspectId }, ...actorFields(ctx),
    });
  });
  return (await db.query<AdvocacyRow>(`${SELECT} WHERE id = $1`, [id])).rows[0];
}

export async function listAdvocacy(bookingId: string, ctx: Ctx): Promise<AdvocacyRow[]> {
  requireRole(ctx, CRM_UPDATE_ROLES);
  return (await db.query<AdvocacyRow>(`${SELECT} WHERE booking_id = $1 ORDER BY at DESC`, [bookingId])).rows;
}

let registered = false;

/** Rule 6's trigger, not its send: on a DAY_90 `check_in.responded` with score >= 4, raise a CRM
 *  action surfacing the eligible customer — CRM still has to click `inviteAdvocacy` themselves. */
export function registerAdvocacySubscribers(): void {
  if (registered) return;
  registered = true;

  onEvent("check_in.responded", "advocacy.day90_nudge", async (event: AppendedEvent) => {
    const score = (event.payload as { score?: number })?.score;
    if (!event.booking_id || score === undefined || score < 4) return;
    const checkIn = await db.query<{ kind: string }>(`SELECT kind FROM customer_check_in WHERE id = $1`, [event.entity_id]);
    if (checkIn.rows[0]?.kind !== "DAY_90") return;
    const b = await db.query<{ project_id: string }>(`SELECT project_id FROM booking WHERE id = $1`, [event.booking_id]);
    await createAction(
      {
        type: "exec_simple", title: `Referral/testimonial invite eligible (DAY 90 score ${score}/5)`,
        project_id: b.rows[0]?.project_id ?? null, source_module: "advocacy", source_entity_type: "customer_check_in",
        source_entity_id: event.entity_id, booking_id: event.booking_id, owner_role: "CRM", priority: "MEDIUM", origin: "AUTO",
      },
      db
    );
  });
}

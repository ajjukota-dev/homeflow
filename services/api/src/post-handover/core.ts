import { randomUUID } from "node:crypto";
import { db } from "../db";
import { appendEvent, withTx, actorFields, onEvent, type AppendedEvent, type DbLike } from "../events";
import { authorize } from "../authz/authorize";
import { AppError, type Ctx } from "../authz/types";
import { createAction } from "../actions/core";
import { currentItems } from "../specification/revisions";
import { sendCheckIn } from "../portal/core";
import { resolveDlpPolicy } from "./dlp";

// 30-post-handover.md rules 1, 4, 7. Gated on the pre-existing "handovers" permission module
// (SITE/FM WRITE, CRM/MANAGEMENT READ per the seeded matrix) — same module warranty.ts's own
// projectWarranty/serviceHistory already use, not a new module invented for this spec.

export type MoveInTaskKey =
  | "facility_intro_done" | "maintenance_setup_done" | "owner_record_transferred"
  | "warranties_shared" | "pending_snag_monitoring" | "utilities_transferred" | "association_membership";

// Owner-role mapping is a judgment call (Data section names the 7 keys, not who owns each) —
// owner_record_transferred is a CRM administrative task, the rest are FM's onboarding checklist,
// same class of call 07/18 already made for their own owner-role mappings.
const MOVE_IN_TASKS: { key: MoveInTaskKey; label: string; owner_role: string }[] = [
  { key: "facility_intro_done", label: "Facility introduction walkthrough", owner_role: "FM" },
  { key: "maintenance_setup_done", label: "Maintenance setup", owner_role: "FM" },
  { key: "owner_record_transferred", label: "Owner record transferred", owner_role: "CRM" },
  { key: "warranties_shared", label: "Warranties shared with customer", owner_role: "FM" },
  { key: "pending_snag_monitoring", label: "Pending snag monitoring set up", owner_role: "FM" },
  { key: "utilities_transferred", label: "Utilities transferred", owner_role: "FM" },
  { key: "association_membership", label: "Association membership", owner_role: "FM" },
];

interface MoveInTaskState { done: boolean; action_id: string | null; by: string | null; at: string | null }
export type MoveInTasks = Record<MoveInTaskKey, MoveInTaskState>;

export interface PostHandoverCaseRow {
  id: string; booking_id: string; unit_id: string; project_id: string; handover_completed_at: string;
  move_in_tasks: MoveInTasks; status: "ONBOARDING" | "IN_DLP" | "DLP_CLOSED" | "CLOSED"; fm_owner_user_id: string | null;
}
const CASE_SELECT = `SELECT id, booking_id, unit_id, project_id, handover_completed_at::text AS handover_completed_at,
  move_in_tasks, status, fm_owner_user_id FROM post_handover_case`;

async function loadCase(id: string, handle: DbLike = db): Promise<PostHandoverCaseRow> {
  const r = await handle.query<PostHandoverCaseRow>(`${CASE_SELECT} WHERE id = $1`, [id]);
  if (!r.rows[0]) throw new AppError("not_found", "not_found");
  return r.rows[0];
}

/** Rule 1 — on `handover.completed`, opens the case: move-in tasks as real actions (10) to
 *  FM/CRM, passport pre-filled from 09 as-built (falling back to nothing rather than guessing a
 *  category), check-ins scheduled DAY_7/30/90 via 26's real `sendCheckIn` (this spec's own Data
 *  row cites "customer_check_in (26)" as the mechanism, not the pre-26 `checkin_record` warranty.ts
 *  already schedules separately — both now coexist, same "different producer, keep both"
 *  precedent 26's own migration already established for these two tables).
 *
 *  Called from `warranty.ts::onHandoverCompleted`, itself already called sequentially (never
 *  inside an open transaction) from both `qa.ts::completeHandover` and
 *  `handover/core.ts::completeCase` — this function follows the same discipline: its own DB writes
 *  are one `withTx`, then `sendCheckIn` (which opens its own transaction) runs after it commits,
 *  never nested inside it (the nested-`withTx` deadlock lesson from 17/18/26). */
export async function openPostHandoverCase(bookingId: string, unitId: string, projectId: string): Promise<string> {
  const existing = await db.query<{ id: string }>(`SELECT id FROM post_handover_case WHERE booking_id = $1`, [bookingId]);
  if (existing.rows[0]) return existing.rows[0].id;

  const id = "phc_" + randomUUID().slice(0, 8);
  const asBuilt = await currentItems(unitId).catch(() => ({}) as Record<string, { spec: string; brand_model?: string | null }>);

  await withTx(undefined, async (tx) => {
    const tasks: Partial<MoveInTasks> = {};
    for (const t of MOVE_IN_TASKS) tasks[t.key] = { done: false, action_id: null, by: null, at: null };
    await tx.query(
      `INSERT INTO post_handover_case (id, booking_id, unit_id, project_id, handover_completed_at, move_in_tasks, status)
       VALUES ($1,$2,$3,$4,now(),$5::jsonb,'ONBOARDING')`,
      [id, bookingId, unitId, projectId, JSON.stringify(tasks)]
    );
    for (const t of MOVE_IN_TASKS) {
      const actionId = await createAction(
        {
          type: "exec_simple", title: `Move-in: ${t.label}`, project_id: projectId,
          source_module: "post_handover", source_entity_type: "post_handover_case", source_entity_id: id,
          booking_id: bookingId, unit_id: unitId, owner_role: t.owner_role, priority: "MEDIUM", origin: "AUTO",
        },
        tx
      );
      (tasks[t.key] as MoveInTaskState).action_id = actionId;
    }
    await tx.query(`UPDATE post_handover_case SET move_in_tasks = $2::jsonb WHERE id = $1`, [id, JSON.stringify(tasks)]);
    for (const [category, item] of Object.entries(asBuilt)) {
      await tx.query(
        `INSERT INTO home_passport_item (id, unit_id, project_id, kind, category, name, brand_model, customer_facing, approved)
         VALUES ($1,$2,$3,'FINISH',$4,$4,$5,true,true)`,
        [randomUUID(), unitId, projectId, category, item.brand_model ?? null]
      );
    }
    await appendEvent(tx, {
      type: "post_handover.case_opened", entity_type: "post_handover_case", entity_id: id,
      project_id: projectId, booking_id: bookingId, unit_id: unitId, payload: {},
      actor_user_id: null, actor_kind: "SYSTEM",
    });
  });

  for (const kind of ["DAY_7", "DAY_30", "DAY_90"] as const) await sendCheckIn(bookingId, kind);
  return id;
}

export async function getPostHandoverCase(bookingId: string, ctx: Ctx): Promise<PostHandoverCaseRow> {
  await authorize(ctx, "handovers", "READ");
  const r = await db.query<{ id: string }>(`SELECT id FROM post_handover_case WHERE booking_id = $1`, [bookingId]);
  if (!r.rows[0]) throw new AppError("not_found", "not_found");
  return loadCase(r.rows[0].id);
}

/** Rule 1 — mark one move-in task done, closing its own tracking action. FM-owned, matches the
 *  "handovers" module's WRITE grant (SITE/FM). */
export async function completeMoveInTask(caseId: string, taskKey: MoveInTaskKey, ctx: Ctx): Promise<PostHandoverCaseRow> {
  await authorize(ctx, "handovers", "WRITE");
  const c = await loadCase(caseId);
  if (!(taskKey in c.move_in_tasks)) throw new AppError("validation", `unknown move-in task ${taskKey}`, "task_key");
  const task = c.move_in_tasks[taskKey];
  if (task.done) return c;

  const updatedTasks: MoveInTasks = { ...c.move_in_tasks, [taskKey]: { done: true, action_id: task.action_id, by: ctx.actor.user_id, at: new Date().toISOString() } };
  await withTx(undefined, async (tx) => {
    await tx.query(`UPDATE post_handover_case SET move_in_tasks = $2::jsonb WHERE id = $1`, [caseId, JSON.stringify(updatedTasks)]);
    if (task.action_id) {
      await tx.query(`UPDATE action SET status = 'Closed', closed_at = now(), closed_by = $2 WHERE id = $1 AND status NOT IN ('Closed','Cancelled')`, [task.action_id, ctx.actor.user_id]);
    }
    await appendEvent(tx, {
      type: "post_handover.move_in_task_completed", entity_type: "post_handover_case", entity_id: caseId,
      project_id: c.project_id, booking_id: c.booking_id, unit_id: c.unit_id, payload: { task_key: taskKey },
      ...actorFields(ctx),
    });
    const allDone = MOVE_IN_TASKS.every((t) => t.key === taskKey || c.move_in_tasks[t.key].done);
    if (allDone) {
      await tx.query(`UPDATE post_handover_case SET status = 'IN_DLP' WHERE id = $1 AND status = 'ONBOARDING'`, [caseId]);
      await appendEvent(tx, {
        type: "post_handover.onboarding_completed", entity_type: "post_handover_case", entity_id: caseId,
        project_id: c.project_id, booking_id: c.booking_id, unit_id: c.unit_id, payload: {},
        actor_user_id: null, actor_kind: "SYSTEM",
      });
    }
  });
  return loadCase(caseId);
}

/** Rule 4 — append-only service history, visible in the portal passport. `kind`/`cost_inr` are
 *  this spec's own additions to the pre-existing `service_history` table (warranty.ts's own
 *  serviceHistory() already reads/returns the shared columns, unaffected). */
export async function addServiceRecord(
  input: { unit_id: string; kind: "WARRANTY_FIX" | "MAINTENANCE" | "INSPECTION" | "UPGRADE"; description: string; cost_inr?: number | null; warranty_case_id?: string | null },
  ctx: Ctx
): Promise<{ id: string }> {
  await authorize(ctx, "handovers", "WRITE");
  const id = randomUUID();
  await db.query(
    `INSERT INTO service_history (id, unit_id, event_type, kind, warranty_case_id, description, cost_inr, actor)
     VALUES ($1,$2,$3,$3,$4,$5,$6,$7)`,
    [id, input.unit_id, input.kind, input.warranty_case_id ?? null, input.description, input.cost_inr ?? null, ctx.actor.user_id ?? "system"]
  );
  return { id };
}

export interface PassportItem {
  id: string; kind: string | null; category: string; name: string; brand: string | null; model: string | null;
  serial: string | null; installed_on: string | null; warranty_until: string | null; vendor_contact: string | null; manual_file_id: string | null;
}

export async function getUnitPassport(unitId: string, ctx: Ctx): Promise<PassportItem[]> {
  await authorize(ctx, "handovers", "READ");
  const r = await db.query<PassportItem>(
    `SELECT id, kind, category, name, brand_model AS brand, NULL::text AS model, serial,
            installed_on::text AS installed_on, warranty_until::text AS warranty_until, vendor_contact, manual_file_id
       FROM home_passport_item WHERE unit_id = $1 ORDER BY category, name`,
    [unitId]
  );
  return r.rows;
}

export async function putPassportItem(
  unitId: string,
  input: { id?: string; kind: string; category: string; name: string; brand?: string | null; serial?: string | null; installed_on?: string | null; warranty_until?: string | null; vendor_contact?: string | null; manual_file_id?: string | null },
  ctx: Ctx
): Promise<{ id: string }> {
  await authorize(ctx, "handovers", "WRITE");
  const projectRow = await db.query<{ project_id: string }>(`SELECT project_id FROM unit WHERE id = $1`, [unitId]);
  if (!projectRow.rows[0]) throw new AppError("not_found", "unit not found");
  const id = input.id ?? randomUUID();
  await db.query(
    `INSERT INTO home_passport_item (id, unit_id, project_id, kind, category, name, brand_model, serial, installed_on, warranty_until, vendor_contact, manual_file_id, customer_facing, approved)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,true)
     ON CONFLICT (id) DO UPDATE SET kind = $4, category = $5, name = $6, brand_model = $7, serial = $8, installed_on = $9, warranty_until = $10, vendor_contact = $11, manual_file_id = $12`,
    [id, unitId, projectRow.rows[0].project_id, input.kind, input.category, input.name, input.brand ?? null, input.serial ?? null, input.installed_on ?? null, input.warranty_until ?? null, input.vendor_contact ?? null, input.manual_file_id ?? null]
  );
  return { id };
}

/** Rule 7: "DLP_CLOSED when all windows expire and no open cases." Deliberately considers
 *  ONBOARDING cases too, not just IN_DLP — the two lifecycles are independent per the spec's own
 *  wording (DLP expiry doesn't depend on the move-in checklist being ticked), so a case stuck in
 *  ONBOARDING forever (e.g. an unticked `association_membership` on a project with no association)
 *  would otherwise never reach DLP_CLOSED even after its 5-year clock runs out.
 *
 *  No scheduler exists anywhere in this codebase (same pre-existing gap 06/12/19/20/21/23 already
 *  document) — directly callable with a controlled `asOf`, tested, not cron-wired, same precedent. */
export async function sweepDlpClosure(asOf: Date = new Date()): Promise<{ closed: string[] }> {
  const cases = await db.query<{ id: string; booking_id: string; unit_id: string; project_id: string; handover_completed_at: string; product_type: string }>(
    `SELECT phc.id, phc.booking_id, phc.unit_id, phc.project_id, phc.handover_completed_at::text AS handover_completed_at, u.product_type
       FROM post_handover_case phc JOIN unit u ON u.id = phc.unit_id WHERE phc.status IN ('ONBOARDING', 'IN_DLP')`
  );
  const closed: string[] = [];
  for (const c of cases.rows) {
    const policy = await resolveDlpPolicy(c.project_id, c.product_type, db);
    const maxMonths = policy ? Math.max(...policy.windows.map((w) => w.months)) : 12;
    const end = new Date(c.handover_completed_at);
    end.setUTCMonth(end.getUTCMonth() + maxMonths);
    if (asOf < end) continue;
    const openCases = await db.query<{ count: string }>(`SELECT count(*)::text FROM warranty_case WHERE unit_id = $1 AND status NOT IN ('closed', 'rejected')`, [c.unit_id]);
    if (Number(openCases.rows[0]?.count ?? 0) > 0) continue;

    await withTx(undefined, async (tx) => {
      await tx.query(`UPDATE post_handover_case SET status = 'DLP_CLOSED' WHERE id = $1`, [c.id]);
      await appendEvent(tx, {
        type: "dlp.window_expired", entity_type: "post_handover_case", entity_id: c.id,
        project_id: c.project_id, booking_id: c.booking_id, unit_id: c.unit_id, payload: { max_months: maxMonths },
        actor_user_id: null, actor_kind: "SYSTEM",
      });
    });
    await sendCheckIn(c.booking_id, "DLP_CLOSE");
    closed.push(c.id);
  }
  return { closed };
}

/** Rule 7's second half: "CLOSED after DLP-close check-in" — a DLP_CLOSE check-in response is the
 *  real signal (not just "sent"), same "responded, not sent, is the meaningful event" reading as
 *  rule 5's own captured-score driver. Registered from `db/index.ts` alongside the other
 *  subscribers. */
let subscribed = false;

export function registerPostHandoverSubscribers(): void {
  if (subscribed) return;
  subscribed = true;
  onEvent("check_in.responded", "post_handover.dlp_close_completes_case", async (event: AppendedEvent) => {
    const checkIn = await db.query<{ kind: string }>(`SELECT kind FROM customer_check_in WHERE id = $1`, [event.entity_id]);
    if (checkIn.rows[0]?.kind !== "DLP_CLOSE" || !event.booking_id) return;
    await db.query(`UPDATE post_handover_case SET status = 'CLOSED' WHERE booking_id = $1 AND status = 'DLP_CLOSED'`, [event.booking_id]);
  });
}

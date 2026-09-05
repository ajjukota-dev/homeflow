import { randomUUID } from "node:crypto";
import { db } from "../db";
import { appendEvent, withTx, type DbLike } from "../events";
import { requireRole, STAFF_ROLES } from "../authz/requireRole";
import { AppError, type Ctx } from "../authz/types";
import { nextCode } from "../model/codes";
import { stopClock } from "../journey/sla";

// Universal Action (10-universal-action.md). Rules 1, 3, 4, 5, 8 fully built; rule 6 (customer
// portal "action required from you" surface) is data-model-ready (customer_visible/
// customer_title columns) but the portal screen itself is deferred, same pattern as 05/06's
// Studio/dashboard UIs. Rule 7 (auto-close on source-entity close via an event subscriber)
// isn't wired — the only source built (task instances, 06) already closes its action itself
// (journey/instances.ts's completeTaskInstance calls closeAction directly), so there is no
// second closer for it to react to yet; revisit once a second Source (snag, warranty, ...)
// lands with its own independent close path.
//
// Rule 2 (12 auto-creation Sources): only "task instances" is wired (journey/instances.ts).
// The other 11 reference specs that aren't built (17, 19, 13, 15, 07, 22, 18, 12, 30) — same
// "flag, don't fake" treatment 05/06 already used for OFFER_MIGRATION/entry_gate_expr.

export type ActionStatus =
  | "New" | "In Progress" | "Waiting Internal" | "Waiting Customer"
  | "Blocked" | "Ready for Approval" | "Closed" | "Cancelled";
export type ActionFamily = "TASK" | "APPROVAL" | "FOLLOW_UP" | "DOCUMENT_REQUEST" | "EXCEPTION" | "ESCALATION" | "VERIFICATION";
export type EvidenceRequirement = "NONE" | "ATTACHMENT" | "VERIFIED_ATTACHMENT" | "CHECKLIST" | "APPROVAL" | "EXTERNAL_REF";
export type Priority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface CreateActionInput {
  type: string; // action_type.code
  title: string;
  description?: string | null;
  project_id?: string | null;
  source_module: string;
  source_entity_type: string;
  source_entity_id: string;
  booking_id?: string | null;
  unit_id?: string | null;
  customer_id?: string | null;
  owner_user_id?: string | null;
  owner_role?: string | null; // falls back to action_type.default_owner_role
  due_at?: string | null;
  priority?: Priority; // falls back to action_type default
  sla_clock_id?: string | null; // caller starts the clock (06) and passes its id — see file header
  customer_visible?: boolean; // falls back to action_type default
  customer_title?: string | null;
  evidence_requirement?: EvidenceRequirement; // falls back to action_type default
  approver_role?: string | null;
  verifier_role?: string | null;
  checklist?: { label: string; required?: boolean }[];
  origin: "AUTO" | "MANUAL";
  created_by?: string | null;
}

interface ActionTypeRow {
  code: string;
  family: ActionFamily;
  default_owner_role: string;
  default_priority: Priority;
  default_evidence_requirement: EvidenceRequirement;
  customer_visible_default: boolean;
}

/** Rule 1: the single creation path. System callers (Sources) pass no ctx — origin: 'AUTO',
 *  created_by: null. The manual API route wraps this with requireRole + ctx.actor.user_id. */
export async function createAction(input: CreateActionInput, tx: DbLike): Promise<string> {
  const at = await tx.query<ActionTypeRow>(`SELECT code, family, default_owner_role, default_priority, default_evidence_requirement, customer_visible_default FROM action_type WHERE code = $1`, [input.type]);
  if (!at.rows[0]) throw new AppError("validation", `unknown action_type: ${input.type}`, "type");
  const t = at.rows[0];

  const id = "act_" + randomUUID().slice(0, 8);
  const code = await nextCode(tx, "ACT");
  await tx.query(
    `INSERT INTO action
      (id, code, type, title, description, project_id, source_module, source_entity_type, source_entity_id,
       booking_id, unit_id, customer_id, owner_user_id, owner_role, due_at, priority, sla_clock_id,
       customer_visible, customer_title, evidence_requirement, approver_role, verifier_role, origin, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
    [
      id, code, input.type, input.title, input.description ?? null, input.project_id ?? null,
      input.source_module, input.source_entity_type, input.source_entity_id,
      input.booking_id ?? null, input.unit_id ?? null, input.customer_id ?? null,
      input.owner_user_id ?? null, input.owner_role ?? t.default_owner_role,
      input.due_at ?? null, input.priority ?? t.default_priority, input.sla_clock_id ?? null,
      input.customer_visible ?? t.customer_visible_default, input.customer_title ?? null,
      input.evidence_requirement ?? t.default_evidence_requirement,
      input.approver_role ?? null, input.verifier_role ?? null,
      input.origin, input.created_by ?? null,
    ]
  );

  for (const item of input.checklist ?? []) {
    await tx.query(
      `INSERT INTO action_checklist_item (id, action_id, label, required) VALUES ($1,$2,$3,$4)`,
      ["aci_" + randomUUID().slice(0, 8), id, item.label, item.required ?? true]
    );
  }

  await appendEvent(tx, {
    type: "action.created",
    entity_type: "action",
    entity_id: id,
    project_id: input.project_id ?? null,
    booking_id: input.booking_id ?? null,
    unit_id: input.unit_id ?? null,
    customer_id: input.customer_id ?? null,
    actor_user_id: input.created_by ?? null,
    actor_kind: input.origin === "MANUAL" ? "USER" : "SYSTEM",
    payload: { type: input.type, source_module: input.source_module, source_entity_id: input.source_entity_id },
  });

  return id;
}

/** Manual creation (POST /actions) — the only path that needs a ctx. */
export async function createManualAction(input: Omit<CreateActionInput, "origin" | "created_by">, ctx: Ctx): Promise<string> {
  requireRole(ctx, STAFF_ROLES);
  return withTx(undefined, (tx) => createAction({ ...input, origin: "MANUAL", created_by: ctx.actor.user_id }, tx));
}

interface ActionRow {
  id: string; status: ActionStatus; owner_user_id: string | null; owner_role: string;
  submitted_by: string | null; type: string; evidence_requirement: EvidenceRequirement;
  approver_role: string | null; verifier_role: string | null; external_reference: string | null;
  sla_clock_id: string | null; project_id: string | null; booking_id: string | null;
}

async function requireAction(actionId: string, tx: DbLike): Promise<ActionRow> {
  const r = await tx.query<ActionRow>(
    `SELECT id, status, owner_user_id, owner_role, submitted_by, type, evidence_requirement,
            approver_role, verifier_role, external_reference, sla_clock_id, project_id, booking_id
       FROM action WHERE id = $1`,
    [actionId]
  );
  if (!r.rows[0]) throw new AppError("not_found", "action not found");
  return r.rows[0];
}

async function actionFamily(type: string, tx: DbLike): Promise<ActionFamily> {
  const r = await tx.query<{ family: ActionFamily }>(`SELECT family FROM action_type WHERE code = $1`, [type]);
  return r.rows[0]!.family;
}

/** Lets journey/instances.ts's completeTaskInstance branch to approveAction instead of
 *  closeAction for APPROVAL-family actions — closeAction's evidence gate always refuses
 *  APPROVAL-family (it closes via /approve, not /close). */
export async function actionIsApprovalFamily(actionId: string, tx: DbLike): Promise<boolean> {
  const a = await requireAction(actionId, tx);
  return (await actionFamily(a.type, tx)) === "APPROVAL";
}

/** "Who may act" (E §3.3 `_authorised_to_act`): SUPER_ADMIN always; the current owner; or, if
 *  unassigned, any user whose role matches owner_role. SUPER_ADMIN's blanket bypass is consistent
 *  with how this codebase already treats it everywhere else (POLICY_STUDIO_ROLES, etc.) — a
 *  deliberate extension beyond Emergent's literal per-endpoint guards, not a gap. */
function assertMayAct(action: ActionRow, ctx: Ctx): void {
  if (ctx.actor.roles.includes("SUPER_ADMIN")) return;
  if (action.owner_user_id) {
    if (action.owner_user_id === ctx.actor.user_id) return;
    throw new AppError("forbidden", "only the owner (or SUPER_ADMIN) may act on this action");
  }
  if (!ctx.actor.roles.includes(action.owner_role)) {
    throw new AppError("forbidden", `requires role ${action.owner_role} (unassigned action)`);
  }
}

async function recordTransition(actionId: string, from: ActionStatus, to: ActionStatus, actor: string | null, reason: string | null, tx: DbLike): Promise<void> {
  await tx.query(
    `INSERT INTO action_transition (id, action_id, from_status, to_status, actor, reason) VALUES ($1,$2,$3,$4,$5,$6)`,
    ["atr_" + randomUUID().slice(0, 8), actionId, from, to, actor, reason]
  );
}

async function setStatus(actionId: string, to: ActionStatus, tx: DbLike): Promise<void> {
  await tx.query(`UPDATE action SET status = $2 WHERE id = $1`, [actionId, to]);
}

async function emitStatusChanged(action: ActionRow, to: ActionStatus, tx: DbLike): Promise<void> {
  await appendEvent(tx, {
    type: "action.status_changed",
    entity_type: "action",
    entity_id: action.id,
    project_id: action.project_id,
    booking_id: action.booking_id,
    payload: { from: action.status, to },
  });
}

/** Rule 5: unowned action sits in the role queue; first claimer becomes owner. */
export async function claimAction(actionId: string, ctx: Ctx): Promise<void> {
  requireRole(ctx, STAFF_ROLES);
  await withTx(undefined, async (tx) => {
    const a = await requireAction(actionId, tx);
    if (a.owner_user_id) throw new AppError("conflict", "action already has an owner");
    if (!ctx.actor.roles.includes(a.owner_role) && !ctx.actor.roles.includes("SUPER_ADMIN")) {
      throw new AppError("forbidden", `requires role ${a.owner_role}`);
    }
    await tx.query(`UPDATE action SET owner_user_id = $2 WHERE id = $1`, [actionId, ctx.actor.user_id]);
    await recordTransition(actionId, a.status, a.status, ctx.actor.user_id, "claimed", tx);
  });
}

/** Rule 5: reassign keeps history; blocked while Ready for Approval (guards against
 *  reassign-then-approve defeating the self-approve check). */
export async function reassignAction(actionId: string, newOwnerUserId: string, ctx: Ctx): Promise<void> {
  requireRole(ctx, STAFF_ROLES);
  await withTx(undefined, async (tx) => {
    const a = await requireAction(actionId, tx);
    assertMayAct(a, ctx);
    if (a.status === "Ready for Approval") throw new AppError("conflict", "cannot reassign while Ready for Approval");
    await tx.query(`UPDATE action SET owner_user_id = $2 WHERE id = $1`, [actionId, newOwnerUserId]);
    await recordTransition(actionId, a.status, a.status, ctx.actor.user_id, `reassigned to ${newOwnerUserId}`, tx);
    await appendEvent(tx, { type: "action.reassigned", entity_type: "action", entity_id: actionId, project_id: a.project_id, booking_id: a.booking_id, actor_user_id: ctx.actor.user_id, payload: { new_owner_user_id: newOwnerUserId } });
  });
}

/** Rule 3: New -> In Progress, owner acts (auto-claims if unassigned and caller's role matches). */
export async function startAction(actionId: string, ctx: Ctx): Promise<void> {
  requireRole(ctx, STAFF_ROLES);
  await withTx(undefined, async (tx) => {
    const a = await requireAction(actionId, tx);
    assertMayAct(a, ctx);
    if (a.status !== "New") throw new AppError("conflict", `cannot start from ${a.status}`);
    if (!a.owner_user_id) await tx.query(`UPDATE action SET owner_user_id = $2 WHERE id = $1`, [actionId, ctx.actor.user_id]);
    await setStatus(actionId, "In Progress", tx);
    await recordTransition(actionId, a.status, "In Progress", ctx.actor.user_id, null, tx);
    await emitStatusChanged(a, "In Progress", tx);
  });
}

/** Rule 3: In Progress <-> Waiting Internal|Waiting Customer, reason required. */
export async function waitAction(actionId: string, target: "Waiting Internal" | "Waiting Customer", reason: string, ctx: Ctx): Promise<void> {
  requireRole(ctx, STAFF_ROLES);
  if (!reason?.trim()) throw new AppError("validation", "reason is required", "reason");
  await withTx(undefined, async (tx) => {
    const a = await requireAction(actionId, tx);
    assertMayAct(a, ctx);
    if (a.status !== "In Progress" && a.status !== "Waiting Internal" && a.status !== "Waiting Customer") {
      throw new AppError("conflict", `cannot wait from ${a.status}`);
    }
    await setStatus(actionId, target, tx);
    await recordTransition(actionId, a.status, target, ctx.actor.user_id, reason, tx);
    await emitStatusChanged(a, target, tx);
  });
}

/** Rule 3: -> Blocked, reason + (depends_on_action_id or a free-text blocking entity note). */
export async function blockAction(actionId: string, reason: string, dependsOnActionId: string | null, ctx: Ctx): Promise<void> {
  requireRole(ctx, STAFF_ROLES);
  if (!reason?.trim()) throw new AppError("validation", "reason is required", "reason");
  await withTx(undefined, async (tx) => {
    const a = await requireAction(actionId, tx);
    assertMayAct(a, ctx);
    if (a.status === "Closed" || a.status === "Cancelled") throw new AppError("conflict", `cannot block from ${a.status}`);
    await tx.query(`UPDATE action SET status = 'Blocked', blocking_reason = $2, depends_on_action_id = $3 WHERE id = $1`, [actionId, reason, dependsOnActionId]);
    await recordTransition(actionId, a.status, "Blocked", ctx.actor.user_id, reason, tx);
    await emitStatusChanged(a, "Blocked", tx);
  });
}

export async function unblockAction(actionId: string, ctx: Ctx): Promise<void> {
  requireRole(ctx, STAFF_ROLES);
  await withTx(undefined, async (tx) => {
    const a = await requireAction(actionId, tx);
    assertMayAct(a, ctx);
    if (a.status !== "Blocked") throw new AppError("conflict", "action is not Blocked");
    await tx.query(`UPDATE action SET status = 'In Progress', blocking_reason = NULL, depends_on_action_id = NULL WHERE id = $1`, [actionId]);
    await recordTransition(actionId, a.status, "In Progress", ctx.actor.user_id, "unblocked", tx);
    await emitStatusChanged(a, "In Progress", tx);
  });
}

/** Rule 3: -> Ready for Approval (approval family only). Records who submitted — the
 *  self-approve guard keys on this, not on owner_user_id (see migration file header). */
export async function submitForApproval(actionId: string, ctx: Ctx): Promise<void> {
  requireRole(ctx, STAFF_ROLES);
  await withTx(undefined, async (tx) => {
    const a = await requireAction(actionId, tx);
    assertMayAct(a, ctx);
    const family = await actionFamily(a.type, tx);
    if (family !== "APPROVAL") throw new AppError("validation", "only APPROVAL-family actions submit for approval");
    if (a.status !== "In Progress") throw new AppError("conflict", `cannot submit for approval from ${a.status}`);
    await tx.query(`UPDATE action SET status = 'Ready for Approval', submitted_by = $2 WHERE id = $1`, [actionId, ctx.actor.user_id]);
    await recordTransition(actionId, a.status, "Ready for Approval", ctx.actor.user_id, null, tx);
    await emitStatusChanged(a, "Ready for Approval", tx);
  });
}

/** Rule 4 (APPROVAL): approver_role holder (or SUPER_ADMIN/MANAGEMENT — E §3.2 "SA, MANAGEMENT,
 *  or task.approver_role") who is NOT the submitter approves -> Closed directly (mirrors
 *  Emergent's /approve: "Approved -> Completed"). */
export async function approveAction(actionId: string, note: string | undefined, ctx: Ctx, maybeTx?: DbLike): Promise<void> {
  requireRole(ctx, STAFF_ROLES);
  await withTx(maybeTx, async (tx) => {
    const a = await requireAction(actionId, tx);
    if (a.status !== "Ready for Approval") throw new AppError("conflict", "action is not Ready for Approval");
    const isSA = ctx.actor.roles.includes("SUPER_ADMIN") || ctx.actor.roles.includes("MANAGEMENT");
    if (!isSA && !(a.approver_role && ctx.actor.roles.includes(a.approver_role))) {
      throw new AppError("forbidden", `requires role ${a.approver_role ?? "(none configured)"}, MANAGEMENT or SUPER_ADMIN`);
    }
    if (a.submitted_by && a.submitted_by === ctx.actor.user_id) {
      throw new AppError("forbidden", "cannot approve your own submission (self-approve guard)");
    }
    await closeActionCore(a, note ?? null, ctx.actor.user_id, tx);
  });
}

export async function rejectAction(actionId: string, reason: string, ctx: Ctx): Promise<void> {
  requireRole(ctx, STAFF_ROLES);
  if (!reason?.trim()) throw new AppError("validation", "reason is required", "reason");
  await withTx(undefined, async (tx) => {
    const a = await requireAction(actionId, tx);
    if (a.status !== "Ready for Approval") throw new AppError("conflict", "action is not Ready for Approval");
    const isSA = ctx.actor.roles.includes("SUPER_ADMIN") || ctx.actor.roles.includes("MANAGEMENT");
    if (!isSA && !(a.approver_role && ctx.actor.roles.includes(a.approver_role))) {
      throw new AppError("forbidden", `requires role ${a.approver_role ?? "(none configured)"}, MANAGEMENT or SUPER_ADMIN`);
    }
    await tx.query(`UPDATE action SET status = 'In Progress', submitted_by = NULL WHERE id = $1`, [actionId]);
    await recordTransition(actionId, a.status, "In Progress", ctx.actor.user_id, reason, tx);
    await emitStatusChanged(a, "In Progress", tx);
  });
}

async function checkEvidenceGate(a: ActionRow, tx: DbLike): Promise<void> {
  // VERIFICATION-family actions default to evidence_requirement NONE — Emergent's Verification
  // execution type has no attachment step at all (submit-for-verification -> verify); mapping it
  // to VERIFIED_ATTACHMENT would require a file upload that never existed for T2/T13 and make
  // them permanently unclosable. The real gate for that family is authorization (closeAction's
  // caller already checked verifier_role != owner_user_id), not evidence.
  switch (a.evidence_requirement) {
    case "NONE":
      return;
    case "ATTACHMENT": {
      const r = await tx.query<{ count: string }>(`SELECT count(*)::text FROM action_evidence WHERE action_id = $1`, [a.id]);
      if (Number(r.rows[0].count) === 0) throw new AppError("conflict", "gate_blocked: at least one evidence attachment is required");
      return;
    }
    case "VERIFIED_ATTACHMENT": {
      const r = await tx.query<{ count: string }>(`SELECT count(*)::text FROM action_evidence WHERE action_id = $1 AND verification_status = 'VERIFIED'`, [a.id]);
      if (Number(r.rows[0].count) === 0) throw new AppError("conflict", "gate_blocked: evidence not verified");
      return;
    }
    case "CHECKLIST": {
      const r = await tx.query<{ count: string }>(`SELECT count(*)::text FROM action_checklist_item WHERE action_id = $1 AND required AND checked_at IS NULL`, [a.id]);
      if (Number(r.rows[0].count) > 0) throw new AppError("conflict", "gate_blocked: required checklist items are not checked");
      return;
    }
    case "APPROVAL":
      throw new AppError("validation", "APPROVAL-family actions close via /approve, not /close");
    case "EXTERNAL_REF":
      if (!a.external_reference) throw new AppError("conflict", "gate_blocked: external reference is required");
      return;
  }
}

async function closeActionCore(a: ActionRow, note: string | null, closedBy: string, tx: DbLike): Promise<void> {
  if (a.sla_clock_id) await stopClock(a.sla_clock_id, tx);
  await tx.query(`UPDATE action SET status = 'Closed', closed_at = now(), closed_by = $2, close_note = $3 WHERE id = $1`, [a.id, closedBy, note]);
  await recordTransition(a.id, a.status, "Closed", closedBy, note, tx);
  await appendEvent(tx, {
    type: "action.closed",
    entity_type: "action",
    entity_id: a.id,
    project_id: a.project_id,
    booking_id: a.booking_id,
    actor_user_id: closedBy,
    payload: { close_note: note },
  });
}

/** Rule 4: close is refused (gate_blocked) unless the evidence requirement is met. Accepts an
 *  optional `maybeTx` so journey/instances.ts's completeTaskInstance (10's one wired Source) can
 *  call this from inside its own transaction instead of nesting a second one — same "pass tx
 *  down" pattern events/append.ts documents for acceptBooking -> setupFunding. */
export async function closeAction(actionId: string, note: string | undefined, ctx: Ctx, maybeTx?: DbLike): Promise<void> {
  requireRole(ctx, STAFF_ROLES);
  await withTx(maybeTx, async (tx) => {
    const a = await requireAction(actionId, tx);
    if (a.status === "Closed" || a.status === "Cancelled") throw new AppError("conflict", `action already ${a.status}`);
    const family = await actionFamily(a.type, tx);
    if (family === "VERIFICATION") {
      // The verifier (not the doer) closes directly — no separate /verify endpoint at the
      // action level (10's own API list has none; only evidence-level verify does). Matches
      // Emergent's self-verify guard text keyed here on owner_user_id, the closest equivalent
      // to "submitter" when no evidence row exists to carry an uploaded_by.
      if (!a.verifier_role || !ctx.actor.roles.includes(a.verifier_role)) {
        throw new AppError("forbidden", `requires role ${a.verifier_role ?? "(none configured)"}`);
      }
      if (a.owner_user_id && a.owner_user_id === ctx.actor.user_id && !ctx.actor.roles.includes("SUPER_ADMIN")) {
        throw new AppError("forbidden", "cannot verify/close a task you own (self-verify guard)");
      }
    } else {
      assertMayAct(a, ctx);
    }
    await checkEvidenceGate(a, tx);
    await closeActionCore(a, note ?? null, ctx.actor.user_id, tx);
  });
}

/** Rule 3: any status but Closed -> Cancelled. MANAGEMENT/SUPER_ADMIN always; the creator may
 *  cancel their own MANUAL action while still New. */
export async function cancelAction(actionId: string, reason: string, ctx: Ctx): Promise<void> {
  requireRole(ctx, STAFF_ROLES);
  if (!reason?.trim()) throw new AppError("validation", "reason is required", "reason");
  await withTx(undefined, async (tx) => {
    const a = await requireAction(actionId, tx);
    if (a.status === "Closed" || a.status === "Cancelled") throw new AppError("conflict", `action already ${a.status}`);
    const isMgmt = ctx.actor.roles.includes("MANAGEMENT") || ctx.actor.roles.includes("SUPER_ADMIN");
    if (!isMgmt) {
      const creator = await tx.query<{ created_by: string | null }>(`SELECT created_by FROM action WHERE id = $1`, [actionId]);
      if (creator.rows[0]?.created_by !== ctx.actor.user_id || a.status !== "New") {
        throw new AppError("forbidden", "requires MANAGEMENT/SUPER_ADMIN, or the creator while still New");
      }
    }
    if (a.sla_clock_id) await stopClock(a.sla_clock_id, tx).catch(() => {}); // already-stopped is fine on cancel
    await tx.query(`UPDATE action SET status = 'Cancelled' WHERE id = $1`, [actionId]);
    await recordTransition(actionId, a.status, "Cancelled", ctx.actor.user_id, reason, tx);
    await appendEvent(tx, { type: "action.cancelled", entity_type: "action", entity_id: actionId, project_id: a.project_id, booking_id: a.booking_id, actor_user_id: ctx.actor.user_id, payload: { reason } });
  });
}

/** Evidence upload (files port key already obtained by the route). Auto New -> In Progress,
 *  mirroring Emergent's /attach-evidence. */
export async function addEvidence(actionId: string, fileKey: string, kind: string | undefined, ctx: Ctx): Promise<string> {
  requireRole(ctx, STAFF_ROLES);
  return withTx(undefined, async (tx) => {
    const a = await requireAction(actionId, tx);
    assertMayAct(a, ctx);
    if (a.status === "Closed" || a.status === "Cancelled") throw new AppError("conflict", `cannot add evidence to a ${a.status} action`);
    const id = "aev_" + randomUUID().slice(0, 8);
    await tx.query(`INSERT INTO action_evidence (id, action_id, file_key, kind, uploaded_by) VALUES ($1,$2,$3,$4,$5)`, [id, actionId, fileKey, kind ?? null, ctx.actor.user_id]);
    if (a.status === "New") {
      await setStatus(actionId, "In Progress", tx);
      await recordTransition(actionId, a.status, "In Progress", ctx.actor.user_id, "evidence attached", tx);
    }
    return id;
  });
}

/** Rule 4 self-verify guard: verifier_role holder who did NOT upload this evidence. */
export async function verifyEvidence(evidenceId: string, decision: "VERIFIED" | "REJECTED", note: string | undefined, ctx: Ctx): Promise<void> {
  requireRole(ctx, STAFF_ROLES);
  await withTx(undefined, async (tx) => {
    const ev = await tx.query<{ action_id: string; uploaded_by: string; verification_status: string }>(`SELECT action_id, uploaded_by, verification_status FROM action_evidence WHERE id = $1`, [evidenceId]);
    if (!ev.rows[0]) throw new AppError("not_found", "evidence not found");
    const e = ev.rows[0];
    if (e.verification_status !== "UPLOADED") throw new AppError("conflict", `evidence already ${e.verification_status}`);
    const a = await requireAction(e.action_id, tx);
    if (!a.verifier_role || !ctx.actor.roles.includes(a.verifier_role)) {
      throw new AppError("forbidden", `requires role ${a.verifier_role ?? "(none configured)"}`);
    }
    if (e.uploaded_by === ctx.actor.user_id && !ctx.actor.roles.includes("SUPER_ADMIN")) {
      throw new AppError("forbidden", "cannot verify evidence you uploaded (self-verify guard)");
    }
    await tx.query(`UPDATE action_evidence SET verification_status = $2, verified_by = $3, note = $4 WHERE id = $1`, [evidenceId, decision, ctx.actor.user_id, note ?? null]);
    if (decision === "VERIFIED") {
      await appendEvent(tx, { type: "action.evidence_verified", entity_type: "action_evidence", entity_id: evidenceId, project_id: a.project_id, booking_id: a.booking_id, actor_user_id: ctx.actor.user_id, payload: { action_id: a.id } });
    }
  });
}

/** EXTERNAL_REF close gate (rule 4) — no dedicated API list entry, so this rides the same
 *  "small setter, owner/SA gated" shape as setChecklistItem below. */
export async function setExternalReference(actionId: string, reference: string, ctx: Ctx): Promise<void> {
  requireRole(ctx, STAFF_ROLES);
  await withTx(undefined, async (tx) => {
    const a = await requireAction(actionId, tx);
    assertMayAct(a, ctx);
    await tx.query(`UPDATE action SET external_reference = $2 WHERE id = $1`, [actionId, reference]);
  });
}

export async function setChecklistItem(actionId: string, itemId: string, checked: boolean, ctx: Ctx): Promise<void> {
  requireRole(ctx, STAFF_ROLES);
  await withTx(undefined, async (tx) => {
    const a = await requireAction(actionId, tx);
    assertMayAct(a, ctx);
    await tx.query(
      `UPDATE action_checklist_item SET checked_at = $3, checked_by = $4 WHERE id = $1 AND action_id = $2`,
      [itemId, actionId, checked ? new Date().toISOString() : null, checked ? ctx.actor.user_id : null]
    );
  });
}

/** Called by journey/instances.ts's cascadeActionable once a dependent task_instance gets its
 *  own SLA clock started — keeps action.sla_clock_id in sync (shared clock, not a second one). */
export async function setActionClock(actionId: string, slaClockId: string, tx: DbLike): Promise<void> {
  await tx.query(`UPDATE action SET sla_clock_id = $2 WHERE id = $1`, [actionId, slaClockId]);
}

/** Called by journey/instances.ts's reopenTaskInstance for every task in the transitive reset
 *  set — the mirror-image reset on the action side, so a reopened task's action doesn't stay
 *  stuck Closed while its task_instance goes back to New. System-authored (actor: null). */
export async function resetActionForReopen(actionId: string, reason: string, tx: DbLike): Promise<void> {
  const a = await requireAction(actionId, tx);
  // A dependent action can be New with a clock already armed (cascadeActionable/setActionClock
  // ran at instantiation or when an upstream task closed) — only skip when there is truly
  // nothing to clear, or reopen leaves a stale sla_clock_id pointing at a voided clock.
  if (a.status === "New" && !a.sla_clock_id) return;
  if (a.sla_clock_id) await stopClock(a.sla_clock_id, tx).catch(() => {});
  await tx.query(
    `UPDATE action SET status = 'New', sla_clock_id = NULL, closed_at = NULL, closed_by = NULL,
       close_note = NULL, submitted_by = NULL, blocking_reason = NULL, depends_on_action_id = NULL
      WHERE id = $1`,
    [actionId]
  );
  await recordTransition(actionId, a.status, "New", null, reason, tx);
}

export interface ActionListItem {
  id: string; code: string; type: string; title: string; status: ActionStatus; priority: Priority;
  owner_user_id: string | null; owner_role: string; due_at: string | null;
  customer_visible: boolean; project_id: string | null;
}

export async function listActions(filter: { owner_user_id?: string; owner_role?: string; status?: ActionStatus; project_id?: string }, ctx: Ctx): Promise<ActionListItem[]> {
  requireRole(ctx, STAFF_ROLES);
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.owner_user_id) { params.push(filter.owner_user_id); clauses.push(`owner_user_id = $${params.length}`); }
  if (filter.owner_role) { params.push(filter.owner_role); clauses.push(`owner_role = $${params.length}`); }
  if (filter.status) { params.push(filter.status); clauses.push(`status = $${params.length}`); }
  if (filter.project_id) { params.push(filter.project_id); clauses.push(`project_id = $${params.length}`); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const r = await db.query<ActionListItem>(
    `SELECT id, code, type, title, status, priority, owner_user_id, owner_role, due_at::text AS due_at, customer_visible, project_id
       FROM action ${where} ORDER BY due_at NULLS LAST`, // priority/SLA-weighted ranking is 11, out of scope here (rule 8)
    params
  );
  return r.rows;
}

export interface QueueRow { owner_role: string; status: ActionStatus; count: number }

export async function getQueue(role: string, ctx: Ctx): Promise<QueueRow[]> {
  requireRole(ctx, STAFF_ROLES);
  const r = await db.query<QueueRow>(`SELECT owner_role, status, count FROM departmental_queue WHERE owner_role = $1`, [role]);
  return r.rows;
}

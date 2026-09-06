import { randomUUID } from "node:crypto";
import { db } from "../db";
import { withTx } from "../events";
import { requireRole, STAFF_ROLES } from "../authz/requireRole";
import { AppError, type Ctx } from "../authz/types";
import { createNotification } from "../notifications/core";

// 29-communications.md rule 7 — internal notes, always INTERNAL, never returned by any /portal/*
// endpoint (26's own `assertNoDenylistedKeys` tripwire already checks the literal key
// "internal_note" generically; satisfied here by never wiring this module into portal/core.ts at
// all, not by a masking step). No dedicated permission_matrix module covers "internal notes on any
// entity" — gated with `requireRole(STAFF_ROLES)`, same class of gap as `getUnit`'s own precedent
// (12-escalations-notifications.md's own header already flagged "@mention has no comment/mention
// system anywhere in this codebase" — this is that mechanism's first real build).

export interface InternalNoteRow { id: string; entity_type: string; entity_id: string; body: string; author_user_id: string; mentions: string[]; created_at: string }
const SELECT = `SELECT id, entity_type, entity_id, body, author_user_id, mentions, created_at::text AS created_at FROM internal_note`;

export async function listInternalNotes(entityType: string, entityId: string, ctx: Ctx): Promise<InternalNoteRow[]> {
  requireRole(ctx, STAFF_ROLES);
  const r = await db.query<InternalNoteRow>(`${SELECT} WHERE entity_type = $1 AND entity_id = $2 ORDER BY created_at DESC`, [entityType, entityId]);
  return r.rows;
}

export async function createInternalNote(input: { entity_type: string; entity_id: string; body: string; mentions?: string[] }, ctx: Ctx): Promise<InternalNoteRow> {
  requireRole(ctx, STAFF_ROLES);
  if (!input.entity_type?.trim() || !input.entity_id?.trim()) throw new AppError("validation", "entity_type and entity_id are required");
  if (!input.body?.trim()) throw new AppError("validation", "body is required", "body");
  const id = "note_" + randomUUID().slice(0, 8);
  const mentions = [...new Set(input.mentions ?? [])];

  await withTx(undefined, async (tx) => {
    await tx.query(
      `INSERT INTO internal_note (id, entity_type, entity_id, body, author_user_id, mentions) VALUES ($1,$2,$3,$4,$5,$6::text[])`,
      [id, input.entity_type, input.entity_id, input.body, ctx.actor.user_id, mentions]
    );
    for (const userId of mentions) {
      if (userId === ctx.actor.user_id) continue; // don't notify yourself for your own mention
      await createNotification(
        { user_id: userId, type: "internal_note.mentioned", title: "You were mentioned in a note", body: input.body, entity_ref: { entity_type: input.entity_type, entity_id: input.entity_id } },
        tx
      );
    }
  });

  const r = await db.query<InternalNoteRow>(`${SELECT} WHERE id = $1`, [id]);
  return r.rows[0]!;
}

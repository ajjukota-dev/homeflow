// GET /audit — paged, masked (02 §API, rule 3, rule 5). Answers who/what/when/from
// where/before-after for Booking, Unit, Customer, Document, Commitment, Change Request, Gate.
import { db } from "../db";
import { authorize } from "../authz/authorize";
import type { Ctx } from "../authz/types";

export interface AuditQuery {
  entity_type?: string;
  entity_id?: string;
  from?: string;
  to?: string;
  page?: number;
  page_size?: number;
}

export interface AuditRow {
  id: string;
  occurred_at: string;
  type: string;
  entity_type: string;
  entity_id: string;
  project_id: string | null;
  actor_user_id: string | null;
  actor_kind: string;
  payload: Record<string, unknown>;
  source_ref: string | null;
}

/**
 * mask() hook point (rule 3: "audit views apply mask() from 01 on render, not on write").
 * 01-identity-access isn't merged in this worktree yet, so this is a passthrough — replace
 * the body with the real field-sensitivity mask once that lane lands. Kept as its own function
 * so the call site here never needs to change.
 */
export function mask(payload: Record<string, unknown>): Record<string, unknown> {
  return payload;
}

export async function getAudit(
  q: AuditQuery,
  ctx: Ctx
): Promise<{ data: AuditRow[]; page: number; page_size: number; total: number }> {
  await authorize(ctx, "reports", "READ");
  const page = Math.max(1, q.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, q.page_size ?? 25));
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (q.entity_type) {
    params.push(q.entity_type);
    conditions.push(`entity_type = $${params.length}`);
  }
  if (q.entity_id) {
    params.push(q.entity_id);
    conditions.push(`entity_id = $${params.length}`);
  }
  if (q.from) {
    params.push(q.from);
    conditions.push(`occurred_at >= $${params.length}`);
  }
  if (q.to) {
    params.push(q.to);
    conditions.push(`occurred_at <= $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const total = await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM event ${where}`, params);
  params.push(pageSize, (page - 1) * pageSize);
  const rows = await db.query<AuditRow>(
    `SELECT id::text AS id, occurred_at::text AS occurred_at, type, entity_type, entity_id,
            project_id, actor_user_id, actor_kind, payload, source_ref
       FROM event ${where}
      ORDER BY occurred_at DESC, id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return {
    data: rows.rows.map((r) => ({ ...r, payload: mask(r.payload) })),
    page,
    page_size: pageSize,
    total: total.rows[0]?.n ?? 0,
  };
}

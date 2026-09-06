import { db } from "../db";
import { actionsForBooking, buildRanked } from "../myday/core";
import { whyNow } from "../myday/rank";

// 31-intelligence.md rule 4: "deterministic: for a booking, the open action with the highest 11
// score plus a rule-based 'recommended' from the decision pack options (12); never free-text
// advice." Reuses 11's own ranking engine (`myday/rank.ts::scoreAction` via `buildRanked`) rather
// than a second scoring model — this is the exact same score a My Day feed would show for the
// action, just booking-scoped instead of actor-scoped. The "recommended" half reads 12's own
// `escalation.decision_pack.recommended` (a plain string field within that jsonb, per
// `escalations/core.ts`'s own shape) when the top action has an open escalation — never
// synthesized text of its own.

export interface NextBestAction {
  action_id: string | null;
  title: string | null;
  score: number | null;
  why_now: string | null;
  recommended: string | null;
}

export async function getNextBestAction(bookingId: string, asOf: string = new Date().toISOString()): Promise<NextBestAction> {
  const rows = await actionsForBooking(bookingId);
  if (rows.length === 0) return { action_id: null, title: null, score: null, why_now: null, recommended: null };

  const built = await buildRanked(rows, asOf);
  const top = built.reduce((best, o) => (o.ranked.score > best.ranked.score ? o : best));

  const esc = await db.query<{ recommended: string | null }>(
    `SELECT decision_pack->>'recommended' AS recommended FROM escalation
      WHERE action_id = $1 AND status NOT IN ('RESOLVED', 'CLOSED') ORDER BY raised_at DESC LIMIT 1`,
    [top.row.id]
  );

  return {
    action_id: top.row.id,
    title: top.row.title,
    score: top.ranked.score,
    why_now: whyNow(top.input, top.ranked, asOf),
    recommended: esc.rows[0]?.recommended ?? null,
  };
}

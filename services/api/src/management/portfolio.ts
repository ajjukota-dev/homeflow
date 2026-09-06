// 27-management-control-tower.md — "Portfolio strip (projects with 4 numbers)" and the Portfolio
// view tab: readiness, cash, risk, experience, one row per project.

import { db } from "../db";
import { authorize } from "../authz/authorize";
import type { Ctx } from "../authz/types";
import { projectCollections } from "../collections-view";
import { computeBookingReadiness } from "../scores/booking-readiness";
import { computeKpi } from "../kpis/queries";

export interface PortfolioRow {
  project_id: string; project_name: string;
  readiness_pct: number | null; // average booking readiness across active bookings
  cash_outstanding_inr: number;
  risk_inr: number; // true-risk bucket
  experience_score: number | null; // average check-in score
}

export async function getPortfolio(ctx: Ctx): Promise<PortfolioRow[]> {
  await authorize(ctx, "reports", "READ");
  const projects = await db.query<{ id: string; name: string }>(`SELECT id, name FROM project ORDER BY name`);
  const out: PortfolioRow[] = [];
  for (const p of projects.rows) {
    const bookings = await db.query<{ id: string }>(`SELECT id FROM booking WHERE project_id = $1 AND status = 'active'`, [p.id]);
    let readinessSum = 0, readinessCount = 0;
    for (const b of bookings.rows) {
      try {
        const score = await computeBookingReadiness(b.id);
        readinessSum += score.value;
        readinessCount++;
      } catch { /* a booking mid-lifecycle can lack facts computeBookingReadiness needs — skip, don't fail the whole portfolio row */ }
    }
    const collections = await projectCollections(p.id);
    const experience = await computeKpi("ex_checkin_score", p.id, new Date().toISOString().slice(0, 7), db);
    out.push({
      project_id: p.id,
      project_name: p.name,
      readiness_pct: readinessCount > 0 ? readinessSum / readinessCount : null,
      cash_outstanding_inr: collections.outstanding_total,
      risk_inr: collections.buckets.TRUE_RISK.amount,
      experience_score: experience.value,
    });
  }
  return out;
}

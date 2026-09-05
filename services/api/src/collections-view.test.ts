import { describe, it, expect, beforeAll } from "vitest";
import { initDb, db } from "./db";
import { projectCollections } from "./collections-view";
import { today } from "./demands";
import type { RiskBucket } from "./collections";

// Rule 3 (19-collections-true-risk.md): "Buckets are mutually exclusive by definition ... tests
// assert partition sums equal outstanding." Written FIRST, against the real merged seed data
// (seed.ts's b_v110/b_v111 bookings), before any spec-19 schema change — advisor review flagged
// this as the highest-value first move: if the invariant already held, it's pinned before any
// restructuring touches it; if it didn't, that's a real bug in merged financial code found for
// the cost of one test. It held (see below).
//
// b_v110/b_v111 already exercise exactly the 8 states the spec's Acceptance section names:
// SETTLED (excluded), DUE, OVERDUE (recoverable — 10 days), TRUE_RISK (70 days, below the 0.40
// policy threshold), SCHEDULED (excluded, x3), LOAN_DEPENDENT, DISPUTED, PROMISE_TO_PAY.

beforeAll(async () => {
  await initDb();
});

describe("projectCollections: rule 3 partition — every open demand in exactly one bucket, sums equal outstanding", () => {
  it("real seeded demo data (p_eastcrest) partitions cleanly across all 6 risk buckets", async () => {
    const view = await projectCollections("p_eastcrest", today());

    // No demand appears under more than one bucket.
    const seen = new Map<string, RiskBucket>();
    for (const [bucket, group] of Object.entries(view.buckets) as [RiskBucket, typeof view.buckets.DUE][]) {
      for (const item of group.items) {
        expect(seen.has(item.demand_id)).toBe(false); // would mean a demand landed in two buckets
        seen.set(item.demand_id, bucket);
      }
    }

    // Bucket totals sum to outstanding_total (rule 3's partition assertion).
    const bucketSum = Object.values(view.buckets).reduce((s, g) => s + g.amount, 0);
    expect(bucketSum).toBeCloseTo(view.outstanding_total, 6);

    // Known seeded demands land in the bucket their real facts dictate.
    expect(seen.get("d_v110_2")).toBe("DUE");
    expect(seen.get("d_v110_3")).toBe("OVERDUE"); // 10 days overdue, recovery 0.8 >= 0.40 threshold
    expect(seen.get("d_v110_4")).toBe("TRUE_RISK"); // 70 days overdue, recovery 0.25 < 0.40 threshold
    expect(seen.get("d_v111_1")).toBe("LOAN_DEPENDENT");
    expect(seen.get("d_v111_2")).toBe("DISPUTED");
    expect(seen.get("d_v111_3")).toBe("PROMISE_TO_PAY");

    // SETTLED (d_v110_1, fully receipted) and SCHEDULED (d_v110_5, d_v111_4, d_v111_5, no
    // due_date yet) never appear in any bucket — they carry no open risk.
    for (const excluded of ["d_v110_1", "d_v110_5", "d_v111_4", "d_v111_5"]) {
      expect(seen.has(excluded)).toBe(false);
    }
  });

  it("cross-check: outstanding_total equals a direct SQL sum of remaining balances for every non-settled, non-scheduled, non-zero demand in the project", async () => {
    const view = await projectCollections("p_eastcrest", today());
    const r = await db.query<{ total: number }>(
      `SELECT COALESCE(SUM(d.amount - COALESCE((
         SELECT SUM(r.amount) FROM receipt r WHERE r.demand_id = d.id AND r.status IN ('posted','reconciled') AND r.verification != 'DISPUTED'
       ), 0)), 0)::float8 AS total
       FROM demand d
      WHERE d.project_id = $1 AND d.status NOT IN ('scheduled')
        AND (d.amount - COALESCE((SELECT SUM(r.amount) FROM receipt r WHERE r.demand_id = d.id AND r.status IN ('posted','reconciled') AND r.verification != 'DISPUTED'), 0)) > 0`,
      ["p_eastcrest"]
    );
    expect(view.outstanding_total).toBeCloseTo(Number(r.rows[0].total), 6);
  });
});

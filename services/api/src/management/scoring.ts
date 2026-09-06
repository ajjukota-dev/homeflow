// 27-management-control-tower.md rule 1 — pure ranking, framework-free (replaces tower.ts;
// CLAUDE.md's "explicit boundaries" principle: the composite-score math is unit-tested here in
// isolation from any DB access). One candidate wins per category (Data's own `category` enum is
// exactly these 5 values), exactly five shown — same invariant PR #8's `pickFive` already
// established; upgraded to rank by rule 1's own composite ("₹ impact × customer count × days"),
// weighted per `management_config.intervention_ranking_weights` rather than raw impact_rupee alone.

export const TOWER_CATEGORIES = ["customer", "cash", "handover", "reputation", "margin"] as const;
export type TowerCategory = (typeof TOWER_CATEGORIES)[number];

export interface Impact { inr: number; customers: number; days: number }

export interface TowerCandidate {
  category: TowerCategory;
  headline: string;
  what_happened: string;
  impact: Impact;
  owner: string;
  recommended_decision: string;
  evidence_links: string[];
  source_refs: string[]; // rule 2's dismiss-cooldown key
  booking_id?: string;
  unit_id?: string;
  dependencies: string[];
}

export interface DecisionPack {
  what_happened: string;
  impact: Impact;
  dependencies: string[];
  recommended_decision: string;
  evidence_links: string[];
}

export interface RankingWeights { inr: number; customers: number; days: number }

const ALL_CLEAR: Record<TowerCategory, string> = {
  customer: "No material customer exception today",
  cash: "No material cash exception today",
  handover: "No material handover exception today",
  reputation: "No material reputation exception today",
  margin: "No material margin exception today",
};

/** Rule 1's composite score. Weights are config (management_config.intervention_ranking_weights)
 *  so ₹1 vs 1 customer vs 1 day are commensurable without a hardcoded conversion — the weights
 *  ARE that conversion, and Amarsh/Pranava can retune them without a code change. */
export function impactScore(impact: Impact, weights: RankingWeights): number {
  return impact.inr / Math.max(weights.inr, 1) + impact.customers * weights.customers + impact.days * weights.days;
}

export function pickFive(candidates: TowerCandidate[], weights: RankingWeights, sourceRefsToSkip: Set<string> = new Set()) {
  const eligible = candidates.filter((c) => !c.source_refs.some((r) => sourceRefsToSkip.has(r)));
  const winners = TOWER_CATEGORIES.map((category) => {
    const picked = eligible
      .filter((c) => c.category === category)
      .sort((a, b) => impactScore(b.impact, weights) - impactScore(a.impact, weights))[0];
    return { category, picked };
  });
  // Rank by composite score (rule 1), but keep the array in TOWER_CATEGORIES' own fixed order —
  // five stable card positions on screen, each independently labeled with its rank, rather than
  // reflowing the whole layout every time the underlying scores shift.
  const scored = winners.map(({ category, picked }) => ({ category, picked, score: picked ? impactScore(picked.impact, weights) : -1 }));
  const rankByCategory = new Map(
    [...scored].sort((a, b) => b.score - a.score).map(({ category }, index) => [category, index + 1])
  );
  return scored
    .map(({ category, picked }) => ({ category, picked, rank: rankByCategory.get(category)! }))
    .map(({ category, picked, rank }) => {
      if (!picked) {
        return {
          category,
          rank,
          material: false,
          headline: ALL_CLEAR[category],
          owner: "—",
          source_refs: [] as string[],
          booking_id: undefined as string | undefined,
          unit_id: undefined as string | undefined,
          decision_pack: {
            what_happened: ALL_CLEAR[category],
            impact: { inr: 0, customers: 0, days: 0 },
            dependencies: [],
            recommended_decision: "No action needed today",
            evidence_links: [],
          } satisfies DecisionPack,
        };
      }
      return {
        category,
        rank,
        material: true,
        headline: picked.headline,
        owner: picked.owner,
        source_refs: picked.source_refs,
        booking_id: picked.booking_id,
        unit_id: picked.unit_id,
        decision_pack: {
          what_happened: picked.what_happened,
          impact: picked.impact,
          dependencies: picked.dependencies,
          recommended_decision: picked.recommended_decision,
          evidence_links: picked.evidence_links,
        } satisfies DecisionPack,
      };
    });
}

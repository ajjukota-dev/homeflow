// Control Tower — exactly five ranked interventions (management/spec.md §1.3, H11).

export const TOWER_CATEGORIES = ["customer", "cash", "handover", "reputation", "margin"] as const;
export type TowerCategory = (typeof TOWER_CATEGORIES)[number];

export interface TowerCandidate {
  category: TowerCategory;
  headline: string;
  what_happened: string;
  impact_rupee: number;
  impact_customer: string;
  owner: string;
  recommended_decision: string;
  evidence_links: string[];
  booking_id?: string;
  unit_id?: string;
  dependencies: string[];
}

export interface DecisionPack {
  what_happened: string;
  impact: { customer: string; rupee: number };
  dependencies: string[];
  recommended_decision: string;
  evidence_links: string[];
}

const ALL_CLEAR: Record<TowerCategory, string> = {
  customer: "No material customer exception today",
  cash: "No material cash exception today",
  handover: "No material handover exception today",
  reputation: "No material reputation exception today",
  margin: "No material margin exception today",
};

export function pickFive(candidates: TowerCandidate[]) {
  return TOWER_CATEGORIES.map((category, index) => {
    const picked = candidates
      .filter((c) => c.category === category)
      .sort((a, b) => b.impact_rupee - a.impact_rupee)[0];
    if (!picked) {
      return {
        category,
        rank: index + 1,
        material: false,
        headline: ALL_CLEAR[category],
        owner: "—",
        booking_id: undefined as string | undefined,
        unit_id: undefined as string | undefined,
        decision_pack: {
          what_happened: ALL_CLEAR[category],
          impact: { customer: "—", rupee: 0 },
          dependencies: [],
          recommended_decision: "No action needed today",
          evidence_links: [],
        } satisfies DecisionPack,
      };
    }
    return {
      category,
      rank: index + 1,
      material: true,
      headline: picked.headline,
      owner: picked.owner,
      booking_id: picked.booking_id,
      unit_id: picked.unit_id,
      decision_pack: {
        what_happened: picked.what_happened,
        impact: { customer: picked.impact_customer, rupee: picked.impact_rupee },
        dependencies: picked.dependencies,
        recommended_decision: picked.recommended_decision,
        evidence_links: picked.evidence_links,
      } satisfies DecisionPack,
    };
  });
}

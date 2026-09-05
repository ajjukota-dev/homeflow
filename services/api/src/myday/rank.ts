// 11-my-day-ranking.md rule 2/3. Pure, framework-free. Curves the spec names but doesn't specify
// exactly ("else decays", "log-scaled", no normalization scale for customer/dependency counts)
// are UNCONFIRMED placeholders, named per term below — Amarsh can tune without touching callers.

export type ClockStatus = "ON_TRACK" | "DUE_SOON" | "AT_RISK" | "OVERDUE" | "COMPLETED_ON_TIME" | "COMPLETED_LATE" | null;
export type Tier = "L0" | "L1" | "L2" | "L3" | "L4" | null;

export interface RankInput {
  id: string;
  due_at: string | null;
  clock_status: ClockStatus;
  customer_count: number;
  customer_visible: boolean;
  revenue_inr: number;
  project_median_demand_inr: number;
  dependency_count: number;
  escalation_tier: Tier;
}

export interface RankWeights {
  deadline: number;
  customer_impact: number;
  revenue_impact: number;
  dependency_impact: number;
  escalation_risk: number;
}

export const DEFAULT_WEIGHTS: RankWeights = { deadline: 0.35, customer_impact: 0.2, revenue_impact: 0.2, dependency_impact: 0.15, escalation_risk: 0.1 };

export interface RankTerms { deadline: number; customer_impact: number; revenue_impact: number; dependency_impact: number; escalation_risk: number }
export interface RankedAction { id: string; score: number; terms: RankTerms; due_at: string | null }

function deadlineTerm(dueAt: string | null, now: string): number {
  if (!dueAt) return 0;
  const hours = (Date.parse(dueAt) - Date.parse(now)) / (60 * 60 * 1000);
  if (hours < 0) return 1.0;
  if (hours <= 24) return 0.9;
  if (hours <= 72) return 0.6;
  const DECAY_WINDOW_DAYS = 30; // UNCONFIRMED — spec says "else decays" with no curve
  return Math.max(0, 0.6 * (1 - (hours - 72) / (DECAY_WINDOW_DAYS * 24)));
}

function customerImpactTerm(count: number, visible: boolean): number {
  const NORMALIZATION_CAP = 3; // UNCONFIRMED — no scale given for "normalised"
  const normalized = Math.min(1, count / NORMALIZATION_CAP);
  return Math.min(1, normalized + (visible ? 0.2 : 0));
}

function revenueImpactTerm(revenueInr: number, medianDemandInr: number): number {
  if (revenueInr <= 0 || medianDemandInr <= 0) return 0;
  // log-scaled against the project's median demand, capped at 1 around 10x median — UNCONFIRMED curve
  return Math.min(1, Math.log10(1 + revenueInr / medianDemandInr) / Math.log10(11));
}

function dependencyImpactTerm(count: number): number {
  const NORMALIZATION_CAP = 3; // UNCONFIRMED — no scale given
  return Math.min(1, count / NORMALIZATION_CAP);
}

function escalationRiskTerm(tier: Tier, clockStatus: ClockStatus): number {
  const tierIndex = tier ? ["L0", "L1", "L2", "L3", "L4"].indexOf(tier) : 0;
  const base = tierIndex / 4;
  if (clockStatus === "OVERDUE") return Math.max(base, 1.0);
  if (clockStatus === "AT_RISK") return Math.max(base, 0.5);
  return base;
}

export function scoreAction(input: RankInput, weights: RankWeights, now: string = new Date().toISOString()): RankedAction {
  const terms: RankTerms = {
    deadline: deadlineTerm(input.due_at, now),
    customer_impact: customerImpactTerm(input.customer_count, input.customer_visible),
    revenue_impact: revenueImpactTerm(input.revenue_inr, input.project_median_demand_inr),
    dependency_impact: dependencyImpactTerm(input.dependency_count),
    escalation_risk: escalationRiskTerm(input.escalation_tier, input.clock_status),
  };
  const score =
    weights.deadline * terms.deadline +
    weights.customer_impact * terms.customer_impact +
    weights.revenue_impact * terms.revenue_impact +
    weights.dependency_impact * terms.dependency_impact +
    weights.escalation_risk * terms.escalation_risk;
  return { id: input.id, score, terms, due_at: input.due_at };
}

/** Sort by score desc, ties broken by earlier due_at (rule 2's own tie-break). */
export function rankActions(inputs: RankInput[], weights: RankWeights, now: string = new Date().toISOString()): RankedAction[] {
  return inputs
    .map((i) => scoreAction(i, weights, now))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (!a.due_at) return 1;
      if (!b.due_at) return -1;
      return Date.parse(a.due_at) - Date.parse(b.due_at);
    });
}

const TERM_FACTS: Record<keyof RankTerms, (i: RankInput, now: string) => string | null> = {
  deadline: (i, now) => {
    if (!i.due_at) return null;
    const hours = Math.round((Date.parse(i.due_at) - Date.parse(now)) / (60 * 60 * 1000));
    if (hours < 0) return `Overdue by ${Math.abs(hours)} h`;
    return `Due in ${hours} h`;
  },
  customer_impact: (i) => (i.customer_count > 0 ? `${i.customer_count} customer(s) affected` : null),
  revenue_impact: (i) => (i.revenue_inr > 0 ? `₹${(i.revenue_inr / 100000).toFixed(1)} L at stake` : null),
  dependency_impact: (i) => (i.dependency_count > 0 ? `blocks ${i.dependency_count} other action(s)` : null),
  escalation_risk: (i) => {
    if (i.clock_status === "OVERDUE") return "SLA breached";
    if (i.clock_status === "AT_RISK") return "at risk of breach";
    if (i.escalation_tier && i.escalation_tier !== "L0") return `escalated to ${i.escalation_tier}`;
    return null;
  },
};

/** Rule 3: top two contributing terms as fact sentences, never adjectives. */
export function whyNow(input: RankInput, ranked: RankedAction, now: string = new Date().toISOString()): string {
  const ordered = (Object.keys(ranked.terms) as (keyof RankTerms)[])
    .map((k) => ({ key: k, contribution: ranked.terms[k] }))
    .sort((a, b) => b.contribution - a.contribution);
  const facts: string[] = [];
  for (const { key, contribution } of ordered) {
    if (facts.length >= 2) break;
    if (contribution <= 0) continue;
    const fact = TERM_FACTS[key](input, now);
    if (fact) facts.push(fact);
  }
  return facts.length > 0 ? facts.join(" · ") : "Open and unassigned"; // no positive term fired — still a real fact, not a guess
}

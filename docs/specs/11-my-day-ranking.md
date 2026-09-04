# 11 — My Day & ranking

## Purpose
p9 §7.1: "Every employee should log in and see: what is due today, what is at risk, what is waiting on them, what needs approval, what customers are waiting for — ranked by deadline, customer impact, revenue impact, dependency impact and escalation risk", with a plain-language "Why now?". p33 §29 "An employee opens My Day and knows what matters."

## Data
No new tables; a ranking function over `action` (10) + `sla_clock` (06) + `impact`. `ranking_weights` config row: `{deadline: 0.35, customer_impact: 0.2, revenue_impact: 0.2, dependency_impact: 0.15, escalation_risk: 0.1}` (Policy Studio "score weights"). `my_day_snapshot` (optional cache per user per day, invalidated by `action.*` events).

## Rules
1. `GET /me/day` returns five ordered sections — **Due today**, **At risk**, **Waiting on me** (NEW/IN_PROGRESS assigned or in my role queue), **Needs my approval** (READY_FOR_APPROVAL where I hold `approver_role`), **Customers waiting** (WAITING_CUSTOMER actions I own, oldest first) — plus "Done today" count.
2. Score per action (pure function, tested with a table): deadline term from hours to due (overdue → 1.0, ≤24 h → 0.9, ≤72 h → 0.6, else decays); customer impact = `impact.customer_count` normalised + `customer_visible` bonus; revenue impact = `impact.revenue_inr` log-scaled against the project's median demand; dependency impact = count of actions with `depends_on_action_id = this`; escalation risk = tier (L0..L4) + SLA state (AT_RISK 0.5, OVERDUE 1.0). Weights from config. Ties → earlier `due_at`.
3. **Why now?** is generated from the top two contributing terms as sentences with facts, never adjectives: "Due in 6 h · blocks 3 registration actions" / "Customer waiting 4 days · ₹12.4 L demand". Templates live in `labels.ts`-style map; unit-tested for each term.
4. Project scope: only actions in `actor.project_ids`; a project switcher narrows further (p20 §13).
5. Functional heads (`MANAGEMENT`, department leads flagged in `project_team_assignment.is_primary_owner` for CENTRAL teams) get a **Team view**: the same sections aggregated per team member with counts and the top three per person (p9 §7.1 "functional head sees where the process fails").
6. Empty state is explicit: "Nothing due — 4 items later this week" with a link.
7. Every My Day load is cheap: one SQL over open actions with joins; no N+1 (test with 500 seeded actions < 200 ms locally).

## API
`GET /me/day?project_id` · `GET /teams/:id/day` (heads) · `GET/PUT /ranking-weights` (Studio).

## Screens
**My Day** (workspace home after login): header with date (IST) and project; five sections as collapsible lists; each row = title, entity chip (Booking BKG-000123 · Unit A-1204), owner avatar if not me, due/SLA badge (icon + label), "Why now?" line, primary action button (Start / Approve / Upload evidence) opening the Action drawer. Team view toggle for heads. Skeleton loading; error state. 375 px: single column, sections as tabs.

## Events
None new (reads only). Emits `my_day.viewed`? — no; don't log reads.

## Config
`ranking_weights` — Policy Studio "score weights/thresholds".

## Acceptance
p9 §7.1 five questions answered by five sections (Playwright checks each section renders from seeded data) · p31 §26 "Every readiness score is explainable" analogue: every row has a "Why now?" (test: no empty strings) · rule tests 2, 3, 5, 7 · p47 §34.7 t9 corollary: internal-only actions never appear in the portal (covered in 26).

## Depends on / Feeds
Depends on 10, 06, 01. Feeds 27 (team bottlenecks), 26 (customer "actions required").

## Files
`services/api/src/myday/**` (`rank.ts` pure), `apps/workspace/src/pages/MyDay*.tsx`, `apps/workspace/src/lib/whyNow.ts`, Studio tab `studio/RankingWeights.tsx`.

## Not in this feature
Notifications/digest (12), Control Tower (27).

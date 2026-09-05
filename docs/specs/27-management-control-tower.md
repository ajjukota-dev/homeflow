# 27 — Management: Control Tower, cash-flow views, KPIs, exceptions, profitability

## Purpose
p21 §14: "five problems that need intervention, not fifty charts"; views Portfolio / Cash / Project Cash Flow / Project Performance / Experience / Execution / Profitability with drill-down to Unit/Booking; five system-generated ranked interventions with owner, ₹/customer impact and decision. p21–22 §15 profitability objects (commercial leakage, service leakage, quality cost, delay cost, cost-to-serve, unit contribution, customisation economics). p24–25 §19 KPI framework by domain. Management > Exceptions (p34 §30.2): stale gates, high-value exceptions, holds affecting schedule, post-gate changes, change margin impact. Existing `tower-view.ts` + Control Tower page (five interventions, idempotent Act — PR #8) is the base.

## Data
| Table | Columns |
|---|---|
| `intervention` | `id`, `project_id?` (null = portfolio), `category ∈ {CUSTOMER, CASH, HANDOVER, REPUTATION, MARGIN}`, `headline`, `rank`, `impact jsonb` {inr, customers, days}, `owner_user_id`, `decision_pack jsonb` (12 shape), `source_refs jsonb[]`, `status ∈ {OPEN, ACTED, DISMISSED}`, `acted_at`, `acted_by` (real actor now — replaces PR #8 null), `action_id`, `computed_at` |
| `kpi_definition` | `code`, `domain ∈ {SALES_HANDOVER, JOURNEY, COLLECTIONS, LEGAL_REGISTRATION, QUALITY_HANDOVER, CUSTOMISATION, POST_HANDOVER, EXPERIENCE, PROFITABILITY}`, `name`, `formula_ref` (function name), `unit`, `direction ∈ {HIGHER_BETTER, LOWER_BETTER}`, `target`, `materiality_ref` — seed from p24–25 §19 list |
| `kpi_snapshot` | `kpi_code`, `project_id?`, `period`, `value`, `numerator`, `denominator`, `computed_at` |
| `economic_event` | `id`, `project_id`, `booking_id?`, `unit_id?`, `kind ∈ {COMMERCIAL_LEAKAGE, SERVICE_LEAKAGE, QUALITY_COST, DELAY_COST, COST_TO_SERVE, VARIATION_CONTRIBUTION, ABORTIVE_COST}`, `amount_inr`, `source_type`, `source_id`, `reason`, `occurred_at` — derived from 19 waivers, 18 economics, 15 snag costs, 13 breaches with ₹ impact, 06 delay (delay cost rule) |

## Rules
1. Interventions are computed (nightly + on material events) from: material escalations (12, above thresholds), true-risk cash concentration (19/20), handover cases predicted late with customers waiting (16/06), broken-promise clusters (13), margin erosion (18 economics, waivers), repeat quality (15). Ranked by ₹ impact × customer count × days; exactly five shown; each has owner, decision pack, and one-click "Act" that creates/links an action (10) and records `acted_by` (p21 §14).
2. Dismiss requires a reason; dismissed interventions can't reappear for 14 d for the same source refs (config).
3. Every view drills: portfolio → project → unit/booking → back to Project 360 (28) (p37 §31.5 t10).
4. KPIs (p24–25 §19; each ≥1 test): Sales-handover FTR %, handover cycle days; Journey on-time %, stage slippage, SLA breach %; Collections efficiency %, overdue ₹, true-risk ₹, forecast accuracy %, PTP honour %; Legal/registration cycle days, deviation rate, registration slippage; Quality: snag closure %, repeat defects %, critical snag age; Handover on-time %, override count; Customisation: cycle time, approval time, contribution ₹, release-before-payment exceptions; Post-handover: warranty TAT, DLP closure %; Experience: check-in scores, escalations per 100 customers, commitment fulfilment %; Profitability: leakage ₹, variation contribution ₹, delay cost ₹. Snapshots monthly; trend vs prior period.
5. Exceptions view (p34 §30.2): gates with `VERIFICATION_REQUIRED` (08), gate exceptions granted (08), active holds affecting schedule (24), change requests approved post-freeze or released via payment waiver (18), CRs with negative contribution (18), handover overrides (16), forecast manual overrides (20) — each row links to the source and its owner.
6. Profitability (p21–22 §15): per project and unit — contribution = variation revenue − vendor cost − tax; leakage = waivers + service credits; quality cost = snag costs + rework; delay cost = configured ₹/day × slippage days for late handovers (config) — all from `economic_event`, explainable per row.
7. Materiality thresholds (12) filter what reaches management; department heads see the full list in their queues.
8. Team bottlenecks (p9 §7.1 functional head): actions by department with SLA state, median age, top blockers — table, not charts.

## API
`GET /tower?project_id` (five interventions) · `POST /interventions/:id/act|dismiss` · `GET /kpis?project_id&period&domain` · `GET /kpis/:code/drill?project_id&period` · `GET /exceptions?project_id&kind` · `GET /profitability?project_id` · `GET /portfolio` (projects table: readiness, cash, risk, experience) · `GET /teams/bottlenecks?project_id`.

## Screens
- **Control Tower** (existing, extended): five cards with headline fact, ₹/customers/days, owner, decision pack, Act/Dismiss; below: portfolio strip (projects with 4 numbers) — no chart wall.
- **Views** as tabs: Portfolio · Cash (20 compare) · Project Cash Flow (20 planner) · Project Performance (06 slippage, 16 pipeline) · Experience (check-ins, commitments, escalations) · Execution (07/08 heatmaps, QA exceptions) · Profitability (economic events by kind, per unit table) · Exceptions (rule 5) · KPIs (domain tabs, value/target/trend, drill).
- All numbers link to the underlying list.
- **Roadmap** (Management menu; ships in R1, before anything else here): the honest list of not-yet-merged specs with title, PDF refs and wave — generated from a small `roadmap.json` maintained with `TODO.md §0`. Replaces greyed-out nav entries (conventions "No dead ends"). Removed when everything is merged.

## Events
`intervention.computed/acted/dismissed`, `kpi.snapshot_taken`, `economic_event.recorded`.

## Config
intervention ranking weights, dismiss cooldown, KPI targets, delay cost ₹/day, materiality (12).

## Acceptance
p31 §26 "Management can identify the top five portfolio interventions without navigating multiple reports" · p37 §31.5 t10 · p24–25 §19 each KPI has a formula test on seeded data · p34 §30.2 exceptions view rows each have a source test · rule tests 1–8 · Act records the real actor (regression for PR #8 null).

## Depends on / Feeds
Depends on 06, 08, 12, 13, 15, 16, 18, 19, 20, 24, 26, 14. Feeds 31.

## Files
`services/api/src/management/**` (replace `tower-view.ts`, `tower*`), `services/api/src/kpis/**` (pure formulas), `services/api/migrations/0025_management.sql`, `services/api/src/seed/kpis.ts`, `apps/workspace/src/pages/management/**` (extend `ControlTower.tsx`).

## Not in this feature
Predictive risk models (31), report exports beyond CSV of any table (generic).

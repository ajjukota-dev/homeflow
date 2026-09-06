# 20 — Cash-flow forecasting, snapshots, waterfall & scenarios

## Purpose
p10 §8.4 and p36–37 §31: `CollectionForecastLine` per expected receipt with source types; immutable `ForecastSnapshot`s (month-start, weekly) + revisions; **Actual vs Forecast-at-Month-Start vs Latest vs Actual-to-Date**; waterfall (opening, due, expected, recovery, loan inflow, shortfall, closing, confidence); probability rule-based and explainable; Base/Conservative/Stretch scenarios that never overwrite the baseline; committed vs scenario lanes never mixed; no double counting. Screens p36–37 §31.3: Project Cash Flow Planner, Project Collections Forecast, Portfolio Project Comparison, Project 360 header.

## Data
| Table | Columns |
|---|---|
| `forecast_line` | `id`, `project_id`, `booking_id`, `demand_id?`, `loan_case_id?`, `source_type ∈ {CONTRACTUAL_DUE, OVERDUE_RECOVERY, PROMISE_TO_PAY, LOAN_DISBURSEMENT, REGISTRATION_FINAL_DEMAND, APPROVED_RESCHEDULE, MANUAL_FINANCE_OVERRIDE, SCENARIO_FUTURE_SALES}` (p36 §31.2), `lane ∈ {COMMITTED, SCENARIO}`, `expected_date`, `amount_inr`, `probability` (0–1), `probability_drivers jsonb` [3], `period` (YYYY-MM), `status ∈ {ACTIVE, REALISED, LAPSED, SUPERSEDED}`, `realised_receipt_id`, `created_from_event_id`, `override_by/at/reason` |
| `forecast_snapshot` | `id`, `project_id`, `scenario_id`, `kind ∈ {MONTH_START, WEEKLY, MANUAL}`, `taken_at`, `period_from`, `period_to`, `lines jsonb` (frozen copy), `totals jsonb` (per period: expected, weighted, by source type), `taken_by` (null = system) — immutable |
| `forecast_scenario` | `id`, `project_id`, `code ∈ {BASE, CONSERVATIVE, STRETCH}` + custom, `assumptions jsonb` (see `forecast_assumption`), `is_baseline bool` (BASE), `created_by/at` |
| `forecast_assumption` | `scenario_id`, `key ∈ {COLLECTION_EFFICIENCY_PCT, LOAN_DISBURSEMENT_LAG_DAYS, FUTURE_SALES_PER_MONTH, FUTURE_SALE_TICKET_INR, CONSTRUCTION_SLIP_DAYS, PTP_HONOUR_PCT}`, `value`, `note` |
| `probability_rule` | `source_type`, `condition` (age band, reason category, loan stage, customer health band), `probability`, `effective_from/to`, `version` — seed **[ours, marked DEFAULT_UNCONFIRMED]**: CONTRACTUAL_DUE 0.85 (0.95 if never late), OVERDUE_RECOVERY by age 0.6/0.4/0.25/0.1, PROMISE_TO_PAY 0.7 (× historical honour rate), LOAN_DISBURSEMENT by stage 0.9 sanctioned / 0.5 applied, APPROVED_RESCHEDULE 0.8, MANUAL override as set |
| `period_calendar` | `project_id`, `fiscal_year_start_month`, `week_start_day` |
| `cash_target` | `project_id`, `period`, `target_inr`, `set_by` |

## Rules
1. Lines are derived, never typed (except `MANUAL_FINANCE_OVERRIDE`, which requires role Accounts lead + reason and supersedes the derived line for that demand): from 19 demands (CONTRACTUAL_DUE with expected date = due/forecast trigger date from 06; OVERDUE_RECOVERY for overdue with reason; PROMISE_TO_PAY when a PTP date exists — supersedes the OVERDUE line for that demand), from 21 loans (LOAN_DISBURSEMENT expected on `expected_disbursement_date`, replacing the customer-contribution share of the linked demand), from 23 (REGISTRATION_FINAL_DEMAND when a slot is booked), from 06 plan revisions (APPROVED_RESCHEDULE). **One active COMMITTED line per rupee** — a demand's amount is split across lines but never counted twice (test: Σ active lines per demand ≤ remaining) — p37 §31.5 t5 "no double counting".
2. Probability from `probability_rule` with three drivers ("Overdue 22 d · reason: loan delay · customer paid late twice") — explainable, rule-based (p10; p8 §6).
3. Snapshots: system takes `MONTH_START` at 00:05 IST on day 1 and `WEEKLY` every Monday per scenario; manual snapshots allowed; snapshots are immutable; comparisons read snapshots, never recompute history (p37 §31.5 t6 "prior forecast is not overwritten", t7 "variance forecast-to-actual").
4. Waterfall per period: opening outstanding → + demands raised → expected (weighted) → + overdue recovery → + loan inflow → − shortfall (expected − target) → closing outstanding, with confidence = weighted probability dispersion (p10 §8.4).
5. Scenarios: BASE is the baseline (committed lane only). CONSERVATIVE/STRETCH apply assumptions to a copy (efficiency %, lags, future sales as SCENARIO lines) — they never modify BASE lines; the UI never sums COMMITTED and SCENARIO lanes without a lane label (p37 §31.5 t4 "scenario never overwrites baseline", t8 "committed and scenario lanes are never mixed").
6. Comparison view: Actual (verified receipts in period) vs Forecast-at-Month-Start (snapshot) vs Latest (live) vs Actual-to-Date, per project and portfolio; 30/60/90-day forward (p31 §26 management bullet).
7. Realisation: a verified receipt (19) marks matching lines REALISED (FIFO by expected date); lapsed lines (date passed, unpaid) → LAPSED and a new OVERDUE_RECOVERY line is derived.
8. Every dashboard drills to Unit/Booking and back to Project 360 (p37 §31.5 t10).

## API
`GET /projects/:id/forecast?scenario&from&to&lane` (lines + per-period totals + waterfall) · `POST /projects/:id/forecast/snapshots` (manual) · `GET /projects/:id/forecast/snapshots` · `GET /projects/:id/forecast/compare?period` · `GET/POST /projects/:id/scenarios`, `PUT /scenarios/:id/assumptions` · `POST /forecast-lines/:id/override {expected_date, amount_inr, probability, reason}` · `GET /portfolio/forecast/compare` · `GET/PUT /probability-rules`, `/cash-targets`, `/period-calendar` (Studio).

## Screens (p36–37 §31.3)
- **Project Cash Flow Planner**: month columns × waterfall rows; scenario tabs (BASE locked, others editable assumptions panel); lane toggle with explicit labels; target line; confidence band.
- **Project Collections Forecast**: lines table (source type chip, booking, expected date, amount, probability with drivers tooltip, status), filters, override dialog (authorised), snapshot list + compare picker.
- **Portfolio Project Comparison**: projects × periods (actual, month-start forecast, latest, variance), sortable, drill to project.
- **Project 360 header** (28): next-month forecast, actual-to-date, variance chip.
- Studio: Probability rules, Cash targets, Period calendar, Forecast policy (snapshot cadence).

## Events
`forecast.line_derived/superseded/realised/lapsed`, `forecast.snapshot_taken`, `forecast.override_recorded`, `scenario.created/updated`.

## Config
probability rules, snapshot cadence, cash targets, period calendar, scenario assumption keys — Policy Studio "forecast policy, period calendar, cash-flow targets".

## Acceptance
p37 §31.5 t3–t8, t10 · p31 §26 "Management can view last-period actual, current actual-to-date, next-month forecast and 30/60/90-day forecast by Project and portfolio" and "retains forecast snapshots and calculates forecast-to-actual variance without overwriting prior forecasts" · rule tests 1–8 · double-counting property test over 200 seeded demands/loans.

## Depends on / Feeds
Depends on 19, 21, 23, 06, 04. Feeds 27, 28, 31 (collection risk).

## Files
`services/api/src/forecast/**` (`derive.ts`, `probability.ts`, `waterfall.ts` pure), `services/api/migrations/0018_forecast.sql`, `services/api/src/seed/probability-rules.ts`, `apps/workspace/src/pages/finance/CashFlowPlanner*.tsx`, `CollectionsForecast*.tsx`, `PortfolioCompare*.tsx`, Studio tabs.

## Not in this feature
Receipts/demands (19), loans (21), KPI framework (27).

## Build note (2026-09-06, backend)
Advisor-scoped before any code was written (not just before merge): the initial plan for
REGISTRATION_FINAL_DEMAND ("last unpaid demand by sequence") was wrong — it would mislabel a
POSSESSION-triggered demand as registration money, and the Σ-lines-≤-remaining test wouldn't catch
a wrong *label*, only a wrong amount. Fixed by grepping `registration/core.ts`: `stamp_duty_inr`/
`registration_fee_inr` are only populated by the same call that sets `executed_on` — so by the time
either value exists, registration has already happened. Modeled as an immediately-`REALISED`
historical fact-line (probability 1), not a forward forecast.

APPROVED_RESCHEDULE is deliberately NOT implemented, flagged not faked: `timeline_plan_revision.
changes` (06) is stage-level `{stage_code, old/new_planned_start}` with no amount and no demand_id
link — there is no schema path from a plan revision to a specific rupee, and 06 never writes that
table today anyway. `probability.ts` still carries its probability (0.8) for when this becomes
buildable.

No `permission_matrix` module exists for this domain (same gap class as R0.6's pre-matrix routes)
— `FORECAST_READ_ROLES`/`FORECAST_WRITE_ROLES` added directly to `authz/requireRole.ts`; "Accounts
lead" (rule 1) modeled as the plain `ACCOUNTS` role, same simplification used elsewhere for named
seniority with no dedicated role value.

One winning source type per demand, computed pure (`resolveDemandLine`) by explicit precedence
(loan-dependent > active PTP > overdue > plain contractual > nothing until a due date exists), then
diffed in `deriveProjectLines` against whatever's currently ACTIVE for that demand: no-op if
unchanged, REALISED if `remaining` has reached 0, LAPSED if the old line's own `expected_date` had
already passed, else SUPERSEDED. A demand with an ACTIVE `MANUAL_FINANCE_OVERRIDE` line is excluded
from re-derivation entirely — the override IS the active line until it's itself superseded.

Scenario lane is computed at read time, never persisted (rule 5) — `applyScenarioAssumptions`
transforms a copy of COMMITTED lines, `futureSalesLines` generates SCENARIO_FUTURE_SALES lines;
BASE is proven byte-identical before/after a CONSERVATIVE scenario is created and given
assumptions. `forecast_line.scenario_id`'s CHECK constraint permits SCENARIO-lane rows, but nothing
ever inserts one — scenario lines are synthetic (`id: scenario_${i}`), never written to the table.
The column and constraint describe a capability that isn't used; left as-is (it's genuinely how
rule 5 wants BASE protected — SCENARIO rows never touching the real table at all — not a mistake to
fix), documented here so a reader doesn't go looking for the missing INSERT.

Waterfall's `target_inr`/`shortfall` are `null`, not `0`, when no `cash_target` row covers a period
(advisor-mandated) — the one place in this codebase where "fail closed" does NOT apply, since
blocking the whole forecast would be worse than an honest "no target set." `takeSnapshot`'s `totals`
carries `expected` (raw, unweighted sum raised) and `weighted` (probability-weighted, what the
waterfall actually carries forward) as two genuinely distinct numbers, matching the Data row's own
two-name list — `compareForecast` reads `.weighted` against `latest` (also weighted), not the
now-distinct `.expected`.

**Advisor-caught performance issue, fixed pre-merge:** `deriveProjectLines` scans every open demand
in a project; it was being called inside `buildForecastView`, which `compareForecast` also calls,
which `portfolioCompare` calls once per project — an N-project portfolio compare would have re-run
a full per-demand derive pass N times for no reason. Fixed by hoisting the derive call up into the
two real entrypoints that need it (`getForecast`, and `takeSnapshot` since it's cron-driven and not
always preceded by a `getForecast` call) — `buildForecastView`/`compareForecast`/`portfolioCompare`
now only read whatever forecast_line rows currently exist.

`forecast_line`/`forecast_scenario`/`forecast_snapshot`/`cash_target`/`period_calendar` all carry a
direct `project_id` (or, for `period_calendar`, project_id itself as PK) and land after
`0025_rls.sql` — same flagged-not-fixed RLS gap as `loan_case` (21)/`commitment` (13)/`escalation`
(12); sweep all of these in together whenever P1b resumes. `probability_rule` is global config (no
project_id), same bucket as `action_type`/`delay_reason`.

Registered `probability_rule`/`cash_target`/`period_calendar` in Studio's generic table envelope
(none carry their own versioning columns). The Studio tab registry adds exactly 3 rows for spec 20
— `25-policy-studio.md`'s own `## Tabs` line (the actual source `studio/registry.test.ts` checks) —
not the 4th ("Forecast policy — snapshot cadence") spec 20's own Screens section separately names;
no config table backs a cadence policy anyway (`takeSnapshot`'s `kind` is caller-supplied, no
scheduler exists). Caught before writing any test, by reading the test's parsing logic first.

Full-suite flakiness check (advisor-required before this note could claim anything about it):
`registration.test.ts` times out 4-5 tests intermittently under a full `vitest run` — confirmed via
`git stash -u` that this reproduces identically on pure pre-spec-20 `main` with zero forecast files
present, so it is genuinely pre-existing worker-pool contention, not something this spec's test file
exacerbated. Not fixed (out of this spec's scope); logged in TODO.md.

`forecast/forecast.test.ts`: 32 tests (pure probability/derive/waterfall/scenario-transform units,
a 200-generated-facts double-counting property test at the pure-function boundary, and a real-DB
integration block covering the full derive→supersede→realise/lapse lifecycle, manual override,
scenario isolation, snapshot immutability, and event coverage). tsc clean, 92/93 API test files,
617/622 tests (the 5 failures are the pre-existing registration.test.ts flake above, reproduced
without this spec's code).

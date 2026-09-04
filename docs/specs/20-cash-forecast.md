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

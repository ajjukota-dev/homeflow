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

## Build note (2026-09-06)

**Scope: backend only** (routes + domain logic + tests), per this run's standing autonomous
mandate. `apps/workspace`'s `ControlTower.tsx` extension, the Views tabs, and the Roadmap screen
are not built — flagged, not faked.

**Reuse map.** `intervention` table pre-existed (PR #8's Control Tower base) — ALTERed, not
replaced (migration `0042_management.sql`; the spec's own `0025_management.sql` filename was
already taken by an earlier-landed spec, sequential numbering kept instead). `tower.ts`/
`tower-view.ts` replaced by `management/scoring.ts` (pure ranking) + `management/interventions.ts`
(DB-backed Control Tower + Act/Dismiss) — small blast radius, confirmed via grep before deleting.
`escalations/core.ts`'s `category` enum reused verbatim for `intervention.category` (exact 5-value
match). `materiality_threshold.scope='CONTROL_TOWER'` had zero producers/consumers before this
build — now rule 7's filter. `change_request.abortive_cost_inr` (set by `cancelChangeRequest`,
previously unused) is a genuine ABORTIVE_COST economic_event source.

**Two real bugs advisor caught pre-merge, fixed before landing:**
1. **Dismiss cooldown didn't actually cool down anything.** `intervention` rows are keyed by
   `(project, category)`, and the upsert carried the previous row's `status` forward unconditionally
   while overwriting `source_refs` with the new winner's refs. Net effect: dismissing "cash" once
   made that category slot permanently `dismissed` regardless of which underlying candidate later
   won it, while the cooldown's own lookup key (`source_refs`) for the *actually dismissed* item
   was destroyed on the very next recompute. Fixed: the upsert now only carries `status`/`acted_*`/
   `dismiss_*` forward when the recomputed candidate's `source_refs` exactly match the stored row's
   — otherwise it's a genuinely different issue occupying the same slot and starts `open`. Covered
   by a new regression test (`interventions.test.ts`) that seeds a stale dismissed row with fake
   source_refs and asserts a real recompute doesn't inherit it.
2. **`intervention.computed`, `kpi.snapshot_taken`, `economic_event.recorded` all appended on every
   GET, unconditionally**, into an append-only log — the same class advisor caught on spec 16's
   `handover_gate_run` pre-merge. Fixed all three to diff before/after (headline/rank/status for
   interventions; snapshot value for KPIs; an `IS DISTINCT FROM` guard on the economic_event upsert
   itself) and only append when something actually moved. Each has a test proving the steady-state
   case emits nothing and a forced change emits exactly one event.

**Two KPI formula bugs found and fixed while writing the `it.each` coverage test (which only
proves each of the ~29 formulas returns a well-formed `{value, numerator, denominator}` shape on
seeded data — NOT that the number is correct; only `c_true_risk_inr` is value-checked against
collections-view's own bucket total, so these two were caught by inspection, not by that test):**
- `c_efficiency_pct` filtered demands by `status IN ('due','overdue','partial')` — the real status
  string is `part_paid` (collections.ts's `DemandStatus`), not `partial`, so every partially-paid
  demand's outstanding balance was silently excluded from "billed", while `SUM(receipt.amount)`
  was added unconditionally regardless of status. Fixed to `collected ÷ SUM(demand.amount WHERE
  status <> 'scheduled')` — `demand.amount` is the fixed original milestone amount (never adjusted
  down as receipts land), so summing it once per raised demand is the correct "billed so far".
- `h_on_time_pct` LEFT JOINed `handover_appointment`, so a completion with no appointment row (the
  legacy `qa.ts::completeHandover`/seed-lifecycle path, which never creates one) counted in `total`
  but could never count in `on_time` — every legacy-path completion read as late. Fixed to INNER
  JOIN: legacy completions with nothing to compare against are excluded from both, not miscounted.

**`ph_warranty_tat_days` remains `NULL_RESULT`** (flagged, not faked) — no "raised-at" signal
exists anywhere for a warranty case to measure TAT from.

**Flagged gaps, not built:** `management_config` (ranking weights, dismiss cooldown, delay ₹/day)
has no edit path — no route, no Studio tab (25-policy-studio.md's own `## Tabs` line jumps 26→29,
explicitly skipping this spec) — rows are seeded UNCONFIRMED and can only be changed by direct
SQL today. `getPortfolio` runs `computeBookingReadiness` per active booking per project on every
call — same N×-per-page-load shape advisor already accepted at seed scale on spec 20; noted here,
not optimised.

**Verification.** `npx tsc --noEmit` clean. Full suite: 95/96 files, 694/698 tests green — the 4
failures are `registration/registration.test.ts`'s pre-existing worker-pool timeout flake under
full parallel `vitest run` (confirmed unrelated to this spec across two prior segments: excluding
this file's own neighbours and `git stash`-ing unrelated edits didn't change the outcome;
`registration/core.ts` was not touched by this build at all).

## Build note (2026-09-07, UI)

**Scope: the UI this spec's own Build note (above) flagged as not built.** `ControlTower.tsx`
extended with 7 Views tabs (Portfolio, Cash, Project Cash Flow, Profitability, Exceptions, KPIs,
Teams) plus a Dismiss dialog; `apps/workspace/src/pages/management/**` (NEW) holds the 5 new view
components + a typed `api.ts` client mirroring `finance/api.ts`'s pattern.

**Deliberate scope cut, corrected framing.** Project Performance / Experience / Execution tabs are
not built as dedicated views — but unlike this spec's backend note implied, the underlying numbers
already exist and are reachable: Experience domain KPIs (`ex_checkin_score`,
`ex_escalations_per_100`, `ex_commitment_fulfilment_pct`) surface in the KPIs tab; `STALE_GATE`/
`GATE_EXCEPTION` surface in Exceptions; `j_stage_slippage_days`/`h_on_time_pct` surface in KPIs.
What's actually missing is a dedicated per-view *composition* of that data, not the data itself.
The Control Tower's own top-level "portfolio strip below the five cards" (this file's own Screens
line) was also not built as a strip under Interventions — the Portfolio tab covers the same data
as its own tab instead; noted as a literal spec-text deviation, not hidden.

**Regression bug found and fixed: `decision_pack.impact` field-name drift.** The pre-27 frontend
`Intervention` type still declared `impact: { customer: string, rupee: number }`; this spec's real
backend (`management/scoring.ts`) returns `{ inr, customers, days }`. Every card with real ₹ risk
silently rendered "No rupee at risk" since this spec's backend merged — `item.decision_pack.impact
.rupee` was always reading `undefined`. Found by reading the backend source of truth against the
frontend type before writing any new code that would have inherited the bug, not by a failing test.
Fixed the type and both read sites; pinned with a new e2e assertion
(`management-views.spec.ts`'s first test) that a real `₹` figure renders, not the empty-state text.

**Two smaller real bugs, advisor-caught pre-merge (both same family as spec 20's `BK-` fix):**
1. `ProfitabilityView`'s per-unit table rendered the raw `unit_id` (`u_v110`) instead of a
   `unit_number` — `management/profitability.ts`'s `per_unit` query never joined `unit`. Fixed with
   a join; the e2e Profitability test now asserts the real unit_number renders and the raw id does
   not (previously the test only checked two `<h2>`s existed, which passed even fully broken — see
   below).
2. `management/exceptions.ts` showed a raw user id as "Owner" for `GATE_EXCEPTION` and
   `ACTIVE_HOLD` rows (`granted_by`/`requested_by` are real `"user".id` values, not role strings —
   the other 5 exception kinds hardcode a role name, which is why this was easy to miss live).
   Fixed with a `LEFT JOIN "user"` for `display_name`, matching `sales-handover/core.ts`'s
   established pattern for the same problem.

**A test that couldn't have caught anything: the original Profitability e2e test only asserted two
`<h2>` headings existed — both of which render in the empty-data branch too, so the test passed
against a completely broken populated table.** No seed data anywhere produces an `economic_event`
row (no waiver/CR-acceptance UI exists yet, and QaHandover.tsx's raise-snag form has no cost
field), so the populated code path had never been exercised. Fixed by having the test create its
own fixture via a direct API call (`POST /api/snags` with a real `estimated_cost_inr`, same
API-fixture pattern `commitments.spec.ts` already established) and asserting the real row + the
`unit_number` fix render, not just that two headings exist.

**`management/exceptions.ts` rupee formatting**: two headline strings (`CR_NEGATIVE_CONTRIBUTION`,
`FORECAST_MANUAL_OVERRIDE`) used bare `.toFixed(0)` with no thousands grouping, inconsistent with
this codebase's established `.toLocaleString("en-IN")` convention (verified via grep across
`intelligence/*.ts`, `management/interventions.ts`, `portal/subscribers.ts`, `sales/booking.ts`,
`forecast/derive.ts`). Fixed; pinned by an e2e regex assertion for Indian-style grouping.

**Responsive bug, found live via the mandatory 3-breakpoint screenshot review:** at 768px, the top-
level tabs and the KPIs domain tabs wrapped their own text instead of the row scrolling
horizontally ("Project Cash Flow" broke onto 3 lines; later tabs were pushed off-screen). Root
cause: `overflow-x-auto` was only on the wrapper div — the `TabsTrigger` flex children had no
`shrink-0`, so they shrank instead of the row overflowing. Fixed with `shrink-0 whitespace-nowrap`
on every trigger in both `ControlTower.tsx` and `KpisView.tsx`, plus `flex-nowrap` on `TabsList`.
Verified via DOM `scrollWidth`/`clientWidth` measurement and re-screenshotted clean at 768/375.

**Significant, cross-spec finding: the session-long "pre-existing H11 flake" in `visual.spec.ts`
was never app flakiness — it was a wrong-element click, and the mischaracterisation is recorded in
at least three other specs' own build notes (17, 20, 26) plus this file's own earlier working
notes.** `page.getByRole("button", { name: "Act" })` does *substring* matching by default (not
`exact`), and this app's sidebar nav buttons render `<button>` elements whose accessible name
concatenates label + description text — several of which contain "act"/"Act" as a substring
("Queues — Departmental **act**ions, claim & reassign", "Collections Forecast — ...forecast-to-
**act**ual", "Portfolio Comparison — **Act**ual vs forecast..."). Since the sidebar renders before
`<main>` in DOM order, `page.getByRole("button", { name: "Act" }).first()` picked a sidebar nav
button, not a real Act button, on every run — no ancestor `.rounded-card` exists on a nav button,
so the test's very next line (an xpath ancestor lookup) waited the full timeout for something that
could never appear. This looked exactly like a slow-render timeout and was recorded as one.
Discovered while debugging this build's own Teams-tab test (a screenshot showed navigation had
silently landed on "Departmental Queues" instead of clicking a real Act button); confirmed
independently against `visual.spec.ts`'s H11 test by running it in isolation and observing the
identical hang location. Fixed both files by scoping to `page.locator("main")` and adding
`exact: true`. Re-ran H11 standalone before and after: 30.1s timeout → 2.2s pass. **Correction to
the record:** specs 17/20/26's own build notes call this flake "pre-existing" and "unrelated" —
that characterisation was wrong; the Act flow itself had not actually been exercised by that test
for as long as the affected sidebar nav entries have existed. Full suite re-run from a fresh
`db:reset` (130 e2e tests, 129 passed/1 pre-existing skip; 789 backend tests, 786 passed/3 failed
only under full-parallel `vitest run` — confirmed a pre-existing worker-pool timeout artifact,
unrelated to this build, by re-running `registration.test.ts` alone: 6/6 green) confirms no
regression and that H11 now passes reliably alongside the rest of the tower suite.

**One transient flake observed once, not reproduced:** the KPIs-tab e2e test timed out waiting for
"Collection efficiency %" in one of several full-file runs, then passed cleanly on immediate re-run
and on two subsequent full-file runs plus the final fresh-DB full-suite run. `getKpis` computes
live (compute-on-read, no fixture dependency), so this reads as ordinary CI-style timing noise
under load rather than a selector or logic bug — noted rather than chased further, unlike H11 which
reproduced deterministically every time.

**Verification.** `npx tsc --noEmit` clean. Full backend suite (fresh `db:reset`, isolated re-run
of the only 3 files that failed under full-parallel load): 789/789 green. Full Playwright suite
(fresh `db:reset`, all 12 spec files, 3 breakpoints where applicable): 129 passed, 1 pre-existing
conditional skip, 0 failures — including both `visual.spec.ts` tower tests running back-to-back
with `management-views.spec.ts`'s own Act/Dismiss mutations ahead of them in file order, which is
exactly the state-interaction advisor asked to be checked explicitly.

# 18 — Customer change requests & unit customisations

## Purpose
p11–12 §8.7: full status flow (Appendix A p42) **Draft/Requested → Feasibility Review → Costing → Awaiting Approval → Awaiting Customer → Awaiting Payment → Approved → Released → In Progress → Ready for QA → QA Verified → Customer Accepted → As-Built Closed** (+ Rejected / Withdrawn / Cancelled); multiple line items by room/trade; mandatory impact assessment (cost, schedule, technical, handover); approval matrix by type/value/margin/schedule/pre-or-post freeze; customer quotation with validity; payment gate before release unless authorised exception; drawing/spec revision release + superseded lock (09); auto-generated site/procurement/vendor actions; QA evidence before acceptance; as-built updates the twin; cancellation/reversal with abortive cost; profitability view. "Capture is never blocked by a closed gate — it is routed" (p13; p35 §30.5 t7). P0 (p28 §24).

## Data
| Table | Columns |
|---|---|
| `change_request` | `id`, `code CR-`, `booking_id`, `unit_id`, `project_id`, `customer_id`, `raised_by_kind ∈ {CUSTOMER_PORTAL, SALES, CRM, CUSTOMISATION}`, `raised_by_user_id`, `status`, `title`, `summary`, `freeze_state_at_request ∈ {PRE_FREEZE, POST_FREEZE}`, `gate_summary_at_request jsonb` (08 states per category), `exception_id` (08 `unit_gate_exception`), `feasibility jsonb` {result ∈ {FEASIBLE, FEASIBLE_WITH_CONDITIONS, NOT_FEASIBLE}, technical_notes, reviewer, at}, `impact jsonb` {cost_inr, schedule_days, technical_risk ∈ {LOW, MEDIUM, HIGH}, handover_impact ∈ {NONE, DELAYS_HANDOVER, BLOCKS_HANDOVER}, notes} (mandatory before COSTING → AWAITING_APPROVAL), `approval_action_id`, `quotation_id`, `payment_gate ∈ {REQUIRED, WAIVED}`, `payment_waiver_authority`, `released_at`, `released_by`, `spec_revision_id` (09), `qa_inspection_id` (15), `customer_accepted_at`, `as_built_closed_at`, `cancel_reason`, `abortive_cost_inr`, `owner_user_id` (Customisation role) |
| `change_request_item` | `id`, `cr_id`, `room`, `trade`, `category_code` (08), `catalogue_item_id` (09, null = bespoke), `description`, `qty`, `unit_price_inr`, `vendor_cost_inr`, `tax_pct`, `lead_days`, `gate_state_at_request`, `status ∈ {PROPOSED, APPROVED, REJECTED, EXECUTED, REVERSED}` |
| `quotation` | `id`, `cr_id`, `version`, `lines jsonb`, `subtotal_inr`, `tax_inr`, `waiver_inr`, `total_inr`, `valid_until`, `issued_at`, `issued_by`, `status ∈ {DRAFT, ISSUED, ACCEPTED, EXPIRED, SUPERSEDED, DECLINED}`, `document_id` (22 generated quotation), `customer_accepted_at`, `accepted_via ∈ {PORTAL, SIGNED_COPY}` |
| `cr_approval_rule` | `id`, `project_id` (null std), `kind ∈ {VALUE, MARGIN, SCHEDULE, FREEZE, CATEGORY}`, `threshold`, `approver_role`, `requires_second_approver bool`, `effective_from/to` — Policy Studio "variation approval matrix" |
| `customisation_policy` | `project_id`, `freeze_dates jsonb` {category_code → date}, `quotation_validity_days` (default 15), `payment_gate_pct` (default 100 — TODO §8 client question), `cancellation_terms jsonb`, `allowed_catalogue_only bool` |
| `cr_execution_action` | `cr_id`, `action_id`, `kind ∈ {SITE_WORK, PROCUREMENT, VENDOR, DRAWING_UPDATE, QA}` |

## Rules
1. **Capture never blocked**: a request in a category whose gate is `HARD_CLOSED`/`EXCEPTION_ONLY` is accepted with `status = REQUESTED` and routed: HARD_CLOSED → feasibility auto `NOT_FEASIBLE` with reason + customer communication draft for CRM (never auto-sent); EXCEPTION_ONLY → requires a `unit_gate_exception` (08) before COSTING. `gate_summary_at_request` is frozen for audit (p35 §30.5 t7).
2. Feasibility review (Customisation/Site): result + technical notes; `NOT_FEASIBLE` → `REJECTED` with customer-facing reason text (CRM edits before publish).
3. Costing: line items priced from the variation catalogue (09) or bespoke with vendor cost; `impact` mandatory (all four dimensions) before moving on (p12 "mandatory impact assessment").
4. Approval: rules evaluated → required approver roles (value above threshold → MANAGEMENT; margin below floor → MANAGEMENT; schedule impact → PROJECTS head; POST_FREEZE → MANAGEMENT + second approver); an APPROVAL action (10) per approver; approver ≠ requester ≠ coster.
5. Quotation issued to the customer (portal 26 or signed copy) with `valid_until` (policy); acceptance moves to `AWAITING_PAYMENT`; expiry → `EXPIRED` and CR back to `AWAITING_CUSTOMER` with a CRM action; re-issue supersedes.
6. Payment gate: `RELEASED` requires receipts (19) covering `payment_gate_pct` of the quotation total against the CR's demand, or an explicit waiver by `payment_waiver_authority` (config) with reason (p12 "payment gate before release unless authorised exception"; p31 §26 "No change can be released to Site before … approval, payment/exception gates are satisfied").
7. Release: creates the DRAFT→RELEASED `spec_revision` (09), emits `drawing.released`, generates execution actions (site work per item/trade, procurement for catalogue items with lead days, vendor when `vendor_cost_inr > 0`, drawing update if layout) — p12 "auto-generated site/procurement/vendor actions".
8. Execution: `IN_PROGRESS` while any execution action open; `READY_FOR_QA` when all closed; QA inspection (15) with evidence → `QA_VERIFIED`; customer acceptance (portal or CRM on behalf) → `CUSTOMER_ACCEPTED`; as-built record (09) → `AS_BUILT_CLOSED` (p12; p31 §26 "Every completed customisation updates the permanent Unit Digital Twin").
9. Cancellation/withdrawal: customer may withdraw until `RELEASED`; after release, cancellation requires MANAGEMENT with `abortive_cost_inr` recorded and reversal actions; refunds/adjustments raise a demand adjustment in 19 (p12 "cancellation/reversal with abortive cost").
10. Profitability per CR: price − vendor cost − tax − waivers = contribution; aggregated per project (27) — p12 "variation economics preserved".
11. Consumes the gate exception when released (08 rule 5; p44 §33.6 t8).
12. Journey: first CR on a booking activates the conditional Customisation stage (05/06).

## API
`POST /bookings/:id/change-requests` (customer or staff) · `GET /change-requests?status&project_id&owner` · `GET /change-requests/:id` · `POST /change-requests/:id/feasibility|costing|submit-approval|issue-quotation|accept-quotation|waive-payment|release|ready-for-qa|customer-accept|as-built-close|withdraw|cancel` · `PUT /change-requests/:id/items` · `GET /change-requests/:id/economics` · Studio: `GET/PUT /cr-approval-rules`, `/customisation-policy`.

## Screens
- **Customisation desk** (Customisation role): kanban by status; CR detail with gate summary at request, feasibility form, line items editor (catalogue picker with price/lead), impact form, approvals panel, quotation builder + PDF (22), payment gate status (from 19), release button with gate check list, execution actions, QA link, as-built form, economics card.
- Unit 360 → Customisations tab; Booking 360 → Requests.
- Portal (26): raise request (category picker shows only customer-visible categories with state labels), view quotation, accept/decline, track status in customer wording.
- Studio tabs: Variation approval matrix, Customisation policy (freeze dates, validity, payment gate %, cancellation terms).

## Events
`change_request.created/status_changed/feasibility_recorded/quotation_issued/quotation_accepted/payment_waived/released/qa_verified/customer_accepted/as_built_closed/cancelled`, `drawing.released` (via 09).

## Config
`cr_approval_rule`, `customisation_policy`, catalogue (09), change categories (08).

## Acceptance
p31 §26 four customisation bullets · Appendix A change-request statuses exact · p35 §30.5 t7 · p44 §33.6 t8 · rule tests 1–12 · Playwright: portal raise → desk feasibility → costing → approval → quotation → accept → payment (19 receipt) → release → QA → accept → as-built; and a HARD_CLOSED capture routed to rejection.

## Depends on / Feeds
Depends on 08, 09, 10, 15, 19 (receipts/demand for CR), 22 (quotation PDF), 25, 26. Feeds 06 (conditional stage), 08 (exception consumption), 16 (LEGAL gate: customisation agreement), 27 (economics), 30 (as-built in passport).

## Files
`services/api/src/change-requests/**`, `services/api/migrations/0016_change_requests.sql`, `apps/workspace/src/pages/customisation/**`, `apps/my-pranava-home/src/pages/Requests*.tsx`, Studio tabs.

## Not in this feature
Gate engine (08), catalogue master (09), receipts (19), document rendering (22).

## Build note (2026-09-06, backend)

Built once 22 landed — 08, 09, 10, 15, 19, 22, 25 were all already merged; 26 (customer portal) is
the one unbuilt dependency, and rule 5's own text names a fallback that doesn't need it
("quotation issued... portal 26 or signed copy"), so the backend is built with the SIGNED_COPY
acceptance channel only, portal UI deferred like every other spec's Studio/screen UI this run.

Migration `0037_change_requests.sql`: the 6 tables the Data section names, plus two real
additions (flagged below) and one FK that closes a gap 08's own migration comment flagged
("18, not built — no FK") on `unit_gate_exception.change_request_id`.

Files: `services/api/src/change-requests/{store,capture,costing,approvals,quotation,release,
execution,cancellation,economics,policy}.ts`, `routes-change-requests.ts`,
`seed/change-requests.ts`. 4 integration tests (11 assertions across rules 1–12), tsc clean, full
suite 90 files / 568 tests (re-verified with bounded worker concurrency after unrelated
resource-contention flakiness on the first parallel run — see TODO.md §9).

Findings, flagged not faked:
(a) rule 1's routing text ("a request in a category whose gate is HARD_CLOSED/EXCEPTION_ONLY") reads
per-item, but the state machine puts FEASIBILITY_REVIEW before any `change_request_item` exists
(items are added at COSTING) — resolved via the Screens section's own "category picker" detail:
added `change_request.primary_category_code` (not in the spec's own Data list) so capture has
something to route on immediately, matching the portal's described raise flow;
(b) `change_request_approval` (a new table) tracks one APPROVAL action per required role — the
spec's own Data table has a singular `approval_action_id`, but rule 4's text ("an APPROVAL action
per approver", "MANAGEMENT + second approver" for POST_FREEZE) genuinely needs more than one when
several rules match; `cr_approval_rule` is its own dedicated table (not 25's generic
`approval_authority_rule`) per the spec's own Data section, same "own bespoke versioning, stays
outside the generic envelope" call 25's build already made for 05/06's tables;
(c) real gap caught before writing any test: nothing in the Data table's transitions ever writes
`change_request.exception_id`, so rule 1's "EXCEPTION_ONLY requires an exception before COSTING"
could never actually be satisfied — added `costing.ts::linkGateException` as the missing link a
staff member calls after granting one via 08's `grantException`;
(d) the quotation PDF is rendered directly via the `pdf` port, not through 22's
`doc_factory_template`/clause machinery — that system's merge-field context is booking-scoped
only (`documents/source.ts::buildSourceContext`), with no hook for a caller to inject ad hoc
per-call data like one quotation's own line items; widening it is real, separate work;
`quotation.document_id` (the spec's named 22-integration column) stays null;
(e) rule 6's payment-waiver-authority is UNCONFIRMED — the Data table names
`payment_waiver_authority` as a column on `change_request` (who waived it) but
`customisation_policy` has no configured field for who is *allowed* to waive; defaulted to
MANAGEMENT/SUPER_ADMIN, same class of judgment call as 12/13's own seeded placeholders;
(f) rule 9's post-release cancellation raises a refund via 19's `requestWaiver`, which fails
closed (25's own documented gap: zero seeded `approval_authority_rule` rows) — cancellation
itself still succeeds when that happens; the refund is flagged on the CR's own event log as
needing a manual waiver, not silently swallowed or forced through an unconfigured matrix;
(g) rule 8's QA link is manual, not auto-selected: 08's four `change_category` codes
(kitchen_layout/electrical/flooring_selection/structural) and 07's four `component_definition`
codes (structure/mep_first_fix/flooring/finishing) don't correspond 1:1 — same mismatched-
vocabulary class of gap 15 already flagged for its own T11→component mapping;
(h) rule 12 ("first CR on a booking activates the conditional Customisation stage") is 06's own
already-documented gap — `journey/instances.ts`'s header names `change_request.created` by name as
an event conditional-stage re-evaluation would need, and confirms it isn't wired (06 only
evaluates conditional stages at journey creation). This build fires the event; wiring 06's
consumer is separate work;
(i) no PROJECTS_HEAD role exists in the 12-role seeded list for rule 4's "schedule impact →
PROJECTS head" — seeded rule maps it to SITE, same class of call 15/21 already made;
(j) real bug caught before running anything: nesting `submitForApproval`/`approveAction`/
`rejectAction` (each open their own `withTx`) inside `submitCrForApproval`'s/`decideCrApproval`'s
own open transaction would hang forever on this codebase's single-connection PGlite (the 17/22
lesson, hit a second time in new code) — fixed by doing the action's "submitted" transition via
direct SQL inside the existing transaction instead of the ctx-gated wrapper, and composing the
remaining cross-module calls sequentially between transactions;
(k) `acceptQuotation` was initially gated to CUSTOMISATION_DESK_ROLES only — caught by a test:
rule 5 explicitly allows CRM to record a signed-copy acceptance on the customer's behalf; fixed;
(l) UNCONFIRMED: `cr_approval_rule`'s seeded VALUE/MARGIN/SCHEDULE thresholds (₹200,000 / 10% /
14 days) and the FREEZE second-approver role (SUPER_ADMIN) — p12 names the mechanism, not real
numbers; `customisation_policy.payment_gate_pct` default (100%) is the spec's own TODO §8 client
question, unresolved here as elsewhere.

## Build note (2026-09-07, UI)

Built: **Customisation desk** (`apps/workspace/src/pages/customisation/CustomisationDesk.tsx`) —
kanban by all 17 statuses (not collapsed), "+ Raise request" dialog gated to
`CUSTOMISATION_DESK_ROLES` (mirrors `change-requests/capture.ts` exactly). **CR detail drawer**
(`CrDrawer.tsx`, `ItemsEditor.tsx`) covering gate summary at request, feasibility form, line-item
editor, impact form, approvals panel (list + decide), quotation issue/accept, payment gate status
+ confirm/waive, release button, execution-action list + close, QA-inspection link, as-built form,
and the economics card — one screen for the full 17-status lifecycle rather than splitting it
across sub-routes, since every panel's visibility is already status-gated. **Studio**: Variation
approval matrix (`CustomisationApprovalMatrixStudio.tsx`, edits `cr_approval_rule`) and
Customisation policy (`CustomisationPolicyStudio.tsx`, edits `customisation_policy`) — both tabs
already had `built: true` in `studio/registry.ts` from the backend build; only `Shell.tsx`'s
`BESPOKE_TABS` wiring was missing.

**Read-side gap closed** (same "write with no matching read" shape flagged elsewhere this run):
`putCrItems`/`issueQuotation`/`submitCrForApproval`'s approval rows/execution actions all had
writers but no route a UI could read them back through. Added 4 GET routes
(`/change-requests/:id/items`, `/api/quotations/:id`, `/change-requests/:id/approvals`,
`/change-requests/:id/execution-actions`), each gated via `getChangeRequest`'s own
`assertCrActor` rather than a new authz path. `withLabels()` at the route boundary
(`routes-change-requests.ts`) attaches `unit_number`/`booking_number` for display without
touching `store.ts`'s shared, already-tested `CR_SELECT` — the desk card and drawer never render
a raw `unit_id`/`booking_id` (verified live in the browser, not just by code review).

**Real bug found and fixed**: the new `execution-actions` route's SQL ordered by
`a.created_at`, a column that doesn't exist on the `action` table (`migrations/0009_actions.sql`
has only `due_at`/`closed_at`) — a live `[400] column a.created_at does not exist` on first drawer
open. Fixed to `ORDER BY x.action_id` (deterministic; `due_at` isn't reliably populated for
execution actions, so it isn't a usable sort key here the way `actions/core.ts`'s own listing
uses it).

**Real gap found and confirmed, not worked around**: `releaseChangeRequest`'s `unitSpec()`
(`specification/revisions.ts:71-73`) throws `"unit has no specification baseline attached"`
unless a `unit_specification` row already exists for the unit. That row is only ever created by
`ensureUnitSpecification` (`specification/revisions.ts:53-59`), which is itself a **silent no-op**
whenever the unit's project has no APPROVED `specification_baseline` for its product/unit type —
by the function's own docstring, not a bug. `specification/subscribers.ts` fires that function on
`booking.created`/`booking.status_changed→CONFIRMED`. Confirmed empirically against a fresh
`db:reset` seed: East Crest has 6 active (confirmed) bookings and **zero** `specification_baseline`
rows and **zero** `unit_specification` rows for the whole project — so `resolveBaseline` always
returns null, the subscriber always no-ops, and `releaseChangeRequest` cannot succeed for **any**
CR raised against seeded East Crest data today, regardless of this spec's own code. This is a
seed-data completeness gap in spec 09 (specification baselines never seeded a real APPROVED row
for East Crest's product/unit types), not a spec 18 defect. Consequence for this build: the
lifecycle was live-verified end to end through DRAFT → REQUESTED → FEASIBILITY_REVIEW → COSTING →
AWAITING_APPROVAL/AWAITING_CUSTOMER → AWAITING_PAYMENT → APPROVED (including both the rule 1
gate-exception grant+link path and rule 6's payment waiver path), but RELEASED and everything
after it (execution, QA, as-built) was exercised only by the pre-existing backend integration
test, not driven live through the UI — the panels are built and render correctly on a CR that
already carries the post-release fields, but no seeded fixture can reach that state to prove it
end-to-end live. Fixing this belongs to spec 09's seed data, not this slice.

**Scope cuts, flagged not faked**:
- **Unit 360 → Customisations tab / Booking 360 → Requests tab**: neither 360 page exists yet —
  only `Customer360.tsx` is built (spec 28's own UI is otherwise unbuilt); the Screens line names
  tabs on pages that don't exist. Cut entirely; revisit once 28's Unit/Booking 360 ship.
- **Portal raise-request UI** (`apps/my-pranava-home`): not built this pass. The desk + drawer +
  2 Studio tabs + full e2e coverage + regression already represent the full slice's real weight;
  the portal's own "raise request, view quotation, accept/decline, track status" surface is a
  second, separately-sized UI on a different app with its own visibility rules (customer-facing
  category filtering) — sized as follow-up work, not squeezed in to close out this session.

**Tests**: `apps/workspace/e2e/customisation.spec.ts` (5 tests) — 3-breakpoint desk render +
no-horizontal-overflow, the full raise → feasibility → costing → (conditional gate-exception) →
approval → quotation → payment-waiver → APPROVED lifecycle against a real booking created through
the UI itself (not a hardcoded fixture id), and both new Studio tabs against real seeded data.
The lifecycle test branches live on whichever of rule 1 (EXCEPTION_ONLY gate) and rule 4 (approval
matrix) actually apply to the fixture's real state, rather than asserting a fixed seed assumption.

**Regression, run from a fresh `db:reset`**: backend `npm test` — 789 tests across 104 files;
6 `registration.test.ts` timeouts under full-suite parallel load, confirmed a pre-existing
resource-contention flake unrelated to this slice (that file passes 6/6 cleanly run in isolation,
twice). Full Playwright e2e — 135 tests: 133 passed, 1 skipped
(`commitments.spec.ts:50`, a pre-existing conditional skip unrelated to this slice), 1 failed
under load (`management-views.spec.ts`'s KPIs-tab test — confirmed a flake, passes 10/10 cleanly
in isolation). All 5 of this slice's own tests passed cleanly in both the full run and isolation.

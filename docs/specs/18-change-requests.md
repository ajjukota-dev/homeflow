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

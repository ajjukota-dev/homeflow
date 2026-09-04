# 19 — Collections: demands, true risk, receipts, TDS, waivers, financial clearance

## Purpose
p9–10 §8.3: "Move from reporting outstanding to predicting cash realization" — separate **outstanding / due / overdue / disputed / loan-dependent / promise-to-pay / true risk**; reason codes on every overdue; next action always present; TDS verification; waiver approval and leakage. Financial clearance is the hard FINANCIAL gate for registration (23) and handover (16). Existing `demands*.ts`, `collections*.ts`, `clearance.ts` are the base (schedule, buckets incl. TRUE_RISK and PTP, reason codes API, validated receipts).

## Data
| Table | Columns |
|---|---|
| `payment_plan` | `id`, `project_id`, `product_type`, `name`, `kind ∈ {CONSTRUCTION_LINKED, TIME_LINKED, HYBRID}`, `milestones jsonb` [{code, label, share_pct or amount_rule, trigger ∈ {ON_BOOKING, ON_AGREEMENT, ON_COMPONENT_STATE (component, state), ON_DATE_OFFSET (days), ON_REGISTRATION, ON_HANDOVER}, grace_days, interest_rule?}], `version`, `effective_from/to` — seed **[E §5.1]** three templates as TIME_LINKED demos + East Crest construction-linked (demo) |
| `demand` | `id`, `booking_id`, `project_id`, `milestone_code`, `label`, `amount_inr`, `tax_inr`, `status ∈ {SCHEDULED, RAISED, DUE, PARTIALLY_PAID, PAID, OVERDUE, DISPUTED, WAIVED, CANCELLED}`, `trigger_state`, `raised_at`, `due_date` (null while SCHEDULED — PR #6), `grace_until`, `reason_code` (required when OVERDUE > grace), `reason_note`, `next_action_id`, `promise_to_pay_date`, `ptp_recorded_by/at`, `loan_dependent bool`, `dispute_reason`, `expected_receipt_date`, `expected_probability` (20) |
| `receipt` | `id`, `booking_id`, `demand_id`, `project_id`, `amount_inr`, `mode ∈ {BANK_TRANSFER, CHEQUE, DD, RTGS, NEFT, UPI, LOAN_DISBURSEMENT, ADJUSTMENT, OTHER}` **[E §5.3 — no CASH]**, `reference`, `received_on date`, `recorded_by`, `verification ∈ {PENDING, VERIFIED, DISPUTED}`, `verified_by/at`, `dispute_reason`, `tds_component_inr` |
| `overdue_reason` | `code`, `label`, `category ∈ {CUSTOMER_CASH, LOAN_DELAY, DISPUTE, DOCUMENT_PENDING, COMMUNICATION_GAP, INTERNAL_ERROR, OTHER}`, `default_next_action_type` |
| `tds_record` | `booking_id`, `demand_id?`, `applicability ∈ {NOT_DETERMINED, APPLICABLE, NOT_APPLICABLE}`, `na_reason`, `amount_inr`, `challan_number`, `challan_date`, `pan`, `file_id`, `status ∈ {PENDING, NOT_REQUIRED, VERIFIED, REJECTED}`, `verified_by/at` **[E §5.5]**; system suggests APPLICABLE when `agreement_value_inr ≥ 50,00,000` (§194IA 1 %) as a **suggestion**, human decides (client question) |
| `waiver` | `id`, `booking_id`, `demand_id`, `kind ∈ {INTEREST, LATE_FEE, PRINCIPAL, OTHER_CHARGE}`, `amount_inr`, `reason`, `requested_by`, `approved_by`, `approval_action_id`, `status ∈ {REQUESTED, APPROVED, REJECTED}` |
| `financial_clearance` | `booking_id`, `purpose ∈ {REGISTRATION, HANDOVER}`, `checklist jsonb` **[E §5.6]** {ledger_reconciled, due_amounts_paid, tds_verified (guard: tds VERIFIED/NOT_APPLICABLE), bank_disbursement_applicable (auto from 21), bank_disbursement_received (required iff applicable), other_charges_cleared, exceptions_approved (default **false** — Emergent defaulted true; client question)}, `status ∈ {PENDING, APPROVED, REJECTED}`, `approved_by/at`, `threshold_pct` (config; APPROVED requires paid ≥ threshold of consideration **and** checklist complete), `immutable_after_approval bool` |
| `collections_bucket` view | per booking: outstanding, due, overdue (ageing **[E §5.4]** Current/1–7/8–15/16–30/31–60/61–90/90+), disputed, loan_dependent, ptp, true_risk (= overdue − disputed − loan_dependent − ptp within date) |

## Rules
1. Demands are raised by triggers: `ON_COMPONENT_STATE` when 07 reports the component at the state (event subscription), `ON_DATE_OFFSET` by nightly job, others by their events. Until raised, `due_date` is null and the portal shows "Upcoming — after <trigger label>" (PR #6/#9 decision). Raised → `RAISED` with `due_date = raised + grace`; `DUE` on due date; `OVERDUE` after grace (IST).
2. Every OVERDUE demand must carry a `reason_code` within 2 working days; missing → action "Record overdue reason" for the RM/Accounts owner (10); `next_action_id` always set from the reason's default (p31 §26 "Every overdue collection has a structured reason and next action").
3. Buckets are mutually exclusive by definition: a demand is in exactly one of due / overdue / disputed / loan_dependent / ptp / true_risk; tests assert partition sums equal outstanding (p9 "separate…"; TODO decision: true risk excludes disputed, loan-dependent and PTP-within-date).
4. Receipts: amount finite, > 0, ≤ remaining (PR #5); numeric strings accepted; over-payment → `validation`; receipt on `SCHEDULED` demand → allowed only as `ADVANCE` (client question: early payment) — default **reject** until answered. `VERIFIED` receipts count toward paid **[E §5.2]**; `PENDING` show as "received, unverified".
5. Payment status per demand (read-time priority **[E §5.2]**): DISPUTED → WAIVED → PAID → PARTIALLY_PAID → OVERDUE → DUE → DUE_SOON (−7…−1) → SCHEDULED. Pre-breach alert ladder `due_7 / due_today / overdue_7 / overdue_15 / overdue_30` **[E]** → 12.
6. PTP: RM records `promise_to_pay_date`; when passed unpaid, PTP flag clears, demand moves to true risk and reason must be updated; PTP history kept.
7. TDS: applicability decided by Accounts (system suggestion shown with the §194IA rule text); verify requires all fields + challan file; `NOT_APPLICABLE` needs reason; state feeds clearance and journey task T8 **[E §5.5]**.
8. Waivers require an APPROVAL action per matrix (25); approved waivers reduce outstanding and are counted as **commercial leakage** (27) with reason.
9. Financial clearance: computed live; `APPROVED` only by Accounts lead/Management when checklist complete and `paid ≥ threshold_pct`; immutable after approval (new purpose row for handover); rejected with unmet list `{code: 'gate_blocked', blockers}` **[E §5.6]**. Registration (23) and handover FINANCIAL gate (16) read it.
10. Statement of account per booking (demands, receipts, TDS, waivers, running balance) is generated via 22 as a document.
11. All money math in integer paise internally or `numeric` — never JS float arithmetic on rupees (helper `money.ts`, tested).

## API
`GET/PUT /payment-plans` (Studio) · `POST /bookings/:id/payment-plan {plan_id}` (generates demands) · `GET /bookings/:id/demands` · `PATCH /demands/:id {reason_code, note, promise_to_pay_date, dispute_reason}` · `POST /demands/:id/receipts` · `POST /receipts/:id/verify|dispute` · `GET /projects/:id/collections?bucket&node_id&owner` · `GET /projects/:id/collections/ageing` · `PUT /bookings/:id/tds`, `POST /bookings/:id/tds/verify|reject` · `POST /waivers`, `POST /waivers/:id/approve|reject` · `GET /bookings/:id/clearance?purpose`, `PUT …/clearance/checklist`, `POST …/clearance/approve|reject` · `GET /bookings/:id/statement`.

## Screens
- **Collections** (Accounts/RM): bucket tiles (clickable, exclusive), table by booking/demand with age, reason, PTP, next action, owner; inline reason picker; receipt entry dialog (mode, ref, date, amount with remaining shown); verification queue; ageing chart; TDS panel; waivers queue; clearance checklist card with approve/reject.
- Booking 360 → Payments (schedule with trigger labels and status chips, receipts, TDS, statement PDF).
- Portal (26): schedule, dues, receipts, TDS status, "Upcoming — after flooring is verified" wording; no internal reason codes.
- Studio: Payment plans, Overdue reasons, Clearance thresholds, Waiver matrix.

## Events
`demand.raised`, `demand.status_changed`, `demand.reason_recorded`, `payment.received`, `payment.reconciled` (verified), `payment.disputed`, `tds.verified/rejected`, `waiver.requested/approved`, `clearance.approved/rejected`.

## Config
payment plans (per project/product), grace days, ageing buckets (one set), reason taxonomy, TDS suggestion rule, clearance threshold/checklist, waiver approval matrix, pre-breach ladder.

## Acceptance
p31 §26 "Every overdue collection has a structured reason and next action" · p37 §31.5 t2 (receipt lands under the correct project), t3 ("outstanding, overdue, disputed, loan-dependent and true risk are distinguishable") · rule tests 1–11 · partition test (rule 3) with 8 seeded demand states · money tests (rounding, ₹ formatting Indian grouping).

## Depends on / Feeds
Depends on 04, 07 (triggers), 10, 12, 21 (loan flag), 22 (statement), 25. Feeds 16, 20, 23, 26, 27, 14.

## Files
`services/api/src/collections/**` (migrate `demands*.ts`, `collections*.ts`, `clearance.ts`), `services/api/src/money.ts`, `services/api/migrations/0017_collections.sql`, `services/api/src/seed/payment-plans.ts`, `apps/workspace/src/pages/collections/**`, `apps/my-pranava-home/src/pages/Payments*.tsx`, Studio tabs.

## Not in this feature
Forecast lines/snapshots/scenarios (20), loan case management (21), document rendering (22).

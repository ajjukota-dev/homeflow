# 21 — Home loans

## Purpose
p10 §8.4 Loans: sanctioned vs disbursed vs available, next demand vs disbursement timing (days-to-demand vs days-to-disbursement), lender contact, missing documents, risk; loan-dependent demands are a separate collections bucket (19); disbursements are forecast lines (20). Existing `loan_case` table is the base.

## Data
| Table | Columns |
|---|---|
| `loan_case` (real table since `0000_init.sql`, as `id, booking_id, lender, sanctioned_amount, status` — 0026_loans.sql RENAMEs `lender`→`lender_name`, `sanctioned_amount`→`sanctioned_amount_inr`, `status`→`stage` to match this spec's real names, since only `seed.ts` used the old columns and no deployment carries real loan data yet; everything else below is additive) | `id`, `code LN-`, `booking_id`, `project_id`, `customer_id`, `lender_name`, `lender_branch`, `lender_rm_name`, `lender_rm_contact`, `requested_amount_inr`, `sanctioned_amount_inr`, `sanction_date`, `sanction_validity_date`, `sanction_letter_file_id`, `stage ∈ {APPLICATION, SANCTION_PENDING, SANCTIONED, DOCS_PENDING, DISBURSEMENT_SCHEDULED, PARTIALLY_DISBURSED, FULLY_DISBURSED, CLOSED, REJECTED, WITHDRAWN}` (union of **[E §6]** and the spec's chain), `own_contribution_inr`, `expected_disbursement_date`, `blocker`, `risk_score` (14 not built yet — computed directly by `loans/risk.ts`, not via 14's contract; reconcile when 14 lands), `missing_docs jsonb[]`, `notes`, `owner_user_id` (Banking role) — no RLS policy yet despite a real `project_id` (0025_rls.sql predates this migration; covered when P1b resumes, see TODO.md) |
| `loan_event` | `loan_id`, `type ∈ {APPLICATION_SUBMITTED, SANCTIONED, DOCS_REQUESTED, DOCS_RECEIVED, DISBURSEMENT_REQUESTED, DISBURSED, BLOCKER_RECORDED, BLOCKER_RESOLVED, REJECTED, WITHDRAWN}` **[E]**, `at`, `amount_inr?`, `receipt_id?`, `note`, `actor` |
| `loan_document_requirement` | `loan_id`, `category` (22 document category), `status ∈ {REQUIRED, RECEIVED, VERIFIED}` — the "missing docs" list is derived |

## Rules
1. One active loan case per booking; creating it flips 19's clearance `bank_disbursement_applicable = true` and marks the linked demands' `loan_dependent = true` for the sanctioned share **[E §6]**; rejection/withdrawal flips both back and moves those demands to customer-due with a CRM action.
2. Disbursement requires `SANCTIONED` or later; cumulative disbursed ≤ sanctioned + 1 % tolerance **[E]**; a disbursement creates a 19 receipt with `mode = LOAN_DISBURSEMENT` and marks `PARTIALLY/FULLY_DISBURSED` by tolerance.
3. Timing gap: `days_to_demand` (next loan-dependent demand due) vs `days_to_disbursement` (expected) exposed; gap < 0 → risk driver and an action for Banking (p10 "next demand vs disbursement timing").
4. `sanction_validity_date` within 7 d and not fully disbursed → escalation **[E §11.1]**; expired → stage `DOCS_PENDING` with blocker "Sanction expired".
5. Risk score (14 contract): drivers from stage age (application > 15 d **[E]**), missing docs count, validity days left, lender responsiveness (last event age), timing gap; actions "Chase lender", "Collect <doc>".
6. Loan-dependent demands never appear in true risk while the loan is on track (19 rule 3); they move to true risk when stage is REJECTED/WITHDRAWN or gap breaches by > 15 d (config).
7. Writers: Banking, Accounts, Management **[E §6]**; Sales/CRM read — but the seeded `permission_matrix` (§1.3 verbatim, the more authoritative seeded artifact) gives writers = Banking only, with Accounts/Management/CRM read-only and Sales no access. Built to match the seeded matrix, not this prose; flagged for Amarsh as an open §1.3-vs-§6 conflict (TODO.md) rather than resolved unilaterally — widen if he confirms §6.

## API
`GET/POST /bookings/:id/loan` · `PATCH /loans/:id` · `POST /loans/:id/events {type, amount_inr?, note}` · `PUT /loans/:id/documents` · `GET /projects/:id/loans?stage&risk` · `GET /loans/:id/risk`.

## Screens
- **Loans** (Banking/Accounts): pipeline by stage; case view with lender card, amounts (sanctioned/disbursed/available bar), timing gap chip ("Demand in 6 d · disbursement in 14 d"), missing docs checklist, events timeline, risk ScoreCard (14), actions.
- Booking 360 → Payments shows loan summary; Portal (26) shows stage, sanctioned/disbursed, "documents we need from you".

## Events
`loan.application_submitted`, `loan.sanction_received`, `loan.disbursement_received`, `loan.stage_changed`, `loan.blocker_recorded/resolved`, `loan.rejected`.

## Config
tolerance %, validity warning days, gap threshold, required document categories per lender type.

## Acceptance
p10 §8.4 loan bullets each ≥1 test · p37 §31.5 t3 (loan-dependent bucket) · rule tests 1–7.

## Depends on / Feeds
Depends on 19, 10, 12, 14, 22 (document categories). Feeds 19, 20, 26, 27.

## Files
`services/api/src/loans/**`, `services/api/migrations/0026_loans.sql` (spec names `0019_loans.sql`, renumbered — migrations apply in filename-sort order and 0019 would sort before several already-merged migrations this one depends on), `apps/workspace/src/pages/loans/**`, portal payments section.

## Not in this feature
Lender API integrations; forecast lines (20 derives them).

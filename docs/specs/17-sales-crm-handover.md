# 17 — Sales → CRM handover gate

## Purpose
p9 §8.1: "Make CRM acceptance a controlled quality gate": completeness score before submit; mandatory vs conditional document checklist by project/product/customer type; return reason taxonomy; first-time-right metric; automatic CRM actions on acceptance; commitments made during sales captured. Existing `bookings.ts` (completeness 0–100, accept/return) is the base; the packet shape comes from **[E §4.1]**.

## Data
| Table | Columns |
|---|---|
| `sales_handover` | `id`, `booking_id`, `project_id`, `status ∈ {DRAFT, SUBMITTED, RETURNED, ACCEPTED}`, `version` (increments per submit), `packet jsonb` (sections below), `completeness_score int`, `completeness_detail jsonb`, `submitted_by/at`, `accepted_by/at`, `returned_by/at`, `return_reason_code`, `return_note`, `first_time_right bool` (set at ACCEPTED: version == 1) |
| `handover_checklist_rule` | `id`, `project_id` (null = standard), `product_type`, `residency ∈ {RESIDENT, NRI, OCI, ANY}`, `item_code`, `kind ∈ {FIELD, DOCUMENT, CONFIRMATION, APPROVAL}`, `required bool`, `weight int`, `effective_from/to` — seed **[E §4.1 + §8.1]**: confirmations {applicant_details_confirmed, contact_verified, nri_status_confirmed, communication_pref_confirmed, unit_confirmed, facing_confirmed, parking_confirmed}; fields {final_price_inr, discount_inr, payment_plan_ref, booking_amount_inr, brokerage}; documents {Booking Form, Cost Sheet, PAN, Identity Proof, Address Proof, Photograph; NRI: Passport; OCI: OCI card; POA if applicable}; approvals {discount above matrix → commercial approval attached} |
| `return_reason` | `code`, `label`, `category ∈ {DOCUMENTS, COMMERCIAL, CUSTOMER_DATA, UNIT_DATA, COMMITMENTS, OTHER}` — taxonomy (p9 "return reason taxonomy") |

Packet sections **[E §4.1]**: `customer_section`, `commercial_section` (incl. `approved_deviations[]` with approver + ref), `unit_section`, `documents_section` (document ids from 22's checklist), `commitments_section` (items → 13 DRAFT commitments on submit).

## Rules
1. Completeness score = Σ weight of satisfied checklist rules / Σ weight × 100, computed live from the packet, documents (22 statuses ≥ RECEIVED), applicants (04) and approvals; `submit` requires 100 for `required` items and shows the missing list otherwise (`gate_blocked` with `blockers[]`) — p9 "completeness score before submit".
2. Checklist rules resolve by (project → standard) × product type × primary applicant residency (p9 "mandatory vs conditional by project/product/customer type"; **[E §8.1]** Resident 9 / NRI 10 / OCI 11 rows).
3. Commercial approvals: if `discount_inr` or brokerage exceeds the approval matrix (25), an APPROVAL action (10) must be CLOSED before submit (p9 "commercial approvals attached").
4. Submit: `DRAFT|RETURNED → SUBMITTED`, `version++`, commitments created DRAFT (13), emits `sales_handover.submitted`, creates CRM action "Review handover BKG-…" in the CRM queue.
5. Accept (CRM role, not the submitter): `SUBMITTED → ACCEPTED`; sets `booking.status = CRM_ACCEPTED`, assigns `rm_owner_user_id` (round-robin within the project's CRM team from 01 assignments, or explicit), instantiates the journey (06), creates onboarding actions (welcome call within 24 h — p19 §12 "Booking + 24 h welcome", KYC completion, agreement kickoff, payment plan confirmation), activates the packet's commitments after CRM approval (13 rule 6), sets `first_time_right`. Return after accept is **not** allowed (PDF handshake: acceptance is the gate; Emergent allowed it **[E §4.3]** — logged as client question).
6. Return (CRM, not the submitter): `SUBMITTED → RETURNED` with `return_reason_code` + note; creates a Sales action listing the reasons; `booking.status = RETURNED`.
7. FTR metric = accepted with `version = 1` / accepted, per sales owner, project, month; return reasons distribution — feeds 27 KPIs (p24 §19 "handover first-time-right %").
8. Nothing here writes unit physics or gates (01 rule 7).

## API
`GET /bookings/:id/sales-handover` (packet + live completeness + checklist with status per item) · `PUT /bookings/:id/sales-handover` (Sales owner) · `POST /bookings/:id/sales-handover/submit` · `POST …/accept` · `POST …/return {reason_code, note}` · `GET /crm/handover-queue?project_id` · `GET /sales/handover-metrics?project_id&from&to` · Studio: `GET/PUT /handover-checklist-rules`, `/return-reasons`.

## Screens
- **Sales → Handover packet** (per booking): sections as steps with completion ring, live "Missing: …" list, document uploader (22 component), approvals status, commitments entry; Submit disabled with reasons.
- **CRM → Handover queue**: submitted packets with completeness, age, sales owner; packet review view with per-item verification, Accept / Return (reason picker) — the existing CRM queue evolves.
- **Metrics**: FTR by owner/project, return reasons chart.
- Studio tabs: Checklist rules (by product/residency), Return reasons.

## Events
`sales_handover.submitted`, `sales_handover.returned`, `sales_handover.accepted`, `booking.status_changed`, `journey.started` (via 06), `action.created` (onboarding).

## Config
checklist rules, return taxonomy, approval matrix reference, onboarding action set.

## Acceptance
p9 §8.1 bullets each ≥1 test · Appendix B three handover events · rule tests 1–8 · Playwright: submit blocked with missing list → complete → submit → CRM return → resubmit → accept → journey exists and onboarding actions appear in My Day.

## Depends on / Feeds
Depends on 04, 10, 13, 22 (document checklist; until 22 lands, documents section stores uploaded files via `files` with category), 06, 25 (approval matrix; fallback: no threshold). Feeds 06, 13, 27.

## Files
`services/api/src/sales-handover/**` (replace handover parts of `bookings.ts`), `services/api/migrations/0015_sales_handover.sql`, `services/api/src/seed/handover-checklist.ts`, `apps/workspace/src/pages/sales/HandoverPacket*.tsx`, `apps/workspace/src/pages/crm/HandoverQueue*.tsx`, metrics page, Studio tabs.

## Not in this feature
Booking creation UI (24), document verification state machine (22), commitments lifecycle (13).

## Build note (2026-09-05, backend)
Built additively in `services/api/src/sales-handover/**` around the existing `createBooking`/`acceptBooking`/`returnBooking`, not as the Files list's "replace handover parts of `bookings.ts`" — 16 test files depend on those signatures; `acceptHandover`/`returnHandover` delegate the booking state change to them and layer the packet rules on top. Rule 5's `booking.status = CRM_ACCEPTED` deliberately NOT applied: five read sites filter `status = 'active'` and nothing moves crm_accepted→active — `sales_handover.status` is this feature's signal (see `model/status.ts`). Journey instantiation comes free from 06's existing `sales_handover.accepted` subscriber. `documents_section` scores against `booking.docs` (the `files` fallback table named here doesn't exist). Studio CRUD, `PUT …/sales-handover`, and all screens deferred; migration is `0030_sales_handover.sql` (0015 was taken).

# 23 — Registration

## Purpose
p10 §8.6: readiness checklist (documents, payments, TDS, appointments, signatures); SRO slot scheduling with change history; **hard pre-registration gate**; day-of checklist; registered document archive; forecast date with confidence. Emergent's desk steps **[E §7.3]** (Availability Confirmed → Slot Booked → Executed → Closed) are kept as real stages.

## Data
| Table | Columns |
|---|---|
| `registration_case` | `id`, `code REG-`, `booking_id`, `unit_id`, `project_id`, `status ∈ {NOT_READY, READINESS_IN_PROGRESS, READY, AVAILABILITY_CONFIRMED, SLOT_BOOKED, EXECUTED, COMPLETED, CANCELLED}`, `forecast_date`, `forecast_confidence`, `readiness jsonb` (live: documents, clearance, tds, agreement_executed, customer_availability, signatories, poa_valid → each {ok, fact}), `sro_office`, `slot_datetime`, `slot_reference`, `slot_history jsonb[]` [{from, to, reason, by, at}], `executed_on`, `registration_document_number`, `company_representative`, `customer_attendees jsonb`, `registered_deed_file_id` (22 FINAL Sale Deed with `sro_reference`), `stamp_duty_inr`, `registration_fee_inr`, `outcome_notes`, `owner_user_id` (Registration role) |
| `registration_checklist_template` | `project_id?`, `jurisdiction`, `pre_items jsonb` (readiness), `day_of_items jsonb` (originals to carry, ID proofs, photos, witnesses, DD/challan, POA original, company authorisation) — Policy Studio |

## Rules
1. Readiness computed live from: 22 customer documents (required ACCEPTED), 19 clearance `REGISTRATION` APPROVED **(hard)**, 19 TDS VERIFIED or NOT_APPLICABLE **(hard)**, 22 AOS EXECUTED **(hard)**, 22 Sale Deed APPROVED_FOR_EXECUTION, applicant signatories complete (04), POA valid if used, customer availability confirmed. `READY` when all hard items ok (p10 "hard pre-registration gate"; **[E §7.3]** precondition set).
2. `AVAILABILITY_CONFIRMED` via customer action (portal or CRM on behalf) proposing dates; `SLOT_BOOKED` requires READY + confirmed availability; every slot change appends to `slot_history` with reason (p10 "change history"); slot within 3 d of availability else escalation **[E §11.1]**.
3. `EXECUTED` records the SRO outcome; `COMPLETED` requires the registered deed archived as 22 FINAL with `sro_reference` and `registration_document_number`; sets 04 `booking.status = REGISTERED`, `unit.sale_status = REGISTERED`, emits `registration.completed` (Appendix B) — Emergent missed these side effects **[E conflict fixed]**.
4. Forecast date = max(clearance expected date (20), document ETA, SRO availability) + jurisdiction lead; confidence from inputs; shown to the customer only when READY (26 "approved dates").
5. Day-of checklist must be complete before `EXECUTED` can be recorded (p10 "day-of checklist").
6. Registration final demand (if plan has ON_REGISTRATION) raised on SLOT_BOOKED → 19/20 `REGISTRATION_FINAL_DEMAND` line.
7. Writers: Registration, Legal, Management; CRM may confirm availability.

## API
`GET /bookings/:id/registration` · `POST /registration/:id/confirm-availability {dates[]}` · `POST /registration/:id/book-slot {sro_office, slot_datetime, reference}` · `POST /registration/:id/reschedule {slot_datetime, reason}` · `PUT /registration/:id/day-of-checklist` · `POST /registration/:id/execute {…}` · `POST /registration/:id/complete {deed_document_id}` · `GET /projects/:id/registration-pipeline` · Studio `GET/PUT /registration-checklist-templates`.

## Screens
- **Registration** (Registration role): pipeline by status with forecast dates; case view: readiness card (facts, hard items marked), availability + slot scheduler with history, day-of checklist, execution form, archive link; blockers link to the owning module's action.
- Booking 360 → Registration tab; Portal (26): Registration area (what we need from you, slot confirmation, executed deed download).

## Events
`registration.readiness_changed`, `registration.availability_confirmed`, `registration.scheduled` (Appendix B), `registration.rescheduled`, `registration.executed`, `registration.completed` (Appendix B).

## Config
checklist templates by jurisdiction, SRO offices master, lead days.

## Acceptance
p10 §8.6 bullets each ≥1 test · hard gate test: clearance not APPROVED → `book-slot` returns `gate_blocked` with the fact · completion side-effects test (booking/unit status + event) · rule tests 1–7.

## Depends on / Feeds
Depends on 19, 22, 04, 10, 20. Feeds 16 (REGISTRATION gate), 26, 27.

## Files
`services/api/src/registration/**`, `services/api/migrations/0021_registration.sql`, `apps/workspace/src/pages/registration/**`, portal Registration page.

## Not in this feature
SRO API integration (none exists); stamp duty calculators (values entered).

## Build note (2026-09-06, backend)
Built ahead of 20 (cash forecast) despite the spec's own listed dependency — 20 and 23 form a real
circular pair (20 needs 23's SLOT_BOOKED for its REGISTRATION_FINAL_DEMAND line; 23 needs 20's
clearance-expected-date as one term in its own forecast). Advisor-recommended ordering: 23 first,
because it unblocks both 16 and 20 (16's only unbuilt dependency is 23) and because 23 is the
*producer* of the row 20 would otherwise need a stub for, so building 23 first leaves no stub in
either direction — only 20's own missing term in 23's forecast_date needs flagging (below).

(a) `registration_case` already existed (0000_init.sql: `id, booking_id, project_id, status,
sro_reference, completed_at`) with real readers — `legal-docs.ts`'s own simple
`completeRegistration` (the AOS-era flow), `qa.ts`, `scores/booking-readiness.ts` — all keying on
`status = 'completed'`. ALTERed in place, kept that value and `sro_reference`; the two flows now
coexist on the same row (this build never calls the legacy function, and vice versa), same
"different producer, one entity" pattern 15's `qa_evidence` and 18's own tables already used.
(b) `readiness`'s jsonb schema gets an 8th key, `sale_deed_ready`, beyond the Data table's 7 —
rule 1's own prose names "22 Sale Deed APPROVED_FOR_EXECUTION" as a distinct hard input with no
jsonb key of its own in the Data table, a real omission fixed here.
(c) `proposed_availability_dates` and `day_of_checklist` are real additions beyond the Data
table's literal column list — rule 2 needs somewhere to persist the customer's own proposed dates
(distinct from the live-computed readiness facts), and rule 5's day-of gate needs a per-case
completion map alongside the template's own list of required items.
(d) Real regression caught by running the full suite, twice: two pre-existing raw-SQL
`INSERT INTO registration_case` call sites broke on the new NOT NULL `code`/`unit_id` columns —
`seed-lifecycle.ts`'s 3 demo fixtures (fixed by giving each a real code/unit_id + bumping the
`REG` code_sequence past them) and, more seriously, `legal-docs.ts`'s own `completeRegistration`
(a real production code path, not just a test fixture — fixed by minting a code via
`model/codes.ts::nextCode` on first insert). `scores/core.test.ts`'s own synthetic insert was the
third site, fixed the same way.
(e) Real bug in `allRequiredAccepted`'s reuse: it reads "zero `customer_document` rows" (before
22's checklist is even seeded, i.e. before CRM acceptance) as vacuously all-accepted. Caught by
this spec's own rule-1 test asserting a fresh booking starts NOT_READY — fixed in
`readiness.ts` by requiring at least one row to exist before calling it, not by changing
`allRequiredAccepted` itself (22's own callers rely on its current vacuous-true semantics once a
checklist genuinely has zero required items).
(f) "Signatories complete" and "POA valid if used" have no dedicated fields anywhere — judgment
calls, same class as 15/18's own vocabulary-mapping calls: signatories reads off the linked
customer's own `kyc_status = 'verified'`; POA reads off the `customer_document` POA category's
own ACCEPTED status, and is trivially true when no POA-role applicant exists on the booking.
(g) Rule 4's forecast (`max(clearance expected date (20), document ETA, SRO availability) +
jurisdiction lead`) omits the 20 term entirely (not built — flagged, not faked) and has no real
source for "document ETA" (no due-date field exists on `customer_document`); implemented as a
heuristic keyed on slot_datetime/proposed availability/readiness state with HIGH/MEDIUM/LOW
confidence, UNCONFIRMED, same class as 06's placeholder durations elsewhere in this backlog.
(h) Rule 6 (raise the ON_REGISTRATION final demand on SLOT_BOOKED) is NOT wired — it needs 20's
`forecast_line`/a `payment_plan` ON_REGISTRATION-milestone flag, neither of which exists. Flagged
in `core.ts::bookSlot`'s own comment, same as 18's rule 12.
(i) The ">3 days from availability -> escalation [E §11.1]" half of rule 2 is surfaced as an
`escalation_needed` fact on `bookSlot`'s return value only — no real `escalation_rule`/Escalation
row is raised. 12's `scanEscalations` is config-rule-driven, not a per-call trigger; wiring a new
rule kind for this is separate scope, same class as 15's unwired `critical_snag_2d`.
(j) Portal (26) not built: rule 2's "via customer action (portal or CRM on behalf)" only exercises
the CRM-on-behalf half — same fallback-flagging pattern as 18's signed-copy quotation acceptance.
(k) `registration_checklist_template` seeds one real global fallback row (day_of_items uses the 7
items the spec's own Data section names by name — generic to any project, not invented);
`sro_offices` ships empty and `jurisdiction_lead_days: 15` is UNCONFIRMED, same class as 18's
approval-matrix thresholds — real SRO office data and lead times are Amarsh's to supply.
(l) Studio: the two pre-existing placeholder rows (`23.registration_checklists`,
`23.sro_offices`) flip to `built:true`, backed by the one `registration_checklist_template` table
(two edit surfaces, one table) — same shape 18 used for `cr_approval_rule`/`customisation_policy`.
Full suite: 91 files / 574 tests, `tsc --noEmit` clean.

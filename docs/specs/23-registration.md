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

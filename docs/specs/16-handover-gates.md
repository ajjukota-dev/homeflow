# 16 — Handover gates, appointment & digital handover

## Purpose
p16–17 §8.10 and §9 gate table: handover is "a gated event, not a date". Eight gate dimensions with hard/soft classification and the override column exactly as written (p17 §9): **Financial** (hard, no override except Management with approval + reason) · **Legal** (hard) · **Registration** (hard, unless policy allows possession-before-registration) · **Physical readiness** (hard) · **Quality/snags** (hard for critical, soft for minor) · **Commitments** (hard) · **Customer** (soft — appointment confirmed, documents signed) · **FM/Community** (soft — utilities, access, FM onboarding). "Hard handover gates cannot be bypassed without configured authority and audit reason" (p31 §26). Predicted handover date + confidence; appointment workflow + customer confirmation; digital handover checklist (keys, meters, manuals, warranties, signatures, photographs). Existing `handover.ts` (six gates, hard/soft) is the base.

## Data
| Table | Columns |
|---|---|
| `handover_gate_config` | `gate ∈ {FINANCIAL, LEGAL, REGISTRATION, PHYSICAL, QUALITY, COMMITMENTS, CUSTOMER, FM_COMMUNITY}`, `classification ∈ {HARD, SOFT}`, `overridable bool`, `override_roles[]`, `requires_approval bool`, `requires_evidence bool`, `product_types[]`, `project_id` (null = standard), `params jsonb` (e.g. QUALITY: `{critical_open_max: 0, major_open_max: 3}`; FINANCIAL: `{clearance_status: 'APPROVED'}`; REGISTRATION: `{allow_possession_before_registration: false}`), `effective_from/to`, `version` |
| `handover_case` | `id`, `code HO-`, `booking_id`, `unit_id`, `project_id`, `status ∈ {NOT_STARTED, PREPARING, READY, SCHEDULED, COMPLETED, CLOSED}` (Appendix A p42 uses Not Started / Preparing / Ready / Scheduled / Completed / Closed **[verify against p42 on build; use verbatim]**), `predicted_date`, `predicted_confidence`, `readiness_score_snapshot_id` (14), `completed_at`, `keys_issued_at` |
| `handover_gate_run` | `case_id`, `gate`, `state ∈ {OPEN, PASSED, OVERRIDDEN}`, `blockers jsonb[]`, `evaluated_at`, `override_id` |
| `handover_override` | `id`, `case_id`, `gate`, `authority_user_id`, `authority_role`, `approved_by_user_id` (if `requires_approval`), `reason`, `evidence_file_ids[]`, `valid_until`, `created_at` |
| `handover_appointment` | `case_id`, `proposed_slots jsonb[]`, `confirmed_slot timestamptz`, `confirmed_by ∈ {CUSTOMER_PORTAL, CRM_ON_BEHALF}`, `confirmed_at`, `attendees jsonb`, `rescheduled_count`, `reschedule_reasons jsonb[]` |
| `handover_checklist` | `case_id`, `groups jsonb` — seed **[E §10.3]**: property {cleaning, electrical, plumbing, fixtures, doors_windows, snag_clearance} · keys {main_door_count, secondary_count, utility_count, other_count, all_handed_over} · access {access_cards_count, parking_slot_ids, clubhouse_confirmed, security_briefed} · utilities {electricity_meter_no, electricity_reading, water_meter_no, water_reading, gas?} · documents {possession_letter, warranties, manuals, registration_copy, maintenance_docs, contact_directory}; each item `{done, by, at, file_ids[]}`; `customer_signature_file_id`, `company_signature_file_id`, `photos file_ids[]` |

## Rules
1. Gate evaluation is a pure function over inputs: FINANCIAL ← 19 clearance status; LEGAL ← 22 executed AOS (+ executed customisation agreement if 18 has approved CRs); REGISTRATION ← 23 status COMPLETED (or policy param); PHYSICAL ← 14 Unit Readiness ≥ threshold **and** all `evidence_required` components VERIFIED; QUALITY ← 15 open critical = 0 and major ≤ max; COMMITMENTS ← 13 rule 8; CUSTOMER ← appointment confirmed + required customer documents signed (22); FM_COMMUNITY ← 15 external dependencies DONE for the unit's ancestors + FM onboarding record (30) prepared. Each run stores blockers as facts ("Critical snag SNG-000031 open 4 d").
2. HARD gates block `SCHEDULED` and `COMPLETED`; SOFT gates warn and appear on the checklist. An override requires `overridable = true`, actor in `override_roles`, non-empty reason, evidence if configured, approval if configured (by a second user); it changes state to `OVERRIDDEN` (never `PASSED`) and is visible on every later screen and in the event log (p31 §26; p17 §9). Safety-class blockers (fire NOC / occupancy certificate dependencies flagged `safety = true`) are never overridable **[ours, from p17 "Physical readiness … no override"]**.
3. `predicted_date` = max over gate-clearing forecasts (06 forecast for construction, 19 expected clearance, 23 registration forecast) with confidence = min of their confidences; recomputed on inputs' events; shown to the customer only when `readiness ≥ Amber` and CRM has published it (26 visibility rule: "approved dates").
4. Appointment: CRM proposes ≥2 slots after all HARD gates pass (or are overridden); the customer confirms in the portal or CRM confirms on behalf with a note; reschedule requires reason and recreates the customer action (10). Appointment confirmation flips the CUSTOMER gate.
5. Completion requires: all HARD gates PASSED/OVERRIDDEN, checklist required items done with photos where configured, both signatures, keys `all_handed_over`. Emits `handover.completed`; sets 04 `booking.status = HANDED_OVER`, `unit.sale_status = HANDED_OVER`; opens 30 post-handover case (DLP windows start).
6. `CLOSED` after 30 post-handover onboarding items are done (FM intro, maintenance setup, owner record transferred, warranties shared, snag monitoring) **[E §10.3 H12 payload]**.
7. Re-evaluate gates on every input event (subscriptions) and on demand; log each run (history visible).

## API
`GET /bookings/:id/handover` (case, gates with blockers, overrides, predicted date, appointment, checklist) · `POST /handover/:id/evaluate` · `POST /handover/:id/override {gate, reason, evidence_file_ids, approver?}` · `POST /handover/:id/appointment/propose|confirm|reschedule` · `PUT /handover/:id/checklist` · `POST /handover/:id/complete` · `POST /handover/:id/close` · `GET /projects/:id/handover-pipeline` (cases by status, predicted dates, gate heatmap) · `GET/PUT /handover-gate-config` (Studio).

## Screens
- **Handover** (QA/Handover role): pipeline table; case view with eight gate cards (state icon + label, blockers as bullet facts, override button for authorised roles with dialog: reason, evidence, approver), predicted date + confidence with drivers, appointment scheduler, digital checklist (grouped, photo capture, meter readings, signature pads), complete/close buttons disabled with reasons listed.
- Booking 360 → Handover tab (read view). Management → pipeline + override log (27 exceptions).
- Portal (26): appointment confirmation, checklist summary after completion, possession letter.

## Events
`handover.gate_evaluated`, `handover.gate_overridden`, `handover.scheduled`, `handover.appointment_confirmed/rescheduled`, `handover.completed`, `handover.closed`.

## Config
`handover_gate_config` (p26 §21 "handover gate configuration"), checklist template, thresholds.

## Acceptance
p17 §9 table: one test per row asserting hard/soft and override permissions · p31 §26 "Hard handover gates cannot be bypassed without configured authority and audit reason" · Appendix A handover statuses · rule tests 1–7 · integration with 13 (commitments gate), 15 (critical snag), 19 (clearance), 23 (registration).

## Depends on / Feeds
Depends on 13, 14, 15, 19, 22, 23, 04, 10. Feeds 26, 27, 30.

## Files
`services/api/src/handover/**` (replace `handover.ts`, `handover.test.ts`), `services/api/migrations/0014_handover.sql`, `services/api/src/seed/handover-gates.ts`, `apps/workspace/src/pages/handover/**` (replace `QaHandover.tsx` handover half), `apps/workspace/src/components/SignaturePad.tsx`.

## Not in this feature
Post-handover cases (30), FM onboarding content (30), readiness math (14).

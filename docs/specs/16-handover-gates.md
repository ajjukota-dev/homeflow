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
UI slice also touched: `apps/workspace/src/pages/handover/HandoverCaseDrawer.tsx`, `apps/workspace/src/pages/handover/api.ts`, `apps/workspace/src/pages/QaHandover.tsx`, `apps/workspace/src/Workspace.tsx`, `apps/workspace/src/api-lifecycle.ts` (dead legacy exports removed), `apps/workspace/e2e/visual.spec.ts`, `apps/workspace/e2e/handover-gates.spec.ts` (new).

## Not in this feature
Post-handover cases (30), FM onboarding content (30), readiness math (14).

## Build note (2026-09-06, backend)
(a) **Commitments corrected to HARD.** The pre-existing `handover.ts` classified Commitments as
SOFT, citing the legacy `docs/spec/` draft's own hard-gate list as justification and calling the
opposite claim "an unverified premise, corrected here." This spec's own p17 §9 table (the
authoritative build contract per CLAUDE.md) lists Commitments as HARD — the same spec-authority
rule the old comment invoked, resolved the other way once this file's own text was read. Fixed
`DEFAULT_GATE_CLASS`, and the two pre-existing tests that asserted the old (wrong) behaviour
(`handover.test.ts`, `commitments/core.test.ts`).
(b) **Quality/snags stayed nine gates, not eight.** `handover_gate_config`'s CHECK constraint
enumerates 8 gate values; Purpose's own text splits Quality into "hard for critical, soft for
minor," which one config row can't carry. Kept the pre-existing structure: `quality` (hard,
critical+QA+minor-snag) and a separate always-soft `snags` gate (major-snag policy) sitting
outside `handover_gate_config` entirely — an 8-column config table plus one gate the config layer
doesn't own, not the 8-vs-9 mismatch it might look like at a glance.
(c) **ALTER-in-place, two-producer coexistence** — same pattern 23 used for `registration_case`.
`handover_record` predates this spec (0000_init.sql: `id, booking_id UNIQUE, unit_id, project_id,
status, completed_at`, written only by `qa.ts`'s legacy `completeHandover`). ALTERed (0039) rather
than replaced by the Data section's `handover_case`; the legacy writer and this spec's stateful
`handover/core.ts` read/write the same row and emit the same `handover.completed` event. The
legacy INSERT needed `ON CONFLICT (booking_id) DO UPDATE` once this module's own
`loadOrCreateCase` started lazily creating that row on first read (e.g. opening the Handover view
before the legacy flow ever ran) — caught before landing, with a regression test exercising the
exact interleaving.
(d) **`buildHandoverInput` extracted from `qa.ts::handoverForBooking`**, reused by both the legacy
function and this spec's `evaluateCase`, avoiding ~50 lines of duplicated readiness/snag/finance/
legal/registration/commitments query logic.
(e) **Rule 5's DLP window was already built** — `warranty.ts::onHandoverCompleted` (pre-existing,
predates this spec) already opens the `dlp_window` on handover completion; `completeCase` calls it
unchanged rather than reimplementing.
(f) **Flagged, not faked — rule 3's forecast.** Only 23's `registration_case.forecast_date` is a
real, queryable term; 06 has no construction-completion forecast and 19's `financial_clearance`
carries no expected-date field. `predictDate` uses the confirmed appointment slot first, then
23's forecast, then a flat LOW-confidence fallback — the max-over-three-forecasts rule is
UNCONFIRMED beyond what 23 provides today.
(g) **Flagged, not faked — rule 6's close gate.** Spec 30 (post-handover onboarding items: FM
intro, maintenance setup, owner record transfer, warranties shared, snag monitoring) is unbuilt
and explicitly out of scope for this spec ("Not in this feature"). `closeCase` checks only
COMPLETED status + a `dlp_window` existing, then lets FM/Management close on judgment — the same
class of gap 23 left for its own final-step check.
(h) **`handover_checklist.groups` seeded to the Data row's own skeleton** (property/keys/access/
utilities/documents, each item `{done, by, at, file_ids}`) rather than shipping empty — a fresh
case's checklist now shows every item the spec names, defaulted to not-done. Which items beyond
`keys.all_handed_over` and the two signatures are "required... with photos where configured" for
rule 5 isn't stated by the spec; `completeCase` still enforces only those three, flagged rather
than guessed.
(i) **Approval-matrix integration for `requires_approval` overrides (e.g. FINANCIAL) is unwired.**
`overrideGate` accepts an `approved_by_user_id` and stores it, but doesn't verify that user via
25's approval-authority matrix — same flag-don't-fake gap as elsewhere in this build where an
approvals module exists but per-feature wiring wasn't in scope.
(j) **`booking.status = 'handed_over'`** is now also set by `completeCase` (the legacy path only
ever set `unit.sale_status`) — a genuine improvement matching rule 5's own "sets 04
`booking.status = HANDED_OVER`" text, which the legacy flow had never implemented.
(k) `handover.gate_overridden` and `handover.closed` are internal governance/audit events, not
customer-visible (p31 §26's "visible on every later screen" reads as internal screens + the audit
log) — `customer_visible: false`, same call as 23's `registration.readiness_changed`.
`handover.appointment_confirmed/rescheduled` stay customer-visible (the customer's own
appointment); `handover.scheduled`/`handover.completed` are Appendix B's own canonical set.
(l) `handover_gate_run` now persists only on a `(state, override_id)` change per gate, not on
every read — otherwise every GET/pipeline row would write 8 identical rows, burying rule 7's
"history visible" in noise (same precedent as 23's `refresh()`).

## Build note (2026-09-07, UI)
Built the QA/Handover role's screens on top of the (b)-through-(l) backend above: the pipeline
table, a full case drawer (8 gate cards, override dialog, appointment scheduler, digital checklist,
a real canvas `SignaturePad`, and complete/close with the actual blocking reasons listed), replacing
the pre-existing `QaHandover.tsx`'s legacy inline handover-gates half in place.

(m) **Two real bugs caught before landing, both by reading the backend against what the UI needed
before writing UI code** (this build's now-established discipline, having already caught the same
class of raw-id leak 4 times across specs 20/27/18): `evaluateCase`'s `CaseView` computed
`unit_number`/`customer_name` internally via `buildHandoverInput` but discarded them before
returning — added both fields rather than have the UI show raw ids. Separately, `listHandoverPipeline`
queried `handover_record` directly, silently excluding any villa the stateful case machine hadn't
lazily touched yet (only 2 of 6 seeded villas showed up) — found live via Playwright MCP, not by
reading the code; fixed to source from all active bookings and lazily create case rows via
`loadOrCreateCase`, matching the legacy `qa.ts::projectHandover`'s own behaviour.
(n) **The old "Complete handover" pipeline-row shortcut is gone.** It bypassed rule 5's real
requirements (checklist `keys.all_handed_over` + both signatures) by calling the legacy
`completeHandover` directly. "Open case" now opens the full drawer, and completion only happens
from there once every precondition is genuinely met — the two pre-existing `visual.spec.ts` tests
that used the old shortcut were rewritten to drive the real flow instead of preserving the shortcut.
(o) **No file-upload port exists anywhere in this codebase** (same gap `CommitmentDrawer.tsx`'s own
comment already flags for evidence files) — `SignaturePad`'s captured PNG `data:` URL stands in for
a `*_signature_file_id`, and the override dialog's "Evidence reference(s)" field is honest freeform
text, not a fake upload control. Flagged in both components' own comments.
(p) **Scope cut: no Booking 360 tab.** No Booking 360 page exists yet in this codebase (same finding
spec 18's UI slice made) — nothing to add a Handover tab to.
(q) **Scope cut: no separate Management pipeline/override-log screen.** `ControlTower.tsx`'s
existing Exceptions tab already surfaces `HANDOVER_OVERRIDE` entries from the shared audit log
(`management-views.spec.ts`'s own passing test covers it); a second, duplicate override-log UI
wasn't built.
(r) **Scope cut: no Portal (26) screens.** Portal 26 is itself unbuilt in this codebase; appointment
confirmation, checklist summary, and the possession letter are customer-facing pages that belong to
that spec's own build, not this one's UI slice.
(s) **e2e coverage lives in two files.** `visual.spec.ts`'s pre-existing "QA handover completes keys
for an eligible villa" test now drives V112 (the one villa seeded fully eligible on a fresh DB) all
the way through propose→confirm appointment→checklist→both signatures→complete. New
`handover-gates.spec.ts` covers the pipeline view and two override permutations (approval-required
on Financial, evidence-required on Quality) against V110, which can never reach eligibility (Physical
is blocked by real readiness/utilities and isn't overridable) — deliberately chosen so nothing here
races another spec file into completing a shared booking. A third variant (override Commitments on
V113 to reach eligibility, chasing the full propose→confirm→complete→close chain) was tried and
dropped: `commitments.spec.ts`'s own gate-integration test opens a real commitment against
`handovers[0]` — whichever booking the pipeline happens to return first, not pinned to a villa — so
V113 isn't a stable fixture for a second file to also drive toward eligibility. "Close case" (rule 6)
has no coverage at all in this slice — not e2e, not live MCP — because it only renders after a case
reaches COMPLETED, and no MCP session this build reached that state either; combined with rule 6's
own already-flagged incompleteness (o above), this is an honest gap, not a verified corner, and a
proportionate cut given the core pipeline + case view is the real deliverable here.

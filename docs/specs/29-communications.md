# 29 — Communications

## Purpose
p16 §8.12: omnichannel log (call, email, WhatsApp, SMS, meeting, notice); strict internal vs customer-visible separation; templates with project/legal/compliance approval; frequency guardrails. AI summary/sentiment later (31). Never auto-send consequential customer comms from AI (p32 §27).

## Data
| Table | Columns |
|---|---|
| `communication` | `id`, `code COM-`, `customer_id`, `booking_id?`, `project_id`, `channel ∈ {CALL, EMAIL, WHATSAPP, SMS, MEETING, NOTICE, PORTAL_UPDATE}`, `direction ∈ {INBOUND, OUTBOUND}`, `visibility ∈ {INTERNAL, CUSTOMER_VISIBLE}`, `subject`, `body`, `template_id?`, `occurred_at`, `logged_by`, `follow_up_required bool`, `follow_up_due`, `follow_up_action_id`, `attachments file_ids[]`, `linked_entity` {type, id}, `sentiment?` (31), `summary?` (31) |
| `communication_template` | `id`, `code`, `channel`, `purpose ∈ {WELCOME, PAYMENT_REMINDER, MILESTONE, DOCUMENT_REQUEST, APPOINTMENT, DELAY_NOTICE, CUSTOMISATION_QUOTE, HANDOVER_INVITE, CHECK_IN, GENERAL}`, `subject`, `body` (merge fields from 22 definitions), `project_id?`, `version`, `status ∈ {DRAFT, LEGAL_REVIEW, APPROVED, RETIRED}`, `approved_by/at` (Legal for legal-bearing purposes, CRM lead otherwise) |
| `frequency_guardrail` | `purpose`, `max_per_customer_per_window`, `window_days`, `quiet_hours` — Policy Studio |
| `internal_note` | `entity_type`, `entity_id`, `body`, `author`, `at`, `mentions[]` — always INTERNAL; never in any portal projection |

## Rules
1. Every customer touch is logged (manual for calls/WhatsApp/SMS/meetings; automatic for portal updates and system emails) with channel, direction, visibility (p16).
2. `CUSTOMER_VISIBLE` entries appear in the portal feed (26) — only CRM may set visibility to customer-visible, and only from an APPROVED template or free text explicitly published (H10-style single approver; Emergent let Legal/Management publish directly **[E §12 conflict]** — we follow the PDF's CRM ownership, client question logged).
3. Templates with legal bearing (payment reminders, delay notices, cancellation) require Legal approval before use; merge fields resolve from 22 definitions; preview before send.
4. Frequency guardrails: sending a reminder beyond `max_per_customer_per_window` is blocked with the last-sent facts; overrides need CRM lead + reason (p16 "frequency guardrails").
5. Outbound email uses the mailer port (03) and logs the communication; WhatsApp/SMS are logged as sent manually (no vendor integration yet — TODO defaults).
6. Inbound with `follow_up_required` creates an action (10) due `follow_up_due`; unresolved 48 h → escalation **[E §11.1 customer_query_unresolved_48h]**.
7. Internal notes are never returned by any `/portal/*` endpoint (denylist test in 26 covers `internal_note`).
8. Consequential customer messages (delay notices, cancellation, legal) are drafted by staff or from templates; nothing sends without a human click (p32 §27).

## API
`GET /customers/:id/communications?channel&visibility` · `POST /communications` (log) · `POST /communications/send-email {template_id|body, to, merge_ctx}` · `POST /communications/:id/publish-to-portal` · `GET/PUT /communication-templates`, `POST …/submit-legal-review|approve` · `POST /internal-notes`, `GET /internal-notes?entity` · Studio `GET/PUT /frequency-guardrails`.

## Screens
- Customer 360 → Communications: timeline with channel icons, direction, visibility badge, follow-up chips; "Log a call/meeting" form; "Send email" from template with preview and guardrail check; publish-to-portal with confirmation stating what the customer will see.
- Internal notes panel on every entity (mentions notify via 12).
- Studio: Communication templates (versions, approvals), Frequency guardrails.

## Events
`customer_contact.sent`, `customer_contact.response_received` (Appendix B), `communication.published`, `template.approved`.

## Config
templates, guardrails, quiet hours (12 preferences reused).

## Acceptance
p16 §8.12 bullets each ≥1 test · Appendix B two events · rule tests 1–8 · visibility test: INTERNAL never appears in portal projection.

## Build note (2026-09-06)

**Scope.** Backend only — `communications/{core,templates,notes}.ts`, `routes-communications.ts`,
migration `0044_communications.sql`, `seed/communications.ts`. Frontend (Customer 360 →
Communications tab, internal-notes panel, Studio's two new tabs) deferred per this session's
backend-first pass; the tabs are marked `built:true` in `studio/registry.ts` for the *table*
CRUD, not for any UI.

**Reuse decisions.**
- Rule 2's publish-to-portal reuses 26's `customer_update` table/feed directly (`kind='MESSAGE'`)
  rather than building a second portal-integration path — `getUpdates` already reads
  `WHERE status='PUBLISHED'`.
- Rule 3's merge-field resolution reuses 22's `buildSourceContext`/`resolvePath`/
  `formatMergeValue` and the `merge_field_definition` table as-is; `renderTemplateBody` is a new,
  lighter `{{code}}` substitution for plain-text email/log bodies — it doesn't route through 22's
  clause/PDF document machinery, which communications don't need.
- Rule 6's 48h follow-up escalation reuses the existing SLA-clock/escalation-ladder mechanism
  (`journey/sla.ts::startClock`, `escalations/core.ts::scanEscalations`) end-to-end, not a new
  timer. `customer_query_48h` is the first of the 13 seeded escalation rules actually wired
  (`wired: true`) — its `sla_policy` row sets `escalation_ladder_id` directly at seed time (the
  known gotcha already solved once for `snag_sla_policy`: `seedEscalationConfig`'s own backfill
  only touches rows that exist at that exact moment, so a rule seeded after boot must set the
  column itself).

**Template approval.** Purpose-conditional dual approver: `PAYMENT_REMINDER`/`DELAY_NOTICE`
require LEGAL; every other purpose is approved by CRM-lead (CRM role), per rule 3's text. The
spec's prose also names "cancellation" as legal-bearing, but the Data table's own `purpose` enum
has no `CANCELLATION` value — flagged as `LEGAL_BEARING_PURPOSES`'s own comment rather than
inventing an enum value the schema doesn't name.

**Known gaps, flagged not faked.**
- `sendCommunicationEmail` originally called `mailer.send` before the `communication` insert;
  advisor caught that a failed insert (bad customer/booking id) would leave a real email sent with
  no logged row, violating rule 1. Fixed: insert (+ event) happens first inside `withTx`, mail
  goes out last — `mailer.send` isn't a DB call so it's safe inside the open transaction.
- Rule 4's frequency guardrail only runs when a `template_id` is given — a free-text send with the
  same reminder copy pasted in bypasses the cap. Defensible (there's no `purpose` to cap against
  without a template) but a real gap; not fixed this pass.
- `customer_query_48h`'s `wired: true` flip only reaches a fresh DB. `seedEscalationConfig` early-
  returns once any `escalation_ladder` row exists, so an already-booted dev/demo DB keeps the old
  `wired: false` value — same shape as the migration-vs-seed-order gap already documented for spec
  08. Not worth a one-off data migration at demo scale; noted here for whoever next touches
  escalation seeding.

**Test coverage.** 14 tests in `communications.test.ts`, all real end-to-end behavior, not
shape-only: rule 6's test drives `scanEscalations` with a controlled `asOf` 49h after logging an
inbound follow-up and asserts a genuine `escalation` row (`rule_key='customer_query_48h'`,
`category='REPUTATION'`) — proving the SLA clock actually fires, not just that a due date gets
set. Rule 4's guardrail test sends 3 real emails then asserts the 4th is blocked, then proves the
CRM-lead override path and that SALES can't self-override. Event-registry coverage test requires
literal `type` strings in test-file source, not just indirect exercise, satisfied via explicit
`db.query` assertions on the `event` table at each of the 4 newly-`built:true` event points.

**Cross-spec follow-through.** Landing 29 turned spec 28's Customer 360 / Booking 360
"Communications" tab from a `notYetAvailable` placeholder into a real endpoint
(`/api/customers/:id/communications`) — updated `customer-360.ts`, `booking-360.ts` and their
`views.test.ts` assertions accordingly, per 28's own manifest design ("degrades to placeholder
until 29 lands").

**Verification.** `npx tsc --noEmit` clean. Full suite: 94/95 files, 676/682 in one run — the one
failing file (`registration/registration.test.ts`, untouched by this build) passes 6/6 in
isolation; failures were `Error: Worker exited unexpectedly` timeouts, the same Windows
vitest worker-pool contention already diagnosed and documented earlier this session, not a
regression from this spec.

## Depends on / Feeds
Depends on 01, 03, 10, 12, 22 (merge fields), 26. Feeds 13 (source of commitments), 31 (summary/sentiment), 27 (experience KPIs).

## Files
`services/api/src/communications/**`, `services/api/migrations/0026_communications.sql`, `apps/workspace/src/pages/customer/Communications*.tsx`, `apps/workspace/src/components/InternalNotes.tsx`, Studio tabs.

## Not in this feature
WhatsApp/SMS vendor APIs; AI summaries (31).

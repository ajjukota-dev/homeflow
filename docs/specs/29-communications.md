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

## Depends on / Feeds
Depends on 01, 03, 10, 12, 22 (merge fields), 26. Feeds 13 (source of commitments), 31 (summary/sentiment), 27 (experience KPIs).

## Files
`services/api/src/communications/**`, `services/api/migrations/0026_communications.sql`, `apps/workspace/src/pages/customer/Communications*.tsx`, `apps/workspace/src/components/InternalNotes.tsx`, Studio tabs.

## Not in this feature
WhatsApp/SMS vendor APIs; AI summaries (31).

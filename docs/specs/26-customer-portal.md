# 26 — Customer portal: My Pranava Home

## Purpose
p18–19 §11–12. Areas: **Journey, My Home, Payments, Documents, Registration, Handover, Requests** (service requests **and** customisations: raise, view quotations/drawings, approve), **Commitments, Home Passport**. Visibility rule verbatim (p18 §11): "show commitments, milestones, actions required from customer, approved dates and final evidence. Do not show internal blame, employee performance, vendor disputes, internal notes or unapproved forecasts." Moments that matter (p19 §12): booking + 24 h welcome, agreement, payment confirmations, construction milestones, customisation decisions, registration, handover, 7/30/90-day check-ins. "A customer opens My Pranava Home and understands their journey" (p33 §29). Existing `apps/my-pranava-home` (read-only, one hardcoded booking, T2–T6 projections) is the base.

## Data
| Table | Columns |
|---|---|
| `customer_visibility_rule` | `entity ∈ {STAGE, TASK, COMMITMENT, DOCUMENT, DEMAND, SNAG, CHANGE_REQUEST, SCORE, DATE}`, `field`, `visible bool`, `customer_wording` (per project override) — Policy Studio "customer visibility & wording" |
| `customer_update` | `id`, `booking_id`, `kind ∈ {MILESTONE, DATE_PUBLISHED, MESSAGE, DOCUMENT_READY, PAYMENT_CONFIRMED, CHECK_IN}`, `title`, `body`, `published_by` (CRM), `published_at`, `source_event_id`, `status ∈ {DRAFT, PUBLISHED}` |
| `customer_check_in` | `booking_id`, `kind ∈ {DAY_7, DAY_30, DAY_90, DLP_CLOSE}`, `sent_at`, `responded_at`, `score int` (1–5; validated PR #4), `comment`, `follow_up_action_id` |
| `portal_projection` (query layer) | per booking: the customer-safe view assembled from 06 (customer layer), 19 (schedule/receipts/TDS), 22 (documents), 23, 16, 18, 13 (customer-facing only), 30 |

## Rules
1. Identity: customer logs in (01) → bookings they are applicant on; chooser if several; every API call scoped to `customer_login.booking_id` set; 404 outside.
2. **Projection, not permission**: the portal API never returns raw internal rows; a projection function per area maps internal data to customer fields and applies `customer_visibility_rule`; property-based test: no output key from a denylist (`owner_user_id`, `reason_code`, `root_cause`, `vendor`, `contractor`, `internal_note`, `forecast_*` unless published, `driver` text naming staff) — p18 §11; p31 §26 "Customer-facing information never exposes internal notes or unapproved assumptions"; p47 §34.7 t9.
3. Dates: only **approved/published** dates show (plan dates flagged `customer_visible` by CRM publish, handover appointment, registration slot). Forecasts show as ranges ("Expected Oct–Nov 2026") only when CRM publishes; otherwise "Date to be confirmed".
4. Journey area = 06 customer layer: stages with `customer_name`, status in customer words (On track / In progress / Completed / Needs your action), what's next, actions required from the customer (10 `customer_visible`) with upload/confirm controls.
5. Payments (19): schedule with trigger wording ("Upcoming — after flooring is verified"), dues, receipts (verified as "Received"; pending as "Received — being verified"), TDS status, loan summary (21), statement PDF (22). No online payment.
6. Documents (22): required-from-you (upload), for your review (drafts with comments), executed finals (download, checksum shown). Registration (23): what's needed, slot confirm, deed. Handover (16): appointment slots confirm/reschedule (reason), checklist summary after completion, possession letter.
7. Requests (18 + 30): raise customisation (only customer-visible categories with state labels: "Open", "Closing soon — by ~date", "Not available"), see feasibility outcome in customer wording, quotation view + accept/decline, drawing revisions (released only), status; service requests post-handover (30). Snags raised at walkthrough (15) and their fix status.
8. Commitments (13): customer-facing only — description, promised date, status (Committed / Delivered / Delayed — new date …), never root cause or owner.
9. Home Passport (30): equipment, serials, manuals, warranties, as-built spec (09), service history.
10. Moments that matter: system creates a DRAFT `customer_update` from events (p19 §12 list); CRM publishes (edits allowed) — never auto-published, never AI-sent (p32 §27); published updates appear in the portal feed and trigger an email (03 mailer) per preference. Check-ins (7/30/90 after handover, DLP close) are portal prompts + email; score 1–5 + comment; low score (≤2) → CRM action (10).
11. Language English; copy in `apps/my-pranava-home/src/copy.ts`, no lorem; brand-neutral tokens; WCAG AA; mobile-first (375) since customers use phones.

## API (all under `/portal`, session-scoped)
`GET /portal/me` · `GET /portal/bookings/:id/overview` · `/journey` · `/payments` · `/documents` (+ `POST …/upload`) · `/registration` (+ confirm) · `/handover` (+ appointment confirm/reschedule) · `/requests` (+ `POST` raise; quotation accept/decline; service request) · `/commitments` · `/passport` · `/updates` · `POST /portal/check-ins/:id`.
CRM side: `GET /bookings/:id/customer-updates`, `POST /customer-updates/:id/publish`, `PUT /customer-visibility-rules` (Studio).

## Screens (portal)
Home (next action + latest update + journey strip) · Journey · My Home (unit, hierarchy, as-built spec, drawings) · Payments · Documents · Registration · Handover · Requests · Commitments · Home Passport · Profile (contact prefs, password). Empty/loading/error states everywhere; skeletons.
Workspace: CRM → Customer updates queue (drafts from events, edit, publish), Visibility & wording Studio tab.

## Events
`customer_update.drafted/published`, `check_in.sent/responded`, `customer.action_completed`, plus 18/23/16 events raised via portal actions carry `actor_kind = CUSTOMER`.

## Config
visibility rules, customer wording per stage, check-in schedule, update templates.

## Acceptance
p18 §11 every area renders from seeded data (Playwright at 375/768/1440) · visibility denylist property test (rule 2) · p47 §34.7 t9 · p31 §26 customer bullet · p19 §12 moments: each listed moment has a drafted update in tests · rule tests 1–11.

## Depends on / Feeds
Depends on 01, 06, 10, 13, 15, 16, 18, 19, 21, 22, 23, 30, 09. Feeds 27 (customer health inputs), 31.

## Files
`services/api/src/portal/**` (replace `transparency.ts`, `customer.ts`), `services/api/migrations/0024_portal.sql`, `apps/my-pranava-home/src/**` (all pages), `apps/workspace/src/pages/crm/CustomerUpdates*.tsx`, Studio tab.

## Not in this feature
Payment gateway; chat; native app; multilingual.

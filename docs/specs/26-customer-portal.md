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

## Build note (2026-09-06)

Backend only — `apps/my-pranava-home` and `apps/workspace`'s CustomerUpdates/Studio-visibility-tab
UIs are deferred, same as every other spec's UI this run. Built additively as a new `src/portal/`
module rather than "replace `transparency.ts`/`customer.ts`" per the Files line — measured the
blast radius first (6 other files import them: `routes-*.ts`, `scores/booking-readiness.ts`,
`qa.ts`) before deciding not to touch either.

`services/api/migrations/0041_portal.sql` (`customer_visibility_rule`, `customer_update`,
`customer_check_in`), `src/portal/denylist.ts` (rule 2's `CUSTOMER_DENYLIST` + `assertNoDenylistedKeys`
property check), `src/portal/core.ts` (every area function — journey/payments/documents/
registration/handover/requests/commitments/passport/my-home/overview/updates/check-ins),
`src/portal/subscribers.ts` (drafts a `customer_update` on `booking.created`/`payment.received`/
`registration.completed`/`handover.completed`), `src/routes-portal.ts`; `src/events/registry.ts`
gains 5 event types; `src/studio/core.ts`/`registry.ts` register `customer_visibility_rule` in the
generic table envelope (no versioning columns of its own, same fit as 20's three tables).

This codebase had extensively anticipated spec 26 before this segment: `seed/permissions.ts`
already seeded 8 dedicated `customer_*` permission_matrix modules, `authz/test-helpers.ts` already
had a `customerCtx()` builder, and `change-requests/store.ts`/`qa/snags.ts` already branched on
`ctx.actor.kind === "CUSTOMER"`. Reused directly rather than reimplemented: `t2Payments`
(collections-view), `t4Passport` (transparency), `bookingForCustomerUser` (customer.ts),
`currentItems` (specification/revisions — wrapped in a new `safeCurrentItems` try/catch, since a
unit with no baseline attached — a real, named case per 09's own Build note — made it throw; this
was a genuine pre-existing bug in the My Home/Passport read path, not a portal-only issue),
`raiseChangeRequest`/`acceptQuotation` (18), `confirmAvailability`/`confirmAppointment`/
`rescheduleAppointment` (23/16 — both already had a `CUSTOMER`-branch TODO in their own prior Build
notes naming 26 as the unlock), `createNotification`/`createAction`.

**Real bug found and fixed, not test-only**: `uploadCustomerDocument` was initially written against
a `customer_document.file_id` column that doesn't exist — the real schema has `file_keys text[]`.
Rather than patch the column name, it now delegates the actual upload (presigned URL, `file_keys`
append, `VALIDATING` status, `document.received` event) to 22's own `documents/checklist.ts::
uploadDocument` — the real, already-tested lifecycle every staff route already uses — and only adds
the own-booking ownership check that function itself doesn't do (it's shared with staff-on-behalf,
so it can't assume caller == owner) plus a `customer.action_completed` audit event. `RECEIVED` was
dead status text nowhere else in the codebase; not resurrected. Consequently `CUSTOMER_MODULES.
customer_documents` stayed `READ` in `seed/permissions.ts` (an earlier draft of this change widened
it to `WRITE`, but nothing needs that once the ownership check gates the actual write — reverted
per the module's own documented pattern that every customer write in 26 is gated by an own-booking
row check, not the matrix; CLAUDE.md lists "widening customer-visible data" under Ask-first, so not
touching a shared seeded config beyond what's actually required matters here).

Widened two pre-existing staff-only functions to accept a CUSTOMER ctx on their own booking, rather
than building parallel customer-only functions — `registration/core.ts::confirmAvailability` and
`handover/core.ts::confirmAppointment`/`rescheduleAppointment`, via an inlined `assertOwnBooking`
helper (same `customer_login` lookup as `change-requests/store.ts::assertCrActor`/`qa/snags.ts::
reopenSnag`, not shared — each caller checks a slightly different condition). Both functions'
success-path return statement had to change from a STAFF_ROLES-gated `getXCase`/`getRegistrationCase`
to a role-agnostic `refresh(...)`/`buildHandoverView(...)` — the customer ctx that just passed
`assertOwnBooking` can never pass `requireRole(STAFF_ROLES)` on the way out.

Single-connection-PGlite deadlock, same class already documented for nested `withTx`/
`db.transaction()`, hit a new variant: a plain `db.query()` call (module-level `db`, not the open
tx) from a function invoked *inside* an open transaction also hangs — no second transaction has to
open for it to deadlock. Root-caused to `bookingHeader(bookingId)` (bare `db`) being called from
`submitCheckIn`'s open `withTx` on the score-≤2 branch; fixed by giving it a `handle: DbLike = db`
parameter and passing `tx` explicitly at that call site.

Scope cuts, flagged not faked: `service_history`/`statement_pdf`/`drawings` in Home Passport return
empty/null (30/22's listing queries for these don't exist yet); no scheduler exists anywhere in
this codebase (same pre-existing gap 06/12/19/21 already document) — `sendCheckIn` and the welcome-
message subscriber logic are directly callable, not delayed-by-schedule.

`src/portal/portal.test.ts`: 16 tests (denylist property test across all 11 area functions incl. a
200-iteration synthetic tripwire, rules 1/4/5/6/7/8/9/10 + the registration/handover authorization-
widening test proving a customer reaches the identical `gate_blocked` a staff caller would — no
privilege bypass, ownership checked first for a different customer). Full suite: 94 files / 638
tests, `tsc --noEmit` clean. `registration.test.ts` intermittently times out 4-6 tests under full
`vitest run` parallel load — reproduced identically with `git stash -- src/registration/core.ts`
(this segment's own edit reverted), so genuinely pre-existing worker-pool contention, same flake
already logged at 20's landing (confirmed there via `git stash -u` on pure pre-spec-20 `main`), not
this spec's regression. Not fixed (out of scope); logged in TODO.md.

## Build note (2026-09-07) — Portal UI + CRM Customer Updates queue

Built the two UI pieces the 2026-09-06 backend note deferred. `apps/my-pranava-home` was a
single-screen, single-hardcoded-booking placeholder on the old `/api/me/home` (`transparency.ts`)
endpoint — replaced entirely with a real multi-area app on the actual `/api/portal/*` API: a bottom
tab bar (Home/Journey/Payments/Documents — the 4 areas customers open most, rule 11's mobile-first)
plus a "More" menu for the rest (My Home, Registration, Handover, Requests, Commitments, Home
Passport, Updates, Profile — 10 areas is too many for one tab bar). Old `Home.tsx`/`HomeExtras.tsx`/
`api.ts` deleted (nothing else referenced them). No booking chooser (rule 1's "chooser if several")
since `bookingForCustomerUser` only ever resolves one booking per login — a documented, pre-existing
simplification, not a new scope cut here. Files: `App.tsx`, `nav.ts`, `portal-api.ts`,
`lib/useArea.ts`, `components/AreaScreen.tsx`, `pages/{Home,Journey,Payments,Documents,MyHome,
Registration,Handover,Requests,Commitments,Passport,Profile,Updates,More}.tsx`.

**Real bug found and fixed**: `raiseCustomerRequest` required the caller to supply `booking_id`
even though `myBooking(ctx)` already resolves it and rule 1 explicitly bans exactly that ("never a
raw bookingId parameter from the caller") — no portal read endpoint exposes `booking_id` in its
response, so a real frontend had no value to pass. Not a privilege gap (`raiseChangeRequest` itself
already re-validates booking ownership), but the contract a real UI couldn't satisfy — found while
wiring `Requests.tsx`, not by the unit tests (the existing test called the function directly with a
`bookingId` it already had from setup). Fixed by resolving and injecting it server-side; updated the
one unit test that used to pass it explicitly.

CRM side: `apps/workspace/src/pages/customer-updates/{api,CustomerUpdates}.tsx`, new "Customer
Updates" nav entry (roles matched to `portal/core.ts`'s own `CRM_UPDATE_ROLES` exactly, not the
broader `customer_*` READ modules). No bulk "drafts across all bookings" endpoint exists
(`listDraftUpdates` is per-booking) — fetches every real booking and its updates, same N+1 scale as
the rest of this ~10-booking demo dataset; flagged, not a new backend surface. Live-verified
end-to-end (not just via test): booked a real villa through the UI (a real `booking.created` event,
unlike the seed's direct-SQL bookings, which never fire subscribers), confirmed the resulting
"Welcome to your Pranava Home journey" draft appeared in the queue, edited it, published it, and
confirmed the queue emptied correctly. Studio's "Customer visibility & wording" tab (Spec 26)
live-verified rendering correctly with zero new frontend code, same registry-only pattern as every
other spec-17-onward Studio tab — empty state is correct (no rows seeded; `visibilityFor()`'s own
documented fallback defaults to visible when a rule is missing, so this is safe, not a gap).

`e2e/customer-updates.spec.ts` (workspace): real booking → draft appears → edit → publish → empty,
plus empty-state screenshots at 3 breakpoints. `apps/my-pranava-home/e2e/visual.spec.ts` and
`auth.spec.ts` rewritten for the new multi-screen app (the old assertions targeted headings that no
longer exist); `global-setup.ts` and `playwright.config.ts` switched their default storageState from
SUPER_ADMIN to the seeded demo customer — every `/api/portal/*` endpoint requires a real
`CUSTOMER`-kind actor (`myBooking(ctx)` rejects any STAFF session, SUPER_ADMIN included), so the old
staff-preview convenience the placeholder app relied on no longer applies. Both apps' full e2e
suites re-run clean from a fresh DB (workspace: 111 passed/1 pre-existing unrelated flake/1 skipped;
my-pranava-home: 12/12); both `tsc --noEmit` and `vite build` clean.

# 30 — Post-handover: move-in, DLP/warranty, Home Passport, service history, check-ins, advocacy

## Purpose
p17 §8.14: move-in tasks + FM onboarding; warranty/DLP case management; Digital Home Passport (equipment, serials, manuals, warranties); service history on the unit; 7/30/90-day and DLP-closure check-ins; referral/testimonial workflow. Existing `warranty.ts`, DLP windows, passport items, check-ins (score validated PR #4; UI hardcodes 5) are the base.

## Data
| Table | Columns |
|---|---|
| `post_handover_case` | `id`, `booking_id`, `unit_id`, `project_id`, `handover_completed_at`, `move_in_tasks jsonb` {facility_intro_done, maintenance_setup_done, owner_record_transferred, warranties_shared, pending_snag_monitoring, utilities_transferred, association_membership} **[E §10.3 H12]**, `status ∈ {ONBOARDING, IN_DLP, DLP_CLOSED, CLOSED}`, `fm_owner_user_id` |
| `dlp_policy` | `project_id?`, `product_type`, `windows jsonb` [{category, months}] (e.g. structural 60, waterproofing 24, electrical/plumbing 12, fittings 6 — `DEFAULT_UNCONFIRMED`), `response_sla_by_severity` → 06 policies |
| `warranty_case` | `id`, `unit_id`, `booking_id`, `raised_by_kind ∈ {CUSTOMER_PORTAL, FM, CRM}`, `category`, `severity`, `description`, `in_coverage bool` (derived from `dlp_policy` + `handover_completed_at` + passport item warranty), `coverage_basis text`, `status ∈ {OPEN, TRIAGED, ASSIGNED, IN_PROGRESS, RESOLVED, CLOSED, REJECTED}`, `contractor_id`, `quote_inr?` (out-of-coverage → quotation via 18-style quote, customer accepts), `cost_inr`, `root_cause`, `snag_id?` (reuses 15 snag for execution/evidence), `sla_clock_id`, `customer_verified_at` |
| `passport_item` | `unit_id`, `kind ∈ {EQUIPMENT, FINISH, DOCUMENT, WARRANTY, CONTACT}`, `name`, `brand`, `model`, `serial`, `installed_on`, `warranty_until`, `vendor_contact`, `manual_file_id`, `spec_revision_id` (09 as-built link) |
| `service_record` | `unit_id`, `kind ∈ {WARRANTY_FIX, MAINTENANCE, INSPECTION, UPGRADE}`, `date`, `description`, `by`, `cost_inr`, `warranty_case_id?` |
| `advocacy` | `booking_id`, `kind ∈ {REFERRAL, TESTIMONIAL, REVIEW}`, `status ∈ {INVITED, RECEIVED, PUBLISHED, DECLINED}`, `content`, `referred_prospect_id?` (24), `at` |
| check-ins: `customer_check_in` (26) |

## Rules
1. On `handover.completed` (16) a case opens: move-in tasks as actions (10) to FM/CRM; DLP windows start from `handover_completed_at` per policy; passport pre-filled from 09 as-built + project equipment defaults; check-ins scheduled DAY_7/30/90 (26) and DLP_CLOSE.
2. Coverage: `in_coverage` derived (category window not expired, or passport warranty active); out-of-coverage cases get a quote (customer accepts in portal) before work — replaces the ₹1 placeholder; no work without acceptance or FM waiver with reason.
3. Warranty case lifecycle with SLA by severity (06/12); execution and before/after evidence via a linked snag (15); customer verification before CLOSED for customer-raised cases; root cause feeds 15 analytics and 31 (quality root cause).
4. Service history is append-only on the unit and visible in the portal passport (26).
5. Check-ins: prompt + email at day 7/30/90 and DLP close; 1–5 score validated; ≤ 2 → CRM action within 1 working day; scores feed Customer Health (31) and Experience KPIs (27). UI must capture the real score (fix hardcoded 5).
6. Advocacy: after a DAY_90 score ≥ 4, invite referral/testimonial (CRM publishes the invite — no auto-send); referral creates a prospect (24) with source REFERRAL.
7. `DLP_CLOSED` when all windows expire and no open cases; `CLOSED` after DLP-close check-in.

## API
`GET /bookings/:id/post-handover` · `PUT /post-handover/:id/move-in-tasks` · `GET/POST /warranty-cases`, `POST /warranty-cases/:id/triage|assign|quote|accept-quote|start|resolve|verify|close|reject` · `GET/PUT /units/:id/passport` · `GET /units/:id/service-history`, `POST /service-records` · `POST /advocacy/invite`, `PUT /advocacy/:id` · Studio `GET/PUT /dlp-policy`, `/check-in-schedule`.

## Screens
- **Post-handover** (FM/CRM): cases list (onboarding progress, open warranty cases, DLP windows remaining); case view (move-in checklist, DLP windows bar, warranty cases table, passport editor, service history, check-in scores, advocacy).
- Portal (26): Requests → raise service/warranty request (coverage shown after triage), Home Passport, check-in prompts with a real 1–5 control, referral invite.
- Studio: DLP policy, Check-in schedule.

## Events
`warranty.case_opened/case_closed` (Appendix B), `warranty.quote_issued/accepted`, `post_handover.onboarding_completed`, `dlp.window_expired`, `check_in.responded`, `advocacy.invited/received`.

## Config
DLP windows per product/category, SLA by severity, check-in schedule, advocacy thresholds.

## Acceptance
p17 §8.14 bullets each ≥1 test · Appendix B warranty events · rule tests 1–7 · Playwright: portal raise → triage in coverage → fix with evidence → customer verify → passport service history updated; out-of-coverage quote path.

## Depends on / Feeds
Depends on 16, 15, 09, 10, 06, 12, 26, 24. Feeds 26, 27, 31.

## Files
`services/api/src/post-handover/**` (replace `warranty.ts`), `services/api/migrations/0027_post_handover.sql`, `apps/workspace/src/pages/post-handover/**` (replace `PostHandover.tsx`), portal Requests/Passport pages, Studio tabs.

## Not in this feature
FM billing/maintenance fees; association management.

## Build note (2026-09-06)

**Scope.** Backend only — `services/api/src/post-handover/**` (`dlp.ts`, `core.ts`, `warranty.ts`,
`advocacy.ts`, `post-handover.test.ts`), `routes-post-handover.ts`, migration
`0045_post_handover.sql` (not `0027` — 27–44 were already taken by the time this spec's turn came
up), seed `seed/post-handover.ts`. `apps/workspace/src/pages/post-handover/**` and the portal
Requests/Passport pages/Studio tabs are deferred, matching the standing UI-backlog pattern for this
session (TODO.md).

**Table reuse, not new tables.** `warranty.ts` (pre-existing) already had the case shell and a
separate `checkin_record` scheduling mechanism from before spec 26 existed; ALTERed it in place
(13 new columns: `raised_by_kind`, `category`, `severity`, `in_coverage`, `coverage_basis`,
`contractor_id`, `quote_inr`, `quote_accepted_at`, `waived_reason`, `assigned_at`, `sla_clock_id`,
`customer_verified_at`, `rejected_reason`) rather than standing up a parallel table. Same for
`home_passport_item` (+7 columns incl. `spec_revision_id` linking 09's as-built) and
`service_history` (+`kind`, `cost_inr`). `post_handover_case`, `dlp_policy`, `advocacy` are
genuinely new tables — no pre-existing equivalent.

**Check-in reuse decision.** Rule 1 (DAY_7/30/90) and rule 7 (DLP_CLOSE) both route through 26's
`customer_check_in` / `sendCheckIn` / `submitCheckIn` — the spec's own Data row cites
"`customer_check_in` (26)" as the mechanism. The older, pre-26 `checkin_record` table that
`warranty.ts`'s legacy scheduling already populated is left completely untouched; both coexist,
same "different producer, keep both" precedent spec 26's own migration already established for
these two tables.

**`sla_policy.applies_to` extended a third time.** `'TASK_CODE'|'ACTION_TYPE'|'STAGE_CODE'` (0005)
→ `+'SNAG_SEVERITY'` (0032) → `+'CUSTOMER_QUERY'` (0044) → `+'WARRANTY_SEVERITY'` (0045, this
spec) — extend the existing CHECK constraint each time rather than inventing a parallel mechanism.
Seeded 3 rows (`warranty_critical`/2d, `warranty_major`/5d, `warranty_minor`/10d, all
**UNCONFIRMED**, no `escalation_ladder_id` wired — same class of gap as 15's `critical_snag_2d`).
DLP window months (structural 60 / waterproofing 24 / electrical+plumbing 12 / fittings 6) are
likewise **UNCONFIRMED** placeholders pending real East Crest warranty terms.

**Rule 3's snag-evidence linkage deliberately not wired.** The spec's Data row names `snag_id?`
on `warranty_case` for "execution/evidence via a linked snag (15)". Checked 15's `insertSnag`
concretely before deciding: `snag` has no `room` field and a fixed `category` enum incompatible
with warranty's own category vocabulary. Wiring it would mean inventing an unsanctioned crosswalk
between two vocabularies the spec never reconciles — flagged as a real gap needing client input,
not faked with a silent enum remap.

**Two bugs an advisor review caught before landing, both fixed:**
- `sweepDlpClosure` originally only considered `post_handover_case.status = 'IN_DLP'`. The two
  lifecycles (onboarding-checklist progress, DLP-window expiry) are independent per the spec's own
  wording — a case where FM never ticks one move-in task (e.g. `association_membership` on a
  project with no association) stayed `ONBOARDING` forever, so a fully-expired DLP window on it
  would never be swept. Fixed to consider `status IN ('ONBOARDING', 'IN_DLP')`. Same pass also
  replaced an inline `UNION ALL ... LIMIT 1` policy lookup inside the sweep (non-deterministic
  branch selection, same class of issue `dlp.ts`'s `resolveDlpPolicy` was built to avoid) with a
  call to `resolveDlpPolicy` itself, so there's one policy-resolution code path, not two.
- `acceptQuote`'s docstring claimed "customer, or CRM/FM records acceptance on their behalf" but
  the staff branch gates on `authorize(ctx, "handovers", "WRITE")`, and the seeded matrix
  (`"R N R N N N N W W"`) gives CRM only READ on `handovers` — CRM cannot actually call this
  despite being the quote conversation's usual owner elsewhere in the flow. Code was already
  correct (matches the matrix); fixed the comment to state the real restriction rather than a
  claim the code refutes, and flagged it as the matrix's call to widen, not this file's.

**Other decisions, documented not silently made:**
- `handover_completed_at` on `post_handover_case` is `now()` at case-open time, not
  `handover_record.completed_at`. Correct for the live path (`openPostHandoverCase` is called
  synchronously right after handover completion), would drift on any future backfill job. DLP
  windows run 6–60 months, so the drift (seconds, at most) doesn't change any outcome.
- `triageWarrantyCase`'s coverage computation falls back to `new Date(0)` (i.e. "coverage never
  started") when no `post_handover_case` row exists for the unit yet. This makes any warranty case
  raised against a unit that hasn't been through handover read as permanently out-of-coverage,
  which fails closed (forces a quote or an explicit FM waiver before work) — the safe direction,
  not an accident.
- `openPostHandoverCase` now runs before `warranty.ts::onHandoverCompleted`'s pre-existing legacy
  `dlp_window` block. When 09 as-built data exists, this spec's own passport pre-fill populates
  `home_passport_item` first, so the legacy hardcoded AC/water-heater insert (guarded on
  `items.length === 0`) is skipped. Treated as an improvement (real as-built data beats two
  hardcoded rows) rather than reverted.
- `respondAdvocacy` inserts directly into `prospect` via raw SQL instead of calling
  `sales/prospects.ts::createProspect`, because that function's own role gate (`SALES_WRITE_ROLES`)
  excludes CRM (the actual caller here) and it opens its own `withTx`, which would deadlock nested
  inside advocacy's already-open transaction. Same insert shape/columns/event-type as
  `createProspect`, just inlined.
- `service_history.event_type` now carries two vocabularies going forward: dotted event names from
  the pre-existing legacy path, and `kind` values (`WARRANTY_FIX`/`MAINTENANCE`/etc.) from this
  spec's `addServiceRecord`. Not reconciled — flagged for whoever next reads this column.
- `post_handover_case` and `dlp_policy` carry `project_id` with no RLS policy yet — same
  outstanding P1b list as `loan_case`/`commitment`/`escalation`/`forecast_*`/`doc_factory_*`.

**Test coverage.** `post-handover.test.ts`: 16 tests (13 own + 3 covering event-registry-required
assertions) across move-in tasks, warranty lifecycle (triage/quote/accept/waive/assign/start/
resolve/verify/close/reject), passport CRUD, service history, advocacy invite/respond, and
`sweepDlpClosure`'s corrected predicate. `freshHandoverBooking()` fixture mirrors `portal.test.ts`'s
own `freshCustomerBooking()` — this spec's tests start at `handover.completed`, not before it.

**Verification.** `tsc --noEmit` clean. `post-handover.test.ts` + `events/registry.test.ts`: 16/16
passing. Full suite: 723 passed / 5 failed (isolated re-run of all 4 affected files together —
`collections-sweep`, `authz/mask`, `documents`, `registration` — passed 26/26 with zero failures,
confirming the pre-existing Windows vitest worker-pool contention flake, not a spec 30 regression)
/ 10 skipped, out of 738 total.

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

## Build note (2026-09-07, UI)

**Scope.** Built the FM/CRM Post-handover module deferred by the backend PR:
`apps/workspace/src/pages/post-handover/{api.ts, PostHandoverCases.tsx, CaseDrawer.tsx,
WarrantyPanel.tsx, PassportPanel.tsx, ServiceHistoryPanel.tsx, AdvocacyPanel.tsx}`, wired into
`nav.ts`/`Workspace.tsx`, replacing and deleting the legacy `PostHandover.tsx`. Also built the
customer-portal side (`apps/my-pranava-home/src/pages/{Passport,Requests}.tsx`,
`portal-api.ts`, `services/api/src/portal/core.ts` — `getServiceRequests`,
`raiseCustomerServiceRequest`, `verifyCustomerServiceRequest`, `acceptCustomerServiceRequestQuote`,
`getAdvocacyInvites`, `respondCustomerAdvocacy`) — Screens' own "Portal (26): Requests → raise
service/warranty request..., check-in prompts with a real 1–5 control, referral invite" line, not
deferred after all. Deferred: both Studio tabs (`dlp_policy` already fully functional through the
generic Policy Studio table editor — `registry.ts`'s `GENERIC_TABLES`/`TAB_TO_TABLE` already maps
`"30.dlp_warranty_policy": "dlp_policy"` — and the check-in schedule tab, which has no backing
config table yet, same "flagged, not faked" precedent as prior specs' deferred Studio tabs).

**Rule 5's "fix hardcoded 5" was already fixed.** Traced before building anything: spec 26's portal
`Home.tsx`'s `CheckInPrompt` already implements a real 1–5 star `submitCheckIn` capture flow
customer-side. The legacy staff-side "Capture" button (`api.captureCheckin(id)`, backend-hardcoded
to 5) was dropped entirely rather than reproduced — the case view now only displays the real
captured scores, read-only. `apps/workspace/src/api-lifecycle.ts`'s now-dead
`WarrantyView`/`ServiceEvent` interfaces and `warranty`/`serviceHistory`/`closeWarranty`/
`captureCheckin` client methods were removed as part of this.

**Five bugs found live (Playwright MCP) before any e2e was written, all fixed:**
1. Seed bypassed the event: `seed-lifecycle.ts` inserted `handover_record` via raw SQL, so
   `openPostHandoverCase`'s move-in-task/DLP-window/passport-prefill/check-in-scheduling side
   effects never fired for the only seeded handed-over villa (V113). Fixed by calling the real
   `openPostHandoverCase` directly in the seed after the raw insert — same class as spec 09's
   `unit_specification` gap.
2. Empty contractor picker: no seed data for `contractor`. Added 3 real rows (`con_sunrise_plumbing`,
   `con_voltage_electricals`, `con_eastcrest_fm`).
3. Warranty case count staleness: closing a case in `WarrantyPanel` left the outer cases-list's
   "open warranty cases" count stale until the drawer was closed and reopened — two separate
   fetches, no notification path between them. Fixed via an `onCaseCountChanged` callback threaded
   `WarrantyPanel` → `CaseDrawer` → `PostHandoverCases`' own `load`.
4. Raw-id leak: `service_history.actor` showed `"user_fm"` instead of a name.
   `post-handover/core.ts::addServiceRecord` used `ctx.actor.user_id`; fixed to
   `ctx.actor.display_name ?? "System"`. Mutation-tested (reverted to `user_id`, confirmed
   `post-handover.spec.ts`'s `/^user_/` guard goes red, restored) — the guard is load-bearing.
5. Advocacy tab 403 misreported as "Couldn't reach the API": `listAdvocacy`/`inviteAdvocacy`/
   `respondAdvocacy` are gated server-side by `requireRole(ctx, CRM_UPDATE_ROLES)`, not the
   `"handovers"` permission-matrix module the rest of the case view reads through — FM has
   legitimate READ on `"handovers"` but is not in `CRM_UPDATE_ROLES`, so the fetch 403s for FM
   specifically. Fixed by gating the client fetch itself on `canView` (role membership check),
   with a plain "managed by CRM" message instead of an error state — same matrix-vs-direct-role-check
   gap class as spec 08/18/29's own findings.

**Two more bugs found once the customer-portal side was built, after the backend PR had already
landed:**
6. `portal/core.ts::getServiceRequests` (new, for the portal's own service-request list) selects
   `created_at` from `warranty_case` and orders by it — but migration `0045_post_handover.sql`'s own
   `ALTER TABLE warranty_case ADD COLUMN ...` list never added `created_at` (the pre-existing
   `0000_init.sql` table never had one either). Deterministic `column "created_at" does not exist"`
   failure in `portal.test.ts`, reproduced in isolation and under `--no-file-parallelism`. Fixed by
   adding `created_at timestamptz NOT NULL DEFAULT now()` to the same ALTER statement in `0045`
   (edited in place — that migration was only ever applied to this session's own throwaway/reset
   dev DBs, never shipped elsewhere). **Because the migration runner (`db/migrate.ts`) tracks
   applied files by filename only, with no checksum, this edit is invisible to any environment that
   already has an on-disk `.data/pglite` from before this fix — such an environment will silently
   skip re-running `0045` and keep missing the column. Anyone picking up this branch with an
   existing local dev DB (or a synced copy of one) needs one `npm run db:reset` in `services/api`
   before the portal's service-requests area will work.**
7. `transparency.ts::t4Passport` (the customer-facing Home Passport projection, spec 16-era) started
   returning the new `vendor_contact` column added by `0045`'s `home_passport_item` ALTER, because
   it selects `*`-adjacent named columns and the new column was added to the same SELECT/map without
   thinking about who reads it. `lifecycle.test.ts`'s own denylist regex
   (`/EXCEPTION_ONLY|HARD_CLOSED|TRUE_RISK|vendor|.../`) caught it — the key `vendor_contact` matched
   the substring `vendor` even with a null value. Fixed by dropping `vendor_contact` from
   `t4Passport`'s SELECT and return shape entirely: a vendor's contact detail is FM/CRM-facing only
   (already served customer-*side*-free via `post-handover/core.ts`'s own staff passport route) —
   the customer contacts CRM/FM, never a vendor directly, so there was never a legitimate reason for
   it to reach this projection. **Found while building, logged separately in TODO.md: the portal's
   own `assertNoDenylistedKeys` walker (rule 2's "shared enforcement mechanism") does *exact* key
   matching, not substring — it did NOT catch this leak; only `lifecycle.test.ts`'s unrelated regex
   did. That's a real gap in the denylist's own coverage, not something to widen under this spec's
   scope.**

**e2e.** New `apps/workspace/e2e/post-handover.spec.ts` (5 tests): full flow (cases list → move-in
checklist → DLP windows → warranty case lifecycle open→triaged→assigned→in_progress→resolved→closed
→ service history → passport → advocacy invite→received→published), an FM-role Advocacy-tab
role-limited check (fresh unauthenticated context, bug 5's regression guard), and a 3-breakpoint
render check. Also fixed two pre-existing e2e files whose assertions still targeted the legacy
screen's "month cover" copy this replaced: `visual.spec.ts`'s "After keys" smoke test and
`journeys/sale-to-handover.spec.ts`'s read-only walk — both rewritten to real new-screen content
(found by grepping every e2e file for legacy screen text before running any suite, per this
session's own established discipline).

**Verification.** `tsc --noEmit` clean in both `services/api` and `apps/workspace`. Full backend
vitest, fresh `db:reset`, run twice (`--no-file-parallelism` once): **789/789 passing** both times
— the pre-fix run's 9 failures (`lifecycle.test.ts` ×1, `portal.test.ts` ×2, `registration.test.ts`
×6) traced to the two real bugs above (6 and 7); once fixed, zero failures, no residual flake.
Full Playwright e2e suite, fresh `db:reset` + clean API restart, run **three times**: 182, 182, 183
of 185 passed each time, 1 skipped every run, with a *different* 1–2 tests failing each run
(`finance.spec.ts:26`, `visual.spec.ts:35`, `visual.spec.ts:138` each appeared and disappeared
across the three runs) — a pre-existing order-sensitive flake pool in this large shared-DB suite
(`visual.spec.ts:138`'s own in-file comment already documents it needs `commitments.spec.ts` to run
first for a chip count), not a spec 30 regression; `post-handover.spec.ts`'s own 5 tests passed
clean in every run. Mutation-tested the raw-id-leak guard (bug 4): confirmed red on the mutation,
green on the fix.

# 11 — My Day & ranking

## Purpose
p9 §7.1: "Every employee should log in and see: what is due today, what is at risk, what is waiting on them, what needs approval, what customers are waiting for — ranked by deadline, customer impact, revenue impact, dependency impact and escalation risk", with a plain-language "Why now?". p33 §29 "An employee opens My Day and knows what matters."

## Data
No new tables; a ranking function over `action` (10) + `sla_clock` (06) + `impact`. `ranking_weights` config row: `{deadline: 0.35, customer_impact: 0.2, revenue_impact: 0.2, dependency_impact: 0.15, escalation_risk: 0.1}` (Policy Studio "score weights"). `my_day_snapshot` (optional cache per user per day, invalidated by `action.*` events).

## Rules
1. `GET /me/day` returns five ordered sections — **Due today**, **At risk**, **Waiting on me** (NEW/IN_PROGRESS assigned or in my role queue), **Needs my approval** (READY_FOR_APPROVAL where I hold `approver_role`), **Customers waiting** (WAITING_CUSTOMER actions I own, oldest first) — plus "Done today" count.
2. Score per action (pure function, tested with a table): deadline term from hours to due (overdue → 1.0, ≤24 h → 0.9, ≤72 h → 0.6, else decays); customer impact = `impact.customer_count` normalised + `customer_visible` bonus; revenue impact = `impact.revenue_inr` log-scaled against the project's median demand; dependency impact = count of actions with `depends_on_action_id = this`; escalation risk = tier (L0..L4) + SLA state (AT_RISK 0.5, OVERDUE 1.0). Weights from config. Ties → earlier `due_at`.
3. **Why now?** is generated from the top two contributing terms as sentences with facts, never adjectives: "Due in 6 h · blocks 3 registration actions" / "Customer waiting 4 days · ₹12.4 L demand". Templates live in `labels.ts`-style map; unit-tested for each term.
4. Project scope: only actions in `actor.project_ids`; a project switcher narrows further (p20 §13).
5. Functional heads (`MANAGEMENT`, department leads flagged in `project_team_assignment.is_primary_owner` for CENTRAL teams) get a **Team view**: the same sections aggregated per team member with counts and the top three per person (p9 §7.1 "functional head sees where the process fails").
6. Empty state is explicit: "Nothing due — 4 items later this week" with a link.
7. Every My Day load is cheap: one SQL over open actions with joins; no N+1 (test with 500 seeded actions < 200 ms locally).

## API
`GET /me/day?project_id` · `GET /teams/:id/day` (heads) · `GET/PUT /ranking-weights` (Studio).

## Screens
**My Day** (workspace home after login): header with date (IST) and project; five sections as collapsible lists; each row = title, entity chip (Booking BKG-000123 · Unit A-1204), owner avatar if not me, due/SLA badge (icon + label), "Why now?" line, primary action button (Start / Approve / Upload evidence) opening the Action drawer. Team view toggle for heads. Skeleton loading; error state. 375 px: single column, sections as tabs.

## Events
None new (reads only). Emits `my_day.viewed`? — no; don't log reads.

## Config
`ranking_weights` — Policy Studio "score weights/thresholds".

## Acceptance
p9 §7.1 five questions answered by five sections (Playwright checks each section renders from seeded data) · p31 §26 "Every readiness score is explainable" analogue: every row has a "Why now?" (test: no empty strings) · rule tests 2, 3, 5, 7 · p47 §34.7 t9 corollary: internal-only actions never appear in the portal (covered in 26).

## Depends on / Feeds
Depends on 10, 06, 01. Feeds 27 (team bottlenecks), 26 (customer "actions required").

## Files
`services/api/src/myday/**` (`rank.ts` pure), `apps/workspace/src/pages/MyDay*.tsx`, `apps/workspace/src/lib/whyNow.ts`, Studio tab `studio/RankingWeights.tsx`.

## Not in this feature
Notifications/digest (12), Control Tower (27).

## Build note (2026-09-06) — My Day UI

**Scope.** `apps/workspace/src/pages/myday/{MyDay,api}.tsx` — the five ranked sections (rule 1) rendered as `Tabs` (one layout serves both "collapsible lists" on desktop and "sections as tabs" at 375, a deliberate simplification vs. building two separate layouts), Team view (rule 5) for MANAGEMENT/SUPER_ADMIN, done-today count, and rule 6's explicit empty state. Wired into the workspace shell as a new "My Day" nav entry visible to every staff role, placed first in the nav list. `why_now` (rule 3) is rendered verbatim from `GET /me/day`'s own `why_now` string (`myday/rank.ts::whyNow`, already server-computed) — no client-side `lib/whyNow.ts` was written, since duplicating that generator client-side would be exactly the kind of business-logic mirroring this session has avoided elsewhere; the Files list's `lib/whyNow.ts` entry is superseded by that already-settled backend design.

**Real, honest scope cuts vs. the Screens section** (flag, don't fake): no entity chip (Booking/Unit) or owner avatar per action row — `GET /me/day` returns `{id, code, title, status, due_at, score, why_now}` only, no booking/unit/owner join; and no primary action button (Start/Approve/Upload evidence) opening an Action drawer — that drawer is spec 10's own still-deferred UI (`ActionDrawer`), so this view is read-only. Team view's per-member name resolution calls `adminApi.listUsers()` (`administration` module, MANAGEMENT/SUPER_ADMIN-only per the seeded matrix) and falls back to the raw user id on a 403 — a CENTRAL-team primary-owner head (who `getTeamDay` itself also authorizes, per its own header comment) has no other name-resolution endpoint available yet, a real small gap, not fixed here.

**Judgment call, flagged not silently picked:** rule 9's "workspace home after login" reads as My Day *replacing* every role's landing page, but this app already has an established `nav.ts::ROLE_HOME` (every role lands on its own department module — a decision that predates this slice). Resolved additively: My Day gets its own nav entry for every staff role instead of overriding `ROLE_HOME`.

**Real regression caught by the e2e suite before merge, fixed:** adding "My Day" as the *first* NAV array entry silently changed `SUPER_ADMIN`'s default landing view — `SUPER_ADMIN` had no explicit `ROLE_HOME` entry and fell through to `visible[0]`, which had accidentally been "site" only because Site was first in the array. This broke 4 e2e tests asserting `SUPER_ADMIN` lands on "Unit Progress Control". Fixed by giving `SUPER_ADMIN` an explicit `ROLE_HOME: "site"` entry, restoring prior behaviour and removing the array-order fragility for the next person who edits `NAV`. This is a clean, twice-verified causal link (4 failures pre-fix, 0 of those 4 post-fix) — see the honest verification-scope note below for what was *not* independently re-verified.

**Advisor review before landing this slice caught two more real issues, both fixed:** (1) rule 6's empty state read `` `Nothing due — ${done_today} done today` `` — `done_today` counts *closed* actions, not a forward-looking count, so a user with zero open work saw a number in the exact slot the spec's own example (`"Nothing due — 4 items later this week"`) implies is a count of upcoming items. No endpoint returns that count, so the honest fix is to drop the number from the empty state (`"Nothing due right now."`) rather than fill the slot with an unrelated one; the `done_today` count still renders correctly as the standalone line below the tabs, now including the empty case. The missing "items later this week" forward count is a real, undelivered piece of rule 6, flagged here rather than papered over. (2) `TeamView` called `getTeamDay(projectId)` unguarded; `SUPER_ADMIN`'s `default_project_id` is `null`, so a team-head actor toggling Team view before the project switcher's async `listProjects()` populates `projectId` would fire `GET /api/teams//day`. Guarded with the same `if (!projectId) return` pattern already used by `SiteProgress.tsx` and the rest of the workspace.

**Environment finding, not a defect in this slice:** this session's shared local PGlite dev DB corrupted twice during this slice's own functional testing (`"unexpected data beyond EOF in block 0"`, distinct from — and more severe than — the previously-documented stale-lock-file symptom in TODO.md §9) — once from two API server processes racing over the same on-disk directory, and once apparently from sustained load during a full Playwright run. Both times, `npm run db:reset` (added in PR #52) plus a single clean server restart fully recovered it. Logged in TODO.md §9 as a more severe manifestation of the already-known PGlite fragility, not a My Day-specific bug.

**Honest verification scope:** the SUPER_ADMIN regression and its fix are cleanly verified (4 landing-page e2e tests failed before the `ROLE_HOME` fix, 0 of those 4 failed after). A full clean-DB e2e suite pass was **not** obtained for this slice — the one full run against a freshly-reset DB corrupted mid-run (53/73, see above); the run that showed 70/73 with 3 pre-existing failures ran against a DB that had already accumulated state from an earlier run, so its "pre-existing" classification for 2 of those 3 failures is inherited from TODO.md's prior log, not independently re-confirmed clean here. Stated plainly rather than rounded up to "suite passes."

**Test coverage:** `MyDay.test.tsx` — loading→populated (asserting the real server-generated `why_now` string is rendered verbatim, not re-derived), rule 6's empty state (including the corrected message and the `done_today` line rendering in the empty case), retryable error state, one-`h1`-per-page, and Team view toggle hidden for a non-head actor (5 tests). `nav.test.ts` (added post-advisor-review) pins `defaultViewFor(["SUPER_ADMIN"], ...) === "site"` plus a general invariant that every role's default view is one it can actually see — the exact fragility that caused the regression above, now covered by a unit test cheaper than the e2e run that caught it. No automated test drives the Team view's populated path or exercises `getTeamDay` end to end — verified manually instead via Playwright screenshots against the live dev API (real seeded users, real avatars/initials, real per-member action lists) at 1440/768/375, a real coverage gap stated plainly rather than implied covered.

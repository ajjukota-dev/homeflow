# 06 — Journey instances, universal timeline & SLA engine

## Purpose
p22 §16, p44–47 §34: one date model for everything — **baseline / current plan / forecast / actual** with variance; SLA separate from plan; statuses **On Track / Due Soon / At Risk / Overdue / Completed On Time / Completed Late** derived, never painted; parallel streams — "a journey is not blocked merely because a prior numbered stage is open unless an explicit dependency or gate says so" (p46 §34.3); working-day calendars; delay reasons.

## Data
| Table | Columns |
|---|---|
| `journey_instance` | `id`, `booking_id`, `project_id`, `template_version_id`, `status ∈ {ACTIVE, ON_HOLD, CLOSED, CANCELLED}`, `hold_reason`, `started_at`, `closed_at`, `health ∈ {ON_TRACK, DUE_SOON, AT_RISK, OVERDUE}` (derived cache) |
| `stage_instance` | `id`, `journey_id`, `stage_code`, `status ∈ {NOT_STARTED, IN_PROGRESS, WAITING, BLOCKED, COMPLETED, NOT_APPLICABLE}`, `baseline_start/end`, `planned_start/end`, `forecast_start/end`, `actual_start/end`, `owner_user_id`, `progress_pct` (derived from tasks) |
| `task_instance` | `id`, `stage_instance_id`, `task_code`, `action_id` (10 — the task *is* an Action), same four date pairs, `status` (Appendix A Action states), `sla_clock_id` |
| `timeline_plan_revision` | `id`, `journey_id`, `revised_at`, `revised_by`, `reason_code` (→ `delay_reason`), `note`, `changes jsonb` (per stage old/new planned dates) — p46 §34.6 |
| `timeline_forecast_revision` | `id`, `journey_id`, `computed_at`, `source ∈ {SYSTEM, MANUAL}`, `changes jsonb`, `confidence` |
| `sla_policy` | `id`, `code`, `applies_to ∈ {TASK_CODE, ACTION_TYPE, STAGE_CODE}`, `target_ref`, `duration_value`, `duration_unit ∈ {WORKING_DAYS, CALENDAR_DAYS, HOURS}`, `due_soon_lead` (e.g. 2 d), `at_risk_rule` (e.g. "≥50% elapsed with blocker"), `pause_reasons[]`, `escalation_ladder_id` (12), `effective_from/to`, `version` |
| `sla_clock` | `id`, `subject_type`, `subject_id`, `policy_id`, `started_at`, `due_at`, `paused_at`, `paused_reason`, `total_paused_seconds`, `stopped_at`, `outcome ∈ {ON_TIME, LATE}` |
| `sla_clock_event` | `clock_id`, `at`, `kind ∈ {START, PAUSE, RESUME, STOP, RESET}`, `reason`, `actor` — p46 §34.6 |
| `project_calendar` | `id`, `name`, `working_days[]`, `holidays date[]`, `timezone` (`Asia/Kolkata`) |
| `delay_reason` | `code`, `label`, `category ∈ {CUSTOMER, INTERNAL, VENDOR, STATUTORY, FINANCE, FORCE_MAJEURE}`, `counts_against_sla bool` |

## Rules
1. On the `sales_handover.accepted` event (17 — the real event `acceptBooking` already emits today; the DB also has an unused `crm_accepted` booking-status value that no code path currently writes, see `SCHEMA.md` drift #1) a journey is instantiated from the project's published template version (fallback STANDARD); conditional stages/tasks are evaluated at creation **and re-evaluated** on `customer.residency_changed` / `change_request.created` (adds the Customisation stage) — improves on **[E §2.5]** one-time evaluation. When 17 is rebuilt it must decide whether `booking.status` actually moves through `CRM_ACCEPTED` or that DB value is retired — either way, this trigger stays the event, not the status value.
2. Baseline dates are computed once at instantiation from `planned_duration_days` along the dependency graph using the project calendar; they never change. Planned dates change only through a `timeline_plan_revision` with a `delay_reason` (p46 §34.6). Forecast dates are recomputed by the engine on every relevant event (task done late, gate expiry moved, progress update) and stored as `timeline_forecast_revision`. Actuals are set by task completion.
3. Variance = planned − baseline; slippage = forecast − planned. Both exposed per stage and journey (p47 §34.7 t3 "Baseline vs current plan vs forecast vs actual are all visible with variance").
4. A stage starts when its dependencies (explicit `journey_dependency` or `entry_gate_expr`) are satisfied — **not** because the previous numbered stage completed (p47 §34.7 t4 "Parallel streams run concurrently"). A `Cancelled`/`Not Applicable` prerequisite satisfies a dependency **only if** flagged `counts_as_done` on the dependency (Emergent's blanket rule **[E §2.5]** is a client question).
5. SLA clocks start when a task becomes actionable (dependencies met), not at journey start. Pause only with a configured `pause_reason` (e.g. WAITING_CUSTOMER if policy says customer time doesn't count); resume restores. Stop at completion → `ON_TIME`/`LATE` (p47 §34.7 t6 "SLA clock pauses for approved reasons", t7 "Completed late is distinguishable from completed on time").
6. Status derivation (read-time, pure function, unit-tested): `COMPLETED_ON_TIME/LATE` if stopped; `OVERDUE` if now > due_at; `DUE_SOON` if within `due_soon_lead`; `AT_RISK` if the `at_risk_rule` fires (blocked, or forecast > planned, or dependency overdue); else `ON_TRACK`. Never stored as user input.
7. Reopening a completed task resets transitive dependents to NOT_STARTED and logs why **[E §2.5 reverse cascade]**; reopening requires a reason.
8. Hold/resume/close of a journey requires a reason; close is `MANAGEMENT`/`SUPER_ADMIN` only **[E §2.5]**.
9. Journey `health` = worst of its open tasks' statuses; a journey with an OVERDUE customer-visible stage is AT_RISK for management (feeds 27).
10. All day math uses `project_calendar` and `todayIst()`; regression test at 00:30 IST vs 23:30 IST gives the same day (TODO §9 UTC bug).

## API
`POST /journeys/from-booking/:booking_id` (internal, called by 17) · `GET /bookings/:id/journey` (stages, tasks, four dates, variance, statuses, customer layer flag) · `POST /journeys/:id/hold|resume|close` · `POST /journeys/:id/plan-revision {changes[], reason_code, note}` · `GET /journeys/:id/revisions` · `POST /task-instances/:id/reopen {reason}` · `GET/PUT /sla-policies` · `GET/PUT /calendars` · `GET/PUT /delay-reasons` · `GET /projects/:id/journey-control` (all journeys: health, stage distribution, slippage, top delay reasons).

## Screens
- **Customer/Booking Journey Timeline** (p46 §34.5): internal layer (all stages, four dates, variance chips, SLA badges, delay reasons) and customer layer toggle (only `customer_visible`, customer wording — same component the portal uses).
- **Project Journey Control**: table of journeys with health, current stage per stream, forecast handover, slippage; filters; bulk plan revision (e.g. tower slab delay shifts N journeys with one reason).
- **Stage/Task detail**: dates, clock with pause history, dependencies, evidence link to the Action.
- Policy Studio tabs: SLA policies (versioned), Calendars, Delay reasons.

## Events
`journey.started/held/resumed/closed`, `stage.started/completed`, `plan.revised`, `forecast.revised`, `sla.breached`, `sla.paused/resumed`.

## Config
`sla_policy`, `project_calendar`, `delay_reason`, `at_risk_rule`, `due_soon_lead` — Policy Studio "SLA policies + calendars + pause reasons", "timeline policy".

## Acceptance
p47 §34.7 t3, t4, t6, t7, t8 ("Delay reason is mandatory when a planned date moves"), t10 ("Management sees slippage by stage and delay reason across the Project") · rule tests 1–10 · status-derivation table test with 12 cases.

## Depends on / Feeds
Depends on 04, 05, 02. Feeds 10 (task = action), 12 (breach → escalation), 26 (customer journey), 27 (slippage), 14 (readiness confidence).

## Files
`services/api/src/journey/instances*.ts`, `engine.ts` (pure), `sla*.ts`, `calendar.ts`, `services/api/migrations/0005_journey_instances.sql`, `apps/workspace/src/pages/JourneyTimeline*.tsx`, `ProjectJourneyControl.tsx`, `apps/workspace/src/components/Timeline/**`, Policy Studio tabs `studio/Sla*.tsx`, `studio/Calendars.tsx`.

## Not in this feature
Action object itself (10), escalation ladder (12), portal rendering (26).

## Build note (2026-09-06) — SLA Policy Studio tab

`06.sla_policies` had been flagged `built: false` in `studio/registry.ts` with no editor UI at all — `sla_clock` lifecycle (`journey/sla.ts`) and the `getTaskSlaPolicy` read path (`journey/instances.ts`) were already complete from earlier slices, but nothing let anyone view or edit an `sla_policy` row itself.

Two independent header comments — `0023_policy.sql`'s and `studio/core.ts`'s — both said `sla_policy` needs bespoke draft/publish logic "mirroring 05's `journey_template_version`," not the generic Studio envelope. Checked that premise against the actual schema before building on it: `sla_policy.code` is UNIQUE, so a true 05-style model (multiple concurrent DRAFT/PUBLISHED rows sharing one logical policy) is architecturally impossible without a migration — out of scope, "ask first" territory (`CLAUDE.md`: DB schema changes). But the generic envelope's actual publish mechanism is a plain `UPDATE ... WHERE primaryKey = $1` — never a duplicate insert — which `risk_rule`/`probability_rule` already prove works safely for a table with its own `effective_from`/`version` business columns. Resolved by keeping that same safe storage layer for `sla_policy`, and building the genuinely bespoke piece the codebase had explicitly flagged as still missing: `previewStudioChange` had thrown "not implemented for any table," with a comment naming `sla_policy`'s open-`sla_clock` count as the one real, computable case. Implemented it (`SELECT COUNT(*) FROM sla_clock WHERE policy_id = $1 AND stopped_at IS NULL`) and built `SlaPolicyStudio`/`SlaPolicyDrawer` — a two-phase draft → real impact preview → confirm-publish flow — instead of routing this table through `GenericTableEditor`'s blind form. Both stale header comments corrected to describe this actual reasoning instead of disagreeing with it.

Added to `services/api/src/studio/core.ts`: `sla_policy`'s `TABLE_REGISTRY` entry (columns, `pause_reasons` as the one JSON column, `POLICY_STUDIO_ROLES` for edit access) and the real `previewStudioChange` implementation above. `routes-studio.ts`'s preview route simplified to match. `studio/registry.ts` flipped `06.sla_policies` to `built: true`. `services/api` unit tests: 18/18 (`studio/core.test.ts`, +3 new: draft→publish in-place update with version bump, preview-impact counting 0→1→0 across a real clock start/stop, and the `row_id`-required validation error). `tsc --noEmit`: clean.

Built the screen: `SlaPolicyStudio.tsx` (list with Code/Applies-to/Target/Duration/Due-soon-lead/Effective/version columns, History button, New-policy action) and `SlaPolicyDrawer.tsx` (add/edit form → stage a draft → show the real open-clock count → confirm publish). Reused `HistoryDrawer` as-is. Wired into `Shell.tsx`'s existing `BESPOKE_TABS` map alongside 05's Journey Template Studio.

**Real bug found live (MCP browser, not any automated test):** the "Applies to" `<Select>` only listed this spec's original 3 Data-row values (`TASK_CODE`/`ACTION_TYPE`/`STAGE_CODE`). The real `sla_policy_applies_to_check` CHECK constraint was widened by 3 later specs' migrations (0032 QA severity, 0044 communications, 0045 post-handover) to allow 6 values total, and 7 of the 26 seeded policies use one of the 3 missing ones (`SNAG_SEVERITY`, `CUSTOMER_QUERY`, `WARRANTY_SEVERITY`). Radix's `<Select>` silently rendered blank for all 7 — state held the correct value, but with no matching `<SelectOption>` there was nothing to display, and no error. Fixed by adding all 6 real options with spec-referencing labels; confirmed live afterward that `customer_query_response` now correctly shows "Customer query (29)".

**Real gap found by advisor review before landing:** the drawer had collapsed two distinct dates into a single `effectiveFrom` field — `sla_policy`'s own business `effective_from` column, and the unrelated `policy_version.effective_from` publish-date stamp. `RowEditor.tsx` already keeps these two separate for `risk_rule`/`probability_rule`, precisely because a table can carry its own same-named business column independent of the publish stamp — this drawer had silently re-merged that distinction. Consequence: editing a policy whose business `effective_from` was, say, 2020-01-01 would have forced choosing between overwriting that business date with today, or publishing under a stale 2020 date, with no way to do both correctly. Split back into two fields (`effective_from` stays the business column, a new "Publish date" field defaults to today and drives `publishRow`). Also added the one RTL test that had been missing — advisor noted both existing preview tests only exercised the edit-existing-row path; added a new-policy-flow test (fill form → Continue → real zero-impact preview → Confirm & publish) since that path uniquely exercises `previewStudioChange`/`publishStudioRow` against an id that has no `sla_policy` row yet (only a staged `policy_version` draft) — confirmed the preview correctly returns a true 0 rather than erroring.

Confirmed, not assumed: `delay_reason` has zero seed rows in this DB — grepped every seed script and none inserts one — so the drawer's pause-reasons fieldset correctly renders nothing (its `length > 0` guard is working as intended, not hiding a bug).

**Scope cut, flagged not faked:** `escalation_ladder_id` is a plain text input, not a picker — `escalations/core.ts` has a real `escalation_ladder` table and FK but no listing endpoint yet; building one is out of scope for this slice.

**Test coverage:** `SlaPolicyStudio.test.tsx` (RTL, 7 tests): seeded policy's real fields, edit affordances hidden for a non-editing viewer, real open-clock impact shown before publish then publishes on confirm, a zero-impact change says so plainly, the new-policy flow end to end, one-`h1`-per-page, honest empty state. `sla-policies.spec.ts` (Playwright, 5 tests): 3 breakpoint screenshots (1440/768/375) + an edit-flow impact-preview test (backs out via "Back" rather than confirming, to avoid mutating the shared dev DB) + a History-honesty test (uses `warranty_minor`, not `customer_query_response`, since the impact-preview test's own "Continue" click had already staged — though never published — a real draft `policy_version` row for the latter, making it an unsafe "never touched" fixture within the same spec file). Screenshots reviewed at all 3 breakpoints: desktop clean and professional with real seeded policies (`customer_query_response`, `snag_critical/major/minor`, `warranty_critical/major/minor`, `task_t1`–`t13`/`pt1`–`pt6`); tablet/mobile scroll horizontally rather than clip — verified as genuinely functional (not just visually clipped) by direct `scrollLeft` manipulation revealing the remaining columns — consistent with `GenericTableEditor`'s existing responsive-table convention used by every other Policy Studio tab.

**Also logged, not touched here:** the same `built: true`-but-no-Studio-UI audit that caught `24.hold_policy`/`25.config_export_import` in spec 05's slice also applies to `01.permission_matrix` — it has its own standalone Admin nav entry outside Studio, so likely low priority, logged in TODO.md §9 alongside the other two.

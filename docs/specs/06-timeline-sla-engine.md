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
1. On `booking.status → CRM_ACCEPTED` (17) a journey is instantiated from the project's published template version (fallback STANDARD); conditional stages/tasks are evaluated at creation **and re-evaluated** on `customer.residency_changed` / `change_request.created` (adds the Customisation stage) — improves on **[E §2.5]** one-time evaluation.
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

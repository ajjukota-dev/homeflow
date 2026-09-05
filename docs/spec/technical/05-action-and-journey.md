# 05 · Action kernel and journey engine

Implements [`../foundation/universal-action.md`](../foundation/universal-action.md) and [`../foundation/architecture.md`](../foundation/architecture.md) §5. Tables in [`02-database.md`](02-database.md) §4.5–4.6. v1's `workflow_engine.py` is the base for the journey half ([`../foundation/v1-reuse.md`](../foundation/v1-reuse.md) §1).

---

## 1. Action API (kernel, `kernel/action/`)

```python
async def create(tx, p, spec: ActionSpec) -> Action
    # spec: type, title, related, owner_id (or owner_role → resolved via project_team_assignment primary/backup),
    #       priority, severity, sla_code (→ sla_policy for the project, else Pranava default), plan_date, evidence_required, source, source_ref
    # sets sla_due_at = calendar.add_working_hours(now, policy.duration_hours) if policy.working_hours_only else now + hours
    # emits action.created
async def transition(tx, p, action_id, to: State, *, reason_code=None, evidence_ids=(), note=None) -> Action
    # validates the transition table below; `closed` requires evidence_required ⊆ evidence_ids (types matched on file_object/record refs)
    # emits action.<state> (closed → action.closed; SLA clock completed → sla.clock.completed)
async def reassign(tx, p, action_id, new_owner_id, reason_code) -> Action      # appends to reassignment_history; emits action.reassigned
async def pause_sla(tx, p, action_id, reason_code) / resume_sla(...)          # reason must be in policy.pause_reasons; emits sla.clock.paused/resumed
async def add_evidence(tx, p, action_id, file_ids | record_refs)
```

Transition table (`state` column): `new → in_progress | cancelled` · `in_progress → waiting_internal | waiting_customer | blocked | ready_for_approval | closed | cancelled` · `waiting_* | blocked → in_progress` · `ready_for_approval → closed | in_progress` · `closed | cancelled` terminal. Anything else → 409 `INVALID_TRANSITION`.

Modules never insert into `action` directly; they call `create`. Typed helpers wrap it where a role spec names a standard Action (`onboarding_actions(booking)`, `feasibility_action(cr)`, `collection_action(demand)`).

---

## 2. Ranking — `GET /me/day`

`domain/ranking.py` (pure):

```python
@dataclass
class RankInput: sla_due_at, plan_date, severity: dict, rupee_exposure: Decimal, downstream_blocked: int, sla_level: int, now: datetime
@dataclass
class Rank: score: Decimal, drivers: list[tuple[str, Decimal]], why_now: str

def rank(a: RankInput, w: RankWeights) -> Rank
```

`score = w.deadline·deadline_proximity + w.customer·severity.customer + w.revenue·log10(1+rupee_exposure) + w.dependency·downstream_blocked + w.escalation·sla_level`; each term normalised 0–1; `drivers` are the terms sorted by contribution; `why_now` is composed from the top two drivers with a phrase table (`"Overdue demand ₹12L"`, `"blocks registration slot"`, `"SLA L2"`). Weights are `RankWeights` from project config (Policy Studio "score weights"), defaults in `seeds/config`.

`rank_score`/`why_now` are cached on the row by `sla.tick` (every minute) so `GET /me/day` is one indexed query: `WHERE owner_id = :me AND state NOT IN (closed, cancelled) ORDER BY rank_score DESC LIMIT 50`, plus focus filters (`?customer_id=`, `?project_id=`, `?queue=`).

---

## 3. SLA ladder — the `sla.tick` job

For every open Action with `sla_due_at` and no `sla_paused_at`:

```
elapsed_pct = (now - created_at) / (sla_due_at - created_at)
L1  if elapsed_pct >= policy.warn_at_pct/100 and level < 1     → level=1, event sla.clock.warned, notify owner + backup
L2  if now > sla_due_at and level < 2                          → level=2, breach_count += 1, event sla.clock.breached,
                                                                 escalation.create(category, tier=L2, owner=dept manager) → H11
L3  if breach_count >= policy.repeat_breach_threshold          → escalation.upgrade(L3), owner = functional head
    or business_impact.rupee_exposure >= project.config.l3_rupee_threshold
L4  if severity.customer == critical or severity.reputation == critical or type in (legal, safety) and level >= 2
                                                               → escalation.upgrade(L4), decision pack, notify management
```

Dept manager / functional head resolve from `project_team_assignment.escalation_manager_id` for the Action's `owner_department`, then `project.config.escalation_routes` (Policy Studio), then `role.management` users.

**Escalation category** = `Action.type` mapping: `payment → cash`, `snag|inspection → handover`, `customer_contact|commitment → customer`, `document|approval` → `customer` unless legal → `reputation`, plus explicit override in `source_ref.category`. `margin` comes only from CR/variation exceptions.

**Decision pack** (`escalation.decision_pack` job, re-run on upgrade): `{ what_happened: last 5 events on the subject, current_impact: {customer, rupee, schedule, reputation}, dependencies: downstream Actions, actions_taken: transitions + comments, owner, next_deadline, recommended_decision: from a per-category rule table, evidence_ids }`. Pure assembly in `domain/tower.py::build_pack`.

SLA math uses `kernel/calendar.py` over `working_calendar` (week mask + holidays): `add_working_hours`, `working_hours_between`. Pausing stores `sla_paused_at`; resuming shifts `sla_due_at` by the paused duration (event carries both).

---

## 4. SLA ≠ Plan

Both are stored (`sla_due_at`, `plan_date`) and both statuses are derived at read time in `domain/ranking.py::health(a, now)`:

`sla_health ∈ {on_track, due_soon, at_risk, overdue, paused, completed_on_time, completed_late}` from the ladder; `plan_health` the same set from `plan_date` vs `now`/`closed_at`. Response models always carry both.

---

## 5. Journey engine (`kernel/journey/`)

Ported from v1's `workflow_engine.py` onto the tables in 02 §4.6. Function map:

| v1 | 2.0 | Change |
|---|---|---|
| `create_journey_from_template(booking)` | `start(tx, booking)` | template version from `project.journey_template_version_id`; creates `journey_instance`, `stage_instance` per stage, `task_instance` + an **Action** per task; sets baseline dates from `timeline_policy` (durations in working days from the stage's start trigger). Emits `journey.baseline.created`. |
| `evaluate_conditional_rule(rule, ctx)` | `domain/journey_rules.py::applies(rule, ctx)` | same DSL (`customer.type == 'nri'`, `loan.status != 'none'`), pure, tested |
| `compute_blocker(task)` | `blocker(tx, task)` | reads `depends_on` (task ids) + stage gate defs; blocked → Action state `blocked` |
| `cascade_from_task` / `_recompute_*` | `recompute(tx, journey_instance_id)` | one function: task states → stage state → journey state; forecast dates roll forward from actuals + remaining planned durations; confidence from open blockers and SLA levels |
| `reverse_cascade_from_task` | `reopen(tx, task, reason_code)` | requires reason; emits `journey.plan.revised` |
| sequential `_recompute_stage` next-stage kick | **dependency-driven** | a stage starts when its `dependencies` are satisfied, not when the previous number completes; Finance/Legal/Construction run in parallel per PDF §34.2 |
| `overlay_overdue(task)` | removed | replaced by `health()` above |
| `_autofill_owner` | `owner_for(tx, project_id, role_code)` | `project_team_assignment` primary → backup → escalation manager |

**Date model** on `stage_instance`: `baseline_*` written once by `start` (reset only via `reset_baseline(reason, approver)` → `timeline_revision(kind=baseline_reset)`), `current_plan_*` changed by `revise_plan(reason_code, approver?)` → `timeline_revision(kind=plan)`, `forecast_*` written only by `recompute`, `actual_*` written by task/stage transitions. No column is ever overwritten without a `timeline_revision` row.

**Template versioning:** `journey_template_version.status` `draft → approved → active → superseded`. Activating a new version never touches running instances; `migration_rule` in the definition says `none | new_bookings_only | opt_in`. Project overrides are a `definition` patch stored on the project's version (inherit + override, PDF Policy Studio).

**Customer visibility:** `stage_instance.customer_visible` + `customer_label` from the template feed T1/T6 via `customer_update.draft(handover_window_updated)`; forecast dates cross H10 as a **window** (month range) computed in `domain/journey_rules.py::window(forecast_end, confidence)`.

---

## 6. Endpoints (kernel-owned)

```
GET  /me/day?focus=customer|project|queue&id=      ranked Actions + why_now + both healths
GET  /actions?owner_id=&state=&type=&related.booking_id=
GET  /actions/{id}                                  incl. reassignment_history, evidence, events
POST /actions                                       manual create
POST /actions/{id}/transition   { to, reason_code?, evidence_ids?, note? }
POST /actions/{id}/reassign     { owner_id, reason_code }
POST /actions/{id}/sla/pause | /sla/resume  { reason_code }
POST /actions/{id}/evidence     { file_ids?, record_refs? }
GET  /escalations?tier=&status=&category=
POST /escalations/{id}/recovery-plan | /close
GET  /bookings/{id}/journey                          stages with four date pairs, tasks, blockers, confidence
POST /journeys/{id}/stages/{stage}/plan    { current_plan_start?, current_plan_end?, reason_code }
POST /journeys/{id}/baseline/reset          { reason_code }   (authority-gated)
GET  /me/day/closure  · POST /me/day/closure { carry_forward[{ action_id, reason_code }] }
```

---

## 7. Tests

`domain/test_ranking.py` (score monotonicity, why_now phrases, health matrix), `domain/test_journey_rules.py` (DSL, windows), `kernel/action/test_transitions.py` (table, evidence gate — foundation acceptance #3), `kernel/action/test_sla_tick.py` (ladder with an injected `Clock`, pause/resume shifts, escalation creation at L2 — H11), `kernel/journey/test_recompute.py` (parallel stages, forecast roll-forward, revision rows on every plan change — foundation §34).

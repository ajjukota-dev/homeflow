# 08 — Changeability Engine

## Purpose
p13–14 §8.7.1: "customisation availability … must be derived from the live physical state of each Unit Digital Twin and governed by configurable gates." Five states **OPEN / CLOSING / CONDITIONAL / EXCEPTION ONLY / HARD CLOSED**. p33–35 §30: objects `ChangeCategory`, `ChangeGateRule`, `UnitChangeGate`; rule re-evaluation on every progress/procurement/policy change; gate-expiry forecast; Unit 360 changeability matrix; Sales read-only. Existing pure engine `services/api/src/gates.ts` is the starting point.

## Data
| Table | Columns |
|---|---|
| `change_category` | `code` (LAYOUT_WALLS, ELECTRICAL_POINTS, PLUMBING_POINTS, FLOORING, KITCHEN, WARDROBES, BATHROOM_SPEC, DOORS_WINDOWS, PAINT_FINISH, FACADE, PLOT_BOUNDARY …), `name`, `product_types[]`, `trade`, `default_lead_days`, `customer_visible bool`, `sort_order` — p33 §30.1 |
| `change_gate_rule` | `id`, `category_code`, `project_id` (null = standard), `trigger_component_code`, `trigger_state ∈ {IN_PROGRESS, COMPLETE, VERIFIED}` or `trigger_event ∈ {PROCUREMENT_ORDERED, DRAWING_RELEASED, SLAB_CAST, HANDOVER_SCHEDULED}`, `condition_expr` (optional), `resulting_state ∈ {OPEN, CLOSING, CONDITIONAL, EXCEPTION_ONLY, HARD_CLOSED}`, `hard_or_soft ∈ {HARD, SOFT}`, `closing_lead_days` (CLOSING window before the trigger), `exception_authority_role`, `priority int`, `effective_from/to`, `version` — p33 §30.1 |
| `unit_change_gate` | `unit_id`, `category_code`, `current_state`, `reason_code`, `reason_text`, `source_event_id`, `source_rule_id`, `expected_close_at`, `closing_event`, `last_evaluated_at`, `freshness_status`, `exception_open bool` — p33 §30.1 |
| `unit_gate_exception` | `id`, `unit_id`, `category_code`, `granted_by`, `authority_role`, `reason`, `evidence_file_ids[]`, `valid_until`, `change_request_id` (18), `status ∈ {ACTIVE, USED, EXPIRED, REVOKED}` |
| `gate_evaluation_log` | `unit_id`, `category_code`, `at`, `from_state`, `to_state`, `rule_id`, `trigger`, `dry_run bool` |

## Rules (pure engine `gates.ts`, framework-free, 100% branch-tested)
1. Evaluate a unit: for each category applicable to the unit's product type, take the highest-priority rule whose trigger is satisfied by the unit's current progress states/events; rules with `HARD_CLOSED` beat everything; else `EXCEPTION_ONLY` > `CONDITIONAL` > `CLOSING` > `OPEN`. Store result in `unit_change_gate` with `reason_code = rule.code`, `source_event_id`.
2. `CLOSING` is derived when the triggering component's `planned_next_event_date` (07/06 forecast) is within `closing_lead_days`; `expected_close_at` = that date; exposed to Sales as "closes ~date" (p14 "Closing-soon" filter; p34 §30.3 gate-expiry forecast).
3. Re-evaluate on `progress.updated`, `progress.bulk_applied`, `procurement.ordered`, `drawing.released`, `handover.scheduled`, `policy.changed` (rule version published), and nightly for time-based closing (p34 §30.3 "Rule re-evaluation on every progress/procurement/policy change"). Log every transition.
4. Freshness: if any trigger component is `STALE`/`VERIFICATION_REQUIRED` (07), the gate carries `freshness_status = VERIFICATION_REQUIRED` and Sales sees it as such, never as OPEN (p34 §30.3).
5. `HARD_CLOSED` cannot be reopened by anyone; `EXCEPTION_ONLY` requires a `unit_gate_exception` by `exception_authority_role` with reason + evidence + validity, tied to a change request (p35 §30.5 t5 "Exception requires authority, reason and expiry").
6. Reopening a closed gate by rule change requires a reason on the rule version (p13 "reopen-a-closed-gate requires reason").
7. Capture is never blocked: a change request in a closed category is accepted and routed to EXCEPTION flow (18) — the gate governs release, not capture (p13; p35 §30.5 t7).
8. Sales/CRM/Customisation have READ only on `change_gate_rule`, `unit_change_gate`; writes → `forbidden` (p35 §30.5 t10; p44 §33.6 t3).
9. Unit Customisation Flexibility score = weighted share of customer-visible categories in OPEN (1.0) / CLOSING (0.5) / CONDITIONAL (0.5) / others (0), weights from `change_category`; exposed with drivers (which categories closed and why) and confidence (freshness) — p14, p8 §6.
10. Dry-run API (`evaluate(unit, overrides)`) powers 07's bulk preview and 24's compare.

## API
`GET /units/:id/changeability` (matrix: category → state, reason, expected_close_at, freshness, exception) · `GET /projects/:id/changeability?node_id&category&state` (heatmap) · `GET/PUT /change-gate-rules` (versioned; Studio) · `POST /change-gate-rules/publish {reason}` · `POST /units/:id/gate-exceptions` (authority) · `POST /gate-exceptions/:id/revoke` · `POST /changeability/evaluate` (dry-run; internal).

## Screens
- **Unit 360 → Changeability** (p34 §30.2): matrix with five-state chips (icon + label, never colour only), reason line ("Flooring HARD CLOSED — flooring verified 12 Aug by QA"), expected close date, freshness badge, exception button for authority roles.
- **Project changeability heatmap** (Site/Management): units × categories; filters.
- **Policy Studio → Change Gate Rule Studio** (p26 §21): rules table per category with trigger/condition/state/hard-soft/lead days/authority; version + publish with reason; simulation: pick a unit → see resulting states.
- Sales sees the matrix read-only inside 24.

## Events
`gate.state_changed`, `gate.exception_granted/revoked/expired`, `gate.rules_published`.

## Config
`change_category`, `change_gate_rule`, gate-expiry source mapping, freshness thresholds — Policy Studio (p26–27 §21).

## Acceptance
p35 §30.5 t1 ("gate state derived from unit progress, not typed"), t2 ("progress update flips OPEN→HARD CLOSED with source event"), t3 ("CLOSING shows expected close date"), t5, t7, t9 ("stale trigger → Verification Required, never OPEN"), t10 · p44 §33.6 t1, t4 ("rule change re-evaluates all units and logs transitions"), t7 ("HARD CLOSED cannot be overridden"), t8 ("exception used by a change request is consumed") · rule tests 1–10 · engine tests: table of ≥30 rule/progress combinations.

## Depends on / Feeds
Depends on 07, 02, 01. Feeds 24 (Sales view), 18 (release gate), 14 (drivers), 27 (exceptions view).

## Files
`services/api/src/gates.ts` (extend; stays pure), `services/api/src/changeability/**`, `services/api/migrations/0007_changeability.sql`, `services/api/src/seed/change-rules.ts`, `apps/workspace/src/pages/unit/Changeability*.tsx`, `apps/workspace/src/pages/studio/ChangeGateRules*.tsx`.

## Not in this feature
Change request workflow (18), sales filters/compare (24), holds (24).

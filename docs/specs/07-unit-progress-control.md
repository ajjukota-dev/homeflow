# 07 — Unit Progress Control (Unit Digital Twin: physical state)

## Purpose
p5 §4.1 Unit Digital Twin; p13 §8.7.1 "Unit Progress Control"; p33 §30.1 `UnitProgressState`; p43 §33.2 Project Unit Status Console: Project → Phase/Tower → Floor → Unit drill-down, **bulk update with affected-unit/gate preview and unit-level exceptions**, source + timestamp on every state; freshness threshold → "Verification Required" (p34 §30.3); "No API or UI path available to Sales/CRM may directly mutate UnitProgressState" (p44 §33.6 t3).

## Data
| Table | Columns |
|---|---|
| `component_definition` (real table since `0000_init.sql`: `code, label, sort_order` — this ALTERs it, it does not create it; see `SCHEMA.md`) | `code` (CIVIL_STRUCTURE, BLOCKWORK, PLASTER, ELECTRICAL_CONDUIT, ELECTRICAL_WIRING, PLUMBING_ROUGH_IN, PLUMBING_FIXTURES, FLOORING, KITCHEN, WARDROBES, DOORS, WINDOWS, PAINTING, SANITARY, HVAC, EXTERNAL_WORKS, COMMON_AREA_DEPENDENCIES, UTILITIES, CLEANING …), `label` (the real column — do not add a duplicate `name`), `parent_code` (room/trade/system hierarchy, p16 §8.8, new), `product_types[]` (PLOT: only boundary/road/utilities components, new), `readiness_weight` **[E §10.2 seed weights]** (new), `sort_order` (real), `evidence_required bool` (new), `effective_from/to` (new) |
| `unit_progress_state` — **decision needed before this is built**: the real table today is `unit_progress` (`unit_id, component_code, state_code, updated_at`, PK on unit_id+component_code). Either ALTER `unit_progress` in place to add the columns below (preferred — same entity, avoids a second source of truth) or get an explicit call from Amarsh to run both tables in parallel. Do not silently create a second table with a different name. | `unit_id`, `component_code`, `state_code ∈ {NOT_STARTED, IN_PROGRESS, COMPLETE, VERIFIED, REWORK}`, `pct int` (0–100, from checklist ticks or explicit for structure), `actual_date`, `planned_next_event`, `planned_next_event_date` (from 06 forecast or manual), `source ∈ {SITE_ENTRY, QA_VERIFICATION, BULK_UPDATE, IMPORT, SYSTEM}`, `updated_by`, `updated_at`, `freshness_status ∈ {FRESH, STALE, VERIFICATION_REQUIRED}` (derived), `stale_after_days` (from config) — p33 §30.1 |
| `progress_bulk_update` | `id`, `project_id`, `scope jsonb` (node ids / unit ids), `component_code`, `new_state`, `preview jsonb` (affected units, gates that would change), `exceptions jsonb` (unit ids excluded + reason), `applied_at`, `applied_by`, `status ∈ {PREVIEWED, APPLIED, CANCELLED}` |
| `progress_reopen` | `unit_id`, `component_code`, `from_state`, `to_state`, `reason`, `actor`, `at` (state regression always reasoned — TODO "V3") |

## Rules
1. Only roles with WRITE on module `unit_readiness` (the real 32-module permission-matrix name already live behind R0.6's `authorize()` — this spec previously said `unit_progress`, which is not a real module) (`SITE`, `QA`, `MANAGEMENT`, `SUPER_ADMIN`) may write; Sales/CRM/Customisation get `forbidden` — at the authorize layer **and** a handler-level guard (defence in depth, p44 §33.6 t3, p35 §30.5 t10).
2. Every write records `source`, `updated_by`, `updated_at`; the console shows them on every cell (p43 §33.2 "source + timestamp").
3. Regression (COMPLETE → IN_PROGRESS, VERIFIED → REWORK) requires `reason`; writes `progress_reopen`; emits `progress.reopened`.
4. `VERIFIED` may only be set by `QA` (site-declared vs QA-verified are distinct states, p16 §8.8); `COMPLETE` by Site.
5. Bulk update is two-step: `preview` returns affected units, the resulting gate states per unit (calls 08's evaluator in dry-run), and conflicts (units with a newer per-unit entry); `apply` excludes `exceptions` and stamps `source = BULK_UPDATE` (p43 §33.2, p44 §33.6 t2 "Bulk update shows affected gates before commit").
6. Freshness: `STALE` when `updated_at` older than `stale_after_days` for that component while `IN_PROGRESS`; `VERIFICATION_REQUIRED` when a gate depends on it and it is STALE (p34 §30.3 "Freshness threshold → Verification Required"). Derived at read; a nightly job emits `progress.stale` actions for the site owner (10).
7. Every change emits `progress.updated` with before/after; subscribers: 08 (gate re-evaluation), 14 (readiness recompute), 06 (forecast).
8. Progress percentages are never typed for interior components — derived from checklist/evidence in 15; explicit `pct` is allowed only for `CIVIL_STRUCTURE`-family components (structure by slab count) **[ours, honours p32 §27 "no manual progress %"]**.

## API
`GET /projects/:id/progress?node_id` (matrix units × components with state, source, timestamp, freshness) · `PUT /units/:id/progress/:component {state_code, pct?, actual_date?, planned_next_event?, reason?}` · `POST /projects/:id/progress/bulk/preview {scope, component_code, new_state}` → preview id · `POST /progress/bulk/:id/apply {exceptions[]}` · `GET /units/:id/progress` · `GET /units/:id/progress/history`.

## Screens
**Project Unit Status Console** (workspace → Site): tree Project → Phase/Tower → Floor; grid units × components; cell shows state chip + freshness dot + tooltip (source, who, when); filters by component/state/freshness; bulk-update drawer (select scope, component, state → preview table with gate deltas → exclude units with reason → apply); reopen dialog with reason. Unit 360 → Progress tab with history. Mobile (375): unit list → per-unit checklist view. Read-only rendering for Sales/CRM (no controls rendered, not just disabled).

## Events
`progress.updated`, `progress.reopened`, `progress.bulk_applied`, `progress.stale`.

## Config
`component_definition` (per product type), `stale_after_days` per component, weights — Policy Studio "Unit progress components", "Freshness thresholds".

## Acceptance
p35 §30.5 t10 · p44 §33.6 t1 ("Site updates a component → dependent gates re-evaluate"), t2, t3, t5 ("Stale progress flags Verification Required"), t6 ("Reopen requires reason and is audited") · rule tests 1–8 · Playwright console at 1440/768/375.

## Depends on / Feeds
Depends on 01, 02, 04. Feeds 08, 14, 15, 24, 28.

## Files
`services/api/src/progress/**`, `services/api/migrations/0006_progress.sql`, `services/api/src/seed/components.ts`, `apps/workspace/src/pages/site/UnitStatusConsole*.tsx`, `apps/workspace/src/pages/site/BulkUpdate*.tsx`.

## Not in this feature
Gate rules/states (08), QA evidence capture (15), readiness scores (14).

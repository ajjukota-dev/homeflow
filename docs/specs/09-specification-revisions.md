# 09 — Specification baseline & drawing/spec revision control

## Purpose
p5 §4.1: the Unit Twin carries "specification baseline, approved customisations, as-built"; p12 §8.7 "drawing/specification revision control with superseded lock"; p31 §26 "Site, QA and Procurement can identify the current released drawing/specification revision for every Unit"; P1 roadmap "variation catalogue/drawing versioning" (p29 §24).

## Data
| Table | Columns |
|---|---|
| `specification_baseline` | `id`, `project_id`, `product_type`, `unit_type`, `name`, `version`, `items jsonb` (category → spec text, brand/model, qty), `status ∈ {DRAFT, APPROVED, RETIRED}`, `approved_by/at` |
| `unit_specification` | `unit_id`, `baseline_id`, `current_revision_id` |
| `spec_revision` | `id`, `unit_id`, `revision_no`, `kind ∈ {BASELINE, CUSTOMISATION, AS_BUILT_CORRECTION}`, `change_request_id` (18), `items_delta jsonb`, `drawing_file_ids[]`, `released_at`, `released_by`, `status ∈ {DRAFT, RELEASED, SUPERSEDED}`, `superseded_by_id` |
| `variation_catalogue_item` | `id`, `project_id` (null = standard), `category_code` (08), `code`, `name`, `description`, `unit_price_inr`, `vendor_cost_inr`, `lead_days`, `product_types[]`, `constraints jsonb` (allowed unit types, gate categories consumed), `active bool` — p11 §8.7 "customisation policy (catalogue…)" |

## Rules
1. Every unit gets a `unit_specification` pointing at the approved baseline for its project/unit type at booking confirmation; revision 0 = BASELINE.
2. A `spec_revision` is created DRAFT by an approved change request (18) and `RELEASED` only when the change request reaches `RELEASED`; releasing marks the previous revision `SUPERSEDED` with `superseded_by_id` and emits `drawing.released` (which 08 consumes as a trigger event).
3. Superseded revisions are read-only; any screen showing a drawing shows the revision number and a "superseded" banner when not current (p31 §26 bullet).
4. As-built: on change request `AS_BUILT_CLOSED`, an `AS_BUILT_CORRECTION` revision records what was actually built if it differs from released (p12 "as-built closure updates the twin").
5. Files via `files` port; drawings are PDFs/images ≤ 25 MB.

## API
`GET/POST /specification-baselines`, `POST /specification-baselines/:id/approve` · `GET /units/:id/specification` (baseline + current revision + history) · `GET /spec-revisions/:id` · (creation/release only via 18 handlers) · `GET/PUT /variation-catalogue`.

## Screens
Unit 360 → Specification tab: baseline items, current revision (badge "Rev 3 · released 14 Aug"), history list, drawing viewer with superseded banner. Policy Studio → Specification baselines, Variation catalogue (per product/category, price, vendor cost, lead days).

## Events
`specification.baseline_approved`, `drawing.released`, `spec_revision.superseded`, `as_built.recorded`.

## Acceptance
p31 §26 "current released drawing/specification revision" · "Every completed customisation updates the permanent Unit Digital Twin" (with 18) · rule tests 1–5.

## Depends on / Feeds
Depends on 04, 03 (files). Feeds 18, 08 (trigger), 15 (QA compares against released revision), 30 (Home Passport as-built).

## Files
`services/api/src/specification/**`, `services/api/migrations/0008_specification.sql`, `apps/workspace/src/pages/unit/Specification*.tsx`, `apps/workspace/src/pages/studio/VariationCatalogue*.tsx`, `SpecBaselines*.tsx`.

## Not in this feature
Change request flow (18), pricing approval (18), procurement.

## Build note (2026-09-06, backend)
Migration is `0035_specification.sql` (0008 was taken, same collision class as 07/08/15/24's migration numbering). `unit.specification_baseline_id` (0003, unused, no FK) is kept in sync by `ensureUnitSpecification` alongside the real `unit_specification` pointer row; no SCHEMA.md collision entry needed since nothing pre-existing was renamed or reshaped.

Rule 1 (attach at booking confirmation) subscribes to both `booking.status_changed` (24's inventory booking, `payload.to === 'CONFIRMED'`) and `booking.created` (the pre-24 path, where creation inserts status `'submitted'` directly — creation IS confirmation there). A unit whose project has no APPROVED baseline for its product/unit-type scope is left unattached with a named blocker on `GET /units/:id/specification`, not an error.

Rules 2/4 (release, as-built) are plain `(tx, actor)` functions with no `ctx` gate — the spec's own API note ("creation/release only via 18 handlers") makes 18 the caller, composing them inside its own transaction. `drawing.released` carries `unit_id`, which 08's `changeability/core.ts::observedEvents` already maps to the DRAWING_RELEASED trigger — that mapping went live with zero changes to 08's code.

Rule 3's superseded-lock is enforced twice: `addDrawing` refuses a non-DRAFT revision, and every revision view carries `is_current`/`banner` computed against `unit_specification.current_revision_id`. Rule 5's upload reuses 15's presigned-key pattern (`project/{project_id}/spec_revision/{id}/{uuid}.{ext}`) and the shared `ALLOWED_CONTENT_TYPES`/25 MB cap from the files port.

Variation catalogue upsert follows 08/24's config pattern: a project-scoped row with the same code overrides the standard (NULL project) row. Tests: `specification/specification.test.ts`, one per rule (1–5) plus a baseline/catalogue CRUD test (7 tests total).

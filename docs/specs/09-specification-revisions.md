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

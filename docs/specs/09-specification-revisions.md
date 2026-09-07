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

## Build note (2026-09-07, UI + cross-spec fix)
Screens built: Policy Studio → **Specification baselines** (project picker, per-baseline card list with a local icon+label DRAFT/APPROVED/RETIRED chip — `Badge`/`StatusChip` in `packages/ui` don't carry a tone for this vocabulary, same gap 08's `GateChip` precedent already established — a repeatable category/spec/brand-model/qty item editor, "Create draft" + "Approve") and **Variation catalogue** (flat editable table over the bulk `putCatalogue` upsert, standard/NULL scope only — a per-project override editor is real, separate work nothing in this build needed yet). Both wired into `studio/Shell.tsx`'s `BESPOKE_TABS`, same pattern as 18's `CustomisationApprovalMatrixStudio`. Fixed `studio/registry.ts`'s `edit_roles` for both tabs from `["SITE"]` to `["SITE","MANAGEMENT"]` — the real write-gate on `specification/baselines.ts`/`catalogue.ts` is `SITE_SETUP_ROLES` (`SITE, MANAGEMENT, SUPER_ADMIN`), same bug class 08's own build note already found for `08.change_gate_rule_studio`.

Cut: a Unit 360 → Specification tab (the spec's own Screens line). No Unit 360 page exists anywhere in this app — every fork this session that touched a unit-detail surface (07, 08, 16, 18) independently confirmed the same gap and built its own screen instead. `CrDrawer.tsx` (18) has no `spec_revision_id` display hook to attach a minimal drill-in to either. Flagged in TODO.md rather than built against a page that doesn't exist.

**The real cross-spec gap** (found by 18's own fork while building the Customisation desk, 2026-09-07): `releaseChangeRequest` (`change-requests/release.ts`) calls `revisions.ts`'s `unitSpec()` helper, which throws `AppError("conflict", "unit has no specification baseline attached...")` unless a `unit_specification` row already exists for the unit. Rule 1's attach point is `ensureUnitSpecification`, fired only by the real `booking.status_changed`/`booking.created` **events** (`specification/subscribers.ts`) — but `seed.ts` inserts every demo booking via raw SQL directly into the `booking` table, never through the event-emitting handlers. No subscriber ever ran for any seeded booking, so `unit_specification` was empty for every East Crest unit on a fresh dev DB, and no spec-18 change request could ever reach RELEASED against real seeded data — not a UI bug, a missing seed fixture blocking a real downstream feature.

Fixed at the seed layer (not by retrofitting event emission into the seed script — the same "terminal-state seeding" call this file already makes for its own bulk `unit_progress` cross-join): `seed.ts` now inserts an APPROVED `specification_baseline` (`sb_eastcrest_villa`, 4 items: structure/flooring/kitchen/wardrobes) plus a RELEASED revision-0 `spec_revision` and `unit_specification` row for every East Crest villa unit.

Verified live end-to-end, not just that the row exists: raised a real change request (kitchen countertop upgrade) against booking `b_v111` and drove it through the full state machine — capture → feasibility (FEASIBLE) → costing (items + mandatory 4-dimension impact) → submit-approval (no approver matched the published matrix, straight to AWAITING_CUSTOMER) → issue-quotation → accept (SIGNED_COPY) → AWAITING_PAYMENT → waive-payment (MANAGEMENT) → **release**. Release succeeded — `status: IN_PROGRESS`, a real `spec_revision_id` was created and linked back to the change request. `GET /api/units/u_v111/specification` afterward shows the correct layered result: baseline rev-0 (`SUPERSEDED`, banner "Superseded by Rev 1"), the new rev-1 (`RELEASED`, `is_current: true`, `change_request_id` matching the CR), and `current_items` correctly merging the baseline's 4 categories with the CR's `kitchen_layout` delta. This is the actual regression this slice needed to guard, not just the two new Studio screens — pinned in `apps/workspace/e2e/customisation.spec.ts`'s existing capture→approval e2e test, extended to continue through Release and assert `blocker: null` / `current_revision.status === "RELEASED"` on the resulting unit specification.

Both new Studio screens have their own e2e coverage: `apps/workspace/e2e/specification-studio.spec.ts` (8 tests) — 3-breakpoint renders of both tabs against real seeded data (the East Crest standard baseline's 4 items, the empty-catalogue state), a full create-draft → approve round trip (using a distinctive `unit_type: "E2E_TEST"` scope so approving it never retires the real seeded standard baseline other specs depend on), and a catalogue add-item → save → verify-by-value round trip (`toHaveValue`, not `getByText` — the table's cells are live editable inputs, not static text, after a save/reload).

**Found while building, folded into TODO.md**: `apps/workspace/e2e/visual.spec.ts`'s "QA handover" tests (`>= 5` commitment chips) assume 5 East Crest villas have active bookings; only 4 come from seed data alone (V110/V111/V112/V113 — V101 has never had a seeded booking in `seed.ts` or `seed-lifecycle.ts`). The same file's own earlier "Booking → CRM handoff → Customer 360" test (line 35, runs first) books a 5th villa (a spare — V104 or V108) through the real flow, which is what normally brings the count to 5; `customer-updates.spec.ts` and `sales-handover.spec.ts` also each book one of the same two spare villas. All three files share one shrinking, unrestocked pool of 2 spares on one dev DB — whichever file's booking attempt runs first each time determines whether later files (including this same one) see 4, 5, or 6 chips, and whether `visual.spec.ts:35` itself finds a "Book this villa" button to click at all. This reproduced consistently in true isolation (4, both times, fresh `db:reset`) and inconsistently inside the full suite (once clean, once with `visual.spec.ts:35` itself failing along with all three `>=5` assertions in the same run) — a pre-existing shared-fixture race across three files, not a single independent flake, and not something this slice touched or owns (none of the three files are in 09's `Files` list).

**Final full-suite verification (2026-09-07, post-`advisor()`)**: an `advisor()` pass before landing flagged that the "full Playwright suite green" claim above had never actually been earned — every run up to that point exercised the new `specification-studio.spec.ts` only in isolation or paired with `customisation.spec.ts`, never inside a true single full-suite run alongside the spare-villa-race-prone files. Ran it: fresh `db:reset`, API restart, `npx playwright test` (all 13 spec files, 160 tests). Result: **158 passed, 1 failed, 1 skipped.** The one failure is `visual.spec.ts:138` ("QA handover completes keys for an eligible villa") — a signature-pad `Save signature` button detaching from the DOM mid-click (`visual.spec.ts:202`, 30s timeout) — the same pre-existing flake class already seen on an earlier full run this same slice, unrelated to any file this slice touched. The spare-villa-race flakiness documented above did not reproduce this run: `visual.spec.ts:35` and both other pool-sharing files passed clean. All 8 `specification-studio.spec.ts` tests and the extended `customisation.spec.ts` release test passed inside the real full suite, not merely in an isolated or paired run.

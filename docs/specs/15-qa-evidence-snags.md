# 15 — QA checklists, evidence & snags

## Purpose
p16 §8.8 QA/QC: component hierarchy by room/trade/system; checklist completion with "mandatory photographs, tests and certificates"; site declaration vs independent QA verification; common-area/utility/statutory dependencies; exception queue for failed/repeat inspections. p16 §8.9 Snagging: category, severity, location, trade, contractor, root cause, SLA by severity, before/after evidence, customer verification, repeat flag, cost. Appendix A snag statuses (p42): **Open / Assigned / In Progress / Ready for Verification / Verified / Closed / Reopened**.

## Data
| Table | Columns |
|---|---|
| `qa_checklist_template` | `id`, `component_code` (07), `product_types[]`, `items jsonb` [{code, label, evidence ∈ {NONE, PHOTO, TEST_REPORT, CERTIFICATE}, required}], `min_photos int`, `version`, `effective_from/to` — seed **[E §2.3]** T11 items (civil, electrical, plumbing, painting, cleaning; apartments + tower_deps, access_card) expanded per component |
| `qa_inspection` | `id`, `unit_id`, `component_code`, `kind ∈ {SITE_DECLARATION, QA_VERIFICATION, RE_INSPECTION}`, `template_version_id`, `status ∈ {SCHEDULED, IN_PROGRESS, PASSED, FAILED}`, `inspector_user_id`, `started_at`, `completed_at`, `items jsonb` [{code, result ∈ {PASS, FAIL, NA}, note}], `attempt_no`, `failure_reason`, `action_id` |
| `qa_evidence` | `id`, `inspection_id`, `item_code`, `file_id`, `kind`, `captured_at`, `captured_by`, `gps jsonb?`, `verification_status ∈ {UPLOADED, VERIFIED, REJECTED}`, `verified_by` |
| `external_dependency` | `id`, `project_id`, `hierarchy_node_id`, `kind ∈ {COMMON_AREA, UTILITY_POWER, UTILITY_WATER, LIFT, STP, FIRE_NOC, OCCUPANCY_CERT, OTHER}`, `label`, `status ∈ {PENDING, IN_PROGRESS, DONE}`, `expected_date`, `owner_user_id` — affects units under the node (p16 "common-area/utility/statutory dependencies") |
| `snag` | `id`, `code SNG-`, `unit_id`, `project_id`, `booking_id`, `room ∈ {LIVING, KITCHEN, MASTER_BEDROOM, BEDROOM_2, BEDROOM_3, BATHROOM_1, BATHROOM_2, UTILITY, BALCONY, COMMON, EXTERIOR, PLOT, OTHER}` **[E §10.1]**, `category ∈ {CIVIL, ELECTRICAL, PLUMBING, PAINTING, FLOORING, FITTINGS, CLEANING, OTHER}` **[E]**, `trade`, `severity ∈ {CRITICAL, MAJOR, MINOR}` **[E]**, `description`, `raised_by_kind ∈ {QA, SITE, CUSTOMER, HANDOVER, FM}`, `raised_by_user_id`, `contractor_id`, `assigned_to_user_id`, `status`, `root_cause ∈ {WORKMANSHIP, MATERIAL, DESIGN, DAMAGE_AFTER_COMPLETION, VENDOR_DELAY, OTHER}`, `is_repeat bool` (same unit+room+category within 90 d — auto), `estimated_cost_inr`, `actual_cost_inr`, `sla_clock_id`, `before_file_ids[]`, `after_file_ids[]`, `customer_verified_at`, `closed_at`, `reopen_count`, `action_id` |
| `contractor` | `id`, `name`, `trade`, `contact`, `active` |
| `snag_sla_policy` | severity → `sla_policy_id` (06): CRITICAL 2 d, MAJOR 7 d, MINOR 15 d (defaults; Emergent only had a 2-day critical escalation **[E §11.1]** — others marked `DEFAULT_UNCONFIRMED`) |

## Rules
1. Site declaration: Site completes a `SITE_DECLARATION` inspection for a component (all required items PASS, `min_photos` met) → 07 state `COMPLETE`, source `SITE_ENTRY`. QA then runs `QA_VERIFICATION` → PASSED sets `VERIFIED`; FAILED sets `REWORK` with `failure_reason`, creates a snag per failed item (severity from item config, default MAJOR) and a re-inspection action (10) — p16 §8.8 "site declaration and independent QA verification as separate states".
2. Evidence: required items cannot PASS without evidence of the configured kind; photo evidence is captured via the `files` port (phone camera at 375 px). Evidence verified by QA ≠ uploader. Deleting evidence is not allowed; superseding is.
3. Exception queue: inspections with `attempt_no ≥ 2` or FAILED twice on the same component appear in the QA exception queue with the pattern (component, contractor, root cause) — p16 §8.8 "exception queue for failed/repeat inspections".
4. External dependencies: a unit's readiness (14) and handover (16) treat any `PENDING/IN_PROGRESS` dependency on its ancestor nodes as a blocker "Common area: <label> expected <date>"; FM/Community gate (16) reads them.
5. Snags: `OPEN → ASSIGNED (contractor/user) → IN_PROGRESS → READY_FOR_VERIFICATION (requires ≥1 after-photo **[E]**) → VERIFIED (QA/Handover, ≠ fixer) → CLOSED`; `REOPENED` from VERIFIED/CLOSED with reason (QA, Handover, Management, or Customer via portal for customer-raised snags); `reopen_count++`, `is_repeat` recomputed. Customer-raised snags (pre-handover walkthrough or portal) require `customer_verified_at` before CLOSED (p16 §8.9 "customer verification").
6. SLA clock by severity starts at OPEN; breach escalates per 12; CRITICAL open ≥ 2 d → escalation (seed **[E]**).
7. Handover gate input (16): any open CRITICAL snag → hard blocker; open MAJOR count above threshold → soft blocker; MINOR list carried into the handover checklist (config) — replaces Emergent's critical-only rule with a policy.
8. Analytics: snags by contractor/category/root cause, repeat rate, mean time to close by severity, cost — feeds 27 quality KPIs (p24 §19 "snag closure %", "repeat defects") and 31 quality root-cause.

## API
`GET/PUT /qa/checklist-templates` · `POST /units/:id/inspections {component_code, kind}` · `PUT /inspections/:id/items` · `POST /inspections/:id/evidence` (presigned) · `POST /inspections/:id/evidence/:eid/verify|reject` · `POST /inspections/:id/complete` · `GET /projects/:id/qa/exceptions` · `GET/POST /projects/:id/dependencies`, `PATCH /dependencies/:id` · `GET/POST /snags`, `POST /snags/:id/assign|start|ready|verify|close|reopen`, `PATCH /snags/:id` (cost, root cause) · `GET /snags/analytics?project_id`.

## Screens
- **QA workspace**: units needing verification (from Site declarations), inspection runner (checklist items with pass/fail/NA, camera capture, notes; works at 375 px offline-tolerant — queue uploads), exception queue, dependencies board per tower.
- **Site**: declare component (checklist + photos) from the Unit Status Console (07).
- **Snags**: list (filters: unit, severity, status, contractor, SLA state), create (room/category/severity/description/before photo), detail (timeline, before/after gallery, verification, cost, root cause, repeat badge), contractor view (their open snags).
- Analytics page (QA/Management).

## Events
`qa.inspection_passed`, `qa.inspection_failed`, `qa.evidence_verified`, `dependency.status_changed`, `snag.opened`, `snag.assigned`, `snag.ready_for_verification`, `snag.verified`, `snag.closed`, `snag.reopened`.

## Config
checklist templates per component/product, min photos, snag SLA by severity, handover thresholds, root-cause list, contractor master.

## Acceptance
p16 §8.8/8.9 bullets as tests (each bullet ≥1 test) · Appendix A snag statuses exact · rule tests 1–8 · Playwright: inspection runner at 375 px with camera input stub; snag before/after flow.

## Depends on / Feeds
Depends on 07, 10, 06, 03 (files), 01. Feeds 14, 16, 26 (customer snags), 27, 30 (DLP snags reuse `snag`).

## Files
`services/api/src/qa/**` (split: `qa-inspections.ts`, `qa-evidence.ts`, `qa-snags.ts`, `qa-dependencies.ts`), `services/api/migrations/0013_qa.sql`, `services/api/src/seed/qa-templates.ts`, `apps/workspace/src/pages/qa/**`, `apps/workspace/src/pages/snags/**`, `apps/workspace/src/components/CameraCapture.tsx`.

## Not in this feature
Handover appointment/checklist (16), DLP windows (30), readiness math (14).

## Build note (2026-09-06, backend)
Migration is `0032_qa.sql` (0013 was taken). Two Data-table rows already existed: `qa_evidence` is a *different* entity (the (unit, component) "QA verified" flag 14 and the handover gate read) and is kept — the evidence-file table above is `qa_inspection_evidence`, and every QA PASS/FAIL upserts the legacy flag so they never disagree; `snag` is ALTERed in place with the lowercase status/severity vocabulary the pre-15 readers filter on, Appendix A names translated at the API boundary (`qa/snags.ts`), `location`/`trade` nullable. `template_version_id` is `template_id` (rows carry `version`); `file_id`/`*_file_ids[]` are files-port keys (`file_key`, `*_file_keys[]`). Rule 1's state writes go through 07's `updateProgress` in a separate transaction after the inspection's (nested `withTx` deadlocks on PGlite); the re-inspection action is `exec_simple` owned by SITE. Rule 2: a PASS needs the item's configured evidence kind present and not REJECTED (not necessarily VERIFIED — QA's own photos would need a second QA); verifier ≠ uploader enforced; no delete path, `supersedes` only. Rule 5 built to the seeded matrix: SITE(+QA) and FM write `snagging`, so MANAGEMENT cannot reopen (spec says it can — flagged); a CUSTOMER session may reopen/customer-verify only snags with `raised_by_kind = CUSTOMER` (26's portal isn't built, so staff enter walkthrough findings with that kind). Rule 6: every snag owns an `exec_simple` action carrying its SLA clock, because 12's `scanEscalations` only scans clock-backed actions; `snag_critical/major/minor` sla_policy rows (`applies_to = 'SNAG_SEVERITY'`, calendar days, MAJOR/MINOR `unconfirmed`) attach 12's STANDARD ladder; `critical_snag_2d` stays `wired:false` (12's rule match has no severity filter). Rule 7: `handover_policy.major_snag_max` (default 0, UNCONFIRMED) drives a new **soft** `snags` gate; CRITICAL stays hard via the existing physical/quality gates; the MINOR list for 16's checklist isn't surfaced yet. Rule 4 feeds handover's FM/Community soft gate via `dependencyBlockersForUnit`; 14's unit-readiness score does not read dependencies yet — flagged. Legacy `qa.ts::closeSnag`/`verifyComponent` and their routes stay for the existing console; `POST /snags/:id/close` dispatches on body shape (notes → legacy, empty → lifecycle). Templates seed from Emergent's T11 items over the four real components (evidence kinds, min_photos = 1, per-item severities UNCONFIRMED); templates seed after the demo data because `component_definition` rows are demo data today. Screens, camera capture and Studio tabs deferred.

## Build note (2026-09-06) — Policy Studio tabs
`15.qa_checklist_templates`, `15.snag_sla`, `15.contractors` registered against `qa_checklist_template`/`snag_sla_policy`/`contractor` in the generic draft/publish/history envelope — `qa_checklist_template`'s own `version`/`effective_from`/`effective_to` columns are edited as plain fields, the same fit `risk_rule`/`probability_rule` already prove safe. Zero new frontend code, same shape as `10.action_types`. `contractor` has no seed rows in this DB yet, so its tab correctly shows the honest empty state. Full detail (the cross-spec batch this shipped in, plus a real `GenericTableEditor` bug found and fixed while verifying it live) is in `TODO.md` §9 and `docs/demo/run-log.md`'s 2026-09-06 "Studio registry-only batch" entry.

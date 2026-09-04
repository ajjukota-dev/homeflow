# 05 — Journey templates & Journey Template Studio

## Purpose
p44–47 §34: "Do not hardcode any Project-specific number of days, dates, charges, milestones, stage names or customer wording." Pranava Standard Journey Template → Project Journey Template (inherit + override) → Journey Instance per booking. Template versioning that never reshapes active journeys (p47 §34.7 t2). East Crest's seven stages are a Project override (p47 §35). Products differ by template (TODO §7 #10).

## Data
| Table | Columns |
|---|---|
| `journey_template` | `id`, `code`, `name`, `scope ∈ {STANDARD, PROJECT}`, `project_id` (null for STANDARD), `parent_template_id` (PROJECT inherits STANDARD), `product_type` (null = all) |
| `journey_template_version` | `id`, `template_id`, `version int`, `status ∈ {DRAFT, PUBLISHED, RETIRED}`, `published_at`, `published_by`, `migration_rule ∈ {NEW_JOURNEYS_ONLY, OFFER_MIGRATION}` (p27 §21 "template versioning with migration rule"), `change_note` |
| `journey_stage_template` | `id`, `version_id`, `code`, `name` (internal), `customer_name` (customer wording, p27 §21), `sort_order`, `stream ∈ {COMMERCIAL, LEGAL, FINANCE, CONSTRUCTION, HANDOVER, POST_HANDOVER}` (parallel streams, p46 §34.3), `customer_visible bool`, `planned_duration_days`, `owner_department`, `entry_gate_expr` (optional, references gates from 08/16/19), `is_mandatory`, `condition_expr` (conditional stage, DSL below) |
| `journey_task_template` | `id`, `stage_template_id`, `code`, `title`, `customer_title` (null = internal only), `owner_role`, `task_type ∈ {MANDATORY, CONDITIONAL}`, `execution_type ∈ {SIMPLE, VERIFICATION, EVIDENCE, APPROVAL, CHECKLIST, EXTERNAL}` **[E §2.2]**, `verifier_role`, `approver_role`, `external_party ∈ {CUSTOMER, SRO, BANK, VENDOR}`, `required_document_category`, `checklist_items jsonb`, `priority ∈ {LOW, MEDIUM, HIGH, CRITICAL}`, `sla_policy_id` (06), `condition_expr`, `customer_visible bool`, `sort_order` |
| `journey_dependency` | `version_id`, `from_task_code`, `to_task_code`, `kind ∈ {FINISH_TO_START, START_TO_START}`, `lag_days` |
| `stage_visibility_rule` | `stage_template_id`, `role_code`, `visible bool` (Banking sees only loan/payment stages **[E §1.4]**) |

Conditional DSL **[E §2.5]**: `^scope.field (==|!=|in|not in) value$`, scope ∈ {customer, booking, unit, project}. **Fail closed** — an unparseable expression fails template publish (Emergent failed open; PDF asks for governed config).

## Seed — Pranava Standard (p45 §34.2 generic stages, 11)
Pre-Sales & Personalisation Discovery · Booking · Sales→CRM Handover · Documentation & KYC · Agreement · Payments & Funding · Registration · Construction Progress · Customisation (conditional: booking has change requests) · Readiness, QA & Snagging · Handover · Post-Handover Care. Streams overlap (Finance ∥ Legal ∥ Construction). Tasks seeded from **[E §2.2]** T1–T13 with their SLA days (2/3/7/10/5/3/3/5/4/3/30/7/3) and dependency edges **[E §2.4]**, plus PDF tasks with no Emergent precedent (personalisation discovery, change-request stages, handover appointment, 7/30/90 check-ins) with `planned_duration_days` marked `DEFAULT_UNCONFIRMED` in the seed comment. Product overlays: VILLA (no tower dependencies/access card checklist items), PLOT (no interior stages; registration-centric).
East Crest override (demo only): seven stages mapped onto the standard by `code` (p47 §35), durations from `HOMEFLOW-OS.md` marked demo.

## Rules
1. Only a `PUBLISHED` version can be assigned to a Project (`project.journey_template_version_id`) or instantiate journeys.
2. Publishing a new version never alters existing `journey_instance` rows (p47 §34.7 t2). With `OFFER_MIGRATION`, an Action is raised for the project owner listing affected journeys; migration is explicit per journey and logged.
3. Project templates may override durations, wording, visibility, add/remove conditional tasks — never delete a STANDARD mandatory stage (p47 §34.7 t1 "Project can override durations without changing the Standard Template").
4. Stage/task `code`s are stable across versions; instances reference codes + version id.
5. A template with a cycle in `journey_dependency` cannot be published.
6. Customer wording is per stage (`customer_name`), configurable per project (p27 §21 "stage-level customer visibility + wording").

## API
`GET/POST /journey-templates` · `POST /journey-templates/:id/versions` (draft from current) · `PUT /journey-templates/versions/:vid` (stages, tasks, deps, visibility) · `POST /journey-templates/versions/:vid/publish` · `POST /projects/:id/journey-template {version_id}` · `GET /journey-templates/versions/:vid/preview?product_type&residency` (which tasks instantiate).

## Screens
Workspace → Policy Studio → **Journey Template Studio** (p46 §34.5): template list; version editor with stage lanes (streams as swimlanes), task cards, dependency lines, conditional badges, customer-wording column, visibility per role; publish dialog with diff vs previous version and migration rule; preview for a sample customer (Resident/NRI, product).

## Events
`template.version_published`, `template.assigned_to_project`, `journey.migration_offered`.

## Config
This whole feature is configuration (p26 §21 "Workflow templates by product", "conditional task rules", "template versioning with migration rule", "parallel-stream configuration", "stage-level customer visibility + wording").

## Acceptance
p47 §34.7 t1, t2, t5 ("Conditional stage appears only when the booking condition is true"), t9 (customer-facing hides internal tasks — via `customer_visible`) · rule tests 1–6 · Playwright of the Studio at 3 breakpoints.

## Depends on / Feeds
Depends on 01, 04. Feeds 06 (instances), 10 (tasks → actions), 26 (customer journey).

## Files
`services/api/src/journey/templates*.ts`, `services/api/src/journey/dsl.ts`, `services/api/migrations/0004_journey_templates.sql`, `services/api/src/seed/journey-standard.ts`, `services/api/src/seed/demo-east-crest.ts`, `apps/workspace/src/pages/studio/JourneyTemplate*.tsx`.

## Not in this feature
Instances, dates, SLA clocks (06). Action creation (10).

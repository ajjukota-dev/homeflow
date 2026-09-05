# Foundation · v1 reuse and migration

HomeFlow 2.0 is built **on** HomeFlow v1 (`Pranava-V2/HomeFlow`, FastAPI + MongoDB + React, ~40k lines, 41 collections), per PDF §1: *"The existing modules are a valuable base and should be retained."* This file is the contract for what is carried, what is refactored, what is dropped, and how the data moves. It closes the gap found in [`../00-REVIEW.md`](../00-REVIEW.md).

**Source snapshot:** v1 at commit `7854b05` (4 Sep 2026). Freeze it there.

---

## 1. Reuse ledger — per v1 module

Verdicts: **KEEP** (bring across, restyle only) · **PORT** (bring the logic, re-home it on Postgres/the new foundation) · **REFACTOR** (reshape to the spec) · **DROP** (do not carry) · **NEW** (neither side has it).

### Kernel

| v1 file / collection | Verdict | Target in 2.0 | Notes |
|---|---|---|---|
| `routers/auth.py`, `auth_utils.py` (JWT + bcrypt + refresh) | REFACTOR | Server-side Google OIDC (`authlib`) + a `session` table replace JWT minting; bcrypt/password paths are deleted. Request context still carries `user_id`, `role_ids`, `authorized_project_ids`. | v1's `/auth/google` goes through **Emergent's broker** (`auth.emergentagent.com`). Replace with direct Google OIDC. Local: real Google on `localhost` or `HOMEFLOW_DEV_LOGIN`. |
| `rbac_matrix.py` (11 roles × ~40 modules × 6 levels), `rbac_redact.py` | PORT | `permission` table seeded from the matrix; `require_module()` dependency stays; redactors stay. | Matrix becomes **data** (Policy Studio edits it). `read_status_only` / `read_limited` → the spec's field-level sensitivity (§17). |
| `auth_scope.py` (per-router project scoping) | REFACTOR | Postgres **RLS** on `project_id`, session GUC set from JWT claims per request. | Delete the per-router `scope_filter_*` calls once RLS is on. Keep the *leak-safe 404* convention. |
| `users.assigned_project_ids` | REFACTOR | `ProjectTeamAssignment` (data-model §3.1) — effective-dated, with role scope. | Emergent's own audit recommends this. Backfill one row per `(user, project)` from the array. |
| `db.py write_audit()` + `audit_logs` (1,040 rows) | REFACTOR | `event` table per [`event-log.md`](event-log.md). | v1 stores full before/after diffs (PII) and `except: pass`. 2.0 stores the envelope + typed payload, never swallows. Historic `audit_logs` are archived read-only, not migrated into `event`. |
| `engine_hooks.py` (in-process lifecycle callbacks) | PORT | The `events` port: append to `event` **and** `PutEvents` to the bus. | Same call sites. |
| `escalation_rules.py` (13 hard-coded rules, on-demand `/scan`) | REFACTOR | `SlaPolicy` rows (config) evaluated by the Action kernel on a schedule; breaches produce `Escalation` (universal-action §3). | The 13 rules are the **seed content** for SLA policies. |
| `storage.py` + GridFS (`attachments.files/chunks`) | REFACTOR | S3 (MinIO locally) + `file_object` table. | 87 attachments, 64 PDF + 15 PNG in the sample. One-shot copy GridFS → S3, keep `attachments.id` as `file_object.id`. |
| `routers/comments.py`, `attachments.py`, `notifications.py`, `mentions` | KEEP | Same polymorphic `(entity_type, entity_id)` design on Postgres. | Not "another chat stream" (§27) — entity-anchored. Notifications gain quiet hours + digest later. |
| `routers/search.py` | KEEP | Postgres `pg_trgm` / `tsvector`. | No OpenSearch. |

### Journey & work

| v1 | Verdict | Target | Notes |
|---|---|---|---|
| `workflow_engine.py` + `workflow_templates/stages/subprocesses/task_templates/task_dependencies` | **PORT** | `JourneyTemplate`, `JourneyTemplateVersion`, `JourneyStageTemplate`, `JourneyTaskTemplate` + dependency defs (architecture §5). | Keep: instantiation, conditional DSL, blocker text, forward/reverse cascade, self-verify guard, `completion_rule`. **Add:** baseline/current/forecast/actual dates, SLA clock start/pause/warn/breach, working calendar, template *versioning* with migration rule. |
| `customer_journeys`, `journey_stage_instances`, `journey_subprocess_instances` | PORT | `JourneyInstance`, `StageInstance`. | Already carry `project_id + unit_id + booking_id`. |
| `tasks` (303 rows) + `routers/tasks.py` | REFACTOR | `Action` type=`task` ([`universal-action.md`](universal-action.md)). | Task states map: Not Started→`new`, In Progress→`in_progress`, Waiting for Customer→`waiting_customer`, Waiting Internal/External→`waiting_internal`, Blocked→`blocked`, Awaiting Verification/Approval→`ready_for_approval`, Completed→`closed`, Cancelled→`cancelled`. `evidence_required` + checklist carry over. |
| `snags` | REFACTOR | `Snag` (unit-twin §2.6) **and** an `Action` type=`snag` per open snag. | Add `root_cause_code`, `is_repeat`, `vendor_id`, `sla_due_at`. Keep after-photo / verify / reopen flow. |
| `customer_commitments` | REFACTOR | `Commitment` (customer-twin §2.5) + `Action` type=`commitment`. | Add `direction` (all v1 rows are `pranava_to_customer`), `visibility`, `confidence`; pre-breach rule. |
| `escalations` | REFACTOR | `Escalation` (universal-action §3) produced by the SLA ladder. | Manual escalations stay possible (`created_by` user). |
| Seeded templates: Villa + Apartment, 8 stages, T1–T13 | PORT as **config seed** | Pranava Standard Journey template. | See §3 below for the stage mapping. |

### Modules

| v1 router | Verdict | Target | Notes |
|---|---|---|---|
| `sales_handovers.py` (sections → validate → submit → accept / return + reason → promote commitments) | PORT | H2. `Booking.completeness_score`, `booking.handover.submitted/accepted/returned` events. | Return reason becomes a **taxonomy** (config), not free text. |
| `bookings.py`, `customers.py`, `master.py` (projects/units/users/roles/departments) | PORT | data-model §2. | Units gain `hierarchy_node_id`; project gains `product_type`, `legal_entity`, `jurisdiction`, `rera_reg_no`, `escrow_assurance_note`, `config`. Co-applicants move from `customers.applicants[]` sub-docs to `BookingApplicant` rows. |
| `payments.py` (schedule → milestones → payments verify/dispute/waive, receipts upload) | PORT | `PaymentPlan`, `Demand`, `Receipt` (accounts spec). | v1's ageing buckets (Current / 1-7 / … / 90+) stay as the ageing dimension; the **true-risk split** (due / overdue / disputed / loan-dependent / PTP / true risk) is added from this repo's `collections.ts`. |
| `tds.py`, `financial_clearance.py` | PORT | H7 financial clearance; TDS verification. | This repo's `clearance.ts` threshold logic replaces v1's checklist-only approve; keep the checklist as evidence. |
| `loans.py` (sanction / disbursement / blocker events) | PORT | `LoanCase` + events. | Add days-to-demand vs days-to-disbursement gap. |
| `legal.py` (draft → review → deviation → approve, versions) + `document_generation.py` (Jinja + WeasyPrint, 3 templates, DRAFT watermark) | PORT | Legal Document Factory (legal spec, §32). | **Add** from this repo's `legal.ts`: frozen data snapshot, unresolved-token validation, checksum on execute. **Add** template versioning + effective dates, clause library, `DocumentDeviation`. v1's `legal_versions` maps to `GeneratedDocument.version`. |
| `registrations.py` (availability → slot → executed → registered deed upload) | PORT | H8 `RegistrationCase`. | Add readiness gate that reads H7. |
| `unit_readiness.py` (per-booking, 14 components × weights × typed %) | **REFACTOR** | `UnitProgressState` per unit per component (state, not %), `QAEvidence`, readiness **derived**. | The 14 component names become `ComponentDefinition` seed rows. The weights become readiness-score config. **Typed percent is dropped.** Site declaration and QA verification become separate states (qa spec AT 2). |
| `handovers.py` (readiness roll-up, checklist, **override with reason**, acknowledgement, post-handover patch) | PORT | Gates Part B + `HandoverRecord`. | This repo's `handover.ts` `evaluateHandover()` replaces v1's `_readiness_score()` (per-gate hard/soft instead of Green/Amber/Red). v1's override endpoint gains `override_evidence_ids`, safety-gate rejection, `gate.overridden` event. |
| `communications.py` | PORT | `Communication` (customer-twin §2.6). | Add `sentiment`, `summary`, templates. |
| `reports.py`, `exec_dashboard.py` | REFACTOR | Control Tower (this repo's `tower.ts pickFive`) + KPI read models. | v1's `exec_dashboard/exceptions` is the raw material for interventions; v1's CSV reports stay as the KPI explorer's export. |
| `workflow.py` routes (journey list/hold/resume/close, expected-handover) | PORT | Journey Control screens. | `expected_handover_history` → `TimelineForecastRevision`. |

### Frontend

| v1 | Verdict | Target |
|---|---|---|
| `frontend/` — 27 pages, 7 admin pages, `CustomerDetail.jsx` with 12 tabs, `CollaborationPanel`, `TaskDetailModal`, RBAC guards (`CanAccess`, `RestrictedField`) | **KEEP** the information architecture and components; **migrate** CRA → Vite; **re-tokenise** per the design decision in `00-REVIEW.md` | `apps/workspace` |
| `apps/workspace` (this repo, 8 screens) | Fold in: Site progress control, Sales inventory with gates, Control Tower five, After-keys | into the v1 workspace as new pages |
| `apps/my-pranava-home` (this repo) | **KEEP** — v1 has no customer portal | `apps/my-pranava-home` |
| `mobile/` (empty Expo scaffold) | DROP | — |

### Dependencies

`requirements.txt` carries ~15 packages with **zero imports**: `litellm`, `openai`, `google-genai`, `google-generativeai`, `stripe`, `huggingface_hub`, `tiktoken`, `emergentintegrations`, `boto3` (unused — will be used for S3), `pandas`, `numpy`. Remove all but `boto3`. Add `sqlalchemy[asyncio]`, `asyncpg`, `alembic`.

---

## 2. Data migration — Mongo collection → Postgres table

Principle: **additive and reversible.** v1's Mongo dump is kept read-only. Every migrated row carries `source_system = 'homeflow_v1'` and `source_record_id = <mongo id>` in the event log, so provenance survives.

| Mongo collection (rows) | Postgres table | Transform |
|---|---|---|
| `projects` (10) | `project` | + `product_type` from `type`, `status` map (Active→active, Handover→handover, Closed→closed); `legal_entity`, `jurisdiction`, `rera_reg_no` = NULL until admin fills |
| `units` (33) | `unit` + `project_hierarchy_node` | `tower`/`floor` strings → nodes (create tower node if non-null); `status` map (Available→available, Booked→booked, Registered→registered, Handed Over→handed_over); `carpet_area_sqft`→`carpet_area` |
| `customers` (32) + `applicants[]` | `customer` + `booking_applicant` | Primary applicant → `booking_applicant.role=primary` per booking; co-applicants → `co_applicant` rows. `nri_status` → `customer_type`. |
| `bookings` (31) | `booking` | `code`→`booking_number`; status map (Draft→draft, Confirmed→active, Cancelled→cancelled); `agreement_value_inr`→`total_consideration`; `booking_amount_inr`→`token_amount`; `sales_owner_id`, `crm_owner_id`→`rm_owner_id` |
| `payment_schedules` (6) + `payment_milestones` (17) | `payment_plan` (one per schedule) + `demand` | milestone status computed on read in v1 → stored `status` in 2.0, recomputed once at migration |
| `payments` (6) | `receipt` | `verification_status` Verified→`reconciled`, Pending→`posted`, Disputed→ demand `status=disputed`, Waived→ demand `status=waived` |
| `tds_records` (6), `financial_clearances` (6) | `tds_record`, `financial_clearance` | as-is |
| `loan_cases` (3) + `loan_events` (11) | `loan_case` + events in `event` | |
| `legal_records` (5) + `legal_versions` (6) | `generated_document` (one row per version) | `status` map: Draft→draft, Under Review→draft, Approved→legal_approved, Rejected→rejected |
| `documents` (228) + `document_versions` (33) | `generated_document` (family = category) or `file_object` | KYC/compliance docs → `file_object` with `entity_type=booking`; generated agreements → `generated_document` |
| `attachments` (87, GridFS) | `file_object` + S3 objects | key = `{project_id}/{entity_type}/{entity_id}/{attachment_id}` |
| `registrations` (5) | `registration_case` | |
| `unit_readiness` (3) | `unit_progress_state` (14 rows per unit) | **percent → state**: 0→`not_started`, 1–99→`in_progress`, 100→`complete`; `ready_for_qa=true` → `qa_evidence` rows pending. Weights → readiness config. |
| `snags` (6) | `snag` | severity map; `booking_id`→ derive `unit_id` (already present) |
| `handovers` (3) | `handover_record` + `handover_gate` rows | override → `override_authority_id`, `override_reason` |
| `customer_commitments` (11) | `commitment` | `direction=pranava_to_customer`; `visibility` from `customer_visible` |
| `communications` (3) | `communication` | |
| `escalations` (9) | `escalation` | |
| `sales_handovers` (13) | `booking` fields + `event` rows | sections → `completeness_score`; accept/return history → events |
| `customer_journeys` (25) + `journey_stage_instances` (200) + `journey_subprocess_instances` (200) + `tasks` (303) | `journey_instance`, `stage_instance`, `action` | see stage mapping §3 |
| `workflow_*` (2 templates, 16 stages, 16 subprocesses, 26 task templates, 26 deps) | `journey_template` + versions | template version 1 = migrated; future edits create version 2 |
| `users` (12), `roles` (13), `departments` (15) | `user`, `role`, `department`, `project_team_assignment` | passwords are **not** migrated — nothing stores passwords; staff sign in with Google Workspace, customers with OTP |
| `comments` (20), `mentions` (12), `notifications` (38) | same names | |
| `audit_logs` (1,040) | **archive** (read-only table `v1_audit_log`) | not converted to `event` |
| `counters` | Postgres sequences | `CUS-000xxx`, `BKG-000xxx` formats preserved |

Rows whose booking cannot be resolved go to a `migration_review` table, never dropped.

---

## 3. Journey template mapping — v1's 8 stages → PDF's 11

v1's seeded Villa/Apartment templates are, in effect, East Crest's SOP as config — which is exactly what PDF §35 asks for. The mapping:

| v1 stage (dept, weight) | PDF §5 stage | Gap to fill |
|---|---|---|
| — | **0 Unit / Pre-Sales Readiness** | NEW — unit twin + gates exist before booking (this repo has it) |
| 1 Sales Handover (SALES, .05) | **1 Booking & Allotment** | direct |
| 2 Documentation (CRM, .10) | **2 Funding** + **3 Agreement & Documentation** | split: KYC/funding route vs agreement |
| 3 Legal (LEGAL, .10) | **3 Agreement & Documentation** | direct |
| 4 Payments (ACCOUNTS, .15) | **5 Demands & Collections** | direct; runs in parallel, not after Legal |
| 5 Registration (REGISTRATION, .20) | **6 Pre-Registration** + **7 Registration** | split at H7 financial clearance |
| 6 Unit Readiness (PROJECTS, .20) | **4 Construction & Unit Journey** + **8 Pre-Handover** | construction is continuous from stage 0; readiness is the pre-handover convergence |
| 7 Snagging (QA, .10) | **8 Pre-Handover Readiness** | direct |
| 8 Handover (HANDOVER, .10) | **9 Handover & Possession** | direct |
| — | **10 Post-Handover / Facilities** | NEW — DLP, warranty, passport (this repo has a thin slice) |

Rule from §34.2: numbering is for comprehension; **dependencies and gates govern execution**. v1's engine already runs stages sequentially (`_recompute_stage` kicks the next stage). 2.0 must let Payments, Legal and Construction run in parallel — the change is in template data (dependencies), not engine code.

---

## 4. Identity migration — replacing the Emergent broker

1. One Google OAuth client (Pranava's Workspace) with redirect URIs for `localhost:8001` and `homeflow.pranava.in`; client secret in Secrets Manager / `.env`.
2. `kernel/identity`: `/auth/google` → redirect; `/auth/callback` → verify ID token against Google's JWKS, require `hd = pranava.in`, look up `user.email` (must exist — users are provisioned, never self-registered), create a `session` row, set the cookie.
3. Each active v1 `user` migrates as-is (email, role and project assignments) into `user`, `user_role_assignment`, `project_team_assignment`. Password hashes are dropped.
4. Session middleware loads the session and `role_ids` + `authorized_project_ids` from Postgres into the request context and the RLS session GUC.
5. Customers: `/auth/otp/request` (booking mobile → WhatsApp/SMS via the notifications adapter) and `/auth/otp/verify` → `session` row with `kind = customer`.
6. Delete `routers/auth.py::google_login`, `login`, `refresh`, the `auth.emergentagent.com` redirect on `/login`, and `auth_utils.py`'s bcrypt/JWT code.
7. Local: real Google works from `localhost`; `HOMEFLOW_DEV_LOGIN=1` exposes `/auth/dev-login?user=` for seeded users; OTP codes print to the API log.

---

## 5. Order of migration (what moves first)

1. **Freeze v1** at `7854b05`. Stop feature work there.
2. Bring `backend/` and `frontend/` into this monorepo as `services/api` and `apps/workspace` (replacing the TS API and the 8-screen workspace, whose engines are ported into Python in step 5).
3. Postgres schema from [`data-model.md`](data-model.md) + role specs, as Alembic migrations. RLS policies in the same migrations.
4. Migration script: §2 table by table, idempotent, `migration_review` for orphans. GridFS → S3.
5. Port the pure engines from this repo's TS into `services/api/domain/`: `gates.ts`, `collections.ts`, `clearance.ts`, `readiness.ts`, `handover.ts`, `tower.ts`, `legal.ts` (≈1.5k lines, all with existing tests to translate).
6. Event log + `events` port wired into every existing mutation.
7. Action kernel; `tasks` / `snags` / `commitments` / `escalations` become Action-backed.
8. Identity (§4). RLS switched on.
9. Then the role slices from `roles/*/spec.md` in the documented build order.

Acceptance for the migration itself: every v1 screen renders the same data from Postgres that it rendered from Mongo, for every seeded role, before any new feature is added.

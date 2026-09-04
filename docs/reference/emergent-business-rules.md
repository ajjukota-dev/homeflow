# Emergent HomeFlow — extracted business rules

**Purpose.** The Emergent app (`../emergent-homeflow`, FastAPI + MongoDB) is the most detailed record we have of Pranava's *business decisions*. Under our spec those decisions are **configuration data** (Policy Studio), not code. This document lists every rule, lookup table, template and threshold in that app so a developer can turn it into seed config and tests in this repo **without porting any Python**.

**How to read.**
- Every path is relative to `emergent-homeflow/backend/`. `file:line` cites the rule's source.
- **code** = the process the app *enforces*. **seed** = what the AI chose as demo data (`seed.py`) — a weaker signal, still worth asking Pranava about.
- Enum strings, weights and thresholds are quoted verbatim. Our spec uses `snake_case`/`SCREAMING_SNAKE`; Emergent uses Title Case. Map, don't copy.
- `⚠ conflicts with spec:` marks a place where the Emergent decision contradicts `docs/spec/`. Spec wins; the flag tells you what to ask Pranava.
- Section 16 maps every finding to a TODO task.

Research date 2026-09-05. Emergent commit as checked out that day.

---

## 1. Roles & RBAC matrix

**Source:** `rbac_matrix.py` (525 lines), `rbac_redact.py`, `auth_scope.py`, `seed.py:21-34`. Maps to **Vivek 11** (role-gated mutations), **Vivek 12** (RLS).

### 1.1 Roles — 11 canonical permission rows, 12 seeded DB roles

| Canonical code (`rbac_matrix.py:25-40`) | Seeded `Role.name` (`seed.py:22-33`) | Notes |
|---|---|---|
| `super_admin` | Super Admin | `admin` on every module |
| `management` | Management | read-everything + `write` on `approvals`, `comments` |
| `sales` | Sales | |
| `crm` | CRM | |
| `accounts` | Accounts | |
| `banking` | Banking | Also sees only loan/payment journey stages (§1.4) |
| `legal` | Legal | |
| `registration` | Registration | |
| `site_engineer` | Site, QA, Handover (3 DB rows) | `ROLE_ALIASES` folds `SITE`, `QA`, `HANDOVER`, `SNAGGING`, `SITE_PROJECTS` → `site_engineer` (`rbac_matrix.py:45-70`) |
| `facility` | Facility | |
| `customer` | *(not seeded)* | `PERMISSION_MATRIX[CUSTOMER] = {}` — "Customer role is disabled" (`rbac_matrix.py:454-455`) |

Seed: SITE/QA/HANDOVER are three separate DB roles that share one permission row. Ask Pranava whether QA is really the same authority as Site — our spec (`roles/qa/spec.md`) says it is not ("independent QA verification").

### 1.2 Permission levels (`rbac_matrix.py:9-18, 460-467`)

`none` (0) < `read` = `read_status_only` = `read_limited` (1) < `write` (2) < `admin` (3). `read_status_only` = GET allowed, **financial amount fields nulled**; `read_limited` = GET allowed, **PII fields nulled**. "Consumers must apply the paired redactor" — the level alone does not redact.

### 1.3 Role × module matrix (`rbac_matrix.py:128-455`)

31 modules. `SA` = super_admin (admin everywhere, omitted). Abbrev: **R** read · **S** read_status_only · **L** read_limited · **W** write · `·` none.

| module | mgmt | sales | crm | accounts | banking | legal | registration | site_eng | facility |
|---|---|---|---|---|---|---|---|---|---|
| `dashboard` | R | R | R | R | R | R | R | R | R |
| `customer_overview` | R | R | W | R | R | R | R | L | L |
| `customer_journey` | R | R | W | R | R | R | R | · | · |
| `customer_tasks` | R | · | W | R | R | R | R | W¹ | · |
| `customer_documents` | R | · | R | R | R | W | R | · | · |
| `customer_financials` | R | · | R² | W | R | S | S | · | · |
| `customer_loan` | R | · | R | R | W | R | R | · | · |
| `customer_legal` | R | · | R | · | · | W | R | · | · |
| `customer_registration` | R | · | R | · | · | W | W | · | · |
| `customer_unit_readiness` | R | · | R | · | · | · | · | W | W |
| `customer_snags` | R | · | R | · | · | · | · | W | W |
| `customer_commitments` | R | R | W | R | · | R | R | · | · |
| `customer_communications` | R | W | W | · | · | · | · | · | · |
| `customer_handover` | R | · | R | · | · | · | · | W | W |
| `customer_activity` | R | R | R | R | R | R | R | R | R |
| `customer_audit` | R | · | R | R | · | R | R | · | · |
| `sales_handover` | R | W | W | · | · | · | · | · | · |
| `documents` | R | · | R | R | R | W | R | · | · |
| `collections` | R | · | S | W | R | S | · | · | · |
| `loans` | R | · | R | R | W | R | R | · | · |
| `legal` | R | · | R | · | · | W | R | · | · |
| `registrations` | R | · | R | · | · | W | W | · | · |
| `unit_readiness` | R | · | R | · | · | · | · | W | W |
| `snagging` | R | · | R | · | · | · | · | W | W |
| `handovers` | R | · | R | · | · | · | · | W | W |
| `commitments` | R | R | W | R | · | R | R | · | · |
| `communications` | R | W | W | · | · | · | · | · | · |
| `escalations` | R | R | W | R | R | R | R | · | · |
| `approvals` | W | R | W | W | R | W | W | W | · |
| `notifications` | R | R | R | R | R | R | R | R | R |
| `comments` | W | W | W | W | W | W | W | W | W |
| `reports` | R | · | R | R | · | R | R | · | · |
| `administration` | · | · | · | · | · | · | · | · | · |

¹ "constrained to site/QA/handover subprocess tasks (checked in-router)" (`rbac_matrix.py:386`). ² "bumped from read_status_only: CRM sees actual amounts on Customer 360" (`rbac_matrix.py:208`).

Confirms the spec's core invariant: **Sales and CRM have no write on `unit_readiness`, `snagging`, `handovers`** — matches `gates.md` A.7 and TODO Vivek 11's "Sales gets 403" tests.

### 1.4 Journey-stage visibility override

`JOURNEY_STAGE_VISIBILITY = {"banking": ["Home Loan", "HomeLoan", "HOME_LOAN", "Loan", "LOAN", "Payments"]}` (`rbac_matrix.py:515-526`) — Banking sees only those stage names; every other role sees all stages.

### 1.5 Field redaction (`rbac_redact.py`)

| Redaction | Trigger | Fields nulled | Affected roles |
|---|---|---|---|
| Financial | module perm ∈ {`read_status_only`, `none`} on `customer_financials` / `collections` | 55 names, `rbac_redact.py:108-131`: `agreement_value_inr`, `booking_amount_inr`, `base_price_inr`, `discount`, `brokerage`, `demand_amount_inr`, `amount_inr`, `outstanding_inr`, `balance_inr`, `overdue_inr`, `tax_inr`, `gst`, `planned_amount_inr`, `total_due_inr`, `total_received_inr`, `total_outstanding_inr`, `total_overdue_inr`, `future_receivable_inr`, `received_verified_inr`, `received_pending_inr`, `sanctioned_amount_inr`, `requested_amount_inr`, `own_contribution_inr`, `disbursement_amount_inr`, `disbursed_amount_inr`, `tds_amount_inr`, `gross_amount_inr` (+ un-suffixed twins) | `legal`, `registration` (S); `site_engineer`, `facility` (none). Recurses one level into `milestones`/`payments`/`events`/`schedule.milestones` (`:150-169`) |
| PII | perm ∈ {`read_limited`, `none`} on `customer_overview` | Customer: `phone, alt_phone, email, pan, aadhaar, passport, oci, oci_number, address, address_line, city, state, pincode, co_applicants, nri_status, communication_preference` (`:54-65`). Applicant: `email, phone, pan, aadhaar, passport, oci, oci_number, kyc_documents` | `site_engineer`, `facility` only |

Seed all of this as a **field-sensitivity map** (module → field → min level), not as code branches.

### 1.6 Project scoping (`auth_scope.py`)

- `ALL_PROJECTS_ROLES = {"SUPER_ADMIN", "MANAGEMENT"}` bypass scoping (`:23, 30-31`). Everyone else: `user.assigned_project_ids` — a flat array on the user document (`models.py:85`), no join table, no effective dating.
- `scope_filter_direct()` returns `None` / `{"project_id": {"$in": scope}}` / `{"__empty__": True}` (`:245-252`). **Each router must merge it by hand** (`bookings.py:61-64`, `master.py:280-284`).
- Read-by-id outside scope → **404** (leak-safe, `:123-126`); writes → **403** (`:117-120`). Keep this asymmetry.
- Entity → project resolution is polymorphic: `project_id_of_entity` walks `booking_id`/`customer_id` for 14 collections (`:184-226`); a customer can span projects → returns a **set** (`:137-141`).

⚠ conflicts with spec: `data-model.md §4` — RLS "enforced at the DB layer, not just the API". Emergent is API-layer filtering a router can forget. ⚠ conflicts with spec: `data-model.md §3.1` — no `ProjectTeamAssignment`, no `effective_from/to`, no `backup_owner_id` / `escalation_manager_id`.

---

## 2. Journey / workflow templates

**Source:** `seed.py:705-957`, `workflow_engine.py`, `routers/workflow.py`, `engine_hooks.py`. Maps to **Vivek 14** (Journey/SLA engine), **Amarsh 11** (Universal Action).

Two templates, `"Villa Post-Sales Workflow"` and `"Apartment Post-Sales Workflow"` (`seed.py:721, 870`). `"Commercial Office"` units reuse the Apartment template (`routers/bookings.py:191-193`). **They differ in exactly one place** — T11's checklist (§2.3). Everything else is identical. (**seed**: two near-identical templates is a demo choice; our config should be one template + a product-type overlay.)

### 2.1 Stages (`seed.py:725-858`) — all `mandatory: True`, one subprocess each

| # | Stage | `dept_code` | weight | Subprocess (owner) |
|---|---|---|---|---|
| 1 | Sales Handover | SALES | 0.05 | Handover to CRM (SALES) |
| 2 | Documentation | CRM | 0.10 | Customer KYC (CRM) |
| 3 | Legal | LEGAL | 0.10 | Agreement (LEGAL) |
| 4 | Payments | ACCOUNTS | 0.15 | Booking Amount (ACCOUNTS) |
| 5 | Registration | REGISTRATION | 0.20 | SRO Scheduling (REGISTRATION) |
| 6 | Unit Readiness | PROJECTS | 0.20 | Final Fit-Out (PROJECTS) |
| 7 | Snagging | QA | 0.10 | Pre-Handover Inspection (QA) |
| 8 | Handover | HANDOVER | 0.10 | Possession (HANDOVER) |

Weights sum 1.00 → `journey_percentage` = weighted mean of stage `progress_percentage` (`workflow_engine.py:669-716`). All subprocesses use `completion_rule: "all_mandatory_tasks_done"`.

⚠ conflicts with spec: `handshakes.md` stage map has 11 customer-journey stages (Pre-Sales … Funding … Construction … Collections … Post-Handover). Emergent's 8 are a **department pipeline**; "Payments" holds only the booking-amount receipt. Use its SLA days and task shapes, not its stage list.

### 2.2 Task templates (`seed.py:731-853`)

`task_type` ∈ {`"Mandatory"`, `"Conditional"`}. `execution_type` ∈ {`"Simple"`, `"Verification"`, `"Evidence"`, `"Approval"`, `"Checklist"`} — `"External"` is checked in `tasks.py:672` but **never seeded**; `external_party` (`"Customer"`, `"SRO"`) is a separate field. Keep both enums — they answer different questions (inclusion vs. how it closes).

| Key | Title | Dept | type | exec | owner role | priority | SLA days | Rule / notes |
|---|---|---|---|---|---|---|---|---|
| T1 | Submit booking pack to CRM | SALES | Mandatory | Simple | SALES | High | 2 | entry point |
| T2 | CRM accept handover | CRM | Mandatory | Verification | SALES | High | 3 | `verifier_role=CRM` |
| T3 | Collect PAN + Address proof | CRM | Mandatory | Evidence | CRM | High | 7 | doc category `KYC`, verifier CRM |
| T4 | NRI declaration | CRM | **Conditional** | Evidence | CRM | Medium | 10 | `"customer.nri_status in ['NRI','OCI']"` (`seed.py:757`) |
| T5 | Draft agreement | LEGAL | Mandatory | Simple | LEGAL | High | 5 | domain-gated (§3.3) |
| T6 | Legal approval | LEGAL | Mandatory | Approval | LEGAL | High | 3 | `approver_role=LEGAL` |
| T7 | Booking amount receipt | ACCOUNTS | Mandatory | Evidence | ACCOUNTS | High | 3 | doc category `Booking` |
| T8 | TDS challan verify | ACCOUNTS | Mandatory | Evidence | ACCOUNTS | High | 5 | doc category `TDS` |
| T9 | Confirm customer availability | REGISTRATION | Mandatory | Simple | REGISTRATION | Medium | 4 | `external_party="Customer"` |
| T10 | Book SRO slot | REGISTRATION | Mandatory | Evidence | REGISTRATION | High | 3 | doc category `Registration`, `external_party="SRO"` |
| T11 | Site declares Ready-for-QA | PROJECTS | Mandatory | Checklist | SITE | High | 30 | entry point of site branch |
| T12 | QA inspection sign-off | QA | Mandatory | Simple | QA | High | 7 | |
| T13 | Customer acknowledgement | HANDOVER | Mandatory | Verification | HANDOVER | **Critical** | 3 | `verifier_role=HANDOVER`, `external_party="Customer"` |

`due_date = now + sla_days` (`workflow_engine.py:236-243`). The brief said T1–T12; the app has **13**. The SLA-days column is the only per-task duration Pranava has (implicitly) approved — seed it as `SlaPolicy` rows.

### 2.3 T11 checklist (`seed.py:707-718`) — the only Villa/Apartment difference

Both: `civil`, `electrical`, `plumbing`, `painting`, `cleaning` (all `required: True`). Apartment adds `tower_deps` ("Tower dependencies"), `access_card` ("Access card").

### 2.4 Dependency edges (`seed.py:936-951`, all `dependency_type: "FinishToStart"`)

T1 → T2 → {T3, T4, T7} · T3 → T5 → T6 · T7 → T8 · {T6, T8} → T9 → T10 · T11 → T12 · {T10, T12} → T13. Two chains (commercial, physical) joining at T13.

### 2.5 Engine rules (`workflow_engine.py` unless noted)

| Rule | Behaviour | Source |
|---|---|---|
| Conditional DSL | `^scope.field (==\|!=\|in\|not in) value$`, scope ∈ {customer, booking, unit, project}. **Fails open** — unparseable rule ⇒ include task | `:61-116` |
| Conditional filtering | evaluated **once at journey creation**; a false rule means the task is never instantiated (Resident = 12 tasks, NRI/OCI = 13) | `:223-226` |
| Idempotent create | existing `Active`/`OnHold` journey for the booking is returned, never duplicated | `:121-141` |
| Initial state | stage 1 + its subprocess `In Progress`; all others `Not Started`; all tasks `Not Started` | `:180-213, 273` |
| Owner autofill | SALES→`booking.sales_owner_id`; CRM→`booking.crm_owner_id`; else the single active user matching dept+role, else null | `:338-357` |
| Prerequisite gate | `compute_blocker`: any prereq not in `TERMINAL_STATUSES = {"Completed","Cancelled"}` ⇒ `"Blocked by: {title} (owner: {dept})"`. Computed on read, never stored. **Cancelled satisfies a dependency** | `:44, 362-394` |
| Cascade | subprocess completes ⇒ next subprocess `In Progress`; stage completes ⇒ next stage + first subprocess `In Progress`; all stages done ⇒ `journey.status="Closed"`. **Tasks are never auto-started** — dependents need `/start` | `:424-432, 525-716` |
| Reverse cascade | reopening a `Completed` task resets every transitive dependent that had progressed back to `Not Started`, clearing verification/approval | `:435-522`; `engine_hooks.py:141-207` |
| System completion | domain routers complete T5–T13 via `system_complete_task` / `system_verify_task`, stamping `override_flag=True` | `engine_hooks.py:39-103` |
| Hold / resume | `Active`→`OnHold` needs `reason`; resume only from `OnHold` | `routers/workflow.py:247-280` |
| Close | Super Admin only, `reason` required, from any status | `routers/workflow.py:283-300` |
| Mark N/A | subprocess owner dept or SA; blocked if `Completed`; sets `"Not Applicable"` + cancels every non-terminal task with `cancel_reason="Subprocess NA: {reason}"` | `routers/workflow.py:310-370` |

⚠ conflicts with spec: `universal-action.md §1` — tasks, snags, escalations, commitments are separate collections with separate state vocabularies; the spec normalises all into one `Action`. ⚠ `universal-action.md §4` — no baseline/current/forecast/actual dates, no SLA pause; only `due_date` + an `Overdue` read-time overlay (`workflow_engine.py:397-419`).

---

## 3. Task state machine

**Source:** `routers/tasks.py`, `workflow_engine.py:25-48`. Maps to **Amarsh 11**.

### 3.1 Statuses

`TASK_STATUSES = {"Not Started", "In Progress", "Waiting for Customer", "Waiting for Internal Team", "Waiting for External Party", "Blocked", "Awaiting Verification", "Awaiting Approval", "Completed", "Cancelled"}`. `"Blocked"` is **never written** — blocking is the computed `blocker_reason` overlay. `display_status: "Overdue"` is likewise an overlay. Sub-states `verification_status` / `approval_status` ∈ {`"Not Required"`, `"Pending"`, `"Verified"|"Approved"`, `"Rejected"`}.

### 3.2 Transitions (`routers/tasks.py`)

| Endpoint | From → To | Guard |
|---|---|---|
| `/start` `:352-370` | `Not Started` → `In Progress` | authorised actor; `compute_blocker` empty; auto-assigns owner |
| `/checklist` `:397-430` | auto `Not Started`→`In Progress` | exec `Checklist` only; **no prereq check** |
| `/attach-evidence` `:433-461` | auto `Not Started`→`In Progress` | exec ∈ {Evidence, Verification, Approval}; domain gate |
| `/submit-for-verification` `:464-479` | → `Awaiting Verification` | exec ∈ {Evidence, Verification}; domain gate |
| `/verify` `:482-561` | Verified: Verification-type → `Completed`, Evidence-type → `In Progress`; Rejected → `In Progress` | caller role == `task.verifier_role`; **self-verify guard** `"Cannot verify a task you own"` (`:496-497`) |
| `/submit-for-approval` `:564-579` | → `Awaiting Approval` | exec `Approval`; domain gate |
| `/approve` `:582-626` | Approved → `Completed`; Rejected → `In Progress` | SA, `MANAGEMENT`, or `task.approver_role`; **self-approve guard** `"Cannot approve your own task"` (`:602-603`) |
| `/complete` `:629-692` | → `Completed` | blocker empty; per exec type: Checklist all required ticked · Evidence ≥1 attachment **with `verification_status=="Verified"`** (`"Cannot complete: evidence not verified"`, `:661`) · Verification `Verified` · Approval `Approved` · External non-empty `external_reference` |
| `/set-status` `:695-719` | → `In Progress` or a `WAITING_STATUSES` member | reason required for waiting |
| `/cancel` `:722-744` | any but `Completed` → `Cancelled` | **Super Admin only**, reason |
| `/skip-mandatory` `:747-772` | → `Cancelled`, `override_flag=True`, `"MANDATORY OVERRIDE: {reason}"` | Super Admin only |
| `/assign` `:373-394` | no status change | SA or owner; **no status guard** |

Who may act (`_authorised_to_act`, `:304-316`): SA; owner; or, if unassigned, any user whose dept + role match the task. 🐛 Both self-guards test the *current* owner, and `/assign` has no status guard — reassign-then-verify defeats them. Ours should key on the submitter, as Amarsh 18 does for Legal.

### 3.3 Domain gate — T5–T13 are read-only on `/tasks`

`DOMAIN_GATED_KEYS` (`tasks.py:47-57`): T5/T6 → "Legal" · **T7 → "Financials"** ("Verify the payment for the booking amount there.") · **T8 → "Financials"** ("Verify the TDS challan there (or mark it Not Applicable).") · T9/T10 → "Registration" · T11 → "Unit Readiness" · T12 → "Snagging" · T13 → "Handover". Wired as `_lock_check_task` before body validation on evidence/verify/approve/complete (`:75-83`); `/start`, `/assign`, `/checklist`, `/set-status`, `/cancel`, `/skip-mandatory` bypass it. `_finance_gate = _domain_gate` is a back-compat alias (`:72`) — the "finance gate" is this general rule. Message: `"Task {key} is managed automatically via the {screen} screen. {hint}"`. Business meaning: T5–T13 are **system-authored** by domain screens — our "Action created by a handshake" model.

**Carry forward** (spec is silent): self-verify/self-approve guards; evidence must be *verified*, not merely attached; cancelled-satisfies-dependency; reverse cascade on reopen; system-authored completion flagged.

---

## 4. Sales → CRM handover

**Source:** `routers/sales_handovers.py` (552 lines). Maps to **H2** (`handshakes.md`), **Vivek 20**, our `services/api/src/bookings.ts`.

### 4.1 The packet — 5 sections (`:42-95`)

| Section | Fields |
|---|---|
| `customer_section` | `applicant_details_confirmed`, `contact_verified`, `nri_status_confirmed`, `communication_pref_confirmed`, `notes` |
| `commercial_section` | `final_price_inr`, `discount_inr`, `payment_plan_ref`, `booking_amount_inr`, `approved_deviations`, `brokerage_percent`, `brokerage_inr`, `taxes_summary`, `notes` |
| `unit_section` | `unit_confirmed`, `parking_count`, `facing_confirmed`, `specifications_notes` |
| `documents_section` | `booking_form_uploaded`, `cost_sheet_uploaded`, `kyc_complete`, `approval_notes_uploaded`, `linked_document_ids` |
| `commitments_section` | `{"items": []}` — promoted to real commitments on submit (§9) |

### 4.2 Completeness — binary, not a score (`_validate_handover`, `:188-228`)

All four customer booleans truthy · `final_price_inr`, `booking_amount_inr` present · `payment_plan_ref` non-empty · `unit_confirmed` · documents `"Booking Form"` **and** `"Cost Sheet"` exist with status ∉ {`None`, `"Required"`, `"Rejected"`}. Failure → 400 `{"message":"Validation failed","errors":{field: msg}}`. **No `completeness_score` anywhere in the backend** (grep: 0 hits). `approved_deviations` is stored but never required.

### 4.3 Lifecycle (`:117, 399-509`)

`"Draft"` (auto-created on first GET of a `Confirmed` booking) → `"Submitted"` (from Draft/Returned) → `"Accepted"` (from Submitted) | `"Returned"` (from Submitted **or Accepted**; second return on Returned → 409, `:493-494`).

| Action | Who | Side effects |
|---|---|---|
| PATCH / submit | booking's `sales_owner_id` or SA (`:163-164, 370-371, 402-403`) | submit: promote commitments; **T1 → Completed** `"Handover submitted to CRM"` (`:428-436`) |
| accept | role `"CRM"` or SA; **submitter cannot accept own** (`:451-455`) | **T2 → Verified/Completed** (`:475-480`) |
| return | CRM or SA; not own (`:499-502`); `reason` free text | **T2 → In Progress**; comment on T2 mentioning Sales owner `"Handover returned for clarification: {reason}"` (`:525-542`) |

### 4.4 Versus our spec and `bookings.ts`

| H2 requirement | Emergent | Our `bookings.ts` |
|---|---|---|
| `completeness_score` ≥ threshold | ✗ binary validator | ✓ `assessCompleteness` 0–100, gate `score < 100` (`:16-32, 57-62`) |
| mandatory-doc checklist by project/product/customer type | ✗ hardcoded Booking Form + Cost Sheet; `nri_status_confirmed` drives nothing (but §8.1 has the NRI/OCI rows) | partial: `MANDATORY_DOCS = ["PAN card","Address proof","Photograph"]` constant (`:7`) |
| commercial approvals attached | ✗ stored, not checked | ✗ |
| Customer Twin born on accept | ✗ customer exists before booking | ✓ (`:109-114`) |
| assign `rm_owner_id` | ✗ `crm_owner_id` set at booking creation | hardcoded `"Priya Nair"` (`:96`) — TODO Amarsh 22 |
| start Journey Instance on accept | ✗ journey created at booking **Confirmed** (`bookings.py:182-199`), before the handover exists | ✗ (Vivek 14) |
| onboarding Actions | ✗ | ✗ (Amarsh 11) |
| structured return reason | ✗ free text | free text `return_reason` (`:124`) — Vivek 20 taxonomy |
| return only from `submitted` | returns allowed from **Accepted** | none — TODO Vivek 2 |

What Emergent has that our gate lacks: **explicit confirmations** (contact verified, NRI status confirmed, comms preference, unit/facing/parking confirmed) and **two uploaded documents**. Seed the packet's field list as the H2 mandatory-field checklist.

⚠ conflicts with spec: `handshakes.md H2` "no Customer Twin exists until acceptance" — Emergent creates the customer first and books against it. Ask Pranava which order matches their desk reality; Emergent's "return after accept" is an explicit choice (`:495-496`) our spec forbids.

---

## 5. Payments, collections, TDS, financial clearance

**Source:** `routers/payments.py`, `collections.py`, `tds.py`, `financial_clearance.py`, `seed.py:1287-1382`. Maps to **Amarsh 15**, **H7** / `clearance.ts`, Amarsh 2/5 (done).

### 5.1 Payment schedule templates (`payments.py:231-265`) — code, generated on demand

| `template_name` | splits (share, day offset) | milestone names |
|---|---|---|
| `"30-40-30"` | 0.30@0 · 0.40@span/2 · 0.30@span | Booking Amount · On Foundation · On Possession |
| `"Construction Linked (10-40-40-10)"` | 0.10@0 · 0.40@span/3 · 0.40@2span/3 · 0.10@span | Booking Amount · On Slab 1 · On Slab 3 · On Handover |
| `"Handover Bias (20-60-20)"` | 0.20@0 · 0.60@span/2 · 0.20@span | Booking Amount · During Construction · On Handover |

`span = max(30, handover − booking)`, handover defaults to booking + 365 d (`:238-240`). **seed** uses only `"30-40-30"` (`seed.py:1287-1315`). Note these are **date-driven**, not construction-event-driven — ⚠ conflicts with spec: `gates.md A.3` / TODO Amarsh 5 (demand due only when the construction trigger fires).

Schedule validation (`:268-338`): exactly one `is_booking_amount=true` · ≥1 milestone · sum within `max(1.0, total×0.01)` of `agreement + tax` · one schedule per booking · booking must be `"Confirmed"`.

### 5.2 Milestone status — computed on read (`payments.py:144-184`)

Priority order: `"Disputed"` (any payment disputed) → `"Waived"` (all waived) → `"Paid"` (verified ≥ due) → `"Partially Paid"` (verified > 0) → `"Overdue"` (days > 0) → `"Due"` (0) → `"Due Soon"` (−7…−1) → `"Not Due"`. Only `"Verified"` payments count toward paid.

`alert_flag` (`:128-141`): `overdue_30` ≥30 · `overdue_15` ≥15 · `overdue_7` ≥7 · `due_today` · `due_7_days` (−7…−1) · `None` if Paid/Waived. Maps directly to Amarsh 24 pre-breach alerts.

### 5.3 Payment modes and verification

`ALLOWED_MODES = {"Bank Transfer", "Cheque", "DD", "RTGS", "NEFT", "UPI", "Other"}` (`:40`) — **no Cash**. Verification: `"Pending"` (default) → `"Verified"` | `"Disputed"` (reason) | `"Waived"` (**Super Admin**, reason). Cannot verify/dispute a waived payment (`:605-608, 648-649`); delete only `Pending` and only SA (`:696-697`). Verify cascade: booking-amount milestone fully verified ⇒ **T7 completes** (`:620-634`).

### 5.4 Ageing buckets (`collections.py:27-43`)

`BUCKETS = ["Current", "1-7", "8-15", "16-30", "31-60", "61-90", "90+"]` on `days_overdue`; includes milestones with status ∈ {Overdue, Partially Paid, Due, Disputed} and `balance_inr > 0` (`:217-229`). Separate `overdue-30` counter (`:181-196`). **Inconsistency:** `reports.py:204` uses a *different* bucket set `0-30/31-60/61-90/91-180/181-365/365+`. Pick one, seed it once.

### 5.5 TDS (`routers/tds.py`)

Fields (`:85-104`): `applicability`, `na_reason`, `tds_amount_inr`, `deducted_from_payment_id`, `challan_number`, `challan_date`, `pan_number`, `customer_confirmed`, `uploaded_attachment_id`, `verification_status`, `verified_by/at`, `verification_notes`.

`applicability` ∈ {`"Not Determined"` (default), `"Applicable"`, `"Not Applicable"` (needs `na_reason`)} (`:88, 127-132`). `verification_status` ∈ {`"Pending"`, `"Not Required"`, `"Verified"`, `"Rejected"`} (`:146, 258-259`). Verify requires Applicable **and** all of `tds_amount_inr, challan_number, challan_date, pan_number, uploaded_attachment_id` (`:264-273`). Cascade: Verified ⇒ T8 verified; Not Applicable ⇒ T8 cancelled; flip back ⇒ T8 reset (`:168-172, 293-309`).

**§194IA is not encoded.** No ₹50 lakh threshold, no 1 % rate anywhere in code; the only 1 % is demo data `seed.py:1555`. Applicability is a human decision. Our spec must decide this — candidate Open question.

### 5.6 Financial clearance — 7-item checklist (`financial_clearance.py:30-39`)

| # | key | default | required for approve? |
|---|---|---|---|
| 1 | `ledger_reconciled` | False | always |
| 2 | `due_amounts_paid` | False | always |
| 3 | `tds_verified` | False | always; **guard**: cannot set true unless TDS record `Verified` or `Not Applicable` (`:112-120`) |
| 4 | `bank_disbursement_received` | False | **only if #5 true** |
| 5 | `bank_disbursement_applicable` | False | never — gating flag, auto-set by Loans (§6) |
| 6 | `other_charges_cleared` | False | always |
| 7 | `exceptions_approved` | **True** | always |

`status` ∈ {`"Pending"`, `"Approved"`, `"Rejected"`}; approve → 400 `{"message":"Checklist incomplete","unmet":[…]}` (`:136-171`); Approved is immutable (`:106-107`). Docstring: "The approved record becomes the Registration gate consumed in Phase 6" (`:1-4`) — enforced in `registrations.py` `book-slot` (§7.3) and as the handover finance contributor (§10.3).

### 5.7 Versus `clearance.ts` (21 lines)

Ours: `paid/consideration ≥ threshold_pct` and `disputed == 0`. Missing everything above: checklist, TDS state machine + cross-module guard, loan-conditional item, ageing, milestone status, alert flags, approve/reject with immutability, waiver path. The H7 payload's `outstanding_breakdown{due, overdue, disputed, loan_pending}` maps onto Emergent's `/collections/customer/{id}` snapshot (`collections.py:89-109`): `outstanding_inr`, `overdue_inr`, `received_pending_inr`, `future_receivable_inr`, `tds_status`, `financial_clearance_status`.

---

## 6. Loans

**Source:** `routers/loans.py`. Maps to **Amarsh 15**.

Fields (`:199-217`): `bank_name`, `bank_branch`, `bank_rm_name`, `bank_rm_contact`, `requested_amount_inr`, `sanctioned_amount_inr`, `sanction_date`, `sanction_validity_date`, `current_stage`, `sanction_letter_attachment_id`, `blocker`, `notes`; computed `events[]`, `disbursed_amount_inr`.

`ALLOWED_STAGES = {"Application", "Sanction Pending", "Sanctioned", "Disbursement Pending", "Partially Disbursed", "Fully Disbursed", "Closed", "Rejected"}` (`:31-35`) — declared, never validated; `Sanction Pending`, `Disbursement Pending`, `Closed` are never set.

`ALLOWED_EVENT_TYPES = {"Application Submitted", "Sanctioned", "Disbursement Requested", "Disbursed", "Rejected", "Cancelled", "Blocker Recorded", "Blocker Resolved"}` (`:36-39`); `Disbursement Requested`, `Cancelled` never emitted.

Rules: one loan case per booking, booking `Confirmed`, `requested > 0` (`:190-195`); creating flips FC `bank_disbursement_applicable=true` (`:229`); reject flips it back and clears `bank_disbursement_received` (`:150-166, 382`). Disburse needs prior sanction; cumulative ≤ sanctioned + 1 % (`:295-305`); within tolerance ⇒ `Fully Disbursed` else `Partially Disbursed` (`:307-310`). Writers: `{"BANKING", "ACCOUNTS", "MANAGEMENT"}` or SA (`:50-52`).

⚠ conflicts with spec: `roles/accounts/spec.md:47` LoanCase `sanctioned → docs_pending → disbursement_scheduled → part_disbursed → fully_disbursed` starts at sanction; Emergent starts at `Application`. Spec adds `risk_score`, `days_to_demand`, `days_to_disbursement`, `missing_docs[]` — Emergent has none. Emergent has `sanction_validity_date` + expiry rule (§11) — spec lacks it; worth adding.

---

## 7. Legal & registration

**Source:** `routers/legal.py`, `registrations.py`, `document_generation.py`, `doc_templates/*`. Maps to **Amarsh 17, 18, 19**; compare `roles/legal/spec.md`, `handshakes.md H4/H8`.

### 7.1 Document families (`document_generation.py:37-65`) — hardcoded dict

| id | category | template | required fields |
|---|---|---|---|
| `sale_deed` | `"Sale Deed"` | `sale_deed.html` | `customer_id, booking_id, signatory_name, signatory_designation, witnesses` (≥2) |
| `agreement_of_sale` | `"Agreement"` | `agreement_of_sale.html` | same |
| `handover_document` | `"Handover"` | `handover_document.html` | same |

Jinja2, each `{% extends "_base.html" %}` and overrides `{% block body %}`; `_base.html` owns header, parties, unit table, commercial terms, dates, signatures. Merge fields are a hand-built context (`:141-207`): `customer.primary_name`, `applicant.name/pan`, `money.agreement_value/booking_amount/base_price`, `dates.booking_date/agreement_date/possession_date`, `witnesses[].name/address`… Context is **read live** on every render — no data snapshot. **Draft watermark**: `is_approved = legal.status == "Approved"` (`:164`) → `body.is-draft` → CSS "DRAFT — NOT FOR EXECUTION" (`_shared.css:38-56`); header `X-Draft-Watermark` (`:350`). Generator role ∈ `{"MANAGEMENT","CRM","LEGAL"}` or SA (`:34, 91-93`). Generated PDFs land as `attachments` rows with `verification_status: "Uploaded"` (`:319`) and never touch `legal_records`.

No `LEASE` family (Amarsh 19). ⚠ conflicts with spec: `roles/legal/spec.md §2.2` — no `DocumentTemplate` entity (version, approval, effective dates, jurisdiction), no `ClauseLibrary`, no snapshot freeze (§1.3 step 3, acceptance #4), no `ExecutionRecord`/eSign/customer-approve. `_validate_payload` (`:210-226`) checks only the request body, never source-record completeness — ⚠ `handshakes.md H4` "link to source" and `legal/spec.md #6` (Sale Deed needs H7 + executed AOS + KYC). **Keep** the watermark-until-approved rule.

### 7.2 Legal record (`legal.py`) — manual draft review, separate from generation

`ALLOWED_STATUS = {"Not Started", "Draft Uploaded", "Under Review", "Deviations Raised", "Approved", "Rejected"}` (`:44-47`, declared but never enforced). Real graph: `Not Started → Draft Uploaded ⇄ Under Review ⇄ Deviations Raised → Approved`; `Rejected` reachable from **any** state (`reject` has no precondition, `:352-375`); Rejected → Draft Uploaded on next upload.

| Endpoint | From → To | Rule |
|---|---|---|
| `upload-draft` `:211-255` | Not Started/Rejected → `Draft Uploaded`; new `legal_versions` row `version+1` | blocked if Approved: `"Legal is Approved — cannot upload new draft. Reject first to reopen."`; first upload completes **T5** |
| `submit-for-review` `:258-272` | Draft Uploaded/Deviations Raised → `Under Review` | |
| `raise-deviation` `:275-295` | Draft Uploaded/Under Review → `Deviations Raised` + `deviation_notes` | |
| `resolve-deviations` `:298-316` | Deviations Raised → `Under Review` | |
| `approve` `:319-349` | Draft Uploaded/Under Review/Deviations Raised → `Approved` | needs `latest_draft_attachment_id`; completes **T5, T6** |
| `reject` `:352-375` | any → `Rejected` + `rejection_reason` | reverse-cascades T6, T5 |

Writers for every endpoint: `{"LEGAL", "MANAGEMENT"}` or SA (`:58-60`) — **same person can upload and approve.** ⚠ conflicts with spec: `roles/legal/spec.md` hard rule #3 / TODO Amarsh 18 (segregation of duties). Versions are of *uploaded drafts*, not regenerated documents with diff (Amarsh 17).

### 7.3 Registration (`registrations.py`)

`Not Started → Availability Confirmed → Slot Booked → Executed → Closed`. Readiness flags `legal_ready / tds_ready / fc_ready` + `is_blocked` are computed on read (`:115-142, 431`), never stored.

| Step | Who | Precondition (all checked, errors collected) | Cascade |
|---|---|---|---|
| `confirm-availability` `:211-233` | `{"CRM","REGISTRATION","MANAGEMENT"}` (`:49-50`) | T6 Completed — `"Legal approval (T6) not complete"` | T9 |
| `book-slot` `:236-287` | `{"REGISTRATION","MANAGEMENT"}` (`:53-54`) | T6 Completed · TDS (`Not Applicable` or `Verified` or T8 Completed) — `"TDS not verified (or not marked Not Applicable)"` · status Availability Confirmed · **FC `Approved`** — `"Financial clearance not approved"` (`:265-267`) | T10; fields `sro_office`, `slot_reference_no`, `slot_date` |
| `mark-executed` `:290-312` | same | Slot Booked | none; sets `executed_date`, `registration_document_number`, `company_representative`, `customer_attendees`, `outcome_notes` |
| `upload-registered-deed` `:315-378` | same | Executed → `Closed`; `registered_sale_deed_attachment_id` | **none** — no unit status change, no event |

This is Emergent's **Pre-Registration Readiness gate** (finance + TDS + legal + customer availability) and the place **H7 gates registration**. ⚠ conflicts with spec: `handshakes.md H8` — closing never sets `Unit.sale_status → registered`, emits nothing, stores no `sro_reference`/`registered_at`/`unit_id`/`project_id`. ⚠ `roles/legal/spec.md §2.2` `RegistrationCase.status{not_ready→readiness_in_progress→ready→slot_booked→completed}` — Emergent adds `Availability Confirmed` (customer scheduling) and splits `Executed`/`Closed`. Both extra states are real desk steps worth keeping.

---

## 8. Documents checklist

**Source:** `routers/documents.py`, `document_seed.py`, `collaboration.py:50-56`. Maps to **Amarsh 17**, **Vivek 20**.

`ALLOWED_CATEGORIES` (`documents.py:40-44`, 14): `PAN, Identity Proof, Address Proof, Passport, OCI, Booking Form, Cost Sheet, Agreement, TDS, Loan Documents, Registration Documents, POA, Handover Documents, Other`. Generated-PDF categories `"Sale Deed"` and `"Handover"` (§7.1) are **not** in this set — a generated deed can never satisfy its checklist row. Task templates' `required_document_category` (`KYC`, `Booking`, `TDS`, `Registration`, §2.2) also don't match — seed inconsistency.

### 8.1 Checklist seeded per booking (`document_seed.py:24-66`) — code, runs on journey creation

| Rows | Categories (all `required: True`) | Condition |
|---|---|---|
| `BASE_ROWS` | PAN card · Government ID (Identity Proof) · Address proof · Signed booking form · Cost sheet · Sale agreement | always |
| `NRI_ROWS` | Passport | `nri_status in ("NRI", "OCI")` |
| `OCI_ROWS` | OCI card | `nri_status == "OCI"` |
| `LATER_STAGE_ROWS` | Registration set · Handover pack | always |
| `POA_ROW` | Power of Attorney — `required: False, applicable: False, status: "Not Applicable", na_reason: "Default"` | always |

`NriStatus = Literal["Resident","NRI","OCI"]`, default `"Resident"` (`models.py:192, 218`). Resident = 9 rows, NRI = 10, OCI = 11. `TDS` and `Loan Documents` are never seeded. Idempotent on `(customer_id, booking_id, category)` (`:69-80`). This is the **H2 "mandatory-doc checklist by customer type"** our spec asks for and `bookings.ts` hardcodes as three strings.

### 8.2 Verifier per category (`documents.py:47-62`)

| Verifier role | Categories |
|---|---|
| `CRM` | PAN, Identity Proof, Address Proof, Passport, OCI, Booking Form, Cost Sheet, Other |
| `LEGAL` | Agreement, POA |
| `ACCOUNTS` | TDS, Loan Documents |
| `REGISTRATION` | Registration Documents |
| `HANDOVER` | Handover Documents |

`MANAGEMENT` and SA may verify anything (`:101-107`). A second, smaller map `CATEGORY_TO_VERIFIER_DEPT_CODE = {"TDS": "ACCOUNTS", "Loan": "BANKING", "Registration": "REGISTRATION", "Agreement": "LEGAL", "KYC": "CRM"}` (`collaboration.py:50-56`) drives upload notifications and says **Loan → BANKING**, contradicting the table above (ACCOUNTS). Pick one.

### 8.3 Statuses and versioning

Document `status` (write sites): `"Required"` (default, `:209`) · `"Not Applicable"` (`mark-na`, CRM/SA, reason, `:268`) · `"Received"` (upload by non-Sales, `:392`) · `"Under Review"` (**upload by `SALES`**, `:392`) · `"Verified"` / `"Rejected"` (`:424-425, 458`) · `"Expired"` (`:309`). Attachment `verification_status` ∈ `("Uploaded", "Under Review", "Verified", "Rejected")` (`collaboration.py:64`).

Re-upload (`:316-419`): only guard is `applicable`; **a `Verified` document can be re-uploaded** and silently reverts to `Received`/`Under Review` (re-verification required); `version+1` row added, old rows kept but never marked superseded. ⚠ conflicts with spec: `roles/legal/spec.md §1.5` #4 "final executed/registered docs are read-only" and §1.6 states `Required → Requested → Received → Validating → Accepted/Rejected → Superseded → Expired`. Keep the category→verifier table and NRI/OCI rows; take the state machine from the spec.

---

## 9. Commitments (Promise Ledger)

**Source:** `routers/commitments.py` (431 lines). Maps to **Vivek 20**; compare `roles/crm-rm/spec.md §1.5`, `customer-twin.md §2.5`.

Fields (`:198-223`): `code` (`COM-{seq:06d}`), `customer_id`, `booking_id`, `unit_id`, `category`, `description`, `committed_by`, `committed_date`, `responsible_department_id`, `owner_user_id`, `target_date`, `financial_impact_inr`, `approval_required`, `approval_status`, `approver_user_id`, `approved_at`, `approval_notes`, `delivery_status`, `customer_confirmation_required`, `customer_confirmed_at`, `evidence_attachment_ids`; computed `overdue`.

`ALLOWED_CATEGORIES = {"Modification", "Commercial Promise", "Timeline Promise", "Complimentary Item", "Specification Upgrade", "Other"}` (`:28-31`).

**Two state dimensions.** `approval_status` ∈ {`"Not Required"`, `"Pending"`, `"Approved"`, `"Rejected"`}. `delivery_status`: `"Draft"` → `"Awaiting Approval"` → `"Approved"`/`"Rejected"` → `"In Progress"` → `"Completed"` → `"Customer Confirmed"`, side-exit `"Cancelled"`. Sets (`:33-35`): `DELIVERY_TERMINAL = {"Completed","Customer Confirmed","Rejected","Cancelled"}`, `DELIVERY_LOCKED_FROM_DELETE = {"Approved","In Progress","Completed","Customer Confirmed"}`.

| Transition | Guard |
|---|---|
| submit-for-approval `:281-286` | from Draft |
| approve `:294-324` | from Awaiting Approval; **MANAGEMENT or SA**; `"Cannot approve your own commitment"` (`:305-306`) |
| start `:332-345` | Approved, or Draft with `approval_required=false`; owner autofilled |
| complete `:357-368` | from In Progress; SA/owner/Management same dept — **no evidence check** |
| customer-confirm `:379-388` | from Completed; **CRM** or SA |
| cancel `:400-409` | not Completed/Customer Confirmed; SA only, reason |
| delete `:417-431` | SA only; **hard delete**; blocked in locked set — `"Critical customer commitments cannot be deleted."` |

**Overdue** = `target_date < now(UTC)` and `delivery_status ∉ DELIVERY_TERMINAL`; computed on read, never stored (`:80-96`). First escalation fires **3 days after** due (§11) — there is no pre-breach alert.

### 9.1 Field-by-field vs our Promise Ledger

| Spec | Emergent | Verdict |
|---|---|---|
| `owner` required before active | `owner_user_id` optional; `/start` never checks it | ✗ weaker |
| `due_date` required | `target_date` optional | ✗ weaker |
| one status `draft→approved→active→at_risk→fulfilled\|breached\|waived_cancelled` | two enums; no `at_risk`, no `breached` (only an overdue flag) | ⚠ conflicts with spec: `crm-rm/spec.md §1.5` |
| evidence requirement gate | `evidence_attachment_ids` exists, never written after create, never checked | ✗ dead field (spec §1.4 rule 5) |
| `visibility` | absent | ✗ (H10) |
| pre-breach alert | none | ✗ (spec acceptance #7) |
| approver | Management | ⚠ conflicts with spec: `crm-rm/spec.md §1.1` CRM "capture, approve, and track" — ask Pranava |
| hard delete | `delete_one` on Draft/Awaiting/Rejected/Cancelled | ⚠ conflicts with spec: `data-model.md §5` no hard deletes |
| — | `category`, `financial_impact_inr`, `responsible_department_id`, `customer_confirmation_required/at`, separate approval track | ✓ richer — carry forward |

Handover commitments gate uses `delivery_status ∈ {"Awaiting Approval","In Progress"}` as "open" (§10.3) — the input `handover.ts` Vivek 20 must supply.

---

## 10. Snags, unit readiness, handover

**Source:** `routers/snags.py`, `unit_readiness.py`, `handovers.py`. Maps to **Amarsh 20**, **Amarsh 12**; compare `readiness.ts`, `handover.ts`, `gates.md B`.

### 10.1 Snags

`SEVERITIES = {"Critical", "Major", "Minor"}` (`snags.py:38`). `STATUSES = {"Open", "Assigned", "In Progress", "Ready for Verification", "Verified", "Closed", "Reopened"}` (`:39`) — `Verified` is a decision value, never stored. Rooms (`:36`): Living, Kitchen, Master Bedroom, Bedroom 2, Bedroom 3, Bathroom 1, Bathroom 2, Utility, Balcony, Common, Other. Categories (`:37`): Civil, Electrical, Plumbing, Painting, Flooring, Fittings, Cleaning, Other. Code `SNG-{seq:06d}` (`:202`).

Rules: submit-for-verification needs an **after-photo** (`:383-384`); create/edit QA/SITE/MANAGEMENT; verify QA/MANAGEMENT; reopen QA/HANDOVER/MANAGEMENT; delete SA and only from `Open` (`:46-55, 444-451`). **T12 cascade** (`:66-86`): all Critical snags `Closed` **and** T11 Completed ⇒ T12 completes; a new/reopened Critical after T12 ⇒ T12 reset. Only Critical blocks — no minor-snag policy (`gates.md B.1`). Our qa spec adds `Ready for QA`, root cause, repeat flag, cost — Emergent has none.

### 10.2 Unit readiness — 14 weighted components (`unit_readiness.py:35-51`)

| Component | w | Component | w |
|---|---|---|---|
| Civil | 0.15 | Kitchen | 0.10 |
| Flooring | 0.10 | HVAC | 0.05 |
| Doors | 0.05 | Utilities | 0.05 |
| Windows | 0.05 | External Works | 0.05 |
| Painting | 0.10 | Cleaning | 0.03 |
| Electrical | 0.10 | Common Area Dependencies | 0.02 |
| Plumbing | 0.10 | | |
| Sanitary | 0.05 | | Σ = 1.00 |

`score = round(Σ percent × weight, 2)` (`:63-64`), `percent` **typed 0–100** by SITE/MANAGEMENT (`:126-151`). `declare-ready-for-qa` needs `score ≥ 85` **and ≥ 2 photos** (`:214-218`) ⇒ T11 completes; `reset-ready` SA only, reverse-cascades T11→T12→T13.

⚠ conflicts with spec: `roles/qa/spec.md §1.1` "derived from evidence, not typed %" and `readiness.ts:1`. **Keep the 14 components and weights as `ComponentDefinition` config (Vivek 13); replace `percent` with per-component evidence state** (`passed/failed/reverified`, qa spec §1.5). The 85 threshold and 2-photo minimum are Policy Studio values.

### 10.3 Handover readiness (`handovers.py`)

`WEIGHTS = {"finance": 0.20, "registration": 0.20, "readiness": 0.25, "snagging": 0.15, "documents": 0.10, "commitments": 0.10}` (`:35-38`). Contributors (`:62-99`): finance 100 iff FC `Approved`; registration 100 iff status ∈ {`Slot Booked`, `Executed`, `Closed`} (**registration counts as ready from Slot Booked**); readiness = unit score, ready iff ≥ 85; snagging 100 iff zero open Critical; documents = % of mandatory+applicable verified; commitments = `100 − 20 × open`, floor 0.

`gate_status` (`:142-151`): **Green** score ≥ 90 and no blockers · **Red** score < 70 or a critical blocker (text starts `Financial`/`Registration`/`Unit readiness` or contains `critical snag`, `:119`) · **Amber** otherwise; override lifts Red → Amber only, never Green.

Acknowledgement (execute) requires Green **or any override present** (`:378-383`). Override (`:449-469`): **MANAGEMENT or SA**, non-empty `reason`, free-text `mandatory_gates_bypassed[]` substring-matched against blockers (`:137-140`); **no evidence, no per-gate object, no non-overridable class**.

Handover `status` ∈ {`"Not Started"`, `"Scheduling"`, `"Ready"`, `"Executed"`, `"Closed"`} (`:163-169`); executing sets `unit.status = "Handed Over"` + T13.

Checklist groups (`:227-231`): `property` {cleaning, electrical, plumbing, fixtures, doors_windows, snag_clearance} · `keys` {main_door_count, secondary_count, utility_count, other_count, all_handed_over} · `access` {access_cards_count, parking_slot_ids, clubhouse_confirmed, security_briefed} · `utilities` {electricity_meter_no, electricity_reading, water_meter_no, water_reading, other_notes} · `documents` {possession_letter, warranties, manuals, registration_copy, maintenance_docs, contact_directory}. Post-handover close requires `facility_intro_done, maintenance_setup_done, owner_record_transferred, warranties_shared, pending_snag_monitoring` (`:514-517`) — this is our **H12** payload.

⚠ conflicts with spec: `gates.md B.1–B.4` — one weighted score + one blanket override vs 8 typed hard/soft gates each with `open/passed/overridden`, `override_authority_id/reason/evidence_ids`, safety never overridable. No `legal`, `customer`, `fm` gate in Emergent. ⚠ `gates.md:158` — Emergent conflates gate state and handover lifecycle. Our 90-line `handover.ts` is already closer to spec than Emergent's 612 lines; take Emergent's **checklist items, weights and thresholds (90/70/85, −20 per open commitment)** as config to confirm, not its model.

---

## 11. Escalations

**Source:** `escalation_rules.py`, `routers/escalations.py`. Maps to **Amarsh 24**, **Amarsh 11** (SLA), Amarsh 23 (materiality).

`OPEN_STATUSES = {"Open", "Acknowledged", "In Progress"}` (`:20`). Full statuses (`escalations.py:24`): + `"Resolved"`, `"Closed"`. `SEVERITIES = {"Low","Medium","High","Critical"}` (`:23`). Code `ESC-{seq:06d}`.

### 11.1 Rule registry (`escalation_rules.py:249-263`) — all hardcoded, all day-based, **no ₹ thresholds**

| `rule_key` | sev | dept | condition (source rows) | threshold |
|---|---|---|---|---|
| `commitment_overdue_3d` | Medium | CRM | commitment `delivery_status ∈ {Awaiting Approval, In Progress}`, `target_date` past | ≥ 3 d |
| `commitment_overdue_7d` | High | CRM | same | ≥ 7 d |
| `payment_overdue_15d` | High | ACCOUNTS | milestone `status == "Overdue"` | ≥ 15 d |
| `payment_overdue_30d` | Critical | ACCOUNTS | same | ≥ 30 d |
| `tds_pending_verification_5d` | Medium | ACCOUNTS | tds `status ∈ {Applicable, Pending}` age | ≥ 5 d |
| `loan_sanction_delay_15d` | High | BANKING | loan `current_stage ∈ {Application, Sanction Pending}` age | ≥ 15 d |
| `loan_sanction_validity_expiring_7d` | High | BANKING | `sanction_validity_date` set, not Fully Disbursed | 0–7 d left |
| `legal_review_pending_5d` | Medium | LEGAL | legal `status ∈ {Under Review, Deviations Raised}` since `updated_at` | ≥ 5 d |
| `registration_ready_slot_not_booked_3d` | High | REGISTRATION | registration `Availability Confirmed` and `slot_date` null | ≥ 3 d |
| `critical_snag_open_2d` | Critical | QA | snag Critical, not Closed | ≥ 2 d |
| `handover_at_risk_15d` | High | HANDOVER | `scheduled.final_date` within window and gate Amber/Red | 0–15 d left |
| `handover_at_risk_7d` | Critical | HANDOVER | same | 0–7 d left |
| `customer_query_unresolved_48h` | Medium | CRM | communication Inbound, `follow_up_required`, `follow_up_date` past | ≥ 2 d |

**Idempotency:** unique on `(rule_key, source_entity_id)` while status ∈ OPEN (`:308-327`). **Auto-close:** condition clears ⇒ `"Closed"`, `resolution_notes="Auto-resolved: condition no longer met"` (`:329-347`). Escalation creation notifies every active user in the target dept (`:297-304`).

Transitions (`escalations.py:201-267`): acknowledge from Open · start from Open/Acknowledged · resolve needs `resolution_notes` · close from Resolved/In Progress, **MANAGEMENT/SA** · reopen from Resolved/Closed with reason. `/scan` MANAGEMENT/SA.

Map to spec: the 3d/7d and 15d/30d pairs are Emergent's version of the **L2→L3 ladder** (`universal-action.md §3`); seed them as `SlaPolicy` rows + Amarsh 23 materiality thresholds. ⚠ conflicts with spec: `universal-action.md §3` escalation has `source_action_id`, `tier L2–L4`, `decision_pack`, `category {customer,cash,handover,reputation,margin}` — Emergent has severity + dept only. Also `department-sla` report hardcodes "simple SLA = 7 days" (`reports.py:308`).

---

## 12. Notifications & collaboration

**Source:** `collaboration.py`, `routers/comments.py`, `routers/notifications.py`, `routers/attachments.py`. Maps to **Amarsh 24**, **H10**.

**Visibility:** `VISIBILITY_CHOICES = ("Internal", "Customer Visible")` (`collaboration.py:63`), default `"Internal"`. `CUSTOMER_VISIBLE_ROLE_CODES = {"MANAGEMENT", "CRM", "LEGAL"}` + SA (`:68, 94-95`); violation → 403 `"Only CRM, Legal, Management or Super Admin can post Customer Visible comments."` (`comments.py:139-145`). ⚠ conflicts with spec: `handshakes.md H10` — CRM is the *only* approver; Emergent lets Legal and Management publish directly, and there is no preview/approval queue (`CustomerUpdateApproval`). Posting is publishing.

`VERIFY_ROLE_CODES = {"MANAGEMENT", "ACCOUNTS", "LEGAL", "REGISTRATION", "QA", "CRM"}` (`:71`). Comment status `("Active", "Resolved", "Deleted")`; 30-min self-edit window (`comments.py:39`); one level of threading (`:156-157`); soft delete `body="[deleted]"` (`:358-374`); only top-level threads resolvable (`:332-333`).

**Notification triggers** — the complete list:

| `type_` | Trigger | Source |
|---|---|---|
| `mention` | @user / @department in a comment or task comment | `comments.py:80-103`, `engine_hooks.py:253-262` |
| `reply` | reply to a parent comment → parent author | `comments.py:105-116` |
| `file_uploaded` | file attached into a thread → mentioned users | `attachments.py:173-186` |
| `verification_requested` | upload in a verifier category → dept via `CATEGORY_TO_VERIFIER_DEPT_CODE` | `attachments.py:188-200` |
| `verification_completed` | doc marked → uploader | `attachments.py:361-373` |
| `ESCALATION_CREATED` | escalation → all active users in target dept | `escalations.py:173-178` |

Self-notify guard: actor never notifies self (`collaboration.py:136-137`). No digest, no quiet hours, no pre-breach alert (payment `alert_flag` §5.2 is never pushed) — all Amarsh 24.

---

## 13. Master data & codes

**Source:** `models.py`, `seed.py:36-48`, `db.py:65-74`, `routers/master.py`, `bookings.py`, `customers.py`. Maps to `data-model.md`.

**Departments** (`seed.py:36-48`, code): `SALES, CRM, ACCOUNTS, BANKING, LEGAL, REGISTRATION, PROJECTS, QA, HANDOVER, FACILITY, MANAGEMENT`. Role `SITE` → dept `PROJECTS` (`seed.py:59`). Our spec enum (`data-model.md §3.1`) lacks `BANKING`, `REGISTRATION`, `HANDOVER`, `FACILITY` as departments — decide whether they are departments or sub-teams.

**Codes** — `next_sequence(name)` atomic counter, format `f"{PREFIX}-{seq:06d}"` (`db.py:65-74`):

| Entity | Prefix | Source |
|---|---|---|
| Customer | `CUS-` | `customers.py:74` |
| Booking | `BKG-` | `bookings.py:100` |
| Snag | `SNG-` | `snags.py:202` |
| Escalation | `ESC-` | `escalations.py:155` |
| Commitment | `COM-` | `commitments.py:200` |
| Communication | `COM-` | `communications.py:116` — **prefix collision**, different counters |

No codes for Unit, Project, Registration, Legal, Loan, FC, TDS, Handover, Milestone. Unit/Project codes are user-typed, unique per scope (`master.py:306-307, 434-435`). Our `bookings.ts:65` uses `"BK-" + uuid[0:8]` — align with `BKG-000001`.

**Unit** (`models.py:148-188`): `project_id, code, tower, floor, unit_no, unit_type, carpet_area_sqft, facing, parking_count, status, base_price_inr`. `UnitStatus = ["Available","Booked","Registered","Handed Over"]`; `UNIT_TYPES = {"Apartment","Villa","Commercial Office"}` (`master.py:409`); `facing` free string (seed: East/West/North/South). Needs `tower` or `floor` (`master.py:412-420`). Spec has, Emergent lacks: `hierarchy_node_id`, `built_up_area`, `saleable_area`, `uds_land_share`, `held`, facing enum. Emergent has, spec lacks: **`base_price_inr`** on Unit.

**Project** (`models.py:117-146`): `code, name, type ∈ {"Apartment","Villa"}, location, status ∈ {"Active","Handover","Closed"}`. Spec has `legal_entity`, `jurisdiction`, `rera_reg_no`, `calendar_id` — Emergent has none.

**Booking** (`models.py:250-301`): `BookingStatus = ["Draft","Confirmed","Cancelled"]`; `ALLOWED_TRANSITIONS = {"Draft": {"Confirmed","Cancelled"}, "Confirmed": {"Cancelled"}, "Cancelled": set()}`. Cancel needs reason: `"Cancellation reason is required"` (`bookings.py:163-164`); Confirmed ⇒ unit `Booked` + journey created; Cancelled ⇒ unit `Available`, journey closed `"Booking cancelled: {reason}"` (`:174-218`); cancelled bookings frozen (`:128-129`); delete only Draft (`:253-254`). Fields: `sales_owner_id, crm_owner_id, booking_date, agreement_value_inr, booking_amount_inr, payment_plan (string), cancellation_reason, notes`. No `submitted/crm_accepted/active/transferred`, no `predecessor_booking_id` — ⚠ conflicts with spec: `data-model.md §2.4` (our richer enum is right; Emergent's handover object carries the missing states, §4).

**Applicants** (`customers.py:20-27`): `MAX_APPLICANTS = 4  # primary + 3 co-applicants`, stored on **Customer**, fields `name, relation (free), email, phone, pan, kyc_status`. ⚠ conflicts with spec: `data-model.md §2.6` — no `BookingApplicant` join, no role enum, no "exactly one primary", no `ownership_pct`. Carry the **max 4** into config.

---

## 14. Exec dashboard & reports

**Source:** `routers/exec_dashboard.py`, `routers/reports.py`. Maps to **Amarsh 22**, Amarsh 23.

**KPIs** (`/exec-dashboard/summary`, `:33-186`): `active_journeys` · `handovers_ready_this_month` (Green in calendar month) · `handovers_at_risk_30d` (Amber/Red within 30 d) · `revenue_at_risk_inr` (Σ `agreement_value_inr` of High/Critical journeys ∪ at-risk handovers) · `escalations_open_critical` · `escalations_open_high` · `broken_commitments_overdue` · `tds_pending_count` · `fc_pending_count` (status ≠ Approved) · `top_5_bottleneck_stages` (median cycle days per stage, `:146-173`).

**Exceptions feed** (`:189-342`, "spec §78"), sorted severity ↓ then age ↓: `journey_high_risk` · `collection_overdue_30d` (> 30 d) · `registration_blocked` (`Not Started` > 7 d) · `sanction_expiring` (0–7 d) · `commitment_overdue_7d` · `critical_snag` · `escalation_sla_breach` (≥ 7 d). These thresholds duplicate §11 — one Policy Studio table should feed both (Amarsh 23).

**8 reports** (`reports.py:1`, all `format=json|csv`, project-scoped): `handover-forecast` (window, readiness, gate, blockers top-3) · `registration-pipeline` (legal/tds/fc ready flags, slot, days since availability) · `collections-ageing` (its own buckets, §5.4) · `escalations` · `commitments` · `department-sla` (open, `exceeding_sla_7d`, median age) · `handover-delay` (original vs latest date from `date_revision_history`, slippage, revisions) · `tds-pending`. `handover-delay` is the one place Emergent keeps a **date revision history** — matches `universal-action.md §4`; nothing else does.

---

## 15. Locale & formatting

**Source:** grep of `backend/**/*.py`. Maps to **Amarsh 9a**.

- `Asia/Kolkata`, `ZoneInfo`, `pytz`: **0 hits**. `date.today()`: 0. `utcnow()`: 0 — the app uses `datetime.now(timezone.utc)` everywhere (75 sites, 35 files) via `db.utcnow_iso()` (`db.py:52-53`) and local `_now()`/`_today()` copies (`payments.py:43-48`, `exec_dashboard.py:21`, `reports.py:24`).
- **Same UTC-day bug as ours:** `days_delta = (_today().date() - due_dt.date()).days` (`payments.py:156`) feeds milestone status and `alert_flag`; `_days_since` in `exec_dashboard.py:24-30` / `reports.py:42-48` feeds every age; "this month" uses UTC month (`exec_dashboard.py:83-84`). Between 00:00 and 05:30 IST every due/overdue/age value is one day off. **Do not inherit.** Amarsh 9a's single `todayIst()` is the fix on both sides.
- Date display: `"%d %b %Y"` (`document_generation.py:136`) and `"%d %b %Y %H:%M"` for `generated_at_display` (`:204`) — the latter prints UTC on a legal document with no zone label.
- INR: one `_fmt_inr` (`document_generation.py:108-126`): ≥ 1 Cr → `₹X.XX Cr`, ≥ 1 L → `₹X.XX L`, else Indian grouping `X,XX,XXX`; `—` for ≤ 0. Used only in PDFs; APIs return raw numbers. Our `formatINR` (Vivek 15 `packages/ui`) should match the Cr/L abbreviation rule — confirm with Pranava whether documents may abbreviate (a sale deed normally prints the full figure).

---

## 16. Summary — inputs per TODO task

| Task | Seed / enforce from this document | § |
|---|---|---|
| Vivek 6 | `UNIT_TYPES` allow-list; unit needs tower **or** floor; `base_price_inr` on Unit | 13 |
| Vivek 8 | 404-outside-scope on reads, 403 on writes | 1.6 |
| Vivek 11 | 31-module × 9-role matrix as config; `read_status_only`/`read_limited` levels; financial + PII field maps; Banking stage filter; "Sales gets 403" on readiness/snags/handover | 1 |
| Vivek 12 | MANAGEMENT/SA bypass scope; customer spans projects (set); polymorphic project resolution table | 1.6 |
| Vivek 13 | everything marked **code** here is config seed; everything marked **seed** is demo; 14 readiness components = `ComponentDefinition` | all, 10.2 |
| Vivek 14 | 8 stages + weights; T1–T13 with dept, exec type, SLA days, conditional DSL; dependency edges; cascade/reverse-cascade; hold/resume/close/N-A; fail-open decision | 2, 3 |
| Vivek 15 | `formatINR` Cr/L rule; `BKG-000001` code style | 13, 15 |
| Vivek 20 | H2 packet field list; return-after-accept question; NRI/OCI doc rows; commitment fields/categories/two-track states/locked-delete set; open-commitment definition for handover gate; Customer Visible roles ⚠ | 4, 8.1, 9, 12 |
| Vivek 21 | customer can span projects — merge must keep that | 1.6 |
| Vivek 23 | handover `status` labels, checklist groups for portal Handover screen | 10.3 |
| Amarsh 4/5 | milestone status priority order; `alert_flag` thresholds; templates are date-driven ⚠ | 5.1–5.2 |
| Amarsh 8 | label maps: task statuses, milestone statuses, loan stages, snag statuses, handover status, registration status | 3, 5, 6, 7, 10 |
| Amarsh 9a | Emergent has the identical bug — regression test both stacks | 15 |
| Amarsh 11 | 10 task statuses → 8 Action states mapping; self-verify/approve guards (key on submitter); evidence-verified-before-close; domain-gated (system-authored) actions; priority enum | 2.5, 3 |
| Amarsh 12 | override = MANAGEMENT/SA + reason; Red→Amber-only rule; add evidence + per-gate + safety class (spec) | 10.3 |
| Amarsh 15 | 3 payment templates; modes (no Cash); verification states; ageing buckets (pick one of two); TDS fields + verify preconditions; 7-item FC checklist + guards; loan fields/stages/events; sanction-validity expiry | 5, 6 |
| Amarsh 17 | 3 document families + merge-field list; watermark-until-approved; legal status graph; document categories/statuses; category→verifier table | 7.1, 7.2, 8 |
| Amarsh 18 | SoD gap is real in Emergent (same role uploads + approves); Sale Deed has no prerequisite check | 7.1, 7.2 |
| Amarsh 19 | no LEASE exists — nothing to port, only the family/template shape | 7.1 |
| Amarsh 20 | severities, rooms, categories; after-photo before verification; T12 cascade rule; 14 components + weights as evidence config; 85 % + 2 photos | 10.1–10.2 |
| Amarsh 21 | post-handover close items (`facility_intro_done` …) = H12 payload | 10.3 |
| Amarsh 22 | 10 KPIs, 7 exception types, 8 reports; `handover-delay` revision history | 14 |
| Amarsh 23 | day thresholds 2/3/5/7/15/30 as materiality table; no ₹ thresholds exist — ask | 11, 14 |
| Amarsh 24 | 6 notification types; `alert_flag` ladder as pre-breach; 13 escalation rules; idempotency + auto-close | 5.2, 11, 12 |
| Amarsh 25 | `{message, errors{}}` / `{message, unmet[]}` error shapes to normalise | 4, 5 |

### Things the Emergent app decided that our spec is silent on (candidate Open questions for Pranava)

1. **Return after accept** — CRM may return an already-accepted handover (§4.3). Spec forbids.
2. **QA = Site authority?** SITE/QA/HANDOVER share one permission row (§1.1). Spec wants independent QA.
3. **§194IA** — TDS applicability is a human decision, no ₹50 L / 1 % rule (§5.5). Should the system compute it?
4. **Payment schedules are date-driven** (span/2, span/3), not construction-event-driven (§5.1). Which does Pranava actually bill on?
5. **Two ageing bucket sets** (§5.4). Which is the Accounts team's?
6. **`exceptions_approved` defaults True** in financial clearance (§5.6) — opt-out, not opt-in. Intentional?
7. **Cancelled prerequisite satisfies a dependency** (§2.5). Should a cancelled KYC task unblock the agreement?
8. **Conditional-rule parse failure includes the task** (§2.5). Fail open or fail closed?
9. **Legal and Management may post Customer Visible directly** without CRM approval (§12). Spec: CRM only, with preview.
10. **Who approves a commitment** — Management in Emergent (§9), CRM in our spec.
11. **Handover override needs no evidence and can cover "everything"** via free text (§10.3). Which gates may Management override, and which never?
12. **Readiness `percent` is typed by Site** (§10.2). Spec says evidence only — does Site accept per-component checklists instead?
13. **Registration counts as "ready" for handover from `Slot Booked`**, before execution (§10.3). Correct?
14. **No ₹ thresholds anywhere** — escalations are days-only (§11). What rupee exposure makes a delay material?
15. **Max 4 applicants** (§13). Confirm, and whether nominee/guarantor count.
16. **Departments** BANKING, REGISTRATION, HANDOVER, FACILITY exist as first-class departments (§13). Are they teams inside Accounts/Legal/QA, or their own?
17. **Loan documents verifier** — ACCOUNTS in one table, BANKING in another (§8.2). Which?
18. **Documents print UTC** with `Cr`/`L` abbreviations (§15). Acceptable on a sale deed?

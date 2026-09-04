# Emergent HomeFlow — business rules extracted for HomeFlow 2.0 seed config

**Purpose.** The Emergent app (`emergent-homeflow/`, FastAPI + MongoDB) is the most detailed record of Pranava's post-sales business decisions. Under our spec these are **configuration data** (Policy Studio / config seed — Vivek 13, 14), not code. This document lists every rule, lookup table, template and threshold found there so a developer can turn them into seed config and tests in `homeflow/` **without porting any Python**.

**Reading guide.**
- Every rule cites `file:line` relative to `emergent-homeflow/backend/`.
- **code** = the client's process as enforced by a router/engine. **seed** = what the AI chose as demo data (`seed.py`, `document_seed.py`). Seed values are candidates for Pranava to confirm, not facts.
- Strings are quoted verbatim — Emergent uses Title-Case enums (`"In Progress"`); our convention is `SCREAMING_SNAKE` / `snake_case`. Map, don't copy.
- `⚠ conflicts with spec:` marks a place where Emergent's decision contradicts `docs/spec/` (foundation wins).
- `🐛` marks a defect in Emergent, not a business rule — do not encode it.

Sections: 1 Roles/RBAC · 2 Journey templates · 3 Task state machine · 4 Sales→CRM handover · 5 Payments/TDS/clearance · 6 Loans · 7 Legal/registration · 8 Documents · 9 Commitments · 10 Snags/readiness/handover · 11 Escalations · 12 Notifications · 13 Master data · 14 Exec dashboard/reports · 15 Locale · 16 Summary.

---

## 1. Roles & RBAC matrix → Vivek 11 (Cognito + role-gated mutations), Vivek 12 (RLS)

### 1.1 The 11 canonical roles (`rbac_matrix.py:25-40`)

| Canonical key | DB role code(s) → alias (`rbac_matrix.py:45-70`) | Notes |
|---|---|---|
| `super_admin` | `SUPER_ADMIN` | Also `users.is_super_admin` flag (`auth_scope.py:31`). Admin on every module. |
| `management` | `MANAGEMENT` | Read everything; **write** on `approvals`, `comments` (`:159,161`). |
| `sales` | `SALES` | |
| `crm` | `CRM` | |
| `accounts` | `ACCOUNTS` | |
| `banking` | `BANKING`, `banking_loan`, `home_loan` | "Loan Team". |
| `legal` | `LEGAL` | |
| `registration` | `REGISTRATION` | Separate from Legal. |
| `site_engineer` | `SITE`, `site_projects`, `quality`, `qa`, `snagging`, `handover` | **QA, snagging and handover are collapsed into one role** (`:57-63`). |
| `facility` | `FACILITY` | Mirrors site_engineer scope, PII-limited (`:67-69`). |
| `customer` | `CUSTOMER` | **Disabled — empty matrix row** (`:454-455`). |

⚠ conflicts with spec: `data-model.md §3.1` department enum is `sales|crm|accounts|legal|project|qa|post_handover|management` — Emergent adds `banking`, `registration`, `facility` and merges `qa` into `site_engineer`. `gates.md A.7` keeps QA ("inspection/verification states") separate from Project/Construction ("physical progress"); the merged role lets the same person declare and verify. Emergent has no `post_handover` role and no customer login at all (`customer-transparency.md` assumes a portal).

### 1.2 Permission levels (`rbac_matrix.py:8-18, 460-467`)

`none(0) < read_status_only / read_limited / read (1) < write(2) < admin(3)`. `read_status_only` = GET allowed, **financial amounts nulled**; `read_limited` = GET allowed, **PII nulled**. Route guard: `require_module_by_method(module)` maps GET→`read`, anything else→`write` (`auth_scope.py:69-99`); a denied call returns `403 {"detail":"forbidden","module","required_action","your_role","your_permission"}` (`auth_scope.py:50-60`).

### 1.3 Role × module matrix (`rbac_matrix.py:127-456`)

33 modules (`rbac_matrix.py:91-125`). Key: `A` admin · `W` write · `R` read · `R$` read_status_only · `R-` read_limited · `·` none. SUPER_ADMIN = `A` everywhere (`:128`); CUSTOMER = `·` everywhere (`:455`).

| Module | MGMT | SALES | CRM | ACCTS | BANK | LEGAL | REGN | SITE | FACIL |
|---|---|---|---|---|---|---|---|---|---|
| dashboard | R | R | R | R | R | R | R | R | R |
| customer_overview | R | R | W | R | R | R | R | R- | R- |
| customer_journey | R | R | W | R | R | R | R | · | · |
| customer_tasks | R | · | W | R | R | R | R | W¹ | · |
| customer_documents | R | · | R | R | R | W | R | · | · |
| customer_financials | R | · | R² | W | R | R$ | R$ | · | · |
| customer_loan | R | · | R | R | W | R | R | · | · |
| customer_legal | R | · | R | · | · | W | R | · | · |
| customer_registration | R | · | R | · | · | W | W | · | · |
| customer_unit_readiness | R | · | R | · | · | · | · | W | W |
| customer_snags | R | · | R | · | · | · | · | W | W |
| customer_commitments | R | R | W | R | · | R | R | · | · |
| customer_communications | R | W | W | · | · | · | · | · | · |
| customer_handover | R | · | R | · | · | · | · | W | W |
| customer_activity | R | R | R | R | R | R | R | R | R |
| customer_audit | R | · | R | R | · | R | R | · | · |
| sales_handover | R | W | W | · | · | · | · | · | · |
| documents | R | · | R | R | R | W | R | · | · |
| collections | R | · | R$ | W | R | R$ | · | · | · |
| loans | R | · | R | R | W | R | R | · | · |
| legal | R | · | R | · | · | W | R | · | · |
| registrations | R | · | R | · | · | W | W | · | · |
| unit_readiness | R | · | R | · | · | · | · | W | W |
| snagging | R | · | R | · | · | · | · | W | W |
| handovers | R | · | R | · | · | · | · | W | W |
| commitments | R | R | W | R | · | R | R | · | · |
| communications | R | W | W | · | · | · | · | · | · |
| escalations | R | R | W | R | R | R | R | · | · |
| approvals | W | R | W | W | R | W | W | W | · |
| notifications | R | R | R | R | R | R | R | R | R |
| comments | W | W | W | W | W | W | W | W | W |
| reports | R | · | R | R | · | R | R | · | · |
| administration | · | · | · | · | · | · | · | · | · |

¹ "constrained to site/QA/handover subprocess tasks (checked in-router)" (`:386`). ² Comment: "bumped from read_status_only: CRM sees actual amounts on Customer 360 financials tab" (`:208`) — a deliberate client-facing decision.

Journey-rail visibility: `banking` sees only stages matching `["Home Loan","HomeLoan","HOME_LOAN","Loan","LOAN","Payments"]`; every other role sees all stages (`rbac_matrix.py:515-517`). The note at `:510-514` admits the seeded templates have **no Home Loan stage** — loan activity lives inside "Payments".

### 1.4 Field redaction (`rbac_redact.py`)

Redaction is matrix-driven: fields are set to `None` (never omitted) when the caller's permission on the governing module is `read_status_only`/`none` (financial) or `read_limited`/`none` (PII) (`rbac_redact.py:95, 156`).

| Set | Fields (verbatim) | Source |
|---|---|---|
| Customer PII | `phone, alt_phone, email, pan, aadhaar, passport, oci, oci_number, address, address_line, city, state, pincode, co_applicants, nri_status, communication_preference, communication_pref` | `rbac_redact.py:54-59` |
| Applicant PII | `email, phone, pan, aadhaar, passport, oci, oci_number, kyc_documents` | `:62-65` |
| Financial amounts | booking: `agreement_value(_inr), booking_amount(_inr), base_price(_inr), discount(_amount), brokerage(_amount)`; milestones/receipts: `demand_amount(_inr), amount, amount_received(_inr), outstanding(_inr), balance(_inr), overdue(_inr), tax*, gst*, planned_amount(_inr), total_due(_inr), total_received_inr, total_outstanding_inr, total_overdue_inr, outstanding_including_pending_inr, future_receivable_inr, received_verified_inr, received_pending_inr, total_agreement_value_inr, total_tax_inr`; loans: `sanctioned_amount(_inr), requested_amount(_inr), own_contribution(_inr), disbursement_amount(_inr), disbursed_amount_inr`; TDS: `tds_amount(_inr), gross_amount(_inr)` | `:108-131` |

Financial redaction recurses into nested `milestones`, `payments`, `events`, `schedule.milestones` (`:150-170`). **Use for Vivek 11:** the Legal/Registration "see status, not amounts" rule (`R$`) is a real client decision — spec has no equivalent; candidate for `ProjectTeamAssignment.permissions` (`data-model.md §3.1`).

### 1.5 Project scoping (`auth_scope.py`) → Vivek 12

| Rule | Mechanism | Source |
|---|---|---|
| All-projects roles | `ALL_PROJECTS_ROLES = {"SUPER_ADMIN","MANAGEMENT"}` or `is_super_admin` bypass scoping | `auth_scope.py:23, 30-31` |
| Everyone else | limited to `users.assigned_project_ids` | `:102-106` |
| List reads | Mongo `$in` filter fragment; empty scope short-circuits to `[]` with no DB call | `:245-252, 272-274` |
| Write guard | resolve entity → `project_id` → `403 "You do not have access to this project."` | `:117-120` |
| Read-by-id guard | **404 not 403** ("leak-safe: don't reveal existence") | `:123-126` |
| Customer scope | customer is accessible if **any** of their bookings is in scope (customers span projects) | `:137-148` |
| Polymorphic resolver | entity → `booking_id` → project; falls back to `customer_id` | `:184-226` |

Scoping is application-layer, not DB-layer. ⚠ conflicts with spec: `data-model.md §4` requires Postgres RLS "enforced at the DB layer, not just the API" — keep Emergent's *semantics* (404 on read-by-id, Management sees all projects, customer scope = union of booking projects), implement as RLS.

---

## 2. Journey / workflow templates → Vivek 14 (Journey/SLA engine), Amarsh 11 (Universal Action)

### 2.1 Two enums, not one (correction to our task list wording)

Every task template carries **both** `task_type ∈ {"Mandatory","Conditional"}` (drives inclusion and subprocess completion — `workflow_engine.py:223, 537`) and `execution_type ∈ {"Simple","Checklist","Evidence","Verification","Approval","External"}` (drives which endpoints apply — `routers/tasks.py:404, 439, 468, 568, 648-674`). Seeded side by side at `seed.py:916-917`. Do not collapse them.

### 2.2 Engine rules (code — apply to any template) `workflow_engine.py`

| Rule | Logic (verbatim) | Source |
|---|---|---|
| Prerequisite gating | prereq is unmet if `pre["status"] not in TERMINAL_STATUSES`, `TERMINAL_STATUSES = {"Completed","Cancelled"}` | `:378, :44` |
| **Cancelled satisfies a prerequisite** | consequence of the above — `skip-mandatory` unblocks dependents | `:44, :378` |
| Conditional inclusion at instantiation | `if tpl.get("task_type") == "Conditional" and not evaluate_conditional_rule(tpl.get("conditional_rule"), ctx): continue` | `:223-226` |
| Conditional DSL | `scope.field op value`, `op ∈ {==, !=, in, not in}`; **unparseable rule fails open** (task included, warning logged) | `:61-63, 79-82` |
| Rule on a Mandatory task is ignored | evaluation requires `task_type == "Conditional"` | `:223` |
| Subprocess completion | rule `"all_mandatory_tasks_done"`: all `Mandatory`/`Conditional` tasks terminal | `:536-538` |
| Cascade: subprocess → next subprocess (same stage) | next `Not Started` subprocess by `sequence` → `"In Progress"`, `started_at` | `:569-583` |
| Cascade: stage → next stage | next `Not Started` stage → `In Progress` + its first subprocess → `In Progress` | `:643-666` |
| **No task auto-start** | tasks are created `"Not Started"` and need explicit `/start` | `:273` |
| Reverse cascade on reopen | every transitive dependent past `Not Started` reset to `Not Started`, clearing verification/approval/waiting fields | `:465-522` (callers only in `engine_hooks.py:174,207`) |
| Journey auto-close | `Active → Closed` when every stage `Completed` or `Skipped` | `:701-702` |
| Journey % | stage-weighted: `Σ stage.progress_percentage × stage.weight` | `:682-686` |
| Declared but never written | subprocess `"Not Applicable"` + `na_reason` (`:48, :209`); task status `"Blocked"` (`:31`) | dead values |

Self-verify / self-approve guards live in `routers/tasks.py` (§3.3), not the engine.

### 2.3 Templates (seed) — one shape, two instances

Both `"Villa"` and `"Apartment"` templates come from one builder `_build_template_data(pt, apartment_extras)` (`seed.py:705-859, 870-871`). The **only** difference: Apartment adds two required checklist items to T11 — `tower_deps` "Tower dependencies", `access_card` "Access card" (`seed.py:714-718`). `unit_type == "Commercial Office"` reuses the Apartment template (`routers/bookings.py:191-193`).

**Stages** (weights sum to 1.00; each stage has exactly one subprocess with `completion_rule="all_mandatory_tasks_done"`) — `seed.py:726-857`:

| Seq | Stage | Dept | Weight | Subprocess |
|---|---|---|---|---|
| 1 | Sales Handover | SALES | 0.05 | Handover to CRM |
| 2 | Documentation | CRM | 0.10 | Customer KYC |
| 3 | Legal | LEGAL | 0.10 | Agreement |
| 4 | Payments | ACCOUNTS | 0.15 | Booking Amount |
| 5 | Registration | REGISTRATION | 0.20 | SRO Scheduling |
| 6 | Unit Readiness | PROJECTS | 0.20 | Final Fit-Out |
| 7 | Snagging | QA | 0.10 | Pre-Handover Inspection |
| 8 | Handover | HANDOVER | 0.10 | Possession |

⚠ conflicts with spec: `handshakes.md` stage map has 11 stages (0 Pre-Sales … 2 Funding … 4 Construction … 5 Collections … 10 Post-Handover). Emergent has no Funding/Loan, Construction, Collections or Post-Handover stage; "Payments" contains only the booking-amount receipt. The Emergent list is a **department pipeline**, not a customer journey — use its SLA days and task shapes, not its stage list.

**Task templates T1–T13** (`seed.py:731-854`; all `dependency_type="FinishToStart"`, wired at `:936-951`):

| Key | Title | task_type | execution_type | Dept / owner role | Priority | SLA days | Prereqs | Evidence / verify / approve config | External party |
|---|---|---|---|---|---|---|---|---|---|
| T1 | Submit booking pack to CRM | Mandatory | Simple | SALES / SALES | High | 2 | — | — | — |
| T2 | CRM accept handover | Mandatory | Verification | CRM / SALES | High | 3 | T1 | `verification_required=True, verifier_role="CRM"` | — |
| T3 | Collect PAN + Address proof | Mandatory | Evidence | CRM / CRM | High | 7 | T2 | evidence, `required_document_category="KYC"`, verifier `CRM` | — |
| T4 | NRI declaration | **Conditional** | Evidence | CRM / CRM | Medium | 10 | T2 | evidence, category `KYC`, verifier `CRM`; `conditional_rule = "customer.nri_status in ['NRI','OCI']"` | — |
| T5 | Draft agreement | Mandatory | Simple | LEGAL / LEGAL | High | 5 | T3 | — | — |
| T6 | Legal approval | Mandatory | Approval | LEGAL / LEGAL | High | 3 | T5 | `approval_required=True, approver_role="LEGAL"` | — |
| T7 | Booking amount receipt | Mandatory | Evidence | ACCOUNTS / ACCOUNTS | High | 3 | T2 | evidence, category `Booking`, verifier `ACCOUNTS` | — |
| T8 | TDS challan verify | Mandatory | Evidence | ACCOUNTS / ACCOUNTS | High | 5 | T7 | evidence, category `TDS`, verifier `ACCOUNTS` | — |
| T9 | Confirm customer availability | Mandatory | Simple | REGISTRATION / REGISTRATION | Medium | 4 | T6, T8 | — | `Customer` |
| T10 | Book SRO slot | Mandatory | Evidence | REGISTRATION / REGISTRATION | High | 3 | T9 | evidence, category `Registration`, verifier `REGISTRATION` | `SRO` |
| T11 | Site declares Ready-for-QA | Mandatory | Checklist | PROJECTS / SITE | High | 30 | — | checklist `civil, electrical, plumbing, painting, cleaning` (+ Apartment `tower_deps, access_card`), all `required=True` | — |
| T12 | QA inspection sign-off | Mandatory | Simple | QA / QA | High | 7 | T11 | — | — |
| T13 | Customer acknowledgement | Mandatory | Verification | HANDOVER / HANDOVER | **Critical** | 3 | T10, T12 | `verification_required=True, verifier_role="HANDOVER"` | `Customer` |

Graph shape: two independent chains — commercial (T1→T2→{T3,T4,T7}→T5→T6 / T7→T8→T9→T10) and physical (T11→T12) — joining at T13. T13 is the only Critical-priority task. The seeded `required_document_category` values (`KYC`, `Booking`, `TDS`, `Registration`) do **not** match the document checklist categories in §8 (`PAN`, `Booking Form`, …) — a seed inconsistency, not a rule.

**For Vivek 14:** the SLA-days column is the only per-task duration data Pranava has ever approved (implicitly). Seed it as `SlaPolicy` rows; the spec adds pause/warn/breach which Emergent lacks.

---

## 3. Task / action state machine → Amarsh 11 (Universal Action)

### 3.1 Statuses (`workflow_engine.py:25-44`)

`"Not Started"`, `"In Progress"`, `"Waiting for Customer"`, `"Waiting for Internal Team"`, `"Waiting for External Party"`, `"Blocked"` (dead), `"Awaiting Verification"`, `"Awaiting Approval"`, `"Completed"`, `"Cancelled"`. Sub-states: `verification_status ∈ {"Not Required","Pending","Verified","Rejected"}` (`routers/tasks.py:475, 504, 510-520`); `approval_status ∈ {"Not Required","Pending","Approved","Rejected"}` (`:575, 609, 615-620`).

### 3.2 Transitions (`routers/tasks.py`)

| Endpoint | From → To | Who | Extra gate | Source |
|---|---|---|---|---|
| `/start` | `Not Started` → `In Progress` | owner / dept+role if unassigned / super admin (`_authorised_to_act`, `:304-316`) | `compute_blocker` prereq check; auto-assigns caller if unassigned | `:352-370` |
| `PATCH /checklist` | `Not Started` → `In Progress` | same | Checklist type only; **no prereq check** | `:397-430` |
| `/attach-evidence` | `Not Started` → `In Progress` | same + domain gate | Evidence/Verification/Approval types | `:433-461` |
| `/submit-for-verification` | → `Awaiting Verification`, `verification_status="Pending"` | same + domain gate | Evidence/Verification types | `:464-479` |
| `/verify` Verified | Verification type → `Completed`; Evidence type → `In Progress` (owner then completes) | role == `verifier_role` or super admin; **self-verify guard** | cascades `Verified` onto attached evidence | `:482-561` |
| `/verify` Rejected | → `In Progress`, `verification_status="Rejected"` | same | | `:520-522` |
| `/submit-for-approval` | → `Awaiting Approval` | owner + domain gate | Approval type | `:564-579` |
| `/approve` Approved | → `Completed` | role == `approver_role`, or `MANAGEMENT`, or super admin; **self-approve guard** | | `:582-626` |
| `/approve` Rejected | → `In Progress` | same | | `:619-620` |
| `/complete` | → `Completed` (idempotent; 400 if `Cancelled`) | owner + domain gate | prereqs terminal; per type: Checklist all required items ✓; Evidence **`any`** attachment `Verified` (`:661`); Verification `Verified`; Approval `Approved`; External `external_reference` set | `:629-692` |
| `/set-status` | → `In Progress` or any `WAITING_STATUSES` | owner | `reason` required for waiting statuses | `:695-719` |
| `/cancel` | (not Completed) → `Cancelled` | **Super Admin only**, `reason` required | | `:722-744` |
| `/skip-mandatory` | → `Cancelled`, `override_flag=True`, `cancel_reason="MANDATORY OVERRIDE: {reason}"` | **Super Admin only** | | `:747-772` |
| `/assign` | status unchanged | super admin or owner | no status restriction | `:373-394` |

### 3.3 Guards worth keeping as tests

| Guard | Verbatim | Source |
|---|---|---|
| Self-verify | `if task.get("owner_user_id") == current_user["id"] and not is_super_admin(current_user): 403 "Cannot verify a task you own"` | `:496-497` |
| Self-approve | `… 403 "Cannot approve your own task"` | `:602-603` |
| Verifier role | `if user_role_code(current_user) != task["verifier_role"]: 403 "Only {verifier_role} or Super Admin can verify"` | `:492-494` |
| Approver role | approver_role **or `MANAGEMENT`** or super admin | `:594-600` |
| Evidence completion | `if not any(a["verification_status"] == "Verified" for a in att_docs): 400 "Cannot complete: evidence not verified"` | `:661` |

🐛 Both self-guards test the *current* `owner_user_id`; `/assign` has no status guard, so reassigning before verifying defeats them (`:373-394`). Our version should key on the *submitter/evidence uploader*, as Amarsh 18 already does for Legal.

### 3.4 Domain gate (`_finance_gate` alias) — `routers/tasks.py:47-72`

```python
DOMAIN_GATED_KEYS = {
  "T5": ("Legal","Legal","Upload the agreement draft there."),
  "T6": ("Legal","Legal","Approve the agreement there."),
  "T7": ("Payments","Financials","Verify the payment for the booking amount there."),
  "T8": ("TDS","Financials","Verify the TDS challan there (or mark it Not Applicable)."),
  "T9": ("Registration","Registration","Confirm customer availability there."),
  "T10": ("Registration","Registration","Book the SRO slot there."),
  "T11": ("Unit Readiness","Unit Readiness","Update component progress and declare Ready-for-QA there."),
  "T12": ("Snagging","Snagging","Close all critical snags to complete inspection sign-off."),
  "T13": ("Handover","Handover","Record customer acknowledgement there."),
}
_finance_gate = _domain_gate   # back-compat alias
```
Business meaning: **T5–T13 are system-driven** — completed by the domain screen (legal approve → T5/T6, FC/payment verify → T7, TDS → T8, registration → T9/T10, readiness → T11, snags → T12, handover ack → T13), never by hand. This is exactly our "Universal Action created by a handshake" model (`universal-action.md`). It is an unconditional 400 for any caller, not a role check (`:58-67`). 🐛 Applied only on 6 of 13 endpoints (`:436, 465, 485, 565, 585, 632`) — `/start`, `/assign`, `/checklist`, `/set-status`, `/cancel`, `/skip-mandatory`, `PATCH` bypass it.

---

## 4. Sales → CRM handover → H2 (`handshakes.md`), Vivek 20, compare `bookings.ts`

Source: `routers/sales_handovers.py` (docstring `:1-8`).

### 4.1 The 5 sections (`:42-95`)

| Section key | Fields |
|---|---|
| `customer_section` | `applicant_details_confirmed, contact_verified, nri_status_confirmed, communication_pref_confirmed, notes` |
| `commercial_section` | `final_price_inr, discount_inr, payment_plan_ref, booking_amount_inr, approved_deviations, brokerage_percent, brokerage_inr, taxes_summary, notes` |
| `unit_section` | `unit_confirmed, parking_count, facing_confirmed, specifications_notes` |
| `documents_section` | `booking_form_uploaded, cost_sheet_uploaded, kyc_complete, approval_notes_uploaded, linked_document_ids` |
| `commitments_section` | `items[]` — promoted to Commitment rows on submit (`:253-301`) |

### 4.2 Completeness rule (`_validate_handover`, `:188-228`) — boolean, no score

| Check | Failure text |
|---|---|
| all four `customer_section.*_confirmed` truthy | `"must be confirmed"` (`:192-194`) |
| `commercial_section.final_price_inr`, `booking_amount_inr` not null; `payment_plan_ref` non-blank | `"required"` (`:197-201`) |
| `unit_section.unit_confirmed` truthy | `"must be confirmed"` (`:204-205`) |
| a document in category `"Booking Form"` and `"Cost Sheet"` exists with status not in `{None,"Required","Rejected"}` | `"{cat} must be uploaded"` (`:207-226`) |

Enforced only on submit → `400 {"message":"Validation failed","errors":{field: msg}}` (`:405-407`). ⚠ conflicts with spec: H2 requires a numeric `completeness_score` ≥ project threshold (`handshakes.md H2`, `data-model.md §2.4`). Emergent's four sections + two mandatory docs are a good **first definition of what scores 100**.

Comparison with our `services/api/src/bookings.ts` gate: ours checks applicant/PAN/consideration/plan fields on the Booking; Emergent additionally requires **explicit confirmations** (contact verified, NRI status confirmed, comms preference confirmed, unit/facing/parking confirmed) and **two uploaded documents** (Booking Form, Cost Sheet). Candidate additions to the completeness checklist.

### 4.3 Lifecycle & authority

| Transition | Guard | Who | Source |
|---|---|---|---|
| — → `"Draft"` | auto-created on first GET for a `Confirmed` booking | system | `:338-344` |
| edit sections | status ∈ `("Draft","Returned")` | booking `sales_owner_id` or super admin | `:368-371` |
| `"Draft"/"Returned"` → `"Submitted"` | validation passes | Sales owner only | `:399-413` |
| `"Submitted"` → `"Accepted"` | | role `CRM` or super admin; **submitter cannot accept own** (`:454-455`) | `:449-461` |
| `"Submitted"/"Accepted"` → `"Returned"` | 409 if already Returned; `reason` free text | `CRM` / super admin; submitter cannot return own | `:493-511` |

Side effects: submit → T1 force-completed, note `"Handover submitted to CRM"` (`:431-436`); accept → T2 set `Completed` + `verification_status="Verified"` in one update (`:476-480`, `engine_hooks.py:71-90`); return → T2 reset to `In Progress` and a comment `"Handover returned for clarification: {reason}"` @mentioning `sales_owner_id` (`:530-542`).

⚠ conflicts with spec: (a) return reason is free text — `handshakes.md H2` and `data-model.md §5` require a **structured reason code**; (b) Emergent creates the Customer (`CUS-` code) *before* the booking (`routers/customers.py:71`) and the handover is a separate object on an already-`Confirmed` booking — `crm-rm/spec.md §1.4 rule 1` says no Customer Twin exists until acceptance; (c) the accept can be re-`Returned` after acceptance (`:497`) — spec has no accepted→returned path.

---

## 5. Payments, collections, TDS, financial clearance → Amarsh 15, Amarsh 2/5 (done), compare `clearance.ts`

_PENDING — research fork still running; filled in below when it reports._

---

## 6. Loans → Amarsh 15

_PENDING — see §5 note._

---

## 7. Legal & registration → Amarsh 17, 18, 19

### 7.1 Document families (`routers/document_generation.py:37-65`; templates in `doc_templates/`)

| id | Name | Attachment category | Template | Required fields |
|---|---|---|---|---|
| `sale_deed` | Sale Deed | `Sale Deed` | `sale_deed.html` | `customer_id, booking_id, signatory_name, signatory_designation, witnesses` |
| `agreement_of_sale` | Agreement of Sale | `Agreement` | `agreement_of_sale.html` | same |
| `handover_document` | Handover Document | `Handover` | `handover_document.html` | same |

Rules: generator role ∈ `{"MANAGEMENT","CRM","LEGAL"}` or super admin (`:34, 91-93`); **≥ 2 witnesses** (`:222-224`); **draft watermark until the booking's `legal_record.status == "Approved"`** (`:164`, `_base.html:9`, header `X-Draft-Watermark` `:350`); generated PDF saved as an attachment with `version = last+1` per `(customer, filename)` (`:281-285`). Merge fields (`_base.html:5-96`): `customer.primary_name, applicant.name/pan, customer.address_line/city/state/pincode, signatory.name/designation, project.name/code/location, unit.code/tower/floor/unit_no/unit_type/carpet_area_sqft/facing/parking_count, money.agreement_value/booking_amount/base_price, booking.payment_plan, dates.booking_date/agreement_date/possession_date, witnesses[].name/address, generated_by.name, generated_at_display`. `handover_document.html:22-27` has a **static** "Handover Kit" table (Keys & Access, Utilities, Property Documents, Warranty & Manuals, Association & Common Facilities, Snag Sign-off) not linked to the operational checklist in §10.4.

⚠ conflicts with spec: Sale Deed generation checks only field presence — no H7 clearance, executed AOS or KYC prerequisite (`legal/spec.md #6`, Amarsh 18). One template per family, no project/property/transaction selection, no clause library, no `LEASE` (Amarsh 17, 19). The **watermark-until-approved** rule is worth keeping.

### 7.2 Legal record workflow (`routers/legal.py`)

`ALLOWED_STATUS = {"Not Started","Draft Uploaded","Under Review","Deviations Raised","Approved","Rejected"}` (`:44-47`, declared but unused — transitions are per-endpoint). Authority for every mutation: `_can_manage_legal` = super admin or role ∈ `{"LEGAL","MANAGEMENT"}` (`:58-60`).

| Endpoint | From | To | Cascade | Source |
|---|---|---|---|---|
| auto-create | — | `Not Started` | | `:191` |
| `upload-draft` | any except `Approved` | `Draft Uploaded` (also from `Rejected`, clears `rejection_reason`); inserts `legal_versions` row `version = latest+1` | v1 completes **T5** | `:217-253` |
| `submit-for-review` | `Draft Uploaded`, `Deviations Raised` | `Under Review` | | `:264-267` |
| `raise-deviation` | `Draft Uploaded`, `Under Review` | `Deviations Raised` | | `:283-290` |
| `resolve-deviations` | `Deviations Raised` | `Under Review` | | `:304-311` |
| `approve` | `Draft Uploaded`, `Under Review`, `Deviations Raised`; needs `latest_draft_attachment_id` | `Approved` | completes **T5, T6** | `:325-348` |
| `reject` | **any** (no guard) | `Rejected` | reverse-cascades T6 then T5 | `:352-374` |

⚠ conflicts with spec: the same LEGAL user may upload and approve (no segregation of duties — Amarsh 18). Versions are of *uploaded drafts*, not regenerated documents with diff (Amarsh 17).

### 7.3 Registration case (`routers/registrations.py`) — statuses are string literals, no enum

| Step | Status | Guard | Cascade | Source |
|---|---|---|---|---|
| 1 | `"Not Started"` | auto-created for Confirmed booking | | `:174` |
| 2 | `"Availability Confirmed"` | from `Not Started`/`Availability Confirmed`; **T6 Completed** | T9 | `:217-232` |
| 3 | `"Slot Booked"` | from step 2; **four preconditions** (below) | T10 | `:242-286` |
| 4 | `"Executed"` | from `Slot Booked` exactly | none | `:296-300` |
| 5 | `"Closed"` | from `Executed`; `upload-registered-deed` | none | `:321-370` |

`book-slot` preconditions — all must hold, 400 lists every missing one (`:246-270`): `"Legal approval (T6) not complete"`; `"TDS not verified (or not marked Not Applicable)"` (TDS `applicability == "Not Applicable"` **or** `verification_status == "Verified"` **or** T8 Completed); `"Customer availability not confirmed"`; `"Financial clearance not approved"` (`financial_clearances.status == "Approved"`). Exposed as `legal_ready / tds_ready / fc_ready` booleans + `is_blocked` (`:115-142, 431`).

Authority: confirm-availability & PATCH → `{"CRM","REGISTRATION","MANAGEMENT"}` (`:49-50`); book-slot / mark-executed / upload-deed → `{"REGISTRATION","MANAGEMENT"}` (`:53-54`).

This is Emergent's **Pre-Registration Readiness gate** and matches `handshakes.md H7` ("combines finance + documents + legal/statutory + customer availability"). Keep as the H7→H8 gate definition. `Executed`/`Closed` map to H8 `registration.completed` and `Unit.sale_status → registered`.

---

## 8. Documents checklist → Amarsh 17, Vivek 20

### 8.1 Categories (`routers/documents.py:40-44`)

`ALLOWED_CATEGORIES = {"PAN","Identity Proof","Address Proof","Passport","OCI","Booking Form","Cost Sheet","Agreement","TDS","Loan Documents","Registration Documents","POA","Handover Documents","Other"}`

### 8.2 Per-booking checklist seeded at journey creation (`document_seed.py`) — **seed**, single writer

| Bucket | Category → title | required | Condition |
|---|---|---|---|
| BASE_ROWS | `PAN` PAN card · `Identity Proof` Government ID · `Address Proof` Address proof · `Booking Form` Signed booking form · `Cost Sheet` Cost sheet · `Agreement` Sale agreement | `True` | always (`:25-30`) |
| NRI_ROWS | `Passport` Passport | `True` | `nri_status in ("NRI","OCI")` (`:34, 61-63`) |
| OCI_ROWS | `OCI` OCI card | `True` | `nri_status == "OCI"` (`:38, 64-65`) |
| LATER_STAGE_ROWS | `Registration Documents` Registration set · `Handover Documents` Handover pack | `True` | always, placeholders (`:43-44`) |
| POA_ROW | `POA` Power of Attorney | `False`, `applicable=False`, `status="Not Applicable"`, `na_reason="Default"` | always (`:47`) |

`TDS` and `Loan Documents` are never seeded — created manually only. `NriStatus = Literal["Resident","NRI","OCI"]`, default `"Resident"` (`models.py:192, 218`).

### 8.3 Verifier role per category (code — `documents.py:47-62`)

`PAN, Identity Proof, Address Proof, Passport, OCI, Booking Form, Cost Sheet, Other → "CRM"` · `Agreement, POA → "LEGAL"` · `TDS, Loan Documents → "ACCOUNTS"` · `Registration Documents → "REGISTRATION"` · `Handover Documents → "HANDOVER"`. Verify allowed if super admin, or `MANAGEMENT` (any category), or role == mapped role (`:101-107, 428-429`).

### 8.4 Statuses & versioning (code)

| Status | Set when | Source |
|---|---|---|
| `"Required"` | created / seeded | `:209`, `document_seed.py:91` |
| `"Not Applicable"` | `mark-na` (CRM/super admin, `reason` required) | `:256-268` |
| `"Received"` | upload by non-Sales role | `:391-392` |
| `"Under Review"` | upload by **`SALES`** role | `:391-392` |
| `"Verified"` / `"Rejected"` | verify decision | `:424, 458` |
| `"Expired"` | `mark-expired` | `:309` |

Versioning: re-upload allowed while `applicable`; `latest_version += 1`, new `attachments` and `document_versions` rows; **status always resets to Received/Under Review → re-verification required** (`:325-403`). `mark-required` restores `Verified`/`Received`/`Required` from the latest attachment (`:283-290`).

---

## 9. Commitments (Promise Ledger) → Vivek 20, compare `crm-rm/spec.md §1.5, §2.4`

Source `routers/commitments.py`. Docstring: "Overdue is computed on read — never stored. Rule 8: commitments with delivery_status ∈ {Approved, In Progress, Completed, Customer Confirmed} cannot be deleted." (`:1-6`).

### 9.1 Fields (`:198-223`)
`id, code ("COM-{seq:06d}"), customer_id, booking_id, unit_id, category, description, committed_by, committed_date, responsible_department_id, owner_user_id, target_date, financial_impact_inr, approval_required, approval_status, approver_user_id, approved_at, approval_notes, delivery_status, customer_confirmation_required, customer_confirmed_at, evidence_attachment_ids[], created_at, updated_at` + computed `overdue`.
`ALLOWED_CATEGORIES = {"Modification","Commercial Promise","Timeline Promise","Complimentary Item","Specification Upgrade","Other"}` (`:28-31`).

### 9.2 Two state machines (`:33-35, 197-409`)

`approval_status ∈ {"Pending","Not Required","Approved","Rejected"}`. `delivery_status`:

| Endpoint | From → To | Who |
|---|---|---|
| create | → `"Awaiting Approval"` if `approval_required` else `"Draft"` | |
| `submit-for-approval` | `Draft` → `Awaiting Approval` (forces `approval_required=True`) | |
| `approve` | `Awaiting Approval` → `Approved` / `Rejected` | **`MANAGEMENT`** or super admin; `committed_by` cannot approve own (`:304-308`) |
| `start` | `Approved` → `In Progress`, or `Draft` if `not approval_required` | owner |
| `complete` | `In Progress` → `Completed` | owner, or dept manager (`:359-364`) — **no evidence check** |
| `customer-confirm` | `Completed` → `Customer Confirmed` | `CRM` / super admin |
| `cancel` | not Completed/Confirmed → `Cancelled` | Super Admin only |
| delete | hard delete, Super Admin only, blocked if `delivery_status ∈ DELIVERY_LOCKED_FROM_DELETE` | `:417-431` |

Overdue (`:80-96`): `target_date set AND delivery_status ∉ {"Completed","Customer Confirmed","Rejected","Cancelled"} AND target_date < now`. Escalation fires only **3 / 7 days after** due (`escalation_rules.py:42-59, 250-251`).

### 9.3 Field-by-field vs our Promise Ledger

| Spec (crm-rm) | Emergent | Verdict |
|---|---|---|
| owner | `owner_user_id` (+ `responsible_department_id`) | ✔ |
| due_date | `target_date` | ✔ rename |
| single status `draft→approved→active→at_risk→fulfilled\|breached\|waived_cancelled` | split `approval_status` + `delivery_status`; **no `at_risk`**, no `breached` (overdue is a computed bool) | ⚠ conflicts with spec §1.5 — keep the *approval sub-state* idea as a field, not a status |
| evidence requirement before `active`/fulfil | `evidence_attachment_ids` exists but **never written or checked** | MISSING (spec §1.4 rule 5) |
| visibility internal/customer_facing | none (only on comments) | MISSING (H10) |
| approved_by | `approver_user_id`, `approved_at`, `approval_notes` | ✔ |
| pre-breach alert before due | none — first alert is +3 days | MISSING (spec acceptance #7) |
| customer confirmation of delivery | `customer_confirmation_required`, `customer_confirmed_at` | **Emergent has it, spec lacks it** — candidate addition |
| financial impact | `financial_impact_inr` | Emergent has it, spec lacks it |
| category | `ALLOWED_CATEGORIES` | Emergent has it, spec lacks it |
| who approves | Management | ⚠ conflicts with spec §1.1 (CRM "capture, approve, and track") — ask Pranava |
| hard delete of Draft/Awaiting/Rejected/Cancelled | `delete_one` | ⚠ conflicts with `data-model.md §5` no hard deletes |

---

## 10. Snags, unit readiness, handover → Amarsh 20, Amarsh 12; compare `readiness.ts`, `handover.ts`

### 10.1 Snags (`routers/snags.py:36-39`, code)

`ROOMS = {"Living","Kitchen","Master Bedroom","Bedroom 2","Bedroom 3","Bathroom 1","Bathroom 2","Utility","Balcony","Common","Other"}` · `CATEGORIES = {"Civil","Electrical","Plumbing","Painting","Flooring","Fittings","Cleaning","Other"}` · `SEVERITIES = {"Critical","Major","Minor"}` · `STATUSES = {"Open","Assigned","In Progress","Ready for Verification","Verified","Closed","Reopened"}` (`"Verified"` is never assigned — verify goes straight to `Closed`, `:407`). Code `SNG-{seq:06d}` (`:198-202`).

| Transition | Guard | Who | Source |
|---|---|---|---|
| create → `Open` | | `{"QA","SITE","MANAGEMENT"}` (`:46-47`) | `:212` |
| `Open/Assigned/Reopened` → `Assigned` | | same | `:326-332` |
| `Assigned/Reopened` → `In Progress` | | same | `:346-349` |
| `In Progress` → `Ready for Verification` | **`after_photo_attachment_id` required** | same | `:381-386` |
| `Ready for Verification` → `Closed` / `In Progress` | verify decision | `{"QA","MANAGEMENT"}` (`:50-51`) | `:402-409` |
| `Closed` → `Reopened` | | `{"QA","HANDOVER","MANAGEMENT"}` (`:54-55`) | `:427-435` |

T12 sync (`:66-86`): T12 completes when **all Critical snags are `Closed`** (vacuous if none) and T11 is Completed; reverts if a Critical reopens or is created. Only Critical severity gates the journey — Major/Minor never block. Spec `gates.md B.1` Quality gate: "zero critical snags; minor snags within policy" — Emergent has no minor-snag policy.

### 10.2 Unit readiness — 14 weighted components (`routers/unit_readiness.py:36-51`, comment "per spec §54") — seed+code

| Component | Weight | Component | Weight |
|---|---|---|---|
| Civil | 0.15 | Kitchen | 0.10 |
| Flooring | 0.10 | HVAC | 0.05 |
| Doors | 0.05 | Utilities | 0.05 |
| Windows | 0.05 | External Works | 0.05 |
| Painting | 0.10 | Cleaning | 0.03 |
| Electrical | 0.10 | Common Area Dependencies | 0.02 |
| Plumbing | 0.10 | | |
| Sanitary | 0.05 | **Σ = 1.00** | |

Formula: `round(Σ percent × weight, 2)` with each `percent` a **typed 0–100 input** (`:63-64, 132-133`). `declare-ready-for-qa` requires `score ≥ 85` and **≥ 2 readiness photos** (`:214-218`); completes T11 (`:233-238`). `reset-ready` is super-admin only and reverse-cascades T11→T12→T13 (`:244-268`).

⚠ conflicts with spec: `roles/qa/spec.md §1.1/§1.3` — readiness is "derived from evidence, not typed %". Our `readiness.ts` counts QA-verified components and subtracts 25 per open critical snag. **Keep** Emergent's component list and weights as the `ComponentDefinition` seed (Vivek 13) and the 85 / 2-photo thresholds as policy; **replace** the typed percent with verified/not-verified per component.

### 10.3 Handover gate score (`routers/handovers.py:35-38, 53-134`) — six contributors, Σ = 1.00

| Contributor | Weight | Score | Ready when | Source |
|---|---|---|---|---|
| finance | 0.20 | 100 if `financial_clearances.status == "Approved"` else 0 | same | `:63-64` |
| registration | 0.20 | 100 if `status ∈ {"Slot Booked","Executed","Closed"}` else 0 | same | `:67-69` |
| readiness | 0.25 | unit-readiness weighted % (recomputed inline) | `≥ 85` | `:72-77` |
| snagging | 0.15 | 100 if no open Critical snag else 0 | 0 open | `:80-82` |
| documents | 0.10 | `100 × verified / mandatory` | all verified | `:84-91` |
| commitments | 0.10 | `max(0, 100 − min(open_count × 20, 100))` | 0 open | `:93-99` |

`gate_status` (`_apply_override`, `:137-151`): **Green** = `score ≥ 90 AND no blockers`; **Red** = `score < 70 OR critical blocker` (blockers starting `"Financial"`, `"Registration"`, `"Unit readiness"` or containing `"critical snag"`, `:119`); else **Amber**; an override lifts Red to **Amber, never Green** (`:147-149`). 🐛 `applicability` vs `applicable` field mismatch makes N/A documents count as mandatory (`:59, 85`). 🐛 bypass matching is a substring test against a literal (`:140`).

Compare our `handover.ts`: spec `gates.md B` is pass/fail per gate with hard/soft classification — Emergent's Green/Amber/Red is a *presentation* over the same inputs. Its **thresholds 90/70/85, the 20-points-per-open-commitment decay, and "registration counts as ready from Slot Booked"** are client decisions to confirm.

### 10.4 Handover record: checklist, override, close

Operational checklist (`:226-232`): `property{cleaning, electrical, plumbing, fixtures, doors_windows, snag_clearance}` · `keys{main_door_count, secondary_count, utility_count, other_count, all_handed_over}` · `access{access_cards_count, parking_slot_ids[], clubhouse_confirmed, security_briefed}` · `utilities{electricity_meter_no, electricity_reading, water_meter_no, water_reading, other_notes}` · `documents{possession_letter, warranties, manuals, registration_copy, maintenance_docs, contact_directory}`. Post-handover mandatory keys before `close`: `["facility_intro_done","maintenance_setup_done","owner_record_transferred","warranties_shared","pending_snag_monitoring"]` (`:514`) — this is H12's payload.

Override (`:49-50, 188-191, 451-462`): `MANAGEMENT` or super admin; `reason` required; payload `{reason, mandatory_gates_bypassed[]}` stored with `by_user_id, override_at`; cleared by super admin (`:474`). Acknowledgement requires `gate_status == "Green"` **or any override present** (`:378-383`). ⚠ conflicts with spec: `gates.md B.4` requires **evidence** and forbids overriding safety/statutory gates; Emergent has neither distinction — Amarsh 12 must add both. Also reports `handovers.date_revision_history` (slippage) — see §14.

---

## 11. Escalations → Amarsh 24, Amarsh 11 (SLA)

_PENDING — see §5 note._

---

## 12. Notifications & collaboration → Amarsh 24, H10 approval queue

### 12.1 Triggers (code)

| `type_` | Fires when | Recipients | Source |
|---|---|---|---|
| `"mention"` | comment @user / @department | mentioned users; every active user of the department | `routers/comments.py:80-103` |
| `"reply"` | reply to a comment | parent author | `:106-116` |
| `"mention"` (system) | engine posts a task comment (e.g. handover return) | passed ids | `engine_hooks.py:214, 253-259` |
| `"file_uploaded"` | file on a comment thread | thread's mentioned users | `routers/attachments.py:171-186` |
| `"verification_requested"` | uploaded doc category in `CATEGORY_TO_VERIFIER_DEPT_CODE = {"TDS":"ACCOUNTS","Loan":"BANKING","Registration":"REGISTRATION","Agreement":"LEGAL","KYC":"CRM"}` | that department | `attachments.py:188-200`, `collaboration.py:50-56` |
| `"verification_completed"` | someone other than uploader changes verification status | uploader | `attachments.py:359-373` |

Self-notify guard: `if actor_user_id and recipient_user_id == actor_user_id: return None` (`collaboration.py:136-137`). `notifications.py` is read/ack only (`list`, `unread-count`, `read`, `read-all`). No digest, no pre-breach, no quiet hours (Amarsh 24 adds all three).

### 12.2 Visibility (code)

`VISIBILITY_CHOICES = ("Internal","Customer Visible")`, default `"Internal"` (`collaboration.py:63`, `comments.py:49`). `CUSTOMER_VISIBLE_ROLE_CODES = {"MANAGEMENT","CRM","LEGAL"}` + super admin (`collaboration.py:68, 94-95`); otherwise `403 "Only CRM, Legal, Management or Super Admin can post Customer Visible comments."` (`comments.py:141-145`). Visibility exists **only on comments** — not on notifications or commitments.

⚠ conflicts with spec: `handshakes.md H10` makes CRM the sole approver of customer-facing content via an approval queue; Emergent lets Legal and Management publish directly with no preview/approval step. Other comment rules: edit window `EDIT_WINDOW_MINUTES = 30` (`comments.py:39`); soft delete `status="Deleted", body="[deleted]"` (`:358-374`); one level of threading (`:156-157`); resolve toggles `Active ↔ Resolved` on top-level only (`:332-335`); `COMMENT_STATUS_CHOICES = ("Active","Resolved","Deleted")` (`collaboration.py:65`).

---

## 13. Master data & codes → `data-model.md`

### 13.1 Departments (seed, `seed.py:36-48`)
`SALES, CRM, ACCOUNTS, BANKING, LEGAL, REGISTRATION, PROJECTS, QA, HANDOVER, FACILITY, MANAGEMENT` (11). Role→dept `ROLE_TO_DEPT` (`seed.py:50-63`), e.g. `"SITE":"PROJECTS"`, `"SUPER_ADMIN":"MANAGEMENT"`. ⚠ conflicts with spec `data-model.md §3.1` (8 departments; no banking/registration/handover/facility).

### 13.2 Codes (code, atomic counter `db.next_sequence`, `db.py:65-74`)

| Entity | Format | Source |
|---|---|---|
| Customer | `f"CUS-{seq:06d}"` | `routers/customers.py:71-74` |
| Booking | `f"BKG-{seq:06d}"` | `routers/bookings.py:97-100` |
| Snag | `f"SNG-{seq:06d}"` | `routers/snags.py:198-202` |
| Escalation | `f"ESC-{seq:06d}"` | `routers/escalations.py:152-155` |
| Commitment | `f"COM-{seq:06d}"` | `routers/commitments.py:200` |
| Project / Unit | free-text `code` typed by admin | `models.py:124, 154` |

Our spec has `booking_number` "human-readable" (`data-model.md §2.4`) but no format — adopt `BKG-000001` style; add `customer_number`, snag/escalation/commitment codes.

### 13.3 Entities (`models.py`)

| Entity | Emergent fields | Missing vs `data-model.md` | Emergent-only |
|---|---|---|---|
| Project (`:119-128`) | `code, name, type ∈ {"Apartment","Villa"}, location, status ∈ {"Active","Handover","Closed"}` | `legal_entity, jurisdiction, journey_template_version_id, calendar_id, rera_reg_no, statutory_approvals, config`; product types `plotted, office`; statuses `planning, selling` | — |
| Unit (`:150-164`) | `project_id, code, tower, floor, unit_no, unit_type, carpet_area_sqft, facing, parking_count, status ∈ {"Available","Booked","Registered","Handed Over"}, base_price_inr` | `hierarchy_node_id, built_up_area, saleable_area, uds_land_share`; `sale_status=held` | `base_price_inr`; `tower/floor` as strings |
| Booking (`:252, 293-295`) | `status ∈ {"Draft","Confirmed","Cancelled"}`, `cancellation_reason` | `submitted, crm_accepted, active, transferred`, `predecessor_booking_id`, `completeness_score`, `rm_owner_id` | handover states live on `sales_handovers` (§4) |
| Customer / Applicant (`:192-218`, `customers.py:20-27`) | `nri_status ∈ {"Resident","NRI","OCI"}`; applicants `name, relation, email, phone, pan, kyc_status`; **`MAX_APPLICANTS = 4` "primary + 3 co-applicants"** | `BookingApplicant` join with `role ∈ {primary,co_applicant,co_owner,nominee,guarantor}`, `ownership_pct`; `customer_type ∈ {individual,joint,company,huf,nri}` | applicants embedded on Customer, not Booking |

Booking transitions (`routers/bookings.py:18-22`): `Draft → {Confirmed, Cancelled}`, `Confirmed → {Cancelled}`, `Cancelled → ∅`; **cancel requires a non-blank reason** (`:163-168`); Confirmed sets unit `Booked` and instantiates the journey (`:175-207`); Cancelled frees the unit and closes the journey with `close_reason "Booking cancelled: …"` (`:177-178, 208-228`); only `Draft` bookings may be deleted (`:253-254`); a unit must be `Available` or `Booked` and in the selected project (`:91-95`).

---

## 14. Exec dashboard & reports → Amarsh 22

### 14.1 KPIs (`routers/exec_dashboard.py:33-186`, project-scoped, zero-stub when no scope)

| KPI | Rule | Source |
|---|---|---|
| `active_journeys` | journeys `status == "Active"` | `:77-80` |
| `handovers_ready_this_month` | `scheduled.final_date` this month AND gate `Green` | `:83-94` |
| `handovers_at_risk_30d` | final_date in next 30 days AND gate `Amber`/`Red` | `:96-108` |
| `revenue_at_risk_inr` | Σ `agreement_value_inr` of bookings with journey `risk_level ∈ {High,Critical}` ∪ at-risk handovers | `:110-119` |
| `escalations_open_critical` / `_high` | open escalations by `severity` | `:121-126` |
| `broken_commitments_overdue` | `delivery_status ∈ {"Awaiting Approval","In Progress"}` and `target_date < now` | `:129-135` |
| `tds_pending_count` | `tds_records.status ∈ {"Applicable","Pending"}` | `:138, 143` |
| `fc_pending_count` | `financial_clearances.status != "Approved"` | `:139, 144` |
| `top_5_bottleneck_stages` | median `(completed_at − started_at)` days per stage, top 5 | `:146-173` |

Exceptions feed (`:189-342`, "spec §78"): `journey_high_risk`; `collection_overdue_30d` (milestone `Overdue` > 30 days); `registration_blocked` (`Not Started` > 7 days); `sanction_expiring` (`sanction_validity_date` within 0–7 days, `current_stage != "Fully Disbursed"`); `commitment_overdue_7d`; `critical_snag` (Critical not Closed); `escalation_sla_breach` (open ≥ 7 days). Sorted by severity rank `{Critical:4, High:3, Medium:2, Low:1}` then age (`:340-341`). These **thresholds (30/7/7/7 days)** are Emergent's de-facto materiality thresholds — input to Amarsh 23 (Policy Studio data, not code).

### 14.2 The 8 reports (`routers/reports.py`, all CSV-exportable `:51-60`)

| Report | Row fields | Source |
|---|---|---|
| `handover-forecast` (window default 30 days) | `project, unit, customer_code, customer_name, planned_handover, readiness_score, gate_status, finance_status, registration_status, unit_readiness_pct, critical_snags_open, documents_verified_pct, commitments_open, risk_level, blockers_summary` | `:63-128` |
| `registration-pipeline` | `…, status, legal_ready, tds_ready, fc_ready, availability_confirmed, slot_date, days_since_availability_confirmed` | `:131-175` |
| `collections-ageing` | `…, milestone_name, amount_inr, due_date, days_overdue, bucket ∈ {"0-30","31-60","61-90","91-180","181-365","365+"}` | `:178-219` |
| `escalations` | `code, rule_key, severity, status, …, department, source_entity_type, title, created_at, age_days, resolved_at` | `:222-263` |
| `commitments` | `code, …, title, delivery_status, target_date, days_overdue` | `:266-295` |
| `department-sla` | `department_code, department, open_escalations, exceeding_sla_7d, median_age_days` — SLA hard-coded `7` days | `:298-318` |
| `handover-delay` | from `handovers.date_revision_history`: `original_date, latest_date, total_slippage_days, revisions` | `:321-359` |
| `tds-pending` | `…, status, amount_inr, created_at, days_open` | `:362-387` |

Note the report ageing buckets (`0-30 …`) differ from the collections screen buckets (§5) — two bucket schemes in one app; pick one in Policy Studio.

---

## 15. Locale & formatting → Amarsh 9a

| Concern | Emergent | Source |
|---|---|---|
| Timezone | `datetime.now(timezone.utc)` in every module; **zero** occurrences of `Asia/Kolkata`, `zoneinfo`, `pytz`, or `date.today()` | e.g. `db.py:52-53`, `models.py:15-16`, `escalation_rules.py:21`, `routers/handovers.py:41`, `workflow_engine.py:56` |
| Date display | `strftime("%d %b %Y")` and `"%d %b %Y %H:%M"` — **only** in document generation | `routers/document_generation.py:129-136, 204` |
| INR display | `_fmt_inr`: `≥ 1 Cr → "₹X.XX Cr"`, `≥ 1 L → "₹X.XX L"`, else Indian grouping `X,XX,XXX` — only in document generation | `document_generation.py:108-126` |
| API money | raw floats in `*_inr` fields; formatting left to the frontend | throughout |

Emergent has the **same UTC-day bug** as our 9a (overdue/ageing computed against UTC `now`). Nothing to inherit except the `DD MMM YYYY` and Cr/L conventions, which confirm the spec's display rules.

---

## 16. Summary → task inputs, and what the spec is silent on

_Rows for §5, §6, §11 to be completed when the payments/loans/escalations research lands._

| Task | What to seed / enforce from this document | § |
|---|---|---|
| Vivek 11 | 11 roles + aliases; module list; `read_status_only`/`read_limited` redaction field sets; `403 {module, required_action, your_role}` shape; T5–T13 "system-driven" mutation block; Customer-Visible poster set | 1.1–1.4, 3.4, 12.2 |
| Vivek 12 | Management/Super Admin bypass; 404 on out-of-scope read-by-id; customer scope = ∪ booking projects | 1.5 |
| Vivek 13 | Config seed: departments, 14 readiness components + weights, snag rooms/categories/severities, document categories + verifier map, commitment categories, code formats, handover checklist keys | 8, 10, 13 |
| Vivek 14 | T1–T13 shapes, SLA days, `Mandatory/Conditional` + execution types, conditional DSL, FinishToStart edges, stage weights; cascade rules; Cancelled-satisfies-prereq decision | 2 |
| Vivek 20 | Completeness checklist items (4 confirmations + Booking Form + Cost Sheet); accept/return authority and self-accept guard; commitment field list, two sub-states, approval by Management (ask), customer confirmation, `financial_impact_inr`, categories | 4, 9 |
| Vivek 23 | Customer role disabled in Emergent — nothing to inherit; comments visibility model | 12 |
| Amarsh 8 | Label maps: every Title-Case enum in §2–§10 is the human label Pranava already saw | all |
| Amarsh 11 | Task statuses incl. three Waiting states; self-verify/approve guards keyed to submitter; Evidence `any-verified` rule; skip-mandatory as super-admin override with reason | 3 |
| Amarsh 12 | Override: reason + `mandatory_gates_bypassed[]` + `by_user_id`; add evidence + safety exclusion; Red→Amber-never-Green | 10.4 |
| Amarsh 17 | Three families; merge-field list; ≥ 2 witnesses; watermark until legal Approved; generator roles | 7.1 |
| Amarsh 18 | Legal status set; SoD gap confirmed; Sale Deed prerequisite gap confirmed | 7.1–7.2 |
| Amarsh 20 | Snag state machine (after-photo before verification; only Critical gates); readiness 85 / 2 photos; component weights | 10.1–10.2 |
| Amarsh 22 | KPI list; 8 report shapes; exception thresholds 30/7/7/7; bottleneck-stage median | 14 |
| Amarsh 23 | Exception thresholds above as first materiality values; commitment decay 20/open | 14, 10.3 |
| Amarsh 24 | Trigger list; department fan-out; self-notify guard; verifier-dept map | 12.1 |
| Amarsh 9a | Confirms Emergent never solved IST; `DD MMM YYYY`, Cr/L formatting | 15 |
| Amarsh 25 | Error body shapes (`{"message","errors":{field:msg}}`, `{"detail":"forbidden",…}`) as counter-examples for the `{data, meta, errors}` envelope | 1.2, 4.2 |

### Things Emergent decided that our spec is silent on (candidate Open questions for Pranava)

1. **Legal/Registration see payment *status* but not *amounts*** (`read_status_only`) — is that a real confidentiality rule? (§1.3)
2. **Who approves a commitment** — Management (Emergent) or CRM (spec)? And should a customer have to *confirm* delivery? (§9)
3. **Only Critical snags block QA sign-off / handover**; Major/Minor never do. Spec says "minor snags within policy" — what is the policy? (§10.1)
4. **Readiness thresholds** — declare-ready at 85 %, Green at 90, Red below 70, registration "ready" from Slot Booked, 20 points off per open commitment. (§10.2–10.3)
5. **Max 4 applicants** (primary + 3). (§13.3)
6. **Booking Form + Cost Sheet** are the two documents that gate CRM acceptance; PAN/ID/Address are collected *after* acceptance (T3). (§4.2, §8.2)
7. **POA defaults to Not Applicable**; Passport required for NRI and OCI; OCI card only for OCI. (§8.2)
8. **≥ 2 witnesses** on every generated legal document; drafts watermarked until Legal approves. (§7.1)
9. **A skipped mandatory task counts as done for its dependents** (super-admin override) — acceptable? (§2.2)
10. **Sales uploads land as "Under Review"; everyone else's as "Received"** — is Sales less trusted by design? (§8.4)
11. **Legal and Management may publish customer-visible notes without CRM approval.** (§12.2)
12. **Ageing buckets** — two schemes exist; which one does Accounts actually use? (§14.2, §5)

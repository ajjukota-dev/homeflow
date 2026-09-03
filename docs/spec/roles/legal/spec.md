# Role · Legal / Documents

**Module id:** `legal` · **Depends on:** `foundation`, `crm-rm` · **Build order:** #5 (parallel-eligible with `accounts`, `qa`)

Legal runs the **Legal Document Factory** — governed generation from approved templates + a clause library, not free-form mail merge. It also owns registration. Every legal document is generated from trusted data, validated, approved, executed, and archived — **nothing typed twice, nothing released from the wrong draft.**

> Read alongside: [`handshakes.md`](../../foundation/handshakes.md) (H4, H7, H8), [`customer-transparency.md`](../../foundation/customer-transparency.md) (T5), [`HOMEFLOW-OS.md`](../../HOMEFLOW-OS.md) §8.2/§8.5/§8.6/§32.

---

## Part 1 · Flow

### 1.1 What this role does

| Job | Outcome |
|---|---|
| Maintain templates + clauses | Versioned, approved `DocumentTemplate` + `ClauseLibrary` by project/entity/property/transaction/jurisdiction. |
| Generate governed documents | AOS, Sale Deed, Lease, addenda, possession, NOCs, variation/cancellation/transfer — from a frozen data snapshot. |
| Validate before release | Cross-check names/PAN/amounts/dates/unit identity; block on mandatory failures. |
| Approve deviations | Governed clause deviations with authority matrix + SoD. |
| Register | Registration readiness, SRO slot, challan, execution, registered copy archive. |

### 1.2 The one question this role answers
> *"Which agreements or SRO slots are blocked, and which cases need legal judgment or a deviation?"*

### 1.3 The governed generation flow (functional steps, §32)

```
function generateDocument(booking_id, document_family, transaction_type):
  1. selectTemplate:
       template = approvedTemplate(project, property_type, transaction_type, jurisdiction, valid_now)
       if none → BLOCK "no valid approved template"
  2. readinessCheck:
       missing = mandatoryFields(template) not satisfied from source data
       if missing → BLOCK, return source_refs (user fixes SOURCE record, never retypes)   # H4 return
  3. freezeSnapshot:
       snapshot = immutable copy of all merge-field source values (so v1 is reconstructable)
  4. selectClauses:
       for each ClauseSelectionRule(template): pick clause by conditions
       (project/property/customer/payment plan/loan/customisation/jurisdiction)
  5. renderDraft:  populate template + clauses from snapshot   → status = DRAFT (watermarked)
  6. autoValidate:
       cross-check numbers-in-words vs numeric, totals, dates, %, unit identity, applicant names, PAN/address
       zero unresolved merge tokens
       if fail → status = VALIDATION_FAILED (list field errors, each linking to source)
  7. internalReview → legalApprove → customerReview → APPROVED_FOR_EXECUTION
       (Locked clauses uneditable by Sales/CRM; deviation = new version via authority + SoD)
  8. execute:  eSign | wet-sign | register   → ExecutionRecord (checksum, signatories, date)
  9. archive:  final = READ-ONLY, checksum-identified, visible from Project/Unit/Booking/Customer
```

Every revision is a **new immutable version**; a previously reviewed/customer-shared version is never overwritten.

### 1.4 Gates: reads vs owns

| Gate | This role |
|---|---|
| Document validation gate (H4) | **Owns** — blocks generation on mandatory data failure. |
| Handover **Legal** hard gate | **Owns the input** — executed agreement / required approvals complete. |
| Registration gate | **Owns** — readiness + completion (H8). |
| Financial clearance (H7) | **Consumes** — needed for registration readiness. |

### 1.5 Hard rules
1. Generate only from an **approved template version** valid for the project/transaction context.
2. **Block release** when mandatory source data is missing/inconsistent — link to source, never retype trusted values.
3. **Locked clauses** cannot be edited by Sales/CRM; a deviation is a new version under the authority matrix; **SoD** — no one both creates and self-approves a deviation.
4. Final executed/registered docs are **read-only**; corrections require a formal addendum workflow.
5. External edits imported = **External Revision** → full comparison + reapproval; never treated as approved executable.
6. Bulk generation only for low-risk standardized notices; deeds/agreements need record-level validation + approvals.

### 1.6 States (Document)
`Required → Requested → Received → Validating → Accepted/Rejected → Superseded → Expired`; generation lifecycle: `Draft → Validation Failed → Internal Review → Legal Approved → Customer Review → Approved-for-Execution → Executed → Archived`.

---

## Part 2 · Data Flow

### 2.1 Twin surface

| Twin | Access |
|---|---|
| Customer Twin · Documents layer | **write** (document status) |
| Customer Twin · other | read (names, PAN, commercials for merge) |
| Unit Twin | read (unit identity, as-built for possession docs) |

### 2.2 Entities owned (§32)
- **DocumentTemplate** — `template_id, document_family, project_scope, legal_entity, property_type, transaction_type, jurisdiction, effective dates, version, status, owner, approver, source_file, checksum`.
- **MergeFieldDefinition** — `field_key, label, source_object, source_path, data_type, mandatory, formatting, fallback, editable, validation, sensitivity`.
- **ClauseLibrary** — `clause_id, clause_type, approved_text, applicability, mandatory, precedence, legal_owner, effective dates, version, lock_class{ locked\|parameterized\|negotiable }`.
- **ClauseSelectionRule** — `template_id, clause_id, conditions, default_action, exception_approver`.
- **GeneratedDocument** — `id, template_version, project, unit, booking, customer/applicants, timestamp, data_snapshot_id, selected_clauses, status, current_version, owner, final_artifact`.
- **DocumentDeviation** — `field/clause, original_vs_proposed, reason, impact, requested_by, approval_chain, outcome, timestamp`.
- **DocumentApproval** — `reviewer, role, stage, decision, comments, timestamp, evidence` (parallel or sequential).
- **ExecutionRecord** — `method{ wet\|eSign\|registered }, signatories, execution_date, sro_reference, final_checksum, final_file, stamping, archive_status`.
- **RegistrationCase** — `booking_id, readiness_checklist, sro_slot, challan, status{ not_ready→readiness_in_progress→ready→slot_booked→completed }, registered_copy_file_id, forecasted_date, confidence, critical_path`.

### 2.3 APIs

```
# Templates & clauses (admin/legal)
GET/POST/PUT /document-templates                     → versioned; retire by effective end date
GET/POST/PUT /clauses                                → clause library (lock class)

# Generation (H4)
POST /documents/generate                             → runs the §1.3 flow; returns Draft or field errors
GET  /documents/{id}/validation                      → readiness Ready/Warning/Blocked + source links
POST /documents/{id}/deviation                       → propose (authority + SoD)
POST /documents/{id}/approve                          → stage decision
POST /documents/{id}/compare?from=&to=               → substantive change diff
POST /documents/{id}/execute                          → eSign/wet/register → ExecutionRecord
GET  /documents/{id}                                  → status, versions, final artifact (checksum)

# Registration
GET  /bookings/{id}/registration                      → readiness checklist + forecast + blockers
POST /registration/{id}/slot                          → book SRO slot
POST /registration/{id}/complete                      → archive registered copy (H8)
```

### 2.4 Handshakes

| id | Direction | This role's part |
|---|---|---|
| **H4** | ← crm-rm | **Receives.** Document generation trigger; runs governed flow; returns field errors to source on validation fail. |
| **H7** | ← accounts | **Consumes.** Financial clearance needed for registration readiness. |
| **H8** | → crm-rm | **Emits.** Registration completion → archive on Booking, `Unit.sale_status → registered`, feed handover Registration gate. |
| (feeds) | → customer via H10 | **T5** legal-safety corner: RERA reg no., customer's own executed/registered docs. |

### 2.5 Events emitted
`document.template.created/approved/activated/retired` · `document.generated` · `document.validation.failed` · `document.revised` · `clause.selected` · `deviation.requested/approved/rejected` · `document.shared_with_customer` · `document.customer_commented/accepted` · `document.approved_for_execution` · `document.esigned/wet_signed/registered/archived` · `document.external_revision.imported/compared/reapproved` · `registration.readiness.achieved` · `registration.slot.booked` · `registration.completed`

### 2.6 AI (bounded)
May summarize redlines, suggest a **known approved** clause, flag anomalies, extract/validate data, draft comms. **Final wording** comes from the library or an explicit Legal-approved deviation. AI cannot autonomously approve deviations or auto-send.

---

## Part 3 · UI/UX

Applies [`design-language.md`](../../foundation/design-language.md) — **workspace skin**; document-centric, comparison-forward.

### 3.1 Screens
- **A · Document Factory** — pick document → readiness panel (Ready/Warning/**Blocked** with clickable source links) → generate Draft (watermarked) → validation results.
- **B · Clause & Template Studio** — versioned templates + clause library with lock classes; effective dating; retire flow.
- **C · Review & Deviation** — side-by-side version compare highlighting **substantive** changes only; deviation request with authority + SoD; approval stages.
- **D · Registration Workbench** — readiness checklist (docs/payments[H7]/TDS/appointments/signatures), SRO slot scheduling + change history, forecasted date + critical path, day-of exception handling, registered-copy archive.
- **E · Legal Queue** — cases needing judgment/approval, SLA + blocker ownership.

### 3.2 Homely touches (customer-facing side)
The customer never sees the factory — only the **T5** result: their RERA number, their signed/registered documents to download, an escrow assurance note — presented as a calm "your paperwork is safe" corner.

### 3.3 Confidentiality
Deviation register, internal legal deliberations, other customers' docs, and drafts never cross to the customer — only accepted/registered own-documents do (T5, via H10).

---

## Part 4 · Acceptance tests (role-scoped, §32)

1. CRM selects AOS for an eligible booking and is offered **only** currently approved templates for that project/property/transaction. (#29)
2. Generation is blocked when a mandatory field is missing; the error links to the source record. (#30)
3. A valid AOS generates with names/unit/consideration/schedules/clauses — no re-entry, zero unresolved tokens. (#... §32)
4. Changing consideration after Draft v1 does not mutate v1; v2 uses a new snapshot; compare shows the change. (#31)
5. CRM cannot edit a Locked clause; a Legal-approved deviation creates a new version, original retained. (#32)
6. A Sale Deed cannot reach Approved-for-Execution until legal/commercial/registration prerequisites + approvals are complete. (#... §32)
7. Final executed/registered doc is checksum-identified, locked, visible from Project/Unit/Booking/Customer. (#34)
8. A retired template cannot be used for new generation; historic docs remain viewable. (#... §32)
9. A Lease uses the same governed model with lease-specific parties/terms/approvals. (#... §32)
10. Registration completion (H8) archives the registered copy and flips the unit + handover gate. (§8.6)

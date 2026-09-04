# 22 — Legal Document Factory & document checklist

## Purpose
p9 §8.2, p38–41 §32: "a governed transaction/document platform, not free-form mail merge". Families (all configurable): Agreement of Sale, Sale Deed, Lease / Leave & Licence, Addendum, Allotment letter, Demand letter, Receipt/Statement, NOC, Possession letter, Declarations, Customisation agreement, Cancellation/Transfer, project letters. Objects p38 §32.2. Readiness panel Ready/Warning/Blocked. Canonical workflow (p39 §32.4): Select → Readiness → Draft → Validation → Internal Review → Legal/Commercial Approval → Customer Review → Approved-for-Execution → eSign/Wet/Registration → Final → Archive. Every revision immutable; redline with structured change summary; checksum-locked finals; segregation of duties; Template & Clause Studio. Plus the customer **document checklist** (KYC etc.) with statuses (Appendix A p42): **Required / Requested / Received / Validating / Accepted / Rejected / Superseded / Expired**.

## Data
| Table | Columns |
|---|---|
| `document_template` | `id`, `family_code`, `name`, `project_scope` (null/std or project_id), `legal_entity`, `product_types[]`, `transaction_type ∈ {SALE, LEASE, ADDENDUM, LETTER, STATEMENT, CUSTOMISATION, CANCELLATION, TRANSFER}`, `jurisdiction`, `effective_from/to`, `version`, `status ∈ {DRAFT, UNDER_REVIEW, APPROVED, RETIRED}`, `body_html` (with `{{merge.field}}` and `{{clause:CODE}}` slots), `checksum`, `approved_by/at`, `change_note` — p38 §32.2 |
| `merge_field_definition` | `code` (`customer.primary_name`, `applicant[n].pan`, `unit.code`, `unit.carpet_area_sqft`, `booking.agreement_value_inr_words`, `money.*`, `dates.*`, `project.rera_reg_no`, `witnesses[n].name` …), `source_path`, `type`, `format` (INR words/figures, `%d %b %Y`), `required bool`, `sensitivity` — seed from **[E §7.1]** + the `.partial.md` merge-field list |
| `clause` | `id`, `code`, `title`, `body_html`, `category`, `type ∈ {LOCKED, PARAMETERIZED, NEGOTIABLE_WITH_APPROVAL}`, `parameters jsonb`, `version`, `status`, `approved_by/at` — p38 §32.2 |
| `clause_selection_rule` | `template_id`, `clause_code`, `condition` (DSL from 05: e.g. `customer.residency == NRI`, `booking.has_loan == true`, `unit.product_type == PLOT`), `position` |
| `generated_document` | `id`, `code DOC-`, `family_code`, `template_version_id`, `booking_id`, `unit_id`, `customer_id`, `project_id`, `data_snapshot jsonb` (frozen merge data), `selected_clauses jsonb`, `version int`, `status ∈ {DRAFT, VALIDATING, INTERNAL_REVIEW, AWAITING_APPROVAL, CUSTOMER_REVIEW, APPROVED_FOR_EXECUTION, EXECUTED, FINAL, ARCHIVED, REJECTED, SUPERSEDED}`, `pdf_file_id`, `checksum`, `is_draft_watermarked bool`, `redline_summary jsonb` (vs previous version), `generated_by/at` |
| `document_deviation` | `id`, `document_id`, `clause_code`, `original`, `proposed`, `reason`, `raised_by`, `status ∈ {RAISED, APPROVED, REJECTED}`, `approved_by` (≠ raised_by) |
| `document_approval` | `document_id`, `stage ∈ {INTERNAL_REVIEW, LEGAL, COMMERCIAL, CUSTOMER}`, `approver_user_id`, `decision`, `note`, `at` |
| `execution_record` | `document_id`, `mode ∈ {ESIGN, WET_SIGNATURE, REGISTRATION}`, `executed_on`, `signatories jsonb`, `witnesses jsonb`, `signed_file_id`, `sro_reference?`, `recorded_by` |
| `customer_document` | `id`, `booking_id`, `customer_id`, `category` (PAN, IDENTITY_PROOF, ADDRESS_PROOF, PHOTOGRAPH, PASSPORT, OCI, BOOKING_FORM, COST_SHEET, AGREEMENT, TDS_CHALLAN, LOAN_DOCUMENTS, REGISTRATION_DOCUMENTS, POA, HANDOVER_DOCUMENTS, OTHER) **[E §8]**, `required bool`, `applicable bool`, `na_reason`, `status` (Appendix A), `verifier_role` **[E §8.2 table; Loan → ACCOUNTS (Banking verifies via ACCOUNTS queue)]**, `file_ids[]` (versions), `expires_on`, `rejected_reason`, `verified_by/at` |
| `document_checklist_rule` | `residency`, `product_type`, `project_id?`, `category`, `required`, `stage_code` (when needed) — seed **[E §8.1]** Resident 9 / NRI 10 / OCI 11 rows |

## Rules
1. Generate only from an `APPROVED` template version valid for (project, product, transaction, jurisdiction, date) (p31 §26 documents bullet 1; p41 §32.11 t1).
2. **Readiness panel** before generation: each `required` merge field resolved (Blocked if missing), source-record completeness (e.g. Sale Deed needs 19 clearance APPROVED for REGISTRATION + executed AOS + KYC ACCEPTED — Warning/Blocked), clause rules resolvable; result Ready/Warning/Blocked with facts (p39 §32.3; p41 §32.11 t2 "generation blocked when source data incomplete").
3. `data_snapshot` frozen at generation; regenerating creates version+1 with `redline_summary` (field/clauses changed) and marks the previous SUPERSEDED (p41 §32.11 t4 "data snapshot preserved", t5 "redline between versions").
4. Draft watermark "DRAFT — NOT FOR EXECUTION" until APPROVED_FOR_EXECUTION **[E §7.1 keep]**; finals carry checksum; `FINAL` PDFs are read-only and visible from Project/Unit/Booking/Customer 360 (p40; p41 §32.11 t8).
5. Clauses: LOCKED cannot be edited in a document; PARAMETERIZED accept parameters within schema; NEGOTIABLE_WITH_APPROVAL edits create a `document_deviation` requiring approval by Legal ≠ raiser (p41 §32.11 t3 "locked clause cannot be changed", t6 "deviation requires approval") — segregation of duties (t7 "no self-approval").
6. Workflow transitions are role-gated: draft (Legal/CRM), validation (system), internal review (Legal), legal approval (Legal lead), commercial approval (Management when money terms deviate), customer review (portal 26: view + comment; "accept" only where policy allows), approved-for-execution (Legal lead), execution (Legal/Registration records mode + signed file), final (system on execution), archive.
7. Execution `REGISTRATION` mode links to 23 and stores `sro_reference`; AOS execution flips 16 LEGAL gate input; customisation agreement execution flips 18 LEGAL input.
8. Customer documents: checklist seeded per booking from rules at CRM acceptance (17) and on residency change; statuses per Appendix A; re-upload after ACCEPTED creates a new version and sets `VALIDATING` again but never silently reverts (event + verifier action) **[E conflict fixed]**; `Expired` by `expires_on`; verifier by category; document request → customer action (10, customer-visible) and portal upload.
9. PDF via `pdf` port; A4; Indian number formatting; full figures on legal documents (no Cr/L abbreviations — client question #18 in rules doc; default full).
10. Templates and clauses are versioned with approval; Studio edits never touch generated documents.

## API
Templates/clauses (Studio): `GET/POST /document-templates`, `PUT /document-templates/:id/versions/:v`, `POST …/submit-review|approve|retire` · `GET/POST /clauses`, `PUT /clauses/:id/versions/:v`, `POST …/approve` · `PUT /document-templates/:id/clause-rules`.
Documents: `GET /bookings/:id/documents/readiness?family` · `POST /bookings/:id/documents/generate {family, template_version_id?, clause_params}` · `GET /documents/:id` (pdf url, versions, redline, approvals, deviations) · `POST /documents/:id/submit-review|approve {stage}|reject|send-customer-review|approve-for-execution|record-execution|archive` · `POST /documents/:id/deviations`, `POST /deviations/:id/approve|reject`.
Checklist: `GET /bookings/:id/customer-documents` · `POST /customer-documents/:id/request|upload|validate|accept|reject|mark-na` · Studio `GET/PUT /document-checklist-rules`, `/merge-fields`.

## Screens
- **Legal Factory** (Legal): queue by status; generate wizard (family → template auto-picked with reason → readiness panel with facts → clause preview with parameters → generate); document view (PDF preview with watermark, versions, redline diff, approvals stepper, deviations, execution form with file upload); archive search with checksum display.
- **Template & Clause Studio** (Policy Studio): template editor (HTML with merge-field picker and clause slots; preview with sample data; version + approval), clause library (type badges, parameters schema, versions), selection rules table with DSL validation.
- **Customer documents** (CRM): checklist per booking with status chips, request/upload/verify actions, versions, expiry; used inside 17's packet and 23's readiness.
- Portal (26): Documents area — required-from-you list with upload, drafts to review, executed finals to download.

## Events
`document.requested/received/validated/rejected` (checklist; Appendix B) · `document.generated/version_created/approved/deviation_raised/deviation_approved/customer_review_sent/approved_for_execution/executed/finalised/archived` · `agreement.generated`, `agreement.executed` (Appendix B) · `template.version_approved`, `clause.version_approved`.

## Config
Templates, clauses, selection rules, merge-field definitions, checklist rules, verifier roles — Policy Studio.

## Acceptance
p41 §32.11 t1–t10 · p31–32 §26 six document bullets · Appendix A document statuses · rule tests 1–10 · Playwright: generate AOS with a Blocked readiness → fix → generate → deviation → approve (different user) → customer review → execute → final visible on Unit 360 with checksum.

## Depends on / Feeds
Depends on 03 (pdf, files), 04, 01, 10, 19 (clearance for Sale Deed), 18 (customisation agreement), 25. Feeds 16, 17, 23, 26, 28.

## Files
`services/api/src/documents/**` (replace `legal-docs*.ts`), `services/api/src/documents/templates/*.html` (AOS, Sale Deed, Allotment, Demand letter, Receipt/Statement, Possession letter, Customisation agreement, NOC — brand-neutral), `services/api/migrations/0020_documents.sql`, `services/api/src/seed/documents.ts`, `apps/workspace/src/pages/legal/**`, `apps/workspace/src/pages/studio/Templates*.tsx`, `Clauses*.tsx`, `apps/workspace/src/pages/crm/CustomerDocuments*.tsx`, portal Documents page.

## Not in this feature
Registration case flow (23); e-sign vendor integration (recorded mode only); document intelligence (31).

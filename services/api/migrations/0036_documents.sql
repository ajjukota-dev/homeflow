-- 22-document-factory.md. `document_template`/`generated_document` already exist (0000_init.sql)
-- with a different shape (lowercase status, no clause/checklist model) and 4 live readers
-- (qa.ts, scores/booking-readiness.ts, transparency.ts via customer.ts, seed-lifecycle.ts) plus
-- 4 test files depend on them for the AOS flow in legal-docs.ts — same "different entity, keep
-- both" treatment as 15's qa_evidence/qa_inspection_evidence. legal-docs.ts/AOS stays untouched;
-- this factory is the new templated/clause-driven system for the other 12 document families and
-- adds the customer document checklist (customer_document/document_checklist_rule — no collision,
-- nothing by those names exists today).
CREATE TABLE doc_factory_template (
  id text PRIMARY KEY,
  family_code text NOT NULL,
  name text NOT NULL,
  project_id text REFERENCES project(id),
  legal_entity text,
  product_types text[] NOT NULL DEFAULT '{}',
  transaction_type text NOT NULL CHECK (transaction_type IN ('SALE', 'LEASE', 'ADDENDUM', 'LETTER', 'STATEMENT', 'CUSTOMISATION', 'CANCELLATION', 'TRANSFER')),
  jurisdiction text,
  effective_from date,
  effective_to date,
  version int NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'UNDER_REVIEW', 'APPROVED', 'RETIRED')),
  body_html text NOT NULL,
  checksum text,
  approved_by text,
  approved_at timestamptz,
  change_note text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX doc_factory_template_lookup_idx ON doc_factory_template (family_code, project_id, status);

CREATE TABLE merge_field_definition (
  code text PRIMARY KEY,
  source_path text NOT NULL,
  type text NOT NULL CHECK (type IN ('STRING', 'NUMBER', 'DATE', 'MONEY', 'BOOLEAN')),
  format text,
  required boolean NOT NULL DEFAULT false,
  sensitivity text
);

CREATE TABLE clause (
  id text PRIMARY KEY,
  code text NOT NULL,
  title text NOT NULL,
  body_html text NOT NULL,
  category text,
  type text NOT NULL CHECK (type IN ('LOCKED', 'PARAMETERIZED', 'NEGOTIABLE_WITH_APPROVAL')),
  parameters jsonb NOT NULL DEFAULT '{}',
  version int NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'APPROVED', 'RETIRED')),
  approved_by text,
  approved_at timestamptz,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code, version)
);

CREATE TABLE clause_selection_rule (
  id text PRIMARY KEY,
  template_id text NOT NULL REFERENCES doc_factory_template(id),
  clause_code text NOT NULL,
  condition text,
  position int NOT NULL DEFAULT 0
);
CREATE INDEX clause_selection_rule_template_idx ON clause_selection_rule (template_id, position);

CREATE TABLE doc_factory_document (
  id text PRIMARY KEY,
  code text NOT NULL UNIQUE,
  family_code text NOT NULL,
  template_id text NOT NULL REFERENCES doc_factory_template(id),
  booking_id text REFERENCES booking(id),
  unit_id text REFERENCES unit(id),
  customer_id text REFERENCES customer(id),
  project_id text NOT NULL REFERENCES project(id),
  data_snapshot jsonb NOT NULL DEFAULT '{}',
  selected_clauses jsonb NOT NULL DEFAULT '[]',
  version int NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
    'DRAFT', 'VALIDATING', 'INTERNAL_REVIEW', 'AWAITING_APPROVAL', 'CUSTOMER_REVIEW',
    'APPROVED_FOR_EXECUTION', 'EXECUTED', 'FINAL', 'ARCHIVED', 'REJECTED', 'SUPERSEDED'
  )),
  pdf_file_key text,
  checksum text,
  is_draft_watermarked boolean NOT NULL DEFAULT true,
  redline_summary jsonb,
  superseded_by_id text REFERENCES doc_factory_document(id),
  generated_by text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, family_code, version)
);
CREATE INDEX doc_factory_document_booking_idx ON doc_factory_document (booking_id, family_code, status);

CREATE TABLE document_deviation (
  id text PRIMARY KEY,
  document_id text NOT NULL REFERENCES doc_factory_document(id),
  clause_code text NOT NULL,
  original text,
  proposed text NOT NULL,
  reason text NOT NULL,
  raised_by text NOT NULL,
  status text NOT NULL DEFAULT 'RAISED' CHECK (status IN ('RAISED', 'APPROVED', 'REJECTED')),
  approved_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE document_approval (
  id text PRIMARY KEY,
  document_id text NOT NULL REFERENCES doc_factory_document(id),
  stage text NOT NULL CHECK (stage IN ('INTERNAL_REVIEW', 'LEGAL', 'COMMERCIAL', 'CUSTOMER')),
  approver_user_id text,
  decision text NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED')),
  note text,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE execution_record (
  id text PRIMARY KEY,
  document_id text NOT NULL REFERENCES doc_factory_document(id),
  mode text NOT NULL CHECK (mode IN ('ESIGN', 'WET_SIGNATURE', 'REGISTRATION')),
  executed_on date NOT NULL,
  signatories jsonb NOT NULL DEFAULT '[]',
  witnesses jsonb NOT NULL DEFAULT '[]',
  signed_file_key text,
  sro_reference text,
  recorded_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE customer_document (
  id text PRIMARY KEY,
  booking_id text NOT NULL REFERENCES booking(id),
  customer_id text NOT NULL REFERENCES customer(id),
  category text NOT NULL CHECK (category IN (
    'PAN', 'IDENTITY_PROOF', 'ADDRESS_PROOF', 'PHOTOGRAPH', 'PASSPORT', 'OCI', 'BOOKING_FORM',
    'COST_SHEET', 'AGREEMENT', 'TDS_CHALLAN', 'LOAN_DOCUMENTS', 'REGISTRATION_DOCUMENTS', 'POA',
    'HANDOVER_DOCUMENTS', 'OTHER'
  )),
  required boolean NOT NULL DEFAULT true,
  applicable boolean NOT NULL DEFAULT true,
  na_reason text,
  status text NOT NULL DEFAULT 'REQUIRED' CHECK (status IN (
    'REQUIRED', 'REQUESTED', 'RECEIVED', 'VALIDATING', 'ACCEPTED', 'REJECTED', 'SUPERSEDED', 'EXPIRED'
  )),
  verifier_role text NOT NULL,
  file_keys text[] NOT NULL DEFAULT '{}',
  expires_on date,
  rejected_reason text,
  verified_by text,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, category)
);

CREATE TABLE document_checklist_rule (
  id text PRIMARY KEY,
  residency text NOT NULL CHECK (residency IN ('RESIDENT', 'NRI', 'OCI', 'ANY')),
  product_type text,
  project_id text REFERENCES project(id),
  category text NOT NULL,
  required boolean NOT NULL DEFAULT true,
  stage_code text
);
CREATE UNIQUE INDEX document_checklist_rule_scope_idx ON document_checklist_rule (COALESCE(project_id, ''), residency, COALESCE(product_type, ''), category);

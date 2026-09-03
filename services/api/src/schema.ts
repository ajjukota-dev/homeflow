// System-of-record DDL. Same SQL is intended for local PGlite and Aurora (architecture.md §6b).

export const schema = `
CREATE TABLE project (
  id text PRIMARY KEY,
  code text NOT NULL,
  name text NOT NULL,
  rera_reg_no text,
  escrow_note text
);
CREATE TABLE component_definition (
  code text PRIMARY KEY,
  label text NOT NULL,
  sort_order int NOT NULL
);
CREATE TABLE change_category (
  code text PRIMARY KEY,
  customer_label text NOT NULL,
  customer_visible boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL
);
CREATE TABLE change_gate_rule (
  id serial PRIMARY KEY,
  category_code text NOT NULL REFERENCES change_category(code),
  trigger_component_code text NOT NULL REFERENCES component_definition(code),
  min_state text NOT NULL,
  resulting_state text NOT NULL
);
CREATE TABLE unit (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES project(id),
  unit_number text NOT NULL,
  unit_type text NOT NULL,
  facing text NOT NULL,
  sale_status text NOT NULL DEFAULT 'available',
  utilities_ready boolean NOT NULL DEFAULT false
);
CREATE TABLE unit_progress (
  unit_id text NOT NULL REFERENCES unit(id),
  component_code text NOT NULL REFERENCES component_definition(code),
  state_code text NOT NULL DEFAULT 'not_started',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (unit_id, component_code)
);
CREATE TABLE customer (
  id text PRIMARY KEY,
  customer_type text NOT NULL DEFAULT 'individual',
  display_name text NOT NULL,
  primary_phone text,
  primary_email text,
  kyc_status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE payment_plan (
  id text PRIMARY KEY,
  project_id text REFERENCES project(id),
  name text NOT NULL,
  basis text NOT NULL
);
CREATE TABLE payment_plan_milestone (
  id text PRIMARY KEY,
  plan_id text NOT NULL REFERENCES payment_plan(id),
  milestone_key text NOT NULL,
  milestone_label text NOT NULL,
  construction_trigger_event text,
  sequence int NOT NULL,
  pct_of_consideration numeric NOT NULL
);
CREATE TABLE collection_policy (
  project_id text PRIMARY KEY REFERENCES project(id),
  true_risk_max_probability numeric NOT NULL,
  registration_min_pct numeric NOT NULL DEFAULT 0.70
);
CREATE TABLE overdue_reason (
  code text PRIMARY KEY,
  label text NOT NULL,
  next_action text NOT NULL
);
CREATE TABLE booking (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES project(id),
  unit_id text NOT NULL REFERENCES unit(id),
  booking_number text NOT NULL,
  status text NOT NULL DEFAULT 'submitted',
  total_consideration numeric NOT NULL DEFAULT 0,
  completeness_score int NOT NULL DEFAULT 0,
  docs jsonb NOT NULL DEFAULT '[]',
  rm_owner text,
  return_reason text,
  payment_plan_id text REFERENCES payment_plan(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE booking_applicant (
  id text PRIMARY KEY,
  booking_id text NOT NULL REFERENCES booking(id),
  customer_id text REFERENCES customer(id),
  display_name text NOT NULL,
  role text NOT NULL DEFAULT 'primary',
  phone text,
  pan text
);
CREATE TABLE demand (
  id text PRIMARY KEY,
  booking_id text NOT NULL REFERENCES booking(id),
  project_id text NOT NULL REFERENCES project(id),
  milestone_key text NOT NULL,
  milestone_label text NOT NULL,
  construction_trigger_event text,
  sequence int NOT NULL,
  amount numeric NOT NULL,
  due_date date NOT NULL,
  status text NOT NULL,
  overdue_reason_code text REFERENCES overdue_reason(code),
  loan_dependent boolean NOT NULL DEFAULT false
);
CREATE TABLE receipt (
  id text PRIMARY KEY,
  booking_id text NOT NULL REFERENCES booking(id),
  project_id text NOT NULL REFERENCES project(id),
  demand_id text NOT NULL REFERENCES demand(id),
  amount numeric NOT NULL,
  mode text NOT NULL DEFAULT 'neft',
  received_at date NOT NULL DEFAULT CURRENT_DATE,
  tds_amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'reconciled',
  idempotency_key text UNIQUE,
  request_hash text
);
CREATE TABLE promise_to_pay (
  id text PRIMARY KEY,
  demand_id text NOT NULL REFERENCES demand(id),
  expected_date date NOT NULL,
  expected_amount numeric NOT NULL,
  converted_receipt_id text REFERENCES receipt(id)
);
CREATE TABLE loan_case (
  id text PRIMARY KEY,
  booking_id text NOT NULL REFERENCES booking(id),
  lender text,
  sanctioned_amount numeric,
  status text NOT NULL DEFAULT 'sanctioned'
);
CREATE TABLE handover_policy (
  project_id text PRIMARY KEY REFERENCES project(id),
  readiness_threshold numeric NOT NULL,
  minor_snag_max int NOT NULL,
  dlp_months int NOT NULL,
  checkin_days text NOT NULL
);
CREATE TABLE document_template (
  id text PRIMARY KEY,
  document_family text NOT NULL,
  project_id text REFERENCES project(id),
  property_type text NOT NULL DEFAULT 'villa',
  transaction_type text NOT NULL DEFAULT 'sale',
  status text NOT NULL,
  version int NOT NULL DEFAULT 1,
  body text NOT NULL,
  mandatory_fields jsonb NOT NULL DEFAULT '[]',
  checksum text NOT NULL
);
CREATE TABLE generated_document (
  id text PRIMARY KEY,
  template_id text NOT NULL REFERENCES document_template(id),
  booking_id text NOT NULL REFERENCES booking(id),
  project_id text NOT NULL REFERENCES project(id),
  unit_id text NOT NULL REFERENCES unit(id),
  document_family text NOT NULL,
  status text NOT NULL,
  version int NOT NULL DEFAULT 1,
  snapshot jsonb NOT NULL,
  body_rendered text NOT NULL,
  checksum text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE registration_case (
  id text PRIMARY KEY,
  booking_id text NOT NULL UNIQUE REFERENCES booking(id),
  project_id text NOT NULL REFERENCES project(id),
  status text NOT NULL,
  sro_reference text,
  completed_at timestamptz
);
CREATE TABLE qa_evidence (
  unit_id text NOT NULL REFERENCES unit(id),
  component_code text NOT NULL REFERENCES component_definition(code),
  qa_verified boolean NOT NULL DEFAULT false,
  evidence_note text,
  verified_at timestamptz,
  PRIMARY KEY (unit_id, component_code)
);
CREATE TABLE snag (
  id text PRIMARY KEY,
  unit_id text NOT NULL REFERENCES unit(id),
  project_id text NOT NULL REFERENCES project(id),
  severity text NOT NULL,
  location text NOT NULL,
  trade text NOT NULL,
  description text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  is_repeat boolean NOT NULL DEFAULT false,
  before_note text,
  after_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

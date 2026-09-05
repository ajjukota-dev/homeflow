-- 18-change-requests.md: customer change requests & unit customisations.
-- Depends on 08 (change_category/unit_gate_exception), 09 (variation_catalogue_item/spec_revision),
-- 10 (action), 15 (inspection, read-only link), 19 (demand/receipt), 22 (files/pdf port — quotation
-- PDF is rendered directly via the pdf port, not through 22's doc_factory_template/clause machinery:
-- that system's merge-field context is booking-scoped only, built from source.ts::buildSourceContext,
-- with no hook for a caller to inject ad hoc per-call data like one quotation's own line items —
-- widening it is real future work, not invented here (flagged in 18's Build note).

CREATE TABLE change_request (
  id text PRIMARY KEY,
  code text NOT NULL UNIQUE, -- CR-000001
  booking_id text NOT NULL REFERENCES booking(id),
  unit_id text NOT NULL REFERENCES unit(id),
  project_id text NOT NULL REFERENCES project(id),
  customer_id text REFERENCES customer(id), -- primary applicant at capture time
  raised_by_kind text NOT NULL CHECK (raised_by_kind IN ('CUSTOMER_PORTAL', 'SALES', 'CRM', 'CUSTOMISATION')),
  raised_by_user_id text, -- audit stamp, no FK (customer or staff) — null when raised_by_kind = CUSTOMER_PORTAL
  status text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN (
    'DRAFT', 'REQUESTED', 'FEASIBILITY_REVIEW', 'COSTING', 'AWAITING_APPROVAL', 'AWAITING_CUSTOMER',
    'AWAITING_PAYMENT', 'APPROVED', 'RELEASED', 'IN_PROGRESS', 'READY_FOR_QA', 'QA_VERIFIED',
    'CUSTOMER_ACCEPTED', 'AS_BUILT_CLOSED', 'REJECTED', 'WITHDRAWN', 'CANCELLED'
  )),
  title text NOT NULL,
  summary text,
  -- Not in the spec's own Data list — added because rule 1's HARD_CLOSED/EXCEPTION_ONLY auto-routing
  -- fires at capture, before any change_request_item exists to carry a category_code, and the
  -- Screens section confirms the portal's raise flow is "category picker (shows only
  -- customer-visible categories with state labels)" — i.e. the customer picks a category up front.
  primary_category_code text REFERENCES change_category(code),
  freeze_state_at_request text NOT NULL CHECK (freeze_state_at_request IN ('PRE_FREEZE', 'POST_FREEZE')),
  gate_summary_at_request jsonb NOT NULL DEFAULT '{}', -- frozen: 08 gate state per category at capture
  exception_id text REFERENCES unit_gate_exception(id),
  feasibility jsonb, -- {result, technical_notes, reviewer, at}
  impact jsonb, -- {cost_inr, schedule_days, technical_risk, handover_impact, notes}
  quotation_id text, -- FK added below (quotation created after change_request)
  payment_gate text CHECK (payment_gate IN ('REQUIRED', 'WAIVED')),
  payment_waiver_authority text,
  payment_demand_id text REFERENCES demand(id),
  released_at timestamptz,
  released_by text,
  spec_revision_id text REFERENCES spec_revision(id),
  qa_inspection_id text REFERENCES qa_inspection(id),
  customer_accepted_at timestamptz,
  as_built_closed_at timestamptz,
  cancel_reason text,
  abortive_cost_inr numeric,
  owner_user_id text, -- Customisation role
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX change_request_booking_idx ON change_request(booking_id);
CREATE INDEX change_request_project_status_idx ON change_request(project_id, status);

CREATE TABLE change_request_item (
  id text PRIMARY KEY,
  cr_id text NOT NULL REFERENCES change_request(id),
  room text,
  trade text,
  category_code text NOT NULL REFERENCES change_category(code),
  catalogue_item_id text REFERENCES variation_catalogue_item(id), -- null = bespoke
  description text NOT NULL,
  qty numeric NOT NULL DEFAULT 1,
  unit_price_inr numeric NOT NULL DEFAULT 0,
  vendor_cost_inr numeric NOT NULL DEFAULT 0,
  tax_pct numeric NOT NULL DEFAULT 0,
  lead_days int NOT NULL DEFAULT 0,
  gate_state_at_request text,
  status text NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED', 'APPROVED', 'REJECTED', 'EXECUTED', 'REVERSED')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX change_request_item_cr_idx ON change_request_item(cr_id);

CREATE TABLE quotation (
  id text PRIMARY KEY,
  cr_id text NOT NULL REFERENCES change_request(id),
  version int NOT NULL,
  lines jsonb NOT NULL,
  subtotal_inr numeric NOT NULL,
  tax_inr numeric NOT NULL,
  waiver_inr numeric NOT NULL DEFAULT 0,
  total_inr numeric NOT NULL,
  valid_until date NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  issued_by text,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ISSUED', 'ACCEPTED', 'EXPIRED', 'SUPERSEDED', 'DECLINED')),
  pdf_file_key text, -- rendered directly via the pdf port — see file header; document_id below is the
                      -- spec-named 22-integration column, left null (flagged, not wired)
  document_id text, -- 22 doc_factory_document — not populated, see file header
  customer_accepted_at timestamptz,
  accepted_via text CHECK (accepted_via IN ('PORTAL', 'SIGNED_COPY'))
);
CREATE INDEX quotation_cr_idx ON quotation(cr_id, version);
ALTER TABLE change_request ADD CONSTRAINT change_request_quotation_fk FOREIGN KEY (quotation_id) REFERENCES quotation(id);

-- One APPROVAL action (10) per required approver role (rule 4). Not in the spec's own Data table
-- (which names a single `approval_action_id` on change_request) — added because rule 4's text
-- ("an APPROVAL action per approver") genuinely needs per-role tracking once more than one role
-- is required (e.g. POST_FREEZE = MANAGEMENT + second approver); same class of real addition as
-- 22's carryForwardDeviation.
CREATE TABLE change_request_approval (
  id text PRIMARY KEY,
  cr_id text NOT NULL REFERENCES change_request(id),
  action_id text NOT NULL REFERENCES action(id),
  approver_role text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('VALUE', 'MARGIN', 'SCHEDULE', 'FREEZE', 'SECOND_APPROVER')),
  decision text NOT NULL DEFAULT 'PENDING' CHECK (decision IN ('PENDING', 'APPROVED', 'REJECTED')),
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX change_request_approval_cr_idx ON change_request_approval(cr_id);

-- Policy Studio "variation approval matrix" — a project row (same kind) overrides the standard
-- (NULL project) row, same override shape as 08's rules / 09's catalogue.
CREATE TABLE cr_approval_rule (
  id text PRIMARY KEY,
  project_id text REFERENCES project(id), -- null = standard
  kind text NOT NULL CHECK (kind IN ('VALUE', 'MARGIN', 'SCHEDULE', 'FREEZE', 'CATEGORY')),
  category_code text REFERENCES change_category(code), -- only for kind = CATEGORY
  threshold numeric, -- INR for VALUE, pct for MARGIN, days for SCHEDULE; null for FREEZE/CATEGORY
  approver_role text NOT NULL,
  requires_second_approver boolean NOT NULL DEFAULT false,
  second_approver_role text, -- defaults to approver_role when requires_second_approver and unset
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cr_approval_rule_scope_idx ON cr_approval_rule(COALESCE(project_id, ''), kind);

CREATE TABLE customisation_policy (
  project_id text PRIMARY KEY REFERENCES project(id),
  freeze_dates jsonb NOT NULL DEFAULT '{}', -- category_code -> date
  quotation_validity_days int NOT NULL DEFAULT 15,
  payment_gate_pct numeric NOT NULL DEFAULT 100, -- UNCONFIRMED — p12 TODO §8 client question
  cancellation_terms jsonb NOT NULL DEFAULT '{}',
  allowed_catalogue_only boolean NOT NULL DEFAULT false
);

CREATE TABLE cr_execution_action (
  cr_id text NOT NULL REFERENCES change_request(id),
  action_id text NOT NULL REFERENCES action(id),
  kind text NOT NULL CHECK (kind IN ('SITE_WORK', 'PROCUREMENT', 'VENDOR', 'DRAWING_UPDATE', 'QA')),
  PRIMARY KEY (cr_id, action_id)
);

-- Closes the gap 08's own migration flagged ("18, not built — no FK").
ALTER TABLE unit_gate_exception ADD CONSTRAINT unit_gate_exception_change_request_fk FOREIGN KEY (change_request_id) REFERENCES change_request(id);

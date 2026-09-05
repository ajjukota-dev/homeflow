-- 0026 — Home loans (docs/specs/21-loans.md; spec names 0019_loans.sql, renumbered — migrations
-- apply in filename-sort order and 0019 would sort before several already-merged migrations this
-- one depends on: action_type/action (0009), waiver/financial_clearance (0024), homeflow_app role
-- (0025)).
--
-- `loan_case` already exists (0000_init.sql: id, booking_id, lender, sanctioned_amount, status)
-- but only seed.ts uses it and no real deployment has real loan data yet (R3/consolidation
-- changes aren't deployed — TODO.md's Position line) — cleanly renamed to the spec's real column
-- names rather than carrying two overlapping naming schemes forward (CLAUDE.md: no back-compat
-- shims when you can just change the code). lender -> lender_name, sanctioned_amount ->
-- sanctioned_amount_inr, status -> stage (richer enum, replacing the old free-text default).
--
-- RLS note: this migration lands after 0025_rls.sql, so loan_case/loan_event/
-- loan_document_requirement are NOT yet covered by any RLS policy (0025's DO-block loops are
-- fixed at the point that migration was written and are never edited after merge). loan_case has
-- a direct project_id (Group A shape); sweep it into whichever future migration extends RLS
-- coverage once P1b (parked, see TODO.md R2.5) resumes — flagged, not silently forgotten.

ALTER TABLE loan_case RENAME COLUMN lender TO lender_name;
ALTER TABLE loan_case RENAME COLUMN sanctioned_amount TO sanctioned_amount_inr;
ALTER TABLE loan_case RENAME COLUMN status TO stage;
ALTER TABLE loan_case ALTER COLUMN stage DROP DEFAULT;
ALTER TABLE loan_case ALTER COLUMN stage SET DATA TYPE text; -- was already text; explicit for clarity before the CHECK below
ALTER TABLE loan_case ADD CONSTRAINT loan_case_stage_check CHECK (stage IN
  ('APPLICATION', 'SANCTION_PENDING', 'SANCTIONED', 'DOCS_PENDING', 'DISBURSEMENT_SCHEDULED',
   'PARTIALLY_DISBURSED', 'FULLY_DISBURSED', 'CLOSED', 'REJECTED', 'WITHDRAWN'));
UPDATE loan_case SET stage = 'SANCTIONED' WHERE stage NOT IN
  ('APPLICATION', 'SANCTION_PENDING', 'SANCTIONED', 'DOCS_PENDING', 'DISBURSEMENT_SCHEDULED',
   'PARTIALLY_DISBURSED', 'FULLY_DISBURSED', 'CLOSED', 'REJECTED', 'WITHDRAWN'); -- pre-migration seed rows carried the old default 'sanctioned'
ALTER TABLE loan_case ALTER COLUMN stage SET DEFAULT 'APPLICATION';
ALTER TABLE loan_case ALTER COLUMN stage SET NOT NULL;

ALTER TABLE loan_case ADD COLUMN code text UNIQUE;
UPDATE loan_case lc SET code = 'LN-' || lpad(numbered.rn::text, 6, '0')
  FROM (SELECT id, row_number() OVER (ORDER BY id) AS rn FROM loan_case) numbered
 WHERE numbered.id = lc.id;
ALTER TABLE loan_case ALTER COLUMN code SET NOT NULL;

ALTER TABLE loan_case ADD COLUMN project_id text REFERENCES project(id);
UPDATE loan_case lc SET project_id = b.project_id FROM booking b WHERE b.id = lc.booking_id;
ALTER TABLE loan_case ALTER COLUMN project_id SET NOT NULL;

ALTER TABLE loan_case ADD COLUMN customer_id text REFERENCES customer(id);
UPDATE loan_case lc SET customer_id = a.customer_id
  FROM booking_applicant a WHERE a.booking_id = lc.booking_id AND a.role = 'primary';

ALTER TABLE loan_case ADD COLUMN lender_branch text;
ALTER TABLE loan_case ADD COLUMN lender_rm_name text;
ALTER TABLE loan_case ADD COLUMN lender_rm_contact text;
ALTER TABLE loan_case ADD COLUMN requested_amount_inr numeric;
ALTER TABLE loan_case ADD COLUMN sanction_date date;
ALTER TABLE loan_case ADD COLUMN sanction_validity_date date;
ALTER TABLE loan_case ADD COLUMN sanction_letter_file_id text;
ALTER TABLE loan_case ADD COLUMN own_contribution_inr numeric;
ALTER TABLE loan_case ADD COLUMN expected_disbursement_date date;
ALTER TABLE loan_case ADD COLUMN blocker text;
ALTER TABLE loan_case ADD COLUMN risk_score int;
ALTER TABLE loan_case ADD COLUMN missing_docs jsonb NOT NULL DEFAULT '[]';
ALTER TABLE loan_case ADD COLUMN notes text;
ALTER TABLE loan_case ADD COLUMN owner_user_id text REFERENCES "user"(id);
ALTER TABLE loan_case ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX loan_case_booking_idx ON loan_case (booking_id);
CREATE INDEX loan_case_project_idx ON loan_case (project_id);

CREATE TABLE loan_event (
  id text PRIMARY KEY,
  loan_id text NOT NULL REFERENCES loan_case(id),
  type text NOT NULL CHECK (type IN
    ('APPLICATION_SUBMITTED', 'SANCTIONED', 'DOCS_REQUESTED', 'DOCS_RECEIVED',
     'DISBURSEMENT_REQUESTED', 'DISBURSED', 'BLOCKER_RECORDED', 'BLOCKER_RESOLVED',
     'REJECTED', 'WITHDRAWN')),
  at timestamptz NOT NULL DEFAULT now(),
  amount_inr numeric,
  receipt_id text REFERENCES receipt(id),
  note text,
  actor_user_id text REFERENCES "user"(id)
);
CREATE INDEX loan_event_loan_idx ON loan_event (loan_id);

CREATE TABLE loan_document_requirement (
  id text PRIMARY KEY,
  loan_id text NOT NULL REFERENCES loan_case(id),
  category text NOT NULL, -- 22-document-factory.md's document category — 22 isn't built yet, kept as free text (see loans/core.ts header)
  status text NOT NULL DEFAULT 'REQUIRED' CHECK (status IN ('REQUIRED', 'RECEIVED', 'VERIFIED')),
  UNIQUE (loan_id, category)
);
CREATE INDEX loan_document_requirement_loan_idx ON loan_document_requirement (loan_id);

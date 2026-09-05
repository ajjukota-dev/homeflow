-- 0024 — Collections: demands, true risk, receipts, TDS, waivers, financial clearance
-- (docs/specs/19-collections-true-risk.md; spec names 0017_collections.sql, renumbered to 0024
-- because `waiver.approval_rule_id` FKs to 25's approval_authority_rule, which 0023_policy.sql
-- creates — migrations apply in filename-sort order, so this must sort after 0023, not before
-- it). ADDITIVE only — the real demand/receipt/overdue_reason/promise_to_pay tables already exist
-- (0000_init.sql) with live column names used across demands*.ts/collections*.ts/clearance.ts,
-- several test files, and the sale-to-handover e2e journey. This migration adds the columns/
-- tables this spec needs on top of that real schema rather than renaming it — see
-- 19-collections-true-risk.md's Data section for the reconciliation.

ALTER TABLE demand ADD COLUMN tax_amount numeric NOT NULL DEFAULT 0;
ALTER TABLE demand ADD COLUMN reason_note text;
ALTER TABLE demand ADD COLUMN next_action_id text; -- FK to action(id) — 0009_actions.sql sorts before this file, always applied first
ALTER TABLE demand ADD COLUMN dispute_reason text;
ALTER TABLE demand ADD CONSTRAINT demand_next_action_id_fkey FOREIGN KEY (next_action_id) REFERENCES action(id);

ALTER TABLE receipt ADD COLUMN verification text NOT NULL DEFAULT 'VERIFIED'
  CHECK (verification IN ('PENDING', 'VERIFIED', 'DISPUTED'));
ALTER TABLE receipt ADD COLUMN verified_by text REFERENCES "user"(id);
ALTER TABLE receipt ADD COLUMN verified_at timestamptz;
ALTER TABLE receipt ADD COLUMN dispute_reason text;

ALTER TABLE overdue_reason ADD COLUMN category text
  CHECK (category IN ('CUSTOMER_CASH', 'LOAN_DELAY', 'DISPUTE', 'DOCUMENT_PENDING', 'COMMUNICATION_GAP', 'INTERNAL_ERROR', 'OTHER'));
ALTER TABLE overdue_reason ADD COLUMN default_action_type text REFERENCES action_type(code);

CREATE TABLE tds_record (
  id text PRIMARY KEY,
  booking_id text NOT NULL REFERENCES booking(id),
  demand_id text REFERENCES demand(id),
  applicability text NOT NULL DEFAULT 'NOT_DETERMINED' CHECK (applicability IN ('NOT_DETERMINED', 'APPLICABLE', 'NOT_APPLICABLE')),
  na_reason text,
  amount numeric,
  challan_number text,
  challan_date date,
  pan text,
  file_id text,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'NOT_REQUIRED', 'VERIFIED', 'REJECTED')),
  verified_by text REFERENCES "user"(id),
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tds_record_booking_idx ON tds_record (booking_id);

CREATE TABLE waiver (
  id text PRIMARY KEY,
  booking_id text NOT NULL REFERENCES booking(id),
  demand_id text NOT NULL REFERENCES demand(id),
  kind text NOT NULL CHECK (kind IN ('INTEREST', 'LATE_FEE', 'PRINCIPAL', 'OTHER_CHARGE')),
  amount numeric NOT NULL,
  reason text NOT NULL,
  requested_by text NOT NULL REFERENCES "user"(id),
  approved_by text REFERENCES "user"(id),
  approval_rule_id text REFERENCES approval_authority_rule(id), -- which 25 band authorized this
  status text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED', 'APPROVED', 'REJECTED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);
CREATE INDEX waiver_demand_idx ON waiver (demand_id);

CREATE TABLE financial_clearance (
  id text PRIMARY KEY,
  booking_id text NOT NULL REFERENCES booking(id),
  purpose text NOT NULL CHECK (purpose IN ('REGISTRATION', 'HANDOVER')),
  checklist jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  approved_by text REFERENCES "user"(id),
  approved_at timestamptz,
  threshold_pct numeric NOT NULL,
  immutable_after_approval boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, purpose) -- rule 9: "new purpose row for handover" — one live row per (booking, purpose)
);

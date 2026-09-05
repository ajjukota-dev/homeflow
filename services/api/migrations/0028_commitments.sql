-- 0028 — Promise Ledger: commitments (docs/specs/13-promise-ledger.md; spec names
-- 0011_commitments.sql, renumbered — applies after 0009 (action, for depends_on ACTION checks)
-- and 0025 (RLS, so this table gets a project_id-scoped policy from day one instead of joining
-- 0025 the way loan_case had to, per SCHEMA.md drift #6).
--
-- Reconciliation vs the spec's Data table (same discipline as 07/08/19/21/12):
--  - `customer_id` is nullable — resolved from `booking_applicant.customer_id` at creation time,
--    which is itself only populated once `acceptBooking` (bookings-crm.ts) runs. A commitment
--    captured before acceptance (source=SALES_HANDOVER, rule 6) genuinely has no customer_id yet.
--  - `confidence` (rule 5, "derived") is NOT a stored column — computed at read time in
--    `commitments/confidence.ts`, same "never stored" treatment 06 gave `progress`/`AT_RISK` and
--    Emergent gave its own `overdue` flag (emergent-business-rules.md §9: "computed on read, never
--    stored"). Storing a derived score invites staleness the moment any input changes underneath it.
--  - No PATCH/update endpoint exists in the spec's API list — owner_user_id/due_date (both
--    "required before ACTIVE") must be supplied at creation; `activateCommitment` validates their
--    presence rather than accepting them as its own input, since the spec names no assign-owner
--    route to set them later.

CREATE TABLE commitment (
  id text PRIMARY KEY,
  code text NOT NULL UNIQUE,
  project_id text NOT NULL REFERENCES project(id),
  booking_id text NOT NULL REFERENCES booking(id),
  customer_id text REFERENCES customer(id),
  unit_id text NOT NULL REFERENCES unit(id),
  category text NOT NULL CHECK (category IN (
    'MODIFICATION', 'COMMERCIAL', 'TIMELINE', 'COMPLIMENTARY_ITEM', 'SPECIFICATION_UPGRADE', 'SERVICE', 'OTHER'
  )),
  description text NOT NULL,
  committed_by_user_id text NOT NULL REFERENCES "user"(id),
  committed_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL CHECK (source IN ('SALES_HANDOVER', 'CRM', 'MANAGEMENT', 'COMMUNICATION', 'CHANGE_REQUEST')),
  beneficiary text NOT NULL CHECK (beneficiary IN ('CUSTOMER', 'INTERNAL')),
  customer_facing boolean NOT NULL DEFAULT false,
  owner_user_id text REFERENCES "user"(id),
  responsible_department text,
  due_date date,
  financial_impact_inr numeric,
  approval_required boolean NOT NULL DEFAULT false,
  approved_by text REFERENCES "user"(id),
  approved_at timestamptz,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
    'DRAFT', 'APPROVED', 'ACTIVE', 'AT_RISK', 'FULFILLED', 'BREACHED', 'WAIVED_CANCELLED'
  )),
  at_risk_reason text,
  fulfilled_at timestamptz,
  fulfilled_evidence_file_ids jsonb NOT NULL DEFAULT '[]',
  customer_confirmed_at timestamptz,
  crm_confirmation_note text,
  breached_at timestamptz,
  breach_root_cause text CHECK (breach_root_cause IN (
    'DEPENDENCY', 'RESOURCE', 'VENDOR', 'SCOPE_MISUNDERSTOOD', 'OVERPROMISED', 'CUSTOMER', 'FORCE_MAJEURE'
  )),
  waived_reason text,
  recovery_plan text,
  recovery_due_date date,
  depends_on jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX commitment_booking_idx ON commitment (booking_id);
CREATE INDEX commitment_status_idx ON commitment (status);
CREATE INDEX commitment_owner_idx ON commitment (owner_user_id);

CREATE TABLE commitment_transition (
  id text PRIMARY KEY,
  commitment_id text NOT NULL REFERENCES commitment(id),
  from_status text NOT NULL,
  to_status text NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  actor_user_id text REFERENCES "user"(id),
  reason text
);
CREATE INDEX commitment_transition_commitment_idx ON commitment_transition (commitment_id);

-- `commitment` carries a real project_id but gets no RLS policy here — same gap already flagged
-- for loan_case (21) and escalation (12), both real project_id-bearing tables that landed after
-- 0025_rls.sql without one either. Sweeping all three in together when P1b resumes is more
-- consistent than this migration inventing a one-off policy the other two don't have.

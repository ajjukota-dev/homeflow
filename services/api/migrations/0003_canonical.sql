-- 0003 — canonical model: portfolio, hierarchy, product types, project master fields,
-- codes, customer PII/residency/merge, booking lifecycle, applicants (docs/specs/04-canonical-model.md).
-- Additive: new tables are CREATE TABLE, existing tables only get ADD COLUMN / ADD CONSTRAINT.
-- Runs once, on a fresh schema with zero rows in project/unit/booking/customer (this
-- coordination worktree has no migration runner yet — see db.ts), so NOT NULL columns below
-- are safe without a nullable-then-backfill dance; seed.ts supplies every one going forward.

CREATE TABLE portfolio (
  id text PRIMARY KEY,
  name text NOT NULL
);
-- Single row (p21 §14) — foundational reference data, not demo data, so it's seeded here
-- rather than in seed.ts (every project derives portfolio_id from this, never asks a user).
INSERT INTO portfolio (id, name) VALUES ('portfolio_pranava', 'Pranava');

CREATE TABLE project_hierarchy_node (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES project(id),
  parent_id text REFERENCES project_hierarchy_node(id),
  kind text NOT NULL CHECK (kind IN ('PHASE', 'TOWER', 'BLOCK', 'CLUSTER', 'FLOOR', 'STREET')),
  code text NOT NULL,
  name text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  planned_handover_date date
);
CREATE INDEX project_hierarchy_node_project_idx ON project_hierarchy_node(project_id);
CREATE INDEX project_hierarchy_node_parent_idx ON project_hierarchy_node(parent_id);

-- Per-prefix human code sequences (00-conventions.md "Codes": PREFIX-000001).
CREATE TABLE code_sequence (
  prefix text PRIMARY KEY,
  next_value bigint NOT NULL DEFAULT 1
);

-- --- project: portfolio link + master fields + product type ---
ALTER TABLE project ADD COLUMN portfolio_id text REFERENCES portfolio(id);
ALTER TABLE project ADD COLUMN product_type text NOT NULL DEFAULT 'VILLA'
  CHECK (product_type IN ('APARTMENT', 'VILLA', 'PLOT', 'MIXED'));
ALTER TABLE project ADD COLUMN legal_entity text;
ALTER TABLE project ADD COLUMN jurisdiction text;
ALTER TABLE project ADD COLUMN escrow_account_ref text;
ALTER TABLE project ADD COLUMN launch_date date;
ALTER TABLE project ADD COLUMN planned_handover_date date;
ALTER TABLE project ADD COLUMN status text NOT NULL DEFAULT 'ACTIVE'
  CHECK (status IN ('PLANNING', 'ACTIVE', 'HANDOVER', 'CLOSED'));
ALTER TABLE project ADD COLUMN calendar_id text;
ALTER TABLE project ADD COLUMN journey_template_version_id text;

-- --- unit: hierarchy key, product type, human code, physical fields ---
ALTER TABLE unit ADD COLUMN code text NOT NULL UNIQUE;
ALTER TABLE unit ADD COLUMN hierarchy_node_id text NOT NULL REFERENCES project_hierarchy_node(id);
ALTER TABLE unit ADD COLUMN product_type text NOT NULL DEFAULT 'VILLA'
  CHECK (product_type IN ('APARTMENT', 'VILLA', 'PLOT', 'MIXED'));
ALTER TABLE unit ADD COLUMN carpet_area_sqft numeric;
ALTER TABLE unit ADD COLUMN built_up_area_sqft numeric;
ALTER TABLE unit ADD COLUMN saleable_area_sqft numeric;
ALTER TABLE unit ADD COLUMN uds_land_share numeric;
ALTER TABLE unit ADD COLUMN plot_area_sqyd numeric;
ALTER TABLE unit ADD COLUMN floor_no int;
ALTER TABLE unit ADD COLUMN parking_count int NOT NULL DEFAULT 0;
ALTER TABLE unit ADD COLUMN base_price_inr numeric(14, 2);
ALTER TABLE unit ADD COLUMN specification_baseline_id text;
-- sale_status keeps its existing lowercase values (bookings.ts, qa.ts, legal-docs.ts, ... key
-- off them in ~10 files) — this CHECK documents and enforces the existing vocabulary plus
-- cancelled_release, which nothing writes yet. See model/status.ts for why the spec's
-- SCREAMING_SNAKE names are a translation layer here, not a DB rename.
ALTER TABLE unit ADD CONSTRAINT unit_sale_status_check
  CHECK (sale_status IN ('available', 'held', 'booked', 'registered', 'handed_over', 'cancelled_release'));

-- unit.project_id is immutable (04 rule 1).
CREATE OR REPLACE FUNCTION unit_project_id_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.project_id <> OLD.project_id THEN
    RAISE EXCEPTION 'unit.project_id is immutable (was %, attempted %)', OLD.project_id, NEW.project_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER unit_project_id_immutable_trigger
  BEFORE UPDATE ON unit FOR EACH ROW EXECUTE FUNCTION unit_project_id_immutable();

-- --- customer: PII, residency, merge ---
ALTER TABLE customer ADD COLUMN code text NOT NULL UNIQUE;
ALTER TABLE customer ADD COLUMN primary_name text NOT NULL DEFAULT '';
ALTER TABLE customer ADD COLUMN alt_phone text;
ALTER TABLE customer ADD COLUMN pan text;
ALTER TABLE customer ADD COLUMN aadhaar_last4 text;
ALTER TABLE customer ADD COLUMN passport_no text;
ALTER TABLE customer ADD COLUMN oci_no text;
ALTER TABLE customer ADD COLUMN residency text NOT NULL DEFAULT 'RESIDENT'
  CHECK (residency IN ('RESIDENT', 'NRI', 'OCI'));
ALTER TABLE customer ADD COLUMN address_line1 text;
ALTER TABLE customer ADD COLUMN address_city text;
ALTER TABLE customer ADD COLUMN address_state text;
ALTER TABLE customer ADD COLUMN address_pincode text;
ALTER TABLE customer ADD COLUMN communication_preference text;
ALTER TABLE customer ADD COLUMN language text;
ALTER TABLE customer ADD COLUMN merged_into_customer_id text REFERENCES customer(id);

-- --- booking: human code, lifecycle fields, transfer chain ---
ALTER TABLE booking ADD COLUMN code text NOT NULL UNIQUE;
ALTER TABLE booking ADD COLUMN agreement_value_inr numeric(14, 2);
ALTER TABLE booking ADD COLUMN booking_amount_inr numeric(14, 2);
ALTER TABLE booking ADD COLUMN booking_date date NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE booking ADD COLUMN sales_owner_user_id text;
ALTER TABLE booking ADD COLUMN rm_owner_user_id text;
ALTER TABLE booking ADD COLUMN predecessor_booking_id text REFERENCES booking(id);
ALTER TABLE booking ADD COLUMN cancellation_reason text;
ALTER TABLE booking ADD COLUMN cancelled_at timestamptz;
-- status keeps 'submitted'/'active'/'returned' (existing, ~12 call sites) and adds the rest
-- of the spec's transition graph (04 rule 3) for the new confirm/cancel/transfer handlers —
-- see model/status.ts for the same documented DB-keeps-lowercase decision as unit.sale_status.
ALTER TABLE booking ADD CONSTRAINT booking_status_check
  CHECK (status IN ('draft', 'confirmed', 'submitted', 'returned', 'crm_accepted', 'active',
                     'registered', 'handed_over', 'cancelled', 'transferred'));

-- --- booking_applicant: ownership, ordering, richer role set ---
ALTER TABLE booking_applicant ADD COLUMN ownership_pct numeric;
ALTER TABLE booking_applicant ADD COLUMN sort_order int NOT NULL DEFAULT 1;
-- 'primary' (lowercase, existing default/reads) plus the new roles (uppercase — nothing
-- existing ever wrote them, so no legacy collision to avoid).
ALTER TABLE booking_applicant ADD CONSTRAINT booking_applicant_role_check
  CHECK (role IN ('primary', 'CO_APPLICANT', 'POA', 'NOMINEE'));

-- Permanent unit history (p5 §4.1) — an append-only projection of the event log, not a table.
CREATE VIEW unit_history AS
SELECT id, occurred_at, unit_id, project_id, booking_id, type AS event_type, payload
  FROM event
 WHERE unit_id IS NOT NULL
   AND type IN ('booking.created', 'booking.status_changed', 'booking.transferred',
                'unit.sale_status_changed', 'registration.completed', 'handover.completed')
 ORDER BY occurred_at;

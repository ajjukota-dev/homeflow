-- 24-sales-inventory-discovery.md. `inventory_view` is a query (sales/inventory.ts), not a table.
-- `booking` gains the prospect link + the copied personalisation needs (rule 8 "needs copied to
-- the booking as context for 18") — additive, the pre-24 createBooking path is untouched.
-- Audit-stamp user columns carry no FK to "user" (same convention as 0031/0032/0033).

CREATE TABLE prospect (
  id text PRIMARY KEY,
  code text NOT NULL UNIQUE,
  project_id text NOT NULL REFERENCES project(id),
  name text NOT NULL,
  phone text,
  email text,
  source text,
  sales_owner_user_id text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'BOOKED', 'LOST')),
  lost_reason text,
  customer_id text REFERENCES customer(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX prospect_project_status_idx ON prospect(project_id, status);

CREATE TABLE prospect_personalisation_need (
  id text PRIMARY KEY,
  prospect_id text NOT NULL REFERENCES prospect(id),
  category_code text NOT NULL REFERENCES change_category(code),
  importance text NOT NULL CHECK (importance IN ('MUST_HAVE', 'PREFERRED', 'NOT_IMPORTANT')),
  note text,
  captured_by text,
  captured_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (prospect_id, category_code)
);

CREATE TABLE unit_requirement_match (
  prospect_id text NOT NULL REFERENCES prospect(id),
  unit_id text NOT NULL REFERENCES unit(id),
  score int NOT NULL CHECK (score >= 0 AND score <= 100),
  explanation jsonb NOT NULL DEFAULT '[]',
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (prospect_id, unit_id)
);

CREATE TABLE hold_policy (
  id text PRIMARY KEY,
  project_id text REFERENCES project(id), -- NULL = standard
  max_days int NOT NULL,
  max_active_per_project int NOT NULL,
  allowed_categories text[], -- NULL = every category
  approver_role text NOT NULL,
  auto_expire boolean NOT NULL DEFAULT true
);

CREATE TABLE change_window_hold (
  id text PRIMARY KEY,
  code text NOT NULL UNIQUE,
  unit_id text NOT NULL REFERENCES unit(id),
  project_id text NOT NULL REFERENCES project(id),
  category_code text NOT NULL REFERENCES change_category(code),
  prospect_id text REFERENCES prospect(id),
  booking_id text REFERENCES booking(id),
  requested_by text NOT NULL,
  reason text NOT NULL,
  requested_until date NOT NULL,
  approved_by text,
  approved_until date,
  decision_note text,
  status text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED', 'APPROVED', 'REJECTED', 'EXPIRED', 'RELEASED', 'CONSUMED')),
  policy_id text REFERENCES hold_policy(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
CREATE INDEX change_window_hold_unit_idx ON change_window_hold(unit_id, category_code, status);
CREATE INDEX change_window_hold_project_idx ON change_window_hold(project_id, status);

-- Config: filter thresholds + match weights (rules 1, 4). One row per scope; NULL project = standard.
CREATE TABLE sales_policy (
  id text PRIMARY KEY,
  project_id text REFERENCES project(id),
  highly_customisable_min int NOT NULL DEFAULT 70,
  closing_soon_days int NOT NULL DEFAULT 14,
  match_stale_hours int NOT NULL DEFAULT 24,
  match_weights jsonb NOT NULL DEFAULT '{"MUST_HAVE": 3, "PREFERRED": 1, "NOT_IMPORTANT": 0}',
  state_values jsonb NOT NULL DEFAULT '{"OPEN": 1, "CLOSING": 0.75, "CONDITIONAL": 0.5, "EXCEPTION_ONLY": 0.1, "HARD_CLOSED": 0}',
  must_have_hard_closed_cap int NOT NULL DEFAULT 40,
  -- named inventory filter → change_category code (the spec's LAYOUT_WALLS/KITCHEN/... names
  -- mapped onto the four real seeded categories; bathroom has no category yet — absent = filter off)
  filter_categories jsonb NOT NULL DEFAULT '{"layout_flexible": "structural", "kitchen_open": "kitchen_layout", "electrical_open": "electrical", "flooring_open": "flooring_selection"}'
);

ALTER TABLE booking ADD COLUMN prospect_id text REFERENCES prospect(id);
ALTER TABLE booking ADD COLUMN discount_inr numeric(14, 2);
ALTER TABLE booking ADD COLUMN approval_action_id text REFERENCES action(id);
ALTER TABLE booking ADD COLUMN personalisation_context jsonb; -- copied needs, for 18

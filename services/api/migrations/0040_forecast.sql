-- 20-cash-forecast.md. No existing table names collide (SCHEMA.md has no forecast_* /
-- probability_rule / period_calendar / cash_target row) — all six created fresh.

CREATE TABLE forecast_line (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES project(id),
  booking_id text NOT NULL REFERENCES booking(id),
  demand_id text REFERENCES demand(id),
  loan_case_id text REFERENCES loan_case(id),
  source_type text NOT NULL CHECK (source_type IN
    ('CONTRACTUAL_DUE', 'OVERDUE_RECOVERY', 'PROMISE_TO_PAY', 'LOAN_DISBURSEMENT',
     'REGISTRATION_FINAL_DEMAND', 'APPROVED_RESCHEDULE', 'MANUAL_FINANCE_OVERRIDE', 'SCENARIO_FUTURE_SALES')),
  lane text NOT NULL CHECK (lane IN ('COMMITTED', 'SCENARIO')),
  scenario_id text, -- NULL for COMMITTED lines; set for SCENARIO lines (FK added below, after forecast_scenario exists)
  expected_date date NOT NULL,
  amount_inr numeric NOT NULL,
  probability numeric NOT NULL CHECK (probability >= 0 AND probability <= 1),
  probability_drivers jsonb NOT NULL DEFAULT '[]', -- up to 3 {label, value} facts, display-only
  period text NOT NULL, -- YYYY-MM, derived from expected_date
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REALISED', 'LAPSED', 'SUPERSEDED')),
  realised_receipt_id text REFERENCES receipt(id),
  created_from_event_id text,
  override_by text REFERENCES "user"(id),
  override_at timestamptz,
  override_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX forecast_line_project_period_idx ON forecast_line (project_id, period);
CREATE INDEX forecast_line_demand_idx ON forecast_line (demand_id);
CREATE INDEX forecast_line_status_idx ON forecast_line (project_id, status);

CREATE TABLE forecast_scenario (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES project(id),
  code text NOT NULL, -- BASE | CONSERVATIVE | STRETCH | custom
  is_baseline boolean NOT NULL DEFAULT false, -- exactly one true row per project: BASE
  created_by text REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX forecast_scenario_project_code_idx ON forecast_scenario (project_id, code);
-- Rule 5: "BASE is the baseline" — enforce at most one baseline row per project (a partial
-- unique index, not a CHECK, since the constraint spans rows).
CREATE UNIQUE INDEX forecast_scenario_one_baseline_idx ON forecast_scenario (project_id) WHERE is_baseline;

ALTER TABLE forecast_line ADD CONSTRAINT forecast_line_scenario_fkey FOREIGN KEY (scenario_id) REFERENCES forecast_scenario(id);
ALTER TABLE forecast_line ADD CONSTRAINT forecast_line_lane_scenario_check CHECK (
  (lane = 'COMMITTED' AND scenario_id IS NULL) OR (lane = 'SCENARIO' AND scenario_id IS NOT NULL)
);

CREATE TABLE forecast_assumption (
  id text PRIMARY KEY,
  scenario_id text NOT NULL REFERENCES forecast_scenario(id),
  key text NOT NULL CHECK (key IN
    ('COLLECTION_EFFICIENCY_PCT', 'LOAN_DISBURSEMENT_LAG_DAYS', 'FUTURE_SALES_PER_MONTH',
     'FUTURE_SALE_TICKET_INR', 'CONSTRUCTION_SLIP_DAYS', 'PTP_HONOUR_PCT')),
  value numeric NOT NULL,
  note text
);
CREATE UNIQUE INDEX forecast_assumption_scenario_key_idx ON forecast_assumption (scenario_id, key);

-- Immutable once written (no UPDATE/DELETE anywhere in forecast/snapshots.ts) — rule 3.
CREATE TABLE forecast_snapshot (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES project(id),
  scenario_id text NOT NULL REFERENCES forecast_scenario(id),
  kind text NOT NULL CHECK (kind IN ('MONTH_START', 'WEEKLY', 'MANUAL')),
  taken_at timestamptz NOT NULL DEFAULT now(),
  period_from text NOT NULL,
  period_to text NOT NULL,
  lines jsonb NOT NULL, -- frozen copy of every ACTIVE/REALISED line in scope at taken_at
  totals jsonb NOT NULL, -- per period: {expected, weighted, by_source_type}
  taken_by text REFERENCES "user"(id) -- NULL = system (rule 3: 00:05 IST day-1 / weekly Monday)
);
CREATE INDEX forecast_snapshot_project_idx ON forecast_snapshot (project_id, scenario_id, taken_at DESC);

-- Seed table, DEFAULT_UNCONFIRMED (spec's own Data row) — Policy Studio editable.
CREATE TABLE probability_rule (
  id text PRIMARY KEY,
  source_type text NOT NULL,
  condition jsonb NOT NULL DEFAULT '{}', -- age band / stage / etc., display-only today — see forecast/probability.ts header
  probability numeric NOT NULL CHECK (probability >= 0 AND probability <= 1),
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to date,
  version int NOT NULL DEFAULT 1,
  product_types text[] -- rule 5 (25-policy-studio.md) mechanism, NULL = every product type
);

CREATE TABLE period_calendar (
  project_id text PRIMARY KEY REFERENCES project(id),
  fiscal_year_start_month int NOT NULL DEFAULT 4 CHECK (fiscal_year_start_month BETWEEN 1 AND 12), -- April, UNCONFIRMED — no client FY given
  week_start_day int NOT NULL DEFAULT 1 CHECK (week_start_day BETWEEN 0 AND 6), -- Monday
  product_types text[]
);

CREATE TABLE cash_target (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES project(id),
  period text NOT NULL, -- YYYY-MM
  target_inr numeric NOT NULL,
  set_by text REFERENCES "user"(id),
  product_types text[]
);
CREATE UNIQUE INDEX cash_target_project_period_idx ON cash_target (project_id, period);

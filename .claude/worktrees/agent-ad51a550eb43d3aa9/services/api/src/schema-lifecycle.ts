// Handover / DLP / passport / tower tables. Concatenated with schema.ts at init.

export const schemaLifecycle = `
CREATE TABLE handover_record (
  id text PRIMARY KEY,
  booking_id text NOT NULL UNIQUE REFERENCES booking(id),
  unit_id text NOT NULL REFERENCES unit(id),
  project_id text NOT NULL REFERENCES project(id),
  status text NOT NULL,
  completed_at timestamptz
);
CREATE TABLE dlp_window (
  id text PRIMARY KEY,
  unit_id text NOT NULL REFERENCES unit(id),
  booking_id text NOT NULL REFERENCES booking(id),
  project_id text NOT NULL REFERENCES project(id),
  dlp_start date NOT NULL,
  dlp_end date NOT NULL,
  status text NOT NULL,
  policy_months int NOT NULL
);
CREATE TABLE home_passport_item (
  id text PRIMARY KEY,
  unit_id text NOT NULL REFERENCES unit(id),
  project_id text NOT NULL REFERENCES project(id),
  category text NOT NULL,
  name text NOT NULL,
  brand_model text,
  paint_tile_code text,
  warranty_months int,
  customer_facing boolean NOT NULL DEFAULT true,
  approved boolean NOT NULL DEFAULT true
);
CREATE TABLE warranty_case (
  id text PRIMARY KEY,
  unit_id text NOT NULL REFERENCES unit(id),
  booking_id text NOT NULL REFERENCES booking(id),
  project_id text NOT NULL REFERENCES project(id),
  passport_item_id text REFERENCES home_passport_item(id),
  category text NOT NULL,
  trade text NOT NULL,
  severity text NOT NULL,
  description text NOT NULL,
  coverage text NOT NULL,
  status text NOT NULL,
  chargeable_amount numeric NOT NULL DEFAULT 0,
  root_cause_code text
);
CREATE TABLE service_history (
  id text PRIMARY KEY,
  unit_id text NOT NULL REFERENCES unit(id),
  event_type text NOT NULL,
  warranty_case_id text REFERENCES warranty_case(id),
  description text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL
);
CREATE TABLE checkin_record (
  id text PRIMARY KEY,
  booking_id text NOT NULL REFERENCES booking(id),
  day int NOT NULL,
  status text NOT NULL DEFAULT 'scheduled',
  satisfaction_score int,
  captured_at timestamptz
);
CREATE TABLE intervention (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES project(id),
  category text NOT NULL,
  rank int NOT NULL,
  headline text NOT NULL,
  decision_pack jsonb NOT NULL,
  owner_name text,
  booking_id text,
  unit_id text,
  status text NOT NULL DEFAULT 'open',
  acted_at timestamptz,
  acted_by text
);
`;

-- 15-qa-evidence-snags.md. Two of the spec's seven tables already exist (0000_init.sql):
--   * `qa_evidence` is a DIFFERENT entity — one row per (unit, component) "QA verified" flag that
--     readiness (14) and the handover gate read via qa-evidence.ts::componentsFor. The spec's
--     per-inspection evidence FILE table is created here as `qa_inspection_evidence` instead of
--     replacing it; qa/inspections.ts keeps the legacy row in step (a QA PASS/FAIL upserts it).
--   * `snag` is the same entity — ALTERed in place (07/08's ALTER-not-create discipline). Its
--     legacy `status`/`severity` columns keep the lowercase vocabulary the existing readers
--     (qa-snags.ts, tower-view.ts, seed-lifecycle.ts) filter on; the spec's UPPERCASE names are
--     translated at the API boundary (qa/snags.ts). No CHECK is added to those two columns —
--     rls.test.ts writes 'MINOR' while the seed writes 'minor' — normalisation is the API's job.
-- Audit-stamp user columns carry no FK to "user" (same as event.actor_user_id, 0031's updated_by).

CREATE TABLE qa_checklist_template (
  id text PRIMARY KEY,
  component_code text NOT NULL REFERENCES component_definition(code),
  product_types text[], -- NULL = every product type
  items jsonb NOT NULL DEFAULT '[]', -- [{code, label, evidence NONE|PHOTO|TEST_REPORT|CERTIFICATE, required, severity?, category?}]
  min_photos int NOT NULL DEFAULT 0,
  version int NOT NULL DEFAULT 1,
  effective_from date NOT NULL DEFAULT '2020-01-01',
  effective_to date
);

CREATE TABLE qa_inspection (
  id text PRIMARY KEY,
  unit_id text NOT NULL REFERENCES unit(id),
  project_id text NOT NULL REFERENCES project(id),
  component_code text NOT NULL REFERENCES component_definition(code),
  kind text NOT NULL CHECK (kind IN ('SITE_DECLARATION', 'QA_VERIFICATION', 'RE_INSPECTION')),
  template_id text REFERENCES qa_checklist_template(id),
  status text NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('SCHEDULED', 'IN_PROGRESS', 'PASSED', 'FAILED')),
  inspector_user_id text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  items jsonb NOT NULL DEFAULT '[]', -- [{code, result PASS|FAIL|NA, note}]
  attempt_no int NOT NULL DEFAULT 1,
  failure_reason text,
  action_id text REFERENCES action(id)
);
CREATE INDEX qa_inspection_unit_idx ON qa_inspection(unit_id, component_code);
CREATE INDEX qa_inspection_project_idx ON qa_inspection(project_id);

CREATE TABLE qa_inspection_evidence (
  id text PRIMARY KEY,
  inspection_id text NOT NULL REFERENCES qa_inspection(id),
  item_code text NOT NULL,
  file_key text NOT NULL, -- files port key (ports/files/types.ts)
  kind text NOT NULL CHECK (kind IN ('PHOTO', 'TEST_REPORT', 'CERTIFICATE')),
  captured_at timestamptz NOT NULL DEFAULT now(),
  captured_by text NOT NULL,
  gps jsonb,
  verification_status text NOT NULL DEFAULT 'UPLOADED' CHECK (verification_status IN ('UPLOADED', 'VERIFIED', 'REJECTED')),
  verified_by text,
  verified_at timestamptz,
  superseded_by text REFERENCES qa_inspection_evidence(id) -- rule 2: never deleted, only superseded
);
CREATE INDEX qa_inspection_evidence_inspection_idx ON qa_inspection_evidence(inspection_id);

CREATE TABLE external_dependency (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES project(id),
  hierarchy_node_id text NOT NULL REFERENCES project_hierarchy_node(id),
  kind text NOT NULL CHECK (kind IN ('COMMON_AREA', 'UTILITY_POWER', 'UTILITY_WATER', 'LIFT', 'STP', 'FIRE_NOC', 'OCCUPANCY_CERT', 'OTHER')),
  label text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'IN_PROGRESS', 'DONE')),
  expected_date date,
  owner_user_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX external_dependency_node_idx ON external_dependency(hierarchy_node_id);

CREATE TABLE contractor (
  id text PRIMARY KEY,
  name text NOT NULL,
  trade text,
  contact text,
  active boolean NOT NULL DEFAULT true
);

ALTER TABLE snag ADD COLUMN code text;
ALTER TABLE snag ADD COLUMN booking_id text REFERENCES booking(id);
ALTER TABLE snag ADD COLUMN room text;
ALTER TABLE snag ADD COLUMN category text;
ALTER TABLE snag ADD COLUMN raised_by_kind text;
ALTER TABLE snag ADD COLUMN raised_by_user_id text;
ALTER TABLE snag ADD COLUMN contractor_id text REFERENCES contractor(id);
ALTER TABLE snag ADD COLUMN assigned_to_user_id text;
ALTER TABLE snag ADD COLUMN ready_by_user_id text; -- who marked READY_FOR_VERIFICATION (the "fixer" rule 5's verifier must differ from)
ALTER TABLE snag ADD COLUMN root_cause text;
ALTER TABLE snag ADD COLUMN estimated_cost_inr numeric(14, 2);
ALTER TABLE snag ADD COLUMN actual_cost_inr numeric(14, 2);
ALTER TABLE snag ADD COLUMN sla_clock_id text REFERENCES sla_clock(id);
ALTER TABLE snag ADD COLUMN before_file_keys text[] NOT NULL DEFAULT '{}';
ALTER TABLE snag ADD COLUMN after_file_keys text[] NOT NULL DEFAULT '{}';
ALTER TABLE snag ADD COLUMN customer_verified_at timestamptz;
ALTER TABLE snag ADD COLUMN closed_at timestamptz;
ALTER TABLE snag ADD COLUMN reopen_count int NOT NULL DEFAULT 0;
ALTER TABLE snag ADD COLUMN reopen_reason text;
ALTER TABLE snag ADD COLUMN action_id text REFERENCES action(id);
ALTER TABLE snag ADD COLUMN inspection_id text REFERENCES qa_inspection(id);
ALTER TABLE snag ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
-- Pre-15 rows were free-text; new rows fill these from room/category.
ALTER TABLE snag ALTER COLUMN location DROP NOT NULL;
ALTER TABLE snag ALTER COLUMN trade DROP NOT NULL;
CREATE INDEX snag_project_status_idx ON snag(project_id, status);

-- Rule 6: severity → SLA policy (06). The sla_policy applies_to CHECK only knew task/action/stage
-- targets; snags are a fourth subject kind.
ALTER TABLE sla_policy DROP CONSTRAINT sla_policy_applies_to_check;
ALTER TABLE sla_policy ADD CONSTRAINT sla_policy_applies_to_check
  CHECK (applies_to IN ('TASK_CODE', 'ACTION_TYPE', 'STAGE_CODE', 'SNAG_SEVERITY'));

CREATE TABLE snag_sla_policy (
  severity text PRIMARY KEY CHECK (severity IN ('critical', 'major', 'minor')),
  sla_policy_id text NOT NULL REFERENCES sla_policy(id),
  unconfirmed boolean NOT NULL DEFAULT false -- DEFAULT_UNCONFIRMED per the spec's own Data table
);

-- Rule 7: open MAJOR snags above this count are a soft handover blocker (config, per project).
-- Default 0 is UNCONFIRMED — the spec names no number.
ALTER TABLE handover_policy ADD COLUMN major_snag_max int NOT NULL DEFAULT 0;

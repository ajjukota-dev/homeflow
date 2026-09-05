-- 0004 — journey templates + Journey Template Studio (docs/specs/05-journey-templates.md).
-- Additive only: no existing table is altered here.
-- No FK to sla_policy (06 hasn't landed yet) — journey_task_template.sla_policy_id is a
-- plain text column until 06's migration adds the table and can ALTER in the constraint.

CREATE TABLE journey_template (
  id text PRIMARY KEY,
  code text NOT NULL,
  name text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('STANDARD', 'PROJECT')),
  project_id text REFERENCES project(id), -- null for STANDARD
  parent_template_id text REFERENCES journey_template(id), -- PROJECT inherits STANDARD
  product_type text CHECK (product_type IS NULL OR product_type IN ('APARTMENT', 'VILLA', 'PLOT', 'MIXED')) -- null = all
);
CREATE UNIQUE INDEX journey_template_code_idx ON journey_template(code);
CREATE INDEX journey_template_project_idx ON journey_template(project_id);

CREATE TABLE journey_template_version (
  id text PRIMARY KEY,
  template_id text NOT NULL REFERENCES journey_template(id),
  version int NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'RETIRED')),
  published_at timestamptz,
  published_by text REFERENCES "user"(id),
  -- rule 2 (p47 §34.7 t2): only meaningful when this version replaces a prior PUBLISHED one.
  migration_rule text CHECK (migration_rule IS NULL OR migration_rule IN ('NEW_JOURNEYS_ONLY', 'OFFER_MIGRATION')),
  change_note text
);
CREATE UNIQUE INDEX jtv_template_version_idx ON journey_template_version(template_id, version);

CREATE TABLE journey_stage_template (
  id text PRIMARY KEY,
  version_id text NOT NULL REFERENCES journey_template_version(id),
  code text NOT NULL,
  name text NOT NULL, -- internal
  customer_name text, -- customer wording (p27 §21); null = falls back to `name`
  sort_order int NOT NULL DEFAULT 0,
  stream text NOT NULL CHECK (stream IN ('COMMERCIAL', 'LEGAL', 'FINANCE', 'CONSTRUCTION', 'HANDOVER', 'POST_HANDOVER')),
  customer_visible boolean NOT NULL DEFAULT true,
  planned_duration_days int NOT NULL,
  owner_department text NOT NULL,
  entry_gate_expr text, -- optional; references gates from 08/16/19
  is_mandatory boolean NOT NULL DEFAULT true,
  condition_expr text -- conditional stage DSL, rule 6 in code (journey/dsl.ts)
);
CREATE UNIQUE INDEX jst_version_code_idx ON journey_stage_template(version_id, code);

CREATE TABLE journey_task_template (
  id text PRIMARY KEY,
  stage_template_id text NOT NULL REFERENCES journey_stage_template(id),
  code text NOT NULL,
  title text NOT NULL,
  customer_title text, -- null = internal only
  owner_role text NOT NULL,
  task_type text NOT NULL CHECK (task_type IN ('MANDATORY', 'CONDITIONAL')),
  execution_type text NOT NULL CHECK (execution_type IN ('SIMPLE', 'VERIFICATION', 'EVIDENCE', 'APPROVAL', 'CHECKLIST', 'EXTERNAL')),
  verifier_role text,
  approver_role text,
  external_party text CHECK (external_party IS NULL OR external_party IN ('CUSTOMER', 'SRO', 'BANK', 'VENDOR')),
  required_document_category text,
  checklist_items jsonb NOT NULL DEFAULT '[]',
  priority text NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  sla_policy_id text, -- 06, no FK yet — see file header
  condition_expr text,
  customer_visible boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX jtt_stage_code_idx ON journey_task_template(stage_template_id, code);

CREATE TABLE journey_dependency (
  version_id text NOT NULL REFERENCES journey_template_version(id),
  from_task_code text NOT NULL,
  to_task_code text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('FINISH_TO_START', 'START_TO_START')),
  lag_days int NOT NULL DEFAULT 0,
  PRIMARY KEY (version_id, from_task_code, to_task_code)
);

CREATE TABLE stage_visibility_rule (
  stage_template_id text NOT NULL REFERENCES journey_stage_template(id),
  role_code text NOT NULL,
  visible boolean NOT NULL DEFAULT true,
  PRIMARY KEY (stage_template_id, role_code)
);

-- 0003_canonical.sql forward-declared this column for us (04's Data table already listed
-- it); wire the FK now that the table it points to exists. Rule 1: only a PUBLISHED
-- version may ever be written here (enforced in code, not by a CHECK — status can change
-- after assignment).
ALTER TABLE project ADD CONSTRAINT project_journey_template_version_fk
  FOREIGN KEY (journey_template_version_id) REFERENCES journey_template_version(id);

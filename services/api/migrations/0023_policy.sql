-- 0023 — Policy Studio (docs/specs/25-policy-studio.md). Two things: a generic draft/publish/
-- history envelope for flat config tables that carry no versioning of their own (studio/
-- registry.ts's TABLE_REGISTRY says which tables opt in — 05's journey_template_version and
-- sla_policy's own effective_from/version columns are NOT read through this, they keep their
-- own bespoke versioning), and the approval authority matrix (rule 2) every future spec needing
-- "who approves this exception" will call through approvals/matrix.ts.

CREATE TABLE policy_version (
  id text PRIMARY KEY,
  table_name text NOT NULL,
  row_id text NOT NULL,
  version int NOT NULL,
  effective_from date, -- NULL = still a draft, not yet published
  effective_to date,
  changed_by text REFERENCES "user"(id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  change_note text,
  diff jsonb NOT NULL -- the column values this version sets (draft payload, or what publish applied)
);
CREATE INDEX policy_version_table_row_idx ON policy_version (table_name, row_id, version);

CREATE TABLE approval_authority_rule (
  id text PRIMARY KEY,
  domain text NOT NULL CHECK (domain IN ('DISCOUNT', 'BROKERAGE', 'WAIVER', 'CHANGE_REQUEST', 'COMMITMENT', 'DOCUMENT_DEVIATION', 'GATE_OVERRIDE', 'HOLD', 'PLAN_REVISION')),
  metric text NOT NULL CHECK (metric IN ('INR', 'PCT', 'DAYS', 'BOOL')),
  min numeric,
  max numeric,
  approver_role text NOT NULL,
  second_approver_role text,
  project_id text REFERENCES project(id), -- NULL = applies to every project
  product_types text[], -- rule 5: NULL = applies to every product type
  effective_from date NOT NULL,
  effective_to date,
  version int NOT NULL DEFAULT 1
);
CREATE INDEX approval_authority_rule_lookup_idx ON approval_authority_rule (domain, metric, project_id);

-- Rule 5: "every template/config row carries product_types[]" — the generic Studio envelope's
-- registered tables also carry the column (NULL = applies to every product type). No PLOT-specific
-- row content is seeded here (no interior components / registration-centric journey exist yet to
-- seed honestly) — that's real business config for whichever spec owns those defaults, not
-- something Policy Studio invents; the column is the mechanism, seeding it is deferred.
ALTER TABLE project_calendar ADD COLUMN product_types text[];
ALTER TABLE delay_reason ADD COLUMN product_types text[];
ALTER TABLE action_type ADD COLUMN product_types text[];

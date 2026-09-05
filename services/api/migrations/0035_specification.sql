-- 09-specification-revisions.md (0008 was taken). unit.specification_baseline_id already exists
-- (0003) with no FK; unit_specification below is the spec's own pointer row and the unit column
-- is kept in sync for Unit Twin reads. Drawings are file KEYS via the files port (same as 15's
-- qa_inspection_evidence.file_key) — the spec's `drawing_file_ids[]` has no file table to point at.
CREATE TABLE specification_baseline (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES project(id),
  product_type text NOT NULL CHECK (product_type IN ('APARTMENT', 'VILLA', 'PLOT', 'MIXED')),
  unit_type text,
  name text NOT NULL,
  version int NOT NULL DEFAULT 1,
  items jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'APPROVED', 'RETIRED')),
  approved_by text,
  approved_at timestamptz,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX specification_baseline_lookup_idx ON specification_baseline (project_id, product_type, unit_type, status);

CREATE TABLE spec_revision (
  id text PRIMARY KEY,
  unit_id text NOT NULL REFERENCES unit(id),
  project_id text NOT NULL REFERENCES project(id),
  revision_no int NOT NULL,
  kind text NOT NULL CHECK (kind IN ('BASELINE', 'CUSTOMISATION', 'AS_BUILT_CORRECTION')),
  change_request_id text,
  items_delta jsonb NOT NULL DEFAULT '{}',
  drawing_file_keys text[] NOT NULL DEFAULT '{}',
  note text,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'RELEASED', 'SUPERSEDED')),
  released_at timestamptz,
  released_by text,
  superseded_by_id text REFERENCES spec_revision(id),
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (unit_id, revision_no)
);
CREATE INDEX spec_revision_unit_idx ON spec_revision (unit_id, status);

CREATE TABLE unit_specification (
  unit_id text PRIMARY KEY REFERENCES unit(id),
  baseline_id text NOT NULL REFERENCES specification_baseline(id),
  current_revision_id text REFERENCES spec_revision(id),
  attached_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE variation_catalogue_item (
  id text PRIMARY KEY,
  project_id text REFERENCES project(id),
  category_code text NOT NULL REFERENCES change_category(code),
  code text NOT NULL,
  name text NOT NULL,
  description text,
  unit_price_inr numeric(14, 2) NOT NULL DEFAULT 0,
  vendor_cost_inr numeric(14, 2) NOT NULL DEFAULT 0,
  lead_days int NOT NULL DEFAULT 0,
  product_types text[] NOT NULL DEFAULT '{}',
  constraints jsonb NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX variation_catalogue_item_scope_code_idx ON variation_catalogue_item (COALESCE(project_id, '*'), code);

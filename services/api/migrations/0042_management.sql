-- 27-management-control-tower.md. `intervention` already exists (0000_init.sql, PR #8's Control
-- Tower base) — ALTERed in place rather than replaced, same two-producer-table pattern as 23's
-- registration_case/16's handover_record. project_id stays NOT NULL for now: nothing in this
-- build computes a true portfolio-level (project_id IS NULL) intervention yet — the Data column
-- is nullable for a future portfolio-wide candidate, not retrofitted onto existing per-project
-- rows. status keeps its existing lowercase 'open'/'acted' values (tests already assert on them,
-- same "Appendix names translate, code keeps its case" call as 15's snag severity) — 'dismissed'
-- added alongside.
ALTER TABLE intervention
  ADD COLUMN impact jsonb NOT NULL DEFAULT '{"inr":0,"customers":0,"days":0}',
  ADD COLUMN owner_user_id text REFERENCES "user"(id),
  ADD COLUMN source_refs text[] NOT NULL DEFAULT '{}',
  ADD COLUMN dismiss_reason text,
  ADD COLUMN dismissed_at timestamptz,
  ADD COLUMN action_id text REFERENCES action(id),
  ADD COLUMN computed_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE intervention DROP CONSTRAINT IF EXISTS intervention_status_check;
ALTER TABLE intervention ADD CONSTRAINT intervention_status_check CHECK (status IN ('open', 'acted', 'dismissed'));

CREATE TABLE kpi_definition (
  code text PRIMARY KEY,
  domain text NOT NULL CHECK (domain IN (
    'SALES_HANDOVER', 'JOURNEY', 'COLLECTIONS', 'LEGAL_REGISTRATION', 'QUALITY_HANDOVER',
    'CUSTOMISATION', 'POST_HANDOVER', 'EXPERIENCE', 'PROFITABILITY'
  )),
  name text NOT NULL,
  formula_ref text NOT NULL, -- function name in kpis/queries.ts — checked against a registry, never eval'd
  unit text NOT NULL CHECK (unit IN ('PERCENT', 'DAYS', 'INR', 'COUNT', 'SCORE')),
  direction text NOT NULL CHECK (direction IN ('HIGHER_BETTER', 'LOWER_BETTER')),
  target numeric,
  materiality_ref text -- p24-25 §19 names a materiality band per KPI in prose only; no numeric table given (UNCONFIRMED, ask Pranava) — this column records the intent, unread by any code path
);

CREATE TABLE kpi_snapshot (
  id text PRIMARY KEY,
  kpi_code text NOT NULL REFERENCES kpi_definition(code),
  project_id text REFERENCES project(id), -- null = portfolio-wide
  period text NOT NULL, -- YYYY-MM
  value numeric,
  numerator numeric,
  denominator numeric,
  computed_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX kpi_snapshot_unique_idx ON kpi_snapshot (kpi_code, COALESCE(project_id, ''), period);

CREATE TABLE economic_event (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES project(id),
  booking_id text REFERENCES booking(id),
  unit_id text REFERENCES unit(id),
  kind text NOT NULL CHECK (kind IN (
    'COMMERCIAL_LEAKAGE', 'SERVICE_LEAKAGE', 'QUALITY_COST', 'DELAY_COST', 'COST_TO_SERVE',
    'VARIATION_CONTRIBUTION', 'ABORTIVE_COST'
  )),
  amount_inr numeric NOT NULL,
  source_type text NOT NULL,
  source_id text NOT NULL,
  reason text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX economic_event_project_idx ON economic_event(project_id, kind);
CREATE UNIQUE INDEX economic_event_source_idx ON economic_event(kind, source_type, source_id); -- derive is idempotent: one row per source fact, re-derive upserts

-- rule 1/2/6 config: ranking weights, dismiss cooldown, delay cost ₹/day. Registered in Studio's
-- generic table envelope (studio/core.ts) as a key/value table — same "no versioning columns of
-- its own" fit as 20's three config tables. Seeded with UNCONFIRMED placeholders (see seed/kpis.ts).
CREATE TABLE management_config (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  unconfirmed boolean NOT NULL DEFAULT false
);

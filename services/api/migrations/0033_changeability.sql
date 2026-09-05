-- 08-changeability-engine.md. `change_category` and `change_gate_rule` exist since 0000_init.sql
-- (SCHEMA.md collision table, drift #4) — ALTERed in place, never re-created. `gates.ts::deriveGate`
-- keeps reading `min_state`; the spec's `trigger_state` IS `min_state`. `trigger_event` is the
-- genuinely additive column for the non-progress triggers. Existing seeded rules become version 1,
-- PUBLISHED, standard (project_id NULL).

ALTER TABLE change_category ADD COLUMN product_types text[]; -- NULL = every product type
ALTER TABLE change_category ADD COLUMN trade text;
ALTER TABLE change_category ADD COLUMN default_lead_days int;
ALTER TABLE change_category ADD COLUMN weight int NOT NULL DEFAULT 1; -- rule 9 flexibility weights (UNCONFIRMED: equal)

ALTER TABLE change_gate_rule ADD COLUMN code text;
ALTER TABLE change_gate_rule ADD COLUMN project_id text REFERENCES project(id); -- NULL = standard
ALTER TABLE change_gate_rule ALTER COLUMN min_state DROP NOT NULL; -- NULL when trigger_event drives the rule
ALTER TABLE change_gate_rule ADD COLUMN trigger_event text
  CHECK (trigger_event IS NULL OR trigger_event IN ('PROCUREMENT_ORDERED', 'DRAWING_RELEASED', 'SLAB_CAST', 'HANDOVER_SCHEDULED'));
ALTER TABLE change_gate_rule ADD COLUMN condition_expr text;
ALTER TABLE change_gate_rule ADD COLUMN hard_or_soft text NOT NULL DEFAULT 'HARD' CHECK (hard_or_soft IN ('HARD', 'SOFT'));
ALTER TABLE change_gate_rule ADD COLUMN closing_lead_days int NOT NULL DEFAULT 14; -- UNCONFIRMED
ALTER TABLE change_gate_rule ADD COLUMN exception_authority_role text NOT NULL DEFAULT 'MANAGEMENT';
ALTER TABLE change_gate_rule ADD COLUMN priority int NOT NULL DEFAULT 0;
ALTER TABLE change_gate_rule ADD COLUMN effective_from date NOT NULL DEFAULT '2020-01-01';
ALTER TABLE change_gate_rule ADD COLUMN effective_to date;
ALTER TABLE change_gate_rule ADD COLUMN version int NOT NULL DEFAULT 1;
ALTER TABLE change_gate_rule ADD COLUMN status text NOT NULL DEFAULT 'PUBLISHED' CHECK (status IN ('DRAFT', 'PUBLISHED', 'RETIRED'));
ALTER TABLE change_gate_rule ADD COLUMN publish_reason text; -- rule 6: the reason on the rule version
ALTER TABLE change_gate_rule ADD COLUMN published_by text;
ALTER TABLE change_gate_rule ADD COLUMN published_at timestamptz;
ALTER TABLE change_gate_rule ADD CONSTRAINT change_gate_rule_trigger_check
  CHECK (min_state IS NOT NULL OR trigger_event IS NOT NULL);
UPDATE change_gate_rule SET code = category_code || ':' || trigger_component_code || '>=' || COALESCE(min_state, trigger_event) WHERE code IS NULL;
CREATE INDEX change_gate_rule_scope_idx ON change_gate_rule(status, project_id, category_code);

CREATE TABLE unit_change_gate (
  unit_id text NOT NULL REFERENCES unit(id),
  category_code text NOT NULL REFERENCES change_category(code),
  current_state text NOT NULL CHECK (current_state IN ('OPEN', 'CLOSING', 'CONDITIONAL', 'EXCEPTION_ONLY', 'HARD_CLOSED')),
  reason_code text,
  reason_text text,
  source_event_id bigint,
  source_rule_id int REFERENCES change_gate_rule(id),
  expected_close_at date,
  closing_event text,
  last_evaluated_at timestamptz NOT NULL DEFAULT now(),
  freshness_status text NOT NULL DEFAULT 'FRESH' CHECK (freshness_status IN ('FRESH', 'VERIFICATION_REQUIRED')),
  exception_open boolean NOT NULL DEFAULT false,
  PRIMARY KEY (unit_id, category_code)
);

CREATE TABLE unit_gate_exception (
  id text PRIMARY KEY,
  unit_id text NOT NULL REFERENCES unit(id),
  category_code text NOT NULL REFERENCES change_category(code),
  granted_by text NOT NULL, -- audit stamp, no FK (same as event.actor_user_id)
  authority_role text NOT NULL,
  reason text NOT NULL,
  evidence_file_keys text[] NOT NULL DEFAULT '{}',
  valid_until timestamptz NOT NULL,
  change_request_id text, -- 18, not built — no FK
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'USED', 'EXPIRED', 'REVOKED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
CREATE INDEX unit_gate_exception_unit_idx ON unit_gate_exception(unit_id, category_code, status);

CREATE TABLE gate_evaluation_log (
  id bigserial PRIMARY KEY,
  unit_id text NOT NULL REFERENCES unit(id),
  category_code text NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  from_state text,
  to_state text NOT NULL,
  rule_id int,
  trigger text NOT NULL,
  dry_run boolean NOT NULL DEFAULT false
);
CREATE INDEX gate_evaluation_log_unit_idx ON gate_evaluation_log(unit_id, category_code, at);

-- Rule 9's Unit Customisation Flexibility score joins 14's snapshot history.
ALTER TABLE score_snapshot DROP CONSTRAINT score_snapshot_score_type_check;
ALTER TABLE score_snapshot ADD CONSTRAINT score_snapshot_score_type_check
  CHECK (score_type IN ('UNIT_READINESS', 'BOOKING_READINESS', 'HANDOVER_READINESS', 'CUSTOMER_HEALTH', 'FINANCIAL_HEALTH', 'UNIT_FLEXIBILITY'));

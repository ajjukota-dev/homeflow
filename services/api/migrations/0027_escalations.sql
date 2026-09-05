-- 0027 — Escalation ladder, decision packs & notifications (docs/specs/12-escalations-notifications.md;
-- spec names 0010_escalations.sql, renumbered — migrations apply in filename-sort order and 0010
-- would sort before 0023/0024/0025/0026, which this one depends on: sla_policy.escalation_ladder_id
-- gets a real FK here (0005_journey_instances.sql forward-declared the column with none), and the
-- seeded rule catalogue references demand/tds_record (0024) and loan_case (0026)).
--
-- Reconciliation vs the spec's Data table (same discipline as 07/08/19/21 — see SCHEMA.md):
--  - `escalation`'s spec'd `unique (rule_key, source_entity_id) while open` names no source_entity_id
--    column, only action_id. Rule 1 ties escalations to an action's SLA clock, so action_id IS the
--    natural key — added source_entity_type/source_entity_id as a DENORMALIZED copy from the action
--    (avoids a join for list/filter screens) and built the idempotency index on
--    (rule_key, source_entity_id) exactly as the spec's [E idempotency] note names it.
--  - `escalation_rule`'s `condition` ("typed evaluator per source") is represented concretely as
--    `source_module` (matches action.source_module) + threshold_value/threshold_unit — "this source
--    module, open longer than this threshold" is the one condition shape this codebase's real data
--    supports today; richer per-field conditions (05's `journey/dsl.ts` grammar) would be over-
--    engineering for 13 rules, most of which reduce to exactly this shape.
--  - Added `escalation_rule.decision_options jsonb` (rule 2's "options[] from the action type's
--    configured options" — no such config exists on action_type today; seeded per rule instead).

CREATE TABLE escalation_ladder (
  id text PRIMARY KEY,
  code text NOT NULL UNIQUE,
  steps jsonb NOT NULL, -- [{tier, after_hours, to, notify_channel}], ascending after_hours
  effective_from date NOT NULL,
  effective_to date
);

ALTER TABLE sla_policy ADD CONSTRAINT sla_policy_escalation_ladder_fkey FOREIGN KEY (escalation_ladder_id) REFERENCES escalation_ladder(id);

CREATE TABLE escalation_rule (
  rule_key text PRIMARY KEY,
  severity text NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  department text NOT NULL,
  category text NOT NULL CHECK (category IN ('CUSTOMER', 'CASH', 'HANDOVER', 'REPUTATION', 'MARGIN')),
  source_module text NOT NULL, -- matches action.source_module; "this source, open longer than threshold"
  threshold_value numeric NOT NULL,
  threshold_unit text NOT NULL CHECK (threshold_unit IN ('DAYS', 'HOURS', 'INR')),
  decision_options jsonb NOT NULL DEFAULT '[]', -- [{label, clears_block bool, leakage_inr}]
  wired boolean NOT NULL DEFAULT true, -- false = seeded for Studio visibility only; condition not evaluated yet (underlying module not built)
  effective_from date NOT NULL,
  effective_to date
);

CREATE TABLE escalation (
  id text PRIMARY KEY,
  code text NOT NULL UNIQUE,
  action_id text NOT NULL REFERENCES action(id),
  rule_key text REFERENCES escalation_rule(rule_key), -- null when raised by the generic SLA-ladder path with no matching named rule
  source_entity_type text NOT NULL,
  source_entity_id text NOT NULL,
  project_id text REFERENCES project(id),
  tier text NOT NULL DEFAULT 'L0' CHECK (tier IN ('L0', 'L1', 'L2', 'L3', 'L4')),
  severity text NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  category text NOT NULL CHECK (category IN ('CUSTOMER', 'CASH', 'HANDOVER', 'REPUTATION', 'MARGIN')),
  owner_user_id text REFERENCES "user"(id),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'REOPENED')),
  decision_pack jsonb NOT NULL DEFAULT '{}',
  resolution_notes text,
  raised_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  auto_closed boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX escalation_open_idx ON escalation (rule_key, source_entity_id) WHERE status NOT IN ('RESOLVED', 'CLOSED');
CREATE INDEX escalation_action_idx ON escalation (action_id);
CREATE INDEX escalation_tier_idx ON escalation (tier, status);

CREATE TABLE notification (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id),
  type text NOT NULL,
  title text NOT NULL,
  body text,
  entity_ref jsonb, -- {entity_type, entity_id}
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  channel text NOT NULL DEFAULT 'IN_APP' CHECK (channel IN ('IN_APP', 'EMAIL'))
);
CREATE INDEX notification_user_idx ON notification (user_id, read_at);

CREATE TABLE notification_preference (
  user_id text PRIMARY KEY REFERENCES "user"(id),
  digest_time text NOT NULL DEFAULT '08:30',
  quiet_hours_start text NOT NULL DEFAULT '21:00',
  quiet_hours_end text NOT NULL DEFAULT '08:00',
  email_on text NOT NULL DEFAULT 'ESCALATION' CHECK (email_on IN ('NONE', 'PRE_BREACH', 'ESCALATION', 'ALL')),
  mentions_email boolean NOT NULL DEFAULT true
);

CREATE TABLE materiality_threshold (
  id text PRIMARY KEY,
  scope text NOT NULL CHECK (scope IN ('MANAGEMENT_ALERT', 'CONTROL_TOWER')),
  metric text NOT NULL CHECK (metric IN ('INR_EXPOSURE', 'CUSTOMER_COUNT', 'DAYS_DELAY')),
  value numeric NOT NULL
);

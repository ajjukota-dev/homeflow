-- 31-intelligence.md — risk rules (Policy Studio config), LLM task suggestions (every LLM output
-- is a suggestion until a human accepts, p32 §27), and the three new score types this spec adds
-- to the shared score_snapshot history (14). CUSTOMER_HEALTH/FINANCIAL_HEALTH were already added
-- to score_snapshot's CHECK by 0033 (08's own migration, anticipating this spec) — this is that
-- CHECK's second extension, for the three risk scores.

ALTER TABLE score_snapshot DROP CONSTRAINT score_snapshot_score_type_check;
ALTER TABLE score_snapshot ADD CONSTRAINT score_snapshot_score_type_check
  CHECK (score_type IN ('UNIT_READINESS', 'BOOKING_READINESS', 'HANDOVER_READINESS', 'CUSTOMER_HEALTH', 'FINANCIAL_HEALTH', 'UNIT_FLEXIBILITY', 'JOURNEY_RISK', 'COLLECTION_RISK', 'COMMITMENT_RISK'));

-- Policy Studio config (rule 1-3's weights/conditions) — registered generically in
-- studio/core.ts's TABLE_REGISTRY, same "own effective_from/version columns as plain editable
-- columns" fit as 20's probability_rule (not the draft/publish policy_version envelope).
CREATE TABLE risk_rule (
  id text PRIMARY KEY,
  service text NOT NULL CHECK (service IN ('JOURNEY_RISK', 'COLLECTION_RISK', 'COMMITMENT_RISK', 'CUSTOMER_HEALTH', 'FINANCIAL_HEALTH')),
  signal text NOT NULL,
  condition jsonb NOT NULL DEFAULT '{}',
  weight numeric NOT NULL DEFAULT 1,
  driver_text text NOT NULL,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to date,
  version int NOT NULL DEFAULT 1
);

-- Every LLM output is a suggestion until a human accepts (rule 5/7) — separate from `llm_call`
-- (03's raw per-call audit: purpose/tokens/cost, no business meaning). `llm_task` is one row per
-- suggestion surfaced to a human, `llm_call` is one row per underlying API call — a task always
-- has ≥1 backing call, logged automatically by the `llm` port's own `withLogging` wrapper.
CREATE TABLE llm_task (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('COMMITMENT_DETECTION', 'COMMUNICATION_SUMMARY', 'SENTIMENT', 'DOCUMENT_FIELD_EXTRACTION', 'DOCUMENT_INCONSISTENCY', 'SNAG_ROOT_CAUSE_SUGGESTION')),
  input_ref text NOT NULL,
  output jsonb NOT NULL,
  confidence numeric,
  model text NOT NULL,
  tokens int NOT NULL,
  cost_inr numeric(10,4) NOT NULL,
  reviewed_by text,
  accepted boolean,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX llm_task_kind_idx ON llm_task (kind, at DESC);

-- 0029 — Readiness scores: the shared Score contract + snapshot history
-- (docs/specs/14-readiness-scores.md; spec names 0012_scores.sql, renumbered — applies after 13
-- (commitment, for rule 3's penalty) and 21 (loan_case, for rule 2's loan-state component)).
--
-- `score_weight` exists for schema completeness (Policy Studio "score weights/thresholds" CRUD)
-- but is NOT read by the scorer functions today — `scores/*.ts` use named in-code constants
-- instead. A live weight-table read is real future work (same "config over code" ideal 06's
-- sla_policy/12's escalation_ladder already realize) — flagged, not faked, rather than wiring a
-- read against a table nobody's UI can populate yet.

CREATE TABLE score_snapshot (
  id text PRIMARY KEY,
  score_type text NOT NULL CHECK (score_type IN ('UNIT_READINESS', 'BOOKING_READINESS', 'HANDOVER_READINESS', 'CUSTOMER_HEALTH', 'FINANCIAL_HEALTH')),
  subject_type text NOT NULL,
  subject_id text NOT NULL,
  project_id text REFERENCES project(id),
  computed_at timestamptz NOT NULL DEFAULT now(),
  value numeric(5,2) NOT NULL,
  trend text NOT NULL CHECK (trend IN ('UP', 'FLAT', 'DOWN')),
  drivers jsonb NOT NULL DEFAULT '[]',
  confidence text NOT NULL CHECK (confidence IN ('HIGH', 'MEDIUM', 'LOW')),
  confidence_reason text,
  actions jsonb NOT NULL DEFAULT '[]',
  inputs_hash text
);
CREATE INDEX score_snapshot_subject_idx ON score_snapshot (score_type, subject_id, computed_at DESC);

CREATE TABLE score_weight (
  id text PRIMARY KEY,
  score_type text NOT NULL,
  component text NOT NULL,
  weight numeric NOT NULL,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to date,
  version int NOT NULL DEFAULT 1
);

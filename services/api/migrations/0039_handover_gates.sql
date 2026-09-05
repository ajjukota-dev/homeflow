-- 16-handover-gates.md. ALTER-in-place on the pre-existing `handover_record` (same
-- coexistence pattern as 23's registration_case ALTER, 0038): the legacy row
-- (qa.ts's completeHandover) and this spec's stateful case both read/write one table.
-- code_sequence('HO') backfills existing rows before NOT NULL is applied.
ALTER TABLE handover_record
  ADD COLUMN code text,
  ADD COLUMN predicted_date date,
  ADD COLUMN predicted_confidence text CHECK (predicted_confidence IN ('LOW', 'MEDIUM', 'HIGH')),
  ADD COLUMN readiness_score_snapshot_id text REFERENCES score_snapshot(id),
  ADD COLUMN keys_issued_at timestamptz,
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();

WITH seq AS (
  SELECT id, row_number() OVER (ORDER BY completed_at NULLS LAST, id) AS rn FROM handover_record
)
UPDATE handover_record hr SET code = 'HO-' || lpad(seq.rn::text, 6, '0')
FROM seq WHERE seq.id = hr.id;

INSERT INTO code_sequence (prefix, next_value)
SELECT 'HO', COALESCE((SELECT count(*) FROM handover_record), 0) + 1
ON CONFLICT (prefix) DO UPDATE SET next_value = GREATEST(code_sequence.next_value, EXCLUDED.next_value);

ALTER TABLE handover_record ALTER COLUMN code SET NOT NULL;
ALTER TABLE handover_record ADD CONSTRAINT handover_record_code_key UNIQUE (code);

-- `status` stays the legacy free-text column (only 'completed' written today); the new
-- lifecycle (NOT_STARTED/PREPARING/READY/SCHEDULED/COMPLETED/CLOSED) is layered on top by
-- handover/store.ts's DB_TO_SPEC map, same "DB lowercase, translate at boundary" pattern as
-- model/status.ts and 23's registration_case.status — no CHECK added here since the legacy
-- writer (qa.ts) only ever writes 'completed' and must keep working unchanged.

CREATE TABLE handover_gate_config (
  id text PRIMARY KEY,
  gate text NOT NULL CHECK (gate IN ('FINANCIAL','LEGAL','REGISTRATION','PHYSICAL','QUALITY','COMMITMENTS','CUSTOMER','FM_COMMUNITY')),
  classification text NOT NULL CHECK (classification IN ('HARD','SOFT')),
  overridable boolean NOT NULL DEFAULT true,
  override_roles text[] NOT NULL DEFAULT '{}',
  requires_approval boolean NOT NULL DEFAULT false,
  requires_evidence boolean NOT NULL DEFAULT false,
  product_types text[] NOT NULL DEFAULT '{}',
  project_id text REFERENCES project(id), -- null = standard
  params jsonb NOT NULL DEFAULT '{}',
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  version int NOT NULL DEFAULT 1
);
CREATE INDEX handover_gate_config_gate_idx ON handover_gate_config (gate, project_id);

CREATE TABLE handover_gate_run (
  id text PRIMARY KEY,
  case_id text NOT NULL REFERENCES handover_record(id),
  gate text NOT NULL,
  state text NOT NULL CHECK (state IN ('OPEN','PASSED','OVERRIDDEN')),
  blockers jsonb NOT NULL DEFAULT '[]',
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  override_id text
);
CREATE INDEX handover_gate_run_case_idx ON handover_gate_run (case_id, gate, evaluated_at DESC);

CREATE TABLE handover_override (
  id text PRIMARY KEY,
  case_id text NOT NULL REFERENCES handover_record(id),
  gate text NOT NULL,
  authority_user_id text NOT NULL REFERENCES "user"(id),
  authority_role text NOT NULL,
  approved_by_user_id text REFERENCES "user"(id),
  reason text NOT NULL,
  evidence_file_ids text[] NOT NULL DEFAULT '{}',
  valid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX handover_override_case_idx ON handover_override (case_id);

ALTER TABLE handover_gate_run ADD CONSTRAINT handover_gate_run_override_fk FOREIGN KEY (override_id) REFERENCES handover_override(id);

CREATE TABLE handover_appointment (
  case_id text PRIMARY KEY REFERENCES handover_record(id),
  proposed_slots jsonb NOT NULL DEFAULT '[]',
  confirmed_slot timestamptz,
  confirmed_by text CHECK (confirmed_by IN ('CUSTOMER_PORTAL','CRM_ON_BEHALF')),
  confirmed_at timestamptz,
  attendees jsonb NOT NULL DEFAULT '[]',
  rescheduled_count int NOT NULL DEFAULT 0,
  reschedule_reasons jsonb NOT NULL DEFAULT '[]'
);

CREATE TABLE handover_checklist (
  case_id text PRIMARY KEY REFERENCES handover_record(id),
  groups jsonb NOT NULL DEFAULT '{}',
  customer_signature_file_id text,
  company_signature_file_id text,
  photos jsonb NOT NULL DEFAULT '[]'
);

-- 0005 — journey instances, universal timeline & SLA engine (docs/specs/06-timeline-sla-engine.md).
-- Additive only. Array-typed columns (working_days, holidays, pause_reasons) use jsonb, not a
-- native Postgres array — no existing migration uses array columns (checklist_items is the
-- established jsonb-for-lists precedent, journey_task_template in 0004).

-- Rule 4: "A Cancelled/Not Applicable prerequisite satisfies a dependency only if flagged
-- counts_as_done" — 05's journey_dependency (0004) predates this rule, ALTER it in rather than
-- re-declaring the table.
ALTER TABLE journey_dependency ADD COLUMN counts_as_done boolean NOT NULL DEFAULT false;

CREATE TABLE project_calendar (
  id text PRIMARY KEY,
  name text NOT NULL,
  working_days jsonb NOT NULL DEFAULT '[1,2,3,4,5]', -- 0=Sun..6=Sat
  holidays jsonb NOT NULL DEFAULT '[]', -- ["YYYY-MM-DD", ...]
  timezone text NOT NULL DEFAULT 'Asia/Kolkata'
);

CREATE TABLE delay_reason (
  code text PRIMARY KEY,
  label text NOT NULL,
  category text NOT NULL CHECK (category IN ('CUSTOMER', 'INTERNAL', 'VENDOR', 'STATUTORY', 'FINANCE', 'FORCE_MAJEURE')),
  counts_against_sla boolean NOT NULL DEFAULT true
);

CREATE TABLE sla_policy (
  id text PRIMARY KEY,
  code text NOT NULL,
  applies_to text NOT NULL CHECK (applies_to IN ('TASK_CODE', 'ACTION_TYPE', 'STAGE_CODE')),
  target_ref text NOT NULL,
  duration_value int NOT NULL,
  duration_unit text NOT NULL CHECK (duration_unit IN ('WORKING_DAYS', 'CALENDAR_DAYS', 'HOURS')),
  due_soon_lead_days int NOT NULL DEFAULT 2,
  at_risk_rule text,
  pause_reasons jsonb NOT NULL DEFAULT '[]', -- [delay_reason.code, ...]
  escalation_ladder_id text, -- 12, not built yet — no FK
  effective_from date NOT NULL,
  effective_to date,
  version int NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX sla_policy_code_idx ON sla_policy(code);

CREATE TABLE sla_clock (
  id text PRIMARY KEY,
  subject_type text NOT NULL,
  subject_id text NOT NULL,
  policy_id text NOT NULL REFERENCES sla_policy(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz NOT NULL,
  paused_at timestamptz,
  paused_reason text,
  total_paused_seconds int NOT NULL DEFAULT 0,
  stopped_at timestamptz,
  outcome text CHECK (outcome IS NULL OR outcome IN ('ON_TIME', 'LATE'))
);
CREATE INDEX sla_clock_subject_idx ON sla_clock(subject_type, subject_id);

CREATE TABLE sla_clock_event (
  id text PRIMARY KEY,
  clock_id text NOT NULL REFERENCES sla_clock(id),
  at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL CHECK (kind IN ('START', 'PAUSE', 'RESUME', 'STOP', 'RESET')),
  reason text,
  actor text
);

CREATE TABLE journey_instance (
  id text PRIMARY KEY,
  booking_id text NOT NULL REFERENCES booking(id),
  project_id text NOT NULL REFERENCES project(id),
  template_version_id text NOT NULL REFERENCES journey_template_version(id),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ON_HOLD', 'CLOSED', 'CANCELLED')),
  hold_reason text,
  started_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  close_reason text, -- rule 8: "hold/resume/close ... requires a reason"
  health text NOT NULL DEFAULT 'ON_TRACK' CHECK (health IN ('ON_TRACK', 'DUE_SOON', 'AT_RISK', 'OVERDUE'))
);
CREATE UNIQUE INDEX journey_instance_booking_idx ON journey_instance(booking_id);

CREATE TABLE stage_instance (
  id text PRIMARY KEY,
  journey_id text NOT NULL REFERENCES journey_instance(id),
  stage_code text NOT NULL,
  status text NOT NULL DEFAULT 'NOT_STARTED' CHECK (status IN ('NOT_STARTED', 'IN_PROGRESS', 'WAITING', 'BLOCKED', 'COMPLETED', 'NOT_APPLICABLE')),
  baseline_start date NOT NULL,
  baseline_end date NOT NULL,
  planned_start date NOT NULL,
  planned_end date NOT NULL,
  forecast_start date NOT NULL,
  forecast_end date NOT NULL,
  actual_start date,
  actual_end date,
  owner_user_id text REFERENCES "user"(id),
  progress_pct int NOT NULL DEFAULT 0
);
CREATE INDEX stage_instance_journey_idx ON stage_instance(journey_id);

CREATE TABLE task_instance (
  id text PRIMARY KEY,
  stage_instance_id text NOT NULL REFERENCES stage_instance(id),
  task_code text NOT NULL,
  -- 10 (Universal Action) isn't built yet — a task instance *is* meant to be one Action row;
  -- forward-declared as a plain column (no FK), same pattern as 04→05's journey_template_version_id.
  action_id text,
  baseline_start date NOT NULL,
  baseline_end date NOT NULL,
  planned_start date NOT NULL,
  planned_end date NOT NULL,
  forecast_start date NOT NULL,
  forecast_end date NOT NULL,
  actual_start date,
  actual_end date,
  -- Appendix A (p41) Action states, reused here since task_instance.status *is* an Action's
  -- status per 06's Data table ("same four date pairs, status (Appendix A Action states)").
  status text NOT NULL DEFAULT 'New' CHECK (status IN ('New', 'In Progress', 'Waiting Internal', 'Waiting Customer', 'Blocked', 'Ready for Approval', 'Closed', 'Cancelled')),
  sla_clock_id text REFERENCES sla_clock(id)
);
CREATE INDEX task_instance_stage_idx ON task_instance(stage_instance_id);
CREATE UNIQUE INDEX task_instance_stage_code_idx ON task_instance(stage_instance_id, task_code);

CREATE TABLE timeline_plan_revision (
  id text PRIMARY KEY,
  journey_id text NOT NULL REFERENCES journey_instance(id),
  revised_at timestamptz NOT NULL DEFAULT now(),
  revised_by text REFERENCES "user"(id),
  reason_code text NOT NULL REFERENCES delay_reason(code),
  note text,
  changes jsonb NOT NULL DEFAULT '[]' -- [{stage_code, old_planned_start, new_planned_start, ...}]
);

CREATE TABLE timeline_forecast_revision (
  id text PRIMARY KEY,
  journey_id text NOT NULL REFERENCES journey_instance(id),
  computed_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL CHECK (source IN ('SYSTEM', 'MANUAL')),
  changes jsonb NOT NULL DEFAULT '[]',
  confidence numeric
);

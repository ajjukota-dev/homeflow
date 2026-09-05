-- 0009 — Universal Action (docs/specs/10-universal-action.md). Additive only.
-- Filename matches the spec's own suggestion verbatim: 07 (0006_progress.sql) and
-- 08 (0007_changeability.sql) will fill 0006-0008 later — migrations apply in filename
-- order (db/migrate.ts), not creation order, so the numeric gap is safe.

-- action_type keyed by EXECUTION TYPE (the 6-value enum journey_task_template already has),
-- not by task_code. A per-task-code key would collide with 05: Journey Template Studio lets
-- Amarsh author PROJECT-scope templates with arbitrary new task codes, and createAction() must
-- never throw "unknown type" for a task code it has never seen. Every field that's genuinely
-- per-task (owner_role, verifier/approver_role, priority, customer_visible, sla policy) is
-- passed explicitly by the caller (journey/instances.ts) at action-creation time — action_type
-- only supplies the execution-family defaults, which are closed over the 6-value enum for good.
CREATE TABLE action_type (
  code text PRIMARY KEY,
  family text NOT NULL CHECK (family IN ('TASK', 'APPROVAL', 'FOLLOW_UP', 'DOCUMENT_REQUEST', 'EXCEPTION', 'ESCALATION', 'VERIFICATION')),
  label text NOT NULL,
  customer_label text,
  default_owner_role text NOT NULL,
  default_priority text NOT NULL DEFAULT 'MEDIUM' CHECK (default_priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  default_sla_policy_id text REFERENCES sla_policy(id),
  default_evidence_requirement text NOT NULL DEFAULT 'NONE' CHECK (default_evidence_requirement IN ('NONE', 'ATTACHMENT', 'VERIFIED_ATTACHMENT', 'CHECKLIST', 'APPROVAL', 'EXTERNAL_REF')),
  customer_visible_default boolean NOT NULL DEFAULT false
);

CREATE TABLE action (
  id text PRIMARY KEY,
  code text NOT NULL,
  type text NOT NULL REFERENCES action_type(code),
  title text NOT NULL,
  description text,
  project_id text REFERENCES project(id),
  source_module text NOT NULL,
  source_entity_type text NOT NULL,
  source_entity_id text NOT NULL,
  booking_id text REFERENCES booking(id),
  unit_id text REFERENCES unit(id),
  customer_id text REFERENCES customer(id),
  owner_user_id text REFERENCES "user"(id),
  owner_role text NOT NULL, -- fallback queue when owner_user_id is null (rule 5)
  backup_owner_user_id text REFERENCES "user"(id),
  due_at timestamptz,
  priority text NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  sla_clock_id text REFERENCES sla_clock(id),
  status text NOT NULL DEFAULT 'New' CHECK (status IN ('New', 'In Progress', 'Waiting Internal', 'Waiting Customer', 'Blocked', 'Ready for Approval', 'Closed', 'Cancelled')),
  blocking_reason text,
  depends_on_action_id text REFERENCES action(id),
  customer_visible boolean NOT NULL DEFAULT false,
  customer_title text,
  evidence_requirement text NOT NULL DEFAULT 'NONE' CHECK (evidence_requirement IN ('NONE', 'ATTACHMENT', 'VERIFIED_ATTACHMENT', 'CHECKLIST', 'APPROVAL', 'EXTERNAL_REF')),
  approver_role text,
  verifier_role text,
  external_reference text, -- EXTERNAL_REF close gate (spec's evidence_requirement value, no dedicated table)
  escalation_tier text NOT NULL DEFAULT 'L0' CHECK (escalation_tier IN ('L0', 'L1', 'L2', 'L3', 'L4')),
  origin text NOT NULL CHECK (origin IN ('AUTO', 'MANUAL')),
  created_by text REFERENCES "user"(id), -- null for AUTO (system-authored, no ctx)
  -- Who last moved this to Ready for Approval / did the work being verified. The self-verify
  -- and self-approve guards key on THIS, not on owner_user_id or the current actor — Emergent's
  -- own bug (emergent-business-rules.md §3.2): "/assign has no status guard — reassign-then-
  -- verify defeats [guards keyed on the current owner]. Ours should key on the submitter."
  submitted_by text REFERENCES "user"(id),
  closed_at timestamptz,
  closed_by text REFERENCES "user"(id),
  close_note text,
  impact jsonb NOT NULL DEFAULT '{}' -- {revenue_inr, customer_count, dependency_count} — for 11, not consumed here
);
CREATE UNIQUE INDEX action_code_idx ON action(code);
CREATE INDEX action_owner_role_idx ON action(owner_role, status);
CREATE INDEX action_owner_user_idx ON action(owner_user_id, status);
CREATE INDEX action_source_idx ON action(source_entity_type, source_entity_id);

CREATE TABLE action_checklist_item (
  id text PRIMARY KEY,
  action_id text NOT NULL REFERENCES action(id),
  label text NOT NULL,
  required boolean NOT NULL DEFAULT true,
  checked_at timestamptz,
  checked_by text REFERENCES "user"(id)
);
CREATE INDEX action_checklist_action_idx ON action_checklist_item(action_id);

CREATE TABLE action_evidence (
  id text PRIMARY KEY,
  action_id text NOT NULL REFERENCES action(id),
  -- No generic file/document registry table exists yet (17/22 not built) — file_key is the
  -- files port's own storage key (ports/files/types.ts), not a FK. Same "forward-declared,
  -- no FK" pattern as 06's task_instance.action_id (now resolved below).
  file_key text NOT NULL,
  kind text,
  uploaded_by text NOT NULL REFERENCES "user"(id),
  verification_status text NOT NULL DEFAULT 'UPLOADED' CHECK (verification_status IN ('UPLOADED', 'VERIFIED', 'REJECTED')),
  verified_by text REFERENCES "user"(id),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX action_evidence_action_idx ON action_evidence(action_id);

CREATE TABLE action_transition (
  id text PRIMARY KEY,
  action_id text NOT NULL REFERENCES action(id),
  from_status text NOT NULL, -- "from"/"to" are reserved words, avoided rather than quoted forever
  to_status text NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  actor text REFERENCES "user"(id), -- null for a system-authored reset (reopen cascade)
  reason text
);
CREATE INDEX action_transition_action_idx ON action_transition(action_id);

-- 06's task_instance.action_id was forward-declared with no FK ("10 isn't built yet") —
-- now it can be a real one.
ALTER TABLE task_instance ADD CONSTRAINT task_instance_action_id_fkey FOREIGN KEY (action_id) REFERENCES action(id);

-- Departmental queues (rule 5, GET /queues/:role): open actions grouped by owner_role, counts
-- by status. SLA state isn't in the view (deriveStatus is a TS function over sla_clock, not
-- reproducible in SQL without duplicating engine.ts's rules) — the route computes it per-row.
CREATE VIEW departmental_queue AS
  SELECT owner_role, status, count(*)::int AS count
    FROM action
   WHERE status NOT IN ('Closed', 'Cancelled')
   GROUP BY owner_role, status;

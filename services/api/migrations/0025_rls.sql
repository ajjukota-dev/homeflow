-- 0025 — Row-level security (P1 of the 2026-09-05 consolidation:
-- docs/reports/2026-09-05-branch-review.md §6/§8). Ported concept from Vivek's
-- vivek/v1-on-postgres branch (docs/spec/technical/02-database.md §3, §7 of
-- 03-identity.md) — same USING(current_setting(...)) pattern, adapted to this
-- codebase's real (not proposed) table names.
--
-- Empirically verified against PGlite before writing this file (not assumed):
-- a non-superuser role created with `SET ROLE` inside PGlite's single-user
-- WASM connection genuinely enforces RLS — including fail-closed when
-- app.realm is unset/empty, and INSERT rejection via the implicit
-- WITH CHECK == USING behavior (no separate WITH CHECK clause needed here).
-- This contradicts the branch-review brief's G2 finding ("none of it can be
-- exercised locally") — logged as a deviation, not a silent scope change.
--
-- Scope of THIS migration (deliberately bounded — see the PR description for
-- the full table audit): staff-realm policies only, on tables that carry a
-- direct `project_id` column. Customer-realm policies (scoped by customer_id
-- via booking_applicant/customer_login, a different join shape) and
-- join-reachable tables (e.g. waiver/tds_record/financial_clearance via
-- booking_id, stage_instance/task_instance via journey_id) are follow-up work
-- (P1b/P1c) — enumerated below so the exclusion is a decision, not an
-- oversight.
--
-- GUCs (app.realm, app.project_ids, app.all_projects) are not yet wired into
-- any request path — that's the second PR (P1b: thread ctx.actor into
-- pg-adapter's transaction() via SET LOCAL). Until then this migration is
-- inert for every existing code path (all ~100 call sites run as the
-- superuser `db` connection, which bypasses RLS by definition) and is
-- exercised only by this migration's own sweep test, which SET ROLEs
-- explicitly. That's intentional, not a gap — see rls.test.ts.

-- Non-superuser application role. NOBYPASSRLS is the point: PGlite's own
-- default connection (like a real superuser) always bypasses RLS, which is
-- exactly why a non-superuser role is required to test or use it at all.
CREATE ROLE homeflow_app LOGIN NOBYPASSRLS;

-- Blanket grants so a table created by a LATER migration is usable by
-- homeflow_app without a per-migration GRANT line (ALTER DEFAULT PRIVILEGES
-- covers future CREATE TABLEs; the explicit GRANT covers the ~65 tables that
-- already exist as of this migration). Verified against PGlite: a table
-- created after this statement inherits the grant with no explicit GRANT.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO homeflow_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO homeflow_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO homeflow_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO homeflow_app;

-- `project` itself: scoped by its own `id`, not a `project_id` column —
-- handled separately from the loops below.
ALTER TABLE project ENABLE ROW LEVEL SECURITY;
ALTER TABLE project FORCE ROW LEVEL SECURITY;
CREATE POLICY project_scope ON project USING (
  current_setting('app.realm', true) = 'staff'
  AND (
    current_setting('app.all_projects', true) = 'true'
    OR id = ANY(string_to_array(nullif(current_setting('app.project_ids', true), ''), ','))
  )
);

-- Group A: `project_id` is NOT NULL (or the table's PK) — every row belongs
-- to exactly one project, no "global row" case.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'project_hierarchy_node',  -- 0003: NOT NULL
    'unit',                    -- 0000: NOT NULL, immutable (0003 trigger)
    'collection_policy',       -- 0000: project_id IS the PK
    'booking',                 -- 0000: NOT NULL
    'demand',                  -- 0000: NOT NULL
    'receipt',                 -- 0000: NOT NULL
    'generated_document',      -- 0000: NOT NULL
    'registration_case',       -- 0000: NOT NULL
    'snag',                    -- 0000: NOT NULL
    'handover_record',         -- 0000: NOT NULL
    'dlp_window',               -- 0000: NOT NULL
    'home_passport_item',      -- 0000: NOT NULL
    'warranty_case',           -- 0000: NOT NULL
    'handover_policy',         -- 0000: project_id IS the PK
    'intervention',            -- 0000: NOT NULL
    'journey_instance'         -- 0005: NOT NULL
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY project_scope ON %I USING (
         current_setting(''app.realm'', true) = ''staff''
         AND (
           current_setting(''app.all_projects'', true) = ''true''
           OR project_id = ANY(string_to_array(nullif(current_setting(''app.project_ids'', true), ''''), '',''))
         )
       )', t
    );
  END LOOP;
END $$;

-- Group B: `project_id` is nullable, and NULL has real business meaning —
-- "applies to every project" / "not tied to a project yet" — so those rows
-- stay visible to any in-realm staff member regardless of project
-- assignment, on top of the same project match as Group A.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'payment_plan',            -- 0000: nullable
    'document_template',       -- 0000: nullable
    'event',                   -- 0002: nullable (some system events carry none)
    'journey_template',        -- 0004: NULL = STANDARD (shared across projects)
    'action',                  -- 0009: nullable
    'approval_authority_rule'  -- 0023: NULL = applies to every project (rule text says so explicitly)
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY project_scope ON %I USING (
         current_setting(''app.realm'', true) = ''staff''
         AND (
           current_setting(''app.all_projects'', true) = ''true''
           OR project_id IS NULL
           OR project_id = ANY(string_to_array(nullif(current_setting(''app.project_ids'', true), ''''), '',''))
         )
       )', t
    );
  END LOOP;
END $$;

-- Deliberately NOT enabled here (audited, not overlooked):
--
-- Identity / principal-loading tables (0001_identity.sql: "user", session,
-- invite, password_reset, role, user_role, team, project_team_assignment,
-- permission_matrix, field_sensitivity, customer_login, auth_event) — some of
-- these (project_team_assignment) are themselves how project_ids gets
-- resolved before a transaction's GUCs can be set. RLS-ing them is a real
-- future improvement (limits which staff can see which team assignments) but
-- needs its own design pass for the chicken-and-egg read, not folded into
-- this migration. Same reasoning for the OTP/session tables Vivek's spec adds
-- (P3, not yet ported).
--
-- Global config / registry tables — every role that can reach them at all
-- needs to see every row, project has no bearing: component_definition,
-- change_category, change_gate_rule, overdue_reason, event_type, portfolio,
-- code_sequence, action_type, delay_reason, sla_policy, project_calendar,
-- llm_call, policy_version, journey_template_version,
-- journey_stage_template, journey_task_template, journey_dependency,
-- stage_visibility_rule.
--
-- Join-reachable tables with no direct `project_id` column — a policy can't
-- join, only subquery, which is a real option (`USING (booking_id IN (SELECT
-- id FROM booking WHERE project_id = ANY(...)))`) deferred to keep this PR
-- reviewable rather than a ~40-table diff in one shot (P1b, tracked in
-- TODO.md): customer, booking_applicant, payment_plan_milestone,
-- promise_to_pay, loan_case, qa_evidence, service_history, checkin_record,
-- unit_progress, event_delivery_failure, action_checklist_item,
-- action_evidence, action_transition, sla_clock, sla_clock_event,
-- stage_instance, task_instance, timeline_plan_revision,
-- timeline_forecast_revision, tds_record, waiver, financial_clearance.
-- Denormalizing a `project_id` onto any of these instead is a schema change
-- and needs Amarsh's sign-off per CLAUDE.md "Ask first: DB schema/migrations".

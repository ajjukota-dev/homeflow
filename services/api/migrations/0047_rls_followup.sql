-- 0047 — RLS follow-up (Phase 4.1). Additive; do not rewrite 0025.
-- 1) ENABLE RLS + project_scope on every post-0025 table that carries project_id
--    (0025 covered tables that existed then; later specs added loan_case, commitment, …).
-- 2) Join-reachable loan_event (no project_id) via loan_case.
-- 3) Customer-realm policies (0025 P1c) so customer A cannot SELECT customer B's
--    booking / demand / receipt / unit / project / customer.

-- Identity tables with project_id stay unscoped (0025: chicken-and-egg for
-- resolveProjectIds). Global config without project_id stays visible to staff.

DO $$
DECLARE
  t record;
  using_sql text;
BEGIN
  FOR t IN
    SELECT c.relname AS table_name, a.attnotnull AS not_null
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'project_id' AND a.attnum > 0 AND NOT a.attisdropped
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND c.relname NOT IN ('team', 'project_team_assignment')
       AND NOT EXISTS (
         SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'project_scope'
       )
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t.table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t.table_name);
    IF t.not_null THEN
      using_sql :=
        'current_setting(''app.realm'', true) = ''staff'' AND ('
        || 'current_setting(''app.all_projects'', true) = ''true'' '
        || 'OR project_id = ANY(string_to_array(nullif(current_setting(''app.project_ids'', true), ''''), '','')))';
    ELSE
      using_sql :=
        'current_setting(''app.realm'', true) = ''staff'' AND ('
        || 'current_setting(''app.all_projects'', true) = ''true'' '
        || 'OR project_id IS NULL '
        || 'OR project_id = ANY(string_to_array(nullif(current_setting(''app.project_ids'', true), ''''), '','')))';
    END IF;
    EXECUTE format('CREATE POLICY project_scope ON %I USING (%s)', t.table_name, using_sql);
  END LOOP;
END $$;

-- loan_event: no project_id; scope through loan_case (prompt: loan_case / loan_event).
ALTER TABLE loan_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE loan_event FORCE ROW LEVEL SECURITY;
CREATE POLICY project_scope ON loan_event USING (
  current_setting('app.realm', true) = 'staff'
  AND (
    current_setting('app.all_projects', true) = 'true'
    OR loan_id IN (
      SELECT id FROM loan_case
       WHERE project_id = ANY(string_to_array(nullif(current_setting('app.project_ids', true), ''), ','))
    )
  )
);

-- customer: no project_id. Staff see customers who have a booking in scope.
ALTER TABLE customer ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer FORCE ROW LEVEL SECURITY;
CREATE POLICY project_scope ON customer USING (
  current_setting('app.realm', true) = 'staff'
  AND (
    current_setting('app.all_projects', true) = 'true'
    OR id IN (
      SELECT a.customer_id
        FROM booking_applicant a
        JOIN booking b ON b.id = a.booking_id
       WHERE b.project_id = ANY(string_to_array(nullif(current_setting('app.project_ids', true), ''), ','))
    )
  )
);

-- Customer-realm: own booking via customer_login (e41 Ananya ↛ Karthik).
CREATE POLICY customer_own ON booking USING (
  current_setting('app.realm', true) = 'customer'
  AND id IN (SELECT booking_id FROM customer_login WHERE user_id = current_setting('app.user_id', true))
);
CREATE POLICY customer_own ON demand USING (
  current_setting('app.realm', true) = 'customer'
  AND booking_id IN (SELECT booking_id FROM customer_login WHERE user_id = current_setting('app.user_id', true))
);
CREATE POLICY customer_own ON receipt USING (
  current_setting('app.realm', true) = 'customer'
  AND booking_id IN (SELECT booking_id FROM customer_login WHERE user_id = current_setting('app.user_id', true))
);
CREATE POLICY customer_own ON unit USING (
  current_setting('app.realm', true) = 'customer'
  AND id IN (
    SELECT b.unit_id FROM booking b
      JOIN customer_login cl ON cl.booking_id = b.id
     WHERE cl.user_id = current_setting('app.user_id', true)
  )
);
CREATE POLICY customer_own ON project USING (
  current_setting('app.realm', true) = 'customer'
  AND id IN (
    SELECT b.project_id FROM booking b
      JOIN customer_login cl ON cl.booking_id = b.id
     WHERE cl.user_id = current_setting('app.user_id', true)
  )
);
CREATE POLICY customer_own ON customer USING (
  current_setting('app.realm', true) = 'customer'
  AND id IN (SELECT customer_id FROM customer_login WHERE user_id = current_setting('app.user_id', true))
);
CREATE POLICY customer_own ON loan_event USING (
  current_setting('app.realm', true) = 'customer'
  AND loan_id IN (
    SELECT lc.id FROM loan_case lc
      JOIN customer_login cl ON cl.booking_id = lc.booking_id
     WHERE cl.user_id = current_setting('app.user_id', true)
  )
);

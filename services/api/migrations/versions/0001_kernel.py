"""0001 kernel — functions, roles and grants, identity, event, job, file_object.

DDL per technical/02 §1, §4.1-4.4. session/otp_challenge are created here without their
customer_id FK; 0002 adds it once `customer` exists (recorded in the item-3 report).
"""
from __future__ import annotations

from migrations.sql import sql

revision = "0001_kernel"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    sql("CREATE EXTENSION IF NOT EXISTS pgcrypto;")
    sql("CREATE EXTENSION IF NOT EXISTS pg_trgm;")
    sql("CREATE EXTENSION IF NOT EXISTS citext;")
    _functions()
    _roles_and_grants()
    _identity()
    _event()
    _jobs()
    _files()
    _idempotency()
    _late_grants()


def _functions() -> None:
    # uuid v7: 48-bit big-endian unix millis, then RFC 9562 "replace leftmost random bits
    # with increased clock precision" — the 12 rand_a bits carry the sub-millisecond
    # fraction, so ids from the same millisecond still sort in generation order. The
    # remaining 62 bits stay random (gen_random_uuid), so ids are unguessable.
    # ponytail: no session counter; two ids inside the same ~244 ns tick fall back to
    # random ordering. Add a counter only if a workload ever needs strict monotonicity.
    sql(
        """
        CREATE OR REPLACE FUNCTION uuid_generate_v7() RETURNS uuid AS $fn$
        DECLARE
          now_us bigint;
          sub_ms int;
          b bytea;
        BEGIN
          now_us := (extract(epoch FROM clock_timestamp()) * 1000000)::bigint;
          sub_ms := ((now_us % 1000) * 4096 / 1000)::int;          -- 12 bits of rand_a
          b := uuid_send(gen_random_uuid());
          b := overlay(b PLACING substring(int8send(now_us / 1000) FROM 3) FROM 1 FOR 6);
          b := set_byte(b, 6, 112 + (sub_ms >> 8));                -- version 7 + rand_a hi
          b := set_byte(b, 7, sub_ms & 255);                       -- rand_a lo
          b := set_byte(b, 8, 128 + (get_byte(b, 8) & 63));        -- RFC 4122 variant
          RETURN encode(b, 'hex')::uuid;
        END $fn$ LANGUAGE plpgsql VOLATILE;
        """
    )
    sql(
        """
        CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $fn$
        BEGIN NEW.updated_at := now(); RETURN NEW; END $fn$ LANGUAGE plpgsql;
        """
    )
    # TG_ARGV[0] = parent table, TG_ARGV[1] = the FK column on this table.
    sql(
        """
        CREATE OR REPLACE FUNCTION enforce_project_id() RETURNS trigger AS $fn$
        DECLARE
          parent_project uuid;
          fk_value uuid;
        BEGIN
          EXECUTE format('SELECT ($1).%I', TG_ARGV[1]) INTO fk_value USING NEW;
          IF fk_value IS NULL THEN RETURN NEW; END IF;
          EXECUTE format('SELECT project_id FROM %I WHERE id = $1', TG_ARGV[0])
            INTO parent_project USING fk_value;
          IF parent_project IS NULL THEN
            RAISE EXCEPTION 'parent % % not found', TG_ARGV[0], fk_value
              USING ERRCODE = 'foreign_key_violation';
          END IF;
          IF NEW.project_id IS NOT NULL AND NEW.project_id <> parent_project THEN
            RAISE EXCEPTION 'project_id % does not match %.project_id %',
              NEW.project_id, TG_ARGV[0], parent_project USING ERRCODE = 'check_violation';
          END IF;
          NEW.project_id := parent_project;
          RETURN NEW;
        END $fn$ LANGUAGE plpgsql;
        """
    )
    # Read the customer GUC once, safely: '' (anonymous) must not raise 22P02.
    sql(
        """
        CREATE OR REPLACE FUNCTION _hf_customer_id() RETURNS uuid AS $fn$
          SELECT nullif(current_setting('app.customer_id', true), '')::uuid;
        $fn$ LANGUAGE sql STABLE;
        """
    )


def _roles_and_grants() -> None:
    """technical/02 §1. Idempotent: compose init and the CDK custom resource also create these."""
    sql(
        """
        DO $do$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'homeflow_owner') THEN
            CREATE ROLE homeflow_owner LOGIN;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'homeflow_app') THEN
            CREATE ROLE homeflow_app LOGIN NOBYPASSRLS;
          END IF;
        END $do$;
        """
    )
    sql("GRANT USAGE ON SCHEMA public TO homeflow_app;")
    # No DELETE by default: material history is never deleted (technical/02 §1).
    sql(
        "ALTER DEFAULT PRIVILEGES FOR ROLE homeflow_owner IN SCHEMA public"
        " GRANT SELECT, INSERT, UPDATE ON TABLES TO homeflow_app;"
    )
    sql(
        "ALTER DEFAULT PRIVILEGES FOR ROLE homeflow_owner IN SCHEMA public"
        " GRANT USAGE ON SEQUENCES TO homeflow_app;"
    )
    sql(
        "ALTER DEFAULT PRIVILEGES FOR ROLE homeflow_owner IN SCHEMA public"
        " GRANT EXECUTE ON FUNCTIONS TO homeflow_app;"
    )
    sql("GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO homeflow_app;")


def _identity() -> None:
    sql(
        """
        CREATE TABLE "user" (
          id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
          email citext UNIQUE NOT NULL, full_name text NOT NULL, phone text,
          is_active boolean NOT NULL DEFAULT true,
          google_sub text UNIQUE,
          last_login_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now());

        CREATE TABLE role (
          id text PRIMARY KEY, name text NOT NULL,
          all_projects boolean NOT NULL DEFAULT false);

        CREATE TABLE user_role_assignment (
          user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
          role_id text NOT NULL REFERENCES role(id) ON DELETE RESTRICT,
          PRIMARY KEY (user_id, role_id));

        CREATE TABLE permission (
          role_id text NOT NULL REFERENCES role(id) ON DELETE RESTRICT,
          module text NOT NULL,
          level text NOT NULL CHECK (level IN
            ('none','read_status_only','read_limited','read','write','admin')),
          modifiers jsonb NOT NULL DEFAULT '{}',
          PRIMARY KEY (role_id, module));

        CREATE TABLE session (
          id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
          token_hash bytea UNIQUE NOT NULL,
          realm text NOT NULL CHECK (realm IN ('staff','customer')),
          user_id uuid REFERENCES "user"(id) ON DELETE RESTRICT,
          customer_id uuid,
          CONSTRAINT session_realm_subject CHECK (
            (realm = 'staff' AND user_id IS NOT NULL)
            OR (realm = 'customer' AND customer_id IS NOT NULL)),
          created_at timestamptz NOT NULL DEFAULT now(),
          last_seen_at timestamptz NOT NULL DEFAULT now(),
          expires_at timestamptz NOT NULL, ip inet, user_agent text, revoked_at timestamptz);
        CREATE INDEX session_user_active_idx ON session (user_id) WHERE revoked_at IS NULL;

        CREATE TABLE otp_challenge (
          id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
          phone text NOT NULL, customer_id uuid NOT NULL,
          code_hash bytea NOT NULL, expires_at timestamptz NOT NULL,
          attempts int NOT NULL DEFAULT 0, consumed_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now());
        CREATE INDEX otp_challenge_phone_idx ON otp_challenge (phone, created_at);

        CREATE TRIGGER user_set_updated_at BEFORE UPDATE ON "user"
          FOR EACH ROW EXECUTE FUNCTION set_updated_at();
        """
    )


def _event() -> None:
    sql(
        """
        CREATE TABLE event (
          id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
          event_type text NOT NULL,
          occurred_at timestamptz NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
          project_id uuid,
          actor jsonb NOT NULL, subject jsonb NOT NULL, payload jsonb NOT NULL DEFAULT '{}',
          previous_state jsonb, new_state jsonb, reason_code text,
          correlation_id uuid, source jsonb);
        CREATE INDEX event_project_recorded_idx ON event (project_id, recorded_at DESC);
        CREATE INDEX event_correlation_idx ON event (correlation_id);
        CREATE INDEX event_subject_idx ON event USING gin (subject jsonb_path_ops);
        """
    )
    _nullable_project_rls("event")


def _jobs() -> None:
    sql(
        """
        CREATE TABLE job (
          id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
          kind text NOT NULL, args jsonb NOT NULL DEFAULT '{}',
          status text NOT NULL DEFAULT 'queued'
            CHECK (status IN ('queued','running','done','failed','dead')),
          run_at timestamptz NOT NULL DEFAULT now(),
          attempts int NOT NULL DEFAULT 0, max_attempts int NOT NULL DEFAULT 5,
          last_error text, dedupe_key text, correlation_id uuid, project_id uuid,
          created_at timestamptz NOT NULL DEFAULT now(),
          started_at timestamptz, finished_at timestamptz);
        CREATE INDEX job_queued_idx ON job (run_at) WHERE status = 'queued';
        CREATE UNIQUE INDEX job_dedupe_idx ON job (dedupe_key)
          WHERE status IN ('queued','running');

        CREATE TABLE schedule (
          kind text PRIMARY KEY, args jsonb NOT NULL DEFAULT '{}',
          every_seconds int, daily_at time,
          CONSTRAINT schedule_one_cadence CHECK ((every_seconds IS NULL) <> (daily_at IS NULL)),
          enabled boolean NOT NULL DEFAULT true,
          last_run_at timestamptz, next_run_at timestamptz NOT NULL);
        """
    )


def _files() -> None:
    sql(
        """
        CREATE TABLE file_object (
          id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
          project_id uuid,
          entity_type text NOT NULL, entity_id uuid NOT NULL,
          s3_key text UNIQUE NOT NULL,
          filename text NOT NULL, content_type text NOT NULL,
          size_bytes bigint, sha256 bytea,
          visibility text NOT NULL DEFAULT 'internal'
            CHECK (visibility IN ('internal','customer_facing')),
          status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready')),
          uploaded_by jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
        CREATE INDEX file_object_entity_idx ON file_object (entity_type, entity_id);
        -- ponytail: customer visibility on files is the `visibility` column plus the
        -- presigned-download check (technical/08 §1), not a row policy.
        """
    )
    _nullable_project_rls("file_object")


def _nullable_project_rls(table: str) -> None:
    """Staff project scoping for the two kernel tables whose project_id may be NULL.

    A NULL project_id means a portfolio- or config-level row (technical/02 §4.2), which
    every staff realm may see; anything project-scoped follows the standard rule. The
    policy is FOR ALL, so it is the WITH CHECK on writes too.
    """
    sql(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;")
    sql(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY;")
    sql(
        f"""
        CREATE POLICY staff_project ON {table}
          USING (
            current_setting('app.realm', true) = 'staff'
            AND ( project_id IS NULL
                  OR current_setting('app.all_projects', true) = 'true'
                  OR project_id = ANY (
                       string_to_array(current_setting('app.project_ids', true), ',')::uuid[]) )
          );
        """
    )


def _idempotency() -> None:
    """technical/07 §1 — a replayed POST returns the stored response for 24 h."""
    sql(
        """
        CREATE TABLE idempotency_key (
          key text NOT NULL, principal text NOT NULL,
          request_hash text NOT NULL, response_hash text NOT NULL,
          response jsonb NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          expires_at timestamptz NOT NULL,
          PRIMARY KEY (key, principal));
        CREATE INDEX idempotency_key_expiry_idx ON idempotency_key (expires_at);
        """
    )


def _late_grants() -> None:
    # Append-only by grant: the app may never rewrite the audit trail (technical/02 §1).
    sql("REVOKE UPDATE, DELETE ON event FROM homeflow_app;")
    # The few non-material tables that may be hard-deleted. `file_object` is here for the
    # `file.prune` job only: it deletes `pending` rows (an upload the browser abandoned)
    # together with their orphan object, which is not history (technical/08 §1).
    sql(
        "GRANT DELETE ON session, otp_challenge, job, idempotency_key, file_object"
        " TO homeflow_app;"
    )


def downgrade() -> None:
    sql(
        "DROP TABLE IF EXISTS idempotency_key, file_object, schedule, job, event,"
        " otp_challenge, session, permission, user_role_assignment, role CASCADE;"
    )
    sql('DROP TABLE IF EXISTS "user" CASCADE;')
    sql("DROP FUNCTION IF EXISTS _hf_customer_id();")
    sql("DROP FUNCTION IF EXISTS enforce_project_id() CASCADE;")
    sql("DROP FUNCTION IF EXISTS set_updated_at() CASCADE;")
    sql("DROP FUNCTION IF EXISTS uuid_generate_v7();")

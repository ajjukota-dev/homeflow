-- 0001_identity.sql — R0-01 identity & access (docs/specs/01-identity-access.md)
-- Self-hosted email/password auth, RBAC matrix, project-scoped team assignments.
-- PGlite has no `citext`/`pgcrypto` extensions (verified locally), so emails are
-- `text` + a case-insensitive unique index, and ids are app-generated UUIDs
-- stored as `text` — matching this repo's existing `text` PK convention.

CREATE TABLE "user" (
  id text PRIMARY KEY,
  email text NOT NULL,
  display_name text NOT NULL,
  password_hash text, -- argon2id; null while INVITED or Google-only (not built yet)
  status text NOT NULL DEFAULT 'INVITED', -- INVITED | ACTIVE | DISABLED
  kind text NOT NULL DEFAULT 'STAFF', -- STAFF | CUSTOMER
  default_project_id text REFERENCES project(id),
  google_sub text, -- reserved for later Google OIDC (rule 10); unused now
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);
CREATE UNIQUE INDEX user_email_lower_idx ON "user" ((lower(email)));

CREATE TABLE session (
  id text PRIMARY KEY, -- sha256(token) hex; the raw token is only ever in the cookie
  user_id text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL, -- 30d sliding, renewed on validated use
  last_seen_at timestamptz NOT NULL DEFAULT now(), -- drives the 12h STAFF idle timeout
  ip text,
  user_agent text,
  revoked_at timestamptz
);
CREATE INDEX session_user_idx ON session(user_id);

CREATE TABLE invite (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id),
  token_hash text NOT NULL, -- sha256(token) hex
  expires_at timestamptz NOT NULL, -- 72h
  used_at timestamptz,
  invited_by text REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE password_reset (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id),
  token_hash text NOT NULL, -- sha256(token) hex
  expires_at timestamptz NOT NULL, -- 1h
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE role (
  code text PRIMARY KEY,
  name text NOT NULL,
  description text
);

CREATE TABLE user_role (
  user_id text NOT NULL REFERENCES "user"(id),
  role_code text NOT NULL REFERENCES role(code),
  PRIMARY KEY (user_id, role_code)
);

CREATE TABLE team (
  id text PRIMARY KEY,
  name text NOT NULL,
  department text NOT NULL,
  project_id text REFERENCES project(id) -- null = central
);

CREATE TABLE project_team_assignment (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES project(id),
  team_id text REFERENCES team(id),
  user_id text NOT NULL REFERENCES "user"(id),
  department text NOT NULL,
  role_scope text NOT NULL,
  assignment_type text NOT NULL DEFAULT 'DEDICATED', -- DEDICATED | SHARED | CENTRAL
  is_primary_owner boolean NOT NULL DEFAULT false,
  is_backup_owner boolean NOT NULL DEFAULT false,
  effective_from date NOT NULL,
  effective_to date,
  capacity_pct numeric(5,2) NOT NULL DEFAULT 100,
  escalation_manager_user_id text REFERENCES "user"(id)
);
CREATE INDEX pta_user_idx ON project_team_assignment(user_id);
CREATE INDEX pta_project_idx ON project_team_assignment(project_id);

CREATE TABLE permission_matrix (
  id text PRIMARY KEY,
  role_code text NOT NULL REFERENCES role(code),
  module text NOT NULL,
  level text NOT NULL, -- NONE|READ_STATUS_ONLY|READ_LIMITED|READ|WRITE|ADMIN
  effective_from date NOT NULL,
  effective_to date,
  version int NOT NULL DEFAULT 1
);
CREATE INDEX pm_role_module_idx ON permission_matrix(role_code, module);

CREATE TABLE field_sensitivity (
  module text NOT NULL,
  field text NOT NULL,
  class text NOT NULL, -- FINANCIAL | PII
  min_level text NOT NULL,
  PRIMARY KEY (module, field)
);

CREATE TABLE customer_login (
  user_id text PRIMARY KEY REFERENCES "user"(id),
  customer_id text NOT NULL REFERENCES customer(id),
  booking_id text NOT NULL REFERENCES booking(id)
);

-- Rule 11 (auth/access audit trail). Kept as our own append-only table rather
-- than folding into the `event` table (02, merged in 0002_event.sql): auth
-- events (login/logout/invite/password-reset) aren't project/entity-scoped
-- the way `event` rows are, and `event`'s append-only trigger + Appendix B
-- typed registry aren't a fit for this table's free-form `type`. Revisit only
-- if a real cross-cutting audit view needs both in one place (R0.5, SCHEMA.md).
CREATE TABLE auth_event (
  id text PRIMARY KEY,
  type text NOT NULL,
  actor_user_id text REFERENCES "user"(id),
  target_user_id text REFERENCES "user"(id),
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_event_type_idx ON auth_event(type);

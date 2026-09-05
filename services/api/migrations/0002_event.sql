-- 0002 — append-only event log + Appendix B taxonomy (docs/specs/02-event-log.md).
-- Additive only: no existing table is altered here. Applied by db.ts today; the shared
-- migration runner (another lane) will pick this file up unchanged once it lands.

CREATE TABLE event_type (
  name text PRIMARY KEY,
  family text NOT NULL,
  customer_visible boolean NOT NULL DEFAULT false,
  -- true once at least one handler in this codebase emits it (spec 02 acceptance:
  -- "registry test fails when a name has no emitter *once its feature is built*").
  built boolean NOT NULL DEFAULT false
);

CREATE TABLE event (
  id bigserial PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  type text NOT NULL REFERENCES event_type(name),
  project_id text REFERENCES project(id),
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  booking_id text REFERENCES booking(id),
  unit_id text REFERENCES unit(id),
  customer_id text REFERENCES customer(id),
  -- nullable: the `user` table now exists (0001_identity.sql), but no domain handler's
  -- appendEvent() call populates this yet even for user-actuated mutations — every real
  -- event today defaults to actor_kind='SYSTEM'/actor_user_id=null regardless of who acted,
  -- because ctx.actor (available in every handler since R0.6) isn't threaded through. Real,
  -- verified gap — tracked as TODO R0.6c, not fixed here (R0.5 scope is schema docs, not
  -- this wiring). See SCHEMA.md drift #5.
  actor_user_id text,
  actor_kind text NOT NULL DEFAULT 'SYSTEM' CHECK (actor_kind IN ('USER', 'SYSTEM', 'CUSTOMER')),
  payload jsonb NOT NULL DEFAULT '{}',
  source_ref text,
  correlation_id text
);
CREATE INDEX event_entity_idx ON event(entity_type, entity_id);
CREATE INDEX event_project_idx ON event(project_id);
CREATE INDEX event_type_idx ON event(type);
CREATE INDEX event_occurred_idx ON event(occurred_at);

-- Append-only: reject UPDATE/DELETE even in dev (spec 02 Data: "a trigger rejects them in dev too").
CREATE OR REPLACE FUNCTION event_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'event is append-only: % not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER event_no_update BEFORE UPDATE ON event FOR EACH ROW EXECUTE FUNCTION event_append_only();
CREATE TRIGGER event_no_delete BEFORE DELETE ON event FOR EACH ROW EXECUTE FUNCTION event_append_only();

-- Subscriber delivery failures (spec 02 rule 4) — never swallowed, retried by a job.
CREATE TABLE event_delivery_failure (
  id bigserial PRIMARY KEY,
  event_id bigint NOT NULL REFERENCES event(id),
  subscriber text NOT NULL,
  error text NOT NULL,
  failed_at timestamptz NOT NULL DEFAULT now(),
  retry_count int NOT NULL DEFAULT 0,
  resolved_at timestamptz
);
CREATE INDEX event_delivery_failure_open_idx ON event_delivery_failure(resolved_at) WHERE resolved_at IS NULL;

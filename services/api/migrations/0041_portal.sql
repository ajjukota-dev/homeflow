-- 26-customer-portal.md. `customer_check_in` is a fresh table, not an ALTER of the pre-existing
-- `checkin_record` (0000_init.sql) — different shape (kind enum vs day int, no follow_up_action_id
-- link) and a different producer (this portal vs the legacy intervention flow) — same "different
-- entity, keep both" treatment as 15/22/23/16's own coexisting pairs. No other name collides.

CREATE TABLE customer_visibility_rule (
  id text PRIMARY KEY,
  entity text NOT NULL CHECK (entity IN ('STAGE', 'TASK', 'COMMITMENT', 'DOCUMENT', 'DEMAND', 'SNAG', 'CHANGE_REQUEST', 'SCORE', 'DATE')),
  field text NOT NULL,
  project_id text REFERENCES project(id), -- NULL = global default, project row overrides
  visible boolean NOT NULL DEFAULT true,
  customer_wording text
);
CREATE UNIQUE INDEX customer_visibility_rule_scope_idx ON customer_visibility_rule (entity, field, COALESCE(project_id, ''));

CREATE TABLE customer_update (
  id text PRIMARY KEY,
  booking_id text NOT NULL REFERENCES booking(id),
  kind text NOT NULL CHECK (kind IN ('MILESTONE', 'DATE_PUBLISHED', 'MESSAGE', 'DOCUMENT_READY', 'PAYMENT_CONFIRMED', 'CHECK_IN')),
  title text NOT NULL,
  body text NOT NULL,
  published_by text REFERENCES "user"(id), -- NULL until published
  published_at timestamptz,
  source_event_id text,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customer_update_booking_idx ON customer_update (booking_id, status, published_at DESC);

CREATE TABLE customer_check_in (
  id text PRIMARY KEY,
  booking_id text NOT NULL REFERENCES booking(id),
  kind text NOT NULL CHECK (kind IN ('DAY_7', 'DAY_30', 'DAY_90', 'DLP_CLOSE')),
  sent_at timestamptz,
  responded_at timestamptz,
  score int CHECK (score BETWEEN 1 AND 5),
  comment text,
  follow_up_action_id text REFERENCES action(id)
);
CREATE INDEX customer_check_in_booking_idx ON customer_check_in (booking_id, kind);

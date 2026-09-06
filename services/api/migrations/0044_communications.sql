-- 29-communications.md. No pre-existing collision (grepped `communication`/`internal_note`/
-- `frequency_guardrail` against every prior migration — clean).

CREATE TABLE communication_template (
  id text PRIMARY KEY,
  code text NOT NULL, -- family key (e.g. "PAYMENT_REMINDER_STD") — multiple version rows share it,
                       -- same versioning shape as `doc_factory_template.family_code` (22)
  channel text NOT NULL CHECK (channel IN ('CALL', 'EMAIL', 'WHATSAPP', 'SMS', 'MEETING', 'NOTICE', 'PORTAL_UPDATE')),
  purpose text NOT NULL CHECK (purpose IN ('WELCOME', 'PAYMENT_REMINDER', 'MILESTONE', 'DOCUMENT_REQUEST', 'APPOINTMENT', 'DELAY_NOTICE', 'CUSTOMISATION_QUOTE', 'HANDOVER_INVITE', 'CHECK_IN', 'GENERAL')),
  subject text,
  body text NOT NULL, -- {{merge_field_code}} placeholders, resolved via 22's merge_field_definition
  project_id text REFERENCES project(id), -- NULL = standard, every project
  version int NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'LEGAL_REVIEW', 'APPROVED', 'RETIRED')),
  approved_by text REFERENCES "user"(id),
  approved_at timestamptz,
  created_by text REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX communication_template_code_idx ON communication_template (code, project_id, version DESC);

CREATE TABLE communication (
  id text PRIMARY KEY,
  code text NOT NULL UNIQUE, -- COM-000001 via model/codes.ts::nextCode
  customer_id text NOT NULL REFERENCES customer(id),
  booking_id text REFERENCES booking(id),
  project_id text REFERENCES project(id),
  channel text NOT NULL CHECK (channel IN ('CALL', 'EMAIL', 'WHATSAPP', 'SMS', 'MEETING', 'NOTICE', 'PORTAL_UPDATE')),
  direction text NOT NULL CHECK (direction IN ('INBOUND', 'OUTBOUND')),
  visibility text NOT NULL DEFAULT 'INTERNAL' CHECK (visibility IN ('INTERNAL', 'CUSTOMER_VISIBLE')),
  subject text,
  body text NOT NULL,
  template_id text REFERENCES communication_template(id),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  logged_by text REFERENCES "user"(id), -- NULL for a system-generated OUTBOUND (e.g. auto email)
  follow_up_required boolean NOT NULL DEFAULT false,
  follow_up_due timestamptz,
  follow_up_action_id text REFERENCES action(id),
  attachments text[] NOT NULL DEFAULT '{}', -- file_ids
  linked_entity jsonb, -- {type, id} — same shape as notification.entity_ref
  sentiment text, -- 31, unused until built
  summary text, -- 31, unused until built
  published_to_portal_at timestamptz,
  customer_update_id text REFERENCES customer_update(id) -- rule 2's portal-feed mechanism (26)
);
CREATE INDEX communication_customer_idx ON communication (customer_id, occurred_at DESC);
CREATE INDEX communication_booking_idx ON communication (booking_id, occurred_at DESC);

CREATE TABLE frequency_guardrail (
  purpose text PRIMARY KEY CHECK (purpose IN ('WELCOME', 'PAYMENT_REMINDER', 'MILESTONE', 'DOCUMENT_REQUEST', 'APPOINTMENT', 'DELAY_NOTICE', 'CUSTOMISATION_QUOTE', 'HANDOVER_INVITE', 'CHECK_IN', 'GENERAL')),
  max_per_customer_per_window int NOT NULL,
  window_days int NOT NULL,
  quiet_hours_start text NOT NULL DEFAULT '21:00',
  quiet_hours_end text NOT NULL DEFAULT '08:00'
);

CREATE TABLE internal_note (
  id text PRIMARY KEY,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  body text NOT NULL,
  author_user_id text NOT NULL REFERENCES "user"(id),
  mentions text[] NOT NULL DEFAULT '{}', -- user ids
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX internal_note_entity_idx ON internal_note (entity_type, entity_id, created_at DESC);

-- Rule 6's 48h unresolved-query escalation needs a real sla_clock-backed action (see
-- escalations/core.ts's own header: `scannableActions` only picks up actions whose sla_clock's
-- policy carries an `escalation_ladder_id`, and `applies_to` didn't have a slot for this source —
-- same "extend, don't invent a new mechanism" call already made once for SNAG_SEVERITY (0032_qa.sql).
ALTER TABLE sla_policy DROP CONSTRAINT sla_policy_applies_to_check;
ALTER TABLE sla_policy ADD CONSTRAINT sla_policy_applies_to_check
  CHECK (applies_to IN ('TASK_CODE', 'ACTION_TYPE', 'STAGE_CODE', 'SNAG_SEVERITY', 'CUSTOMER_QUERY'));

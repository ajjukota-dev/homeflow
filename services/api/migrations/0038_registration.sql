-- 23-registration.md. `registration_case` already exists (0000_init.sql: id, booking_id,
-- project_id, status, sro_reference, completed_at) with real readers (legal-docs.ts's
-- completeRegistration, qa.ts, scores/booking-readiness.ts, seed-lifecycle.ts) that key on
-- status = 'completed' as the terminal fact — ALTER in place, keep that value, add the rest of
-- 23's richer lifecycle as new columns. Same "different entity, keep the reader contract" class
-- as 07/08/15's earlier ALTERs.
ALTER TABLE registration_case ADD COLUMN code text;
ALTER TABLE registration_case ADD COLUMN unit_id text REFERENCES unit(id);
ALTER TABLE registration_case ADD COLUMN forecast_date date;
ALTER TABLE registration_case ADD COLUMN forecast_confidence text CHECK (forecast_confidence IN ('LOW', 'MEDIUM', 'HIGH'));
-- readiness jsonb's 8 keys (rule 1): the spec's own Data list names 7 (documents, clearance, tds,
-- agreement_executed, customer_availability, signatories, poa_valid); `sale_deed_ready` is a real
-- addition — rule 1's prose names "22 Sale Deed APPROVED_FOR_EXECUTION" as a distinct readiness
-- input with no jsonb key of its own in the Data table, an omission fixed here rather than folded
-- silently into `documents`.
ALTER TABLE registration_case ADD COLUMN readiness jsonb NOT NULL DEFAULT '{}';
-- Rule 2's own proposed dates, needed to check "slot within 3 days of availability" at book-slot
-- time and to know when AVAILABILITY_CONFIRMED itself became true — not computed live like the
-- rest of readiness.
ALTER TABLE registration_case ADD COLUMN proposed_availability_dates jsonb;
ALTER TABLE registration_case ADD COLUMN sro_office text;
ALTER TABLE registration_case ADD COLUMN slot_datetime timestamptz;
ALTER TABLE registration_case ADD COLUMN slot_reference text;
ALTER TABLE registration_case ADD COLUMN slot_history jsonb NOT NULL DEFAULT '[]';
-- Rule 5's day-of checklist instance state (the template's own `day_of_items` names what's
-- required; this is the per-case completion map) — a real addition beyond the Data table's
-- literal column list, same class as 18's `change_request_approval`.
ALTER TABLE registration_case ADD COLUMN day_of_checklist jsonb NOT NULL DEFAULT '{}';
ALTER TABLE registration_case ADD COLUMN executed_on date;
ALTER TABLE registration_case ADD COLUMN registration_document_number text;
ALTER TABLE registration_case ADD COLUMN company_representative text;
ALTER TABLE registration_case ADD COLUMN customer_attendees jsonb;
ALTER TABLE registration_case ADD COLUMN registered_deed_file_id text REFERENCES doc_factory_document(id);
ALTER TABLE registration_case ADD COLUMN stamp_duty_inr numeric;
ALTER TABLE registration_case ADD COLUMN registration_fee_inr numeric;
ALTER TABLE registration_case ADD COLUMN outcome_notes text;
ALTER TABLE registration_case ADD COLUMN owner_user_id text REFERENCES "user"(id);
ALTER TABLE registration_case ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();

-- Backfill the 3 seed rows (reg_v110/v112/v113) so `code`/`unit_id` are never null going forward.
UPDATE registration_case rc SET unit_id = b.unit_id FROM booking b WHERE b.id = rc.booking_id AND rc.unit_id IS NULL;
WITH numbered AS (SELECT id, row_number() OVER (ORDER BY id) AS rn FROM registration_case WHERE code IS NULL)
UPDATE registration_case rc SET code = 'REG-' || lpad(numbered.rn::text, 6, '0') FROM numbered WHERE numbered.id = rc.id;
INSERT INTO code_sequence (prefix, next_value) VALUES ('REG', (SELECT count(*) FROM registration_case) + 1)
  ON CONFLICT (prefix) DO UPDATE SET next_value = GREATEST(code_sequence.next_value, EXCLUDED.next_value);

ALTER TABLE registration_case ALTER COLUMN unit_id SET NOT NULL;
ALTER TABLE registration_case ALTER COLUMN code SET NOT NULL;
ALTER TABLE registration_case ADD CONSTRAINT registration_case_code_key UNIQUE (code);

-- Policy Studio: registration_checklist_template ("Registration checklists" + "SRO offices" tabs,
-- 25's Tabs line — both already registered in studio/registry.ts as built:false placeholders).
-- One table backs both tabs, same "one table, two logical edit surfaces" shape 18 used for its
-- own cr_approval_rule/customisation_policy pair.
CREATE TABLE registration_checklist_template (
  id text PRIMARY KEY,
  project_id text REFERENCES project(id),
  jurisdiction text,
  pre_items jsonb NOT NULL DEFAULT '[]',
  day_of_items jsonb NOT NULL DEFAULT '[]',
  sro_offices jsonb NOT NULL DEFAULT '[]',
  jurisdiction_lead_days int NOT NULL DEFAULT 15,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX registration_checklist_template_scope_idx ON registration_checklist_template (project_id, jurisdiction);

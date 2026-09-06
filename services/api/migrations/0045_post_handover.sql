-- 30-post-handover.md. `warranty_case`/`home_passport_item`/`service_history`/`dlp_window`
-- (0000_init.sql) are the same entities this spec's Data table describes (`warranty_case`,
-- `passport_item`, `service_record`, DLP windows) — ALTERed in place, not parallel-created, same
-- discipline as 07/08/15/16/23's own collisions. `checkin_record` (0000_init.sql) is NOT reused
-- here: 26 already built a fresher, richer `customer_check_in` (portal-facing, follow_up_action_id
-- wiring, low-score CRM action already wired) that this spec's own Data table cites directly
-- ("check-ins: customer_check_in (26)") — `checkin_record` stays the pre-26 legacy mechanism,
-- untouched, same "different entity/producer, keep both" precedent 0041_portal.sql's own header
-- already established for these same two tables.

ALTER TABLE sla_policy DROP CONSTRAINT IF EXISTS sla_policy_applies_to_check;
ALTER TABLE sla_policy ADD CONSTRAINT sla_policy_applies_to_check
  CHECK (applies_to IN ('TASK_CODE', 'ACTION_TYPE', 'STAGE_CODE', 'SNAG_SEVERITY', 'CUSTOMER_QUERY', 'WARRANTY_SEVERITY'));

CREATE TABLE post_handover_case (
  id text PRIMARY KEY,
  booking_id text NOT NULL UNIQUE REFERENCES booking(id),
  unit_id text NOT NULL REFERENCES unit(id),
  project_id text NOT NULL REFERENCES project(id),
  handover_completed_at timestamptz NOT NULL,
  move_in_tasks jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'ONBOARDING' CHECK (status IN ('ONBOARDING', 'IN_DLP', 'DLP_CLOSED', 'CLOSED')),
  fm_owner_user_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Config (Policy Studio, generic envelope — no versioning of its own). `windows`: [{category,
-- months}]. `response_sla_by_severity` is informational/UI-facing only — the real per-case
-- response clock is seeded as 3 dedicated `sla_policy` rows (see seed/post-handover.ts) so it
-- actually starts a real `sla_clock` via 06's own mechanism, not a second parallel timer.
CREATE TABLE dlp_policy (
  id text PRIMARY KEY,
  project_id text REFERENCES project(id), -- NULL = global default for the product_type
  product_type text NOT NULL,
  windows jsonb NOT NULL,
  response_sla_by_severity jsonb,
  unconfirmed boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX dlp_policy_scope_idx ON dlp_policy (COALESCE(project_id, ''), product_type);

CREATE TABLE advocacy (
  id text PRIMARY KEY,
  booking_id text NOT NULL REFERENCES booking(id),
  kind text NOT NULL CHECK (kind IN ('REFERRAL', 'TESTIMONIAL', 'REVIEW')),
  status text NOT NULL DEFAULT 'INVITED' CHECK (status IN ('INVITED', 'RECEIVED', 'PUBLISHED', 'DECLINED')),
  content text,
  referred_prospect_id text REFERENCES prospect(id),
  invited_by text,
  at timestamptz NOT NULL DEFAULT now()
);

-- warranty_case (0000_init.sql) already carries id/unit_id/booking_id/project_id/
-- passport_item_id/category/trade/severity/description/coverage/status/chargeable_amount/
-- root_cause_code — the pre-15-session `warranty.ts` module's own simple open/closed lifecycle
-- keeps working on those columns unchanged. This spec's own richer lifecycle (triage/assign/
-- quote/accept-quote/start/resolve/verify/close/reject) is additive on top, in new
-- `post-handover/core.ts`, on the same table.
ALTER TABLE warranty_case
  ADD COLUMN raised_by_kind text CHECK (raised_by_kind IN ('CUSTOMER_PORTAL', 'FM', 'CRM')),
  ADD COLUMN in_coverage boolean,
  ADD COLUMN coverage_basis text,
  ADD COLUMN contractor_id text REFERENCES contractor(id),
  ADD COLUMN quote_inr numeric,
  ADD COLUMN quote_accepted_at timestamptz,
  ADD COLUMN waived_reason text,
  ADD COLUMN cost_inr numeric,
  ADD COLUMN sla_clock_id text REFERENCES sla_clock(id),
  ADD COLUMN customer_verified_at timestamptz,
  ADD COLUMN before_file_keys text[] NOT NULL DEFAULT '{}',
  ADD COLUMN after_file_keys text[] NOT NULL DEFAULT '{}',
  ADD COLUMN rejected_reason text,
  ADD COLUMN snag_id text; -- flagged unused, see post-handover/core.ts header comment

-- passport_item (spec's name) is the same entity as home_passport_item — widened, not renamed
-- (existing readers: transparency.ts::t4Passport, seed-lifecycle.ts, warranty_case.passport_item_id).
ALTER TABLE home_passport_item
  ADD COLUMN kind text CHECK (kind IN ('EQUIPMENT', 'FINISH', 'DOCUMENT', 'WARRANTY', 'CONTACT')),
  ADD COLUMN serial text,
  ADD COLUMN installed_on date,
  ADD COLUMN warranty_until date,
  ADD COLUMN vendor_contact text,
  ADD COLUMN manual_file_id text,
  ADD COLUMN spec_revision_id text REFERENCES spec_revision(id);

-- service_record (spec's name) is the same entity as service_history — widened, not renamed
-- (existing readers: warranty.ts::serviceHistory/closeWarranty, seed-lifecycle.ts).
ALTER TABLE service_history
  ADD COLUMN kind text CHECK (kind IN ('WARRANTY_FIX', 'MAINTENANCE', 'INSPECTION', 'UPGRADE')),
  ADD COLUMN cost_inr numeric;

-- 17-sales-crm-handover.md. Additive alongside the existing accept/return flow in
-- bookings.ts/bookings-crm.ts — see those files' header notes and docs/specs/17's Build note
-- for why booking.status keeps its existing lowercase values ('active' on accept) instead of the
-- spec's literal `booking.status = CRM_ACCEPTED`: five non-test call sites (qa.ts, tower-view.ts,
-- legal-docs.ts, demands-schedule.ts, customer.ts) filter `WHERE status = 'active'` — routing
-- accept through the unused 'crm_accepted' DB value (already legal per 0003's CHECK constraint)
-- would silently zero those out, exactly the failure model/status.ts's own header warned about.
-- sales_handover.status is the real ACCEPTED/RETURNED signal for this feature; booking.status is
-- unchanged. Deliberately NO RLS policy here yet — same flagged gap as loan_case/escalation/
-- commitment (12/13/21), batched for P1b.

CREATE TABLE sales_handover (
  id text PRIMARY KEY,
  booking_id text NOT NULL REFERENCES booking(id),
  project_id text NOT NULL REFERENCES project(id),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'ACCEPTED')),
  version int NOT NULL DEFAULT 0,
  packet jsonb NOT NULL DEFAULT '{}'::jsonb,
  completeness_score int,
  completeness_detail jsonb,
  submitted_by text REFERENCES "user"(id),
  submitted_at timestamptz,
  accepted_by text REFERENCES "user"(id),
  accepted_at timestamptz,
  returned_by text REFERENCES "user"(id),
  returned_at timestamptz,
  return_reason_code text,
  return_note text,
  first_time_right boolean,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- One packet per booking (rule 4: submit/return/resubmit all version the same row).
CREATE UNIQUE INDEX sales_handover_booking_idx ON sales_handover(booking_id);

-- Rule 2: resolved by (project -> standard) x product_type x residency. project_id NULL =
-- standard/global row, product_type NULL = applies to every product type.
CREATE TABLE handover_checklist_rule (
  id text PRIMARY KEY,
  project_id text REFERENCES project(id),
  product_type text CHECK (product_type IS NULL OR product_type IN ('APARTMENT', 'VILLA', 'PLOT', 'MIXED')),
  residency text NOT NULL DEFAULT 'ANY' CHECK (residency IN ('RESIDENT', 'NRI', 'OCI', 'ANY')),
  item_code text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('FIELD', 'DOCUMENT', 'CONFIRMATION', 'APPROVAL')),
  required boolean NOT NULL DEFAULT true,
  weight int NOT NULL DEFAULT 1,
  effective_from date NOT NULL DEFAULT '2020-01-01',
  effective_to date
);

CREATE TABLE return_reason (
  code text PRIMARY KEY,
  label text NOT NULL,
  category text NOT NULL CHECK (category IN ('DOCUMENTS', 'COMMERCIAL', 'CUSTOMER_DATA', 'UNIT_DATA', 'COMMITMENTS', 'OTHER'))
);

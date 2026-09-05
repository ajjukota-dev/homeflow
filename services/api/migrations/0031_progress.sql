-- 07-unit-progress-control.md. Both of this spec's core tables already exist from
-- 0000_init.sql (SCHEMA.md "name collisions" table), so this migration ALTERs them in place —
-- it never creates a parallel `unit_progress_state`: the spec's own Data row names ALTER as the
-- preferred resolution, and nine non-test modules read/write `unit_progress` on its current
-- columns (handlers, qa, qa-evidence, customer, demands-schedule, model/units, seed,
-- seed-lifecycle, db/index), so added-with-defaults columns break none of them.
--
-- state_code keeps its real lowercase vocabulary (`gates.ts::ProgressState`, ~8 readers) plus
-- the new `rework`; the spec's UPPERCASE names translate at the API boundary (progress/core.ts),
-- same DB-keeps-lowercase decision as booking.status / unit.sale_status (model/status.ts).
-- Component codes stay the four real seeded ones (`change_gate_rule` FKs onto them) — the
-- spec's longer uppercase component list is a re-seed proposal for Policy Studio, not applied.
-- Deliberately NO RLS policy — same flagged batch as loan_case/escalation/commitment/sales_handover.

ALTER TABLE component_definition ADD COLUMN parent_code text REFERENCES component_definition(code);
ALTER TABLE component_definition ADD COLUMN product_types text[]; -- null = every product type
ALTER TABLE component_definition ADD COLUMN readiness_weight int NOT NULL DEFAULT 1;
ALTER TABLE component_definition ADD COLUMN evidence_required boolean NOT NULL DEFAULT false;
-- UNCONFIRMED default (rule 6 "stale_after_days from config"; spec gives no number) — Studio-editable.
ALTER TABLE component_definition ADD COLUMN stale_after_days int NOT NULL DEFAULT 14;
ALTER TABLE component_definition ADD COLUMN effective_from date NOT NULL DEFAULT '2020-01-01';
ALTER TABLE component_definition ADD COLUMN effective_to date;

ALTER TABLE unit_progress ADD COLUMN pct int CHECK (pct IS NULL OR (pct >= 0 AND pct <= 100));
ALTER TABLE unit_progress ADD COLUMN actual_date date;
ALTER TABLE unit_progress ADD COLUMN planned_next_event text;
ALTER TABLE unit_progress ADD COLUMN planned_next_event_date date;
ALTER TABLE unit_progress ADD COLUMN source text NOT NULL DEFAULT 'SITE_ENTRY'
  CHECK (source IN ('SITE_ENTRY', 'QA_VERIFICATION', 'BULK_UPDATE', 'IMPORT', 'SYSTEM'));
-- Audit stamp, not a relation — no FK, same as event.actor_user_id (a stamp must survive user
-- deactivation, and existing tests write progress with synthetic actor ids).
ALTER TABLE unit_progress ADD COLUMN updated_by text;
-- Was free text; every existing row is one of the first four values (seed.ts / setState).
ALTER TABLE unit_progress ADD CONSTRAINT unit_progress_state_check
  CHECK (state_code IN ('not_started', 'in_progress', 'complete', 'verified', 'rework'));

CREATE TABLE progress_bulk_update (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES project(id),
  scope jsonb NOT NULL,
  component_code text NOT NULL REFERENCES component_definition(code),
  new_state text NOT NULL,
  reason text,
  preview jsonb NOT NULL,
  exceptions jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'PREVIEWED' CHECK (status IN ('PREVIEWED', 'APPLIED', 'CANCELLED')),
  previewed_by text,
  previewed_at timestamptz NOT NULL DEFAULT now(),
  applied_by text,
  applied_at timestamptz
);

CREATE TABLE progress_reopen (
  id text PRIMARY KEY,
  unit_id text NOT NULL REFERENCES unit(id),
  component_code text NOT NULL REFERENCES component_definition(code),
  from_state text NOT NULL,
  to_state text NOT NULL,
  reason text NOT NULL,
  actor_user_id text,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX progress_reopen_unit_idx ON progress_reopen(unit_id, component_code);

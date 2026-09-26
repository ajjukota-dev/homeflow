-- Bug 11. 0045_post_handover.sql was edited in place to add warranty_case.created_at.
-- schema_migration records the filename only, so a database that already applied the
-- old 0045 never re-reads that file. This later migration adds the column for those
-- databases. IF NOT EXISTS keeps a fresh database (current 0045 already added it) on
-- the same schema. Do not edit 0045 again.

ALTER TABLE warranty_case
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

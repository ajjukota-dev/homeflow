-- 28-360-views.md's Data section names this as the one genuine new table this spec needs
-- ("No new tables; ... `recent_context` per user ... in `user_preference` for context retention").
-- One row per user — project switcher + last-viewed entity, restored across navigation/sessions.
CREATE TABLE user_preference (
  user_id text PRIMARY KEY REFERENCES "user"(id),
  last_project_id text REFERENCES project(id),
  last_entity_type text CHECK (last_entity_type IN ('unit', 'customer', 'booking')),
  last_entity_id text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE groups ADD COLUMN cleanup_marked_at TEXT;

ALTER TABLE groups ADD COLUMN cleanup_scheduled_delete_at TEXT;

CREATE INDEX IF NOT EXISTS idx_groups_cleanup_scheduled
  ON groups(cleanup_scheduled_delete_at);

CREATE INDEX IF NOT EXISTS idx_groups_created_at
  ON groups(created_at);

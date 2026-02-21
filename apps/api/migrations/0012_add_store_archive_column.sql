ALTER TABLE stores ADD COLUMN archived_at TEXT;

CREATE INDEX IF NOT EXISTS idx_stores_group_archived_at
  ON stores(group_id, archived_at, sort_order);

CREATE INDEX IF NOT EXISTS idx_stores_system_archived_at
  ON stores(is_system, archived_at);

ALTER TABLE tabs ADD COLUMN archived_at TEXT;

ALTER TABLE items ADD COLUMN archived_at TEXT;

CREATE INDEX IF NOT EXISTS idx_tabs_group_active
  ON tabs (group_id, sort_order)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_items_tab_active
  ON items (tab_id, sort_order)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_items_group_active
  ON items (group_id, tab_id, sort_order)
  WHERE archived_at IS NULL;

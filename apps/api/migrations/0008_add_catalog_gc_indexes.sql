CREATE INDEX IF NOT EXISTS idx_request_items_item_id
  ON request_items(item_id);

CREATE INDEX IF NOT EXISTS idx_items_system_archived_at
  ON items(is_system, archived_at);

CREATE INDEX IF NOT EXISTS idx_tabs_system_archived_at
  ON tabs(is_system, archived_at);

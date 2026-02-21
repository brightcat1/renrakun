CREATE TABLE IF NOT EXISTS push_notifications (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  recipient_member_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('requested', 'acknowledged', 'completed')),
  sender_member_id TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  store_name TEXT,
  items_summary TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  delivered_at TEXT,
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
  FOREIGN KEY (recipient_member_id) REFERENCES members(id) ON DELETE CASCADE,
  FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE,
  FOREIGN KEY (sender_member_id) REFERENCES members(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_push_notifications_recipient_delivered_created
  ON push_notifications(recipient_member_id, delivered_at, created_at);
CREATE INDEX IF NOT EXISTS idx_push_notifications_created
  ON push_notifications(created_at);

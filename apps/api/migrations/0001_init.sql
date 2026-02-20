PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  invite_token_hash TEXT NOT NULL UNIQUE,
  passphrase_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
  UNIQUE (group_id, device_id)
);

CREATE TABLE IF NOT EXISTS tabs (
  id TEXT PRIMARY KEY,
  group_id TEXT,
  name TEXT NOT NULL,
  is_system INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  tab_id TEXT NOT NULL,
  name TEXT NOT NULL,
  is_system INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (tab_id) REFERENCES tabs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS stores (
  id TEXT PRIMARY KEY,
  group_id TEXT,
  name TEXT NOT NULL,
  is_system INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  sender_member_id TEXT NOT NULL,
  store_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('requested', 'acknowledged', 'completed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
  FOREIGN KEY (sender_member_id) REFERENCES members(id) ON DELETE CASCADE,
  FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS request_items (
  request_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  PRIMARY KEY (request_id, item_id),
  FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS inbox_events (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  recipient_member_id TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE,
  FOREIGN KEY (recipient_member_id) REFERENCES members(id) ON DELETE CASCADE,
  UNIQUE (request_id, recipient_member_id)
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_members_group ON members (group_id);
CREATE INDEX IF NOT EXISTS idx_tabs_group ON tabs (group_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_items_tab ON items (tab_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_stores_group ON stores (group_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_requests_group_created ON requests (group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inbox_recipient_created ON inbox_events (recipient_member_id, created_at DESC);

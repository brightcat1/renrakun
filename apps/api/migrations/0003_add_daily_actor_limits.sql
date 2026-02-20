CREATE TABLE IF NOT EXISTS daily_actor_limits (
  actor_key TEXT PRIMARY KEY,
  day_key TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_daily_actor_limits_day ON daily_actor_limits (day_key);

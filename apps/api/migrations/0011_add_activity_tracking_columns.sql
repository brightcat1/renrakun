ALTER TABLE groups ADD COLUMN last_activity_at TEXT;

ALTER TABLE members ADD COLUMN last_activity_at TEXT;

UPDATE groups
SET last_activity_at = created_at
WHERE last_activity_at IS NULL;

UPDATE members
SET last_activity_at = created_at
WHERE last_activity_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_groups_last_activity_at
  ON groups(last_activity_at);

CREATE INDEX IF NOT EXISTS idx_members_group_last_activity_at
  ON members(group_id, last_activity_at);

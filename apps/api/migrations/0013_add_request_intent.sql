ALTER TABLE requests ADD COLUMN intent TEXT NOT NULL DEFAULT 'buy';

CREATE INDEX IF NOT EXISTS idx_requests_group_intent_created
  ON requests(group_id, intent, created_at DESC);

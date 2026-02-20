CREATE INDEX IF NOT EXISTS idx_requests_status_created
  ON requests (status, created_at);

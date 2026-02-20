INSERT INTO inbox_events (id, request_id, recipient_member_id, read_at, created_at)
SELECT
  lower(hex(randomblob(16))) AS id,
  r.id AS request_id,
  r.sender_member_id AS recipient_member_id,
  NULL AS read_at,
  r.created_at AS created_at
FROM requests r
LEFT JOIN inbox_events ie
  ON ie.request_id = r.id
 AND ie.recipient_member_id = r.sender_member_id
WHERE ie.id IS NULL;

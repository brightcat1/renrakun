ALTER TABLE items ADD COLUMN group_id TEXT;

CREATE INDEX IF NOT EXISTS idx_items_group ON items (group_id, tab_id, sort_order);

-- Backfill legacy custom tabs when there is exactly one group in the database.
UPDATE tabs
SET group_id = (SELECT id FROM groups LIMIT 1)
WHERE is_system = 0
  AND group_id IS NULL
  AND (SELECT COUNT(*) FROM groups) = 1;

-- Backfill custom items created under custom tabs.
UPDATE items
SET group_id = (
  SELECT t.group_id
  FROM tabs t
  WHERE t.id = items.tab_id
)
WHERE is_system = 0
  AND group_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM tabs t2
    WHERE t2.id = items.tab_id
      AND t2.group_id IS NOT NULL
  );

-- Backfill legacy custom items created under system tabs in single-group local setups.
UPDATE items
SET group_id = (SELECT id FROM groups LIMIT 1)
WHERE is_system = 0
  AND group_id IS NULL
  AND tab_id IN (SELECT id FROM tabs WHERE group_id IS NULL)
  AND (SELECT COUNT(*) FROM groups) = 1;

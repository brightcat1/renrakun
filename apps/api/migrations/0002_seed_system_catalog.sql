INSERT OR IGNORE INTO tabs (id, group_id, name, is_system, sort_order)
VALUES
  ('sys-tab-detergent', NULL, '洗剤', 1, 10),
  ('sys-tab-washroom', NULL, '洗面', 1, 20),
  ('sys-tab-beauty', NULL, '美容', 1, 30),
  ('sys-tab-kitchen', NULL, 'キッチン', 1, 40),
  ('sys-tab-store', NULL, '買い物メモ', 1, 50);

INSERT OR IGNORE INTO items (id, tab_id, name, is_system, sort_order)
VALUES
  ('sys-item-detergent', 'sys-tab-detergent', '洗剤', 1, 10),
  ('sys-item-refill', 'sys-tab-detergent', '詰替え', 1, 20),
  ('sys-item-tissue', 'sys-tab-washroom', 'ティッシュ', 1, 10),
  ('sys-item-toilet-paper', 'sys-tab-washroom', 'トイレットペーパー', 1, 20),
  ('sys-item-hand-paper', 'sys-tab-washroom', 'ハンドペーパー', 1, 30),
  ('sys-item-cotton', 'sys-tab-beauty', 'コットン', 1, 10),
  ('sys-item-shampoo', 'sys-tab-beauty', 'シャンプー', 1, 20),
  ('sys-item-conditioner', 'sys-tab-beauty', 'リンス', 1, 30),
  ('sys-item-kitchen-paper', 'sys-tab-kitchen', 'キッチンペーパー', 1, 10),
  ('sys-item-carrot', 'sys-tab-store', 'にんじん', 1, 10);

INSERT OR IGNORE INTO stores (id, group_id, name, is_system, sort_order)
VALUES
  ('sys-store-summit', NULL, 'サミット', 1, 10),
  ('sys-store-nitori', NULL, 'ニトリ', 1, 20),
  ('sys-store-ikea', NULL, 'IKEA', 1, 30),
  ('sys-store-aeon', NULL, 'イオン', 1, 40),
  ('sys-store-gyomu', NULL, '業務スーパー', 1, 50);

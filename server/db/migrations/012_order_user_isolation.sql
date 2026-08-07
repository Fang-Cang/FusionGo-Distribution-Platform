PRAGMA foreign_keys = ON;

ALTER TABLE orders ADD COLUMN user_id TEXT REFERENCES user_profiles(id);

CREATE INDEX IF NOT EXISTS orders_user_created_idx
  ON orders (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS account_hotel_favorites (
  user_id TEXT NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  hotel_id TEXT NOT NULL,
  hotel_snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, hotel_id)
);

CREATE INDEX IF NOT EXISTS account_hotel_favorites_user_created_idx
  ON account_hotel_favorites (user_id, created_at DESC);

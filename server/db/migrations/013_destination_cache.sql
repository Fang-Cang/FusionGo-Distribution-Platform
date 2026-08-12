CREATE TABLE IF NOT EXISTS destination_cache (
  cache_key TEXT PRIMARY KEY,
  supplier TEXT NOT NULL,
  query_keyword TEXT NOT NULL,
  name TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  city_code TEXT NOT NULL DEFAULT '',
  destination_type INTEGER NOT NULL,
  hotel_id INTEGER,
  lat_google REAL NOT NULL,
  lng_google REAL NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_destination_cache_keyword
  ON destination_cache(query_keyword, updated_at DESC);

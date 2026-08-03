CREATE TABLE IF NOT EXISTS account_travelers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  traveler_type TEXT NOT NULL CHECK (traveler_type IN ('adult', 'child', 'infant')),
  surname TEXT NOT NULL,
  given_name TEXT NOT NULL,
  gender TEXT NOT NULL CHECK (gender IN ('1', '2')),
  birthday TEXT NOT NULL,
  nationality TEXT NOT NULL,
  document_type TEXT NOT NULL DEFAULT 'passport',
  document_encrypted TEXT NOT NULL,
  document_masked TEXT NOT NULL,
  issuing_country TEXT NOT NULL,
  expiration TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS account_travelers_user_idx
  ON account_travelers (user_id, created_at);

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id TEXT PRIMARY KEY REFERENCES user_profiles(id) ON DELETE CASCADE,
  order_enabled INTEGER NOT NULL DEFAULT 1,
  flight_enabled INTEGER NOT NULL DEFAULT 1,
  marketing_enabled INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

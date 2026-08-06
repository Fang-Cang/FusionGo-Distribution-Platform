CREATE TABLE IF NOT EXISTS user_profiles (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  avatar_blob BLOB,
  avatar_mime TEXT,
  avatar_updated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS user_profiles_tenant_idx
  ON user_profiles (tenant_id);

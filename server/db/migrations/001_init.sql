PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  default_currency TEXT NOT NULL DEFAULT 'CNY',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hotel_offers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  district TEXT NOT NULL,
  rating REAL NOT NULL,
  stars INTEGER NOT NULL,
  image TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  room_name TEXT NOT NULL,
  breakfast TEXT NOT NULL,
  cancel_policy TEXT NOT NULL,
  nightly_price REAL NOT NULL,
  currency TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS flight_offers (
  id TEXT PRIMARY KEY,
  airline TEXT NOT NULL,
  airline_code TEXT NOT NULL,
  flight_no TEXT NOT NULL,
  departure_airport TEXT NOT NULL,
  arrival_airport TEXT NOT NULL,
  departure_time TEXT NOT NULL,
  arrival_time TEXT NOT NULL,
  duration TEXT NOT NULL,
  stops INTEGER NOT NULL,
  cabin TEXT NOT NULL,
  baggage TEXT NOT NULL,
  price REAL NOT NULL,
  currency TEXT NOT NULL,
  price_key TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS booking_sessions (
  session_key TEXT PRIMARY KEY,
  product_type TEXT NOT NULL CHECK (product_type IN ('hotel', 'flight')),
  offer_id TEXT NOT NULL,
  bridge_key TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS booking_sessions_offer_idx
  ON booking_sessions (product_type, offer_id, expires_at);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  product_type TEXT NOT NULL CHECK (product_type IN ('hotel', 'flight')),
  supplier TEXT NOT NULL,
  supplier_order_no TEXT,
  bridge_key TEXT,
  customer TEXT NOT NULL,
  title TEXT NOT NULL,
  subtitle TEXT NOT NULL,
  status TEXT NOT NULL,
  currency TEXT NOT NULL,
  amount REAL NOT NULL,
  product_snapshot_json TEXT NOT NULL,
  contact_snapshot_json TEXT NOT NULL,
  upstream_context_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS orders_created_idx ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS orders_supplier_idx ON orders (supplier, supplier_order_no);
CREATE INDEX IF NOT EXISTS orders_bridge_idx ON orders (bridge_key);

CREATE TABLE IF NOT EXISTS order_events (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_key TEXT NOT NULL UNIQUE,
  from_status TEXT,
  to_status TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS order_events_order_idx
  ON order_events (order_id, created_at);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  payment_no TEXT NOT NULL UNIQUE,
  channel TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  provider_transaction_no TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS payments_order_idx ON payments (order_id);

CREATE TABLE IF NOT EXISTS webhook_inbox (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  event_key TEXT NOT NULL UNIQUE,
  signature_valid INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  processed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_nonces (
  provider TEXT NOT NULL,
  nonce TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (provider, nonce)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  detail_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS counters (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

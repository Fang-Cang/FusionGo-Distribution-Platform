-- PostgreSQL baseline schema. Sensitive fields must be encrypted by the application/KMS.
create table tenants (
  id uuid primary key,
  name varchar(160) not null,
  status varchar(32) not null default 'ACTIVE',
  default_currency char(3) not null default 'CNY',
  created_at timestamptz not null default now()
);

create table users (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  email varchar(255) not null,
  display_name varchar(100) not null,
  role varchar(40) not null,
  status varchar(32) not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  unique (tenant_id, email)
);

create table user_profiles (
  user_id uuid primary key references users(id) on delete cascade,
  language varchar(10) not null default 'zh-CN',
  phone varchar(32) not null,
  avatar_object_key varchar(512),
  avatar_mime varchar(64),
  avatar_updated_at timestamptz,
  updated_at timestamptz not null default now()
);

create table account_travelers (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  traveler_type varchar(16) not null check (traveler_type in ('adult', 'child', 'infant')),
  surname varchar(60) not null,
  given_name varchar(80) not null,
  gender char(1) not null check (gender in ('1', '2')),
  birthday date not null,
  nationality varchar(3) not null,
  document_type varchar(20) not null default 'passport',
  document_ciphertext text not null,
  document_masked varchar(32) not null,
  encryption_key_version varchar(64) not null,
  issuing_country varchar(3) not null,
  expiration date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index account_travelers_user_idx on account_travelers (user_id, created_at);

create table notification_preferences (
  user_id uuid primary key references users(id) on delete cascade,
  order_enabled boolean not null default true,
  flight_enabled boolean not null default true,
  marketing_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

create table supplier_credentials (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  provider varchar(32) not null,
  environment varchar(16) not null,
  app_key varchar(160) not null,
  secret_reference varchar(255) not null,
  secret_version varchar(40),
  status varchar(32) not null,
  unique (tenant_id, provider, environment)
);

create table orders (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  order_no varchar(40) not null unique,
  product_type varchar(16) not null,
  supplier varchar(32) not null,
  supplier_order_no varchar(100),
  bridge_key varchar(255),
  customer_id uuid,
  status varchar(40) not null,
  currency char(3) not null,
  original_amount numeric(18,2) not null,
  sale_amount numeric(18,2) not null,
  version integer not null default 0,
  product_snapshot jsonb not null,
  contact_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index orders_tenant_created_idx on orders (tenant_id, created_at desc);
create index orders_supplier_no_idx on orders (supplier, supplier_order_no);

create table order_events (
  id uuid primary key,
  order_id uuid not null references orders(id),
  event_type varchar(60) not null,
  event_key varchar(160) not null unique,
  from_status varchar(40),
  to_status varchar(40),
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table payments (
  id uuid primary key,
  order_id uuid not null references orders(id),
  payment_no varchar(64) not null unique,
  channel varchar(40) not null,
  amount numeric(18,2) not null,
  currency char(3) not null,
  status varchar(32) not null,
  provider_transaction_no varchar(128),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table pricing_rules (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  customer_id uuid,
  product_type varchar(16) not null,
  rule_type varchar(24) not null,
  rule_value numeric(18,4) not null,
  priority integer not null default 100,
  enabled boolean not null default true,
  effective_from timestamptz,
  effective_to timestamptz
);

create table webhook_inbox (
  id uuid primary key,
  provider varchar(32) not null,
  event_key varchar(160) not null unique,
  signature_valid boolean not null,
  payload jsonb not null,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create table audit_logs (
  id uuid primary key,
  tenant_id uuid,
  actor_id uuid,
  action varchar(100) not null,
  resource_type varchar(80) not null,
  resource_id varchar(160),
  trace_id varchar(100),
  detail jsonb not null,
  created_at timestamptz not null default now()
);

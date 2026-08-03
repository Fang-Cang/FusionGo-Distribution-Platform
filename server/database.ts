import { createCipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type {
  DistributionOrder,
  FlightOffer,
  HotelOffer,
  OrderStatus,
  ProductType,
} from "../src/types.js";
import {
  flights as seedFlights,
  hotels as seedHotels,
  orders as seedOrders,
} from "./mock-data.js";

const DEFAULT_TENANT_ID = "tenant-demo";
const migrationUrl = (name: string) => {
  const bundled = new URL(`./db/migrations/${name}`, import.meta.url);
  return existsSync(bundled)
    ? bundled
    : new URL(`../../server/db/migrations/${name}`, import.meta.url);
};
const migration001 = readFileSync(migrationUrl("001_init.sql"), "utf8");
const migration002 = readFileSync(migrationUrl("002_idempotency.sql"), "utf8");
const migration003 = readFileSync(migrationUrl("003_business_operations.sql"), "utf8");
const migration004 = readFileSync(migrationUrl("004_ledger_backfill.sql"), "utf8");
const migration005 = readFileSync(migrationUrl("005_account_profile.sql"), "utf8");
const migration006 = readFileSync(migrationUrl("006_account_preferences.sql"), "utf8");

type SqlValue = string | number | bigint | null | Uint8Array;
type SqlParams = SqlValue[];

type OrderRow = {
  id: string;
  product_type: ProductType;
  supplier_order_no: string | null;
  title: string;
  subtitle: string;
  customer: string;
  amount: number;
  currency: string;
  status: OrderStatus;
  created_at: string;
};

type HotelRow = {
  id: string;
  name: string;
  city: string;
  district: string;
  rating: number;
  stars: number;
  image: string;
  tags_json: string;
  room_name: string;
  breakfast: string;
  cancel_policy: string;
  nightly_price: number;
  currency: string;
};

type FlightRow = {
  id: string;
  airline: string;
  airline_code: string;
  flight_no: string;
  departure_airport: string;
  arrival_airport: string;
  departure_time: string;
  arrival_time: string;
  duration: string;
  stops: number;
  cabin: string;
  baggage: string;
  price: number;
  currency: string;
  price_key: string;
};

type SessionRow = {
  offer_id: string;
  bridge_key: string | null;
  quantity: number;
  amount: number;
  currency: string;
  payload_json: string;
  verified_at: string;
  expires_at: string;
};

export interface UpstreamOrderContext {
  productType: ProductType;
  simulated?: boolean;
  coOrderCode?: string;
  fcOrderCode?: string;
  orderNo?: string;
  supplierAmount?: number;
  addOnAmount?: number;
  rawStatus?: number;
  amount: number;
  currency: string;
  afterSales?: {
    change?: {
      changeOrderNo: string;
      status: number;
      amount?: number;
      currency?: string;
      targetDate?: string;
      priceKey?: string;
      rejectReason?: string;
      updatedAt: string;
    };
    refund?: {
      refundOrderNo: string;
      status: number;
      refundMoney?: number;
      refundFee?: number;
      currency?: string;
      rejectReason?: string;
      updatedAt: string;
    };
  };
}

export interface PersistOrderInput {
  order: DistributionOrder;
  supplier: "GLINK" | "FLINK";
  bridgeKey?: string;
  upstream?: UpstreamOrderContext;
  productSnapshot?: unknown;
  contactSnapshot?: unknown;
}

export interface OrderEvent {
  id: string;
  orderId: string;
  eventType: string;
  fromStatus?: string;
  toStatus?: string;
  payload: unknown;
  createdAt: string;
}

export interface Customer {
  id: string;
  name: string;
  contactName: string;
  phone: string;
  email: string;
  status: "ACTIVE" | "SUSPENDED";
  creditLimit: number;
  creditUsed: number;
  createdAt: string;
}

export interface PricingRule {
  id: string;
  name: string;
  productType: ProductType | "all";
  calculationType: "percentage" | "fixed";
  value: number;
  priority: number;
  status: "ACTIVE" | "INACTIVE";
  createdAt: string;
}

export interface LedgerEntry {
  id: string;
  orderId?: string;
  entryType: "PAYMENT" | "REFUND_PENDING" | "REFUND" | "ADJUSTMENT";
  amount: number;
  currency: string;
  status: string;
  reference: string;
  createdAt: string;
}

export interface AccountProfile {
  id: string;
  name: string;
  language: "zh-CN" | "zh-TW" | "en";
  phone: string;
  email: string;
  avatarMime?: "image/png" | "image/jpeg";
  avatarUpdatedAt?: string;
  updatedAt: string;
}

export interface AccountTraveler {
  id: string;
  type: "adult" | "child" | "infant";
  surname: string;
  givenName: string;
  gender: "1" | "2";
  birthday: string;
  nationality: string;
  documentNo: string;
  issuingCountry: string;
  expiration: string;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationPreferences {
  order: boolean;
  flight: boolean;
  marketing: boolean;
  updatedAt: string;
}

const nowIso = () => new Date().toISOString();
const localPiiSecret = process.env.PII_ENCRYPTION_KEY
  || "fusiongo-local-development-only-not-for-production";
const localPiiKey = createHash("sha256").update(localPiiSecret).digest();
const encryptPii = (value: string) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", localPiiKey, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString("base64")).join(".");
};
const maskDocument = (value: string) => value.length <= 4
  ? "••••"
  : `${value.slice(0, 2)}${"•".repeat(Math.min(6, value.length - 4))}${value.slice(-2)}`;
const json = (value: unknown) => JSON.stringify(value ?? {});
const parseJson = <T>(value: string, fallback: T): T => {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const displayTime = (iso: string) => {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  if (Date.now() - date.getTime() < 60_000) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
};

const mapOrder = (row: OrderRow): DistributionOrder => ({
  id: row.id,
  productType: row.product_type,
  supplierOrderNo: row.supplier_order_no || undefined,
  title: row.title,
  subtitle: row.subtitle,
  customer: row.customer,
  amount: Number(row.amount),
  currency: row.currency,
  status: row.status,
  createdAt: displayTime(row.created_at),
});

const mapHotel = (row: HotelRow): HotelOffer => ({
  id: row.id,
  name: row.name,
  city: row.city,
  district: row.district,
  rating: Number(row.rating),
  stars: Number(row.stars),
  image: row.image,
  tags: parseJson<string[]>(row.tags_json, []),
  roomName: row.room_name,
  breakfast: row.breakfast,
  cancelPolicy: row.cancel_policy,
  nightlyPrice: Number(row.nightly_price),
  currency: row.currency,
});

const mapFlight = (row: FlightRow): FlightOffer => ({
  id: row.id,
  airline: row.airline,
  airlineCode: row.airline_code,
  flightNo: row.flight_no,
  departureAirport: row.departure_airport,
  arrivalAirport: row.arrival_airport,
  departureTime: row.departure_time,
  arrivalTime: row.arrival_time,
  duration: row.duration,
  stops: Number(row.stops),
  cabin: row.cabin,
  baggage: row.baggage,
  price: Number(row.price),
  currency: row.currency,
  priceKey: row.price_key,
});

export class FusionDatabase {
  readonly path: string;
  readonly db: DatabaseSync;

  constructor(path: string) {
    this.path = path;
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    if (path !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  private run(statement: StatementSync, params: SqlParams = []) {
    return statement.run(...params);
  }

  private transaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);
    const migrations = [
      { version: 1, name: "001_init", sql: migration001 },
      { version: 2, name: "002_idempotency", sql: migration002 },
      { version: 3, name: "003_business_operations", sql: migration003 },
      { version: 4, name: "004_ledger_backfill", sql: migration004 },
      { version: 5, name: "005_account_profile", sql: migration005 },
      { version: 6, name: "006_account_preferences", sql: migration006 },
    ];
    migrations.forEach(migration => {
      const current = this.db.prepare(
        "SELECT version FROM schema_migrations WHERE version = ?",
      ).get(migration.version);
      if (current) return;
      this.transaction(() => {
        this.db.exec(migration.sql);
        this.db.prepare(
          "INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)",
        ).run(migration.version, migration.name, nowIso());
      });
    });
  }

  seed() {
    const createdAt = nowIso();
    this.transaction(() => {
      this.db.prepare(`
        INSERT OR IGNORE INTO tenants(id, name, status, default_currency, created_at)
        VALUES (?, ?, 'ACTIVE', 'CNY', ?)
      `).run(DEFAULT_TENANT_ID, "寰宇旅行", createdAt);

      this.db.prepare(`
        INSERT OR IGNORE INTO user_profiles(
          id, tenant_id, name, language, phone, email,
          avatar_blob, avatar_mime, avatar_updated_at, created_at, updated_at
        ) VALUES ('user-demo', ?, '林嘉诚', 'zh-CN', '13800008866',
          'lin@example.com', NULL, NULL, NULL, ?, ?)
      `).run(DEFAULT_TENANT_ID, createdAt, createdAt);

      this.db.prepare(`
        INSERT OR IGNORE INTO notification_preferences(
          user_id, order_enabled, flight_enabled, marketing_enabled, updated_at
        ) VALUES ('user-demo', 1, 1, 0, ?)
      `).run(createdAt);

      const travelerStatement = this.db.prepare(`
        INSERT OR IGNORE INTO account_travelers(
          id, user_id, traveler_type, surname, given_name, gender, birthday,
          nationality, document_type, document_encrypted, document_masked,
          issuing_country, expiration, created_at, updated_at
        ) VALUES (?, 'user-demo', ?, ?, ?, ?, ?, ?, 'passport', ?, ?, ?, ?, ?, ?)
      `);
      [
        ["TRV-001", "adult", "LIN", "JIACHENG", "1", "1990-06-18", "CN", "E10000001", "CN", "2031-08-20"],
        ["TRV-002", "child", "LIN", "XIAOYU", "2", "2018-05-12", "CN", "E10000002", "CN", "2030-05-11"],
      ].forEach(traveler => travelerStatement.run(
        traveler[0], traveler[1], traveler[2], traveler[3], traveler[4], traveler[5],
        traveler[6], encryptPii(String(traveler[7])), maskDocument(String(traveler[7])),
        traveler[8], traveler[9], createdAt, createdAt,
      ));

      const hotelStatement = this.db.prepare(`
        INSERT OR IGNORE INTO hotel_offers(
          id, name, city, district, rating, stars, image, tags_json, room_name,
          breakfast, cancel_policy, nightly_price, currency, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      seedHotels.forEach(offer => hotelStatement.run(
        offer.id,
        offer.name,
        offer.city,
        offer.district,
        offer.rating,
        offer.stars,
        offer.image,
        json(offer.tags),
        offer.roomName,
        offer.breakfast,
        offer.cancelPolicy,
        offer.nightlyPrice,
        offer.currency,
        createdAt,
      ));

      const flightStatement = this.db.prepare(`
        INSERT OR IGNORE INTO flight_offers(
          id, airline, airline_code, flight_no, departure_airport, arrival_airport,
          departure_time, arrival_time, duration, stops, cabin, baggage, price,
          currency, price_key, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      seedFlights.forEach(offer => flightStatement.run(
        offer.id,
        offer.airline,
        offer.airlineCode,
        offer.flightNo,
        offer.departureAirport,
        offer.arrivalAirport,
        offer.departureTime,
        offer.arrivalTime,
        offer.duration,
        offer.stops,
        offer.cabin,
        offer.baggage,
        offer.price,
        offer.currency,
        offer.priceKey,
        createdAt,
      ));

      seedOrders.forEach((order, index) => {
        const seedTime = new Date(Date.now() - index * 25 * 60_000).toISOString();
        this.db.prepare(`
          INSERT OR IGNORE INTO orders(
            id, tenant_id, product_type, supplier, supplier_order_no, bridge_key,
            customer, title, subtitle, status, currency, amount,
            product_snapshot_json, contact_snapshot_json, upstream_context_json,
            version, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, '{}', '{}', 0, ?, ?)
        `).run(
          order.id,
          DEFAULT_TENANT_ID,
          order.productType,
          order.productType === "hotel" ? "GLINK" : "FLINK",
          order.supplierOrderNo || null,
          order.customer,
          order.title,
          order.subtitle,
          order.status,
          order.currency,
          order.amount,
          json({ seeded: true }),
          seedTime,
          seedTime,
        );
      });

      const customerStatement = this.db.prepare(`
        INSERT OR IGNORE INTO customers(
          id, tenant_id, name, contact_name, phone, email, status,
          credit_limit, credit_used, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?)
      `);
      [
        ["CUS-001", "寰宇旅行", "林嘉诚", "13800008866", "lin@example.com", 200000, 48320],
        ["CUS-002", "远行商旅", "周敏", "13900002166", "zhou@example.com", 100000, 12680],
        ["CUS-003", "海岸假期", "陈悦", "13700003618", "chen@example.com", 80000, 8950],
      ].forEach(customer => customerStatement.run(
        customer[0],
        DEFAULT_TENANT_ID,
        customer[1],
        customer[2],
        customer[3],
        customer[4],
        customer[5],
        customer[6],
        createdAt,
        createdAt,
      ));

      const ruleStatement = this.db.prepare(`
        INSERT OR IGNORE INTO pricing_rules(
          id, tenant_id, name, product_type, calculation_type, value,
          priority, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      [
        ["PR-001", "酒店标准加价", "hotel", "percentage", 8, 100, "INACTIVE"],
        ["PR-002", "机票服务费", "flight", "fixed", 50, 100, "INACTIVE"],
      ].forEach(rule => ruleStatement.run(
        rule[0],
        DEFAULT_TENANT_ID,
        rule[1],
        rule[2],
        rule[3],
        rule[4],
        rule[5],
        rule[6],
        createdAt,
        createdAt,
      ));
    });
  }

  resetAndSeed() {
    this.transaction(() => {
      [
        "payments",
        "order_events",
        "ledger_entries",
        "orders",
        "booking_sessions",
        "webhook_inbox",
        "webhook_nonces",
        "audit_logs",
        "hotel_offers",
        "flight_offers",
        "counters",
        "idempotency_records",
        "pricing_rules",
        "customers",
        "account_travelers",
        "notification_preferences",
        "user_profiles",
        "maintenance_runs",
        "tenants",
      ].forEach(table => this.db.exec(`DELETE FROM ${table}`));
    });
    this.seed();
  }

  nextOrderId() {
    const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    const key = `order:${date}`;
    return this.transaction(() => {
      this.db.prepare(`
        INSERT INTO counters(key, value) VALUES (?, 1)
        ON CONFLICT(key) DO UPDATE SET value = value + 1
      `).run(key);
      const row = this.db.prepare(
        "SELECT value FROM counters WHERE key = ?",
      ).get(key) as { value: number };
      return `FG${date}${String(row.value).padStart(6, "0")}`;
    });
  }

  listHotels(destination?: string) {
    const rows = this.db.prepare(
      "SELECT * FROM hotel_offers ORDER BY nightly_price ASC",
    ).all() as unknown as HotelRow[];
    const offers = rows.map(mapHotel);
    const normalized = destination?.trim().toLowerCase();
    if (!normalized) return offers;
    const matched = offers.filter(offer =>
      offer.city.toLowerCase().includes(normalized)
      || offer.name.toLowerCase().includes(normalized));
    return matched.length ? matched : offers;
  }

  findHotel(id: string) {
    const row = this.db.prepare(
      "SELECT * FROM hotel_offers WHERE id = ?",
    ).get(id) as HotelRow | undefined;
    return row ? mapHotel(row) : undefined;
  }

  listFlights() {
    const rows = this.db.prepare(
      "SELECT * FROM flight_offers ORDER BY price ASC",
    ).all() as unknown as FlightRow[];
    return rows.map(mapFlight);
  }

  findFlight(id: string) {
    const row = this.db.prepare(
      "SELECT * FROM flight_offers WHERE id = ?",
    ).get(id) as FlightRow | undefined;
    return row ? mapFlight(row) : undefined;
  }

  getAccountProfile(): AccountProfile {
    const row = this.db.prepare(`
      SELECT id, name, language, phone, email, avatar_mime,
             avatar_updated_at, updated_at
      FROM user_profiles WHERE id = 'user-demo'
    `).get() as {
      id: string;
      name: string;
      language: AccountProfile["language"];
      phone: string;
      email: string;
      avatar_mime: AccountProfile["avatarMime"] | null;
      avatar_updated_at: string | null;
      updated_at: string;
    };
    return {
      id: row.id,
      name: row.name,
      language: row.language,
      phone: row.phone,
      email: row.email,
      avatarMime: row.avatar_mime || undefined,
      avatarUpdatedAt: row.avatar_updated_at || undefined,
      updatedAt: row.updated_at,
    };
  }

  updateAccountProfile(input: Pick<AccountProfile, "name" | "language" | "phone" | "email">) {
    this.db.prepare(`
      UPDATE user_profiles
      SET name = ?, language = ?, phone = ?, email = ?, updated_at = ?
      WHERE id = 'user-demo'
    `).run(input.name, input.language, input.phone, input.email, nowIso());
    return this.getAccountProfile();
  }

  saveAccountAvatar(bytes: Uint8Array, mime: AccountProfile["avatarMime"]) {
    const updatedAt = nowIso();
    this.db.prepare(`
      UPDATE user_profiles
      SET avatar_blob = ?, avatar_mime = ?, avatar_updated_at = ?, updated_at = ?
      WHERE id = 'user-demo'
    `).run(bytes, mime || null, updatedAt, updatedAt);
    return this.getAccountProfile();
  }

  getAccountAvatar() {
    return this.db.prepare(`
      SELECT avatar_blob, avatar_mime, avatar_updated_at
      FROM user_profiles WHERE id = 'user-demo'
    `).get() as {
      avatar_blob: Uint8Array | null;
      avatar_mime: AccountProfile["avatarMime"] | null;
      avatar_updated_at: string | null;
    };
  }

  listAccountTravelers(): AccountTraveler[] {
    const rows = this.db.prepare(`
      SELECT * FROM account_travelers
      WHERE user_id = 'user-demo' ORDER BY created_at ASC
    `).all() as unknown as Array<{
      id: string;
      traveler_type: AccountTraveler["type"];
      surname: string;
      given_name: string;
      gender: AccountTraveler["gender"];
      birthday: string;
      nationality: string;
      document_masked: string;
      issuing_country: string;
      expiration: string;
      created_at: string;
      updated_at: string;
    }>;
    return rows.map(row => ({
      id: row.id,
      type: row.traveler_type,
      surname: row.surname,
      givenName: row.given_name,
      gender: row.gender,
      birthday: row.birthday,
      nationality: row.nationality,
      documentNo: row.document_masked,
      issuingCountry: row.issuing_country,
      expiration: row.expiration,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  createAccountTraveler(input: Omit<AccountTraveler, "id" | "createdAt" | "updatedAt">) {
    const id = `TRV-${randomUUID()}`;
    const createdAt = nowIso();
    this.db.prepare(`
      INSERT INTO account_travelers(
        id, user_id, traveler_type, surname, given_name, gender, birthday,
        nationality, document_type, document_encrypted, document_masked,
        issuing_country, expiration, created_at, updated_at
      ) VALUES (?, 'user-demo', ?, ?, ?, ?, ?, ?, 'passport', ?, ?, ?, ?, ?, ?)
    `).run(
      id, input.type, input.surname, input.givenName, input.gender, input.birthday,
      input.nationality, encryptPii(input.documentNo), maskDocument(input.documentNo),
      input.issuingCountry, input.expiration, createdAt, createdAt,
    );
    return this.listAccountTravelers().find(traveler => traveler.id === id)!;
  }

  updateAccountTraveler(id: string, input: Omit<AccountTraveler, "id" | "documentNo" | "createdAt" | "updatedAt"> & { documentNo?: string }) {
    const current = this.db.prepare(`
      SELECT document_encrypted, document_masked FROM account_travelers
      WHERE id = ? AND user_id = 'user-demo'
    `).get(id) as { document_encrypted: string; document_masked: string } | undefined;
    if (!current) return undefined;
    const documentEncrypted = input.documentNo ? encryptPii(input.documentNo) : current.document_encrypted;
    const documentMasked = input.documentNo ? maskDocument(input.documentNo) : current.document_masked;
    this.db.prepare(`
      UPDATE account_travelers SET
        traveler_type = ?, surname = ?, given_name = ?, gender = ?, birthday = ?,
        nationality = ?, document_encrypted = ?, document_masked = ?,
        issuing_country = ?, expiration = ?, updated_at = ?
      WHERE id = ? AND user_id = 'user-demo'
    `).run(
      input.type, input.surname, input.givenName, input.gender, input.birthday,
      input.nationality, documentEncrypted, documentMasked, input.issuingCountry,
      input.expiration, nowIso(), id,
    );
    return this.listAccountTravelers().find(traveler => traveler.id === id);
  }

  deleteAccountTraveler(id: string) {
    return Number(this.db.prepare(`
      DELETE FROM account_travelers WHERE id = ? AND user_id = 'user-demo'
    `).run(id).changes) === 1;
  }

  getNotificationPreferences(): NotificationPreferences {
    const row = this.db.prepare(`
      SELECT order_enabled, flight_enabled, marketing_enabled, updated_at
      FROM notification_preferences WHERE user_id = 'user-demo'
    `).get() as { order_enabled: number; flight_enabled: number; marketing_enabled: number; updated_at: string };
    return {
      order: Boolean(row.order_enabled),
      flight: Boolean(row.flight_enabled),
      marketing: Boolean(row.marketing_enabled),
      updatedAt: row.updated_at,
    };
  }

  updateNotificationPreferences(input: Omit<NotificationPreferences, "updatedAt">) {
    this.db.prepare(`
      UPDATE notification_preferences
      SET order_enabled = ?, flight_enabled = ?, marketing_enabled = ?, updated_at = ?
      WHERE user_id = 'user-demo'
    `).run(input.order ? 1 : 0, input.flight ? 1 : 0, input.marketing ? 1 : 0, nowIso());
    return this.getNotificationPreferences();
  }

  saveHotelAvailability(offer: HotelOffer, amount = offer.nightlyPrice * 2) {
    const verifiedAt = nowIso();
    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    this.db.prepare(`
      INSERT INTO booking_sessions(
        session_key, product_type, offer_id, bridge_key, quantity, amount,
        currency, payload_json, verified_at, expires_at
      ) VALUES (?, 'hotel', ?, NULL, 1, ?, ?, ?, ?, ?)
      ON CONFLICT(session_key) DO UPDATE SET
        amount = excluded.amount,
        currency = excluded.currency,
        payload_json = excluded.payload_json,
        verified_at = excluded.verified_at,
        expires_at = excluded.expires_at
    `).run(
      `hotel:${offer.id}`,
      offer.id,
      amount,
      offer.currency,
      json(offer),
      verifiedAt,
      expiresAt,
    );
    return { verifiedAt, expiresAt };
  }

  saveGlinkHotelAvailability(input: {
    offerId: string;
    roomNum: number;
    amount: number;
    currency: string;
    payload: unknown;
  }) {
    const verifiedAt = nowIso();
    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    this.db.prepare(`
      INSERT INTO booking_sessions(
        session_key, product_type, offer_id, bridge_key, quantity, amount,
        currency, payload_json, verified_at, expires_at
      ) VALUES (?, 'hotel', ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_key) DO UPDATE SET
        bridge_key = excluded.bridge_key,
        quantity = excluded.quantity,
        amount = excluded.amount,
        currency = excluded.currency,
        payload_json = excluded.payload_json,
        verified_at = excluded.verified_at,
        expires_at = excluded.expires_at
    `).run(
      `hotel:${input.offerId}`,
      input.offerId,
      input.offerId,
      input.roomNum,
      input.amount,
      input.currency,
      json(input.payload),
      verifiedAt,
      expiresAt,
    );
    return { verifiedAt, expiresAt };
  }

  getHotelAvailability(offerId: string) {
    const row = this.db.prepare(`
      SELECT * FROM booking_sessions
      WHERE session_key = ? AND expires_at > ?
    `).get(`hotel:${offerId}`, nowIso()) as SessionRow | undefined;
    return row ? {
      offerId: row.offer_id,
      quantity: Number(row.quantity),
      amount: Number(row.amount),
      currency: row.currency,
      payload: parseJson(row.payload_json, {}),
      verifiedAt: row.verified_at,
      expiresAt: row.expires_at,
    } : undefined;
  }

  saveFlightVerification(
    offer: FlightOffer,
    quantity: number,
    amount = offer.price * quantity,
  ) {
    const verifiedAt = nowIso();
    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    this.db.prepare(`
      INSERT INTO booking_sessions(
        session_key, product_type, offer_id, bridge_key, quantity, amount,
        currency, payload_json, verified_at, expires_at
      ) VALUES (?, 'flight', ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_key) DO UPDATE SET
        quantity = excluded.quantity,
        amount = excluded.amount,
        currency = excluded.currency,
        payload_json = excluded.payload_json,
        verified_at = excluded.verified_at,
        expires_at = excluded.expires_at
    `).run(
      `flight:${offer.id}:${offer.priceKey}`,
      offer.id,
      offer.priceKey,
      quantity,
      amount,
      offer.currency,
      json(offer),
      verifiedAt,
      expiresAt,
    );
    return { amount, currency: offer.currency, verifiedAt, expiresAt };
  }

  getFlightVerification(offerId: string, priceKey: string) {
    const row = this.db.prepare(`
      SELECT * FROM booking_sessions
      WHERE session_key = ? AND expires_at > ?
    `).get(`flight:${offerId}:${priceKey}`, nowIso()) as SessionRow | undefined;
    return row ? {
      offerId: row.offer_id,
      priceKey: row.bridge_key || "",
      quantity: Number(row.quantity),
      amount: Number(row.amount),
      currency: row.currency,
      verifiedAt: row.verified_at,
      expiresAt: row.expires_at,
    } : undefined;
  }

  listOrders(limit?: number) {
    const sql = limit
      ? "SELECT * FROM orders ORDER BY created_at DESC LIMIT ?"
      : "SELECT * FROM orders ORDER BY created_at DESC";
    const rows = (limit
      ? this.db.prepare(sql).all(limit)
      : this.db.prepare(sql).all()) as unknown as OrderRow[];
    return rows.map(mapOrder);
  }

  listOrdersBefore(status: OrderStatus, beforeIso: string, limit = 50) {
    const rows = this.db.prepare(`
      SELECT * FROM orders
      WHERE status = ? AND updated_at <= ?
      ORDER BY updated_at ASC LIMIT ?
    `).all(status, beforeIso, limit) as unknown as OrderRow[];
    return rows.map(mapOrder);
  }

  findOrder(id: string) {
    const row = this.db.prepare(
      "SELECT * FROM orders WHERE id = ?",
    ).get(id) as OrderRow | undefined;
    return row ? mapOrder(row) : undefined;
  }

  getOrderSnapshots(orderId: string) {
    const row = this.db.prepare(`
      SELECT product_snapshot_json, contact_snapshot_json
      FROM orders WHERE id = ?
    `).get(orderId) as {
      product_snapshot_json: string;
      contact_snapshot_json: string;
    } | undefined;
    return row ? {
      product: parseJson<unknown>(row.product_snapshot_json, {}),
      contact: parseJson<unknown>(row.contact_snapshot_json, {}),
    } : undefined;
  }

  getIdempotentOrder(scope: string, idempotencyKey: string) {
    const record = this.db.prepare(`
      SELECT resource_id FROM idempotency_records
      WHERE scope = ? AND idempotency_key = ?
    `).get(scope, idempotencyKey) as { resource_id: string } | undefined;
    return record ? this.findOrder(record.resource_id) : undefined;
  }

  saveIdempotency(scope: string, idempotencyKey: string, resourceId: string) {
    this.db.prepare(`
      INSERT OR IGNORE INTO idempotency_records(
        scope, idempotency_key, resource_id, created_at
      ) VALUES (?, ?, ?, ?)
    `).run(scope, idempotencyKey, resourceId, nowIso());
  }

  insertOrder(input: PersistOrderInput) {
    const createdAt = nowIso();
    this.transaction(() => {
      this.db.prepare(`
        INSERT INTO orders(
          id, tenant_id, product_type, supplier, supplier_order_no, bridge_key,
          customer, title, subtitle, status, currency, amount,
          product_snapshot_json, contact_snapshot_json, upstream_context_json,
          version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      `).run(
        input.order.id,
        DEFAULT_TENANT_ID,
        input.order.productType,
        input.supplier,
        input.order.supplierOrderNo || null,
        input.bridgeKey || null,
        input.order.customer,
        input.order.title,
        input.order.subtitle,
        input.order.status,
        input.order.currency,
        input.order.amount,
        json(input.productSnapshot),
        json(input.contactSnapshot),
        json(input.upstream),
        createdAt,
        createdAt,
      );
      this.appendEventInternal(
        input.order.id,
        "ORDER_CREATED",
        undefined,
        input.order.status,
        { supplier: input.supplier },
      );
    });
    return this.findOrder(input.order.id)!;
  }

  updateOrder(
    id: string,
    patch: {
      status?: OrderStatus;
      supplierOrderNo?: string;
      amount?: number;
      currency?: string;
    },
    eventType: string,
    payload: unknown = {},
  ) {
    return this.transaction(() => {
      const current = this.findOrder(id);
      if (!current) return undefined;
      const nextStatus = patch.status || current.status;
      const supplierOrderNo = patch.supplierOrderNo || current.supplierOrderNo || null;
      const amount = patch.amount ?? current.amount;
      const currency = patch.currency || current.currency;
      this.db.prepare(`
        UPDATE orders
        SET status = ?, supplier_order_no = ?, amount = ?, currency = ?,
            version = version + 1, updated_at = ?
        WHERE id = ?
      `).run(nextStatus, supplierOrderNo, amount, currency, nowIso(), id);
      this.appendEventInternal(
        id,
        eventType,
        current.status,
        nextStatus,
        payload,
      );
      return this.findOrder(id);
    });
  }

  private appendEventInternal(
    orderId: string,
    eventType: string,
    fromStatus: string | undefined,
    toStatus: string | undefined,
    payload: unknown,
  ) {
    const eventId = randomUUID();
    const createdAt = nowIso();
    this.db.prepare(`
      INSERT INTO order_events(
        id, order_id, event_type, event_key, from_status, to_status,
        payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      eventId,
      orderId,
      eventType,
      `${eventType}:${orderId}:${eventId}`,
      fromStatus || null,
      toStatus || null,
      json(payload),
      createdAt,
    );
  }

  listOrderEvents(orderId: string) {
    const rows = this.db.prepare(`
      SELECT id, order_id, event_type, from_status, to_status, payload_json, created_at
      FROM order_events WHERE order_id = ? ORDER BY created_at ASC
    `).all(orderId) as unknown as Array<{
      id: string;
      order_id: string;
      event_type: string;
      from_status: string | null;
      to_status: string | null;
      payload_json: string;
      created_at: string;
    }>;
    return rows.map((row): OrderEvent => ({
      id: row.id,
      orderId: row.order_id,
      eventType: row.event_type,
      fromStatus: row.from_status || undefined,
      toStatus: row.to_status || undefined,
      payload: parseJson(row.payload_json, {}),
      createdAt: row.created_at,
    }));
  }

  createPayment(order: DistributionOrder, status: string, channel = "ENTERPRISE_CREDIT") {
    const id = randomUUID();
    const paymentNo = `PAY${Date.now()}${Math.floor(100 + Math.random() * 900)}`;
    const createdAt = nowIso();
    this.db.prepare(`
      INSERT INTO payments(
        id, order_id, payment_no, channel, amount, currency, status,
        provider_transaction_no, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
    `).run(
      id,
      order.id,
      paymentNo,
      channel,
      order.amount,
      order.currency,
      status,
      createdAt,
      createdAt,
    );
    if (status === "CAPTURED") {
      this.recordLedgerEntry({
        orderId: order.id,
        entryType: "PAYMENT",
        amount: -Math.abs(order.amount),
        currency: order.currency,
        status: "POSTED",
        reference: `PAYMENT:${order.id}`,
      });
    }
    return { id, paymentNo, status };
  }

  hasCapturedPayment(orderId: string) {
    return Boolean(this.db.prepare(`
      SELECT 1 FROM payments WHERE order_id = ? AND status = 'CAPTURED' LIMIT 1
    `).get(orderId));
  }

  recordLedgerEntry(input: {
    orderId?: string;
    entryType: LedgerEntry["entryType"];
    amount: number;
    currency: string;
    status: string;
    reference: string;
  }) {
    const id = randomUUID();
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO ledger_entries(
        id, tenant_id, order_id, entry_type, amount, currency, status,
        reference, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      DEFAULT_TENANT_ID,
      input.orderId || null,
      input.entryType,
      input.amount,
      input.currency,
      input.status,
      input.reference,
      nowIso(),
    );
    return { id, inserted: Number(result.changes) === 1 };
  }

  listLedgerEntries(limit = 100): LedgerEntry[] {
    const rows = this.db.prepare(`
      SELECT id, order_id, entry_type, amount, currency, status, reference, created_at
      FROM ledger_entries ORDER BY created_at DESC LIMIT ?
    `).all(limit) as unknown as Array<{
      id: string;
      order_id: string | null;
      entry_type: LedgerEntry["entryType"];
      amount: number;
      currency: string;
      status: string;
      reference: string;
      created_at: string;
    }>;
    return rows.map(row => ({
      id: row.id,
      orderId: row.order_id || undefined,
      entryType: row.entry_type,
      amount: Number(row.amount),
      currency: row.currency,
      status: row.status,
      reference: row.reference,
      createdAt: row.created_at,
    }));
  }

  financeSummary() {
    const rows = this.listLedgerEntries(1000);
    const sumByCurrency = (entries: LedgerEntry[]) => entries.reduce<Record<string, number>>(
      (totals, entry) => ({
        ...totals,
        [entry.currency]: Number(((totals[entry.currency] || 0) + Math.abs(entry.amount)).toFixed(2)),
      }),
      {},
    );
    const paidByCurrency = sumByCurrency(rows.filter(
      entry => entry.entryType === "PAYMENT" && entry.status === "POSTED",
    ));
    const refundPendingByCurrency = sumByCurrency(rows.filter(
      entry => entry.entryType === "REFUND_PENDING",
    ));
    const customers = this.listCustomers();
    const totalCredit = customers.reduce((sum, customer) => sum + customer.creditLimit, 0);
    const usedCredit = customers.reduce((sum, customer) => sum + customer.creditUsed, 0);
    return {
      availableCredit: Math.max(0, totalCredit - usedCredit),
      totalCredit,
      paid: paidByCurrency.CNY || 0,
      paidByCurrency,
      refundPending: refundPendingByCurrency.CNY || 0,
      refundPendingByCurrency,
      entries: rows,
    };
  }

  listCustomers(): Customer[] {
    const rows = this.db.prepare(`
      SELECT * FROM customers ORDER BY created_at DESC
    `).all() as unknown as Array<{
      id: string;
      name: string;
      contact_name: string;
      phone: string;
      email: string;
      status: Customer["status"];
      credit_limit: number;
      credit_used: number;
      created_at: string;
    }>;
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      contactName: row.contact_name,
      phone: row.phone,
      email: row.email,
      status: row.status,
      creditLimit: Number(row.credit_limit),
      creditUsed: Number(row.credit_used),
      createdAt: row.created_at,
    }));
  }

  findCustomer(id: string) {
    return this.listCustomers().find(customer => customer.id === id);
  }

  findCustomerByName(name: string) {
    return this.listCustomers().find(customer => customer.name === name);
  }

  hasAvailableCredit(customerName: string, amount: number) {
    const customer = this.findCustomerByName(customerName);
    return Boolean(
      customer
      && customer.status === "ACTIVE"
      && customer.creditLimit - customer.creditUsed >= amount,
    );
  }

  consumeCustomerCredit(customerName: string, amount: number) {
    const result = this.db.prepare(`
      UPDATE customers
      SET credit_used = credit_used + ?, updated_at = ?
      WHERE name = ? AND status = 'ACTIVE'
        AND credit_limit - credit_used >= ?
    `).run(amount, nowIso(), customerName, amount);
    return Number(result.changes) === 1;
  }

  restoreCustomerCredit(customerName: string, amount: number) {
    const result = this.db.prepare(`
      UPDATE customers
      SET credit_used = MAX(0, credit_used - ?), updated_at = ?
      WHERE name = ?
    `).run(Math.max(0, amount), nowIso(), customerName);
    return Number(result.changes) === 1;
  }

  createCustomer(input: Omit<Customer, "id" | "createdAt" | "creditUsed">) {
    const id = `CUS-${randomUUID().slice(0, 8).toUpperCase()}`;
    const createdAt = nowIso();
    this.db.prepare(`
      INSERT INTO customers(
        id, tenant_id, name, contact_name, phone, email, status,
        credit_limit, credit_used, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(
      id,
      DEFAULT_TENANT_ID,
      input.name,
      input.contactName,
      input.phone,
      input.email,
      input.status,
      input.creditLimit,
      createdAt,
      createdAt,
    );
    return this.listCustomers().find(customer => customer.id === id)!;
  }

  updateCustomerStatus(id: string, status: Customer["status"]) {
    this.db.prepare(`
      UPDATE customers SET status = ?, updated_at = ? WHERE id = ?
    `).run(status, nowIso(), id);
    return this.listCustomers().find(customer => customer.id === id);
  }

  listPricingRules(): PricingRule[] {
    const rows = this.db.prepare(`
      SELECT * FROM pricing_rules ORDER BY priority ASC, created_at DESC
    `).all() as unknown as Array<{
      id: string;
      name: string;
      product_type: PricingRule["productType"];
      calculation_type: PricingRule["calculationType"];
      value: number;
      priority: number;
      status: PricingRule["status"];
      created_at: string;
    }>;
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      productType: row.product_type,
      calculationType: row.calculation_type,
      value: Number(row.value),
      priority: Number(row.priority),
      status: row.status,
      createdAt: row.created_at,
    }));
  }

  createPricingRule(input: Omit<PricingRule, "id" | "createdAt">) {
    const id = `PR-${randomUUID().slice(0, 8).toUpperCase()}`;
    const createdAt = nowIso();
    this.db.prepare(`
      INSERT INTO pricing_rules(
        id, tenant_id, name, product_type, calculation_type, value,
        priority, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      DEFAULT_TENANT_ID,
      input.name,
      input.productType,
      input.calculationType,
      input.value,
      input.priority,
      input.status,
      createdAt,
      createdAt,
    );
    return this.listPricingRules().find(rule => rule.id === id)!;
  }

  updatePricingRuleStatus(id: string, status: PricingRule["status"]) {
    this.db.prepare(`
      UPDATE pricing_rules SET status = ?, updated_at = ? WHERE id = ?
    `).run(status, nowIso(), id);
    return this.listPricingRules().find(rule => rule.id === id);
  }

  calculateSaleAmount(productType: ProductType, supplierAmount: number) {
    const rule = this.listPricingRules().find(candidate =>
      candidate.status === "ACTIVE"
      && (candidate.productType === productType || candidate.productType === "all"));
    if (!rule) return Number(supplierAmount.toFixed(2));
    const amount = rule.calculationType === "percentage"
      ? supplierAmount * (1 + rule.value / 100)
      : supplierAmount + rule.value;
    return Number(amount.toFixed(2));
  }

  startMaintenanceRun(taskName: string) {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO maintenance_runs(
        id, task_name, status, scanned_count, succeeded_count, failed_count,
        detail_json, started_at, finished_at
      ) VALUES (?, ?, 'RUNNING', 0, 0, 0, '{}', ?, NULL)
    `).run(id, taskName, nowIso());
    return id;
  }

  finishMaintenanceRun(
    id: string,
    result: { scanned: number; succeeded: number; failed: number; detail: unknown },
  ) {
    const status = result.failed === 0 ? "SUCCESS"
      : result.succeeded > 0 ? "PARTIAL"
        : "FAILED";
    this.db.prepare(`
      UPDATE maintenance_runs
      SET status = ?, scanned_count = ?, succeeded_count = ?, failed_count = ?,
          detail_json = ?, finished_at = ?
      WHERE id = ?
    `).run(
      status,
      result.scanned,
      result.succeeded,
      result.failed,
      json(result.detail),
      nowIso(),
      id,
    );
    return { id, status, ...result };
  }

  getUpstreamContext(orderId: string) {
    const row = this.db.prepare(
      "SELECT upstream_context_json FROM orders WHERE id = ?",
    ).get(orderId) as { upstream_context_json: string } | undefined;
    return row
      ? parseJson<UpstreamOrderContext | undefined>(row.upstream_context_json, undefined)
      : undefined;
  }

  updateUpstreamContext(orderId: string, upstream: UpstreamOrderContext) {
    this.db.prepare(`
      UPDATE orders
      SET upstream_context_json = ?, version = version + 1, updated_at = ?
      WHERE id = ?
    `).run(json(upstream), nowIso(), orderId);
  }

  findOrderByUpstream(value: string) {
    const row = this.db.prepare(`
      SELECT * FROM orders
      WHERE bridge_key = ? OR supplier_order_no = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(value, value) as OrderRow | undefined;
    return row ? mapOrder(row) : undefined;
  }

  registerWebhookNonce(provider: string, nonce: string) {
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO webhook_nonces(provider, nonce, created_at)
      VALUES (?, ?, ?)
    `).run(provider, nonce, nowIso());
    return Number(result.changes) === 1;
  }

  recordWebhook(
    provider: string,
    eventKey: string,
    signatureValid: boolean,
    payload: unknown,
  ) {
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO webhook_inbox(
        id, provider, event_key, signature_valid, payload_json, processed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, NULL, ?)
    `).run(
      randomUUID(),
      provider,
      eventKey,
      signatureValid ? 1 : 0,
      json(payload),
      nowIso(),
    );
    return { duplicate: Number(result.changes) === 0 };
  }

  hasWebhookEvent(provider: string, eventKey: string) {
    return Boolean(this.db.prepare(`
      SELECT 1 FROM webhook_inbox WHERE provider = ? AND event_key = ?
    `).get(provider, eventKey));
  }

  markWebhookProcessed(eventKey: string) {
    this.db.prepare(
      "UPDATE webhook_inbox SET processed_at = ? WHERE event_key = ?",
    ).run(nowIso(), eventKey);
  }

  dashboard() {
    const rows = this.listOrders();
    const active = rows.filter(order => order.status !== "CANCELLED");
    const completed = rows.filter(order =>
      order.status === "CONFIRMED" || order.status === "TICKETED" || order.status === "REFUNDED");
    const alerts = rows.filter(order =>
      ["PENDING_PAYMENT", "PROCESSING", "CHANGING", "REFUNDING"].includes(order.status)).length;
    return {
      salesToday: active.reduce((sum, order) => sum + order.amount, 0),
      ordersToday: rows.length,
      successRate: rows.length ? Number((completed.length / rows.length * 100).toFixed(1)) : 0,
      alerts,
      recentOrders: rows.slice(0, 5),
    };
  }

  status() {
    const count = (table: string) => Number(
      (this.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count,
    );
    const version = this.db.prepare(
      "SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations",
    ).get() as { version: number };
    return {
      driver: "sqlite",
      database: this.path === ":memory:" ? ":memory:" : basename(this.path),
      migrationVersion: Number(version.version),
      counts: {
        hotels: count("hotel_offers"),
        flights: count("flight_offers"),
        orders: count("orders"),
        payments: count("payments"),
        events: count("order_events"),
        webhooks: count("webhook_inbox"),
        customers: count("customers"),
        pricingRules: count("pricing_rules"),
        ledgerEntries: count("ledger_entries"),
        profiles: count("user_profiles"),
        travelers: count("account_travelers"),
      },
    };
  }

  close() {
    this.db.close();
  }
}

export function databasePath() {
  if (process.env.DATABASE_PATH) {
    return process.env.DATABASE_PATH === ":memory:"
      ? ":memory:"
      : resolve(process.cwd(), process.env.DATABASE_PATH);
  }
  const environment = process.env.FCG_ENV || process.env.FCG_MODE || "mock";
  return resolve(process.cwd(), ".data", `fusiongo-${environment}.sqlite`);
}

export function openFusionDatabase() {
  const database = new FusionDatabase(databasePath());
  database.seed();
  return database;
}

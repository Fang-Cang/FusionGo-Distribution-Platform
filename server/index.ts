import "dotenv/config";
import cors from "cors";
import express from "express";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import type { DistributionOrder, FlightAddOns, HotelOffer, NationalityCatalog, OrderStatus, PaymentMethod } from "../src/types.js";
import {
  applyFlinkChange,
  applyFlinkRefund,
  cancelFlinkChange,
  checkGlinkAvailability,
  confirmFlinkRefund,
  createFlinkOrder,
  createGlinkOrder,
  fcgValue,
  getFlinkChangeDetail,
  getFlinkOrderAfterSalesSource,
  getFlinkRefundDetail,
  GlinkNoProductError,
  hydrateGlinkProducts,
  listFlinkNationalities,
  queryGlinkLowestPrices,
  payFlinkOrder,
  payFlinkChange,
  refreshFlinkCabin,
  searchFlinkChangeOffers,
  searchFlinkFlights,
  searchGlinkHotels,
  synchronizeHotelQuoteFromAvailability,
  verifyFlinkFlight,
  type FlightQuoteContext,
  type HotelQuoteContext,
} from "./fcg/adapters.js";
import { FcgError } from "./fcg/client.js";
import {
  mapGlinkCancelResult,
  mapGlinkOrderDetailStatus,
  mapGlinkOrderStatusWebhook,
} from "./fcg/glink-status.js";
import {
  mapFlinkOrderStatus,
  mapFlinkPostPaymentStatus,
  reconcileSupplierStatus,
} from "./fcg/order-status.js";
import { getFcgRuntime } from "./fcg/runtime.js";
import { verifyFcgWebhook } from "./fcg/webhook.js";
import { getDisplayFxRates } from "./fx.js";
import { createOrderDocumentPdf } from "./order-document.js";
import { createHotelConfirmationEmailHtml } from "./order-email.js";
import { isSupplierCommerceRequest, localHotelSimulationAllowed, simulatedSupplierDataAllowed } from "./real-data-policy.js";
import { openFusionDatabase, type UpstreamOrderContext } from "./database.js";
import { isoNationalityOptions, mergeSupplierNationalities } from "./reference/nationalities.js";

export const app = express();
const runtime = getFcgRuntime();
export const database = openFusionDatabase(simulatedSupplierDataAllowed());
const hotelQuotes = new Map<string, HotelQuoteContext>();
const hotelStayContexts = new Map<string, {
  checkInDate: string;
  checkOutDate: string;
  roomNum: number;
  numberOfAdults: number;
  numberOfChildren?: number;
  childrenAges?: number[];
  nights: number;
}>();
const flightQuotes = new Map<string, FlightQuoteContext>();
const nationalityCatalogCache = new Map<string, { expiresAt: number; value: NationalityCatalog }>();
const flightChangeQuotes = new Map<string, {
  orderId: string;
  passengerCode: string;
  segmentId: string;
  targetDate: string;
  amount: number;
  currency: string;
  expiresAt: number;
}>();
const simulatedHotelOffers = new Map<string, HotelOffer>();
const sandboxHotelSimulationEnabled = runtime.mode === "sandbox"
  && simulatedSupplierDataAllowed()
  && process.env.FCG_SANDBOX_HOTEL_SIMULATION === "true";
const useLocalHotelSimulation = localHotelSimulationAllowed(
  runtime.mode,
  runtime.glinkConfigured,
);
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map(value => value.trim())
  .filter(Boolean);
const applicationDate = () => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: process.env.APP_TIME_ZONE || "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: "year" | "month" | "day") => parts.find(item => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (runtime.mode === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    if (!req.secure) return res.status(426).json({
      code: "HTTPS_REQUIRED",
      message: "Production requests involving personal data must use HTTPS",
    });
  }
  next();
});
app.use(cors({
  credentials: true,
  origin(origin, callback) {
    if (runtime.mode !== "production" || !origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error("CORS origin is not allowed"));
  },
}));
app.use(express.json({
  limit: "1mb",
  verify: (request, _response, buffer) => {
    (request as express.Request & { rawBody?: string }).rawBody = buffer.toString("utf8");
  },
}));
app.use((req, res, next) => {
  if (runtime.mode === "mock"
    && !simulatedSupplierDataAllowed()
    && isSupplierCommerceRequest(req.method, req.path)) {
    return res.status(503).json({
      code: "REAL_SUPPLIER_DATA_REQUIRED",
      message: "Current mode has no G-Link/F-Link connection. Simulated products, quotes, and order data are prohibited.",
    });
  }
  next();
});

const ok = <T>(data: T) => ({ code: "SUCCESS", message: "ok", requestId: randomUUID(), data });
const findOrder = (id: string, userId?: string) => database.findOrder(id, userId);
const localOrderId = () => database.nextOrderId();
const coOrderCode = () => `OPFG${Date.now()}${Math.floor(100 + Math.random() * 900)}`;
const hotelNightCount = (checkInDate: string, checkOutDate: string) => Math.max(
  1,
  Math.round((Date.parse(`${checkOutDate}T00:00:00Z`) - Date.parse(`${checkInDate}T00:00:00Z`)) / 86_400_000),
);
const optionalSupplierAmount = (value: unknown) => {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};
const simulatedHotelOffer = (quote: HotelQuoteContext): HotelOffer => {
  const template = database.listHotels()[0];
  const offer: HotelOffer = {
    ...template,
    id: `SIM-${quote.id}`,
    inventorySource: "simulation",
    name: quote.hotelName,
    city: quote.city || template.city,
    district: quote.district || template.district,
    image: quote.image || template.image,
    tags: ["Sandbox Simulation", "Non-real-time Inventory", ...(quote.tags || [])].slice(0, 4),
    roomName: template.roomName,
    breakfast: template.breakfast,
    cancelPolicy: template.cancelPolicy,
    nightlyPrice: quote.nightlyPrice || template.nightlyPrice,
    currency: quote.currency || template.currency,
    checkInDate: quote.checkInDate,
    checkOutDate: quote.checkOutDate,
    roomNum: quote.roomNum,
    numberOfAdults: quote.numberOfAdults,
    nights: hotelNightCount(quote.checkInDate, quote.checkOutDate),
    totalPrice: (quote.nightlyPrice || template.nightlyPrice)
      * hotelNightCount(quote.checkInDate, quote.checkOutDate)
      * quote.roomNum,
  };
  simulatedHotelOffers.set(offer.id, offer);
  return offer;
};
const FLIGHT_ADD_ON_PRICES: Record<keyof FlightAddOns, number> = {
  baggage: 260,
  seat: 80,
  insurance: 68,
};
const addOnAmount = (addOns: FlightAddOns) =>
  (Object.keys(FLIGHT_ADD_ON_PRICES) as Array<keyof FlightAddOns>)
    .reduce((total, key) => total + (addOns[key] ? FLIGHT_ADD_ON_PRICES[key] : 0), 0);
const paymentChannel = (method: PaymentMethod) =>
  method === "card" ? "BANK_CARD" : "ENTERPRISE_CREDIT";
const productionReadiness = () => {
  const checks = {
    productionCredentials: runtime.glinkConfigured && runtime.flinkConfigured,
    productionEnvironment: runtime.environment === "production",
    httpsPublicUrl: /^https:\/\//.test(process.env.PUBLIC_APP_URL || ""),
    webhookPublicUrl: /^https:\/\//.test(process.env.WEBHOOK_PUBLIC_URL || ""),
    corsAllowlist: allowedOrigins.length > 0,
    authentication: process.env.AUTH_MODE === "external",
    persistentDatabase: Boolean(process.env.DATABASE_PATH)
      && process.env.DATABASE_PATH !== ":memory:"
      && process.env.PRODUCTION_DATABASE_PERSISTENT === "true",
    piiEncryptionKey: Boolean(process.env.PII_ENCRYPTION_KEY)
      && (process.env.PII_ENCRYPTION_KEY?.length || 0) >= 32,
    sandboxSimulationOff: !sandboxHotelSimulationEnabled,
    paymentPolicy: process.env.PAYMENT_MODE === "enterprise_credit"
      || (process.env.PAYMENT_MODE === "card" && process.env.PAYMENT_CARD_ENABLED === "true"),
    psd2ScaPolicy: process.env.PAYMENT_MODE !== "card"
      || process.env.PAYMENT_PSD2_SCA_ENABLED === "true",
    customerSupport: /^https:\/\//.test(process.env.CUSTOMER_SUPPORT_URL || "")
      && Boolean(process.env.CUSTOMER_SUPPORT_EMAIL || process.env.CUSTOMER_SUPPORT_PHONE),
    maintenanceConfigured: process.env.ORDER_MAINTENANCE_ENABLED === "true"
      && Boolean(process.env.MAINTENANCE_API_KEY),
  };
  return {
    ready: Object.values(checks).every(Boolean),
    checks,
    blockers: Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name),
  };
};

const AUTH_COOKIE = "fusiongo_auth";
const readCookie = (cookieHeader: string | undefined, name: string) => {
  if (!cookieHeader) return undefined;
  for (const pair of cookieHeader.split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 0) continue;
    if (pair.slice(0, separator).trim() === name) return decodeURIComponent(pair.slice(separator + 1).trim());
  }
  return undefined;
};
const authMode = process.env.AUTH_MODE === "external" ? "external" as const : "local" as const;
const authUserId = (req: express.Request) => {
  if (runtime.mode === "production") return undefined;
  const token = readCookie(req.headers.cookie, AUTH_COOKIE);
  if (token === "local-user") return "user-demo";
  return token && token !== "guest" ? database.resolveLocalAuthSession(token) : undefined;
};
const isAuthenticated = (req: express.Request) => {
  return Boolean(authUserId(req));
};
const authSession = (req: express.Request) => {
  const userId = authUserId(req);
  const authenticated = Boolean(userId);
  const profile = userId ? database.getAccountProfile(userId) : undefined;
  return {
    authenticated,
    mode: authMode,
    user: profile ? { id: profile.id, name: profile.name, email: profile.email, role: profile.id === "user-demo" ? "admin" as const : "member" as const } : undefined,
  };
};
const authCookie = (value: string) => [
  `${AUTH_COOKIE}=${value}`,
  "Path=/",
  "HttpOnly",
  "SameSite=Lax",
  runtime.mode === "production" ? "Secure" : "",
  value === "guest" ? "Max-Age=31536000" : "Max-Age=28800",
].filter(Boolean).join("; ");
const requireAuthenticated: express.RequestHandler = (req, res, next) => {
  if (isAuthenticated(req)) return next();
  return res.status(401).json({
    code: "AUTH_REQUIRED",
    message: "Please sign in before accessing account or booking",
  });
};
const requireAdmin: express.RequestHandler = (req, res, next) => {
  if (authUserId(req) === "user-demo") return next();
  return res.status(403).json({ code: "ADMIN_REQUIRED", message: "Current account does not have admin permissions" });
};

app.get("/api/health", (_req, res) => res.json(ok({
  status: "up",
  mode: runtime.mode,
  database: database.status(),
})));
app.get("/api/fx/rates", async (_req, res) => {
  try {
    res.json(ok(await getDisplayFxRates()));
  } catch (error) {
    res.status(502).json({ code: "FX_RATE_UNAVAILABLE", message: error instanceof Error ? error.message : "Exchange rate service temporarily unavailable" });
  }
});
app.get("/api/ready", (_req, res) => {
  const readiness = runtime.mode === "production"
    ? productionReadiness()
    : { ready: true, checks: { nonProductionMode: true }, blockers: [] as string[] };
  return res.status(readiness.ready ? 200 : 503).json(ok(readiness));
});
app.get("/api/database/status", (_req, res) => res.json(ok(database.status())));
app.get("/api/integration/status", (_req, res) => res.json(ok({
  mode: runtime.mode,
  environment: runtime.environment,
  baseUrl: runtime.baseUrl,
  glinkConfigured: runtime.glinkConfigured,
  flinkConfigured: runtime.flinkConfigured,
  contracts: {
    glink: "docs/swagger/glink-api.json",
    flink: "docs/swagger/flink-api.json",
    version: "2026-04-24",
  },
})));

app.get("/api/auth/session", (req, res) => res.json(ok(authSession(req))));
app.post("/api/auth/login", (req, res) => {
  if (runtime.mode === "production" || authMode === "external") {
    return res.status(501).json({
      code: "EXTERNAL_LOGIN_REQUIRED",
      message: "Production requires enterprise SSO for login",
    });
  }
  const parsed = z.object({ email: z.string().email(), password: z.string().min(8).max(72) }).safeParse(req.body || {});
  const userId = parsed.success
    ? database.authenticateLocalAccount(parsed.data.email, parsed.data.password)
    : "user-demo";
  if (!userId) return res.status(401).json({ code: "INVALID_CREDENTIALS", message: "Invalid email or password" });
  const profile = database.getAccountProfile(userId);
  res.setHeader("Set-Cookie", authCookie(database.createLocalAuthSession(userId)));
  return res.json(ok({ authenticated: true, mode: authMode, user: { id: profile.id, name: profile.name, email: profile.email, role: userId === "user-demo" ? "admin" as const : "member" as const } }));
});
const internationalPhoneSchema = z.string().trim().min(1).max(30).refine(value => {
  if (!/^\+?[0-9 ()-]+$/.test(value)) return false;
  const digitCount = value.replace(/\D/g, "").length;
  return digitCount >= 7 && digitCount <= 15;
}, "Phone number must contain 7-15 digits; country code, spaces, hyphens, and parentheses are optional");

app.post("/api/auth/register", (req, res) => {
  if (runtime.mode === "production" || authMode === "external") {
    return res.status(501).json({
      code: "EXTERNAL_REGISTRATION_REQUIRED",
      message: "Production requires enterprise identity system for account creation",
    });
  }
  const parsed = z.object({
    surname: z.string().trim().min(1).max(50),
    givenName: z.string().trim().min(1).max(50),
    email: z.string().trim().email().max(120),
    phone: internationalPhoneSchema,
    password: z.string().min(8).max(72)
      .regex(/[A-Za-z]/, "Password must contain letters")
      .regex(/[0-9]/, "Password must contain digits"),
    language: z.enum(["zh-CN", "zh-TW", "en"]).default("en"),
    acceptedTerms: z.literal(true),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({
    code: "INVALID_REGISTRATION",
    message: parsed.error.issues[0]?.message || "Registration details are invalid",
  });
  const profile = database.createLocalAccount(parsed.data);
  if (!profile) return res.status(409).json({ code: "EMAIL_ALREADY_REGISTERED", message: "This email is already registered. Please sign in directly." });
  res.setHeader("Set-Cookie", authCookie(database.createLocalAuthSession(profile.id)));
  return res.status(201).json(ok({ authenticated: true, mode: authMode, user: { id: profile.id, name: profile.name, email: profile.email, role: "member" as const } }));
});
app.post("/api/auth/logout", (req, res) => {
  const token = readCookie(req.headers.cookie, AUTH_COOKIE);
  if (token && token !== "guest" && token !== "local-user") database.deleteLocalAuthSession(token);
  res.setHeader("Set-Cookie", authCookie("guest"));
  return res.json(ok({ authenticated: false, mode: authMode }));
});

app.use("/api/dashboard", requireAuthenticated);
app.use("/api/account", requireAuthenticated);
app.use("/api/customers", requireAuthenticated);
app.use("/api/pricing-rules", requireAuthenticated);
app.use("/api/finance", requireAuthenticated);
app.use("/api/orders", requireAuthenticated);
app.use("/api/hotels/availability", requireAuthenticated);
app.use("/api/flights/verify", requireAuthenticated);
app.use("/api/dashboard", requireAdmin);
app.use("/api/customers", requireAdmin);
app.use("/api/pricing-rules", requireAdmin);
app.use("/api/finance", requireAdmin);

app.get("/api/reference/nationalities", async (req, res) => {
  const parsed = z.enum(["zh-CN", "zh-TW", "en"]).safeParse(req.query.locale || "zh-CN");
  if (!parsed.success) return res.status(400).json({
    code: "INVALID_LOCALE",
    message: "Nationality locale only supports zh-CN, zh-TW, or en",
  });
  const locale = parsed.data;
  const cached = nationalityCatalogCache.get(locale);
  if (cached && cached.expiresAt > Date.now()) return res.json(ok(cached.value));

  let value: NationalityCatalog;
  if (runtime.mode !== "mock" && runtime.flinkConfigured) {
    try {
      const supplierLang: "zh_CN" | "zh_TW" | "en" = {
        "zh-CN": "zh_CN",
        "zh-TW": "zh_TW",
        en: "en",
      }[locale] as "zh_CN" | "zh_TW" | "en";
      const supplierItems = await listFlinkNationalities(runtime.flink, supplierLang);
      if (!supplierItems.length) throw new Error("F-Link returned an empty nationality list");
      const items = mergeSupplierNationalities(supplierItems);
      value = {
        items,
        source: "flink",
        count: items.length,
        fetchedAt: new Date().toISOString(),
      };
    } catch (error) {
      const items = isoNationalityOptions();
      value = {
        items,
        source: "iso-3166",
        count: items.length,
        fetchedAt: new Date().toISOString(),
        warning: error instanceof Error
          ? `F-Link nationality data is temporarily unavailable. Showing the full ISO 3166 enumeration: ${error.message}`
          : "F-Link nationality data is temporarily unavailable. Showing the full ISO 3166 enumeration.",
      };
    }
  } else {
    const items = isoNationalityOptions();
    value = {
      items,
      source: "iso-3166",
      count: items.length,
      fetchedAt: new Date().toISOString(),
      warning: runtime.mode === "mock"
        ? "Local mock mode does not call F-Link. Showing the full ISO 3166 enumeration."
        : "F-Link credentials are not configured. Showing the full ISO 3166 enumeration.",
    };
  }
  nationalityCatalogCache.set(locale, {
    value,
    expiresAt: Date.now() + (value.source === "flink" ? 24 * 60 * 60_000 : 60 * 60_000),
  });
  return res.json(ok(value));
});

app.get("/api/dashboard", (_req, res) => {
  res.json(ok(database.dashboard()));
});

const accountProfileResponse = (req: express.Request) => {
  const profile = database.getAccountProfile(authUserId(req)!);
  return {
    id: profile.id,
    name: profile.name,
    surname: profile.surname,
    givenName: profile.givenName,
    language: profile.language,
    phone: profile.phone,
    email: profile.email,
    avatarUrl: profile.avatarMime
      ? `/api/account/profile/avatar?v=${encodeURIComponent(profile.avatarUpdatedAt || profile.updatedAt)}`
      : undefined,
    avatarUpdatedAt: profile.avatarUpdatedAt,
    updatedAt: profile.updatedAt,
  };
};

app.get("/api/account/profile", (req, res) => res.json(ok(accountProfileResponse(req))));
app.patch("/api/account/profile", (req, res) => {
  const parsed = z.object({
    name: z.string().trim().min(1).max(50),
    surname: z.string().trim().min(1).max(50).optional(),
    givenName: z.string().trim().min(1).max(50).optional(),
    language: z.enum(["zh-CN", "zh-TW", "en"]),
    phone: internationalPhoneSchema,
    email: z.string().email().max(120),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ code: "INVALID_PROFILE", message: "Profile details are invalid" });
  database.updateAccountProfile(parsed.data, authUserId(req)!);
  return res.json(ok(accountProfileResponse(req)));
});
app.put(
  "/api/account/profile/avatar",
  express.raw({ type: ["image/png", "image/jpeg"], limit: "2mb" }),
  (req, res) => {
    const mime = String(req.headers["content-type"] || "").split(";", 1)[0] as "image/png" | "image/jpeg";
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!bytes.length) return res.status(400).json({ code: "AVATAR_EMPTY", message: "Please select an avatar image to upload" });
    const isPng = mime === "image/png"
      && bytes.length >= 8
      && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const isJpeg = mime === "image/jpeg"
      && bytes.length >= 3
      && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if (!isPng && !isJpeg) return res.status(415).json({
      code: "AVATAR_TYPE_INVALID",
      message: "Avatar content is not a valid PNG or JPG image",
    });
    database.saveAccountAvatar(bytes, mime, authUserId(req)!);
    return res.json(ok(accountProfileResponse(req)));
  },
);
app.get("/api/account/profile/avatar", (req, res) => {
  const avatar = database.getAccountAvatar(authUserId(req)!);
  if (!avatar?.avatar_blob || !avatar.avatar_mime) return res.status(404).json({
    code: "AVATAR_NOT_FOUND",
    message: "No avatar has been saved yet",
  });
  res.setHeader("Content-Type", avatar.avatar_mime);
  res.setHeader("Content-Length", String(avatar.avatar_blob.byteLength));
  res.setHeader("Cache-Control", "private, no-store");
  return res.send(Buffer.from(avatar.avatar_blob));
});

const travelerFields = {
  type: z.enum(["adult", "child", "infant"]),
  surname: z.string().trim().regex(/^[A-Za-z][A-Za-z '\-]*$/).max(60),
  givenName: z.string().trim().regex(/^[A-Za-z][A-Za-z '\-]*$/).max(80),
  gender: z.enum(["1", "2"]),
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => value < new Date().toISOString().slice(0, 10)),
  nationality: z.string().trim().toUpperCase().regex(/^[A-Z]{2,3}$/),
  issuingCountry: z.string().trim().toUpperCase().regex(/^[A-Z]{2,3}$/),
  expiration: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => value > new Date().toISOString().slice(0, 10)),
};
const passportNumber = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{5,20}$/);

app.get("/api/account/travelers", (req, res) => res.json(ok(database.listAccountTravelers(authUserId(req)!))));
app.post("/api/account/travelers", (req, res) => {
  const parsed = z.object({ ...travelerFields, documentNo: passportNumber }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({
    code: "INVALID_TRAVELER",
    message: "Frequent traveler or passport information is invalid",
  });
  return res.status(201).json(ok(database.createAccountTraveler(parsed.data, authUserId(req)!)));
});
app.patch("/api/account/travelers/:travelerId", (req, res) => {
  const parsed = z.object({ ...travelerFields, documentNo: passportNumber.optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({
    code: "INVALID_TRAVELER",
    message: "Frequent traveler or passport information is invalid",
  });
  const traveler = database.updateAccountTraveler(req.params.travelerId, parsed.data, authUserId(req)!);
  if (!traveler) return res.status(404).json({ code: "TRAVELER_NOT_FOUND", message: "Frequent traveler not found" });
  return res.json(ok(traveler));
});
app.delete("/api/account/travelers/:travelerId", (req, res) => {
  if (!database.deleteAccountTraveler(req.params.travelerId, authUserId(req)!)) {
    return res.status(404).json({ code: "TRAVELER_NOT_FOUND", message: "Frequent traveler not found" });
  }
  return res.json(ok({ deleted: true as const }));
});

app.get("/api/account/notifications", (req, res) => res.json(ok(database.getNotificationPreferences(authUserId(req)!))));
app.patch("/api/account/notifications", (req, res) => {
  const parsed = z.object({ order: z.boolean(), flight: z.boolean(), marketing: z.boolean() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({
    code: "INVALID_NOTIFICATION_PREFERENCES",
    message: "Notification preferences are invalid",
  });
  return res.json(ok(database.updateNotificationPreferences(parsed.data, authUserId(req)!)));
});

const favoriteHotelSchema = z.object({
  id: z.string().min(1).max(160),
  inventorySource: z.enum(["glink", "simulation"]).optional(),
  name: z.string().min(1).max(200),
  city: z.string().max(100).default(""),
  cityCode: z.string().max(20).optional(),
  district: z.string().max(160).default(""),
  rating: z.number().min(0).max(10).optional(),
  ratingSource: z.string().max(100).optional(),
  stars: z.number().int().min(0).max(5).optional(),
  image: z.string().max(2_000).optional(),
  tags: z.array(z.string().max(80)).max(20).default([]),
  roomName: z.string().max(200).default(""),
  breakfast: z.string().max(300).default(""),
  cancelPolicy: z.string().max(2_000).default(""),
  nightlyPrice: z.number().min(0).default(0),
  currency: z.string().length(3).default("CNY"),
});

app.get("/api/account/hotel-favorites", (req, res) => {
  res.json(ok(database.listFavoriteHotels(authUserId(req)!)));
});
app.post("/api/account/hotel-favorites", (req, res) => {
  const parsed = z.object({ hotel: favoriteHotelSchema }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({
    code: "INVALID_HOTEL_FAVORITE",
    message: "Favorite hotel details are incomplete",
  });
  if (parsed.data.hotel.inventorySource === "simulation"
    || (process.env.NODE_ENV !== "test" && parsed.data.hotel.inventorySource !== "glink")) {
    return res.status(422).json({
      code: "REAL_HOTEL_REQUIRED",
      message: "Only hotels returned by the real G-Link API can be favorited",
    });
  }
  return res.status(201).json(ok(database.addFavoriteHotel(parsed.data.hotel, authUserId(req)!)));
});
app.delete("/api/account/hotel-favorites/:hotelId", (req, res) => {
  if (!database.deleteFavoriteHotel(req.params.hotelId, authUserId(req)!)) {
    return res.status(404).json({ code: "HOTEL_FAVORITE_NOT_FOUND", message: "This hotel has not been favorited" });
  }
  return res.json(ok({ deleted: true as const }));
});

app.get("/api/customers", (_req, res) => res.json(ok(database.listCustomers())));
app.post("/api/customers", (req, res) => {
  const parsed = z.object({
    name: z.string().min(2).max(100),
    contactName: z.string().min(1).max(50),
    contactSurname: z.string().min(1).max(50).optional(),
    contactGivenName: z.string().min(1).max(50).optional(),
    phone: z.string().min(8).max(30),
    email: z.string().email(),
    creditLimit: z.number().min(0).max(100_000_000),
    status: z.enum(["ACTIVE", "SUSPENDED"]).default("ACTIVE"),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({
    code: "INVALID_PARAMS",
    message: parsed.error.issues[0]?.message || "Customer details are incomplete",
  });
  return res.status(201).json(ok(database.createCustomer(parsed.data)));
});
app.patch("/api/customers/:customerId/status", (req, res) => {
  const parsed = z.object({ status: z.enum(["ACTIVE", "SUSPENDED"]) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ code: "INVALID_PARAMS", message: "Customer status is invalid" });
  const customer = database.updateCustomerStatus(req.params.customerId, parsed.data.status);
  if (!customer) return res.status(404).json({ code: "CUSTOMER_NOT_FOUND", message: "Customer not found" });
  return res.json(ok(customer));
});

app.get("/api/pricing-rules", (_req, res) => res.json(ok(database.listPricingRules())));
app.post("/api/pricing-rules", (req, res) => {
  const parsed = z.object({
    name: z.string().min(2).max(100),
    productType: z.enum(["hotel", "flight", "all"]),
    calculationType: z.enum(["percentage", "fixed"]),
    value: z.number().min(0).max(100_000),
    priority: z.number().int().min(1).max(10_000).default(100),
    status: z.enum(["ACTIVE", "INACTIVE"]).default("INACTIVE"),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({
    code: "INVALID_PARAMS",
    message: parsed.error.issues[0]?.message || "Pricing rule is incomplete",
  });
  return res.status(201).json(ok(database.createPricingRule(parsed.data)));
});
app.patch("/api/pricing-rules/:ruleId/status", (req, res) => {
  const parsed = z.object({ status: z.enum(["ACTIVE", "INACTIVE"]) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ code: "INVALID_PARAMS", message: "Rule status is invalid" });
  const rule = database.updatePricingRuleStatus(req.params.ruleId, parsed.data.status);
  if (!rule) return res.status(404).json({ code: "PRICING_RULE_NOT_FOUND", message: "Pricing rule not found" });
  return res.json(ok(rule));
});

app.get("/api/finance/summary", (_req, res) => res.json(ok(database.financeSummary())));

app.post("/api/hotels/search", async (req, res) => {
  const parsed = z.object({
    destination: z.string().min(1),
    checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    rooms: z.number().int().min(1).max(8).default(1),
    adults: z.number().int().min(1).max(16).default(2),
    children: z.number().int().min(0).max(8).default(0),
    childAges: z.array(z.number().int().min(0).max(17)).max(8).default([]),
  }).superRefine((value, context) => {
    if (value.checkIn < applicationDate()) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Check-in date cannot be earlier than today" });
    }
    if (value.checkOut <= value.checkIn) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Check-out date must be later than the check-in date" });
    }
    if (value.adults < value.rooms) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Each room requires at least one adult" });
    }
    if (value.children !== value.childAges.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "The number of child ages must match the number of children" });
    }
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ code: "INVALID_PARAMS", message: "Please fill in the complete search criteria" });
  if (useLocalHotelSimulation) {
    const nights = hotelNightCount(parsed.data.checkIn, parsed.data.checkOut);
    return res.json(ok(database.listHotels(parsed.data.destination).map(offer => {
      const context = {
        checkInDate: parsed.data.checkIn,
        checkOutDate: parsed.data.checkOut,
        roomNum: parsed.data.rooms,
        numberOfAdults: parsed.data.adults,
        numberOfChildren: parsed.data.children,
        childrenAges: parsed.data.childAges,
        nights,
      };
      hotelStayContexts.set(offer.id, context);
      return {
        ...offer,
        ...context,
        nightlyPrice: database.calculateSaleAmount("hotel", offer.nightlyPrice),
        totalPrice: database.calculateSaleAmount("hotel", offer.nightlyPrice * nights * parsed.data.rooms),
      };
    })));
  }
  const result = await searchGlinkHotels(runtime.glink, parsed.data);
  if (!result.diagnostics.saleableHotelCount) return res.status(409).json({
    code: "GLINK_CATALOG_EMPTY",
    message: "The current G-Link sandbox account has no mapped saleable hotels. Please ask the supplier to configure test hotels and inventory first.",
  });
  if (!result.diagnostics.lowestPriceHotelCount) return res.status(409).json({
    code: "GLINK_LOWEST_PRICE_EMPTY",
    message: "Mapped hotels did not return daily lowest prices for the selected check-in date. The hotel list will not be displayed.",
  });
  result.quotes.forEach(quote => hotelQuotes.set(quote.id, quote));
  return res.json(ok(result.offers.map(offer => ({
    ...offer,
    nightlyPrice: database.calculateSaleAmount("hotel", offer.nightlyPrice),
    totalPrice: database.calculateSaleAmount("hotel", offer.totalPrice || offer.nightlyPrice),
  }))));
});

app.post("/api/hotels/destination", async (req, res, next) => {
  const parsed = z.object({ keyword: z.string().min(2) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ code: "INVALID_PARAMS", message: "Keyword must be at least 2 characters" });
  // Destination keyword lookup is a read-only metadata search. When G-Link
  // credentials are available we always call the real supplier, even in mock
  // mode, so the UI can browse the real destination index. The mock list is
  // only a fallback when no credentials are configured.
  if (runtime.glinkConfigured) {
    try {
      const raw = await runtime.glink.glink<unknown>("/search/destination", {
        keyWord: parsed.data.keyword,
        destinationType: "2",
        source: 0,
      });
      const items = Array.isArray(raw) ? raw : [];
      const destinations = items.map((item: any) => ({
        name: item.cityName || item.destinationName || item.name || "",
        detail: [item.countryName, item.provinceName].filter(Boolean).join(" · "),
        destinationId: String(item.destinationId || ""),
        cityCode: String(item.cityCode || ""),
      })).filter(d => d.destinationId);
      return res.json(ok(destinations));
    } catch (error) {
      next(error);
      return;
    }
  }
  const mockDestinations = [
    { name: "London", detail: "United Kingdom · England", destinationId: "GB-LON", cityCode: "LON" },
    { name: "London", detail: "Canada · Ontario", destinationId: "CA-YXU", cityCode: "YXU" },
    { name: "London", detail: "United States of America · Ohio", destinationId: "US-OH-LONDON", cityCode: "US-OH-LONDON" },
    { name: "New London", detail: "United States of America · Minnesota", destinationId: "US-MN-NEW-LONDON", cityCode: "US-MN-NEW-LONDON" },
    { name: "New London", detail: "United States of America · North Carolina", destinationId: "US-NC-NEW-LONDON", cityCode: "US-NC-NEW-LONDON" },
    { name: "East London", detail: "South Africa · Eastern Cape", destinationId: "ZA-ELS", cityCode: "ELS" },
    { name: "Little London", detail: "Jamaica · Westmoreland", destinationId: "JM-LITTLE-LONDON", cityCode: "JM-LITTLE-LONDON" },
    { name: "London Colney", detail: "England · St Albans", destinationId: "GB-LONDON-COLNEY", cityCode: "GB-LONDON-COLNEY" },
    { name: "Shanghai", detail: "China · Business & Leisure", destinationId: "SHA", cityCode: "SHA" },
    { name: "Hong Kong", detail: "Hong Kong, China · Harbor City", destinationId: "HKG", cityCode: "HKG" },
    { name: "Beijing", detail: "China · Historic Capital", destinationId: "BJS", cityCode: "BJS" },
    { name: "Shenzhen", detail: "China · Greater Bay Area", destinationId: "SZX", cityCode: "SZX" },
    { name: "Bangkok", detail: "Thailand · Popular International Destination", destinationId: "BKK", cityCode: "BKK" },
  ];
  const normalized = parsed.data.keyword.trim().toLowerCase();
  const filtered = mockDestinations.filter(d => `${d.name}${d.detail}`.toLowerCase().includes(normalized));
  return res.json(ok(filtered));
});

app.post("/api/hotels/by-id", async (req, res, next) => {
  const parsed = z.object({ hotelId: z.string().min(1), hotelName: z.string().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ code: "INVALID_PARAMS", message: "Missing hotel identifier" });
  if (useLocalHotelSimulation) {
    const hotels = database.listHotels(parsed.data.hotelName || parsed.data.hotelId);
    const hotel = hotels.find(h => h.id === parsed.data.hotelId) || hotels[0];
    if (!hotel) throw new Error("Hotel not found");
    return res.json(ok(hotel));
  }
  try {
    const detailRaw = await runtime.glink.glink<unknown>("/hotel/detail", {
      hotelIds: [parsed.data.hotelId],
      language: "zh-CN",
      settings: { isNeedStaticInfo: true },
    });
    const detailItem = Array.isArray(detailRaw) ? detailRaw[0] : (detailRaw as any)?.hotelList?.[0] || (detailRaw as any);
    if (!detailItem) throw new Error("Hotel not found by supplier");
    const hotelOffer = {
      id: parsed.data.hotelId,
      name: detailItem.hotelName || parsed.data.hotelName || "Unknown Hotel",
      city: detailItem.cityName || "",
      cityCode: detailItem.cityCode || "",
      district: detailItem.districtName || detailItem.businessDistrictName || "",
      rating: detailItem.starRating ? Number(detailItem.starRating) : undefined,
      stars: detailItem.starRating ? Math.round(Number(detailItem.starRating)) : undefined,
      image: detailItem.imageUrl || (Array.isArray(detailItem.images) ? detailItem.images[0]?.url : undefined),
      tags: [],
      roomName: "",
      breakfast: "",
      cancelPolicy: "",
      nightlyPrice: 0,
      currency: "CNY",
    };
    return res.json(ok(hotelOffer));
  } catch (error) {
    next(error);
  }
});

app.post("/api/hotels/filters", async (req, res) => {
  const parsed = z.object({ destinationId: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ code: "INVALID_PARAMS", message: "Missing destination identifier" });
  if (useLocalHotelSimulation) return res.json(ok({ stars: [3, 4, 5], facilities: ["Free Wi-Fi", "Parking", "Fitness Center"] }));
  const filters = await runtime.glink.glink<unknown>("/search/hotelFilters", { destinationId: parsed.data.destinationId, language: "zh-CN", distance: 10 });
  return res.json(ok(filters));
});

app.post("/api/integration/glink/hotel-increment", async (req, res) => {
  const parsed = z.object({ startTime: z.string().min(1), endTime: z.string().min(1), maxId: z.number().int().min(0).default(0), pageSize: z.number().int().min(100).max(1000).default(100) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ code: "INVALID_PARAMS", message: "Incremental sync time range is invalid" });
  if (runtime.mode === "mock") return res.json(ok({ list: [], maxId: parsed.data.maxId }));
  const changes = await runtime.glink.glink<unknown>("/hotel/increment", { ...parsed.data, language: "zh-CN" });
  return res.json(ok(changes));
});

app.post("/api/integration/glink/lowest-prices", async (req, res) => {
  const parsed = z.object({
    hotelIds: z.array(z.number().int().positive()).min(1).max(10),
    checkInDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    checkOutDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({
    code: "INVALID_PARAMS",
    message: "hotelIds allows up to 10 entries, and check-in/check-out dates must be in yyyy-MM-dd format",
  });
  if (runtime.mode === "mock") return res.status(409).json({
    code: "REAL_INTEGRATION_REQUIRED",
    message: "Currently in mock mode. Cannot call G-Link daily lowest prices.",
  });
  const result = await queryGlinkLowestPrices(runtime.glink, parsed.data);
  return res.json(ok({
    currency: result.currency,
    hotelLowestPrices: [...result.prices.entries()].map(([hotelId, lowestPrice]) => ({
      hotelId,
      lowestPrice,
    })),
  }));
});

app.post("/api/hotels/product-details", async (req, res) => {
  const parsed = z.object({ offerId: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ code: "INVALID_PARAMS", message: "Missing hotel quote identifier" });
  if (useLocalHotelSimulation) {
    const offer = database.findHotel(parsed.data.offerId);
    if (!offer) return res.status(404).json({ code: "OFFER_NOT_FOUND", message: "Hotel quote has expired" });
    return res.json(ok([{
      ...offer,
      ...hotelStayContexts.get(offer.id),
      nightlyPrice: database.calculateSaleAmount("hotel", offer.nightlyPrice),
      totalPrice: database.calculateSaleAmount(
        "hotel",
        offer.nightlyPrice
          * (hotelStayContexts.get(offer.id)?.nights || 2)
          * (hotelStayContexts.get(offer.id)?.roomNum || 1),
      ),
    }]));
  }
  const quote = hotelQuotes.get(parsed.data.offerId);
  if (!quote) return res.status(410).json({ code: "QUOTE_EXPIRED", message: "Hotel search session has expired. Please search again." });
  try {
    const hydratedProducts = await hydrateGlinkProducts(runtime.glink, quote);
    hydratedProducts.forEach(product => hotelQuotes.set(product.quote.id, product.quote));
    return res.json(ok(hydratedProducts.map(({ offer }) => ({
      ...offer,
      nightlyPrice: database.calculateSaleAmount("hotel", offer.nightlyPrice),
      totalPrice: database.calculateSaleAmount("hotel", offer.totalPrice || offer.nightlyPrice),
    }))));
  } catch (error) {
    if (sandboxHotelSimulationEnabled && error instanceof GlinkNoProductError) {
      return res.json(ok([simulatedHotelOffer(quote)]));
    }
    throw error;
  }
});

app.post("/api/hotels/availability", async (req, res) => {
  const parsed = z.object({ offerId: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ code: "INVALID_PARAMS", message: "Missing room quote identifier" });
  const simulatedOffer = simulatedHotelOffers.get(parsed.data.offerId);
  if (simulatedOffer) {
    const amount = database.calculateSaleAmount("hotel", simulatedOffer.totalPrice || simulatedOffer.nightlyPrice);
    const session = database.saveHotelAvailability(simulatedOffer, amount);
    return res.json(ok({
      available: true as const,
      simulated: true as const,
      checkedAt: session.verifiedAt,
      expiresAt: session.expiresAt,
      price: amount,
      currency: simulatedOffer.currency,
      checkInDate: simulatedOffer.checkInDate,
      checkOutDate: simulatedOffer.checkOutDate,
      roomNum: simulatedOffer.roomNum,
      numberOfAdults: simulatedOffer.numberOfAdults,
      nights: simulatedOffer.nights,
    }));
  }
  if (useLocalHotelSimulation) {
    const hotel = database.findHotel(parsed.data.offerId);
    if (!hotel) return res.status(404).json({ code: "OFFER_NOT_FOUND", message: "Room quote has expired. Please search again." });
    const context = hotelStayContexts.get(hotel.id) || {
      checkInDate: "2026-08-12",
      checkOutDate: "2026-08-14",
      roomNum: 1,
      numberOfAdults: 2,
      nights: 2,
    };
    const amount = database.calculateSaleAmount("hotel", hotel.nightlyPrice * context.nights * context.roomNum);
    const session = database.saveHotelAvailability({ ...hotel, ...context }, amount);
    return res.json(ok({
      available: true as const,
      checkedAt: session.verifiedAt,
      expiresAt: session.expiresAt,
      price: amount,
      currency: hotel.currency,
      ...context,
    }));
  }
  const quote = hotelQuotes.get(parsed.data.offerId);
  if (!quote) return res.status(410).json({ code: "QUOTE_EXPIRED", message: "Room quote has expired. Please re-enter the hotel details." });
  const availability = await checkGlinkAvailability(runtime.glink, quote);
  const synchronizedQuote = synchronizeHotelQuoteFromAvailability(quote, availability);
  hotelQuotes.set(parsed.data.offerId, synchronizedQuote);
  const supplierAmount = fcgValue.number(availability.totalSalePrice);
  if (supplierAmount <= 0) throw new FcgError("G-Link availability check did not return a valid total price", "GLINK_INVALID_AVAILABILITY_PRICE", 422);
  const amount = database.calculateSaleAmount("hotel", supplierAmount);
  const session = database.saveGlinkHotelAvailability({
    offerId: parsed.data.offerId,
    roomNum: quote.roomNum,
    amount,
    currency: quote.currency,
    payload: availability,
  });
  return res.json(ok({
    available: true as const,
    checkedAt: session.verifiedAt,
    expiresAt: session.expiresAt,
    price: amount,
    currency: quote.currency,
    checkInDate: quote.checkInDate,
    checkOutDate: quote.checkOutDate,
    roomNum: quote.roomNum,
    numberOfAdults: quote.numberOfAdults,
    numberOfChildren: quote.numberOfChildren || 0,
    childrenAges: quote.childrenAges || [],
    nights: hotelNightCount(quote.checkInDate, quote.checkOutDate),
    ...(synchronizedQuote.bedTypeDescription ? { bedTypeDescription: synchronizedQuote.bedTypeDescription } : {}),
    ...(synchronizedQuote.nonRefundable !== undefined ? { nonRefundable: synchronizedQuote.nonRefundable } : {}),
    ...(synchronizedQuote.cancelRestrictionType !== undefined ? { cancelRestrictionType: synchronizedQuote.cancelRestrictionType } : {}),
    ...(synchronizedQuote.cancelPolicy ? { cancelPolicy: synchronizedQuote.cancelPolicy } : {}),
    ...(synchronizedQuote.checkInInstructions ? { checkInInstructions: synchronizedQuote.checkInInstructions } : {}),
    ...(synchronizedQuote.specialCheckInInstructions?.length ? { specialCheckInInstructions: synchronizedQuote.specialCheckInInstructions } : {}),
    payAtHotel: synchronizedQuote.payAtHotelFlag === 1,
    paymentTiming: synchronizedQuote.payAtHotelFlag === 1
      ? "Collected by the hotel from the traveler at check-in or check-out"
      : "Paid via the FusionGo enterprise credit account after order submission",
    paymentProcessor: synchronizedQuote.payAtHotelFlag === 1 ? "Booking Hotel" : "FusionGo Enterprise Credit",
    paymentProcessingLocation: synchronizedQuote.payAtHotelFlag === 1
      ? "Hotel location"
      : "Not applicable: this order is not an Expedia Group MoR",
    ...(synchronizedQuote.priceBreakdown ? { priceBreakdown: {
      ...synchronizedQuote.priceBreakdown,
      total: amount,
      serviceFee: Math.max(0, amount - supplierAmount),
    } } : {}),
  }));
});

app.post("/api/flights/search", async (req, res) => {
  const parsed = z.object({
    from: z.string().trim().min(3),
    to: z.string().trim().min(3),
    departureDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    adults: z.number().int().min(1).max(9).default(1),
    children: z.number().int().min(0).max(8).default(0),
    infants: z.number().int().min(0).max(8).default(0),
    tripType: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
    journeys: z.array(z.object({
      origin: z.string().min(3),
      destination: z.string().min(3),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    })).min(1).max(4).optional(),
  }).superRefine((value, context) => {
    const journeys = value.journeys || [{ origin: value.from, destination: value.to, date: value.departureDate }];
    const count = journeys.length;
    if (value.from.trim().toUpperCase() === value.to.trim().toUpperCase()
      || journeys.some(journey => journey.origin.trim().toUpperCase() === journey.destination.trim().toUpperCase())) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Origin and destination cannot be the same" });
    }
    if (journeys.some(journey => journey.date < applicationDate())) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Flight date cannot be earlier than today" });
    }
    if (value.tripType === 2 && count !== 2) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Round-trip itineraries must include both outbound and return segments" });
    }
    if (value.tripType === 3 && count < 2) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Multi-city itineraries must include at least two segments" });
    }
    if (journeys.some((journey, index) => index > 0 && journey.date < journeys[index - 1].date)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Subsequent segment dates cannot be earlier than the previous segment" });
    }
    if (value.adults + value.children + value.infants > 9) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Total travelers per booking cannot exceed 9" });
    }
    if (value.infants > value.adults) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Each adult may accompany at most one infant" });
    }
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ code: "INVALID_PARAMS", message: "Please fill in the complete flight criteria" });
  if (runtime.mode === "mock") return res.json(ok(database.listFlights().map(offer => ({
    ...offer,
    price: database.calculateSaleAmount("flight", offer.price),
    totalPrice: database.calculateSaleAmount("flight", offer.totalPrice || offer.price * parsed.data.adults),
  }))));
  const result = await searchFlinkFlights(runtime.flink, parsed.data);
  result.quotes.forEach(quote => flightQuotes.set(quote.id, quote));
  return res.json(ok(result.offers.map(offer => ({
    ...offer,
    price: database.calculateSaleAmount("flight", offer.price),
    totalPrice: database.calculateSaleAmount("flight", offer.totalPrice || offer.price * parsed.data.adults),
  }))));
});

app.post("/api/flights/verify", async (req, res) => {
  const parsed = z.object({ offerId: z.string().min(1), priceKey: z.string().min(1), quantity: z.number().int().min(1).max(9) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ code: "INVALID_PARAMS", message: "Verification parameters are incomplete" });
  if (runtime.mode === "mock") {
    const flight = database.findFlight(parsed.data.offerId);
    if (!flight || flight.priceKey !== parsed.data.priceKey) return res.status(409).json({ code: "PRICE_KEY_EXPIRED", message: "Fare has changed. Please search again." });
    const verified = database.saveFlightVerification(
      flight,
      parsed.data.quantity,
      database.calculateSaleAmount("flight", flight.price * parsed.data.quantity),
    );
    return res.json(ok({
      verified: true as const,
      priceKey: flight.priceKey,
      totalAmount: verified.amount,
      currency: verified.currency,
      expiresAt: verified.expiresAt,
    }));
  }
  const quote = flightQuotes.get(parsed.data.offerId);
  if (!quote || quote.priceKey !== parsed.data.priceKey) return res.status(410).json({ code: "PRICE_KEY_EXPIRED", message: "priceKey has expired. Please search again." });
  let verified;
  try {
    verified = await verifyFlinkFlight(runtime.flink, quote);
  } catch (error) {
    const priceChanged = error instanceof FcgError
      && error.code === "SUPPLIER_BIZ_ERROR"
      && /price has been updated|price.+updated/i.test(error.message);
    if (!priceChanged) throw error;
    const refreshed = await refreshFlinkCabin(runtime.flink, quote);
    let latestError: unknown;
    for (const candidate of refreshed.quotes.slice(0, 20)) {
      try {
        verified = await verifyFlinkFlight(runtime.flink, candidate);
        break;
      } catch (candidateError) {
        latestError = candidateError;
      }
    }
    if (!verified) throw latestError || error;
  }
  flightQuotes.set(quote.id, verified.quote);
  return res.json(ok({
    verified: true as const,
    priceKey: verified.quote.priceKey,
    totalAmount: database.calculateSaleAmount("flight", verified.quote.totalAmount),
    currency: verified.quote.currency,
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  }));
});

const glinkEnglishName = z.string().trim().min(1).regex(
  /^[A-Za-z]+(?: [A-Za-z]+)*$/,
  "Hotel guest English name may only contain letters and spaces",
);
const hotelOrderSchema = z.object({
  productType: z.literal("hotel"),
  offerId: z.string(),
  customerId: z.string().default("CUS-001"),
  guest: z.object({ firstName: glinkEnglishName, lastName: glinkEnglishName }).optional(),
  guests: z.array(z.object({
    roomIndex: z.number().int().min(1).max(8),
    firstName: glinkEnglishName,
    lastName: glinkEnglishName,
  })).min(1).max(8).optional(),
  contact: z.object({ name: z.string().min(1), surname: z.string().min(1).optional(), givenName: z.string().min(1).optional(), phone: z.string().min(8), email: z.string().email() }),
  arriveTime: z.string().regex(/^\d{2}:\d{2}$/),
  latestArriveTime: z.string().regex(/^\d{2}:\d{2}$/),
});
const flightOrderSchema = z.object({
  productType: z.literal("flight"),
  offerId: z.string(),
  customerId: z.string().default("CUS-001"),
  quantity: z.number().int().min(1).max(9).optional(),
  contact: z.object({ name: z.string().min(1), surname: z.string().min(1).optional(), givenName: z.string().min(1).optional(), phone: z.string().min(8), email: z.string().email() }),
  passengers: z.array(z.object({
    surname: z.string().min(1),
    name: z.string().min(1),
    nationality: z.string().length(2),
    gender: z.enum(["1", "2"]),
    idType: z.string().min(1),
    idNumber: z.string().min(5),
    birthday: z.string().min(8),
    expiration: z.string().min(8),
    type: z.enum(["adult", "child", "infant"]).default("adult"),
    adultPassengerName: z.string().optional(),
  })).min(1).max(9),
  addOns: z.object({
    baggage: z.boolean(),
    seat: z.boolean(),
    insurance: z.boolean(),
  }),
  paymentMethod: z.enum(["credit", "card"]),
});

const orderSchema = z.discriminatedUnion("productType", [hotelOrderSchema, flightOrderSchema]);

app.get("/api/orders", (req, res) => {
  const userId = authUserId(req);
  if (!userId) return res.status(401).json({ code: "AUTH_REQUIRED", message: "Authentication required" });
  return res.json(ok(database.listOrders(userId)));
});
app.get("/api/orders/:orderId", (req, res) => {
  const userId = authUserId(req);
  if (!userId) return res.status(401).json({ code: "AUTH_REQUIRED", message: "Authentication required" });
  const order = findOrder(req.params.orderId, userId);
  if (!order) return res.status(404).json({ code: "ORDER_NOT_FOUND", message: "Order not found" });
  return res.json(ok(order));
});
app.get("/api/orders/:orderId/details", (req, res) => {
  const userId = authUserId(req);
  if (!userId) return res.status(401).json({ code: "AUTH_REQUIRED", message: "Authentication required" });
  const order = findOrder(req.params.orderId, userId);
  if (!order) return res.status(404).json({ code: "ORDER_NOT_FOUND", message: "Order not found" });
  const snapshots = database.getOrderSnapshots(order.id, userId);
  const contactSnapshot = fcgValue.record(snapshots?.contact);
  const contact = fcgValue.record(contactSnapshot.contact);
  const passengers = fcgValue.array(contactSnapshot.passengers).map(fcgValue.record);
  const guest = fcgValue.record(contactSnapshot.guest);
  const guests = fcgValue.array(contactSnapshot.guests).map(fcgValue.record);
  const productSnapshot = fcgValue.record(snapshots?.product);
  const snapshotPositiveNumber = (value: unknown) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  };
  const checkInDate = fcgValue.string(productSnapshot.checkInDate);
  const checkOutDate = fcgValue.string(productSnapshot.checkOutDate);
  const derivedNights = checkInDate && checkOutDate
    ? Math.round((Date.parse(`${checkOutDate}T00:00:00Z`) - Date.parse(`${checkInDate}T00:00:00Z`)) / 86_400_000)
    : undefined;
  const nights = snapshotPositiveNumber(productSnapshot.nights)
    || (derivedNights && derivedNights > 0 ? derivedNights : undefined);
  const roomNum = snapshotPositiveNumber(productSnapshot.roomNum);
  const numberOfAdults = snapshotPositiveNumber(productSnapshot.numberOfAdults);
  const passenger = passengers[0] || {};
  const rawDocument = fcgValue.string(passenger.idNumber);
  const documentMasked = rawDocument
    ? `${rawDocument.slice(0, Math.min(2, rawDocument.length))}${"*".repeat(Math.max(3, rawDocument.length - 4))}${rawDocument.slice(-2)}`
    : undefined;
  return res.json(ok({
    travelerName: order.productType === "flight"
      ? [fcgValue.string(passenger.surname), fcgValue.string(passenger.name)].filter(Boolean).join("/")
      : [fcgValue.string(guest.lastName), fcgValue.string(guest.firstName)].filter(Boolean).join(" "),
    contactName: fcgValue.string(contact.name),
    contactSurname: fcgValue.string(contact.surname) || undefined,
    contactGivenName: fcgValue.string(contact.givenName) || undefined,
    email: fcgValue.string(contact.email),
    phone: fcgValue.string(contact.phone),
    documentMasked,
    serviceSummary: order.productType === "flight"
      ? (passengers.length ? `${passengers.length} passenger(s)` : "Upstream did not return passenger count")
      : [roomNum ? `${roomNum} room(s)` : "", nights ? `${nights} night(s)` : "", numberOfAdults ? `${numberOfAdults} adult(s)` : ""]
        .filter(Boolean).join(" · ") || "Upstream did not return complete stay information",
    roomName: fcgValue.string(productSnapshot.roomName) || undefined,
    breakfast: fcgValue.string(productSnapshot.breakfast) || undefined,
    cancelPolicy: fcgValue.string(productSnapshot.cancelPolicy) || undefined,
    bedTypeDescription: fcgValue.string(productSnapshot.bedTypeDescription) || undefined,
    ...(productSnapshot.nonRefundable !== undefined ? { nonRefundable: Boolean(productSnapshot.nonRefundable) } : {}),
    checkInInstructions: fcgValue.string(productSnapshot.checkInInstructions) || undefined,
    specialCheckInInstructions: fcgValue.array(productSnapshot.specialCheckInInstructions)
      .map(value => fcgValue.string(value)).filter(Boolean),
    payAtHotel: fcgValue.number(productSnapshot.payAtHotelFlag) === 1,
    paymentTiming: fcgValue.number(productSnapshot.payAtHotelFlag) === 1
      ? "Collected by the hotel from the traveler at check-in or check-out"
      : "Paid via the FusionGo enterprise credit account after order submission",
    paymentProcessor: fcgValue.number(productSnapshot.payAtHotelFlag) === 1 ? "Booking Hotel" : "FusionGo Enterprise Credit",
    paymentProcessingLocation: fcgValue.number(productSnapshot.payAtHotelFlag) === 1
      ? "Hotel location"
      : "Not applicable: this order is not an Expedia Group MoR",
    priceBreakdown: Object.keys(fcgValue.record(productSnapshot.priceBreakdown)).length
      ? fcgValue.record(productSnapshot.priceBreakdown)
      : undefined,
    cabin: fcgValue.string(productSnapshot.cabin) || undefined,
    baggage: fcgValue.string(productSnapshot.baggage) || undefined,
    ...(order.productType === "hotel" ? {
      hotelStay: {
        checkInDate,
        checkOutDate,
        nights,
        roomNum,
        numberOfAdults,
        numberOfChildren: fcgValue.number(productSnapshot.numberOfChildren),
        childrenAges: fcgValue.array(productSnapshot.childrenAges).map(value => fcgValue.number(value)),
        guests: (guests.length ? guests : [guest]).map(item => ({
          roomIndex: fcgValue.number(item.roomIndex, 1),
          name: [fcgValue.string(item.lastName), fcgValue.string(item.firstName)].filter(Boolean).join(" "),
        })),
      },
    } : {}),
  }));
});
app.get("/api/orders/:orderId/documents/:type", async (req, res, next) => {
  if (req.params.type === "email-preview") return next();
  const userId = authUserId(req);
  if (!userId) return res.status(401).json({ code: "AUTH_REQUIRED", message: "Authentication required" });
  const order = findOrder(req.params.orderId, userId);
  if (!order) return res.status(404).json({ code: "ORDER_NOT_FOUND", message: "Order not found" });
  const type = z.enum(["confirmation", "receipt", "ticket"]).safeParse(req.params.type);
  if (!type.success) return res.status(404).json({ code: "DOCUMENT_NOT_FOUND", message: "Document type not found" });
  if (type.data === "ticket" && (order.productType !== "flight" || order.status !== "TICKETED")) {
    return res.status(409).json({ code: "TICKET_NOT_READY", message: "The airline has not issued the ticket yet. The e-ticket is not available for download." });
  }
  if (type.data === "confirmation" && !["CONFIRMED", "TICKETED"].includes(order.status)) {
    return res.status(409).json({ code: "CONFIRMATION_NOT_READY", message: "The order has not been confirmed yet. The e-voucher is not available for download." });
  }
  try {
    const pdf = await createOrderDocumentPdf({
      order,
      type: type.data,
      snapshots: database.getOrderSnapshots(order.id, userId),
    });
    const documentName = type.data === "ticket" ? "ticket" : type.data === "receipt" ? "receipt" : "confirmation";
    const asciiFilename = `${order.id}-${documentName}.pdf`;
    const localizedFilename = `${order.id}-${type.data === "ticket" ? "e-ticket" : type.data === "receipt" ? "e-receipt" : "booking-confirmation"}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", String(pdf.length));
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(localizedFilename)}`);
    return res.send(pdf);
  } catch (error) {
    return res.status(503).json({
      code: "DOCUMENT_RENDER_FAILED",
      message: error instanceof Error ? error.message : "E-voucher generation failed",
    });
  }
});
app.get("/api/orders/:orderId/documents/email-preview", (req, res) => {
  const userId = authUserId(req);
  if (!userId) return res.status(401).json({ code: "AUTH_REQUIRED", message: "Authentication required" });
  const order = findOrder(req.params.orderId, userId);
  if (!order) return res.status(404).json({ code: "ORDER_NOT_FOUND", message: "Order not found" });
  if (order.productType !== "hotel") return res.status(409).json({ code: "HOTEL_EMAIL_ONLY", message: "This template is only for hotel confirmation emails" });
  if (order.status !== "CONFIRMED") return res.status(409).json({ code: "CONFIRMATION_NOT_READY", message: "The order has not been confirmed yet. The confirmation email is not available." });
  const html = createHotelConfirmationEmailHtml({
    order,
    snapshots: database.getOrderSnapshots(order.id, userId),
    publicAppUrl: process.env.PUBLIC_APP_URL,
    supportEmail: process.env.CUSTOMER_SUPPORT_EMAIL,
    supportPhone: process.env.CUSTOMER_SUPPORT_PHONE,
    supportUrl: process.env.CUSTOMER_SUPPORT_URL,
  });
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src data: https:; base-uri 'none'; frame-ancestors 'none'");
  return res.send(html);
});
app.get("/api/orders/:orderId/history", (req, res) => {
  const userId = authUserId(req);
  if (!userId) return res.status(401).json({ code: "AUTH_REQUIRED", message: "Authentication required" });
  const order = findOrder(req.params.orderId, userId);
  if (!order) return res.status(404).json({ code: "ORDER_NOT_FOUND", message: "Order not found" });
  return res.json(ok(database.listOrderEvents(order.id)));
});

app.post("/api/orders", async (req, res) => {
  const userId = authUserId(req);
  if (!userId) return res.status(401).json({ code: "AUTH_REQUIRED", message: "Authentication required" });
  const idempotencyKey = fcgValue.string(req.headers["idempotency-key"]).trim();
  if (idempotencyKey.length > 160) return res.status(400).json({
    code: "INVALID_IDEMPOTENCY_KEY",
    message: "Idempotency-Key must not exceed 160 characters",
  });
  if (idempotencyKey) {
    const replayed = database.getIdempotentOrder("CREATE_ORDER", idempotencyKey);
    if (replayed) {
      res.setHeader("Idempotency-Replayed", "true");
      return res.status(200).json(ok(replayed));
    }
  }
  const createdResponse = (order: DistributionOrder) => {
    if (idempotencyKey) database.saveIdempotency("CREATE_ORDER", idempotencyKey, order.id);
    return res.status(201).json(ok(order));
  };
  const parsed = orderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({
    code: "INVALID_PARAMS",
    message: parsed.error.issues[0]?.message || "Order parameters are incomplete",
  });
  const customer = database.findCustomer(parsed.data.customerId);
  if (!customer) return res.status(404).json({
    code: "CUSTOMER_NOT_FOUND",
    message: "Booking customer not found",
  });
  if (customer.status !== "ACTIVE") return res.status(409).json({
    code: "CUSTOMER_SUSPENDED",
    message: "This customer is suspended and cannot create new orders",
  });

  const hotelGuests = parsed.data.productType === "hotel"
    ? parsed.data.guests?.length
      ? parsed.data.guests
      : parsed.data.guest
        ? [{ roomIndex: 1, ...parsed.data.guest }]
        : []
    : [];
  if (parsed.data.productType === "hotel" && !hotelGuests.length) {
    return res.status(400).json({ code: "INVALID_PARAMS", message: "Please provide at least one guest per room" });
  }
  const validateHotelGuests = (roomNum: number) => {
    const roomIndexes = hotelGuests.map(guest => guest.roomIndex);
    return hotelGuests.length === roomNum
      && new Set(roomIndexes).size === roomNum
      && roomIndexes.every(index => index >= 1 && index <= roomNum);
  };

  if (parsed.success && parsed.data.productType === "hotel") {
    const hotel = simulatedHotelOffers.get(parsed.data.offerId);
    if (hotel) {
      const roomNum = hotel.roomNum || 1;
      if (!validateHotelGuests(roomNum)) return res.status(400).json({
        code: "HOTEL_GUEST_ROOM_MISMATCH",
        message: `This booking includes ${roomNum} room(s). Please provide a primary guest for each room.`,
      });
      const availability = database.getHotelAvailability(hotel.id);
      if (!availability) return res.status(409).json({
        code: "AVAILABILITY_CHECK_REQUIRED",
        message: "Please run the simulated availability check first. The result is valid for 15 minutes.",
      });
      const order: DistributionOrder = {
        id: localOrderId(),
        productType: "hotel",
        title: hotel.name,
        subtitle: `${hotel.checkInDate || ""} to ${hotel.checkOutDate || ""} · ${roomNum} room(s) · ${hotel.nights || 2} night(s)`,
        customer: customer.name,
        amount: availability.amount,
        currency: availability.currency,
        status: "PENDING_PAYMENT",
        createdAt: "just now",
      };
      const persisted = database.insertOrder({
        order,
        supplier: "GLINK",
        bridgeKey: hotel.id,
        userId,
        upstream: {
          productType: "hotel",
          simulated: true,
          amount: order.amount,
          currency: order.currency,
        },
        productSnapshot: hotel,
        contactSnapshot: {
          guest: hotelGuests[0],
          guests: hotelGuests,
          contact: parsed.data.contact,
          arriveTime: parsed.data.arriveTime,
          latestArriveTime: parsed.data.latestArriveTime,
        },
      });
      return createdResponse(persisted);
    }
  }

  if (useLocalHotelSimulation && parsed.data.productType === "hotel") {
      const hotel = database.findHotel(parsed.data.offerId);
      if (!hotel) return res.status(404).json({ code: "OFFER_NOT_FOUND", message: "Hotel quote has expired. Please search again." });
      const availability = database.getHotelAvailability(hotel.id);
      if (!availability) return res.status(409).json({
        code: "AVAILABILITY_CHECK_REQUIRED",
        message: "Please run the hotel availability check first. The result is valid for 15 minutes.",
      });
      const stayContext = hotelStayContexts.get(hotel.id) || {
        checkInDate: "2026-08-12",
        checkOutDate: "2026-08-14",
        roomNum: 1,
        numberOfAdults: 2,
        nights: 2,
      };
      if (!validateHotelGuests(stayContext.roomNum)) return res.status(400).json({
        code: "HOTEL_GUEST_ROOM_MISMATCH",
        message: `This booking includes ${stayContext.roomNum} room(s). Please provide a primary guest for each room.`,
      });
      const order: DistributionOrder = {
        id: localOrderId(),
        productType: "hotel",
        title: hotel.name,
        subtitle: `${stayContext.checkInDate} to ${stayContext.checkOutDate} · ${stayContext.roomNum} room(s) · ${stayContext.nights} night(s)`,
        customer: customer.name,
        amount: availability.amount,
        currency: availability.currency,
        status: "PENDING_PAYMENT",
        createdAt: "just now",
      };
      const persisted = database.insertOrder({
        order,
        supplier: "GLINK",
        bridgeKey: hotel.id,
        userId,
        upstream: {
          productType: "hotel",
          amount: order.amount,
          currency: order.currency,
        },
        productSnapshot: { ...hotel, ...stayContext },
        contactSnapshot: {
          guest: hotelGuests[0],
          guests: hotelGuests,
          contact: parsed.data.contact,
          arriveTime: parsed.data.arriveTime,
          latestArriveTime: parsed.data.latestArriveTime,
        },
      });
      return createdResponse(persisted);
  }

  if (runtime.mode === "mock" && parsed.data.productType === "flight") {
    const flight = database.findFlight(parsed.data.offerId);
    if (!flight) return res.status(404).json({ code: "OFFER_NOT_FOUND", message: "Flight quote has expired. Please search again." });
    const verification = database.getFlightVerification(flight.id, flight.priceKey);
    if (!verification) return res.status(409).json({
      code: "VERIFY_REQUIRED",
      message: "Please run the F-Link real-time price verification first. The priceKey is valid for 15 minutes.",
    });
    if (parsed.data.passengers.length !== verification.quantity) return res.status(400).json({
      code: "PASSENGER_COUNT_MISMATCH",
      message: "Passenger count does not match the verified count",
    });
    const order: DistributionOrder = {
      id: localOrderId(),
      productType: "flight",
      title: `${flight.departureAirport.split(" ")[0]} → ${flight.arrivalAirport.split(" ")[0]}`,
      subtitle: `${flight.flightNo} · Aug 12`,
      customer: customer.name,
      amount: verification.amount + addOnAmount(parsed.data.addOns),
      currency: verification.currency,
      status: "PENDING_PAYMENT",
      createdAt: "just now",
    };
    const persisted = database.insertOrder({
      order,
      supplier: "FLINK",
      bridgeKey: flight.priceKey,
      userId,
      upstream: {
        productType: "flight",
        supplierAmount: verification.amount,
        addOnAmount: addOnAmount(parsed.data.addOns),
        amount: verification.amount,
        currency: order.currency,
      },
      productSnapshot: flight,
      contactSnapshot: {
        contact: parsed.data.contact,
        passengers: parsed.data.passengers,
        addOns: parsed.data.addOns,
        paymentMethod: parsed.data.paymentMethod,
      },
    });
    return createdResponse(persisted);
  }

  if (parsed.data.productType === "hotel") {
    let quote = hotelQuotes.get(parsed.data.offerId);
    if (!quote) return res.status(410).json({ code: "QUOTE_EXPIRED", message: "Hotel quote has expired. Please re-run the availability check." });
    if (!validateHotelGuests(quote.roomNum)) return res.status(400).json({
      code: "HOTEL_GUEST_ROOM_MISMATCH",
      message: `This booking includes ${quote.roomNum} room(s). Please provide a primary guest for each room.`,
    });
    const firstAvailability = database.getHotelAvailability(parsed.data.offerId);
    if (!firstAvailability || firstAvailability.quantity !== quote.roomNum) {
      return res.status(409).json({
        code: "AVAILABILITY_CHECK_REQUIRED",
        message: "A G-Link real-time availability check must be completed before creating an order, and the number of rooms must match.",
      });
    }
    // Mandatory second availability check immediately before creating the supplier order.
    const availability = await checkGlinkAvailability(runtime.glink, quote);
    quote = synchronizeHotelQuoteFromAvailability(quote, availability);
    hotelQuotes.set(parsed.data.offerId, quote);
    const currentSupplierAmount = fcgValue.number(availability.totalSalePrice);
    if (currentSupplierAmount <= 0) throw new FcgError(
      "G-Link second availability check did not return a valid total price",
      "GLINK_INVALID_AVAILABILITY_PRICE",
      422,
    );
    const previousSupplierAmount = fcgValue.number(
      fcgValue.record(firstAvailability.payload).totalSalePrice,
      firstAvailability.amount,
    );
    if (Math.abs(currentSupplierAmount - previousSupplierAmount) > 0.01) {
      const currentSaleAmount = database.calculateSaleAmount("hotel", currentSupplierAmount);
      database.saveGlinkHotelAvailability({
        offerId: parsed.data.offerId,
        roomNum: quote.roomNum,
        amount: currentSaleAmount,
        currency: quote.currency,
        payload: availability,
      });
      return res.status(409).json({
        code: "HOTEL_PRICE_CHANGED",
        message: `Hotel price changed from ${firstAvailability.currency} ${firstAvailability.amount.toFixed(2)} to ${quote.currency} ${currentSaleAmount.toFixed(2)}. Please confirm the new price and resubmit.`,
      });
    }
    const currentAmount = database.calculateSaleAmount("hotel", currentSupplierAmount);
    if (quote.priceBreakdown) {
      quote = {
        ...quote,
        priceBreakdown: {
          ...quote.priceBreakdown,
          total: currentAmount,
          serviceFee: Math.max(0, currentAmount - currentSupplierAmount),
        },
      };
      hotelQuotes.set(parsed.data.offerId, quote);
    }
    const partnerOrderCode = coOrderCode();
    const order: DistributionOrder = {
      id: localOrderId(),
      productType: "hotel",
      title: quote.hotelName,
      subtitle: `${quote.checkInDate} to ${quote.checkOutDate} · ${quote.roomNum} room(s)`,
      customer: customer.name,
      amount: currentAmount,
      currency: quote.currency,
      status: "PENDING_PAYMENT",
      createdAt: "just now",
    };
    const upstream: UpstreamOrderContext = {
      productType: "hotel",
      coOrderCode: partnerOrderCode,
      supplierAmount: currentSupplierAmount,
      amount: currentSupplierAmount,
      currency: order.currency,
    };
    const localOrder = database.insertOrder({
      order,
      supplier: "GLINK",
      bridgeKey: partnerOrderCode,
      userId,
      upstream,
      productSnapshot: quote,
      contactSnapshot: {
        guest: hotelGuests[0],
        guests: hotelGuests,
        contact: parsed.data.contact,
        arriveTime: parsed.data.arriveTime,
        latestArriveTime: parsed.data.latestArriveTime,
      },
    });
    // Persist the local order and idempotency key before the irreversible supplier call.
    if (idempotencyKey) database.saveIdempotency("CREATE_ORDER", idempotencyKey, localOrder.id);
    try {
      const created = await createGlinkOrder(runtime.glink, quote, availability, {
        guests: hotelGuests,
        contactName: parsed.data.contact.name,
        phone: parsed.data.contact.phone,
        email: parsed.data.contact.email,
        arriveTime: parsed.data.arriveTime,
        latestArriveTime: parsed.data.latestArriveTime,
      }, partnerOrderCode);
      if (fcgValue.number(created.result) !== 1) throw new FcgError(
        fcgValue.string(created.message, "G-Link failed to create the order"),
        "GLINK_CREATE_FAILED",
        422,
      );
      const supplierOrderNo = fcgValue.string(created.fcOrderCode);
      if (!supplierOrderNo) throw new FcgError(
        "G-Link order created but no fcOrderCode was returned",
        "GLINK_ORDER_NUMBER_MISSING",
        502,
      );
      const completedUpstream = { ...upstream, fcOrderCode: supplierOrderNo };
      database.updateUpstreamContext(localOrder.id, completedUpstream);
      const persisted = database.updateOrder(
        localOrder.id,
        { supplierOrderNo },
        "GLINK_ORDER_CREATED",
        {
          coOrderCode: partnerOrderCode,
          fcOrderCode: supplierOrderNo,
          result: fcgValue.number(created.result),
        },
      )!;
      return createdResponse(persisted);
    } catch (error) {
      database.updateOrder(
        localOrder.id,
        { status: "FAILED" },
        "GLINK_ORDER_CREATE_FAILED",
        {
          coOrderCode: partnerOrderCode,
          code: error instanceof FcgError ? error.code : "INTERNAL_ERROR",
          message: error instanceof Error ? error.message : String(error),
        },
      );
      throw error;
    }
  }

  const quote = flightQuotes.get(parsed.data.offerId);
  if (!quote) return res.status(410).json({ code: "PRICE_KEY_EXPIRED", message: "Flight fare has expired. Please search and verify again." });
  if (!quote.verifiedAt || Date.now() - quote.verifiedAt > 15 * 60_000) return res.status(409).json({ code: "VERIFY_REQUIRED", message: "Please re-run the F-Link real-time price verification" });
  const expectedPassengerCounts = {
    adult: quote.adultNum,
    child: quote.childNum || 0,
    infant: quote.infantNum || 0,
  };
  const actualPassengerCounts = parsed.data.passengers.reduce((counts, passenger) => {
    counts[passenger.type] += 1;
    return counts;
  }, { adult: 0, child: 0, infant: 0 });
  if (actualPassengerCounts.adult !== expectedPassengerCounts.adult
    || actualPassengerCounts.child !== expectedPassengerCounts.child
    || actualPassengerCounts.infant !== expectedPassengerCounts.infant) {
    return res.status(400).json({ code: "PASSENGER_COUNT_MISMATCH", message: "Adult, child, or infant count does not match the verified count" });
  }
  const order: DistributionOrder = {
    id: localOrderId(),
    productType: "flight",
    title: quote.title,
    subtitle: quote.subtitle,
    customer: customer.name,
    amount: database.calculateSaleAmount("flight", quote.totalAmount)
      + addOnAmount(parsed.data.addOns),
    currency: quote.currency,
    status: "PENDING_PAYMENT",
    createdAt: "just now",
  };
  const initialUpstream: UpstreamOrderContext = {
    productType: "flight",
    supplierAmount: quote.totalAmount,
    addOnAmount: addOnAmount(parsed.data.addOns),
    amount: quote.totalAmount,
    currency: order.currency,
  };
  const localOrder = database.insertOrder({
    order,
    supplier: "FLINK",
    bridgeKey: quote.priceKey,
    userId,
    upstream: initialUpstream,
    productSnapshot: quote,
    contactSnapshot: {
      contact: parsed.data.contact,
      passengers: parsed.data.passengers,
      addOns: parsed.data.addOns,
      paymentMethod: parsed.data.paymentMethod,
    },
  });
  if (idempotencyKey) database.saveIdempotency("CREATE_ORDER", idempotencyKey, localOrder.id);
  try {
    const created = await createFlinkOrder(runtime.flink, quote, {
      contactName: parsed.data.contact.name,
      contactPhone: parsed.data.contact.phone,
      contactEmail: parsed.data.contact.email,
      passengers: parsed.data.passengers,
    });
    const orderNo = fcgValue.string(created.orderNo);
    if (!orderNo) throw new FcgError("F-Link did not return an order number", "FLINK_CREATE_FAILED", 422);
    const supplierAmount = fcgValue.number(created.priceTotal, quote.totalAmount);
    const currency = fcgValue.string(created.currency, quote.currency);
    const completedUpstream: UpstreamOrderContext = {
      ...initialUpstream,
      orderNo,
      supplierAmount,
      amount: supplierAmount,
      currency,
    };
    database.updateUpstreamContext(localOrder.id, completedUpstream);
    const persisted = database.updateOrder(
      localOrder.id,
      {
        supplierOrderNo: orderNo,
        amount: database.calculateSaleAmount("flight", supplierAmount)
          + addOnAmount(parsed.data.addOns),
        currency,
      },
      "FLINK_ORDER_CREATED",
      { orderNo, priceKey: quote.priceKey },
    )!;
    return createdResponse(persisted);
  } catch (error) {
    database.updateOrder(
      localOrder.id,
      { status: "FAILED" },
      "FLINK_ORDER_CREATE_FAILED",
      {
        priceKey: quote.priceKey,
        code: error instanceof FcgError ? error.code : "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : String(error),
      },
    );
    throw error;
  }
});

app.post("/api/orders/:orderId/pay", async (req, res) => {
  const userId = authUserId(req);
  if (!userId) return res.status(401).json({ code: "AUTH_REQUIRED", message: "Authentication required" });
  const order = findOrder(req.params.orderId, userId);
  if (!order) return res.status(404).json({ code: "ORDER_NOT_FOUND", message: "Order not found" });
  if (order.status !== "PENDING_PAYMENT") return res.status(409).json({
    code: "ORDER_STATUS_CONFLICT",
    message: `Current order status ${order.status} does not allow duplicate payment`,
  });
  const upstream = database.getUpstreamContext(order.id);
  const payment = z.object({ paymentMethod: z.enum(["credit", "card"]).default("credit") }).safeParse(req.body || {});
  if (!payment.success) return res.status(400).json({ code: "INVALID_PAYMENT_METHOD", message: "Unsupported payment method" });
  if (payment.data.paymentMethod === "card") {
    return res.status(409).json({
      code: "PAYMENT_CHANNEL_UNAVAILABLE",
      message: "Bank cards and digital wallets are not connected to a real acquiring channel yet. Please use the enterprise credit account instead.",
    });
  }
  if (payment.data.paymentMethod === "credit") {
    if (runtime.mode === "production"
      && order.currency !== "CNY"
      && process.env.ALLOW_FOREIGN_CURRENCY_CREDIT !== "true") {
      return res.status(409).json({
        code: "FOREIGN_CURRENCY_CREDIT_UNAVAILABLE",
        message: "Foreign currency credit settlement is not configured in production. CNY credit cannot be used directly to pay foreign currency orders.",
      });
    }
    if (order.currency === "CNY" && !database.hasAvailableCredit(order.customer, order.amount)) {
      return res.status(409).json({
        code: "INSUFFICIENT_CREDIT",
        message: "Insufficient available credit for the customer",
      });
    }
  }
  if (runtime.mode === "mock" || upstream?.simulated) {
    const supplierOrderNo = `${order.productType === "hotel" ? "FCG-H" : "FL"}-${Math.floor(10000000 + Math.random() * 89999999)}`;
    if (payment.data.paymentMethod === "credit"
      && order.currency === "CNY"
      && !database.consumeCustomerCredit(order.customer, order.amount)) {
      throw new FcgError("Customer credit capture failed. Please reconcile the order manually.", "CREDIT_CAPTURE_FAILED", 409);
    }
    database.createPayment(order, "CAPTURED", paymentChannel(payment.data.paymentMethod));
    const updated = database.updateOrder(
      order.id,
      { status: "PROCESSING", supplierOrderNo },
      "PAYMENT_ACCEPTED",
      { mode: upstream?.simulated ? "sandbox-simulation" : "mock" },
    );
    return res.json(ok(updated));
  }
  if (!upstream) return res.status(409).json({ code: "UPSTREAM_ORDER_MISSING", message: "Upstream order context not found" });
  let nextStatus: OrderStatus;
  let detailPending = false;
  let detailError: { code: string; message: string } | undefined;
  if (upstream.productType === "hotel") {
    const paid = fcgValue.record(await runtime.glink.glink<unknown>("/booking/payOrder", { coOrderCode: upstream.coOrderCode, fcOrderCode: upstream.fcOrderCode }));
    if (fcgValue.number(paid.payStatus) !== 1) throw new FcgError(fcgValue.string(paid.message, "G-Link failed to accept the payment"), "GLINK_PAY_FAILED", 422);
    // Webhook is the primary confirmation channel. orderDetail is only called
    // by the explicit low-frequency compensation endpoint below.
    nextStatus = "PROCESSING";
    upstream.rawStatus = fcgValue.number(paid.payStatus);
  } else {
    const result = await payFlinkOrder(runtime.flink, {
      orderNo: upstream.orderNo || "",
      amount: Math.round(upstream.amount),
    });
    nextStatus = mapFlinkPostPaymentStatus(result.rawStatus);
    upstream.rawStatus = result.rawStatus ?? result.payStatus;
    detailPending = result.detailPending;
    detailError = result.detailError;
  }
  database.updateUpstreamContext(order.id, upstream);
  if (payment.data.paymentMethod === "credit"
    && order.currency === "CNY"
    && !database.consumeCustomerCredit(order.customer, order.amount)) {
    database.createPayment(
      order,
      "RECONCILIATION_REQUIRED",
      paymentChannel(payment.data.paymentMethod),
    );
    database.updateOrder(
      order.id,
      { status: "PROCESSING" },
      "PAYMENT_RECONCILIATION_REQUIRED",
      {
        mode: runtime.mode,
        rawStatus: upstream.rawStatus,
        paymentMethod: payment.data.paymentMethod,
      },
    );
    throw new FcgError("The supplier accepted the payment, but customer credit capture failed. Please reconcile manually immediately.", "CREDIT_CAPTURE_FAILED", 500);
  }
  database.createPayment(order, "CAPTURED", paymentChannel(payment.data.paymentMethod));
  const updated = database.updateOrder(
    order.id,
    { status: nextStatus },
    detailPending ? "PAYMENT_ACCEPTED_STATUS_PENDING" : "PAYMENT_ACCEPTED",
    {
      mode: runtime.mode,
      rawStatus: upstream.rawStatus,
      paymentMethod: payment.data.paymentMethod,
      detailPending,
      detailError,
    },
  );
  return res.json(ok(updated));
});

const changeStatusLabels = ["Pending Review", "Pending Payment", "Review Rejected", "Change Ticketing", "Change Completed", "Cancelled"];
const refundStatusLabels = ["Pending Review", "Pending Confirmation", "Review Rejected", "Refunding", "Refund Completed", "Revoked"];
const contactSchema = z.object({
  name: z.string().min(1).max(50),
  surname: z.string().min(1).max(50).optional(),
  givenName: z.string().min(1).max(50).optional(),
  phone: z.string().min(6).max(30),
  email: z.string().email(),
});
const afterSalesLocalStatus = (kind: "change" | "refund", status: number): OrderStatus => {
  if (kind === "change") return [0, 1, 3].includes(status) ? "CHANGING" : "TICKETED";
  if (status === 4) return "REFUNDED";
  return [0, 1, 3].includes(status) ? "REFUNDING" : "TICKETED";
};
const publicAfterSalesContext = (
  order: DistributionOrder,
  upstream: UpstreamOrderContext,
  source: {
    supplierStatus: number;
    passengers: Array<{ passengerCode: string; name: string }>;
    segments: Array<{ segmentId: string; origin: string; destination: string; date: string; flightNo: string }>;
  },
) => {
  const change = upstream.afterSales?.change;
  const refund = upstream.afterSales?.refund;
  const activeChange = change && [0, 1, 3].includes(change.status);
  const activeRefund = refund && [0, 1, 3].includes(refund.status);
  const refunded = order.status === "REFUNDED" || refund?.status === 4;
  const ticketed = source.supplierStatus === 8 || (runtime.mode === "mock" && order.status === "TICKETED");
  const eligible = ticketed && !refunded && !activeChange && !activeRefund;
  const eligibilityReason = refunded
    ? "This ticket has already been refunded. No further refund or change requests are allowed."
    : !ticketed
    ? "The airline has not issued the ticket yet. Refund or change requests can only be made after ticketing is complete."
    : activeChange
      ? "A change order is already being processed."
      : activeRefund
        ? "A refund order is already being processed."
        : undefined;
  return {
    eligible,
    eligibilityReason,
    supplierStatus: source.supplierStatus,
    passengers: source.passengers,
    segments: source.segments,
    ...(change ? {
      change: {
        kind: "change" as const,
        orderNo: change.changeOrderNo,
        status: change.status,
        statusLabel: changeStatusLabels[change.status] || `Status ${change.status}`,
        amount: change.amount,
        currency: change.currency,
        targetDate: change.targetDate,
        rejectReason: change.rejectReason,
        updatedAt: change.updatedAt,
      },
    } : {}),
    ...(refund ? {
      refund: {
        kind: "refund" as const,
        orderNo: refund.refundOrderNo,
        status: refund.status,
        statusLabel: refundStatusLabels[refund.status] || `Status ${refund.status}`,
        amount: refund.refundMoney,
        currency: refund.currency,
        rejectReason: refund.rejectReason,
        updatedAt: refund.updatedAt,
      },
    } : {}),
  };
};

async function loadFlightAfterSales(orderId: string, userId?: string) {
  const order = findOrder(orderId, userId);
  if (!order) throw new FcgError("Order not found", "ORDER_NOT_FOUND", 404);
  if (order.productType !== "flight") throw new FcgError("Only flight orders support refunds and changes", "PRODUCT_TYPE_CONFLICT", 409);
  const upstream = database.getUpstreamContext(order.id);
  if (!upstream) throw new FcgError("Upstream order context not found", "UPSTREAM_ORDER_MISSING", 409);
  if (!upstream.orderNo && runtime.mode !== "mock") {
    throw new FcgError("F-Link upstream order number not found", "UPSTREAM_ORDER_MISSING", 409);
  }
  const source = runtime.mode === "mock"
    ? {
      supplierStatus: order.status === "TICKETED" || ["CHANGING", "REFUNDING", "REFUNDED"].includes(order.status) ? 8 : 5,
      passengers: [{ passengerCode: "mock-passenger-1", name: "TEST/SANDBOX" }],
      segments: [{
        segmentId: "20260806-SIN-BKK-MOCK001",
        origin: order.title.split("→")[0]?.trim() || "SIN",
        destination: order.title.split("→")[1]?.trim() || "BKK",
        date: "2026-08-06",
        flightNo: "MOCK001",
      }],
    }
    : await getFlinkOrderAfterSalesSource(runtime.flink, upstream.orderNo || "");
  upstream.rawStatus = source.supplierStatus;
  database.updateUpstreamContext(order.id, upstream);
  if (source.supplierStatus === 8 && ["PROCESSING", "CONFIRMED"].includes(order.status)) {
    database.updateOrder(order.id, { status: "TICKETED" }, "FLINK_TICKETED_CONFIRMED", {
      rawStatus: source.supplierStatus,
    });
  } else if (source.supplierStatus !== 8 && order.status === "TICKETED") {
    database.updateOrder(order.id, { status: mapFlinkOrderStatus(source.supplierStatus) }, "FLINK_TICKET_ELIGIBILITY_RECONCILED", {
      rawStatus: source.supplierStatus,
      reason: "Supplier order details do not meet the conditions for refund/change ticketing",
    });
  }
  return { order: findOrder(order.id, userId)!, upstream, source };
}

app.get("/api/orders/:orderId/flight-aftersales", async (req, res) => {
  const userId = authUserId(req);
  if (!userId) return res.status(401).json({ code: "AUTH_REQUIRED", message: "Authentication required" });
  const context = await loadFlightAfterSales(req.params.orderId, userId);
  return res.json(ok(publicAfterSalesContext(context.order, context.upstream, context.source)));
});

app.post("/api/orders/:orderId/flight-aftersales/change/search", async (req, res) => {
  const userId = authUserId(req);
  if (!userId) return res.status(401).json({ code: "AUTH_REQUIRED", message: "Authentication required" });
  const parsed = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    passengerCodes: z.array(z.string().min(1)).min(1).max(9),
    segmentIds: z.array(z.string().min(1)).min(1).max(9),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ code: "INVALID_PARAMS", message: "Please select passengers, original segments, and a new date" });
  const context = await loadFlightAfterSales(req.params.orderId, userId);
  const publicContext = publicAfterSalesContext(context.order, context.upstream, context.source);
  if (!publicContext.eligible) return res.status(409).json({
    code: "AFTERSALES_NOT_ELIGIBLE",
    message: publicContext.eligibilityReason,
  });
  if (!parsed.data.passengerCodes.every(code => context.source.passengers.some(item => item.passengerCode === code))
    || !parsed.data.segmentIds.every(id => context.source.segments.some(item => item.segmentId === id))) {
    return res.status(400).json({ code: "INVALID_BRIDGE_IDENTIFIER", message: "Passenger or segment identifier does not belong to this order" });
  }
  const offers = runtime.mode === "mock"
    ? [{
      priceKey: `mock-change-${randomUUID()}`,
      flightNo: "MOCK002",
      airline: "F-Link Sandbox",
      departureTime: "10:30",
      arrivalTime: "12:55",
      duration: "2h25m",
      price: 360,
      currency: context.order.currency,
    }]
    : await searchFlinkChangeOffers(runtime.flink, {
      orderNo: context.upstream.orderNo || "",
      cabinClass: "economy",
      date: parsed.data.date,
      passengerCode: parsed.data.passengerCodes.join(","),
      segmentId: parsed.data.segmentIds.join(","),
    });
  for (const offer of offers) {
    flightChangeQuotes.set(offer.priceKey, {
      orderId: context.order.id,
      passengerCode: parsed.data.passengerCodes.join(","),
      segmentId: parsed.data.segmentIds.join(","),
      targetDate: parsed.data.date,
      amount: offer.price,
      currency: offer.currency,
      expiresAt: Date.now() + 15 * 60_000,
    });
  }
  return res.json(ok(offers));
});

app.post("/api/orders/:orderId/flight-aftersales/change/apply", async (req, res) => {
  const userId = authUserId(req);
  if (!userId) return res.status(401).json({ code: "AUTH_REQUIRED", message: "Authentication required" });
  const parsed = z.object({
    priceKey: z.string().min(1),
    passengerCodes: z.array(z.string().min(1)).min(1).max(9),
    segmentIds: z.array(z.string().min(1)).min(1).max(9),
    changeType: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
    reasonType: z.union([z.literal(1), z.literal(2)]).default(1),
    reason: z.string().min(2).max(300),
    evidenceFiles: z.array(z.string().url()).max(5).default([]),
    contact: contactSchema,
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ code: "INVALID_PARAMS", message: "Change application details are incomplete" });
  if (parsed.data.reasonType === 2 && !parsed.data.evidenceFiles.length) {
    return res.status(400).json({ code: "EVIDENCE_REQUIRED", message: "Involuntary changes require a link to flight disruption or supporting evidence" });
  }
  const context = await loadFlightAfterSales(req.params.orderId, userId);
  const existing = context.upstream.afterSales?.change;
  if (existing && [0, 1, 3].includes(existing.status) && existing.priceKey === parsed.data.priceKey) {
    return res.json(ok(publicAfterSalesContext(context.order, context.upstream, context.source)));
  }
  if (existing && [0, 1, 3].includes(existing.status)) {
    return res.status(409).json({ code: "CHANGE_ALREADY_ACTIVE", message: "A change order is already being processed" });
  }
  const quote = flightChangeQuotes.get(parsed.data.priceKey);
  if (!quote || quote.expiresAt < Date.now() || quote.orderId !== context.order.id
    || quote.passengerCode !== parsed.data.passengerCodes.join(",") || quote.segmentId !== parsed.data.segmentIds.join(",")) {
    return res.status(410).json({ code: "CHANGE_QUOTE_EXPIRED", message: "Change quote has expired. Please search again." });
  }
  const publicContext = publicAfterSalesContext(context.order, context.upstream, context.source);
  if (!publicContext.eligible) return res.status(409).json({ code: "AFTERSALES_NOT_ELIGIBLE", message: publicContext.eligibilityReason });
  const applied = runtime.mode === "mock"
    ? { changeOrderNo: `MOCK-CH-${Date.now()}`, status: 1 }
    : await applyFlinkChange(runtime.flink, {
      orderNo: context.upstream.orderNo || "",
      passengerCode: parsed.data.passengerCodes.join(","),
      segmentId: parsed.data.segmentIds.join(","),
      priceKey: parsed.data.priceKey,
      changeType: parsed.data.changeType,
      contactName: parsed.data.contact.name,
      contactPhone: parsed.data.contact.phone,
      contactEmail: parsed.data.contact.email,
      reason: parsed.data.reason,
      reasonType: parsed.data.reasonType,
      evidenceFiles: parsed.data.evidenceFiles,
    });
  context.upstream.afterSales = {
    ...context.upstream.afterSales,
    change: {
      ...applied,
      amount: quote.amount,
      currency: quote.currency,
      targetDate: quote.targetDate,
      priceKey: parsed.data.priceKey,
      updatedAt: new Date().toISOString(),
    },
  };
  database.updateUpstreamContext(context.order.id, context.upstream);
  const order = database.updateOrder(context.order.id, { status: "CHANGING" }, "FLINK_CHANGE_APPLIED", {
    changeOrderNo: applied.changeOrderNo,
    status: applied.status,
  })!;
  return res.status(201).json(ok(publicAfterSalesContext(order, context.upstream, context.source)));
});

async function syncFlightChange(context: Awaited<ReturnType<typeof loadFlightAfterSales>>) {
  const current = context.upstream.afterSales?.change;
  if (!current) throw new FcgError("This order has no change request", "CHANGE_ORDER_MISSING", 409);
  const detail = runtime.mode === "mock"
    ? { status: current.status === 3 ? 4 : current.status, priceTotal: current.amount, currency: current.currency }
    : await getFlinkChangeDetail(runtime.flink, current.changeOrderNo);
  current.status = fcgValue.number(detail.status, current.status);
  current.amount = fcgValue.number(detail.priceTotal, current.amount);
  current.currency = fcgValue.string(detail.currency, current.currency);
  current.rejectReason = fcgValue.string(detail.rejectReason);
  current.updatedAt = new Date().toISOString();
  database.updateUpstreamContext(context.order.id, context.upstream);
  const order = database.updateOrder(context.order.id, { status: afterSalesLocalStatus("change", current.status) }, "FLINK_CHANGE_SYNCED", {
    changeOrderNo: current.changeOrderNo,
    status: current.status,
  })!;
  return publicAfterSalesContext(order, context.upstream, context.source);
}

app.post("/api/orders/:orderId/flight-aftersales/change/refresh", async (req, res) => {
  const userId = authUserId(req);
  if (!userId) return res.status(401).json({ code: "AUTH_REQUIRED", message: "Authentication required" });
  const context = await loadFlightAfterSales(req.params.orderId, userId);
  return res.json(ok(await syncFlightChange(context)));
});

app.post("/api/orders/:orderId/flight-aftersales/change/pay", async (req, res) => {
  const userId = authUserId(req);
  if (!userId) return res.status(401).json({ code: "AUTH_REQUIRED", message: "Authentication required" });
  const context = await loadFlightAfterSales(req.params.orderId, userId);
  const current = context.upstream.afterSales?.change;
  if (!current) return res.status(409).json({ code: "CHANGE_ORDER_MISSING", message: "This order has no change request" });
  if (current.status !== 1) return res.status(409).json({ code: "CHANGE_STATUS_CONFLICT", message: "Only approved change orders pending payment can be paid" });
  const detail = runtime.mode === "mock" ? { priceTotal: current.amount, currency: current.currency } : await getFlinkChangeDetail(runtime.flink, current.changeOrderNo);
  const amount = fcgValue.number(detail.priceTotal, current.amount);
  if (amount < 0) throw new FcgError("Invalid change fare difference amount", "INVALID_CHANGE_AMOUNT", 422);
  const reserveCredit = context.order.currency === "CNY" && amount > 0;
  if (reserveCredit && !database.consumeCustomerCredit(context.order.customer, amount)) {
    throw new FcgError("Insufficient available credit to pay the change fare difference", "INSUFFICIENT_CREDIT", 409);
  }
  try {
    if (runtime.mode !== "mock") await payFlinkChange(runtime.flink, { changeOrderNo: current.changeOrderNo, amount: Math.round(amount) });
  } catch (error) {
    if (reserveCredit) database.restoreCustomerCredit(context.order.customer, amount);
    throw error;
  }
  current.status = 3;
  current.amount = amount;
  current.currency = fcgValue.string(detail.currency, current.currency);
  current.updatedAt = new Date().toISOString();
  database.updateUpstreamContext(context.order.id, context.upstream);
  database.recordLedgerEntry({
    orderId: context.order.id,
    entryType: "ADJUSTMENT",
    amount: -Math.abs(amount),
    currency: current.currency || context.order.currency,
    status: "POSTED",
    reference: `FLINK_CHANGE:${current.changeOrderNo}`,
  });
  const order = database.updateOrder(context.order.id, { status: "CHANGING" }, "FLINK_CHANGE_PAID", {
    changeOrderNo: current.changeOrderNo,
    amount,
  })!;
  return res.json(ok(publicAfterSalesContext(order, context.upstream, context.source)));
});

app.post("/api/orders/:orderId/flight-aftersales/change/cancel", async (req, res) => {
  const userId = authUserId(req);
  if (!userId) return res.status(401).json({ code: "AUTH_REQUIRED", message: "Authentication required" });
  const context = await loadFlightAfterSales(req.params.orderId, userId);
  const current = context.upstream.afterSales?.change;
  if (!current) return res.status(409).json({ code: "CHANGE_ORDER_MISSING", message: "This order has no change request" });
  if (![0, 1].includes(current.status)) return res.status(409).json({ code: "CHANGE_STATUS_CONFLICT", message: "The current change status does not allow cancellation" });
  if (runtime.mode !== "mock") await cancelFlinkChange(runtime.flink, current.changeOrderNo);
  current.status = 5;
  current.updatedAt = new Date().toISOString();
  database.updateUpstreamContext(context.order.id, context.upstream);
  const order = database.updateOrder(context.order.id, { status: "TICKETED" }, "FLINK_CHANGE_CANCELLED", {
    changeOrderNo: current.changeOrderNo,
  })!;
  return res.json(ok(publicAfterSalesContext(order, context.upstream, context.source)));
});

app.post("/api/orders/:orderId/flight-aftersales/refund/apply", async (req, res) => {
  const userId = authUserId(req);
  if (!userId) return res.status(401).json({ code: "AUTH_REQUIRED", message: "Authentication required" });
  const parsed = z.object({
    passengerCodes: z.array(z.string().min(1)).min(1).max(9),
    segmentIds: z.array(z.string().min(1)).min(1).max(9),
    refundType: z.union([z.literal(1), z.literal(2)]).default(1),
    reason: z.string().min(2).max(300),
    evidenceFiles: z.array(z.string().url()).max(5).default([]),
    contact: contactSchema,
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ code: "INVALID_PARAMS", message: "Refund application details are incomplete" });
  if (parsed.data.refundType === 2 && !parsed.data.evidenceFiles.length) {
    return res.status(400).json({ code: "EVIDENCE_REQUIRED", message: "Involuntary refunds require a link to flight disruption or supporting evidence" });
  }
  const context = await loadFlightAfterSales(req.params.orderId, userId);
  const existing = context.upstream.afterSales?.refund;
  if (existing && [0, 1, 3].includes(existing.status)) {
    return res.json(ok(publicAfterSalesContext(context.order, context.upstream, context.source)));
  }
  const publicContext = publicAfterSalesContext(context.order, context.upstream, context.source);
  if (!publicContext.eligible) return res.status(409).json({ code: "AFTERSALES_NOT_ELIGIBLE", message: publicContext.eligibilityReason });
  if (!parsed.data.passengerCodes.every(code => context.source.passengers.some(item => item.passengerCode === code))
    || !parsed.data.segmentIds.every(id => context.source.segments.some(item => item.segmentId === id))) {
    return res.status(400).json({ code: "INVALID_BRIDGE_IDENTIFIER", message: "Passenger or segment identifier does not belong to this order" });
  }
  const applied = runtime.mode === "mock"
    ? { refundOrderNo: `MOCK-RF-${Date.now()}`, status: 1 }
    : await applyFlinkRefund(runtime.flink, {
      orderNo: context.upstream.orderNo || "",
      passengerCode: parsed.data.passengerCodes.join(","),
      segmentId: parsed.data.segmentIds.join(","),
      refundType: parsed.data.refundType,
      reason: parsed.data.reason,
      contactName: parsed.data.contact.name,
      contactPhone: parsed.data.contact.phone,
      contactEmail: parsed.data.contact.email,
      evidenceFiles: parsed.data.evidenceFiles,
    });
  context.upstream.afterSales = {
    ...context.upstream.afterSales,
    refund: {
      ...applied,
      currency: context.order.currency,
      updatedAt: new Date().toISOString(),
    },
  };
  database.updateUpstreamContext(context.order.id, context.upstream);
  const order = database.updateOrder(context.order.id, { status: "REFUNDING" }, "FLINK_REFUND_APPLIED", {
    refundOrderNo: applied.refundOrderNo,
    status: applied.status,
  })!;
  return res.status(201).json(ok(publicAfterSalesContext(order, context.upstream, context.source)));
});

async function syncFlightRefund(context: Awaited<ReturnType<typeof loadFlightAfterSales>>) {
  const current = context.upstream.afterSales?.refund;
  if (!current) throw new FcgError("This order has no refund request", "REFUND_ORDER_MISSING", 409);
  const detail = runtime.mode === "mock"
    ? { status: current.status === 3 ? 4 : current.status, refundMoney: context.order.amount, refundFee: 0, currency: current.currency }
    : await getFlinkRefundDetail(runtime.flink, current.refundOrderNo);
  current.status = fcgValue.number(detail.status, current.status);
  const refundMoney = optionalSupplierAmount(detail.refundMoney);
  const refundFee = optionalSupplierAmount(detail.refundFee);
  if (refundMoney !== undefined) current.refundMoney = refundMoney;
  else if (current.status === 0 && current.refundMoney === 0) delete current.refundMoney;
  if (refundFee !== undefined) current.refundFee = refundFee;
  current.currency = fcgValue.string(detail.currency, current.currency);
  current.rejectReason = fcgValue.string(detail.rejectReason);
  current.updatedAt = new Date().toISOString();
  database.updateUpstreamContext(context.order.id, context.upstream);
  const nextStatus = afterSalesLocalStatus("refund", current.status);
  if (current.status === 4) {
    const ledger = database.recordLedgerEntry({
      orderId: context.order.id,
      entryType: "REFUND",
      amount: Math.abs(current.refundMoney || 0),
      currency: current.currency || context.order.currency,
      status: "POSTED",
      reference: `FLINK_REFUND:${current.refundOrderNo}`,
    });
    if (ledger.inserted && context.order.currency === "CNY") {
      database.restoreCustomerCredit(context.order.customer, current.refundMoney || 0);
    }
  }
  const order = database.updateOrder(context.order.id, { status: nextStatus }, "FLINK_REFUND_SYNCED", {
    refundOrderNo: current.refundOrderNo,
    status: current.status,
  })!;
  return publicAfterSalesContext(order, context.upstream, context.source);
}

app.post("/api/orders/:orderId/flight-aftersales/refund/refresh", async (req, res) => {
  const userId = authUserId(req);
  if (!userId) return res.status(401).json({ code: "AUTH_REQUIRED", message: "Authentication required" });
  const context = await loadFlightAfterSales(req.params.orderId, userId);
  return res.json(ok(await syncFlightRefund(context)));
});

app.post("/api/orders/:orderId/flight-aftersales/refund/confirm", async (req, res) => {
  const userId = authUserId(req);
  if (!userId) return res.status(401).json({ code: "AUTH_REQUIRED", message: "Authentication required" });
  const parsed = z.object({ confirm: z.enum(["1", "2"]) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ code: "INVALID_PARAMS", message: "Confirmation parameters are invalid" });
  const context = await loadFlightAfterSales(req.params.orderId, userId);
  const current = context.upstream.afterSales?.refund;
  if (!current) return res.status(409).json({ code: "REFUND_ORDER_MISSING", message: "This order has no refund request" });
  if (current.status !== 1) return res.status(409).json({ code: "REFUND_STATUS_CONFLICT", message: "Only refund orders pending confirmation can be confirmed or revoked" });
  if (parsed.data.confirm === "1" && current.refundMoney === undefined) return res.status(409).json({
    code: "REFUND_AMOUNT_MISSING",
    message: "The supplier has not returned the refund amount yet. Please refresh the refund order before confirming.",
  });
  if (runtime.mode !== "mock") await confirmFlinkRefund(runtime.flink, { refundOrderNo: current.refundOrderNo, confirm: parsed.data.confirm });
  current.status = parsed.data.confirm === "1" ? 3 : 5;
  current.updatedAt = new Date().toISOString();
  database.updateUpstreamContext(context.order.id, context.upstream);
  if (parsed.data.confirm === "1") {
    database.recordLedgerEntry({
      orderId: context.order.id,
      entryType: "REFUND_PENDING",
      amount: Math.abs(current.refundMoney!),
      currency: current.currency || context.order.currency,
      status: "PENDING",
      reference: `FLINK_REFUND_PENDING:${current.refundOrderNo}`,
    });
  }
  const order = database.updateOrder(context.order.id, { status: afterSalesLocalStatus("refund", current.status) }, "FLINK_REFUND_CONFIRMED", {
    refundOrderNo: current.refundOrderNo,
    confirm: parsed.data.confirm,
  })!;
  return res.json(ok(publicAfterSalesContext(order, context.upstream, context.source)));
});

async function refreshOrderFromSupplier(order: DistributionOrder) {
  if (["CONFIRMED", "CANCELLED", "TICKETED", "CHANGING", "REFUNDING", "REFUNDED", "FAILED"].includes(order.status)) {
    return order;
  }
  if (order.status === "PENDING_PAYMENT") {
    throw new FcgError("Unpaid orders do not trigger supplier order detail compensation queries", "ORDER_NOT_PAID", 409);
  }
  const upstream = database.getUpstreamContext(order.id);
  if (runtime.mode === "mock" || upstream?.simulated) {
    if (order.status === "PROCESSING") {
      const status = order.productType === "hotel" ? "CONFIRMED" : "TICKETED";
      return database.updateOrder(
        order.id,
        { status },
        "SUPPLIER_STATUS_SYNCED",
        { mode: upstream?.simulated ? "sandbox-simulation" : "mock" },
      )!;
    }
    return order;
  }
  if (!upstream) throw new FcgError("Upstream order context not found", "UPSTREAM_ORDER_MISSING", 409);
  let nextStatus: OrderStatus;
  let rawStatus: number | undefined;
  if (upstream.productType === "hotel") {
    const detail = fcgValue.record(await runtime.glink.glink<unknown>("/order/orderDetail", { coOrderCode: upstream.coOrderCode, fcOrderCode: upstream.fcOrderCode }));
    rawStatus = fcgValue.number(detail.orderStatus);
    nextStatus = mapGlinkOrderDetailStatus(rawStatus);
  } else {
    const detail = fcgValue.record(await runtime.flink.flink<unknown>("zh_CN", "/flight/order/detail", { orderNo: upstream.orderNo }));
    rawStatus = fcgValue.number(detail.status);
    nextStatus = mapFlinkOrderStatus(rawStatus);
  }
  const reconciled = reconcileSupplierStatus(order.status, nextStatus);
  return database.updateOrder(
    order.id,
    { status: reconciled.status },
    reconciled.conflict ? "SUPPLIER_STATUS_CONFLICT" : "SUPPLIER_STATUS_SYNCED",
    { mode: runtime.mode, rawStatus, mappedStatus: nextStatus, preservedStatus: reconciled.status },
  )!;
}

app.post("/api/orders/:orderId/refresh", async (req, res) => {
  const userId = authUserId(req);
  if (!userId) return res.status(401).json({ code: "AUTH_REQUIRED", message: "Authentication required" });
  const order = findOrder(req.params.orderId, userId);
  if (!order) return res.status(404).json({ code: "ORDER_NOT_FOUND", message: "Order not found" });
  return res.json(ok(await refreshOrderFromSupplier(order)));
});

async function cancelOrderWithSupplier(order: DistributionOrder, reason: string) {
  if (["CANCELLED", "TICKETED", "CHANGING", "REFUNDING", "REFUNDED"].includes(order.status)) {
    throw new FcgError(
      `Current order status ${order.status} does not allow cancellation`,
      "ORDER_STATUS_CONFLICT",
      409,
    );
  }
  const upstream = database.getUpstreamContext(order.id);
  let cancellationPending = false;
  if (runtime.mode !== "mock" && !upstream?.simulated) {
    if (!upstream) throw new FcgError("Upstream order context not found", "UPSTREAM_ORDER_MISSING", 409);
    if (upstream.productType === "hotel") {
      const cancelled = fcgValue.record(await runtime.glink.glink<unknown>("/order/cancelOrder", {
        coOrderCode: upstream.coOrderCode,
        fcOrderCode: upstream.fcOrderCode,
        cancelReason: reason,
      }));
      const cancelStatus = mapGlinkCancelResult(cancelled.cancelResult);
      if (cancelStatus === "REFUSED") {
        throw new FcgError(
          fcgValue.string(cancelled.message, "G-Link refused to cancel the order"),
          "GLINK_CANCEL_REFUSED",
          409,
        );
      }
      if (cancelStatus === "CANCELLING") {
        cancellationPending = true;
      }
    } else {
      await runtime.flink.flink<unknown>("zh_CN", "/flight/order/cancel", { orderNo: upstream.orderNo });
    }
  }
  if (cancellationPending) {
    return {
      pending: true,
      order: database.updateOrder(
      order.id,
      { status: order.status },
      "GLINK_CANCELLATION_REQUESTED",
      { reason, mode: runtime.mode },
      )!,
    };
  }
  const updated = database.updateOrder(
    order.id,
    { status: "CANCELLED" },
    "ORDER_CANCELLED",
    { reason, mode: runtime.mode },
  )!;
  if (database.hasCapturedPayment(order.id)) {
    database.recordLedgerEntry({
      orderId: order.id,
      entryType: "REFUND_PENDING",
      amount: Math.abs(order.amount),
      currency: order.currency,
      status: "PENDING",
      reference: `REFUND_PENDING:${order.id}`,
    });
  }
  return { pending: false, order: updated };
}

app.post("/api/orders/:orderId/cancel", async (req, res) => {
  const userId = authUserId(req);
  if (!userId) return res.status(401).json({ code: "AUTH_REQUIRED", message: "Authentication required" });
  const order = findOrder(req.params.orderId, userId);
  if (!order) return res.status(404).json({ code: "ORDER_NOT_FOUND", message: "Order not found" });
  const result = await cancelOrderWithSupplier(
    order,
    fcgValue.string(req.body?.reason, "Customer initiated cancellation"),
  );
  return res.status(result.pending ? 202 : 200).json(ok(result.order));
});

export async function runOrderMaintenance() {
  const runId = database.startMaintenanceRun("ORDER_LIFECYCLE");
  const unpaidTimeoutMinutes = Math.max(5, Number(process.env.UNPAID_ORDER_TIMEOUT_MINUTES || 30));
  const compensationIntervalMinutes = Math.max(5, Number(process.env.ORDER_COMPENSATION_INTERVAL_MINUTES || 15));
  const limit = Math.max(1, Math.min(200, Number(process.env.ORDER_MAINTENANCE_BATCH_SIZE || 50)));
  const unpaidBefore = new Date(Date.now() - unpaidTimeoutMinutes * 60_000).toISOString();
  const processingBefore = new Date(Date.now() - compensationIntervalMinutes * 60_000).toISOString();
  const unpaid = database.listOrdersBefore("PENDING_PAYMENT", unpaidBefore, limit);
  const processing = database.listOrdersBefore("PROCESSING", processingBefore, limit);
  const changing = database.listOrdersBefore("CHANGING", processingBefore, limit)
    .filter(order => order.productType === "flight");
  const refunding = database.listOrdersBefore("REFUNDING", processingBefore, limit)
    .filter(order => order.productType === "flight");
  const detail: Array<{ orderId: string; action: string; result: string; message?: string }> = [];
  let succeeded = 0;
  let failed = 0;

  for (const order of unpaid) {
    try {
      const result = await cancelOrderWithSupplier(order, `Unpaid for over ${unpaidTimeoutMinutes} minutes. System auto-cancelled.`);
      detail.push({
        orderId: order.id,
        action: "AUTO_CANCEL",
        result: result.pending ? "PENDING" : "SUCCESS",
      });
      succeeded += 1;
    } catch (error) {
      failed += 1;
      detail.push({
        orderId: order.id,
        action: "AUTO_CANCEL",
        result: "FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
      database.updateOrder(order.id, { status: order.status }, "AUTO_CANCEL_FAILED", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const order of processing) {
    try {
      const refreshed = await refreshOrderFromSupplier(order);
      detail.push({
        orderId: order.id,
        action: "STATUS_COMPENSATION",
        result: refreshed.status,
      });
      succeeded += 1;
    } catch (error) {
      failed += 1;
      detail.push({
        orderId: order.id,
        action: "STATUS_COMPENSATION",
        result: "FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
      database.updateOrder(order.id, { status: order.status }, "STATUS_COMPENSATION_FAILED", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const order of changing) {
    try {
      const context = await loadFlightAfterSales(order.id);
      const synced = await syncFlightChange(context);
      detail.push({
        orderId: order.id,
        action: "CHANGE_STATUS_COMPENSATION",
        result: synced.change?.statusLabel || "SYNCED",
      });
      succeeded += 1;
    } catch (error) {
      failed += 1;
      detail.push({
        orderId: order.id,
        action: "CHANGE_STATUS_COMPENSATION",
        result: "FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const order of refunding) {
    try {
      const context = await loadFlightAfterSales(order.id);
      const synced = await syncFlightRefund(context);
      detail.push({
        orderId: order.id,
        action: "REFUND_STATUS_COMPENSATION",
        result: synced.refund?.statusLabel || "SYNCED",
      });
      succeeded += 1;
    } catch (error) {
      failed += 1;
      detail.push({
        orderId: order.id,
        action: "REFUND_STATUS_COMPENSATION",
        result: "FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return database.finishMaintenanceRun(runId, {
    scanned: unpaid.length + processing.length + changing.length + refunding.length,
    succeeded,
    failed,
    detail,
  });
}

app.post("/api/admin/maintenance/orders/run", async (req, res) => {
  if (runtime.mode === "production") {
    const expected = process.env.MAINTENANCE_API_KEY || "";
    const provided = fcgValue.string(req.headers["x-maintenance-key"]);
    if (!expected || provided !== expected) {
      return res.status(401).json({ code: "UNAUTHORIZED", message: "Maintenance API key is incorrect" });
    }
  } else if (!isAuthenticated(req)) {
    return res.status(401).json({ code: "AUTH_REQUIRED", message: "Please sign in before running maintenance tasks" });
  }
  return res.json(ok(await runOrderMaintenance()));
});

app.post("/api/webhooks/glink/order-status", (req, res) => {
  const parsed = z.object({
    event_id: z.string().min(1),
    event_type: z.enum(["glink.hotel.order_status", "glink.hotel.guarantee_refund", "glink.hotel.invoice_status", "glink.hotel.checkout_status"]),
    idempotency_key: z.string().min(1),
    data: z.record(z.unknown()),
    env_type: z.enum(["sandbox", "production"]).optional(),
    provider: z.literal("glink").optional(),
    product_code: z.literal("glink").optional(),
    api_code: z.string().optional(),
    occurred_at: z.string().optional(),
  }).passthrough().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ code: "INVALID_CALLBACK", message: "Callback payload does not conform to the OpenAPI contract" });
  const eventKey = parsed.data.idempotency_key || parsed.data.event_id;
  if (runtime.mode !== "mock") {
    if (parsed.data.env_type !== runtime.environment) return res.status(409).json({
      code: "WEBHOOK_ENVIRONMENT_MISMATCH",
      message: `Callback environment ${parsed.data.env_type || "missing"} does not match the current service environment ${runtime.environment}`,
    });
    if (fcgValue.string(req.headers["x-op-webhook-event-id"]) !== parsed.data.event_id
      || fcgValue.string(req.headers["x-op-webhook-type"]) !== parsed.data.event_type) {
      return res.status(400).json({
        code: "WEBHOOK_HEADER_MISMATCH",
        message: "Webhook event headers do not match the request body",
      });
    }
    const rawBody = (req as express.Request & { rawBody?: string }).rawBody || "";
    const verification = verifyFcgWebhook({
      method: req.method,
      path: req.path,
      rawBody,
      headers: req.headers,
      credentials: runtime.glinkCredentials,
    });
    if (!verification.valid) return res.status(401).json({ code: verification.code, message: "Webhook signature verification failed" });
    const nonce = fcgValue.string(req.headers["x-op-nonce"]);
    if (!database.registerWebhookNonce("GLINK", nonce)) {
      if (database.hasWebhookEvent("GLINK", eventKey)) {
        return res.json(ok({ accepted: true, duplicate: true }));
      }
      return res.status(409).json({ code: "WEBHOOK_NONCE_REPLAY", message: "Webhook nonce has already been used" });
    }
  }
  const webhook = database.recordWebhook("GLINK", eventKey, true, parsed.data);
  if (webhook.duplicate) return res.json(ok({ accepted: true, duplicate: true }));
  if (parsed.data.event_type === "glink.hotel.order_status") {
    const payload = parsed.data.data;
    const upstreamValue = fcgValue.string(payload.coOrderCode) || fcgValue.string(payload.fcOrderCode);
    const order = upstreamValue ? database.findOrderByUpstream(upstreamValue) : undefined;
    if (order) {
      const mapped = mapGlinkOrderStatusWebhook(payload.orderStatus);
      if (mapped) {
        const reconciled = reconcileSupplierStatus(order.status, mapped);
        database.updateOrder(
          order.id,
          { status: reconciled.status },
          reconciled.conflict ? "GLINK_WEBHOOK_STATUS_CONFLICT" : "GLINK_WEBHOOK_APPLIED",
          { ...payload, mappedStatus: mapped, preservedStatus: reconciled.status },
        );
      } else {
        database.updateOrder(
          order.id,
          { status: order.status },
          "GLINK_CANCELLATION_REJECTED",
          payload,
        );
      }
    }
  }
  database.markWebhookProcessed(eventKey);
  return res.json(ok({ accepted: true, duplicate: false }));
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if ((error as { type?: string })?.type === "entity.too.large") {
    return res.status(413).json({ code: "AVATAR_TOO_LARGE", message: "Avatar must not exceed 2 MB" });
  }
  if (error instanceof FcgError) {
    return res.status(error.status >= 400 && error.status < 600 ? error.status : 502).json({
      code: error.code,
      message: error.message,
      requestId: error.requestId,
      traceId: error.traceId,
    });
  }
  const message = error instanceof Error ? error.message : "Service temporarily unavailable";
  return res.status(500).json({ code: "INTERNAL_ERROR", message });
});

const frontendDist = resolve(process.cwd(), "dist");
if (existsSync(frontendDist)) {
  app.use(express.static(frontendDist, {
    etag: true,
    index: false,
    maxAge: runtime.mode === "production" ? "1h" : 0,
  }));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api/")) return next();
    return res.sendFile(join(frontendDist, "index.html"));
  });
}
app.use((_req, res) => res.status(404).json({ code: "NOT_FOUND", message: "Endpoint not found" }));

const port = Number(process.env.PORT || 8787);
const directRun = process.argv[1]
  ? pathToFileURL(process.argv[1]).href === import.meta.url
  : false;
if (directRun) {
  if (runtime.mode === "production") {
    const readiness = productionReadiness();
    if (!readiness.ready) {
      throw new Error(`Production readiness check failed: ${readiness.blockers.join(", ")}`);
    }
  }
  app.listen(port, () => console.log(
    `FusionGo API running at http://localhost:${port} (${runtime.mode}, ${database.status().database})`,
  ));
  if (process.env.ORDER_MAINTENANCE_ENABLED === "true") {
    const intervalMinutes = Math.max(1, Number(process.env.ORDER_MAINTENANCE_INTERVAL_MINUTES || 5));
    const timer = setInterval(() => {
      runOrderMaintenance().catch(error => {
        console.error("Order maintenance failed", error instanceof Error ? error.message : error);
      });
    }, intervalMinutes * 60_000);
    timer.unref();
  }
}

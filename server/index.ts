import "dotenv/config";
import cors from "cors";
import express from "express";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import type { DistributionOrder, FlightAddOns, HotelOffer, OrderStatus, PaymentMethod } from "../src/types.js";
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
  hydrateGlinkProduct,
  queryGlinkLowestPrices,
  payFlinkOrder,
  payFlinkChange,
  refreshFlinkCabin,
  searchFlinkChangeOffers,
  searchFlinkFlights,
  searchGlinkHotels,
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
import { openFusionDatabase, type UpstreamOrderContext } from "./database.js";

export const app = express();
const runtime = getFcgRuntime();
export const database = openFusionDatabase();
const hotelQuotes = new Map<string, HotelQuoteContext>();
const hotelStayContexts = new Map<string, {
  checkInDate: string;
  checkOutDate: string;
  roomNum: number;
  numberOfAdults: number;
  nights: number;
}>();
const flightQuotes = new Map<string, FlightQuoteContext>();
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
  && process.env.FCG_SANDBOX_HOTEL_SIMULATION === "true";
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map(value => value.trim())
  .filter(Boolean);

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
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

const ok = <T>(data: T) => ({ code: "SUCCESS", message: "ok", requestId: randomUUID(), data });
const findOrder = (id: string) => database.findOrder(id);
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
    tags: ["沙箱模拟房态", "非实时库存", ...(quote.tags || [])].slice(0, 4),
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
    sandboxSimulationOff: process.env.FCG_SANDBOX_HOTEL_SIMULATION === "false",
    paymentPolicy: process.env.PAYMENT_MODE === "enterprise_credit"
      || (process.env.PAYMENT_MODE === "card" && process.env.PAYMENT_CARD_ENABLED === "true"),
    maintenanceConfigured: process.env.ORDER_MAINTENANCE_ENABLED === "true"
      && Boolean(process.env.MAINTENANCE_API_KEY),
  };
  return {
    ready: Object.values(checks).every(Boolean),
    checks,
    blockers: Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name),
  };
};

app.get("/api/health", (_req, res) => res.json(ok({
  status: "up",
  mode: runtime.mode,
  database: database.status(),
})));
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

app.get("/api/dashboard", (_req, res) => {
  res.json(ok(database.dashboard()));
});

const accountProfileResponse = () => {
  const profile = database.getAccountProfile();
  return {
    id: profile.id,
    name: profile.name,
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

app.get("/api/account/profile", (_req, res) => res.json(ok(accountProfileResponse())));
app.patch("/api/account/profile", (req, res) => {
  const parsed = z.object({
    name: z.string().trim().min(1).max(50),
    language: z.enum(["zh-CN", "zh-TW", "en"]),
    phone: z.string().regex(/^1\d{10}$/),
    email: z.string().email().max(120),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ code: "INVALID_PROFILE", message: "个人资料格式不正确" });
  database.updateAccountProfile(parsed.data);
  return res.json(ok(accountProfileResponse()));
});
app.put(
  "/api/account/profile/avatar",
  express.raw({ type: ["image/png", "image/jpeg"], limit: "2mb" }),
  (req, res) => {
    const mime = String(req.headers["content-type"] || "").split(";", 1)[0] as "image/png" | "image/jpeg";
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!bytes.length) return res.status(400).json({ code: "AVATAR_EMPTY", message: "请选择需要保存的头像图片" });
    const isPng = mime === "image/png"
      && bytes.length >= 8
      && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const isJpeg = mime === "image/jpeg"
      && bytes.length >= 3
      && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if (!isPng && !isJpeg) return res.status(415).json({
      code: "AVATAR_TYPE_INVALID",
      message: "头像内容不是有效的 PNG 或 JPG 图片",
    });
    database.saveAccountAvatar(bytes, mime);
    return res.json(ok(accountProfileResponse()));
  },
);
app.get("/api/account/profile/avatar", (_req, res) => {
  const avatar = database.getAccountAvatar();
  if (!avatar?.avatar_blob || !avatar.avatar_mime) return res.status(404).json({
    code: "AVATAR_NOT_FOUND",
    message: "尚未保存个人头像",
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

app.get("/api/account/travelers", (_req, res) => res.json(ok(database.listAccountTravelers())));
app.post("/api/account/travelers", (req, res) => {
  const parsed = z.object({ ...travelerFields, documentNo: passportNumber }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({
    code: "INVALID_TRAVELER",
    message: "常用旅客或护照信息格式不正确",
  });
  return res.status(201).json(ok(database.createAccountTraveler(parsed.data)));
});
app.patch("/api/account/travelers/:travelerId", (req, res) => {
  const parsed = z.object({ ...travelerFields, documentNo: passportNumber.optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({
    code: "INVALID_TRAVELER",
    message: "常用旅客或护照信息格式不正确",
  });
  const traveler = database.updateAccountTraveler(req.params.travelerId, parsed.data);
  if (!traveler) return res.status(404).json({ code: "TRAVELER_NOT_FOUND", message: "常用旅客不存在" });
  return res.json(ok(traveler));
});
app.delete("/api/account/travelers/:travelerId", (req, res) => {
  if (!database.deleteAccountTraveler(req.params.travelerId)) {
    return res.status(404).json({ code: "TRAVELER_NOT_FOUND", message: "常用旅客不存在" });
  }
  return res.json(ok({ deleted: true as const }));
});

app.get("/api/account/notifications", (_req, res) => res.json(ok(database.getNotificationPreferences())));
app.patch("/api/account/notifications", (req, res) => {
  const parsed = z.object({ order: z.boolean(), flight: z.boolean(), marketing: z.boolean() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({
    code: "INVALID_NOTIFICATION_PREFERENCES",
    message: "通知偏好格式不正确",
  });
  return res.json(ok(database.updateNotificationPreferences(parsed.data)));
});

app.get("/api/customers", (_req, res) => res.json(ok(database.listCustomers())));
app.post("/api/customers", (req, res) => {
  const parsed = z.object({
    name: z.string().min(2).max(100),
    contactName: z.string().min(1).max(50),
    phone: z.string().min(8).max(30),
    email: z.string().email(),
    creditLimit: z.number().min(0).max(100_000_000),
    status: z.enum(["ACTIVE", "SUSPENDED"]).default("ACTIVE"),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({
    code: "INVALID_PARAMS",
    message: parsed.error.issues[0]?.message || "客户资料不完整",
  });
  return res.status(201).json(ok(database.createCustomer(parsed.data)));
});
app.patch("/api/customers/:customerId/status", (req, res) => {
  const parsed = z.object({ status: z.enum(["ACTIVE", "SUSPENDED"]) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ code: "INVALID_PARAMS", message: "客户状态不正确" });
  const customer = database.updateCustomerStatus(req.params.customerId, parsed.data.status);
  if (!customer) return res.status(404).json({ code: "CUSTOMER_NOT_FOUND", message: "客户不存在" });
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
    message: parsed.error.issues[0]?.message || "定价规则不完整",
  });
  return res.status(201).json(ok(database.createPricingRule(parsed.data)));
});
app.patch("/api/pricing-rules/:ruleId/status", (req, res) => {
  const parsed = z.object({ status: z.enum(["ACTIVE", "INACTIVE"]) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ code: "INVALID_PARAMS", message: "规则状态不正确" });
  const rule = database.updatePricingRuleStatus(req.params.ruleId, parsed.data.status);
  if (!rule) return res.status(404).json({ code: "PRICING_RULE_NOT_FOUND", message: "定价规则不存在" });
  return res.json(ok(rule));
});

app.get("/api/finance/summary", (_req, res) => res.json(ok(database.financeSummary())));

app.post("/api/hotels/search", async (req, res) => {
  const parsed = z.object({
    destination: z.string().min(1),
    checkIn: z.string(),
    checkOut: z.string(),
    rooms: z.number().int().min(1).max(8).default(1),
    adults: z.number().int().min(1).max(16).default(2),
    children: z.number().int().min(0).max(8).default(0),
    childAges: z.array(z.number().int().min(0).max(17)).max(8).default([]),
  }).superRefine((value, context) => {
    if (value.children !== value.childAges.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "儿童年龄数量必须与儿童人数一致" });
    }
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ code: "INVALID_PARAMS", message: "请填写完整搜索条件" });
  if (runtime.mode === "mock") {
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
    message: "当前 G-Link 沙箱账号没有已映射的可售酒店，请先由供应商配置测试酒店和库存",
  });
  if (!result.diagnostics.lowestPriceHotelCount) return res.status(409).json({
    code: "GLINK_LOWEST_PRICE_EMPTY",
    message: "已映射酒店在当前入住日期没有返回每日最低价，酒店列表不会展示",
  });
  result.quotes.forEach(quote => hotelQuotes.set(quote.id, quote));
  return res.json(ok(result.offers.map(offer => ({
    ...offer,
    nightlyPrice: database.calculateSaleAmount("hotel", offer.nightlyPrice),
    totalPrice: database.calculateSaleAmount("hotel", offer.totalPrice || offer.nightlyPrice),
  }))));
});

app.post("/api/hotels/filters", async (req, res) => {
  const parsed = z.object({ destinationId: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ code: "INVALID_PARAMS", message: "缺少目的地标识" });
  if (runtime.mode === "mock") return res.json(ok({ stars: [3, 4, 5], facilities: ["免费 Wi-Fi", "停车场", "健身中心"] }));
  const filters = await runtime.glink.glink<unknown>("/search/hotelFilters", { destinationId: parsed.data.destinationId, language: "zh-CN", distance: 10 });
  return res.json(ok(filters));
});

app.post("/api/integration/glink/hotel-increment", async (req, res) => {
  const parsed = z.object({ startTime: z.string().min(1), endTime: z.string().min(1), maxId: z.number().int().min(0).default(0), pageSize: z.number().int().min(100).max(1000).default(100) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ code: "INVALID_PARAMS", message: "增量同步时间范围不正确" });
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
    message: "hotelIds 最多10个，且入住离店日期必须为 yyyy-MM-dd",
  });
  if (runtime.mode === "mock") return res.status(409).json({
    code: "REAL_INTEGRATION_REQUIRED",
    message: "当前为 mock 模式，无法调用 G-Link 每日起价",
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
  if (!parsed.success) return res.status(400).json({ code: "INVALID_PARAMS", message: "缺少酒店报价标识" });
  if (runtime.mode === "mock") {
    const offer = database.findHotel(parsed.data.offerId);
    if (!offer) return res.status(404).json({ code: "OFFER_NOT_FOUND", message: "酒店报价已失效" });
    return res.json(ok({
      ...offer,
      ...hotelStayContexts.get(offer.id),
      nightlyPrice: database.calculateSaleAmount("hotel", offer.nightlyPrice),
      totalPrice: database.calculateSaleAmount(
        "hotel",
        offer.nightlyPrice
          * (hotelStayContexts.get(offer.id)?.nights || 2)
          * (hotelStayContexts.get(offer.id)?.roomNum || 1),
      ),
    }));
  }
  const quote = hotelQuotes.get(parsed.data.offerId);
  if (!quote) return res.status(410).json({ code: "QUOTE_EXPIRED", message: "酒店搜索会话已失效，请重新搜索" });
  try {
    const hydrated = await hydrateGlinkProduct(runtime.glink, quote);
    hotelQuotes.set(hydrated.quote.id, hydrated.quote);
    return res.json(ok({
      ...hydrated.offer,
      nightlyPrice: database.calculateSaleAmount("hotel", hydrated.offer.nightlyPrice),
      totalPrice: database.calculateSaleAmount("hotel", hydrated.offer.totalPrice || hydrated.offer.nightlyPrice),
    }));
  } catch (error) {
    if (sandboxHotelSimulationEnabled && error instanceof GlinkNoProductError) {
      return res.json(ok(simulatedHotelOffer(quote)));
    }
    throw error;
  }
});

app.post("/api/hotels/availability", async (req, res) => {
  const parsed = z.object({ offerId: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ code: "INVALID_PARAMS", message: "缺少房型报价标识" });
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
  if (runtime.mode === "mock") {
    const hotel = database.findHotel(parsed.data.offerId);
    if (!hotel) return res.status(404).json({ code: "OFFER_NOT_FOUND", message: "房型报价已失效，请重新搜索" });
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
  if (!quote) return res.status(410).json({ code: "QUOTE_EXPIRED", message: "房型报价已过期，请重新进入酒店详情" });
  const availability = await checkGlinkAvailability(runtime.glink, quote);
  const supplierAmount = fcgValue.number(availability.totalSalePrice);
  if (supplierAmount <= 0) throw new FcgError("G-Link 验房未返回有效总价", "GLINK_INVALID_AVAILABILITY_PRICE", 422);
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
    nights: hotelNightCount(quote.checkInDate, quote.checkOutDate),
  }));
});

app.post("/api/flights/search", async (req, res) => {
  const parsed = z.object({
    from: z.string().min(3),
    to: z.string().min(3),
    departureDate: z.string(),
    adults: z.number().int().min(1).max(9).default(1),
    children: z.number().int().min(0).max(8).default(0),
    infants: z.number().int().min(0).max(8).default(0),
    tripType: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
    journeys: z.array(z.object({
      origin: z.string().min(3),
      destination: z.string().min(3),
      date: z.string().min(10),
    })).min(1).max(4).optional(),
  }).superRefine((value, context) => {
    const count = value.journeys?.length || 1;
    if (value.tripType === 2 && count !== 2) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "往返行程必须包含去程和返程" });
    }
    if (value.tripType === 3 && count < 2) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "多程行程至少包含两段" });
    }
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ code: "INVALID_PARAMS", message: "请填写完整航班条件" });
  if (runtime.mode === "mock") return res.json(ok(database.listFlights().map(offer => ({
    ...offer,
    price: database.calculateSaleAmount("flight", offer.price),
  }))));
  const result = await searchFlinkFlights(runtime.flink, parsed.data);
  result.quotes.forEach(quote => flightQuotes.set(quote.id, quote));
  return res.json(ok(result.offers.map(offer => ({
    ...offer,
    price: database.calculateSaleAmount("flight", offer.price),
  }))));
});

app.post("/api/flights/verify", async (req, res) => {
  const parsed = z.object({ offerId: z.string().min(1), priceKey: z.string().min(1), quantity: z.number().int().min(1).max(9) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ code: "INVALID_PARAMS", message: "验价参数不完整" });
  if (runtime.mode === "mock") {
    const flight = database.findFlight(parsed.data.offerId);
    if (!flight || flight.priceKey !== parsed.data.priceKey) return res.status(409).json({ code: "PRICE_KEY_EXPIRED", message: "运价已变化，请重新搜索" });
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
  if (!quote || quote.priceKey !== parsed.data.priceKey) return res.status(410).json({ code: "PRICE_KEY_EXPIRED", message: "priceKey 已失效，请重新搜索" });
  let verified;
  try {
    verified = await verifyFlinkFlight(runtime.flink, quote);
  } catch (error) {
    const priceChanged = error instanceof FcgError
      && error.code === "SUPPLIER_BIZ_ERROR"
      && /价格已更新|price.+updated/i.test(error.message);
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
  "酒店入住人英文姓名只能包含英文字母和空格",
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
  contact: z.object({ name: z.string().min(1), phone: z.string().min(8), email: z.string().email() }),
  arriveTime: z.string().regex(/^\d{2}:\d{2}$/),
  latestArriveTime: z.string().regex(/^\d{2}:\d{2}$/),
});
const flightOrderSchema = z.object({
  productType: z.literal("flight"),
  offerId: z.string(),
  customerId: z.string().default("CUS-001"),
  quantity: z.number().int().min(1).max(9).optional(),
  contact: z.object({ name: z.string().min(1), phone: z.string().min(8), email: z.string().email() }),
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

app.get("/api/orders", (_req, res) => res.json(ok(database.listOrders())));
app.get("/api/orders/:orderId", (req, res) => {
  const order = findOrder(req.params.orderId);
  if (!order) return res.status(404).json({ code: "ORDER_NOT_FOUND", message: "订单不存在" });
  return res.json(ok(order));
});
app.get("/api/orders/:orderId/details", (req, res) => {
  const order = findOrder(req.params.orderId);
  if (!order) return res.status(404).json({ code: "ORDER_NOT_FOUND", message: "订单不存在" });
  const snapshots = database.getOrderSnapshots(order.id);
  const contactSnapshot = fcgValue.record(snapshots?.contact);
  const contact = fcgValue.record(contactSnapshot.contact);
  const passengers = fcgValue.array(contactSnapshot.passengers).map(fcgValue.record);
  const guest = fcgValue.record(contactSnapshot.guest);
  const guests = fcgValue.array(contactSnapshot.guests).map(fcgValue.record);
  const productSnapshot = fcgValue.record(snapshots?.product);
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
    email: fcgValue.string(contact.email),
    phone: fcgValue.string(contact.phone),
    documentMasked,
    serviceSummary: order.productType === "flight"
      ? `${passengers.length || 1} 位乘机人 · 退改以航司核算为准`
      : `${guests.length || 1} 间房主要入住人 · 取消以酒店政策为准`,
    ...(order.productType === "hotel" ? {
      hotelStay: {
        checkInDate: fcgValue.string(productSnapshot.checkInDate),
        checkOutDate: fcgValue.string(productSnapshot.checkOutDate),
        nights: fcgValue.number(productSnapshot.nights,
          hotelNightCount(
            fcgValue.string(productSnapshot.checkInDate, "2026-08-12"),
            fcgValue.string(productSnapshot.checkOutDate, "2026-08-14"),
          )),
        roomNum: fcgValue.number(productSnapshot.roomNum, guests.length || 1),
        numberOfAdults: fcgValue.number(productSnapshot.numberOfAdults, guests.length || 1),
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
app.get("/api/orders/:orderId/documents/:type", (req, res) => {
  const order = findOrder(req.params.orderId);
  if (!order) return res.status(404).json({ code: "ORDER_NOT_FOUND", message: "订单不存在" });
  const type = z.enum(["confirmation", "receipt", "ticket"]).safeParse(req.params.type);
  if (!type.success) return res.status(404).json({ code: "DOCUMENT_NOT_FOUND", message: "文档类型不存在" });
  if (type.data === "ticket" && (order.productType !== "flight" || order.status !== "TICKETED")) {
    return res.status(409).json({ code: "TICKET_NOT_READY", message: "航司尚未出票，电子客票暂不可下载" });
  }
  const labels = {
    confirmation: "预订确认单",
    receipt: "电子收据",
    ticket: "电子客票",
  } as const;
  const document = [
    `FusionGo ${labels[type.data]}`,
    `订单号：${order.id}`,
    `产品：${order.title}`,
    `行程：${order.subtitle}`,
    `金额：${order.currency} ${order.amount.toFixed(2)}`,
    `状态：${order.status}`,
    `生成时间：${new Date().toISOString()}`,
  ].join("\n");
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${order.id}-${type.data}.txt"`);
  return res.send(document);
});
app.get("/api/orders/:orderId/history", (req, res) => {
  const order = findOrder(req.params.orderId);
  if (!order) return res.status(404).json({ code: "ORDER_NOT_FOUND", message: "订单不存在" });
  return res.json(ok(database.listOrderEvents(order.id)));
});

app.post("/api/orders", async (req, res) => {
  const idempotencyKey = fcgValue.string(req.headers["idempotency-key"]).trim();
  if (idempotencyKey.length > 160) return res.status(400).json({
    code: "INVALID_IDEMPOTENCY_KEY",
    message: "Idempotency-Key 长度不能超过160个字符",
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
    message: parsed.error.issues[0]?.message || "订单参数不完整",
  });
  const customer = database.findCustomer(parsed.data.customerId);
  if (!customer) return res.status(404).json({
    code: "CUSTOMER_NOT_FOUND",
    message: "预订客户不存在",
  });
  if (customer.status !== "ACTIVE") return res.status(409).json({
    code: "CUSTOMER_SUSPENDED",
    message: "该客户已停用，不能创建新订单",
  });

  const hotelGuests = parsed.data.productType === "hotel"
    ? parsed.data.guests?.length
      ? parsed.data.guests
      : parsed.data.guest
        ? [{ roomIndex: 1, ...parsed.data.guest }]
        : []
    : [];
  if (parsed.data.productType === "hotel" && !hotelGuests.length) {
    return res.status(400).json({ code: "INVALID_PARAMS", message: "请至少填写一间房的入住人" });
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
        message: `当前预订包含 ${roomNum} 间房，请为每间房填写一位主要入住人`,
      });
      const availability = database.getHotelAvailability(hotel.id);
      if (!availability) return res.status(409).json({
        code: "AVAILABILITY_CHECK_REQUIRED",
        message: "请先执行模拟验房，验房结果有效期为15分钟",
      });
      const order: DistributionOrder = {
        id: localOrderId(),
        productType: "hotel",
        title: hotel.name,
        subtitle: `${hotel.checkInDate || ""} 至 ${hotel.checkOutDate || ""} · ${roomNum}间 · ${hotel.nights || 2}晚`,
        customer: customer.name,
        amount: availability.amount,
        currency: availability.currency,
        status: "PENDING_PAYMENT",
        createdAt: "刚刚",
      };
      const persisted = database.insertOrder({
        order,
        supplier: "GLINK",
        bridgeKey: hotel.id,
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

  if (runtime.mode === "mock") {
    if (parsed.data.productType === "hotel") {
      const hotel = database.findHotel(parsed.data.offerId);
      if (!hotel) return res.status(404).json({ code: "OFFER_NOT_FOUND", message: "酒店报价已失效，请重新搜索" });
      const availability = database.getHotelAvailability(hotel.id);
      if (!availability) return res.status(409).json({
        code: "AVAILABILITY_CHECK_REQUIRED",
        message: "请先执行酒店验房，验房结果有效期为15分钟",
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
        message: `当前预订包含 ${stayContext.roomNum} 间房，请为每间房填写一位主要入住人`,
      });
      const order: DistributionOrder = {
        id: localOrderId(),
        productType: "hotel",
        title: hotel.name,
        subtitle: `${stayContext.checkInDate} 至 ${stayContext.checkOutDate} · ${stayContext.roomNum}间 · ${stayContext.nights}晚`,
        customer: customer.name,
        amount: availability.amount,
        currency: availability.currency,
        status: "PENDING_PAYMENT",
        createdAt: "刚刚",
      };
      const persisted = database.insertOrder({
        order,
        supplier: "GLINK",
        bridgeKey: hotel.id,
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

    const flight = database.findFlight(parsed.data.offerId);
    if (!flight) return res.status(404).json({ code: "OFFER_NOT_FOUND", message: "机票报价已失效，请重新搜索" });
    const verification = database.getFlightVerification(flight.id, flight.priceKey);
    if (!verification) return res.status(409).json({
      code: "VERIFY_REQUIRED",
      message: "请先执行 F-Link 实时验价，priceKey 有效期为15分钟",
    });
    if (parsed.data.passengers.length !== verification.quantity) return res.status(400).json({
      code: "PASSENGER_COUNT_MISMATCH",
      message: "乘机人数与验价人数不一致",
    });
    const order: DistributionOrder = {
      id: localOrderId(),
      productType: "flight",
      title: `${flight.departureAirport.split(" ")[0]} → ${flight.arrivalAirport.split(" ")[0]}`,
      subtitle: `${flight.flightNo} · 8月12日`,
      customer: customer.name,
      amount: verification.amount + addOnAmount(parsed.data.addOns),
      currency: verification.currency,
      status: "PENDING_PAYMENT",
      createdAt: "刚刚",
    };
    const persisted = database.insertOrder({
      order,
      supplier: "FLINK",
      bridgeKey: flight.priceKey,
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
    const quote = hotelQuotes.get(parsed.data.offerId);
    if (!quote) return res.status(410).json({ code: "QUOTE_EXPIRED", message: "酒店报价已过期，请重新验房" });
    if (!validateHotelGuests(quote.roomNum)) return res.status(400).json({
      code: "HOTEL_GUEST_ROOM_MISMATCH",
      message: `当前预订包含 ${quote.roomNum} 间房，请为每间房填写一位主要入住人`,
    });
    const firstAvailability = database.getHotelAvailability(parsed.data.offerId);
    if (!firstAvailability || firstAvailability.quantity !== quote.roomNum) {
      return res.status(409).json({
        code: "AVAILABILITY_CHECK_REQUIRED",
        message: "创建订单前必须先完成一次 G-Link 实时验房，且预订间数必须一致",
      });
    }
    // Mandatory second availability check immediately before creating the supplier order.
    const availability = await checkGlinkAvailability(runtime.glink, quote);
    const currentSupplierAmount = fcgValue.number(availability.totalSalePrice);
    if (currentSupplierAmount <= 0) throw new FcgError(
      "G-Link 二次验房未返回有效总价",
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
        message: `酒店价格已由 ${firstAvailability.currency} ${firstAvailability.amount.toFixed(2)} 变为 ${quote.currency} ${currentSaleAmount.toFixed(2)}，请确认新价格后重新提交`,
      });
    }
    const currentAmount = database.calculateSaleAmount("hotel", currentSupplierAmount);
    const partnerOrderCode = coOrderCode();
    const order: DistributionOrder = {
      id: localOrderId(),
      productType: "hotel",
      title: quote.hotelName,
      subtitle: `${quote.checkInDate} 至 ${quote.checkOutDate} · ${quote.roomNum}间`,
      customer: customer.name,
      amount: currentAmount,
      currency: quote.currency,
      status: "PENDING_PAYMENT",
      createdAt: "刚刚",
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
        fcgValue.string(created.message, "G-Link 创建订单失败"),
        "GLINK_CREATE_FAILED",
        422,
      );
      const supplierOrderNo = fcgValue.string(created.fcOrderCode);
      if (!supplierOrderNo) throw new FcgError(
        "G-Link 创建成功但未返回 fcOrderCode",
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
  if (!quote) return res.status(410).json({ code: "PRICE_KEY_EXPIRED", message: "机票运价已失效，请重新搜索并验价" });
  if (!quote.verifiedAt || Date.now() - quote.verifiedAt > 15 * 60_000) return res.status(409).json({ code: "VERIFY_REQUIRED", message: "请重新执行 F-Link 实时验价" });
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
    return res.status(400).json({ code: "PASSENGER_COUNT_MISMATCH", message: "成人、儿童或婴儿人数与验价人数不一致" });
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
    createdAt: "刚刚",
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
    if (!orderNo) throw new FcgError("F-Link 未返回订单号", "FLINK_CREATE_FAILED", 422);
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
  const order = findOrder(req.params.orderId);
  if (!order) return res.status(404).json({ code: "ORDER_NOT_FOUND", message: "订单不存在" });
  if (order.status !== "PENDING_PAYMENT") return res.status(409).json({
    code: "ORDER_STATUS_CONFLICT",
    message: `当前订单状态 ${order.status} 不允许重复支付`,
  });
  const upstream = database.getUpstreamContext(order.id);
  const payment = z.object({ paymentMethod: z.enum(["credit", "card"]).default("credit") }).safeParse(req.body || {});
  if (!payment.success) return res.status(400).json({ code: "INVALID_PAYMENT_METHOD", message: "不支持的支付方式" });
  if (runtime.mode === "production" && payment.data.paymentMethod === "card" && process.env.PAYMENT_CARD_ENABLED !== "true") {
    return res.status(409).json({
      code: "PAYMENT_CHANNEL_UNAVAILABLE",
      message: "生产环境尚未启用银行卡收单，请改用企业授信账户",
    });
  }
  if (payment.data.paymentMethod === "credit") {
    if (runtime.mode === "production"
      && order.currency !== "CNY"
      && process.env.ALLOW_FOREIGN_CURRENCY_CREDIT !== "true") {
      return res.status(409).json({
        code: "FOREIGN_CURRENCY_CREDIT_UNAVAILABLE",
        message: "生产环境未配置外币授信结算，不允许直接使用 CNY 授信支付外币订单",
      });
    }
    if (order.currency === "CNY" && !database.hasAvailableCredit(order.customer, order.amount)) {
      return res.status(409).json({
        code: "INSUFFICIENT_CREDIT",
        message: "客户可用授信额度不足",
      });
    }
  }
  if (runtime.mode === "mock" || upstream?.simulated) {
    const supplierOrderNo = `${order.productType === "hotel" ? "FCG-H" : "FL"}-${Math.floor(10000000 + Math.random() * 89999999)}`;
    if (payment.data.paymentMethod === "credit"
      && order.currency === "CNY"
      && !database.consumeCustomerCredit(order.customer, order.amount)) {
      throw new FcgError("客户授信扣减失败，请人工核对订单", "CREDIT_CAPTURE_FAILED", 409);
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
  if (!upstream) return res.status(409).json({ code: "UPSTREAM_ORDER_MISSING", message: "未找到上游订单上下文" });
  let nextStatus: OrderStatus;
  let detailPending = false;
  let detailError: { code: string; message: string } | undefined;
  if (upstream.productType === "hotel") {
    const paid = fcgValue.record(await runtime.glink.glink<unknown>("/booking/payOrder", { coOrderCode: upstream.coOrderCode, fcOrderCode: upstream.fcOrderCode }));
    if (fcgValue.number(paid.payStatus) !== 1) throw new FcgError(fcgValue.string(paid.message, "G-Link 支付受理失败"), "GLINK_PAY_FAILED", 422);
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
    throw new FcgError("供应商已受理支付，但客户授信扣减失败，请立即人工核对", "CREDIT_CAPTURE_FAILED", 500);
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

const changeStatusLabels = ["待审核", "待支付", "审核拒绝", "改签出票中", "改签完成", "已取消"];
const refundStatusLabels = ["待审核", "待确认", "审核拒绝", "退款中", "退款完成", "已撤销"];
const contactSchema = z.object({
  name: z.string().min(1).max(50),
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
    ? "该客票已经完成退票，不能再次申请退改"
    : !ticketed
    ? "航司尚未出票，出票完成后才可申请退票或改签"
    : activeChange
      ? "当前已有改签单在处理中"
      : activeRefund
        ? "当前已有退票单在处理中"
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
        statusLabel: changeStatusLabels[change.status] || `状态 ${change.status}`,
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
        statusLabel: refundStatusLabels[refund.status] || `状态 ${refund.status}`,
        amount: refund.refundMoney,
        currency: refund.currency,
        rejectReason: refund.rejectReason,
        updatedAt: refund.updatedAt,
      },
    } : {}),
  };
};

async function loadFlightAfterSales(orderId: string) {
  const order = findOrder(orderId);
  if (!order) throw new FcgError("订单不存在", "ORDER_NOT_FOUND", 404);
  if (order.productType !== "flight") throw new FcgError("只有机票订单支持退改签", "PRODUCT_TYPE_CONFLICT", 409);
  const upstream = database.getUpstreamContext(order.id);
  if (!upstream) throw new FcgError("未找到上游订单上下文", "UPSTREAM_ORDER_MISSING", 409);
  if (!upstream.orderNo && runtime.mode !== "mock") {
    throw new FcgError("未找到 F-Link 上游订单号", "UPSTREAM_ORDER_MISSING", 409);
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
      reason: "供应商订单详情不满足退改出票条件",
    });
  }
  return { order: findOrder(order.id)!, upstream, source };
}

app.get("/api/orders/:orderId/flight-aftersales", async (req, res) => {
  const context = await loadFlightAfterSales(req.params.orderId);
  return res.json(ok(publicAfterSalesContext(context.order, context.upstream, context.source)));
});

app.post("/api/orders/:orderId/flight-aftersales/change/search", async (req, res) => {
  const parsed = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    passengerCodes: z.array(z.string().min(1)).min(1).max(9),
    segmentIds: z.array(z.string().min(1)).min(1).max(9),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ code: "INVALID_PARAMS", message: "请选择旅客、原航段和新日期" });
  const context = await loadFlightAfterSales(req.params.orderId);
  const publicContext = publicAfterSalesContext(context.order, context.upstream, context.source);
  if (!publicContext.eligible) return res.status(409).json({
    code: "AFTERSALES_NOT_ELIGIBLE",
    message: publicContext.eligibilityReason,
  });
  if (!parsed.data.passengerCodes.every(code => context.source.passengers.some(item => item.passengerCode === code))
    || !parsed.data.segmentIds.every(id => context.source.segments.some(item => item.segmentId === id))) {
    return res.status(400).json({ code: "INVALID_BRIDGE_IDENTIFIER", message: "旅客或航段标识不属于当前订单" });
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
  if (!parsed.success) return res.status(400).json({ code: "INVALID_PARAMS", message: "改签申请资料不完整" });
  if (parsed.data.reasonType === 2 && !parsed.data.evidenceFiles.length) {
    return res.status(400).json({ code: "EVIDENCE_REQUIRED", message: "非自愿改签必须提供航变或证明材料链接" });
  }
  const context = await loadFlightAfterSales(req.params.orderId);
  const existing = context.upstream.afterSales?.change;
  if (existing && [0, 1, 3].includes(existing.status) && existing.priceKey === parsed.data.priceKey) {
    return res.json(ok(publicAfterSalesContext(context.order, context.upstream, context.source)));
  }
  if (existing && [0, 1, 3].includes(existing.status)) {
    return res.status(409).json({ code: "CHANGE_ALREADY_ACTIVE", message: "当前已有改签单在处理中" });
  }
  const quote = flightChangeQuotes.get(parsed.data.priceKey);
  if (!quote || quote.expiresAt < Date.now() || quote.orderId !== context.order.id
    || quote.passengerCode !== parsed.data.passengerCodes.join(",") || quote.segmentId !== parsed.data.segmentIds.join(",")) {
    return res.status(410).json({ code: "CHANGE_QUOTE_EXPIRED", message: "改签报价已过期，请重新查询" });
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
  if (!current) throw new FcgError("当前订单没有改签申请", "CHANGE_ORDER_MISSING", 409);
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
  const context = await loadFlightAfterSales(req.params.orderId);
  return res.json(ok(await syncFlightChange(context)));
});

app.post("/api/orders/:orderId/flight-aftersales/change/pay", async (req, res) => {
  const context = await loadFlightAfterSales(req.params.orderId);
  const current = context.upstream.afterSales?.change;
  if (!current) return res.status(409).json({ code: "CHANGE_ORDER_MISSING", message: "当前订单没有改签申请" });
  if (current.status !== 1) return res.status(409).json({ code: "CHANGE_STATUS_CONFLICT", message: "只有审核通过、待支付的改签单可以支付" });
  const detail = runtime.mode === "mock" ? { priceTotal: current.amount, currency: current.currency } : await getFlinkChangeDetail(runtime.flink, current.changeOrderNo);
  const amount = fcgValue.number(detail.priceTotal, current.amount);
  if (amount < 0) throw new FcgError("改签差价金额无效", "INVALID_CHANGE_AMOUNT", 422);
  const reserveCredit = context.order.currency === "CNY" && amount > 0;
  if (reserveCredit && !database.consumeCustomerCredit(context.order.customer, amount)) {
    throw new FcgError("客户可用授信不足，无法支付改签差价", "INSUFFICIENT_CREDIT", 409);
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
  const context = await loadFlightAfterSales(req.params.orderId);
  const current = context.upstream.afterSales?.change;
  if (!current) return res.status(409).json({ code: "CHANGE_ORDER_MISSING", message: "当前订单没有改签申请" });
  if (![0, 1].includes(current.status)) return res.status(409).json({ code: "CHANGE_STATUS_CONFLICT", message: "当前改签状态不允许取消" });
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
  const parsed = z.object({
    passengerCodes: z.array(z.string().min(1)).min(1).max(9),
    segmentIds: z.array(z.string().min(1)).min(1).max(9),
    refundType: z.union([z.literal(1), z.literal(2)]).default(1),
    reason: z.string().min(2).max(300),
    evidenceFiles: z.array(z.string().url()).max(5).default([]),
    contact: contactSchema,
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ code: "INVALID_PARAMS", message: "退票申请资料不完整" });
  if (parsed.data.refundType === 2 && !parsed.data.evidenceFiles.length) {
    return res.status(400).json({ code: "EVIDENCE_REQUIRED", message: "非自愿退票必须提供航变或证明材料链接" });
  }
  const context = await loadFlightAfterSales(req.params.orderId);
  const existing = context.upstream.afterSales?.refund;
  if (existing && [0, 1, 3].includes(existing.status)) {
    return res.json(ok(publicAfterSalesContext(context.order, context.upstream, context.source)));
  }
  const publicContext = publicAfterSalesContext(context.order, context.upstream, context.source);
  if (!publicContext.eligible) return res.status(409).json({ code: "AFTERSALES_NOT_ELIGIBLE", message: publicContext.eligibilityReason });
  if (!parsed.data.passengerCodes.every(code => context.source.passengers.some(item => item.passengerCode === code))
    || !parsed.data.segmentIds.every(id => context.source.segments.some(item => item.segmentId === id))) {
    return res.status(400).json({ code: "INVALID_BRIDGE_IDENTIFIER", message: "旅客或航段标识不属于当前订单" });
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
  if (!current) throw new FcgError("当前订单没有退票申请", "REFUND_ORDER_MISSING", 409);
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
  const context = await loadFlightAfterSales(req.params.orderId);
  return res.json(ok(await syncFlightRefund(context)));
});

app.post("/api/orders/:orderId/flight-aftersales/refund/confirm", async (req, res) => {
  const parsed = z.object({ confirm: z.enum(["1", "2"]) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ code: "INVALID_PARAMS", message: "确认参数不正确" });
  const context = await loadFlightAfterSales(req.params.orderId);
  const current = context.upstream.afterSales?.refund;
  if (!current) return res.status(409).json({ code: "REFUND_ORDER_MISSING", message: "当前订单没有退票申请" });
  if (current.status !== 1) return res.status(409).json({ code: "REFUND_STATUS_CONFLICT", message: "只有待确认退票单可以确认或撤销" });
  if (parsed.data.confirm === "1" && current.refundMoney === undefined) return res.status(409).json({
    code: "REFUND_AMOUNT_MISSING",
    message: "供应商尚未返回退款金额，请刷新退票单后再确认",
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
    throw new FcgError("未支付订单不会调用供应商订单详情补偿查询", "ORDER_NOT_PAID", 409);
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
  if (!upstream) throw new FcgError("未找到上游订单上下文", "UPSTREAM_ORDER_MISSING", 409);
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
  const order = findOrder(req.params.orderId);
  if (!order) return res.status(404).json({ code: "ORDER_NOT_FOUND", message: "订单不存在" });
  return res.json(ok(await refreshOrderFromSupplier(order)));
});

async function cancelOrderWithSupplier(order: DistributionOrder, reason: string) {
  if (["CANCELLED", "TICKETED", "CHANGING", "REFUNDING", "REFUNDED"].includes(order.status)) {
    throw new FcgError(
      `当前订单状态 ${order.status} 不允许取消`,
      "ORDER_STATUS_CONFLICT",
      409,
    );
  }
  const upstream = database.getUpstreamContext(order.id);
  let cancellationPending = false;
  if (runtime.mode !== "mock" && !upstream?.simulated) {
    if (!upstream) throw new FcgError("未找到上游订单上下文", "UPSTREAM_ORDER_MISSING", 409);
    if (upstream.productType === "hotel") {
      const cancelled = fcgValue.record(await runtime.glink.glink<unknown>("/order/cancelOrder", {
        coOrderCode: upstream.coOrderCode,
        fcOrderCode: upstream.fcOrderCode,
        cancelReason: reason,
      }));
      const cancelStatus = mapGlinkCancelResult(cancelled.cancelResult);
      if (cancelStatus === "REFUSED") {
        throw new FcgError(
          fcgValue.string(cancelled.message, "G-Link 拒绝取消订单"),
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
  const order = findOrder(req.params.orderId);
  if (!order) return res.status(404).json({ code: "ORDER_NOT_FOUND", message: "订单不存在" });
  const result = await cancelOrderWithSupplier(
    order,
    fcgValue.string(req.body?.reason, "客户主动取消"),
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
      const result = await cancelOrderWithSupplier(order, `超过${unpaidTimeoutMinutes}分钟未支付，系统自动取消`);
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
      return res.status(401).json({ code: "UNAUTHORIZED", message: "维护任务密钥不正确" });
    }
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
  if (!parsed.success) return res.status(400).json({ code: "INVALID_CALLBACK", message: "回调报文不符合 OpenAPI 契约" });
  const eventKey = parsed.data.idempotency_key || parsed.data.event_id;
  if (runtime.mode !== "mock") {
    if (parsed.data.env_type !== runtime.environment) return res.status(409).json({
      code: "WEBHOOK_ENVIRONMENT_MISMATCH",
      message: `回调环境 ${parsed.data.env_type || "missing"} 与当前服务环境 ${runtime.environment} 不一致`,
    });
    if (fcgValue.string(req.headers["x-op-webhook-event-id"]) !== parsed.data.event_id
      || fcgValue.string(req.headers["x-op-webhook-type"]) !== parsed.data.event_type) {
      return res.status(400).json({
        code: "WEBHOOK_HEADER_MISMATCH",
        message: "Webhook 事件头与请求体不一致",
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
    if (!verification.valid) return res.status(401).json({ code: verification.code, message: "Webhook 签名验证失败" });
    const nonce = fcgValue.string(req.headers["x-op-nonce"]);
    if (!database.registerWebhookNonce("GLINK", nonce)) {
      if (database.hasWebhookEvent("GLINK", eventKey)) {
        return res.json(ok({ accepted: true, duplicate: true }));
      }
      return res.status(409).json({ code: "WEBHOOK_NONCE_REPLAY", message: "Webhook nonce 已使用" });
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
    return res.status(413).json({ code: "AVATAR_TOO_LARGE", message: "头像不能超过 2 MB" });
  }
  if (error instanceof FcgError) {
    return res.status(error.status >= 400 && error.status < 600 ? error.status : 502).json({
      code: error.code,
      message: error.message,
      requestId: error.requestId,
      traceId: error.traceId,
    });
  }
  const message = error instanceof Error ? error.message : "服务暂时不可用";
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
app.use((_req, res) => res.status(404).json({ code: "NOT_FOUND", message: "接口不存在" }));

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

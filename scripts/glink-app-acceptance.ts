import "dotenv/config";
import { randomUUID } from "node:crypto";
import type { DistributionOrder, HotelOffer } from "../src/types.js";

type Envelope<T> = {
  code: string;
  message: string;
  data: T;
};

const baseUrl = (process.env.LOCAL_API_URL || "http://127.0.0.1:8787").replace(/\/$/, "");

async function request<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const body = await response.json() as Envelope<T>;
  if (!response.ok || body.code !== "SUCCESS") {
    throw new Error(`${path}: HTTP ${response.status} ${body.code} ${body.message}`);
  }
  return {
    data: body.data,
    status: response.status,
    idempotencyReplayed: response.headers.get("idempotency-replayed") === "true",
  };
}

const post = <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
  request<T>(path, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
    headers,
  });

const integration = await request<{
  mode: string;
  environment: string;
  glinkConfigured: boolean;
}>("/api/integration/status");
if (integration.data.mode !== "sandbox" || integration.data.environment !== "sandbox") {
  throw new Error("Application G-Link acceptance only runs in the sandbox environment");
}
if (!integration.data.glinkConfigured) throw new Error("Application API has no G-Link sandbox credentials");

const search = await post<HotelOffer[]>("/api/hotels/search", {
  destination: "Shanghai",
  checkIn: "2026-08-06",
  checkOut: "2026-08-07",
  rooms: 1,
  adults: 1,
});
if (!search.data.length) throw new Error("Application search returned no G-Link hotel offers");

let selected: HotelOffer | undefined;
const productFailures: Array<{ offerId: string; message: string }> = [];
for (const hotel of search.data) {
  try {
    const product = await post<HotelOffer>("/api/hotels/product-details", {
      offerId: hotel.id,
    });
    await post("/api/hotels/availability", { offerId: product.data.id });
    selected = product.data;
    break;
  } catch (error) {
    productFailures.push({
      offerId: hotel.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
if (!selected) throw new Error(`No application offer passed product and availability: ${JSON.stringify(productFailures)}`);

const orderPayload = {
  productType: "hotel" as const,
  offerId: selected.id,
  guest: { firstName: "TEST", lastName: "GUEST" },
  contact: {
    name: "TEST GUEST",
    phone: "13800138000",
    email: "glink-app-acceptance@example.com",
  },
  arriveTime: "18:00",
  latestArriveTime: "23:00",
};

const paidIdempotencyKey = `glink-app-paid-${randomUUID()}`;
const createdPaid = await post<DistributionOrder>("/api/orders", orderPayload, {
  "Idempotency-Key": paidIdempotencyKey,
});
const replayedPaid = await post<DistributionOrder>("/api/orders", orderPayload, {
  "Idempotency-Key": paidIdempotencyKey,
});
if (!replayedPaid.idempotencyReplayed || replayedPaid.data.id !== createdPaid.data.id) {
  throw new Error("Local create-order idempotency replay did not return the original order");
}
const paid = await post<DistributionOrder>(`/api/orders/${createdPaid.data.id}/pay`, {
  paymentMethod: "credit",
});
const refreshed = await post<DistributionOrder>(`/api/orders/${createdPaid.data.id}/refresh`);

// Create a separate unpaid order through the application and cancel it upstream.
await post("/api/hotels/availability", { offerId: selected.id });
const createdCancellation = await post<DistributionOrder>("/api/orders", orderPayload, {
  "Idempotency-Key": `glink-app-cancel-${randomUUID()}`,
});
const cancelled = await post<DistributionOrder>(
  `/api/orders/${createdCancellation.data.id}/cancel`,
  { reason: "G-Link application sandbox acceptance" },
);

const paidHistory = await request<Array<{ eventType: string }>>(
  `/api/orders/${createdPaid.data.id}/history`,
);
const cancelledHistory = await request<Array<{ eventType: string }>>(
  `/api/orders/${createdCancellation.data.id}/history`,
);
const database = await request<{
  counts: { orders: number; payments: number; events: number; webhooks: number };
}>("/api/database/status");

console.log(JSON.stringify({
  ok: true,
  environment: integration.data.environment,
  searchOfferCount: search.data.length,
  selectedOffer: {
    id: selected.id,
    hotel: selected.name,
    room: selected.roomName,
    price: selected.nightlyPrice,
    currency: selected.currency,
  },
  paidOrder: {
    localOrderId: paid.data.id,
    supplierOrderNo: paid.data.supplierOrderNo,
    statusAfterPayment: paid.data.status,
    statusAfterRefresh: refreshed.data.status,
    idempotencyReplay: replayedPaid.idempotencyReplayed,
    events: paidHistory.data.map(event => event.eventType),
  },
  cancelledOrder: {
    localOrderId: cancelled.data.id,
    supplierOrderNo: cancelled.data.supplierOrderNo,
    status: cancelled.data.status,
    events: cancelledHistory.data.map(event => event.eventType),
  },
  database: database.data,
  productFailures,
}, null, 2));

import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DistributionOrder, FlightOffer, HotelOffer } from "../src/types.js";

process.env.FCG_MODE = "mock";
process.env.FCG_ENV = "test";
process.env.DATABASE_PATH = ":memory:";

let server: Server;
let baseUrl = "";
let database: typeof import("../server/index.js").database;

type ApiResponse<T> = {
  response: Response;
  body: { code: string; message: string; data: T };
};

async function request<T>(path: string, init?: RequestInit): Promise<ApiResponse<T>> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await response.json() as ApiResponse<T>["body"];
  return { response, body };
}

const post = <T>(path: string, data?: unknown) => request<T>(path, {
  method: "POST",
  body: data === undefined ? undefined : JSON.stringify(data),
});

beforeAll(async () => {
  const module = await import("../server/index.js");
  database = module.database;
  database.resetAndSeed();
  server = await new Promise<Server>(resolve => {
    const running = module.app.listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${(running.address() as AddressInfo).port}`;
      resolve(running);
    });
  });
});

afterAll(async () => {
  if (!server || !database || !server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
  database.close();
});

describe("mock hotel integration", () => {
  it("enforces availability check and persists the complete payment flow", async () => {
    const search = await post<HotelOffer[]>("/api/hotels/search", {
      destination: "上海",
      checkIn: "2026-08-12",
      checkOut: "2026-08-14",
    });
    expect(search.response.status).toBe(200);
    const hotel = search.body.data[0];

    const payload = {
      productType: "hotel",
      offerId: hotel.id,
      guest: { firstName: "JIACHENG", lastName: "LIN" },
      contact: { name: "林嘉诚", phone: "13800008866", email: "lin@example.com" },
      arriveTime: "18:00",
      latestArriveTime: "20:00",
    };
    const blocked = await post("/api/orders", payload);
    expect(blocked.response.status).toBe(409);
    expect(blocked.body.code).toBe("AVAILABILITY_CHECK_REQUIRED");

    const availability = await post("/api/hotels/availability", { offerId: hotel.id });
    expect(availability.response.status).toBe(200);
    const idempotencyKey = "flight-create-integration-001";
    const created = await request<DistributionOrder>("/api/orders", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(payload),
    });
    expect(created.response.status).toBe(201);
    const replayed = await request<DistributionOrder>("/api/orders", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(payload),
    });
    expect(replayed.response.status).toBe(200);
    expect(replayed.response.headers.get("Idempotency-Replayed")).toBe("true");
    expect(replayed.body.data.id).toBe(created.body.data.id);
    expect(created.body.data.status).toBe("PENDING_PAYMENT");

    const paid = await post<DistributionOrder>(`/api/orders/${created.body.data.id}/pay`);
    expect(paid.body.data.status).toBe("PROCESSING");
    expect(paid.body.data.supplierOrderNo).toMatch(/^FCG-H-/);

    const refreshed = await post<DistributionOrder>(`/api/orders/${created.body.data.id}/refresh`);
    expect(refreshed.body.data.status).toBe("CONFIRMED");
    const history = await request<Array<{ eventType: string }>>(
      `/api/orders/${created.body.data.id}/history`,
    );
    expect(history.body.data.map(event => event.eventType)).toEqual([
      "ORDER_CREATED",
      "PAYMENT_ACCEPTED",
      "SUPPLIER_STATUS_SYNCED",
    ]);
  });

  it("books multiple rooms across multiple nights with one primary guest per room", async () => {
    const search = await post<HotelOffer[]>("/api/hotels/search", {
      destination: "上海",
      checkIn: "2026-09-10",
      checkOut: "2026-09-13",
      rooms: 2,
      adults: 4,
    });
    const listed = search.body.data[0];
    expect(listed).toMatchObject({ roomNum: 2, numberOfAdults: 4, nights: 3 });

    const product = await post<HotelOffer>("/api/hotels/product-details", { offerId: listed.id });
    expect(product.body.data).toMatchObject({
      checkInDate: "2026-09-10",
      checkOutDate: "2026-09-13",
      roomNum: 2,
      nights: 3,
    });
    const availability = await post<{ price: number }>("/api/hotels/availability", { offerId: listed.id });
    expect(availability.body.data.price).toBe(product.body.data.totalPrice);

    const created = await post<DistributionOrder>("/api/orders", {
      productType: "hotel",
      offerId: listed.id,
      guests: [
        { roomIndex: 1, firstName: "SAN", lastName: "ZHANG" },
        { roomIndex: 2, firstName: "SI", lastName: "LI" },
      ],
      contact: { name: "测试联系人", phone: "13800008866", email: "hotel@example.com" },
      arriveTime: "18:00",
      latestArriveTime: "20:00",
    });
    expect(created.response.status).toBe(201);
    expect(created.body.data.subtitle).toContain("2间 · 3晚");
    expect(created.body.data.amount).toBe(availability.body.data.price);

    const details = await request<{
      hotelStay: {
        roomNum: number;
        nights: number;
        numberOfAdults: number;
        numberOfChildren: number;
        childrenAges: number[];
        guests: Array<{ roomIndex: number; name: string }>;
      };
    }>(`/api/orders/${created.body.data.id}/details`);
    expect(details.body.data.hotelStay).toEqual({
      checkInDate: "2026-09-10",
      checkOutDate: "2026-09-13",
      roomNum: 2,
      nights: 3,
      numberOfAdults: 4,
      numberOfChildren: 0,
      childrenAges: [],
      guests: [
        { roomIndex: 1, name: "ZHANG SAN" },
        { roomIndex: 2, name: "LI SI" },
      ],
    });
  });

  it("rejects hotel guest names containing characters unsupported by G-Link", async () => {
    const invalid = await post("/api/orders", {
      productType: "hotel",
      offerId: "invalid-name-is-rejected-before-quote-lookup",
      guests: [{ roomIndex: 1, firstName: "TEST1", lastName: "GUEST" }],
      contact: { name: "测试联系人", phone: "13800008866", email: "hotel@example.com" },
      arriveTime: "18:00",
      latestArriveTime: "20:00",
    });
    expect(invalid.response.status).toBe(400);
    expect(invalid.body.code).toBe("INVALID_PARAMS");
    expect(invalid.body.message).toContain("只能包含英文字母和空格");
  });
});

describe("mock flight integration", () => {
  it("requires priceKey verification and reaches ticketed status", async () => {
    const search = await post<FlightOffer[]>("/api/flights/search", {
      from: "SHA",
      to: "HKG",
      departureDate: "2026-08-12",
      adults: 1,
    });
    const flight = search.body.data[0];
    const payload = {
      productType: "flight",
      offerId: flight.id,
      quantity: 1,
      contact: { name: "LIN/JIACHENG", phone: "13800008866", email: "lin@example.com" },
      passengers: [{
        surname: "LIN",
        name: "JIACHENG",
        nationality: "CN",
        gender: "1",
        idType: "2",
        idNumber: "E12345678",
        birthday: "1990-06-18",
        expiration: "2031-08-20",
      }],
      addOns: { baggage: true, seat: true, insurance: true },
      paymentMethod: "credit",
    };
    const blocked = await post("/api/orders", payload);
    expect(blocked.response.status).toBe(409);
    expect(blocked.body.code).toBe("VERIFY_REQUIRED");

    const verified = await post<{ totalAmount: number }>("/api/flights/verify", {
      offerId: flight.id,
      priceKey: flight.priceKey,
      quantity: 1,
    });
    expect(verified.response.status).toBe(200);
    const created = await post<DistributionOrder>("/api/orders", payload);
    expect(created.response.status).toBe(201);
    expect(created.body.data.amount).toBe(verified.body.data.totalAmount + 408);
    const bookingDetails = await request<{
      travelerName: string;
      contactName: string;
      documentMasked: string;
    }>(`/api/orders/${created.body.data.id}/details`);
    expect(bookingDetails.body.data).toMatchObject({
      travelerName: "LIN/JIACHENG",
      contactName: "LIN/JIACHENG",
      documentMasked: "E1*****78",
    });

    const paid = await post<DistributionOrder>(`/api/orders/${created.body.data.id}/pay`);
    expect(paid.body.data.status).toBe("PROCESSING");
    expect(paid.body.data.amount).toBe(created.body.data.amount);
    const repeatedPay = await post(`/api/orders/${created.body.data.id}/pay`);
    expect(repeatedPay.response.status).toBe(409);

    const refreshed = await post<DistributionOrder>(`/api/orders/${created.body.data.id}/refresh`);
    expect(refreshed.body.data.status).toBe("TICKETED");

    const afterSales = await request<{
      eligible: boolean;
      passengers: Array<{ passengerCode: string }>;
      segments: Array<{ segmentId: string }>;
    }>(`/api/orders/${created.body.data.id}/flight-aftersales`);
    expect(afterSales.body.data.eligible).toBe(true);
    const passengerCode = afterSales.body.data.passengers[0].passengerCode;
    const segmentId = afterSales.body.data.segments[0].segmentId;

    const changeSearch = await post<Array<{ priceKey: string }>>(
      `/api/orders/${created.body.data.id}/flight-aftersales/change/search`,
      { date: "2026-08-13", passengerCodes: [passengerCode], segmentIds: [segmentId] },
    );
    expect(changeSearch.body.data).toHaveLength(1);
    const missingEvidenceChange = await post(
      `/api/orders/${created.body.data.id}/flight-aftersales/change/apply`,
      {
        priceKey: changeSearch.body.data[0].priceKey,
        passengerCodes: [passengerCode],
        segmentIds: [segmentId],
        changeType: 1,
        reasonType: 2,
        reason: "测试非自愿改签",
        evidenceFiles: [],
        contact: payload.contact,
      },
    );
    expect(missingEvidenceChange.response.status).toBe(400);
    expect(missingEvidenceChange.body.code).toBe("EVIDENCE_REQUIRED");
    const changeApplied = await post<{ change: { status: number } }>(
      `/api/orders/${created.body.data.id}/flight-aftersales/change/apply`,
      {
        priceKey: changeSearch.body.data[0].priceKey,
        passengerCodes: [passengerCode],
        segmentIds: [segmentId],
        changeType: 1,
        reason: "测试改签",
        contact: payload.contact,
      },
    );
    expect(changeApplied.body.data.change.status).toBe(1);
    expect((await request<DistributionOrder>(`/api/orders/${created.body.data.id}`)).body.data.status).toBe("CHANGING");

    const changePaid = await post<{ change: { status: number } }>(
      `/api/orders/${created.body.data.id}/flight-aftersales/change/pay`,
    );
    expect(changePaid.body.data.change.status).toBe(3);
    const changeCompleted = await post<{ change: { status: number } }>(
      `/api/orders/${created.body.data.id}/flight-aftersales/change/refresh`,
    );
    expect(changeCompleted.body.data.change.status).toBe(4);
    expect((await request<DistributionOrder>(`/api/orders/${created.body.data.id}`)).body.data.status).toBe("TICKETED");

    const missingEvidenceRefund = await post(
      `/api/orders/${created.body.data.id}/flight-aftersales/refund/apply`,
      {
        passengerCodes: [passengerCode],
        segmentIds: [segmentId],
        refundType: 2,
        reason: "测试非自愿退票",
        evidenceFiles: [],
        contact: payload.contact,
      },
    );
    expect(missingEvidenceRefund.response.status).toBe(400);
    expect(missingEvidenceRefund.body.code).toBe("EVIDENCE_REQUIRED");
    const refundApplied = await post<{ refund: { status: number } }>(
      `/api/orders/${created.body.data.id}/flight-aftersales/refund/apply`,
      {
        passengerCodes: [passengerCode],
        segmentIds: [segmentId],
        refundType: 1,
        reason: "测试退票",
        contact: payload.contact,
      },
    );
    expect(refundApplied.body.data.refund.status).toBe(1);
    const blockedRefundConfirmation = await post(
      `/api/orders/${created.body.data.id}/flight-aftersales/refund/confirm`,
      { confirm: "1" },
    );
    expect(blockedRefundConfirmation.response.status).toBe(409);
    expect(blockedRefundConfirmation.body.code).toBe("REFUND_AMOUNT_MISSING");
    const refundReviewed = await post<{ refund: { status: number; amount: number } }>(
      `/api/orders/${created.body.data.id}/flight-aftersales/refund/refresh`,
    );
    expect(refundReviewed.body.data.refund).toMatchObject({ status: 1, amount: created.body.data.amount });
    const refundConfirmed = await post<{ refund: { status: number } }>(
      `/api/orders/${created.body.data.id}/flight-aftersales/refund/confirm`,
      { confirm: "1" },
    );
    expect(refundConfirmed.body.data.refund.status).toBe(3);
    const refundCompleted = await post<{ refund: { status: number } }>(
      `/api/orders/${created.body.data.id}/flight-aftersales/refund/refresh`,
    );
    expect(refundCompleted.body.data.refund.status).toBe(4);
    expect((await request<DistributionOrder>(`/api/orders/${created.body.data.id}`)).body.data.status).toBe("REFUNDED");
  });
});

describe("database and webhook observability", () => {
  it("reports migration state and deduplicates mock webhook callbacks", async () => {
    const status = await request<{
      driver: string;
      migrationVersion: number;
      counts: { orders: number; payments: number };
    }>("/api/database/status");
    expect(status.body.data.driver).toBe("sqlite");
    expect(status.body.data.migrationVersion).toBe(6);
    expect(status.body.data.counts.orders).toBeGreaterThan(5);
    expect(status.body.data.counts.payments).toBeGreaterThanOrEqual(2);

    const callback = {
      event_id: "evt-mock-001",
      event_type: "glink.hotel.order_status",
      idempotency_key: "idem-mock-001",
      data: { fcOrderCode: "non-matching-test-order", orderStatus: 3 },
    };
    const first = await post<{ duplicate: boolean }>("/api/webhooks/glink/order-status", callback);
    const duplicate = await post<{ duplicate: boolean }>("/api/webhooks/glink/order-status", callback);
    expect(first.body.data.duplicate).toBe(false);
    expect(duplicate.body.data.duplicate).toBe(true);
  });
});

describe("business operations", () => {
  it("persists profile fields and avatar bytes across API reads", async () => {
    const updated = await request<{ name: string; language: string }>("/api/account/profile", {
      method: "PATCH",
      body: JSON.stringify({
        name: "林嘉诚",
        language: "en",
        phone: "13800008866",
        email: "lin@example.com",
      }),
    });
    expect(updated.response.status).toBe(200);
    expect(updated.body.data.language).toBe("en");

    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
    const uploaded = await request<{ avatarUrl: string }>("/api/account/profile/avatar", {
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      body: png,
    });
    expect(uploaded.response.status).toBe(200);
    expect(uploaded.body.data.avatarUrl).toContain("/api/account/profile/avatar?v=");

    const avatarResponse = await fetch(`${baseUrl}/api/account/profile/avatar`);
    expect(avatarResponse.status).toBe(200);
    expect(avatarResponse.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await avatarResponse.arrayBuffer())).toEqual(new Uint8Array(png));
  });

  it("persists customers and controls their booking status", async () => {
    const initial = await request<Array<{ id: string }>>("/api/customers");
    expect(initial.body.data).toHaveLength(3);
    const created = await post<{ id: string; status: string }>("/api/customers", {
      name: "上线验收客户",
      contactName: "测试联系人",
      phone: "13800138000",
      email: "acceptance@example.com",
      creditLimit: 50000,
    });
    expect(created.response.status).toBe(201);
    expect(created.body.data.status).toBe("ACTIVE");
    const suspended = await request<{ status: string }>(
      `/api/customers/${created.body.data.id}/status`,
      {
        method: "PATCH",
        body: JSON.stringify({ status: "SUSPENDED" }),
      },
    );
    expect(suspended.body.data.status).toBe("SUSPENDED");
    const blockedOrder = await post("/api/orders", {
      productType: "hotel",
      customerId: created.body.data.id,
      offerId: "HTL-SHA-001",
      guest: { firstName: "BLOCKED", lastName: "CUSTOMER" },
      contact: { name: "停用客户", phone: "13800138000", email: "blocked@example.com" },
      arriveTime: "18:00",
      latestArriveTime: "22:00",
    });
    expect(blockedOrder.response.status).toBe(409);
    expect(blockedOrder.body.code).toBe("CUSTOMER_SUSPENDED");
  });

  it("applies active pricing rules to search and verify without changing supplier cost", async () => {
    const rules = await request<Array<{ id: string; productType: string }>>("/api/pricing-rules");
    const hotelRule = rules.body.data.find(rule => rule.productType === "hotel")!;
    await request(`/api/pricing-rules/${hotelRule.id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: "ACTIVE" }),
    });
    const hotel = database.findHotel("HTL-SHA-001")!;
    const search = await post<HotelOffer[]>("/api/hotels/search", {
      destination: "上海",
      checkIn: "2026-08-12",
      checkOut: "2026-08-14",
    });
    const priced = search.body.data.find(item => item.id === hotel.id)!;
    expect(priced.nightlyPrice).toBe(Number((hotel.nightlyPrice * 1.08).toFixed(2)));
    const availability = await post<{ price: number }>("/api/hotels/availability", {
      offerId: hotel.id,
    });
    expect(availability.body.data.price).toBe(Number((hotel.nightlyPrice * 2 * 1.08).toFixed(2)));
    await request(`/api/pricing-rules/${hotelRule.id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: "INACTIVE" }),
    });
  });

  it("blocks enterprise-credit payment when the selected customer has insufficient limit", async () => {
    const customer = await post<{ id: string }>("/api/customers", {
      name: "低额度测试客户",
      contactName: "额度测试",
      phone: "13800138001",
      email: "credit-limit@example.com",
      creditLimit: 1,
    });
    const hotel = database.findHotel("HTL-SHA-001")!;
    database.saveHotelAvailability(hotel);
    const created = await post<DistributionOrder>("/api/orders", {
      productType: "hotel",
      customerId: customer.body.data.id,
      offerId: hotel.id,
      guest: { firstName: "CREDIT", lastName: "LIMIT" },
      contact: { name: "额度测试", phone: "13800138001", email: "credit-limit@example.com" },
      arriveTime: "18:00",
      latestArriveTime: "22:00",
    });
    expect(created.response.status).toBe(201);
    const blocked = await post(`/api/orders/${created.body.data.id}/pay`, {
      paymentMethod: "credit",
    });
    expect(blocked.response.status).toBe(409);
    expect(blocked.body.code).toBe("INSUFFICIENT_CREDIT");
  });

  it("runs unpaid auto-cancellation and exposes idempotent finance ledger data", async () => {
    const hotel = database.findHotel("HTL-SHA-001")!;
    database.saveHotelAvailability(hotel);
    const created = await post<DistributionOrder>("/api/orders", {
      productType: "hotel",
      offerId: hotel.id,
      guest: { firstName: "AUTO", lastName: "CANCEL" },
      contact: { name: "自动取消", phone: "13800138000", email: "cancel@example.com" },
      arriveTime: "18:00",
      latestArriveTime: "22:00",
    });
    database.db.prepare(
      "UPDATE orders SET updated_at = ? WHERE id = ?",
    ).run("2020-01-01T00:00:00.000Z", created.body.data.id);
    const maintenance = await post<{
      scanned: number;
      succeeded: number;
      failed: number;
    }>("/api/admin/maintenance/orders/run");
    expect(maintenance.body.data.scanned).toBeGreaterThanOrEqual(1);
    expect(maintenance.body.data.succeeded).toBeGreaterThanOrEqual(1);
    expect(maintenance.body.data.failed).toBe(0);
    const cancelled = await request<DistributionOrder>(`/api/orders/${created.body.data.id}`);
    expect(cancelled.body.data.status).toBe("CANCELLED");

    const finance = await request<{
      paid: number;
      entries: Array<{ reference: string }>;
    }>("/api/finance/summary");
    expect(finance.body.data.paid).toBeGreaterThan(0);
    expect(new Set(finance.body.data.entries.map(entry => entry.reference)).size)
      .toBe(finance.body.data.entries.length);
  });
});

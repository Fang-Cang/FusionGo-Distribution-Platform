import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.FCG_MODE = "mock";
process.env.FCG_ENV = "smoke";
process.env.DATABASE_PATH = ":memory:";

let server: Server;
let baseUrl = "";

type Envelope<T> = { code: string; message: string; data: T };

async function call<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Cookie: "fusiongo_auth=local-user", ...init?.headers },
  });
  const body = await response.json() as Envelope<T>;
  return { response, body };
}

beforeAll(async () => {
  const module = await import("../server/index.js");
  module.database.resetAndSeed();
  server = await new Promise<Server>(resolve => {
    const running = module.app.listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${(running.address() as AddressInfo).port}`;
      resolve(running);
    });
  });
}, 30_000);

afterAll(async () => {
  if (!server?.listening) return;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

describe("global functional smoke gate", () => {
  it("allows guest search but blocks account and booking access until login", async () => {
    const initial = await call<{ authenticated: boolean; mode: string }>("/api/auth/session");
    expect(initial.response.status).toBe(200);
    expect(initial.body.data).toMatchObject({ authenticated: true, mode: "local" });

    const logout = await call<{ authenticated: boolean }>("/api/auth/logout", { method: "POST" });
    expect(logout.body.data.authenticated).toBe(false);
    const guestCookie = logout.response.headers.get("set-cookie")?.split(";")[0];
    expect(guestCookie).toBe("fusiongo_auth=guest");

    const publicSearch = await call<unknown[]>("/api/hotels/search", {
      method: "POST",
      headers: { Cookie: guestCookie || "" },
      body: JSON.stringify({ destination: "Shanghai", checkIn: "2026-08-12", checkOut: "2026-08-14", rooms: 1, adults: 2 }),
    });
    expect(publicSearch.response.status).toBe(200);

    const blockedAccount = await call("/api/account/profile", { headers: { Cookie: guestCookie || "" } });
    expect(blockedAccount.response.status).toBe(401);
    expect(blockedAccount.body.code).toBe("AUTH_REQUIRED");
    const blockedOrder = await call("/api/orders", {
      method: "POST",
      headers: { Cookie: guestCookie || "" },
      body: JSON.stringify({}),
    });
    expect(blockedOrder.response.status).toBe(401);
    expect(blockedOrder.body.code).toBe("AUTH_REQUIRED");

    const login = await call<{ authenticated: boolean; user?: { email: string } }>("/api/auth/login", {
      method: "POST",
      headers: { Cookie: guestCookie || "" },
    });
    expect(login.response.status).toBe(200);
    expect(login.body.data.authenticated).toBe(true);
    expect(login.body.data.user?.email).toBeTruthy();
    const loginCookie = login.response.headers.get("set-cookie")?.split(";")[0];
    const account = await call("/api/account/profile", { headers: { Cookie: loginCookie || "" } });
    expect(account.response.status).toBe(200);
  });

  it("registers a persisted local user, isolates the profile, and supports credential login", async () => {
    const registration = {
      surname: "TESTER",
      givenName: "NEWUSER",
      email: "new.user@example.com",
      phone: "+65 8123 4567",
      password: "FusionGo2026",
      language: "en",
      acceptedTerms: true,
    };
    const created = await call<{ authenticated: boolean; user: { id: string; name: string; email: string; role: string } }>("/api/auth/register", {
      method: "POST",
      headers: { Cookie: "fusiongo_auth=guest" },
      body: JSON.stringify(registration),
    });
    expect(created.response.status).toBe(201);
    expect(created.body.data).toMatchObject({ authenticated: true, user: { name: "TESTER NEWUSER", email: registration.email, role: "member" } });
    const registeredCookie = created.response.headers.get("set-cookie")?.split(";")[0] || "";
    expect(registeredCookie).toMatch(/^fusiongo_auth=.{20,}$/);

    const profile = await call<{ surname: string; givenName: string; email: string }>("/api/account/profile", {
      headers: { Cookie: registeredCookie },
    });
    expect(profile.response.status).toBe(200);
    expect(profile.body.data).toMatchObject({ surname: "TESTER", givenName: "NEWUSER", email: registration.email });

    const updatedProfile = await call<{ phone: string }>("/api/account/profile", {
      method: "PATCH",
      headers: { Cookie: registeredCookie },
      body: JSON.stringify({
        name: "TESTER NEWUSER",
        surname: "TESTER",
        givenName: "NEWUSER",
        language: "en",
        phone: "64740800",
        email: registration.email,
      }),
    });
    expect(updatedProfile.response.status).toBe(200);
    expect(updatedProfile.body.data.phone).toBe("64740800");

    const blockedAdmin = await call("/api/dashboard", { headers: { Cookie: registeredCookie } });
    expect(blockedAdmin.response.status).toBe(403);
    expect(blockedAdmin.body.code).toBe("ADMIN_REQUIRED");

    const duplicate = await call("/api/auth/register", {
      method: "POST",
      headers: { Cookie: "fusiongo_auth=guest" },
      body: JSON.stringify(registration),
    });
    expect(duplicate.response.status).toBe(409);
    expect(duplicate.body.code).toBe("EMAIL_ALREADY_REGISTERED");

    const signedOut = await call("/api/auth/logout", { method: "POST", headers: { Cookie: registeredCookie } });
    expect(signedOut.response.status).toBe(200);
    const invalidated = await call("/api/account/profile", { headers: { Cookie: registeredCookie } });
    expect(invalidated.response.status).toBe(401);

    const wrongPassword = await call("/api/auth/login", {
      method: "POST",
      headers: { Cookie: "fusiongo_auth=guest" },
      body: JSON.stringify({ email: registration.email, password: "WrongPassword1" }),
    });
    expect(wrongPassword.response.status).toBe(401);
    expect(wrongPassword.body.code).toBe("INVALID_CREDENTIALS");

    const signedIn = await call<{ authenticated: boolean; user: { email: string } }>("/api/auth/login", {
      method: "POST",
      headers: { Cookie: "fusiongo_auth=guest" },
      body: JSON.stringify({ email: registration.email, password: registration.password }),
    });
    expect(signedIn.response.status).toBe(200);
    expect(signedIn.body.data.user.email).toBe(registration.email);
  });

  it("rejects weak, incomplete, and unaccepted registrations", async () => {
    const invalid = await call("/api/auth/register", {
      method: "POST",
      headers: { Cookie: "fusiongo_auth=guest" },
      body: JSON.stringify({
        surname: "T",
        givenName: "U",
        email: "invalid-email",
        phone: "12",
        password: "password",
        language: "en",
        acceptedTerms: false,
      }),
    });
    expect(invalid.response.status).toBe(400);
    expect(invalid.body.code).toBe("INVALID_REGISTRATION");
  });

  it("blocks guest access to trial booking, fare verification, and admin maintenance", async () => {
    const logout = await call<{ authenticated: boolean }>("/api/auth/logout", { method: "POST" });
    const guestCookie = logout.response.headers.get("set-cookie")?.split(";")[0] || "fusiongo_auth=guest";
    for (const path of ["/api/hotels/availability", "/api/flights/verify", "/api/admin/maintenance/orders/run"]) {
      const blocked = await call(path, {
        method: "POST",
        headers: { Cookie: guestCookie },
        body: JSON.stringify({ offerId: "test", priceKey: "test", quantity: 1 }),
      });
      expect(blocked.response.status, path).toBe(401);
      expect(blocked.body.code, path).toBe("AUTH_REQUIRED");
    }
  });

  it("rejects impossible hotel dates, room occupancy, and child-age combinations", async () => {
    const invalidPayloads = [
      { destination: "上海", checkIn: "2026-08-05", checkOut: "2026-08-06", rooms: 1, adults: 2, children: 0, childAges: [] },
      { destination: "上海", checkIn: "2026-08-14", checkOut: "2026-08-12", rooms: 1, adults: 2, children: 0, childAges: [] },
      { destination: "上海", checkIn: "2026-08-12", checkOut: "2026-08-14", rooms: 2, adults: 1, children: 0, childAges: [] },
      { destination: "上海", checkIn: "2026-08-12", checkOut: "2026-08-14", rooms: 1, adults: 2, children: 2, childAges: [8] },
    ];
    for (const payload of invalidPayloads) {
      const result = await call("/api/hotels/search", { method: "POST", body: JSON.stringify(payload) });
      expect(result.response.status).toBe(400);
      expect(result.body.code).toBe("INVALID_PARAMS");
    }
  });

  it("rejects impossible flight routes, segment order, and passenger composition", async () => {
    const invalidPayloads = [
      { from: "SIN", to: "BKK", departureDate: "2026-08-05", adults: 1, children: 0, infants: 0, tripType: 1 },
      { from: "SIN", to: "SIN", departureDate: "2026-08-12", adults: 1, children: 0, infants: 0, tripType: 1 },
      { from: "SIN", to: "BKK", departureDate: "2026-08-12", adults: 1, children: 0, infants: 2, tripType: 1 },
      { from: "SIN", to: "BKK", departureDate: "2026-08-12", adults: 5, children: 4, infants: 1, tripType: 1 },
      { from: "SIN", to: "BKK", departureDate: "2026-08-12", adults: 1, children: 0, infants: 0, tripType: 2, journeys: [{ origin: "SIN", destination: "BKK", date: "2026-08-12" }] },
      { from: "SIN", to: "BKK", departureDate: "2026-08-14", adults: 1, children: 0, infants: 0, tripType: 3, journeys: [{ origin: "SIN", destination: "BKK", date: "2026-08-14" }, { origin: "BKK", destination: "HKG", date: "2026-08-12" }] },
    ];
    for (const payload of invalidPayloads) {
      const result = await call("/api/flights/search", { method: "POST", body: JSON.stringify(payload) });
      expect(result.response.status).toBe(400);
      expect(result.body.code).toBe("INVALID_PARAMS");
    }
  });

  it("reports healthy and ready with the current database migration", async () => {
    const health = await call<{ status: string; database: { migrationVersion: number } }>("/api/health");
    const ready = await call<{ ready: boolean }>("/api/ready");
    expect(health.response.status).toBe(200);
    expect(health.body.data).toMatchObject({ status: "up", database: { migrationVersion: 12 } });
    expect(ready.body.data.ready).toBe(true);
  });

  it("serves the complete nationality enumeration for passenger and passport forms", async () => {
    const result = await call<{
      source: string;
      count: number;
      items: Array<{ code: string; nameZh: string; nameEn: string }>;
    }>("/api/reference/nationalities?locale=zh-CN");
    expect(result.response.status).toBe(200);
    expect(result.body.data.source).toBe("iso-3166");
    expect(result.body.data.count).toBe(249);
    expect(new Set(result.body.data.items.map(item => item.code)).size).toBe(249);
    expect(result.body.data.items).toContainEqual(expect.objectContaining({ code: "CN", nameZh: "中国", nameEn: "China" }));
  });

  it("modifies and reloads personal profile fields", async () => {
    const update = await call<{ name: string; language: string }>("/api/account/profile", {
      method: "PATCH",
      body: JSON.stringify({
        name: "全局冒烟用户",
        surname: "全局",
        givenName: "冒烟用户",
        language: "zh-CN",
        phone: "13800138000",
        email: "smoke@example.com",
      }),
    });
    expect(update.response.status).toBe(200);
    const loaded = await call<{ name: string; surname: string; givenName: string; phone: string; email: string }>("/api/account/profile");
    expect(loaded.body.data).toMatchObject({
      name: "全局冒烟用户",
      surname: "全局",
      givenName: "冒烟用户",
      phone: "13800138000",
      email: "smoke@example.com",
    });
  });

  it("rejects malformed personal profile data", async () => {
    const invalid = await call("/api/account/profile", {
      method: "PATCH",
      body: JSON.stringify({ name: "", language: "zh-CN", phone: "123", email: "bad" }),
    });
    expect(invalid.response.status).toBe(400);
    expect(invalid.body.code).toBe("INVALID_PROFILE");
  });

  it("stores a valid avatar and rejects a spoofed image", async () => {
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
    const uploaded = await call<{ avatarUrl: string }>("/api/account/profile/avatar", {
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      body: png,
    });
    expect(uploaded.response.status).toBe(200);
    expect(uploaded.body.data.avatarUrl).toContain("/api/account/profile/avatar?v=");

    const spoofed = await call("/api/account/profile/avatar", {
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      body: Buffer.from([0xff, 0xd8, 0xff, 0x00]),
    });
    expect(spoofed.response.status).toBe(415);
    expect(spoofed.body.code).toBe("AVATAR_TYPE_INVALID");
  });

  it("creates, edits and deletes a persistent traveler without exposing the passport", async () => {
    const created = await call<{ id: string; givenName: string; documentNo: string }>("/api/account/travelers", {
      method: "POST",
      body: JSON.stringify({
        type: "adult",
        surname: "WANG",
        givenName: "WEI",
        gender: "1",
        birthday: "1992-08-18",
        nationality: "CN",
        documentNo: "P12345678",
        issuingCountry: "CN",
        expiration: "2032-08-17",
      }),
    });
    expect(created.response.status).toBe(201);
    expect(created.body.data.documentNo).toBe("P1•••••78");
    expect(JSON.stringify(created.body)).not.toContain("P12345678");

    const edited = await call<{ givenName: string; documentNo: string }>(`/api/account/travelers/${created.body.data.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        type: "adult",
        surname: "WANG",
        givenName: "WEIMING",
        gender: "1",
        birthday: "1992-08-18",
        nationality: "CN",
        issuingCountry: "CN",
        expiration: "2032-08-17",
      }),
    });
    expect(edited.body.data).toMatchObject({ givenName: "WEIMING", documentNo: "P1•••••78" });
    const listed = await call<Array<{ id: string; givenName: string }>>("/api/account/travelers");
    expect(listed.body.data).toContainEqual(expect.objectContaining({ id: created.body.data.id, givenName: "WEIMING" }));

    const removed = await call<{ deleted: true }>(`/api/account/travelers/${created.body.data.id}`, { method: "DELETE" });
    expect(removed.body.data.deleted).toBe(true);
  });

  it("persists notification preferences", async () => {
    const saved = await call<{ order: boolean; flight: boolean; marketing: boolean }>("/api/account/notifications", {
      method: "PATCH",
      body: JSON.stringify({ order: false, flight: true, marketing: true }),
    });
    expect(saved.body.data).toMatchObject({ order: false, flight: true, marketing: true });
    const loaded = await call<{ order: boolean; flight: boolean; marketing: boolean }>("/api/account/notifications");
    expect(loaded.body.data).toMatchObject({ order: false, flight: true, marketing: true });
  });

  it("adds, reloads and removes a favorite hotel", async () => {
    const search = await call<Array<Record<string, unknown>>>("/api/hotels/search", {
      method: "POST",
      body: JSON.stringify({ destination: "Shanghai", checkIn: "2026-08-12", checkOut: "2026-08-14", rooms: 1, adults: 2 }),
    });
    const hotel = search.body.data[0];
    expect(hotel).toBeDefined();
    const rejectedSimulation = await call("/api/account/hotel-favorites", {
      method: "POST",
      body: JSON.stringify({ hotel: { ...hotel, id: `SIM-${String(hotel.id)}`, inventorySource: "simulation" } }),
    });
    expect(rejectedSimulation.response.status).toBe(422);
    expect(rejectedSimulation.body.code).toBe("REAL_HOTEL_REQUIRED");
    const added = await call<{ id: string; favoritedAt: string }>("/api/account/hotel-favorites", {
      method: "POST",
      body: JSON.stringify({ hotel }),
    });
    expect(added.response.status).toBe(201);
    expect(added.body.data.id).toBe(hotel.id);
    expect(added.body.data.favoritedAt).toBeTruthy();

    const listed = await call<Array<{ id: string }>>("/api/account/hotel-favorites");
    expect(listed.body.data).toContainEqual(expect.objectContaining({ id: hotel.id }));

    const removed = await call<{ deleted: true }>(`/api/account/hotel-favorites/${encodeURIComponent(String(hotel.id))}`, { method: "DELETE" });
    expect(removed.body.data.deleted).toBe(true);
    const empty = await call<Array<{ id: string }>>("/api/account/hotel-favorites");
    expect(empty.body.data).not.toContainEqual(expect.objectContaining({ id: hotel.id }));
  });

  it("loads dashboard and order-center data without fabricated trend deltas", async () => {
    const dashboard = await call<{ salesTodayByCurrency: Record<string, number>; trend: Array<{ date: string; hotels: number; flights: number }>; recentOrders: Array<{ id: string }> }>("/api/dashboard");
    const orders = await call<Array<{ id: string }>>("/api/orders");
    expect(dashboard.body.data.recentOrders.length).toBeGreaterThan(0);
    expect(dashboard.body.data.salesTodayByCurrency).toBeTypeOf("object");
    expect(dashboard.body.data.trend).toHaveLength(7);
    expect(dashboard.body.data.trend.every(point => /^\d{4}-\d{2}-\d{2}$/.test(point.date))).toBe(true);
    expect(orders.body.data.length).toBeGreaterThan(0);
    const detail = await call<{ id: string }>(`/api/orders/${orders.body.data[0].id}`);
    expect(detail.body.data.id).toBe(orders.body.data[0].id);
  });

  it("downloads a confirmed order as a PDF electronic voucher", async () => {
    const orders = await call<Array<{ id: string; status: string; productType: string }>>("/api/orders");
    const confirmed = orders.body.data.find(order => order.productType === "hotel" && order.status === "CONFIRMED");
    expect(confirmed).toBeDefined();
    const response = await fetch(`${baseUrl}/api/orders/${confirmed!.id}/documents/confirmation`, { headers: { Cookie: "fusiongo_auth=local-user" } });
    const pdf = Buffer.from(await response.arrayBuffer());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toContain(".pdf");
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(10_000);
  }, 30_000);

  it("downloads ticketed flights as PDF and blocks unconfirmed hotel vouchers", async () => {
    const orders = await call<Array<{ id: string; status: string; productType: string }>>("/api/orders");
    const ticketed = orders.body.data.find(order => order.productType === "flight" && order.status === "TICKETED");
    const unconfirmedHotel = orders.body.data.find(order => order.productType === "hotel" && order.status !== "CONFIRMED");
    expect(ticketed).toBeDefined();
    expect(unconfirmedHotel).toBeDefined();

    const ticketResponse = await fetch(`${baseUrl}/api/orders/${ticketed!.id}/documents/ticket`, { headers: { Cookie: "fusiongo_auth=local-user" } });
    const ticketPdf = Buffer.from(await ticketResponse.arrayBuffer());
    expect(ticketResponse.status).toBe(200);
    expect(ticketResponse.headers.get("content-type")).toBe("application/pdf");
    expect(ticketPdf.subarray(0, 5).toString()).toBe("%PDF-");

    const blocked = await fetch(`${baseUrl}/api/orders/${unconfirmedHotel!.id}/documents/confirmation`, { headers: { Cookie: "fusiongo_auth=local-user" } });
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({ code: "CONFIRMATION_NOT_READY" });
  }, 30_000);

  it("creates a customer and persists status changes", async () => {
    const created = await call<{ id: string; status: string; contactSurname?: string; contactGivenName?: string }>("/api/customers", {
      method: "POST",
      body: JSON.stringify({
        name: "冒烟测试客户",
        contactName: "测试联系人",
        contactSurname: "测试",
        contactGivenName: "联系人",
        phone: "13800138001",
        email: "customer-smoke@example.com",
        creditLimit: 50000,
      }),
    });
    expect(created.response.status).toBe(201);
    expect(created.body.data).toMatchObject({ contactSurname: "测试", contactGivenName: "联系人" });
    const suspended = await call<{ status: string }>(`/api/customers/${created.body.data.id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: "SUSPENDED" }),
    });
    expect(suspended.body.data.status).toBe("SUSPENDED");
  });

  it("creates and enables a pricing rule", async () => {
    const created = await call<{ id: string; status: string }>("/api/pricing-rules", {
      method: "POST",
      body: JSON.stringify({
        name: "冒烟测试服务费",
        productType: "flight",
        calculationType: "fixed",
        value: 20,
        priority: 999,
      }),
    });
    expect(created.response.status).toBe(201);
    const enabled = await call<{ status: string }>(`/api/pricing-rules/${created.body.data.id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: "ACTIVE" }),
    });
    expect(enabled.body.data.status).toBe("ACTIVE");
  });

  it("returns auditable finance summary data", async () => {
    const finance = await call<{
      availableCredit: number;
      totalCredit: number;
      entries: unknown[];
    }>("/api/finance/summary");
    expect(finance.response.status).toBe(200);
    expect(finance.body.data.totalCredit).toBeGreaterThan(0);
    expect(finance.body.data.availableCredit).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(finance.body.data.entries)).toBe(true);
  });
});

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
    headers: { "Content-Type": "application/json", ...init?.headers },
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
});

afterAll(async () => {
  if (!server?.listening) return;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

describe("global functional smoke gate", () => {
  it("reports healthy and ready with the current database migration", async () => {
    const health = await call<{ status: string; database: { migrationVersion: number } }>("/api/health");
    const ready = await call<{ ready: boolean }>("/api/ready");
    expect(health.response.status).toBe(200);
    expect(health.body.data).toMatchObject({ status: "up", database: { migrationVersion: 6 } });
    expect(ready.body.data.ready).toBe(true);
  });

  it("modifies and reloads personal profile fields", async () => {
    const update = await call<{ name: string; language: string }>("/api/account/profile", {
      method: "PATCH",
      body: JSON.stringify({
        name: "全局冒烟用户",
        language: "zh-CN",
        phone: "13800138000",
        email: "smoke@example.com",
      }),
    });
    expect(update.response.status).toBe(200);
    const loaded = await call<{ name: string; phone: string; email: string }>("/api/account/profile");
    expect(loaded.body.data).toMatchObject({
      name: "全局冒烟用户",
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

  it("loads dashboard and order-center data", async () => {
    const dashboard = await call<{ recentOrders: Array<{ id: string }> }>("/api/dashboard");
    const orders = await call<Array<{ id: string }>>("/api/orders");
    expect(dashboard.body.data.recentOrders.length).toBeGreaterThan(0);
    expect(orders.body.data.length).toBeGreaterThan(0);
    const detail = await call<{ id: string }>(`/api/orders/${orders.body.data[0].id}`);
    expect(detail.body.data.id).toBe(orders.body.data[0].id);
  });

  it("creates a customer and persists status changes", async () => {
    const created = await call<{ id: string; status: string }>("/api/customers", {
      method: "POST",
      body: JSON.stringify({
        name: "冒烟测试客户",
        contactName: "测试联系人",
        phone: "13800138001",
        email: "customer-smoke@example.com",
        creditLimit: 50000,
      }),
    });
    expect(created.response.status).toBe(201);
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

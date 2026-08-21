import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.FCG_MODE = "sandbox";
process.env.FCG_ENV = "sandbox";
process.env.FCG_SANDBOX_HOTEL_SIMULATION = "true";
process.env.FCG_APP_KEY = "";
process.env.FCG_APP_SECRET = "";
process.env.FCG_GLINK_APP_KEY = "";
process.env.FCG_GLINK_APP_SECRET = "";
process.env.DATABASE_PATH = ":memory:";
process.env.APP_TEST_DATE = "2026-08-11";

let server: Server;
let baseUrl = "";

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

describe("credential-free sandbox hotel simulation", () => {
  it("returns the London destination choices used by the autocomplete", async () => {
    const response = await fetch(`${baseUrl}/api/hotels/destination`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: "London" }),
    });
    const body = await response.json() as { code: string; data: Array<{ name: string; detail: string; latGoogle: number; lngGoogle: number }> };

    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(8);
    expect(body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "London", detail: "United Kingdom · England" }),
      expect.objectContaining({ name: "East London", detail: "South Africa · Eastern Cape" }),
      expect.objectContaining({ name: "London Colney", detail: "England · St Albans" }),
    ]));
    expect(new Set(body.data.map(item => `${item.latGoogle},${item.lngGoogle}`)).size).toBe(8);
  });

  it("returns Shenzhen North Railway Station as an exact destination suggestion", async () => {
    const response = await fetch(`${baseUrl}/api/hotels/destination`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: "深圳北站" }),
    });
    const body = await response.json() as { data: Array<{ name: string; cityCode: string; destinationType: number; latGoogle: number; lngGoogle: number }> };

    expect(response.status).toBe(200);
    expect(body.data[0]).toEqual({
      name: "深圳北站",
      detail: "深圳，广东，中国",
      cityCode: "SZX",
      destinationType: 8,
      latGoogle: 22.610332,
      lngGoogle: 114.030227,
    });
  });

  it("searches local test hotels instead of calling an unconfigured FCG client", async () => {
    const response = await fetch(`${baseUrl}/api/hotels/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        destination: "Shanghai",
        checkIn: "2026-08-13",
        checkOut: "2026-08-14",
        rooms: 1,
        adults: 2,
      }),
    });
    const body = await response.json() as { code: string; data: Array<{ inventorySource?: string }> };

    expect(response.status).toBe(200);
    expect(body.code).toBe("SUCCESS");
    expect(body.data).toHaveLength(3);
    expect(body.data.every(hotel => hotel.inventorySource !== "glink")).toBe(true);
  });
});

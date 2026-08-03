import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type OpenApi = {
  info: { version: string };
  paths: Record<string, {
    post?: {
      requestBody?: {
        content?: {
          "application/json"?: { schema?: { $ref?: string } };
        };
      };
    };
  }>;
  components: { schemas: Record<string, { required?: string[] }> };
};

const load = (name: string) =>
  JSON.parse(readFileSync(new URL(`../docs/swagger/${name}`, import.meta.url), "utf8")) as OpenApi;
const schemaName = (api: OpenApi, path: string) =>
  api.paths[path]?.post?.requestBody?.content?.["application/json"]?.schema?.$ref?.split("/").at(-1);

describe("FCG mandatory OpenAPI contracts", () => {
  it("pins the G-Link booking chain and its required bridge fields", () => {
    const api = load("glink-api.json");
    expect(api.info.version).toBe("2026-04-24");
    const requiredPaths = [
      "/openapi/v1/glink/search/destination",
      "/openapi/v1/glink/search/hotelList",
      "/openapi/v1/glink/hotel/detail",
      "/openapi/v1/glink/booking/productDetails",
      "/openapi/v1/glink/booking/availabilityCheck",
      "/openapi/v1/glink/booking/createOrder",
      "/openapi/v1/glink/booking/payOrder",
      "/openapi/v1/glink/order/orderDetail",
      "/openapi/v1/glink/order/cancelOrder",
    ];
    requiredPaths.forEach(path => expect(api.paths[path]).toBeDefined());
    const availability = api.components.schemas[schemaName(api, requiredPaths[4])!];
    expect(availability.required).toEqual(expect.arrayContaining(["hotelId", "roomId", "ratePlanId", "supplyCode", "roomNum"]));
    const createOrder = api.components.schemas[schemaName(api, requiredPaths[5])!];
    expect(createOrder.required).toEqual(expect.arrayContaining(["coOrderCode", "totalAmount", "priceItems", "guestInfos"]));
  });

  it("pins the F-Link search-to-ticketing chain and priceKey/orderNo fields", () => {
    const api = load("flink-api.json");
    expect(api.info.version).toBe("2026-04-24");
    const requiredPaths = [
      "/openapi/v1/flink/{lang}/flight/search",
      "/openapi/v1/flink/{lang}/flight/verify",
      "/openapi/v1/flink/{lang}/flight/order/create",
      "/openapi/v1/flink/{lang}/flight/order/pay",
      "/openapi/v1/flink/{lang}/flight/order/detail",
      "/openapi/v1/flink/{lang}/flight/order/cancel",
    ];
    requiredPaths.forEach(path => expect(api.paths[path]).toBeDefined());
    const verify = api.components.schemas[schemaName(api, requiredPaths[1])!];
    expect(verify.required).toContain("priceKey");
    const createOrder = api.components.schemas[schemaName(api, requiredPaths[2])!];
    expect(createOrder.required).toEqual(expect.arrayContaining(["priceKey", "passenger", "contactName"]));
    const pay = api.components.schemas[schemaName(api, requiredPaths[3])!];
    expect(pay.required).toEqual(expect.arrayContaining(["orderNo", "amount", "type"]));
  });
});

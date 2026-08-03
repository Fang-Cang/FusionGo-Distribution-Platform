import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createFcgSignature } from "../server/fcg/signature.js";
import { verifyFcgWebhook } from "../server/fcg/webhook.js";

describe("FCG X-OP signature", () => {
  it("signs exact runtime path, sorted query and raw body", () => {
    const body = JSON.stringify({ destinationId: "SHA", roomNum: 1 });
    const result = createFcgSignature({
      method: "post",
      path: "/openapi/v1/glink/search/hotelList",
      query: { z: "last", a: "first" },
      body,
      timestamp: "1785283200000",
      nonce: "nonce-fixed",
      appKey: "demo-key",
      appSecret: "demo-secret",
    });
    const bodyHash = createHash("sha256").update(body).digest("hex");
    const canonical = ["POST", "/openapi/v1/glink/search/hotelList", "a=first&z=last", bodyHash, "1785283200000", "nonce-fixed", "demo-key"].join("\n");
    const expected = createHmac("sha256", "demo-secret").update(canonical).digest("hex");
    expect(result.canonical).toBe(canonical);
    expect(result.headers["X-OP-Sign"]).toBe(expected);
  });

  it("hashes an empty body for GET calls", () => {
    const result = createFcgSignature({
      method: "GET",
      path: "/openapi/v1/flink/fields",
      query: { priceKey: "pk-1" },
      timestamp: "1785283200000",
      nonce: "nonce-fixed-2",
      appKey: "demo-key",
      appSecret: "demo-secret",
    });
    expect(result.canonical.split("\n")[3]).toBe(createHash("sha256").update("").digest("hex"));
  });

  it("verifies a signed webhook against the exact callback path and raw body", () => {
    const body = JSON.stringify({ event_id: "evt-1", event_type: "glink.hotel.order_status", data: { orderStatus: 3 } });
    const timestamp = "1785283200000";
    const signed = createFcgSignature({
      method: "POST",
      path: "/api/webhooks/glink/order-status",
      body,
      timestamp,
      nonce: "webhook-nonce",
      appKey: "demo-key",
      appSecret: "demo-secret",
    });
    const result = verifyFcgWebhook({
      method: "POST",
      path: "/api/webhooks/glink/order-status",
      rawBody: body,
      headers: {
        "x-op-app-key": "demo-key",
        "x-op-timestamp": timestamp,
        "x-op-nonce": "webhook-nonce",
        "x-op-sign": signed.headers["X-OP-Sign"],
      },
      credentials: { appKey: "demo-key", appSecret: "demo-secret" },
      now: Number(timestamp),
    });
    expect(result).toEqual({ valid: true, code: "SUCCESS" });
  });
});

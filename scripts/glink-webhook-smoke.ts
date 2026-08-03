import "dotenv/config";
import { randomUUID } from "node:crypto";
import { createFcgSignature } from "../server/fcg/signature.js";
import { getFcgRuntime } from "../server/fcg/runtime.js";

const runtime = getFcgRuntime();
if (runtime.mode !== "sandbox" || runtime.environment !== "sandbox") {
  throw new Error("Webhook smoke test only runs in the sandbox environment");
}
if (!runtime.glinkConfigured) throw new Error("G-Link sandbox credentials are not configured");

const path = "/api/webhooks/glink/order-status";
const endpoint = `${process.env.LOCAL_API_URL || "http://localhost:8787"}${path}`;
const eventId = `evt-local-${randomUUID()}`;
const idempotencyKey = `glink:order_status:local:${eventId}`;
const payload = {
  event_id: eventId,
  event_type: "glink.hotel.order_status",
  provider: "glink",
  product_code: "glink",
  api_code: "glink.notifyOrderStatus",
  env_type: "sandbox",
  occurred_at: new Date().toISOString(),
  idempotency_key: idempotencyKey,
  data: {
    coOrderCode: "LOCAL-WEBHOOK-NON-MATCHING",
    fcOrderCode: "LOCAL-WEBHOOK-NON-MATCHING",
    orderStatus: 3,
    message: "local idempotency verification",
  },
};
const rawBody = JSON.stringify(payload);

async function send() {
  const signed = createFcgSignature({
    method: "POST",
    path,
    body: rawBody,
    ...runtime.glinkCredentials,
  });
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      ...signed.headers,
      "Content-Type": "application/json",
      "X-OP-Webhook-Event-Id": eventId,
      "X-OP-Webhook-Type": payload.event_type,
      "X-OP-Sign-Method": "HMAC_SHA256",
    },
    body: rawBody,
  });
  const body = await response.json() as {
    code: string;
    message: string;
    data?: { accepted: boolean; duplicate: boolean };
  };
  return { httpStatus: response.status, ...body };
}

const first = await send();
const replay = await send();
if (first.httpStatus !== 200 || first.code !== "SUCCESS" || first.data?.duplicate !== false) {
  throw new Error(`First webhook delivery failed: ${JSON.stringify(first)}`);
}
if (replay.httpStatus !== 200 || replay.code !== "SUCCESS" || replay.data?.duplicate !== true) {
  throw new Error(`Webhook replay was not handled idempotently: ${JSON.stringify(replay)}`);
}
console.log(JSON.stringify({
  ok: true,
  environment: runtime.environment,
  endpoint: path,
  first,
  replay,
}, null, 2));

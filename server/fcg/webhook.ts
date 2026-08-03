import { timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import type { FcgCredentials } from "../types.js";
import { createFcgSignature } from "./signature.js";

const header = (headers: IncomingHttpHeaders, name: string) => {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] || "" : value || "";
};

function timestampMs(value: string) {
  if (/^\d+$/.test(value)) {
    const numeric = Number(value);
    return value.length <= 10 ? numeric * 1000 : numeric;
  }
  return Date.parse(value);
}

export function verifyFcgWebhook(input: {
  method: string;
  path: string;
  rawBody: string;
  headers: IncomingHttpHeaders;
  credentials: FcgCredentials;
  now?: number;
}) {
  const appKey = header(input.headers, "x-op-app-key");
  const timestamp = header(input.headers, "x-op-timestamp");
  const nonce = header(input.headers, "x-op-nonce");
  const receivedSignature = header(input.headers, "x-op-sign");
  if (!appKey || !timestamp || !nonce || !receivedSignature) return { valid: false, code: "WEBHOOK_HEADERS_MISSING" };
  if (appKey !== input.credentials.appKey) return { valid: false, code: "WEBHOOK_APP_KEY_INVALID" };
  const parsedTimestamp = timestampMs(timestamp);
  if (!Number.isFinite(parsedTimestamp) || Math.abs((input.now ?? Date.now()) - parsedTimestamp) > 5 * 60_000) {
    return { valid: false, code: "WEBHOOK_TIMESTAMP_EXPIRED" };
  }
  const expected = createFcgSignature({
    method: input.method,
    path: input.path,
    body: input.rawBody,
    timestamp,
    nonce,
    appKey,
    appSecret: input.credentials.appSecret,
  }).headers["X-OP-Sign"];
  const receivedBuffer = Buffer.from(receivedSignature, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  const valid = receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer);
  return { valid, code: valid ? "SUCCESS" : "WEBHOOK_SIGN_ERROR" };
}

import { createHash, createHmac, randomUUID } from "node:crypto";
import type { SignInput } from "../types.js";

function canonicalQuery(input?: SignInput["query"]): string {
  if (!input) return "";
  const entries =
    input instanceof URLSearchParams
      ? [...input.entries()]
      : Object.entries(input)
          .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
          .map(([key, value]) => [key, String(value)]);
  return entries
    .sort(([keyA, valueA], [keyB, valueB]) => keyA.localeCompare(keyB) || valueA.localeCompare(valueB))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

export function createFcgSignature(input: SignInput) {
  const timestamp = input.timestamp ?? String(Date.now());
  const nonce = input.nonce ?? randomUUID();
  const body = input.body ?? "";
  const bodyHash = createHash("sha256").update(body, "utf8").digest("hex");
  const query = canonicalQuery(input.query);
  const canonical = [
    input.method.toUpperCase(),
    input.path,
    query,
    bodyHash,
    timestamp,
    nonce,
    input.appKey,
  ].join("\n");
  const signature = createHmac("sha256", input.appSecret).update(canonical, "utf8").digest("hex");
  return {
    canonical,
    query,
    headers: {
      "X-OP-App-Key": input.appKey,
      "X-OP-Timestamp": timestamp,
      "X-OP-Nonce": nonce,
      "X-OP-Sign": signature,
    },
  };
}

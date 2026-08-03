import type { FcgCredentials, FcgEnvelope } from "../types.js";
import { createFcgSignature } from "./signature.js";

export interface FcgAuditEntry {
  method: "GET" | "POST";
  path: string;
  code: string;
  httpStatus: number;
  requestId?: string;
  traceId?: string;
  downstreamRequestId?: string;
  occurredAt: string;
}

export class FcgError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly requestId?: string,
    readonly traceId?: string,
  ) {
    super(message);
    this.name = "FcgError";
  }
}

export class FcgClient {
  private readonly auditEntries: FcgAuditEntry[] = [];

  constructor(
    private readonly baseUrl: string,
    private readonly credentials: FcgCredentials,
  ) {}

  async request<T>(method: "GET" | "POST", path: string, body?: unknown, query?: Record<string, string | number | undefined>) {
    if (!this.credentials.appKey || !this.credentials.appSecret) {
      throw new FcgError("FCG 沙箱凭证尚未配置", "FCG_NOT_CONFIGURED", 503);
    }
    const rawBody = body === undefined ? "" : JSON.stringify(body);
    const signed = createFcgSignature({ method, path, body: rawBody, query, ...this.credentials });
    const url = `${this.baseUrl}${path}${signed.query ? `?${signed.query}` : ""}`;
    const response = await fetch(url, {
      method,
      headers: {
        ...signed.headers,
        "Content-Type": "application/json",
        "X-OP-Client-Request-Id": crypto.randomUUID(),
      },
      body: method === "POST" ? rawBody : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const responseText = await response.text();
    let envelope: FcgEnvelope<T>;
    try {
      envelope = JSON.parse(responseText) as FcgEnvelope<T>;
    } catch {
      throw new FcgError(`FCG 返回了非 JSON 响应（HTTP ${response.status}）`, "INVALID_FCG_RESPONSE", response.status);
    }
    this.auditEntries.push({
      method,
      path,
      code: envelope.code,
      httpStatus: response.status,
      requestId: envelope.request_id,
      traceId: envelope.trace_id,
      downstreamRequestId: envelope.downstream_request_id,
      occurredAt: new Date().toISOString(),
    });
    if (this.auditEntries.length > 100) this.auditEntries.splice(0, this.auditEntries.length - 100);
    if (!response.ok || envelope.code !== "SUCCESS") {
      throw new FcgError(envelope.message || "FCG request failed", envelope.code, response.status, envelope.request_id, envelope.trace_id);
    }
    return envelope.data;
  }

  auditTrail() {
    return this.auditEntries.map(entry => ({ ...entry }));
  }

  glink<T>(shortPath: string, body: unknown) {
    return this.request<T>("POST", `/openapi/v1/glink${shortPath}`, body);
  }

  flink<T>(lang: "zh_CN" | "zh_TW" | "en", path: string, body: unknown) {
    return this.request<T>("POST", `/openapi/v1/flink/${lang}${path}`, body);
  }

  flinkFields<T>(query: { priceKey?: string; orderNo?: string }) {
    return this.request<T>("GET", "/openapi/v1/flink/fields", undefined, query);
  }
}

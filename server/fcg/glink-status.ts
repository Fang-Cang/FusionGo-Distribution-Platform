import type { OrderStatus } from "../../src/types.js";

export function mapGlinkOrderDetailStatus(value: unknown): OrderStatus {
  const status = Number(value);
  if (status === 3 || status === 5) return "CONFIRMED";
  if (status === 4) return "CANCELLED";
  return "PROCESSING";
}

export function mapGlinkOrderStatusWebhook(value: unknown): OrderStatus | undefined {
  const status = Number(value);
  if (status === 3) return "CONFIRMED";
  if (status === 4) return "FAILED";
  if (status === 6) return "CANCELLED";
  // 7 means cancellation failed. The booking itself remains in its current state.
  return undefined;
}

export function mapGlinkCancelResult(value: unknown) {
  const result = Number(value);
  if (result === 1) return "CANCELLED" as const;
  if (result === 3) return "CANCELLING" as const;
  return "REFUSED" as const;
}

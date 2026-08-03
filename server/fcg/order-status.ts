import type { OrderStatus } from "../../src/types.js";

export function mapFlinkOrderStatus(value: unknown): OrderStatus {
  const status = Number(value);
  if ([1, 2, 4].includes(status)) return "PENDING_PAYMENT";
  if (status === 5) return "PROCESSING";
  if ([3, 6, 7].includes(status)) return "FAILED";
  if (status === 8) return "TICKETED";
  if (status === 9) return "CANCELLED";
  return "PROCESSING";
}

export function mapFlinkPostPaymentStatus(value: unknown): OrderStatus {
  if (value === undefined || value === null || value === "") return "PROCESSING";
  const mapped = mapFlinkOrderStatus(value);
  // A successful /flight/order/pay response is authoritative for payment
  // acceptance. A lagging detail response must never reopen the payment action.
  return mapped === "PENDING_PAYMENT" ? "PROCESSING" : mapped;
}

export function reconcileSupplierStatus(
  current: OrderStatus,
  next: OrderStatus,
): { status: OrderStatus; conflict: boolean } {
  if (current === "CANCELLED") return { status: current, conflict: next !== current };
  if (current === "TICKETED" && next !== "TICKETED") return { status: current, conflict: true };
  if (current === "CONFIRMED" && !["CONFIRMED", "CANCELLED"].includes(next)) {
    return { status: current, conflict: true };
  }
  if (current === "FAILED" && !["FAILED", "CANCELLED"].includes(next)) {
    return { status: current, conflict: true };
  }
  return { status: next, conflict: false };
}

import { describe, expect, it } from "vitest";
import {
  mapFlinkOrderStatus,
  mapFlinkPostPaymentStatus,
  reconcileSupplierStatus,
} from "../server/fcg/order-status.js";

describe("F-Link order status mapping", () => {
  it.each([
    [1, "PENDING_PAYMENT"],
    [2, "PENDING_PAYMENT"],
    [3, "FAILED"],
    [4, "PENDING_PAYMENT"],
    [5, "PROCESSING"],
    [6, "FAILED"],
    [7, "FAILED"],
    [8, "TICKETED"],
    [9, "CANCELLED"],
  ] as const)("maps upstream status %s to %s", (rawStatus, expected) => {
    expect(mapFlinkOrderStatus(rawStatus)).toBe(expected);
  });

  it("preserves a ticketed terminal state and reports conflicting supplier data", () => {
    expect(reconcileSupplierStatus("TICKETED", "CANCELLED")).toEqual({
      status: "TICKETED",
      conflict: true,
    });
  });

  it.each([
    [undefined, "PROCESSING"],
    [1, "PROCESSING"],
    [2, "PROCESSING"],
    [4, "PROCESSING"],
    [5, "PROCESSING"],
    [8, "TICKETED"],
  ] as const)("never reopens payment after payOrder succeeded: %s -> %s", (rawStatus, expected) => {
    expect(mapFlinkPostPaymentStatus(rawStatus)).toBe(expected);
  });
});

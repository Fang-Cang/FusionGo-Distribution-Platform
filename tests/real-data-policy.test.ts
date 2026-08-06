import { describe, expect, it } from "vitest";
import { isSupplierCommerceRequest, simulatedSupplierDataAllowed } from "../server/real-data-policy.js";

describe("real supplier data policy", () => {
  it("allows simulated supplier data only inside automated tests", () => {
    expect(simulatedSupplierDataAllowed("test")).toBe(true);
    expect(simulatedSupplierDataAllowed("development")).toBe(false);
    expect(simulatedSupplierDataAllowed("production")).toBe(false);
  });

  it("covers search, verification, order writes and after-sales reads", () => {
    expect(isSupplierCommerceRequest("POST", "/api/hotels/search")).toBe(true);
    expect(isSupplierCommerceRequest("POST", "/api/flights/verify")).toBe(true);
    expect(isSupplierCommerceRequest("POST", "/api/orders/FG1/pay")).toBe(true);
    expect(isSupplierCommerceRequest("GET", "/api/orders/FG1/flight-aftersales")).toBe(true);
    expect(isSupplierCommerceRequest("GET", "/api/orders")).toBe(false);
    expect(isSupplierCommerceRequest("PATCH", "/api/account/profile")).toBe(false);
  });
});

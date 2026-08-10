import { describe, expect, it } from "vitest";
import { isSupplierCommerceRequest, localHotelSimulationAllowed, simulatedSupplierDataAllowed } from "../server/real-data-policy.js";

describe("real supplier data policy", () => {
  it("allows simulated supplier data only inside automated tests or sandbox+simulation flag", () => {
    expect(simulatedSupplierDataAllowed("test")).toBe(true);
    expect(simulatedSupplierDataAllowed("development")).toBe(false);
    expect(simulatedSupplierDataAllowed("production")).toBe(false);
    // sandbox 模式未开启模拟开关 -> 不允许
    expect(simulatedSupplierDataAllowed("production", "sandbox", "false")).toBe(false);
    expect(simulatedSupplierDataAllowed("production", "sandbox", undefined)).toBe(false);
    // sandbox 模式显式开启模拟开关 -> 允许（用于部署机无真实凭证时兜底）
    expect(simulatedSupplierDataAllowed("production", "sandbox", "true")).toBe(true);
    // 非 sandbox 模式即使开了 flag 也不允许
    expect(simulatedSupplierDataAllowed("production", "mock", "true")).toBe(false);
    expect(simulatedSupplierDataAllowed("production", "production", "true")).toBe(false);
  });

  it("uses local hotels only for mock mode or credential-free sandbox simulation", () => {
    expect(localHotelSimulationAllowed("mock", false, "production", "false")).toBe(true);
    expect(localHotelSimulationAllowed("sandbox", false, "production", "true")).toBe(true);
    expect(localHotelSimulationAllowed("sandbox", true, "production", "true")).toBe(false);
    expect(localHotelSimulationAllowed("sandbox", false, "production", "false")).toBe(false);
    expect(localHotelSimulationAllowed("production", false, "production", "true")).toBe(false);
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

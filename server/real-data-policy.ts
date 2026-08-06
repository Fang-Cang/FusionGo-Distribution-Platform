export const simulatedSupplierDataAllowed = (
  nodeEnvironment = process.env.NODE_ENV,
  fcgMode = process.env.FCG_MODE,
  simulationFlag = process.env.FCG_SANDBOX_HOTEL_SIMULATION,
) =>
  // vitest 自动化测试
  nodeEnvironment === "test"
  // sandbox 显式开启模拟兜底（用于部署机尚未拿到真实 FCG 凭证时跑通 UI）
  || (fcgMode === "sandbox" && simulationFlag === "true");

export function isSupplierCommerceRequest(method: string, path: string) {
  if (path.startsWith("/api/hotels/") || path.startsWith("/api/flights/") || path.startsWith("/api/integration/")) {
    return true;
  }
  if (!path.startsWith("/api/orders")) return false;
  return method !== "GET" || path.includes("flight-aftersales");
}

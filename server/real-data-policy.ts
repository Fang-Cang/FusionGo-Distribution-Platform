export const simulatedSupplierDataAllowed = (
  nodeEnvironment = process.env.NODE_ENV,
  _fcgMode = process.env.FCG_MODE,
  _simulationFlag = process.env.FCG_SANDBOX_HOTEL_SIMULATION,
) => nodeEnvironment === "test";

export const localHotelSimulationAllowed = (
  mode: "mock" | "sandbox" | "production",
  glinkConfigured: boolean,
  nodeEnvironment = process.env.NODE_ENV,
  simulationFlag = process.env.FCG_SANDBOX_HOTEL_SIMULATION,
) => mode === "mock"
  || (mode === "sandbox"
    && !glinkConfigured
    && simulatedSupplierDataAllowed(nodeEnvironment, mode, simulationFlag));

export function isSupplierCommerceRequest(method: string, path: string) {
  if (path.startsWith("/api/hotels/") || path.startsWith("/api/flights/") || path.startsWith("/api/integration/")) {
    // Destination keyword lookup is a read-only metadata search (no prices,
    // availability, or orders). It must stay reachable so the UI can connect
    // to the real G-Link destination index even when commerce is blocked.
    if (path === "/api/hotels/destination") return false;
    return true;
  }
  if (!path.startsWith("/api/orders")) return false;
  return method !== "GET" || path.includes("flight-aftersales");
}

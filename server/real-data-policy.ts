export const simulatedSupplierDataAllowed = (
  nodeEnvironment = process.env.NODE_ENV,
  fcgMode = process.env.FCG_MODE,
  simulationFlag = process.env.FCG_SANDBOX_HOTEL_SIMULATION,
) =>
  // vitest automated tests
  nodeEnvironment === "test"
  // Sandbox explicit simulation fallback (for running UI before real FCG credentials are available)
  || (fcgMode === "sandbox" && simulationFlag === "true");

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

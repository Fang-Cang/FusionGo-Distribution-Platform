export const simulatedSupplierDataAllowed = (nodeEnvironment = process.env.NODE_ENV) =>
  nodeEnvironment === "test";

export function isSupplierCommerceRequest(method: string, path: string) {
  if (path.startsWith("/api/hotels/") || path.startsWith("/api/flights/") || path.startsWith("/api/integration/")) {
    return true;
  }
  if (!path.startsWith("/api/orders")) return false;
  return method !== "GET" || path.includes("flight-aftersales");
}

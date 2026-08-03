import "dotenv/config";
import { fcgValue } from "../server/fcg/adapters.js";
import { getFcgRuntime } from "../server/fcg/runtime.js";

const runtime = getFcgRuntime();
const orderNos = process.argv.slice(2).filter(argument => !argument.startsWith("--"));

if (runtime.mode !== "sandbox" || runtime.environment !== "sandbox") {
  throw new Error("This one-time status check only runs with sandbox credentials");
}
if (!runtime.flinkConfigured) throw new Error("F-Link sandbox credentials are not configured");
if (!orderNos.length) throw new Error("Pass at least one F-Link order number");

const results = [];
for (const orderNo of orderNos) {
  const auditOffset = runtime.flink.auditTrail().length;
  try {
    const detail = fcgValue.record(
      await runtime.flink.flink<unknown>("zh_CN", "/flight/order/detail", { orderNo }),
    );
    results.push({
      orderNo,
      ok: true,
      status: fcgValue.number(detail.status),
      payStatus: fcgValue.number(detail.payStatus),
      passengerTypes: fcgValue.array(detail.passenger)
        .map(fcgValue.record)
        .map(passenger => fcgValue.string(passenger.type)),
      audit: runtime.flink.auditTrail().slice(auditOffset),
    });
  } catch (error) {
    results.push({
      orderNo,
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      audit: runtime.flink.auditTrail().slice(auditOffset),
    });
  }
}

console.log(JSON.stringify({ environment: runtime.environment, results }, null, 2));
if (results.some(result => !result.ok)) process.exitCode = 1;

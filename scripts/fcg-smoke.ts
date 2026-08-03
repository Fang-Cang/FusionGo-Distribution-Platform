import "dotenv/config";
import { FcgError } from "../server/fcg/client.js";
import { getFcgRuntime } from "../server/fcg/runtime.js";

const runtime = getFcgRuntime();
const requested = process.argv.find(argument => argument.startsWith("--product="))?.split("=")[1] || "all";
const orderNo = process.argv.find(argument => argument.startsWith("--order-no="))
  ?.slice("--order-no=".length)
  .trim();

console.log(JSON.stringify({
  mode: runtime.mode,
  environment: runtime.environment,
  baseUrl: runtime.baseUrl,
  glinkConfigured: runtime.glinkConfigured,
  flinkConfigured: runtime.flinkConfigured,
}, null, 2));

if (runtime.mode === "mock") {
  console.error("FCG_MODE=mock：请在 .env 中切换为 sandbox 后再执行真实冒烟测试。");
  process.exitCode = 2;
} else {
  try {
    if ((requested === "all" || requested === "glink") && runtime.glinkConfigured) {
      const countries = await runtime.glink.glink<unknown>("/region/countries", { language: "en-US" });
      console.log(`G-Link /region/countries: SUCCESS (${Array.isArray(countries) ? countries.length : 0} records)`);
    }
    if ((requested === "all" || requested === "flink") && runtime.flinkConfigured) {
      const checks: Array<[string, unknown]> = [
        ["/airports/search", await runtime.flink.flink<unknown>("zh_CN", "/airports/search", { keyword: "HKG" })],
        ["/airports/list", await runtime.flink.flink<unknown>("zh_CN", "/airports/list", { page: 1, pageSize: 10 })],
        ["/airlines/list", await runtime.flink.flink<unknown>("zh_CN", "/airlines/list", { page: 1, pageSize: 10 })],
        ["/nationality/list", await runtime.flink.flink<unknown>("zh_CN", "/nationality/list", {})],
      ];
      for (const [path, data] of checks) {
        const count = Array.isArray(data)
          ? data.length
          : data && typeof data === "object"
            ? Object.keys(data).length
            : 0;
        console.log(`F-Link ${path}: SUCCESS (${count} top-level records/fields)`);
      }
      if (orderNo) {
        const fields = await runtime.flink.flinkFields<unknown>({ orderNo });
        const count = Array.isArray(fields)
          ? fields.length
          : fields && typeof fields === "object"
            ? Object.keys(fields).length
            : 0;
        console.log(`F-Link /fields: SUCCESS (${count} top-level records/fields)`);
      }
    }
    if ((requested === "glink" && !runtime.glinkConfigured) || (requested === "flink" && !runtime.flinkConfigured)) {
      throw new Error(`${requested} 沙箱凭证尚未配置`);
    }
  } catch (error) {
    if (error instanceof FcgError) {
      console.error(JSON.stringify({
        code: error.code,
        message: error.message,
        httpStatus: error.status,
        requestId: error.requestId,
        traceId: error.traceId,
      }, null, 2));
    } else {
      console.error(error instanceof Error ? error.message : error);
    }
    process.exitCode = 1;
  }
}

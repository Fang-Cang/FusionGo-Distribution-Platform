import "dotenv/config";
import {
  checkGlinkAvailability,
  fcgValue,
  hydrateGlinkProduct,
  searchFlinkFlights,
  searchGlinkHotels,
  verifyFlinkFlight,
} from "../server/fcg/adapters.js";
import { FcgError } from "../server/fcg/client.js";
import { getFcgRuntime } from "../server/fcg/runtime.js";

const runtime = getFcgRuntime();

const dateAfter = (days: number) => {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

const printError = (scope: string, error: unknown) => {
  if (error instanceof FcgError) {
    console.error(JSON.stringify({
      scope,
      code: error.code,
      message: error.message,
      httpStatus: error.status,
      requestId: error.requestId,
      traceId: error.traceId,
    }, null, 2));
    return;
  }
  console.error(`${scope}: ${error instanceof Error ? error.message : String(error)}`);
};

if (runtime.mode === "mock") {
  console.error("FCG_MODE=mock：请切换为 sandbox 后再执行真实下单前链路测试。");
  process.exit(2);
}

console.log(JSON.stringify({
  mode: runtime.mode,
  environment: runtime.environment,
  glinkConfigured: runtime.glinkConfigured,
  flinkConfigured: runtime.flinkConfigured,
}, null, 2));

let hotelPassed = false;
let flightPassed = false;
const checkIn = dateAfter(21);
const checkOut = dateAfter(22);

for (const destination of ["香港"]) {
  try {
    const result = await searchGlinkHotels(runtime.glink, { destination, checkIn, checkOut });
    if (!result.quotes.length) {
      console.log(`G-Link ${destination}: 酒店列表为空，尝试下一个目的地`);
      continue;
    }
    for (const quote of result.quotes) {
      try {
        const hydrated = await hydrateGlinkProduct(runtime.glink, quote);
        await checkGlinkAvailability(runtime.glink, hydrated.quote);
        console.log(`G-Link prebook: SUCCESS (${destination}, ${hydrated.quote.hotelName}, ${checkIn} → ${checkOut})`);
        hotelPassed = true;
        break;
      } catch (error) {
        console.log(`G-Link ${destination}: 当前候选无可订实时房型，继续尝试`);
        printError("G-Link product/availability", error);
      }
    }
    if (hotelPassed) break;
  } catch (error) {
    printError(`G-Link search ${destination}`, error);
  }
}

if (!hotelPassed) {
  try {
    const saleable = fcgValue.record(await runtime.glink.glink<unknown>("/search/hotelIdList", {
      pageNo: 1,
      pageSize: 50,
    }));
    const hotelIds = fcgValue.array(saleable.hotelIds)
      .map(value => fcgValue.number(value))
      .filter(Boolean)
      .slice(0, 10);
    console.log(`G-Link saleable catalog: ${fcgValue.number(saleable.totalCount, hotelIds.length)} hotels`);
    for (const hotelId of hotelIds) {
      try {
        const hydrated = await hydrateGlinkProduct(runtime.glink, {
          id: `standard-${hotelId}`,
          hotelId,
          hotelName: `G-Link Hotel ${hotelId}`,
          checkInDate: checkIn,
          checkOutDate: checkOut,
          roomNum: 1,
          numberOfAdults: 1,
          currency: "CNY",
          nightlyPrice: 0,
        });
        await checkGlinkAvailability(runtime.glink, hydrated.quote);
        console.log(`G-Link prebook: SUCCESS (saleable catalog, ${hydrated.quote.hotelName}, ${checkIn} → ${checkOut})`);
        hotelPassed = true;
        break;
      } catch (error) {
        printError("G-Link saleable product/availability", error);
      }
    }
  } catch (error) {
    printError("G-Link saleable hotel list", error);
  }
}

try {
  const departureDate = dateAfter(30);
  const result = await searchFlinkFlights(runtime.flink, {
    from: "HKG",
    to: "BKK",
    departureDate,
    adults: 1,
  });
  if (!result.quotes.length) throw new Error("HKG → BKK 未返回可验价运价");
  const verified = await verifyFlinkFlight(runtime.flink, result.quotes[0]);
  console.log(`F-Link prebook: SUCCESS (HKG → BKK, ${departureDate}, ${verified.quote.currency} ${verified.quote.totalAmount})`);
  flightPassed = true;
} catch (error) {
  printError("F-Link search/verify", error);
}

if (!hotelPassed || !flightPassed) process.exitCode = 1;

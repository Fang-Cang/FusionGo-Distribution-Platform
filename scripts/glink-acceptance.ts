import "dotenv/config";
import {
  checkGlinkAvailability,
  createGlinkOrder,
  fcgValue,
  hydrateGlinkProduct,
  queryGlinkLowestPrices,
  queryGlinkSaleableHotelIds,
  type HotelQuoteContext,
} from "../server/fcg/adapters.js";
import { FcgError } from "../server/fcg/client.js";
import {
  assertSandboxTestDataAllowed,
  GLINK_SANDBOX_TEST_DESTINATIONS,
  GLINK_SANDBOX_TEST_HOTELS,
} from "../server/fcg/glink-sandbox-test-data.js";
import { getFcgRuntime } from "../server/fcg/runtime.js";

const runtime = getFcgRuntime();
const confirmed = process.argv.includes("--confirm-sandbox-orders");
const integerArgument = (name: string, fallback: number) => {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
};
const requestedRoomNum = integerArgument("--rooms", 1);
const requestedNights = integerArgument("--nights", 1);
const requestedAdults = integerArgument("--adults", requestedRoomNum);
const checks: Array<Record<string, unknown>> = [];
const discoveryFailures: Array<Record<string, unknown>> = [];

const pass = (interfaceName: string, detail: Record<string, unknown> = {}) =>
  checks.push({ interface: interfaceName, status: "PASS", ...detail });
const block = (interfaceName: string, reason: string) =>
  checks.push({ interface: interfaceName, status: "BLOCKED", reason });
const coOrderCode = (suffix: string) =>
  `OPACC${Date.now()}${suffix}${Math.floor(100 + Math.random() * 900)}`;
const addDays = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
const earliestDate = addDays(new Date().toISOString().slice(0, 10), 7);
const latestDate = addDays(new Date().toISOString().slice(0, 10), 30);
const batches = <T>(values: T[], size: number) =>
  Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, (index + 1) * size));
const recordFailure = (scope: string, hotelId: number, error: unknown) => {
  if (discoveryFailures.length >= 30) return;
  discoveryFailures.push({
    scope,
    hotelId,
    code: error instanceof FcgError ? error.code : "DISCOVERY_FAILED",
    message: error instanceof Error ? error.message : String(error),
    requestId: error instanceof FcgError ? error.requestId : undefined,
    traceId: error instanceof FcgError ? error.traceId : undefined,
  });
};

assertSandboxTestDataAllowed(runtime.mode, runtime.environment);
if (!runtime.glinkConfigured) throw new Error("G-Link sandbox credentials are not configured");
if (requestedAdults < requestedRoomNum) {
  throw new Error("--adults must be greater than or equal to --rooms");
}

try {
  pass("acceptance profile", {
    roomNum: requestedRoomNum,
    nights: requestedNights,
    numberOfAdults: requestedAdults,
    createsSandboxOrders: confirmed,
  });
  const catalog = await queryGlinkSaleableHotelIds(runtime.glink, {
    pageNo: 1,
    pageSize: 50,
  });
  pass("/search/hotelIdList", {
    mappedHotelCount: catalog.totalCount,
    returnedHotelCount: catalog.hotelIds.length,
    note: catalog.hotelIds.length
      ? "使用账号可售目录和官方测试清单的交集/并集进行探测"
      : "账号可售目录为空，使用开放平台官方 sandbox 测试酒店清单",
  });

  const uniqueOfficialHotels = [...new Map(
    GLINK_SANDBOX_TEST_HOTELS.map(hotel => [hotel.hotelId, hotel]),
  ).values()];
  pass("official sandbox test data", {
    source: "FCG Developer Platform / G-Link / Hotel Test Data",
    destinationCount: GLINK_SANDBOX_TEST_DESTINATIONS.length,
    hotelRowCount: GLINK_SANDBOX_TEST_HOTELS.length,
    uniqueHotelCount: uniqueOfficialHotels.length,
  });

  let matchedDestinationCount = 0;
  for (const wave of batches(GLINK_SANDBOX_TEST_DESTINATIONS, 5)) {
    const responses = await Promise.all(wave.map(async destination => {
      try {
        const data = await runtime.glink.glink<unknown>("/search/destination", {
          keyWord: destination,
          destinationType: "2",
          source: 0,
        });
        return fcgValue.array(data).some(item =>
          fcgValue.number(fcgValue.record(item).destinationType) === 2);
      } catch (error) {
        recordFailure("destination", 0, error);
        return false;
      }
    }));
    matchedDestinationCount += responses.filter(Boolean).length;
  }
  if (matchedDestinationCount === GLINK_SANDBOX_TEST_DESTINATIONS.length) {
    pass("/search/destination", {
      requestedDestinationCount: GLINK_SANDBOX_TEST_DESTINATIONS.length,
      matchedDestinationCount,
    });
  } else {
    block(
      "/search/destination",
      `仅匹配 ${matchedDestinationCount}/${GLINK_SANDBOX_TEST_DESTINATIONS.length} 个官方测试目的地`,
    );
  }

  let detailedHotelCount = 0;
  for (const wave of batches(batches(uniqueOfficialHotels, 10), 5)) {
    const responses = await Promise.all(wave.map(async hotelBatch => {
      try {
        const data = fcgValue.record(await runtime.glink.glink<unknown>("/hotel/detail", {
          hotelIds: hotelBatch.map(hotel => String(hotel.hotelId)),
          language: "zh-CN",
          settings: ["comment", "hotelFacilityNew", "importantNotices"],
        }));
        return fcgValue.array(data.hotelInfos).length;
      } catch (error) {
        recordFailure("hotel detail", hotelBatch[0]?.hotelId || 0, error);
        return 0;
      }
    }));
    detailedHotelCount += responses.reduce((total, count) => total + count, 0);
  }
  if (detailedHotelCount === uniqueOfficialHotels.length) {
    pass("/hotel/detail", {
      requestedHotelCount: uniqueOfficialHotels.length,
      returnedHotelCount: detailedHotelCount,
      batchCount: Math.ceil(uniqueOfficialHotels.length / 10),
    });
  } else {
    block(
      "/hotel/detail",
      `仅返回 ${detailedHotelCount}/${uniqueOfficialHotels.length} 家官方测试酒店详情`,
    );
  }

  const hotelById = new Map(uniqueOfficialHotels.map(hotel => [hotel.hotelId, hotel]));
  const representativeHotels = [...new Map(
    uniqueOfficialHotels.map(hotel => [hotel.city, hotel]),
  ).values()];
  const dailyCandidates: Array<{
    hotelId: number;
    city: string;
    saleDate: string;
    salePrice: number;
    currency: string;
  }> = [];
  let probedDateCount = 0;
  for (const dayOffset of [7, 14, 21, 30]) {
    const checkInDate = addDays(new Date().toISOString().slice(0, 10), dayOffset);
    const checkOutDate = addDays(checkInDate, requestedNights);
    probedDateCount += 1;
    const hotelBatches = batches(representativeHotels, 10);
    for (const wave of batches(hotelBatches, 5)) {
      const responses = await Promise.all(wave.map(async hotelBatch => {
        try {
          return await queryGlinkLowestPrices(runtime.glink, {
            hotelIds: hotelBatch.map(hotel => hotel.hotelId),
            checkInDate,
            checkOutDate,
          });
        } catch (error) {
          recordFailure("lowestPrice batch", hotelBatch[0]?.hotelId || 0, error);
          return undefined;
        }
      }));
      for (const response of responses) {
        if (!response) continue;
        for (const [hotelId, salePrice] of response.prices) {
          const metadata = hotelById.get(hotelId);
          dailyCandidates.push({
            hotelId,
            city: metadata?.city || "Unknown",
            saleDate: checkInDate,
            salePrice,
            currency: response.currency,
          });
        }
      }
    }
  }
  dailyCandidates.sort((left, right) =>
    left.saleDate.localeCompare(right.saleDate)
    || left.salePrice - right.salePrice
    || left.hotelId - right.hotelId);
  if (dailyCandidates.length) {
    pass("/hotel/lowestPrice", {
      requestedHotelCount: representativeHotels.length,
      batchCountPerDate: Math.ceil(representativeHotels.length / 10),
      pricedHotelDateCount: dailyCandidates.length,
      probeWindow: `${earliestDate}..${latestDate}`,
      probedDateCount,
    });
  } else {
    block(
      "/hotel/lowestPrice",
      `${representativeHotels.length} 个官方测试目的地代表酒店在4组未来日期均返回 SUCCESS 但无价格数据`,
    );
  }

  let prepaidQuote: HotelQuoteContext | undefined;
  let prepaidFirstAvailability: Record<string, unknown> | undefined;
  let selectedCandidate: typeof dailyCandidates[number] | undefined;
  let payAtHotelQuote: HotelQuoteContext | undefined;
  let payAtHotelFirstAvailability: Record<string, unknown> | undefined;

  const productProbeCandidates = dailyCandidates.length
    ? dailyCandidates
    : representativeHotels.flatMap(hotel => [7, 14, 21, 30].map(dayOffset => ({
        hotelId: hotel.hotelId,
        city: hotel.city,
        saleDate: addDays(new Date().toISOString().slice(0, 10), dayOffset),
        salePrice: 0,
        currency: "CNY",
      })));
  for (const candidate of productProbeCandidates) {
    const baseQuote: HotelQuoteContext = {
      id: `acceptance-${candidate.hotelId}-${candidate.saleDate}`,
      hotelId: candidate.hotelId,
      hotelName: `G-Link Test Hotel ${candidate.hotelId}`,
      checkInDate: candidate.saleDate,
      checkOutDate: addDays(candidate.saleDate, requestedNights),
      roomNum: requestedRoomNum,
      numberOfAdults: requestedAdults,
      currency: candidate.currency,
      nightlyPrice: candidate.salePrice,
      city: candidate.city,
    };
    try {
      const hydrated = await hydrateGlinkProduct(runtime.glink, baseQuote, {
        paymentType: "prepaid",
      });
      const availability = await checkGlinkAvailability(runtime.glink, hydrated.quote);
      prepaidQuote = hydrated.quote;
      prepaidFirstAvailability = availability;
      selectedCandidate = candidate;
      pass("/booking/productDetails (prepaid)", {
        destination: candidate.city,
        hotelId: candidate.hotelId,
        checkInDate: candidate.saleDate,
        roomId: hydrated.quote.roomId,
        ratePlanId: hydrated.quote.ratePlanId,
        supplyCode: hydrated.quote.supplyCode,
        payAtHotelFlag: hydrated.quote.payAtHotelFlag,
      });
      pass("/booking/availabilityCheck #1 (prepaid)", {
        hotelId: candidate.hotelId,
        roomNum: hydrated.quote.roomNum,
        totalSalePrice: fcgValue.number(availability.totalSalePrice),
      });
      try {
        const payAtHotel = await hydrateGlinkProduct(runtime.glink, baseQuote, {
          paymentType: "payAtHotel",
        });
        payAtHotelFirstAvailability = await checkGlinkAvailability(runtime.glink, payAtHotel.quote);
        payAtHotelQuote = payAtHotel.quote;
        pass("/booking/productDetails (pay at hotel)", {
          destination: candidate.city,
          hotelId: candidate.hotelId,
          roomId: payAtHotel.quote.roomId,
          ratePlanId: payAtHotel.quote.ratePlanId,
          payAtHotelFlag: payAtHotel.quote.payAtHotelFlag,
        });
        pass("/booking/availabilityCheck #1 (pay at hotel)", {
          hotelId: candidate.hotelId,
          roomNum: payAtHotel.quote.roomNum,
          totalSalePrice: fcgValue.number(payAtHotelFirstAvailability.totalSalePrice),
        });
      } catch (error) {
        recordFailure("pay-at-hotel discovery", candidate.hotelId, error);
      }
      break;
    } catch (error) {
      recordFailure("prepaid product/availability", candidate.hotelId, error);
    }
  }

  if (!prepaidQuote || !prepaidFirstAvailability || !selectedCandidate) {
    block(
      "/booking/productDetails",
      `${productProbeCandidates.length} 次官方测试酒店实时产品查询均返回 SUCCESS 但无可订预付产品`,
    );
    block("/booking/availabilityCheck", "没有 roomId、ratePlanId、supplyCode，按接口约束不得试订");
    block("/booking/createOrder", "首次与二次试订未通过，禁止向上游创建订单");
    block("/booking/payOrder", "没有真实 fcOrderCode，禁止支付通知");
    block("/order/orderDetail", "没有真实 fcOrderCode，无法查询订单");
    block("/order/cancelOrder", "没有真实 fcOrderCode，无法取消订单");
    block("/notify/orderStatus", "没有真实已支付沙箱订单，无法触发供应商状态推送");
    throw new Error(
      "官方目的地与酒店静态数据有效，但当前 Partner 可售目录为0，实时最低价及产品库存为空",
    );
  }

  const prepaidSecondAvailability = await checkGlinkAvailability(runtime.glink, prepaidQuote);
  pass("/booking/availabilityCheck #2 (prepaid)", {
    hotelId: prepaidQuote.hotelId,
    roomNum: prepaidQuote.roomNum,
    firstTotal: fcgValue.number(prepaidFirstAvailability.totalSalePrice),
    secondTotal: fcgValue.number(prepaidSecondAvailability.totalSalePrice),
  });

  if (!confirmed) {
    throw new Error("已完成真实产品与两次验房；增加 --confirm-sandbox-orders 后才允许创建沙箱订单");
  }

  const bookingInput = (roomNum: number) => ({
    guests: Array.from({ length: roomNum }, (_, index) => ({
      roomIndex: index + 1,
      firstName: ["ALICE", "BRIAN", "CHARLIE", "DAVID", "EMILY", "FRANK", "GRACE", "HELEN"][index] || "TEST",
      lastName: "GUEST",
    })),
    contactName: "TEST GUEST",
    phone: "13800138000",
    email: "glink-acceptance@example.com",
    arriveTime: "18:00",
    latestArriveTime: "23:00",
  });

  const paidPartnerOrder = coOrderCode("P");
  const created = await createGlinkOrder(
    runtime.glink,
    prepaidQuote,
    prepaidSecondAvailability,
    bookingInput(prepaidQuote.roomNum),
    paidPartnerOrder,
  );
  const paidFcOrder = fcgValue.string(created.fcOrderCode);
  if (fcgValue.number(created.result) !== 1 || !paidFcOrder) {
    throw new Error(`createOrder rejected: ${fcgValue.string(created.message, "unknown error")}`);
  }
  pass("/booking/createOrder (prepaid)", {
    destination: selectedCandidate.city,
    hotelId: prepaidQuote.hotelId,
    coOrderCode: paidPartnerOrder,
    fcOrderCode: paidFcOrder,
    result: fcgValue.number(created.result),
  });

  const paid = fcgValue.record(await runtime.glink.glink<unknown>("/booking/payOrder", {
    coOrderCode: paidPartnerOrder,
    fcOrderCode: paidFcOrder,
  }));
  if (fcgValue.number(paid.payStatus) !== 1) throw new Error("payOrder was not accepted");
  pass("/booking/payOrder", {
    coOrderCode: paidPartnerOrder,
    fcOrderCode: paidFcOrder,
    payStatus: fcgValue.number(paid.payStatus),
  });

  const detail = fcgValue.record(await runtime.glink.glink<unknown>("/order/orderDetail", {
    coOrderCode: paidPartnerOrder,
    fcOrderCode: paidFcOrder,
  }));
  pass("/order/orderDetail", {
    coOrderCode: fcgValue.string(detail.coOrderCode),
    fcOrderCode: fcgValue.string(detail.fcOrderCode),
    orderStatus: fcgValue.number(detail.orderStatus),
  });

  const cancellationQuote = payAtHotelQuote || prepaidQuote;
  const cancellationFirst = payAtHotelFirstAvailability || prepaidFirstAvailability;
  const cancellationSecond = await checkGlinkAvailability(runtime.glink, cancellationQuote);
  pass("/booking/availabilityCheck #2 (cancellation order)", {
    hotelId: cancellationQuote.hotelId,
    roomNum: cancellationQuote.roomNum,
    paymentType: cancellationQuote.payAtHotelFlag === 1 ? "payAtHotel" : "prepaid",
    firstTotal: fcgValue.number(cancellationFirst.totalSalePrice),
    secondTotal: fcgValue.number(cancellationSecond.totalSalePrice),
  });
  const cancelPartnerOrder = coOrderCode("C");
  const cancelCreated = await createGlinkOrder(
    runtime.glink,
    cancellationQuote,
    cancellationSecond,
    bookingInput(cancellationQuote.roomNum),
    cancelPartnerOrder,
  );
  const cancelFcOrder = fcgValue.string(cancelCreated.fcOrderCode);
  if (fcgValue.number(cancelCreated.result) !== 1 || !cancelFcOrder) {
    throw new Error("Unable to create the cancellation acceptance order");
  }
  pass("/booking/createOrder (cancellation order)", {
    hotelId: cancellationQuote.hotelId,
    coOrderCode: cancelPartnerOrder,
    fcOrderCode: cancelFcOrder,
    payAtHotelFlag: cancellationQuote.payAtHotelFlag,
  });
  const cancelled = fcgValue.record(await runtime.glink.glink<unknown>("/order/cancelOrder", {
    coOrderCode: cancelPartnerOrder,
    fcOrderCode: cancelFcOrder,
    cancelReason: "Sandbox acceptance test",
  }));
  if (![1, 3].includes(fcgValue.number(cancelled.cancelResult))) {
    throw new Error(`cancelOrder refused: ${fcgValue.string(cancelled.message, "unknown error")}`);
  }
  pass("/order/cancelOrder", {
    coOrderCode: cancelPartnerOrder,
    fcOrderCode: cancelFcOrder,
    cancelResult: fcgValue.number(cancelled.cancelResult),
  });

  if (process.env.WEBHOOK_PUBLIC_URL) {
    pass("/notify/orderStatus", {
      state: "WEBHOOK_CONFIGURED_AWAITING_SUPPLIER_EVENT",
      urlConfigured: true,
    });
  } else {
    block("/notify/orderStatus", "未配置可公网访问的 WEBHOOK_PUBLIC_URL，无法接收真实供应商推送");
  }

  console.log(JSON.stringify({
    ok: checks.every(check => check.status === "PASS"),
    environment: runtime.environment,
    selected: {
      destination: selectedCandidate.city,
      hotelId: selectedCandidate.hotelId,
      checkInDate: prepaidQuote.checkInDate,
      checkOutDate: prepaidQuote.checkOutDate,
      roomNum: prepaidQuote.roomNum,
      nights: requestedNights,
      numberOfAdults: prepaidQuote.numberOfAdults,
    },
    checks,
    discoveryFailures,
    auditTrail: runtime.glink.auditTrail(),
  }, null, 2));
} catch (error) {
  const failure = error instanceof FcgError ? {
    code: error.code,
    message: error.message,
    httpStatus: error.status,
    requestId: error.requestId,
    traceId: error.traceId,
  } : {
    code: "ACCEPTANCE_FAILED",
    message: error instanceof Error ? error.message : String(error),
  };
  console.error(JSON.stringify({
    ok: false,
    environment: runtime.environment,
    checks,
    discoveryFailures,
    failure,
    auditTrail: runtime.glink.auditTrail(),
  }, null, 2));
  process.exitCode = 1;
}

import "dotenv/config";
import {
  checkGlinkAvailability,
  createFlinkOrder,
  createGlinkOrder,
  fcgValue,
  hydrateGlinkProduct,
  payFlinkOrder,
  searchFlinkFlights,
  verifyFlinkFlight,
  type FlightBookingInput,
  type FlightQuoteContext,
  type HotelQuoteContext,
} from "../server/fcg/adapters.js";
import { FcgError, type FcgAuditEntry, type FcgClient } from "../server/fcg/client.js";
import {
  assertSandboxTestDataAllowed,
  GLINK_SANDBOX_TEST_HOTELS,
} from "../server/fcg/glink-sandbox-test-data.js";
import { getFcgRuntime } from "../server/fcg/runtime.js";

type CaseResult = {
  caseId: "GL-16A" | "GL-16C" | "FL-18" | "FL-19" | "FL-20";
  scenario: string;
  status: "PASS" | "PARTIAL" | "BLOCKED";
  evidence: Record<string, unknown>;
  audit: FcgAuditEntry[];
};

const runtime = getFcgRuntime();
const confirmOrders = process.argv.includes("--confirm-sandbox-orders");
const compactOutput = process.argv.includes("--compact");
const results: CaseResult[] = [];

const addDays = (days: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const addDaysTo = (dateText: string, days: number) => {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const coOrderCode = (suffix: string) =>
  `OPX${Date.now()}${suffix}${Math.floor(100 + Math.random() * 900)}`;
const errorEvidence = (error: unknown) => error instanceof FcgError
  ? {
      code: error.code,
      message: error.message,
      httpStatus: error.status,
      requestId: error.requestId,
      traceId: error.traceId,
    }
  : { code: "ACCEPTANCE_FAILED", message: error instanceof Error ? error.message : String(error) };
const auditSince = (client: FcgClient, offset: number) => client.auditTrail().slice(offset);

if (runtime.mode !== "sandbox" || runtime.environment !== "sandbox") {
  throw new Error("Extended acceptance only runs with sandbox credentials");
}
assertSandboxTestDataAllowed(runtime.mode, runtime.environment);
if (!runtime.glinkConfigured || !runtime.flinkConfigured) {
  throw new Error("Both G-Link and F-Link sandbox credentials must be configured");
}

const prioritizedHotelIds = [
  606680, 605800, 605803, 606361, 606362, 112291, 112865, 112950,
  10251105, 10233794, 150739, 542355, 10037273, 10038630,
];
const hotelMetadata = new Map(GLINK_SANDBOX_TEST_HOTELS.map(hotel => [hotel.hotelId, hotel]));
const hotelCandidates = prioritizedHotelIds
  .map(hotelId => hotelMetadata.get(hotelId))
  .filter((hotel): hotel is NonNullable<typeof hotel> => Boolean(hotel));
const hotelDates = [7, 14, 21, 30, 45].map(addDays);

async function findHotelProduct(input: {
  numberOfAdults: number;
  numberOfChildren: number;
  childrenAges: number[];
}) {
  const failures: Array<Record<string, unknown>> = [];
  for (const checkInDate of hotelDates) {
    for (const hotel of hotelCandidates) {
      const quote: HotelQuoteContext = {
        id: `EXT-${hotel.hotelId}-${checkInDate}-${input.numberOfAdults}-${input.numberOfChildren}`,
        hotelId: hotel.hotelId,
        hotelName: `G-Link Test Hotel ${hotel.hotelId}`,
        checkInDate,
        checkOutDate: addDaysTo(checkInDate, 1),
        roomNum: 1,
        numberOfAdults: input.numberOfAdults,
        numberOfChildren: input.numberOfChildren,
        childrenAges: input.childrenAges,
        currency: "CNY",
        nightlyPrice: 0,
        city: hotel.city,
      };
      try {
        const hydrated = await hydrateGlinkProduct(runtime.glink, quote, { paymentType: "prepaid" });
        const availability = await checkGlinkAvailability(runtime.glink, hydrated.quote);
        return { quote: hydrated.quote, availability, failures };
      } catch (error) {
        if (failures.length < 12) failures.push({
          hotelId: hotel.hotelId,
          city: hotel.city,
          checkInDate,
          ...errorEvidence(error),
        });
      }
    }
  }
  throw Object.assign(new Error("No official G-Link test hotel passed the requested occupancy"), { failures });
}

async function runHotelCase(
  caseId: "GL-16A" | "GL-16C",
  scenario: string,
  occupancy: { numberOfAdults: number; numberOfChildren: number; childrenAges: number[] },
) {
  const auditOffset = runtime.glink.auditTrail().length;
  try {
    const selected = await findHotelProduct(occupancy);
    const evidence: Record<string, unknown> = {
      environment: runtime.environment,
      hotelId: selected.quote.hotelId,
      city: selected.quote.city,
      checkInDate: selected.quote.checkInDate,
      checkOutDate: selected.quote.checkOutDate,
      roomNum: selected.quote.roomNum,
      numberOfAdults: selected.quote.numberOfAdults,
      numberOfChildren: selected.quote.numberOfChildren || 0,
      childrenAges: selected.quote.childrenAges || [],
      roomId: selected.quote.roomId,
      ratePlanId: selected.quote.ratePlanId,
      supplyCode: selected.quote.supplyCode,
      canBook: fcgValue.number(selected.availability.canBook),
      totalSalePrice: fcgValue.number(selected.availability.totalSalePrice),
      currency: selected.quote.currency,
    };
    if (confirmOrders) {
      const secondAvailability = await checkGlinkAvailability(runtime.glink, selected.quote);
      const partnerOrderNo = coOrderCode(caseId.replace(/\W/g, ""));
      const created = await createGlinkOrder(runtime.glink, selected.quote, secondAvailability, {
        guests: [{ roomIndex: 1, firstName: "TEST", lastName: "GUEST" }],
        contactName: "TEST GUEST",
        phone: "13800138000",
        email: "extended-hotel-acceptance@example.com",
        arriveTime: "18:00",
        latestArriveTime: "23:00",
      }, partnerOrderNo);
      const supplierOrderNo = fcgValue.string(created.fcOrderCode);
      if (fcgValue.number(created.result) !== 1 || !supplierOrderNo) {
        throw new Error(`G-Link createOrder rejected: ${fcgValue.string(created.message, "unknown error")}`);
      }
      const detail = fcgValue.record(await runtime.glink.glink<unknown>("/order/orderDetail", {
        coOrderCode: partnerOrderNo,
        fcOrderCode: supplierOrderNo,
      }));
      const roomGuestNumbers = fcgValue.array(detail.roomGuestNumbers).map(fcgValue.record);
      const roomOccupancy = roomGuestNumbers[0] || {};
      if (roomGuestNumbers.length
        && (fcgValue.number(roomOccupancy.numberOfAdults) !== occupancy.numberOfAdults
          || fcgValue.number(roomOccupancy.numberOfChildren) !== occupancy.numberOfChildren)) {
        throw new Error("G-Link order detail occupancy does not match the submitted adults/children");
      }
      const cancelled = fcgValue.record(await runtime.glink.glink<unknown>("/order/cancelOrder", {
        coOrderCode: partnerOrderNo,
        fcOrderCode: supplierOrderNo,
        cancelReason: `${caseId} sandbox acceptance cleanup`,
      }));
      if (![1, 3].includes(fcgValue.number(cancelled.cancelResult))) {
        throw new Error(`G-Link cancellation refused: ${fcgValue.string(cancelled.message, "unknown error")}`);
      }
      Object.assign(evidence, {
        secondAvailabilityTotal: fcgValue.number(secondAvailability.totalSalePrice),
        coOrderCode: partnerOrderNo,
        fcOrderCode: supplierOrderNo,
        createResult: fcgValue.number(created.result),
        orderStatusBeforeCancel: fcgValue.number(detail.orderStatus),
        roomGuestNumbers,
        cancelResult: fcgValue.number(cancelled.cancelResult),
      });
    }
    results.push({
      caseId,
      scenario,
      status: confirmOrders ? "PASS" : "PARTIAL",
      evidence,
      audit: auditSince(runtime.glink, auditOffset),
    });
  } catch (error) {
    results.push({
      caseId,
      scenario,
      status: "BLOCKED",
      evidence: {
        ...errorEvidence(error),
        failures: fcgValue.array(fcgValue.record(error).failures),
      },
      audit: auditSince(runtime.glink, auditOffset),
    });
  }
}

const adultPassenger = (): FlightBookingInput["passengers"][number] => ({
  surname: "TEST",
  name: "ADULT",
  nationality: "CN",
  gender: "1",
  idType: "2",
  idNumber: "E10000001",
  birthday: "1990-01-01",
  expiration: "2032-01-01",
  type: "adult",
});
const childPassenger = (): FlightBookingInput["passengers"][number] => ({
  surname: "TEST",
  name: "CHILD",
  nationality: "CN",
  gender: "2",
  idType: "2",
  idNumber: "E10000002",
  birthday: "2018-01-01",
  expiration: "2032-01-01",
  type: "child",
});
const infantPassenger = (): FlightBookingInput["passengers"][number] => ({
  surname: "TEST",
  name: "INFANT",
  nationality: "CN",
  gender: "1",
  idType: "2",
  idNumber: "E10000003",
  birthday: "2025-01-01",
  expiration: "2032-01-01",
  type: "infant",
  adultPassengerName: "TEST/ADULT",
});

async function findVerifiedFlight(searches: Array<Parameters<typeof searchFlinkFlights>[1]>) {
  const failures: Array<Record<string, unknown>> = [];
  for (const searchInput of searches) {
    try {
      const search = await searchFlinkFlights(runtime.flink, searchInput);
      for (const quote of search.quotes.slice(0, 40)) {
        try {
          const verified = await verifyFlinkFlight(runtime.flink, quote);
          return { searchInput, search, quote: verified.quote, failures };
        } catch (error) {
          if (failures.length < 15) failures.push({ stage: "verify", ...searchInput, ...errorEvidence(error) });
        }
      }
      if (failures.length < 15) failures.push({ stage: "search", ...searchInput, message: "No verifiable priceKey" });
    } catch (error) {
      if (failures.length < 15) failures.push({ stage: "search", ...searchInput, ...errorEvidence(error) });
    }
  }
  throw Object.assign(new Error("No F-Link offer passed search and verify"), { failures });
}

async function createFlightOrder(
  quote: FlightQuoteContext,
  passengers: FlightBookingInput["passengers"],
) {
  const created = await createFlinkOrder(runtime.flink, quote, {
    contactName: "TEST ADULT",
    contactPhone: "13800138000",
    contactEmail: "extended-flight-acceptance@example.com",
    passengers,
  });
  const orderNo = fcgValue.string(created.orderNo);
  if (!orderNo) throw new Error("F-Link createOrder did not return orderNo");
  const amount = fcgValue.number(created.priceTotal, quote.totalAmount);
  const paid = await payFlinkOrder(runtime.flink, { orderNo, amount });
  return { created, orderNo, amount, paid };
}

async function runFlightCase(
  caseId: "FL-18" | "FL-19" | "FL-20",
  scenario: string,
  searches: Array<Parameters<typeof searchFlinkFlights>[1]>,
  passengers: FlightBookingInput["passengers"],
) {
  const auditOffset = runtime.flink.auditTrail().length;
  try {
    const selected = await findVerifiedFlight(searches);
    const evidence: Record<string, unknown> = {
      environment: runtime.environment,
      search: selected.searchInput,
      offerCount: selected.search.offers.length,
      priceKeyMasked: `${selected.quote.priceKey.slice(0, 8)}…${selected.quote.priceKey.slice(-6)}`,
      tripType: selected.quote.tripType,
      journeys: selected.search.offers[0]?.journeys,
      adultNum: selected.quote.adultNum,
      childNum: selected.quote.childNum || 0,
      infantNum: selected.quote.infantNum || 0,
      verifiedAmount: selected.quote.totalAmount,
      currency: selected.quote.currency,
    };
    if (confirmOrders) {
      const order = await createFlightOrder(selected.quote, passengers);
      Object.assign(evidence, {
        orderNo: order.orderNo,
        createdPriceTotal: fcgValue.number(order.created.priceTotal),
        payStatus: order.paid.payStatus,
        supplierStatus: order.paid.rawStatus,
        detailPending: order.paid.detailPending,
        passengerTypes: fcgValue.array(fcgValue.record(order.paid.detail).passenger)
          .map(fcgValue.record)
          .map(passenger => fcgValue.string(passenger.type)),
      });
    }
    results.push({
      caseId,
      scenario,
      status: confirmOrders ? "PASS" : "PARTIAL",
      evidence,
      audit: auditSince(runtime.flink, auditOffset),
    });
  } catch (error) {
    results.push({
      caseId,
      scenario,
      status: "BLOCKED",
      evidence: {
        ...errorEvidence(error),
        failures: fcgValue.array(fcgValue.record(error).failures),
      },
      audit: auditSince(runtime.flink, auditOffset),
    });
  }
}

await runHotelCase("GL-16A", "1间 · 2成人 · 1名8岁儿童", {
  numberOfAdults: 2,
  numberOfChildren: 1,
  childrenAges: [8],
});
await runHotelCase("GL-16C", "1间 · 2成人", {
  numberOfAdults: 2,
  numberOfChildren: 0,
  childrenAges: [],
});
await runHotelCase("GL-16C", "1间 · 3成人", {
  numberOfAdults: 3,
  numberOfChildren: 0,
  childrenAges: [],
});

const oneWayDates = [7, 14, 21, 30, 45].map(addDays);
const familyRoutes = [
  ["SIN", "BKK"],
  ["HKG", "BKK"],
  ["HKG", "SIN"],
  ["WUH", "HKG"],
  ["SHA", "HKG"],
] as const;
await runFlightCase(
  "FL-18",
  "1成人+1儿童",
  oneWayDates.flatMap(departureDate => familyRoutes.map(([from, to]) => ({
    from,
    to,
    departureDate,
    adults: 1,
    children: 1,
    infants: 0,
  }))),
  [adultPassenger(), childPassenger()],
);
await runFlightCase(
  "FL-18",
  "1成人+1婴儿",
  oneWayDates.flatMap(departureDate => familyRoutes.map(([from, to]) => ({
    from,
    to,
    departureDate,
    adults: 1,
    children: 0,
    infants: 1,
  }))),
  [adultPassenger(), infantPassenger()],
);

await runFlightCase(
  "FL-19",
  "SIN ↔ BKK · 往返",
  oneWayDates.map(departureDate => ({
    from: "SIN",
    to: "BKK",
    departureDate,
    adults: 1,
    tripType: 2 as const,
    journeys: [
      { origin: "SIN", destination: "BKK", date: departureDate },
      { origin: "BKK", destination: "SIN", date: addDaysTo(departureDate, 7) },
    ],
  })),
  [adultPassenger()],
);

const multiCityTemplates = [
  [["SIN", "BKK"], ["BKK", "HKG"]],
  [["HKG", "BKK"], ["BKK", "SIN"]],
  [["SIN", "KUL"], ["KUL", "BKK"]],
  [["SIN", "BKK"], ["BKK", "SIN"]],
  [["WUH", "HKG"], ["HKG", "BKK"]],
  [["SHA", "HKG"], ["HKG", "SIN"]],
  [["HKG", "SIN"], ["SIN", "BKK"]],
] as const;
const multiCitySearches = oneWayDates.flatMap(departureDate => multiCityTemplates.map(template => ({
  from: template[0][0],
  to: template[0][1],
  departureDate,
  adults: 1,
  tripType: 3 as const,
  journeys: [
    { origin: template[0][0], destination: template[0][1], date: departureDate },
    { origin: template[1][0], destination: template[1][1], date: addDaysTo(departureDate, 4) },
  ],
})));
await runFlightCase("FL-20", "两段多程组合", multiCitySearches, [adultPassenger()]);

const outputResults = compactOutput ? results.map(result => ({
  ...result,
  audit: result.audit.length <= 12
    ? result.audit
    : [...result.audit.slice(0, 6), ...result.audit.slice(-6)],
})) : results;
console.log(JSON.stringify({
  ok: results.every(result => result.status === "PASS"),
  environment: runtime.environment,
  confirmSandboxOrders: confirmOrders,
  results: outputResults,
}, null, 2));

if (results.some(result => result.status === "BLOCKED")) process.exitCode = 1;

import { describe, expect, it } from "vitest";
import {
  createFlinkOrder,
  normalizeFlinkFlightDestinations,
  payFlinkOrder,
  refreshFlinkCabin,
  searchFlinkFlightDestinations,
  searchFlinkFlights,
  verifyFlinkFlight,
  type FlightQuoteContext,
} from "../server/fcg/adapters.js";
import type { FcgClient } from "../server/fcg/client.js";

function stubClient(responses: Record<string, unknown>) {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const client = {
    async flink(_lang: string, path: string, body: Record<string, unknown>) {
      calls.push({ path, body });
      const configured = responses[path];
      const response = Array.isArray(configured) ? configured.shift() : configured;
      if (response instanceof Error) throw response;
      return structuredClone(response);
    },
  } as unknown as FcgClient;
  return { client, calls };
}

const quote: FlightQuoteContext = {
  id: "FQ-1",
  priceKey: "search-price-key",
  from: "WUH",
  to: "HKG",
  departureDate: "2026-08-20",
  adultNum: 1,
  totalAmount: 657,
  currency: "CNY",
  title: "WUH → HKG",
  subtitle: "CX937 · 2026-08-20",
};

describe("F-Link flight destination search", () => {
  it("calls airports.search with the Daxing International keyword and normalizes city and airport choices", async () => {
    const { client, calls } = stubClient({
      "/airports/search": {
        currentPage: 1,
        data: [{
          id: 1,
          airPort: "PKX",
          airPortName: "北京大兴国际机场",
          cityCode: "BJS",
          cityName: "北京",
          country: "中国",
        }],
      },
    });

    const results = await searchFlinkFlightDestinations(client, "大兴国际", "zh_CN");

    expect(calls[0]).toEqual({ path: "/airports/search", body: { keyword: "大兴国际" } });
    expect(results).toEqual([
      expect.objectContaining({ code: "BJS", type: 1, cityName: "北京" }),
      expect.objectContaining({ code: "PKX", type: 2, airportName: "北京大兴国际机场" }),
    ]);
  });

  it("accepts the paginated data shape documented by the Flink OpenAPI", () => {
    expect(normalizeFlinkFlightDestinations({ data: { data: [{
      airPort: "SIN",
      airPortName: "Singapore Changi Airport",
      cityCode: "SIN",
      cityName: "Singapore",
      country: "Singapore",
    }] } })).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "SIN", type: 1, displayName: "Singapore" }),
      expect.objectContaining({ code: "SIN", type: 2, displayName: "Singapore Changi Airport" }),
    ]));
  });
});

describe("F-Link mandatory booking workflow", () => {
  it("sends the required origin and destination types for a one-way city search", async () => {
    const { client, calls } = stubClient({
      "/flight/search": { segments: {}, flight: [] },
    });

    await searchFlinkFlights(client, {
      from: "HKG",
      to: "SIN",
      departureDate: "2026-09-25",
      adults: 1,
      journeys: [{
        date: "2026-09-25",
        destination: "SIN",
        destinationType: 1,
        origin: "HKG",
        originType: 1,
      }],
    });

    expect(calls[0].body).toMatchObject({
      journeys: [{
        date: "2026-09-25",
        destination: "SIN",
        destinationType: 1,
        origin: "HKG",
        originType: 1,
      }],
    });
  });

  it("sends round-trip journeys and preserves both legs in the offer", async () => {
    const { client, calls } = stubClient({
      "/flight/search": {
        segments: {
          "seg-out": {
            departureAirport: "SIN",
            arrivalAirport: "BKK",
            departureDate: "2026-08-20",
            departureTime: "08:00",
            arrivalTime: "09:30",
            airlineCode: "SQ",
            airlineName: "Singapore Airlines",
            flightNumber: "SQ706",
          },
          "seg-back": {
            departureAirport: "BKK",
            arrivalAirport: "SIN",
            departureDate: "2026-08-27",
            departureTime: "18:00",
            arrivalTime: "21:20",
            airlineCode: "SQ",
            airlineName: "Singapore Airlines",
            flightNumber: "SQ711",
          },
        },
        flight: [{
          journeys: [
            { airSegmentList: ["seg-out"], flightNumberList: ["SQ706"], journeysTime: "2h30m" },
            { airSegmentList: ["seg-back"], flightNumberList: ["SQ711"], journeysTime: "2h20m" },
          ],
          offerPriceList: [{
            priceKey: "round-trip-key",
            currency: "CNY",
            totalSalePrice: 2600,
            priceDetail: [{ passengerType: "adult", number: 1, salePrice: 2600 }],
          }],
        }],
      },
    });
    const result = await searchFlinkFlights(client, {
      from: "SIN",
      to: "BKK",
      departureDate: "2026-08-20",
      adults: 1,
      tripType: 2,
      journeys: [
        { origin: "SIN", destination: "BKK", date: "2026-08-20" },
        { origin: "BKK", destination: "SIN", date: "2026-08-27" },
      ],
    });
    expect(calls[0].body).toMatchObject({
      tripType: 2,
      journeys: [
        expect.objectContaining({ origin: "SIN", destination: "BKK", date: "2026-08-20", originType: 1, destinationType: 1 }),
        expect.objectContaining({ origin: "BKK", destination: "SIN", date: "2026-08-27", originType: 1, destinationType: 1 }),
      ],
    });
    expect(result.offers[0]).toMatchObject({
      tripType: 2,
      priceKey: "round-trip-key",
      journeys: [
        expect.objectContaining({ origin: "SIN", destination: "BKK", flightNo: "SQ706" }),
        expect.objectContaining({ origin: "BKK", destination: "SIN", flightNo: "SQ711" }),
      ],
    });
  });

  it("sends a multi-city request and preserves every returned journey", async () => {
    const segments = Object.fromEntries([
      ["seg-1", "SIN", "BKK", "2026-08-20", "SQ706"],
      ["seg-2", "BKK", "HKG", "2026-08-23", "CX750"],
      ["seg-3", "HKG", "SIN", "2026-08-27", "SQ899"],
    ].map(([id, departureAirport, arrivalAirport, departureDate, flightNumber], index) => [id, {
      departureAirport,
      arrivalAirport,
      departureDate,
      departureTime: `${8 + index * 3}:00`,
      arrivalTime: `${10 + index * 3}:30`,
      airlineCode: flightNumber.slice(0, 2),
      airlineName: `Airline ${index + 1}`,
      flightNumber,
    }]));
    const { client, calls } = stubClient({
      "/flight/search": {
        segments,
        flight: [{
          journeys: [
            { airSegmentList: ["seg-1"], flightNumberList: ["SQ706"], journeysTime: "2h30m" },
            { airSegmentList: ["seg-2"], flightNumberList: ["CX750"], journeysTime: "2h30m" },
            { airSegmentList: ["seg-3"], flightNumberList: ["SQ899"], journeysTime: "2h30m" },
          ],
          offerPriceList: [{
            priceKey: "multi-city-key",
            currency: "CNY",
            totalSalePrice: 4800,
            priceDetail: [{ passengerType: "adult", number: 1, salePrice: 4800 }],
          }],
        }],
      },
    });
    const journeys = [
      { origin: "SIN", destination: "BKK", date: "2026-08-20" },
      { origin: "BKK", destination: "HKG", date: "2026-08-23" },
      { origin: "HKG", destination: "SIN", date: "2026-08-27" },
    ];
    const result = await searchFlinkFlights(client, {
      from: "SIN",
      to: "BKK",
      departureDate: "2026-08-20",
      adults: 1,
      tripType: 3,
      journeys,
    });
    expect(calls[0].body).toMatchObject({ tripType: 3, journeys });
    expect(result.offers[0]).toMatchObject({
      tripType: 3,
      priceKey: "multi-city-key",
      journeys: [
        expect.objectContaining({ origin: "SIN", destination: "BKK" }),
        expect.objectContaining({ origin: "BKK", destination: "HKG" }),
        expect.objectContaining({ origin: "HKG", destination: "SIN" }),
      ],
    });
  });

  it("completes the second-stage round-trip search with the outbound journeyId", async () => {
    const { client, calls } = stubClient({
      "/flight/search": [
        {
          segments: {
            "seg-out": {
              departureAirport: "SIN",
              arrivalAirport: "BKK",
              departureDate: "2026-08-20",
              departureTime: "08:00",
              arrivalTime: "09:30",
              airlineCode: "SQ",
              airlineName: "Singapore Airlines",
              flightNumber: "SQ706",
            },
          },
          flight: [{
            journeys: [{
              journeyId: "outbound-journey-id",
              airSegmentList: ["seg-out"],
              flightNumberList: ["SQ706"],
              journeysTime: "2h30m",
            }],
            offerPriceList: [{ totalSalePrice: 1200 }],
          }],
        },
        {
          segments: {
            "seg-back": {
              departureAirport: "BKK",
              arrivalAirport: "SIN",
              departureDate: "2026-08-27",
              departureTime: "18:00",
              arrivalTime: "21:20",
              airlineCode: "SQ",
              airlineName: "Singapore Airlines",
              flightNumber: "SQ711",
            },
          },
          flight: [{
            journeys: [{
              journeyId: "return-journey-id",
              airSegmentList: ["seg-back"],
              flightNumberList: ["SQ711"],
              journeysTime: "2h20m",
            }],
            offerPriceList: [{
              priceKey: "combined-round-trip-key",
              currency: "CNY",
              totalSalePrice: 2600,
              priceDetail: [{ passengerType: "adult", number: 1, salePrice: 2600 }],
            }],
          }],
        },
      ],
    });
    const result = await searchFlinkFlights(client, {
      from: "SIN",
      to: "BKK",
      departureDate: "2026-08-20",
      adults: 1,
      tripType: 2,
      journeys: [
        { origin: "SIN", destination: "BKK", date: "2026-08-20" },
        { origin: "BKK", destination: "SIN", date: "2026-08-27" },
      ],
    });
    expect(calls).toHaveLength(2);
    expect(calls[1].body).toMatchObject({ journeyId: ["outbound-journey-id"] });
    expect(result.offers[0]).toMatchObject({
      priceKey: "combined-round-trip-key",
      journeys: [
        expect.objectContaining({ origin: "SIN", destination: "BKK" }),
        expect.objectContaining({ origin: "BKK", destination: "SIN" }),
      ],
    });
  });

  it("refreshes an updated search fare through cabin before verify", async () => {
    const { client, calls } = stubClient({
      "/flight/cabin": {
        flight: [{
          offerPriceList: [{
            priceKey: "cabin-price-key",
            currency: "CNY",
            totalSalePrice: 680,
            priceDetail: [{ passengerType: "adult", number: 1, salePrice: 680 }],
          }],
        }],
      },
      "/flight/verify": {
        offerData: {
          status: 1,
          priceKey: "verified-price-key",
          currency: "CNY",
          totalSalePrice: 680,
          priceDetail: [{ passengerType: "adult", number: 1, salePrice: 680 }],
        },
      },
    });
    const cabin = await refreshFlinkCabin(client, quote);
    expect(cabin.quote.priceKey).toBe("cabin-price-key");
    expect(cabin.quote.totalAmount).toBe(680);
    const verified = await verifyFlinkFlight(client, cabin.quote);
    expect(verified.quote.priceKey).toBe("verified-price-key");
    expect(verified.quote.verifiedAt).toBeTypeOf("number");
    expect(calls.map(call => call.path)).toEqual([
      "/flight/cabin",
      "/flight/verify",
    ]);
    expect(calls[1].body.priceKey).toBe("cabin-price-key");
  });

  it("preserves verified priceKey and passenger fields during order creation", async () => {
    const { client, calls } = stubClient({
      "/flight/order/create": { orderNo: "FL-ORDER-1", priceTotal: 680 },
    });
    await createFlinkOrder(client, { ...quote, priceKey: "verified-price-key" }, {
      contactName: "SANDBOX TEST",
      contactPhone: "13800138000",
      contactEmail: "sandbox@example.com",
      passengers: [{
        surname: "TEST",
        name: "SANDBOX",
        nationality: "CN",
        gender: "1",
        idType: "2",
        idNumber: "E12345678",
        birthday: "1990-06-18",
        expiration: "2031-08-20",
      }],
    });
    expect(calls[0].body.priceKey).toBe("verified-price-key");
    expect(calls[0].body.passenger).toEqual([
      expect.objectContaining({
        surname: "TEST",
        name: "SANDBOX",
        nationality: "CN",
        type: "adult",
      }),
    ]);
  });

  it("preserves child and infant counts, prices and passenger associations", async () => {
    const { client, calls } = stubClient({
      "/flight/search": {
        segments: {
          "seg-1": {
            departureAirport: "SIN",
            arrivalAirport: "BKK",
            departureDate: "2026-08-20",
            departureTime: "08:00",
            arrivalTime: "09:30",
            airlineCode: "SQ",
            airlineName: "Singapore Airlines",
            flightNumber: "SQ706",
          },
        },
        flight: [{
          journeys: [{ airSegmentList: ["seg-1"], flightNumberList: ["SQ706"] }],
          offerPriceList: [{
            priceKey: "family-price-key",
            currency: "CNY",
            totalSalePrice: 3000,
            priceDetail: [
              { passengerType: "adult", number: 1, salePrice: 1500 },
              { passengerType: "child", number: 1, salePrice: 1000 },
              { passengerType: "infant", number: 1, salePrice: 500 },
            ],
          }],
        }],
      },
      "/flight/order/create": { orderNo: "FAMILY-ORDER", priceTotal: 3000 },
    });
    const result = await searchFlinkFlights(client, {
      from: "SIN",
      to: "BKK",
      departureDate: "2026-08-20",
      adults: 1,
      children: 1,
      infants: 1,
    });
    expect(calls[0].body).toMatchObject({ adultNum: 1, childNum: 1, infantNum: 1 });
    expect(result.quotes[0]).toMatchObject({ adultNum: 1, childNum: 1, infantNum: 1, totalAmount: 3000 });

    await createFlinkOrder(client, result.quotes[0], {
      contactName: "TEST ADULT",
      contactPhone: "13800138000",
      contactEmail: "family@example.com",
      passengers: [
        { surname: "TEST", name: "ADULT", nationality: "CN", gender: "1", idType: "2", idNumber: "E10000001", birthday: "1990-01-01", expiration: "2032-01-01", type: "adult" },
        { surname: "TEST", name: "CHILD", nationality: "CN", gender: "2", idType: "2", idNumber: "E10000002", birthday: "2018-01-01", expiration: "2032-01-01", type: "child" },
        { surname: "TEST", name: "INFANT", nationality: "CN", gender: "1", idType: "2", idNumber: "E10000003", birthday: "2025-01-01", expiration: "2032-01-01", type: "infant", adultPassengerName: "TEST/ADULT" },
      ],
    });
    expect(calls[1].body.passenger).toEqual([
      expect.objectContaining({ type: "adult" }),
      expect.objectContaining({ type: "child" }),
      expect.objectContaining({ type: "infant", adultPassengerName: "TEST/ADULT" }),
    ]);
  });

  it("keeps payment accepted when the immediate detail query times out", async () => {
    const { client, calls } = stubClient({
      "/flight/order/pay": { payStatus: 1 },
      "/flight/order/detail": new Error("supplier detail timeout"),
    });
    const result = await payFlinkOrder(client, {
      orderNo: "FG20260730000003",
      amount: 680,
    });
    expect(result).toEqual(expect.objectContaining({
      payStatus: 1,
      rawStatus: undefined,
      detailPending: true,
      detailError: expect.objectContaining({
        code: "FLINK_DETAIL_PENDING",
        message: "supplier detail timeout",
      }),
    }));
    expect(calls.map(call => call.path)).toEqual([
      "/flight/order/pay",
      "/flight/order/detail",
    ]);
  });

  it("does not hide an upstream payment rejection", async () => {
    const { client } = stubClient({
      "/flight/order/pay": { payStatus: 0, message: "payment rejected" },
    });
    await expect(payFlinkOrder(client, {
      orderNo: "FG20260730000003",
      amount: 680,
    })).rejects.toMatchObject({
      code: "FLINK_PAY_FAILED",
      message: "payment rejected",
    });
  });
});

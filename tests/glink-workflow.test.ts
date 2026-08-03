import { describe, expect, it } from "vitest";
import {
  checkGlinkAvailability,
  createGlinkOrder,
  hydrateGlinkProduct,
  searchGlinkHotels,
  type HotelQuoteContext,
} from "../server/fcg/adapters.js";
import type { FcgClient } from "../server/fcg/client.js";
import {
  mapGlinkCancelResult,
  mapGlinkOrderDetailStatus,
  mapGlinkOrderStatusWebhook,
} from "../server/fcg/glink-status.js";
import {
  assertSandboxTestDataAllowed,
  GLINK_SANDBOX_TEST_DESTINATIONS,
  GLINK_SANDBOX_TEST_HOTELS,
} from "../server/fcg/glink-sandbox-test-data.js";

function stubClient(responses: Record<string, unknown>) {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const client = {
    async glink(path: string, body: Record<string, unknown>) {
      calls.push({ path, body });
      return structuredClone(responses[path]);
    },
  } as unknown as FcgClient;
  return { client, calls };
}

const baseQuote: HotelQuoteContext = {
  id: "hotel-offer-1",
  hotelId: 10583772,
  hotelName: "G-Link Test Hotel",
  checkInDate: "2026-09-01",
  checkOutDate: "2026-09-04",
  roomNum: 2,
  numberOfAdults: 1,
  currency: "CNY",
  nightlyPrice: 100,
};

describe("G-Link mandatory hotel workflow", () => {
  it("loads the normalized official sandbox hotel list only in sandbox", () => {
    expect(GLINK_SANDBOX_TEST_HOTELS).toHaveLength(148);
    expect(new Set(GLINK_SANDBOX_TEST_HOTELS.map(hotel => hotel.hotelId)).size).toBe(148);
    expect(GLINK_SANDBOX_TEST_DESTINATIONS).toHaveLength(14);
    expect(() => assertSandboxTestDataAllowed("sandbox", "sandbox")).not.toThrow();
    expect(() => assertSandboxTestDataAllowed("production", "production")).toThrow(
      "restricted to the sandbox environment",
    );
  });

  it("gates the list by saleable mapping and hotel/lowestPrice", async () => {
    const { client, calls } = stubClient({
      "/search/destination": [{ destinationId: "SHA", destinationType: 2, cityCode: "SHA" }],
      "/search/hotelIdList": { hotelIds: [10583772], totalCount: 1 },
      "/search/hotelList": {
        list: [
          { hotelId: 10583772, hotelName: "Mapped", cityName: "上海" },
          { hotelId: 999, hotelName: "Not mapped", cityName: "上海" },
        ],
      },
      "/hotel/lowestPrice": {
        currency: "CNY",
        hotelLowestPrices: [{
          hotelId: 10583772,
          priceItems: [{ saleDate: "2026-09-01", salePrice: 88 }],
        }],
      },
      "/hotel/detail": { hotelInfos: [{ hotelId: 10583772, hotelName: "Mapped Hotel" }] },
      "/hotel/images": { hotelImages: [] },
    });

    const result = await searchGlinkHotels(client, {
      destination: "上海",
      checkIn: "2026-09-01",
      checkOut: "2026-09-02",
      rooms: 1,
      adults: 1,
    });

    expect(result.offers).toHaveLength(1);
    expect(result.offers[0].nightlyPrice).toBe(88);
    expect(result.offers[0].inventorySource).toBe("glink");
    expect(calls.map(call => call.path)).toEqual([
      "/search/destination",
      "/search/hotelIdList",
      "/search/hotelList",
      "/hotel/lowestPrice",
      "/hotel/detail",
      "/hotel/images",
    ]);
  });

  it("preserves exact room count through product, availability and createOrder", async () => {
    const { client, calls } = stubClient({
      "/booking/productDetails": {
        roomItems: [{
          roomId: 52047428,
          roomName: "Deluxe",
          products: [{
            bookType: 1,
            ratePlanId: "rate-1",
            ratePlanName: "Flexible",
            supplyCode: "TS10001217",
            payAtHotelFlag: 0,
            totalSalePrice: 200,
            priceItems: [{ saleDate: "2026-09-01", salePrice: 200, currency: "CNY" }],
          }],
        }],
      },
      "/booking/availabilityCheck": {
        canBook: 1,
        totalSalePrice: 600,
        breakfastNum: -1,
        priceItems: [
          { saleDate: "2026-09-01", salePrice: 200 },
          { saleDate: "2026-09-02", salePrice: 200 },
          { saleDate: "2026-09-03", salePrice: 200 },
        ],
      },
      "/booking/createOrder": {
        result: 1,
        coOrderCode: "OP-1",
        fcOrderCode: "FC-1",
      },
    });

    const hydrated = await hydrateGlinkProduct(client, baseQuote);
    const availability = await checkGlinkAvailability(client, hydrated.quote);
    await createGlinkOrder(client, hydrated.quote, availability, {
      guests: [
        { roomIndex: 1, firstName: "TEST1", lastName: "GUEST" },
        { roomIndex: 2, firstName: "TEST2", lastName: "GUEST" },
      ],
      contactName: "TEST GUEST",
      phone: "13800138000",
      email: "test@example.com",
      arriveTime: "18:00",
      latestArriveTime: "23:00",
    }, "OP-1");

    const availabilityCall = calls.find(call => call.path === "/booking/availabilityCheck")!;
    const createCall = calls.find(call => call.path === "/booking/createOrder")!;
    expect(availabilityCall.body.roomNum).toBe(2);
    expect(createCall.body.roomNum).toBe(2);
    expect(createCall.body.totalAmount).toBe(600);
    expect(createCall.body.priceItems).toHaveLength(3);
    expect(createCall.body.guestInfos).toEqual([
      expect.objectContaining({ roomIndex: "1", firstName: "TEST1" }),
      expect.objectContaining({ roomIndex: "2", firstName: "TEST2" }),
    ]);
  });

  it("selects prepaid and pay-at-hotel products explicitly", async () => {
    const productResponse = {
      roomItems: [{
        roomId: 52047428,
        products: [
          {
            bookType: 1,
            payAtHotelFlag: 1,
            ratePlanId: "pay-at-hotel",
            supplyCode: "SUP-1",
            totalSalePrice: 100,
            priceItems: [{ saleDate: "2026-09-01", salePrice: 100, currency: "CNY" }],
          },
          {
            bookType: 1,
            payAtHotelFlag: 0,
            ratePlanId: "prepaid",
            supplyCode: "SUP-2",
            totalSalePrice: 90,
            priceItems: [{ saleDate: "2026-09-01", salePrice: 90, currency: "CNY" }],
          },
        ],
      }],
    };
    const prepaidStub = stubClient({ "/booking/productDetails": productResponse });
    const prepaid = await hydrateGlinkProduct(prepaidStub.client, baseQuote, {
      paymentType: "prepaid",
    });
    expect(prepaid.quote.ratePlanId).toBe("prepaid");
    expect(prepaid.quote.payAtHotelFlag).toBe(0);

    const payAtHotelStub = stubClient({ "/booking/productDetails": productResponse });
    const payAtHotel = await hydrateGlinkProduct(payAtHotelStub.client, baseQuote, {
      paymentType: "payAtHotel",
    });
    expect(payAtHotel.quote.ratePlanId).toBe("pay-at-hotel");
    expect(payAtHotel.quote.payAtHotelFlag).toBe(1);
  });

  it("preserves child count and ages through product, availability and createOrder", async () => {
    const { client, calls } = stubClient({
      "/booking/productDetails": {
        roomItems: [{
          roomId: 52047428,
          products: [{
            bookType: 1,
            ratePlanId: "child-rate",
            supplyCode: "SUP-CHILD",
            totalSalePrice: 360,
            priceItems: [{ saleDate: "2026-09-01", salePrice: 360, currency: "CNY" }],
          }],
        }],
      },
      "/booking/availabilityCheck": {
        canBook: 1,
        totalSalePrice: 360,
        priceItems: [{ saleDate: "2026-09-01", salePrice: 360 }],
      },
      "/booking/createOrder": { result: 1, coOrderCode: "OP-CHILD", fcOrderCode: "FC-CHILD" },
    });
    const childQuote = {
      ...baseQuote,
      roomNum: 1,
      numberOfAdults: 2,
      numberOfChildren: 1,
      childrenAges: [8],
    };
    const hydrated = await hydrateGlinkProduct(client, childQuote);
    const availability = await checkGlinkAvailability(client, hydrated.quote);
    await createGlinkOrder(client, hydrated.quote, availability, {
      guests: [{ roomIndex: 1, firstName: "ALICE", lastName: "GUEST" }],
      contactName: "ALICE GUEST",
      phone: "13800138000",
      email: "child@example.com",
      arriveTime: "18:00",
      latestArriveTime: "23:00",
    }, "OP-CHILD");

    for (const path of ["/booking/productDetails", "/booking/availabilityCheck", "/booking/createOrder"]) {
      expect(calls.find(call => call.path === path)?.body).toMatchObject({
        numberOfAdults: 2,
        numberOfChildren: 1,
        childrenAges: "8",
      });
    }
  });
});

describe("G-Link status contracts", () => {
  it("keeps order detail and webhook enums separate", () => {
    expect(mapGlinkOrderDetailStatus(2)).toBe("PROCESSING");
    expect(mapGlinkOrderDetailStatus(3)).toBe("CONFIRMED");
    expect(mapGlinkOrderDetailStatus(4)).toBe("CANCELLED");
    expect(mapGlinkOrderDetailStatus(5)).toBe("CONFIRMED");

    expect(mapGlinkOrderStatusWebhook(3)).toBe("CONFIRMED");
    expect(mapGlinkOrderStatusWebhook(4)).toBe("FAILED");
    expect(mapGlinkOrderStatusWebhook(6)).toBe("CANCELLED");
    expect(mapGlinkOrderStatusWebhook(7)).toBeUndefined();
  });

  it("handles cancelOrder result values explicitly", () => {
    expect(mapGlinkCancelResult(1)).toBe("CANCELLED");
    expect(mapGlinkCancelResult(2)).toBe("REFUSED");
    expect(mapGlinkCancelResult(3)).toBe("CANCELLING");
  });
});

import { describe, expect, it } from "vitest";
import {
  checkGlinkAvailability,
  createGlinkOrder,
  hydrateGlinkProduct,
  hydrateGlinkProducts,
  searchGlinkHotels,
  synchronizeHotelQuoteFromAvailability,
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
          { hotelId: 10583772, hotelName: "Mapped", cityName: "上海", cityCode: "SHA" },
          { hotelId: 999, hotelName: "Not mapped", cityName: "上海", cityCode: "SHA" },
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
    expect(result.offers[0].rating).toBeUndefined();
    expect(result.offers[0].stars).toBeUndefined();
    expect(result.offers[0].image).toBeUndefined();
    expect(calls.map(call => call.path)).toEqual([
      "/search/destination",
      "/search/hotelIdList",
      "/search/hotelList",
      "/hotel/lowestPrice",
      "/hotel/detail",
      "/hotel/images",
    ]);
  });

  it("does not invent ratings, stars, review counts, images or location facts", async () => {
    const { client } = stubClient({
      "/search/destination": [{ destinationId: "SZX", destinationType: 2, cityCode: "SZX" }],
      "/search/hotelIdList": { hotelIds: [10583772], totalCount: 1 },
      "/search/hotelList": { list: [{ hotelId: 10583772, hotelName: "Supplier Hotel", cityName: "深圳", cityCode: "SZX", districtName: "null" }] },
      "/hotel/lowestPrice": { currency: "CNY", hotelLowestPrices: [{ hotelId: 10583772, priceItems: [{ saleDate: "2026-09-01", salePrice: 88 }] }] },
      "/hotel/detail": { hotelInfos: [{ hotelId: 10583772, hotelName: "Supplier Hotel" }] },
      "/hotel/images": { hotelImages: [] },
    });

    const result = await searchGlinkHotels(client, {
      destination: "深圳", checkIn: "2026-09-01", checkOut: "2026-09-02", rooms: 1, adults: 1,
    });

    expect(result.offers[0]).toMatchObject({ name: "Supplier Hotel", city: "深圳", district: "" });
    expect(result.offers[0]).not.toHaveProperty("rating");
    expect(result.offers[0]).not.toHaveProperty("ratingSource");
    expect(result.offers[0]).not.toHaveProperty("stars");
    expect(result.offers[0]).not.toHaveProperty("image");
    expect(result.offers[0]).not.toHaveProperty("reviewCount");
  });

  it("passes through only supplier-provided score metadata", async () => {
    const { client } = stubClient({
      "/search/destination": [{ destinationId: "SZX", destinationType: 2, cityCode: "SZX" }],
      "/search/hotelIdList": { hotelIds: [10583772], totalCount: 1 },
      "/search/hotelList": { list: [{ hotelId: 10583772, hotelName: "Supplier Hotel", cityName: "深圳", cityCode: "SZX", hotelStar: 4 }] },
      "/hotel/lowestPrice": { currency: "CNY", hotelLowestPrices: [{ hotelId: 10583772, priceItems: [{ saleDate: "2026-09-01", salePrice: 88 }] }] },
      "/hotel/detail": { hotelInfos: [{ hotelId: 10583772, hotelName: "Supplier Hotel", comment: [{ averageScore: "4.3", source: "G-Link" }] }] },
      "/hotel/images": { hotelImages: [] },
    });

    const result = await searchGlinkHotels(client, {
      destination: "深圳", checkIn: "2026-09-01", checkOut: "2026-09-02", rooms: 1, adults: 1,
    });

    expect(result.offers[0]).toMatchObject({ rating: 4.3, ratingSource: "G-Link", stars: 4 });
  });

  it("rejects hotel-list rows whose cityCode does not match the resolved destination", async () => {
    const { client } = stubClient({
      "/search/destination": [{ destinationId: "C3SZX", destinationType: 2, cityCode: "SZX", cityName: "深圳" }],
      "/search/hotelIdList": { hotelIds: [10583772, 112291], totalCount: 2 },
      "/search/hotelList": { list: [
        { hotelId: 10583772, hotelName: "深圳真实酒店", cityName: "深圳", cityCode: "SZX" },
        { hotelId: 112291, hotelName: "错误混入的上海酒店", cityName: "上海", cityCode: "SHA" },
      ] },
      "/hotel/lowestPrice": { currency: "CNY", hotelLowestPrices: [{ hotelId: 10583772, priceItems: [{ saleDate: "2026-09-01", salePrice: 88 }] }] },
      "/hotel/detail": { hotelInfos: [{ hotelId: 10583772, hotelName: "深圳真实酒店" }] },
      "/hotel/images": { hotelImages: [] },
    });

    const result = await searchGlinkHotels(client, {
      destination: "深圳", checkIn: "2026-09-01", checkOut: "2026-09-02", rooms: 1, adults: 1,
    });

    expect(result.offers).toHaveLength(1);
    expect(result.offers[0]).toMatchObject({ name: "深圳真实酒店", city: "深圳", cityCode: "SZX" });
    expect(result.offers.some(offer => offer.name.includes("上海"))).toBe(false);
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

  it("returns every distinct bookable room and rate-plan product", async () => {
    const { client } = stubClient({
      "/booking/productDetails": {
        roomItems: [
          {
            roomId: 1001,
            roomName: "豪华大床房",
            products: [
              { bookType: 1, ratePlanId: "flex", ratePlanName: "含早可取消", supplyCode: "SUP-1", totalSalePrice: 200, breakfastName: "双早", priceItems: [{ saleDate: "2026-09-01", salePrice: 200, currency: "CNY" }] },
              { bookType: 1, ratePlanId: "nonref", ratePlanName: "不含早不可退", supplyCode: "SUP-1", totalSalePrice: 170, cancelRestrictionType: 1, priceItems: [{ saleDate: "2026-09-01", salePrice: 170, currency: "CNY" }] },
              { bookType: 0, ratePlanId: "sold-out", supplyCode: "SUP-1", totalSalePrice: 150, priceItems: [{ saleDate: "2026-09-01", salePrice: 150, currency: "CNY" }] },
            ],
          },
          {
            roomId: 1002,
            roomName: "行政双床房",
            products: [
              { bookType: 1, ratePlanId: "executive", ratePlanName: "行政礼遇", supplyCode: "SUP-2", totalSalePrice: 260, priceItems: [{ saleDate: "2026-09-01", salePrice: 260, currency: "CNY" }] },
            ],
          },
        ],
      },
    });

    const products = await hydrateGlinkProducts(client, baseQuote);
    expect(products).toHaveLength(3);
    expect(products.map(item => item.quote.ratePlanId)).toEqual(["nonref", "flex", "executive"]);
    expect(products.map(item => item.offer.roomName)).toEqual(["豪华大床房", "豪华大床房", "行政双床房"]);
    expect(products.every(item => item.offer.id === item.quote.id)).toBe(true);
  });

  it("maps EPS room, cancellation, check-in and price facts without invented values", async () => {
    const { client } = stubClient({
      "/booking/productDetails": {
        roomItems: [{
          roomId: 52047428,
          roomName: "真实豪华房",
          products: [{
            bookType: 1,
            ratePlanId: "eps-rate",
            ratePlanName: "Non-refundable",
            supplyCode: "EPS-SUPPLIER",
            payAtHotelFlag: 0,
            cancelRestrictionType: 1,
            bedTypeDetails: [{
              bedInfos: [{ bedTypeName: "King Bed", bedNum: 1, bedTypeCode: "KING" }],
            }],
            tips: [{ tipsType: 3, tipsDetails: [{ title: "入住提示", details: "请携带护照原件" }] }],
            roomPrice: 180,
            totalSalePrice: 200,
            priceItems: [{
              saleDate: "2026-09-01", salePrice: 200, currency: "CNY",
              taxDetail: { roomPrice: 180, taxFee: 20, salesTax: 8, otherTax: 2 },
            }],
          }],
        }],
      },
    });

    const hydrated = await hydrateGlinkProduct(client, {
      ...baseQuote,
      checkInInstructions: "办理入住：15:00–23:00",
    });

    expect(hydrated.offer).toMatchObject({
      bedTypeDescription: "King Bed",
      nonRefundable: true,
      cancelRestrictionType: 1,
      cancelPolicy: "不可取消、不可更改",
      checkInInstructions: "办理入住：15:00–23:00",
      specialCheckInInstructions: ["请携带护照原件", "入住提示"],
      payAtHotel: false,
      priceBreakdown: {
        roomSubtotal: 180,
        taxFee: 20,
        salesTax: 8,
        otherTax: 2,
        total: 200,
        currency: "CNY",
      },
    });
    expect(hydrated.offer.priceBreakdown).not.toHaveProperty("chargesDueAtProperty");

    const synchronized = synchronizeHotelQuoteFromAvailability(hydrated.quote, {
      canBook: 1,
      totalSalePrice: 200,
      payAtHotelFee: 30,
      payAtHotelFeeCurrency: "THB",
      priceItems: [{ saleDate: "2026-09-01", salePrice: 200, taxDetail: { roomPrice: 180, taxFee: 20 } }],
    });
    expect(synchronized.priceBreakdown).toMatchObject({
      chargesDueAtProperty: 30,
      chargesDueAtPropertyCurrency: "THB",
      roomSubtotal: 180,
      taxFee: 20,
    });
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

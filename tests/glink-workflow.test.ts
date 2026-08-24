import { describe, expect, it } from "vitest";
import {
  checkGlinkAvailability,
  createGlinkOrder,
  formatGlinkDestinationDetail,
  hydrateGlinkProduct,
  hydrateGlinkProducts,
  normalizeGlinkHotelStars,
  normalizeGlinkPopularFacilities,
  normalizeGlinkDestinations,
  resolveGlinkHotelStar,
  queryGlinkHotelBasicInfo,
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

function stubClient(responses: Record<string, unknown | ((callNumber: number) => unknown)>) {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const callCounts = new Map<string, number>();
  const client = {
    async glink(path: string, body: Record<string, unknown>) {
      calls.push({ path, body });
      const callNumber = (callCounts.get(path) || 0) + 1;
      callCounts.set(path, callNumber);
      const response = responses[path];
      return structuredClone(typeof response === "function" ? response(callNumber) : response);
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
  it.each([1, 3, 4, 5, 6, 7, 8])("formats destination type %i with city, province/state and country", destinationType => {
    expect(formatGlinkDestinationDetail({
      destinationType,
      cityName: "深圳",
      provinceName: "广东",
      countryName: "中国",
    })).toBe("深圳，广东，中国");
  });

  it("omits unavailable destination hierarchy levels without empty separators", () => {
    expect(formatGlinkDestinationDetail({
      destinationType: 8,
      cityName: "Singapore",
      countryName: "Singapore",
    })).toBe("Singapore，Singapore");
  });

  it("formats city destinations with city, province/state and country", () => {
    expect(formatGlinkDestinationDetail({
      destinationType: 2,
      cityName: "Toronto",
      provinceName: "Ontario",
      countryName: "Canada",
    }, "en-US")).toBe("Toronto, Ontario, Canada");
  });

  it("normalizes nested multilingual destination names from the supplier response", () => {
    const rawDestination = {
      destinationId: null,
      dataType: 8,
      destinationName: [{
        cityName: "广州市",
        countryCode: null,
        provinceCode: null,
        cityCode: null,
        name: "广州火车站东站",
        language: "zh-CN",
        hotelId: null,
        countryName: "中国",
        provinceName: null,
        latGoogle: 23.147123,
        lngGoogle: 113.32551,
      }],
    };
    const destinations = normalizeGlinkDestinations(rawDestination, "zh-CN");

    expect(destinations).toEqual([{
      name: "广州火车站东站",
      detail: "广州市，中国",
      cityCode: "",
      destinationType: 8,
      latGoogle: 23.147123,
      lngGoogle: 113.32551,
    }]);
    expect(normalizeGlinkDestinations({ data: [rawDestination] }, "zh-CN")).toEqual(destinations);
    expect(normalizeGlinkDestinations({ list: [rawDestination] }, "zh-CN")).toEqual(destinations);
  });

  it.each([
    [19, 5], [29, 5], [39, 4], [49, 4], [59, 3], [64, 3], [69, 2], [66, 2], [79, 2],
  ])("maps Open Platform hotel-star enum %i into FusionGo %i-star filtering", (upstream, expected) => {
    expect(normalizeGlinkHotelStars(upstream)).toBe(expected);
  });

  it.each([
    [19, 5, "五星级"], [29, 5, "五星级"], [39, 4, "四星级"], [49, 4, "四星级"],
    [59, 3, "三星级"], [64, 3, "三星级"], [69, 2, "二星级"], [66, 2, "二星级"], [79, 2, "二星级"],
  ])("stores Open Platform hotel-star mapping %i as %i / %s", (starCode, stars, starDescription) => {
    expect(resolveGlinkHotelStar(starCode)).toEqual({ starCode, stars, starDescription });
  });

  it("maps enabled G-Link popular facilities in FusionGo display order", () => {
    expect(normalizeGlinkPopularFacilities({
      spaAndWellnessCenter: "1",
      shuttleService: "1",
      freeBreakfast: "0",
      has24HourFrontDesk: "1",
      restaurant: "1",
      swimmingPool: "0",
    })).toEqual(["shuttleService", "restaurant", "has24HourFrontDesk", "spaAndWellnessCenter"]);
  });

  it("maps hotel basic information and images for the detail page", async () => {
    const { client, calls } = stubClient({
      "/hotel/detail": { hotelInfos: [{ hotelId: 10583772, hotelName: "深圳真实酒店", cityName: "深圳", distinctName: "南山区", address: "测试路 1 号", telephone: "+86-755-88888888", openingDate: "2018-06-01", fitmentDate: "2023-01-15", roomNum: 445, hotelStar: "5星", hotelIntroduce: "<p>酒店简介</p>", checkInTime: "14:00", checkOutTime: "12:00", comment: [{ averageScore: "4.6", source: "G-Link" }], popularFacility: { freeWiFi: "1", parkingLot: "1", bar: "0" }, facility: [{ categoryType: "1", status: 1, name: "健身中心" }], roomInfos: [{ roomId: 52047428, isAllowSmoking: 2, roomAcreage: "45", roomFloor: "1", windowDetail: 2, wirelessBroadband: 2 }], importantNotices: [{ informText: "入住须知" }] }] },
      "/hotel/images": { hotelImages: [{ hotelId: 10583772, images: [{ isMain: 1, url: "http://example.com/main.jpg" }] }] },
    });

    const detail = await queryGlinkHotelBasicInfo(client, 10583772, "en-US");
    expect(detail).toMatchObject({ name: "深圳真实酒店", address: "测试路 1 号", phone: "+86-755-88888888", openingDate: "2018-06-01", renovatedDate: "2023-01-15", numberOfRooms: 445, stars: 5, rating: 4.6, popularFacilities: ["freeWiFi", "parkingLot"], rooms: [{ roomId: 52047428, smokingPolicy: 2, roomArea: "45", roomFloor: "1", windowType: 2, wirelessBroadband: 2 }], facilities: ["健身中心"], images: ["https://example.com/main.jpg"] });
    expect(detail.introduction).toBe("酒店简介");
    expect(calls.find(call => call.path === "/hotel/detail")?.body.language).toBe("en-US");
    expect(calls.map(call => call.path)).toEqual(["/hotel/detail", "/hotel/images"]);
  });

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
      "/search/destination": [{ destinationType: 2, cityCode: "SHA", latGoogle: 31.2304, lngGoogle: 121.4737 }],
      "/search/hotelIdList": { hotelIds: [10583772], totalCount: 1 },
      "/search/hotelList": {
        list: [
          { hotelId: 10583772, hotelName: "Mapped", cityName: "上海", cityCode: "SHA", latGoogle: 31.231, lngGoogle: 121.474 },
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
      "/hotel/detail": { hotelInfos: [{ hotelId: 10583772, hotelName: "Mapped Hotel", hotelStar: 29 }] },
      "/hotel/images": { hotelImages: [] },
    });

    const result = await searchGlinkHotels(client, {
      destination: "上海",
      language: "en-US",
      checkIn: "2026-09-01",
      checkOut: "2026-09-02",
      rooms: 1,
      adults: 1,
    });

    expect(result.offers).toHaveLength(1);
    expect(result.offers[0].nightlyPrice).toBe(88);
    expect(result.offers[0].inventorySource).toBe("glink");
    expect(result.offers[0].rating).toBeUndefined();
    expect(result.offers[0].distanceKm).toBeUndefined();
    expect(result.offers[0].stars).toBe(5);
    expect(result.offers[0].image).toBeUndefined();
    expect(result.offers[0]).toMatchObject({
      roomName: "View real-time room types",
      breakfast: "Subject to real-time product details",
      cancelPolicy: "Subject to real-time cancellation policy",
    });
    expect(calls.find(call => call.path === "/search/hotelList")?.body.language).toBe("en-US");
    expect(calls.find(call => call.path === "/hotel/detail")?.body.language).toBe("en-US");
    expect(calls.map(call => call.path)).toEqual([
      "/search/destination",
      "/search/hotelIdList",
      "/search/hotelList",
      "/hotel/lowestPrice",
      "/hotel/detail",
      "/hotel/images",
    ]);
  });

  it("requests and exposes later hotel-list pages", async () => {
    const { client, calls } = stubClient({
      "/search/hotelIdList": { hotelIds: [10583772], totalCount: 1 },
      "/search/hotelList": {
        currentPage: 2,
        pageSize: 10,
        totalCount: 25,
        totalPage: 3,
        list: [{ hotelId: 10583772, hotelName: "Page Two Hotel", cityName: "上海", cityCode: "SHA" }],
      },
      "/hotel/lowestPrice": {
        currency: "CNY",
        hotelLowestPrices: [{ hotelId: 10583772, priceItems: [{ saleDate: "2026-09-01", salePrice: 188 }] }],
      },
      "/hotel/detail": { hotelInfos: [{ hotelId: 10583772, hotelName: "Page Two Hotel" }] },
      "/hotel/images": { hotelImages: [] },
    });

    const result = await searchGlinkHotels(client, {
      destination: "Shanghai",
      cityCode: "SHA",
      destinationType: 8,
      latGoogle: 31.2304,
      lngGoogle: 121.4737,
      checkIn: "2026-09-01",
      checkOut: "2026-09-02",
      hotelFacilityCodes: ["HOTEL-FACILITY-1"],
      roomFacilityCodes: ["ROOM-FACILITY-1"],
      page: 2,
      pageSize: 10,
    });

    expect(calls.find(call => call.path === "/search/hotelList")?.body).toMatchObject({
      currentPage: 2,
      pageSize: 10,
      hotelFacilityCodes: ["HOTEL-FACILITY-1"],
      roomFacilityCodes: ["ROOM-FACILITY-1"],
    });
    expect(result.offers).toHaveLength(1);
    expect(result.pagination).toEqual({ currentPage: 2, pageSize: 10, totalCount: 25, totalPages: 3, hasMore: true });
  });

  it("stops pagination when a later page has no saleable hotels", async () => {
    const { client } = stubClient({
      "/search/hotelIdList": { hotelIds: [10583772], totalCount: 1 },
      "/search/hotelList": {
        currentPage: 4,
        pageSize: 10,
        totalCount: 100,
        totalPage: 10,
        list: [{ hotelId: 999999, hotelName: "Unmapped Hotel", cityName: "上海", cityCode: "SHA" }],
      },
    });

    const result = await searchGlinkHotels(client, {
      destination: "Shanghai",
      cityCode: "SHA",
      destinationType: 8,
      latGoogle: 31.2304,
      lngGoogle: 121.4737,
      checkIn: "2026-09-01",
      checkOut: "2026-09-02",
      page: 4,
      pageSize: 10,
    });

    expect(result.offers).toEqual([]);
    expect(result.pagination).toMatchObject({ currentPage: 4, totalPages: 10, hasMore: false });
  });

  it("uses selected coordinates without resolving an ambiguous city name again", async () => {
    const { client, calls } = stubClient({
      "/search/hotelIdList": { hotelIds: [], totalCount: 0 },
    });

    await searchGlinkHotels(client, {
      destination: "London",
      cityCode: "6057873",
      destinationType: 8,
      latGoogle: 42.98695,
      lngGoogle: -81.243179,
      checkIn: "2026-09-01",
      checkOut: "2026-09-02",
      rooms: 1,
      adults: 1,
    });

    expect(calls.map(call => call.path)).toEqual(["/search/hotelIdList"]);
    expect(calls[0]?.body).toMatchObject({ cityCode: "6057873" });
  });

  it("keeps a specifically searched hotel visible when lowestPrice has no price", async () => {
    const { client, calls } = stubClient({
      "/search/hotelIdList": { hotelIds: [467794], totalCount: 1 },
      "/search/hotelList": {
        list: [{ hotelId: 467794, hotelName: "深圳北站鑫酒店式公寓", cityName: "深圳", cityCode: "SZX", latGoogle: 22.6098, lngGoogle: 114.031 }],
      },
      "/hotel/lowestPrice": { currency: "CNY", hotelLowestPrices: [] },
      "/hotel/detail": { hotelInfos: [{ hotelId: 467794, hotelName: "深圳北站鑫酒店式公寓", cityName: "深圳" }] },
      "/hotel/images": { hotelImages: [] },
    });

    const result = await searchGlinkHotels(client, {
      destination: "深圳北站鑫酒店式公寓",
      cityCode: "SZX",
      destinationId: "H467794",
      destinationType: 1,
      hotelId: 467794,
      latGoogle: 22.6098,
      lngGoogle: 114.031,
      checkIn: "2026-09-01",
      checkOut: "2026-09-02",
      rooms: 1,
      adults: 2,
    });

    expect(result.diagnostics.lowestPriceHotelCount).toBe(0);
    expect(result.offers).toHaveLength(1);
    expect(result.offers[0]).toMatchObject({
      name: "深圳北站鑫酒店式公寓",
      nightlyPrice: 0,
      totalPrice: 0,
      searchMatch: "exact",
    });
    expect(calls.find(call => call.path === "/search/hotelList")?.body).toMatchObject({ destinationId: "H467794" });
    expect(calls.find(call => call.path === "/search/hotelList")?.body).not.toHaveProperty("latGoogle");
  });

  it("falls back to nearby hotels when an exact hotel destination is unavailable", async () => {
    const { client, calls } = stubClient({
      "/search/hotelIdList": { hotelIds: [112291], totalCount: 1 },
      "/search/hotelList": (callNumber: number) => callNumber === 1
        ? { list: [{ hotelId: 999999, hotelName: "Unavailable Hotel", cityName: "深圳", cityCode: "SZX" }] }
        : { list: [{ hotelId: 112291, hotelName: "Nearby Hotel", cityName: "深圳", cityCode: "SZX" }] },
      "/hotel/lowestPrice": { currency: "CNY", hotelLowestPrices: [] },
      "/hotel/detail": { hotelInfos: [{ hotelId: 112291, hotelName: "Nearby Hotel", cityName: "深圳" }] },
      "/hotel/images": { hotelImages: [] },
    });

    const result = await searchGlinkHotels(client, {
      destination: "Unavailable Hotel",
      cityCode: "SZX",
      destinationId: "H999999",
      destinationType: 1,
      hotelId: 999999,
      latGoogle: 22.6098,
      lngGoogle: 114.031,
      checkIn: "2026-09-01",
      checkOut: "2026-09-02",
      rooms: 1,
      adults: 2,
    });

    const hotelListCalls = calls.filter(call => call.path === "/search/hotelList");
    expect(hotelListCalls).toHaveLength(2);
    expect(hotelListCalls[0]?.body).toMatchObject({ destinationId: "H999999" });
    expect(hotelListCalls[1]?.body).toMatchObject({ latGoogle: 22.6098, lngGoogle: 114.031, distance: 10 });
    expect(result.offers).toHaveLength(1);
    expect(result.offers[0]).toMatchObject({ name: "Nearby Hotel", searchMatch: "nearby" });
  });

  it("keeps landmark hotel results visible when lowestPrice has no price", async () => {
    const { client, calls } = stubClient({
      "/search/hotelIdList": { hotelIds: [467794], totalCount: 1 },
      "/search/hotelList": {
        list: [{ hotelId: 467794, hotelName: "深圳北站鑫酒店式公寓", cityName: "深圳", cityCode: "SZX", latGoogle: 22.6098, lngGoogle: 114.031 }],
      },
      "/hotel/lowestPrice": { currency: "CNY", hotelLowestPrices: [] },
      "/hotel/detail": { hotelInfos: [{ hotelId: 467794, hotelName: "深圳北站鑫酒店式公寓", cityName: "深圳" }] },
      "/hotel/images": { hotelImages: [] },
    });

    const result = await searchGlinkHotels(client, {
      destination: "深圳北站",
      cityCode: "SZX",
      destinationType: 8,
      latGoogle: 22.610332,
      lngGoogle: 114.030227,
      checkIn: "2026-09-01",
      checkOut: "2026-09-02",
      rooms: 1,
      adults: 2,
    });

    expect(result.diagnostics.lowestPriceHotelCount).toBe(0);
    expect(result.offers).toHaveLength(1);
    expect(result.offers[0]).toMatchObject({
      name: "深圳北站鑫酒店式公寓",
      distanceKm: 0.1,
      nightlyPrice: 0,
      totalPrice: 0,
    });
    const hotelListCall = calls.find(call => call.path === "/search/hotelList");
    expect(hotelListCall?.body).toMatchObject({
      latGoogle: 22.610332,
      lngGoogle: 114.030227,
      distance: 10,
    });
    expect(hotelListCall?.body).not.toHaveProperty("destinationId");
  });

  it("does not invent ratings, stars, review counts, images or location facts", async () => {
    const { client } = stubClient({
      "/search/destination": [{ destinationType: 2, cityCode: "SZX", latGoogle: 22.5431, lngGoogle: 114.0579 }],
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
      "/search/destination": [{ destinationType: 2, cityCode: "SZX", latGoogle: 22.5431, lngGoogle: 114.0579 }],
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
      "/search/destination": [{ destinationType: 2, cityCode: "SZX", cityName: "深圳", latGoogle: 22.5431, lngGoogle: 114.0579 }],
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
    const productCall = calls.find(call => call.path === "/booking/productDetails")!;
    const createCall = calls.find(call => call.path === "/booking/createOrder")!;
    expect(productCall.body.language).toBe("en-US");
    expect(availabilityCall.body.language).toBe("en-US");
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
      language: "zh-CN",
    });
    expect(payAtHotel.quote.ratePlanId).toBe("pay-at-hotel");
    expect(payAtHotel.quote.payAtHotelFlag).toBe(1);
    expect(payAtHotelStub.calls[0]?.body.language).toBe("zh-CN");
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
    expect(products.map(item => item.offer.roomId)).toEqual([1001, 1001, 1002]);
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
            windowType: 2,
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
      windowType: 2,
      nonRefundable: true,
      cancelRestrictionType: 1,
      cancelPolicy: "不可取消、不可更改",
      cancellationPolicyDetails: {
        cancelRestrictionType: 1,
        cancelPenalties: [],
      },
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

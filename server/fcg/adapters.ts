import { randomUUID } from "node:crypto";
import type { FlightOffer, HotelOffer } from "../../src/types.js";
import { FcgError, type FcgClient } from "./client.js";

type JsonRecord = Record<string, unknown>;

const record = (value: unknown): JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const string = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : value === undefined || value === null ? fallback : String(value);
const number = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : Number(value) || fallback;

export class GlinkNoProductError extends Error {
  constructor(readonly reason: "EMPTY_RESPONSE" | "NO_BOOKABLE_PRODUCT") {
    super(reason === "EMPTY_RESPONSE"
      ? "G-Link 沙箱未返回实时房态，请确认当前账号已配置可售酒店和测试库存"
      : "当前酒店没有可预订的实时房型");
    this.name = "GlinkNoProductError";
  }
}

export interface HotelQuoteContext {
  id: string;
  hotelId: number;
  hotelName: string;
  checkInDate: string;
  checkOutDate: string;
  roomNum: number;
  numberOfAdults: number;
  numberOfChildren?: number;
  childrenAges?: number[];
  roomId?: number;
  roomName?: string;
  ratePlanId?: string;
  ratePlanName?: string;
  supplyCode?: string;
  currency: string;
  nightlyPrice: number;
  productPriceItems?: Array<{ saleDate: string; salePrice: number }>;
  payAtHotelFlag?: number;
  bedType?: string;
  city?: string;
  district?: string;
  rating?: number;
  stars?: number;
  image?: string;
  tags?: string[];
  lowestPriceVerifiedAt?: string;
}

export interface FlightQuoteContext {
  id: string;
  priceKey: string;
  from: string;
  to: string;
  departureDate: string;
  adultNum: number;
  childNum?: number;
  infantNum?: number;
  totalAmount: number;
  currency: string;
  title: string;
  subtitle: string;
  tripType?: 1 | 2 | 3;
  journeys?: Array<{
    origin: string;
    destination: string;
    date: string;
  }>;
  verifiedAt?: number;
}

export interface HotelBookingInput {
  guests: Array<{
    roomIndex: number;
    firstName: string;
    lastName: string;
  }>;
  contactName: string;
  phone: string;
  email: string;
  arriveTime: string;
  latestArriveTime: string;
}

const hotelNightCount = (checkInDate: string, checkOutDate: string) => Math.max(
  1,
  Math.round((Date.parse(`${checkOutDate}T00:00:00Z`) - Date.parse(`${checkInDate}T00:00:00Z`)) / 86_400_000),
);

export interface FlightBookingInput {
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  passengers: Array<{
    surname: string;
    name: string;
    nationality: string;
    gender: "1" | "2";
    idType: string;
    idNumber: string;
    birthday: string;
    expiration: string;
    type?: "adult" | "child" | "infant";
    adultPassengerName?: string;
  }>;
}

export async function queryGlinkSaleableHotelIds(
  client: FcgClient,
  input: { cityCode?: string; pageNo?: number; pageSize?: number } = {},
) {
  const data = record(await client.glink<unknown>("/search/hotelIdList", {
    ...(input.cityCode ? { cityCode: input.cityCode } : {}),
    pageNo: input.pageNo || 1,
    pageSize: input.pageSize || 1000,
  }));
  return {
    hotelIds: array(data.hotelIds).map(value => number(value)).filter(Boolean),
    currentPage: number(data.currentPage, input.pageNo || 1),
    pageSize: number(data.pageSize, input.pageSize || 1000),
    totalCount: number(data.totalCount),
    totalPage: number(data.totalPage),
  };
}

export async function queryGlinkLowestPrices(
  client: FcgClient,
  input: { hotelIds: number[]; checkInDate: string; checkOutDate: string },
) {
  if (!input.hotelIds.length) return { currency: "CNY", prices: new Map<number, number>() };
  const data = record(await client.glink<unknown>("/hotel/lowestPrice", {
    hotelIds: input.hotelIds.slice(0, 10),
    checkInDate: input.checkInDate,
    checkOutDate: input.checkOutDate,
  }));
  const prices = new Map<number, number>();
  for (const rawHotel of array(data.hotelLowestPrices).map(record)) {
    const hotelId = number(rawHotel.hotelId);
    const priceItems = array(rawHotel.priceItems).map(record);
    const exact = priceItems.find(item => string(item.saleDate) === input.checkInDate);
    const positivePrices = priceItems.map(item => number(item.salePrice)).filter(price => price > 0);
    const startingPrice = exact ? number(exact.salePrice) : Math.min(...positivePrices);
    if (hotelId && Number.isFinite(startingPrice) && startingPrice > 0) prices.set(hotelId, startingPrice);
  }
  return { currency: string(data.currency, "CNY"), prices };
}

export async function queryGlinkDailyLowestPrices(
  client: FcgClient,
  hotelIds: number[],
) {
  if (!hotelIds.length) return { currency: "CNY", hotels: [] as Array<{
    hotelId: number;
    priceItems: Array<{ saleDate: string; salePrice: number }>;
  }> };
  const data = record(await client.glink<unknown>("/hotel/lowestPrice", {
    hotelIds: hotelIds.slice(0, 10),
  }));
  return {
    currency: string(data.currency, "CNY"),
    hotels: array(data.hotelLowestPrices).map(record).map(hotel => ({
      hotelId: number(hotel.hotelId),
      priceItems: array(hotel.priceItems).map(record).map(item => ({
        saleDate: string(item.saleDate),
        salePrice: number(item.salePrice),
      })).filter(item => item.saleDate && item.salePrice > 0),
    })).filter(hotel => hotel.hotelId && hotel.priceItems.length),
  };
}

export async function searchGlinkHotels(
  client: FcgClient,
  input: {
    destination: string;
    checkIn: string;
    checkOut: string;
    rooms?: number;
    adults?: number;
    children?: number;
    childAges?: number[];
  },
) {
  const destinations = await client.glink<unknown>("/search/destination", {
    keyWord: input.destination,
    destinationType: "2",
    source: 0,
  });
  const destination = array(destinations).map(record).find(item => number(item.destinationType) === 2)
    ?? record(array(destinations)[0]);
  const destinationId = string(destination.destinationId);
  if (!destinationId) throw new Error(`未找到目的地“${input.destination}”`);
  const saleable = await queryGlinkSaleableHotelIds(client, {
    cityCode: string(destination.cityCode) || undefined,
  });
  if (!saleable.hotelIds.length) {
    return {
      offers: [] as HotelOffer[],
      quotes: [] as HotelQuoteContext[],
      diagnostics: { saleableHotelCount: 0, lowestPriceHotelCount: 0 },
    };
  }
  const saleableIds = new Set(saleable.hotelIds);

  const listData = record(await client.glink<unknown>("/search/hotelList", {
    destinationId,
    checkInDate: input.checkIn,
    checkOutDate: input.checkOut,
    distance: 10,
    currentPage: 1,
    pageSize: 6,
    sortBy: 1,
    language: "zh-CN",
  }));
  const hotelRows = array(listData.list).map(record)
    .filter(item => saleableIds.has(number(item.hotelId)))
    .slice(0, 10);
  const candidateIds = hotelRows.map(item => number(item.hotelId)).filter(Boolean);
  if (!candidateIds.length) {
    return {
      offers: [] as HotelOffer[],
      quotes: [] as HotelQuoteContext[],
      diagnostics: { saleableHotelCount: saleable.totalCount, lowestPriceHotelCount: 0 },
    };
  }
  const lowest = await queryGlinkLowestPrices(client, {
    hotelIds: candidateIds,
    checkInDate: input.checkIn,
    checkOutDate: input.checkOut,
  });
  const pricedRows = hotelRows.filter(item => lowest.prices.has(number(item.hotelId)));
  const hotelIds = pricedRows.map(item => string(item.hotelId));
  if (!hotelIds.length) {
    return {
      offers: [] as HotelOffer[],
      quotes: [] as HotelQuoteContext[],
      diagnostics: { saleableHotelCount: saleable.totalCount, lowestPriceHotelCount: 0 },
    };
  }

  const [detailResponse, imageResponse] = await Promise.all([
    client.glink<unknown>("/hotel/detail", {
      hotelIds,
      language: "zh-CN",
      settings: ["comment", "hotelFacilityNew", "importantNotices"],
    }),
    client.glink<unknown>("/hotel/images", { hotelIds }),
  ]);
  const detailData = record(detailResponse);
  const imageData = record(imageResponse);
  const details = new Map(array(detailData.hotelInfos).map(item => {
    const detail = record(item);
    return [string(detail.hotelId), detail] as const;
  }));
  const images = new Map(array(imageData.hotelImages).map(item => {
    const hotelImage = record(item);
    const candidates = array(hotelImage.images).map(record);
    const main = candidates.find(image => number(image.isMain) === 1) ?? candidates[0] ?? {};
    return [string(hotelImage.hotelId), string(main.url).replace(/^http:\/\//, "https://")] as const;
  }));

  const quotes: HotelQuoteContext[] = [];
  const offers = pricedRows.map((row, index): HotelOffer => {
    const hotelId = number(row.hotelId);
    const detail = details.get(string(row.hotelId)) ?? {};
    const comment = record(detail.comment);
    const image = string(row.mainUrl, images.get(string(row.hotelId)) || string(detail.appearancePicUrl, "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=900&q=80")).replace(/^http:\/\//, "https://");
    const quote: HotelQuoteContext = {
      id: `GH-${hotelId}-${randomUUID()}`,
      hotelId,
      hotelName: string(detail.hotelName, string(row.hotelName, `G-Link 酒店 ${index + 1}`)),
      checkInDate: input.checkIn,
      checkOutDate: input.checkOut,
      roomNum: input.rooms || 1,
      numberOfAdults: input.adults || 2,
      numberOfChildren: input.children || 0,
      childrenAges: input.childAges || [],
      currency: lowest.currency || string(row.saleCurrencyCode, string(detail.currency, "CNY")),
      nightlyPrice: lowest.prices.get(hotelId) || 0,
      city: string(row.cityName, input.destination),
      district: string(row.districtName, string(row.hotelAddress, string(detail.address, input.destination))),
      rating: number(row.hotelScore, number(comment.averageScore, 4.6)),
      stars: Math.max(3, Math.min(5, number(row.hotelStar, 5))),
      image,
      tags: [string(row.brandName), string(row.groupName), "G-Link 实时库存"].filter(Boolean),
      lowestPriceVerifiedAt: new Date().toISOString(),
    };
    quotes.push(quote);
    return {
      id: quote.id,
      inventorySource: "glink",
      name: quote.hotelName,
      city: quote.city || input.destination,
      district: quote.district || input.destination,
      rating: quote.rating || 4.6,
      stars: quote.stars || 5,
      image: quote.image || image,
      tags: quote.tags || ["G-Link 实时库存"],
      roomName: "进入详情查看实时房型",
      breakfast: "以实时产品为准",
      cancelPolicy: "以实时取消政策为准",
      nightlyPrice: quote.nightlyPrice,
      currency: quote.currency,
      checkInDate: quote.checkInDate,
      checkOutDate: quote.checkOutDate,
      roomNum: quote.roomNum,
      numberOfAdults: quote.numberOfAdults,
      numberOfChildren: quote.numberOfChildren || 0,
      childrenAges: quote.childrenAges || [],
      nights: hotelNightCount(quote.checkInDate, quote.checkOutDate),
      totalPrice: quote.nightlyPrice * hotelNightCount(quote.checkInDate, quote.checkOutDate) * quote.roomNum,
    };
  });
  return {
    offers,
    quotes,
    diagnostics: {
      saleableHotelCount: saleable.totalCount,
      lowestPriceHotelCount: lowest.prices.size,
    },
  };
}

export async function hydrateGlinkProduct(
  client: FcgClient,
  quote: HotelQuoteContext,
  options: { paymentType?: "prepaid" | "payAtHotel" } = {},
) {
  const data = record(await client.glink<unknown>("/booking/productDetails", {
    hotelId: quote.hotelId,
    checkInDate: quote.checkInDate,
    checkOutDate: quote.checkOutDate,
    roomNum: quote.roomNum,
    numberOfAdults: quote.numberOfAdults,
    numberOfChildren: quote.numberOfChildren || 0,
    ...(quote.numberOfChildren ? { childrenAges: (quote.childrenAges || []).join(",") } : {}),
    nationality: "CN",
    language: "zh-CN",
  }));
  if (!Object.keys(data).length) throw new GlinkNoProductError("EMPTY_RESPONSE");
  let selectedRoom: JsonRecord | undefined;
  let selectedProduct: JsonRecord | undefined;
  for (const item of array(data.roomItems).map(record)) {
    const product = array(item.products).map(record).find(candidate => {
      if (number(candidate.bookType) !== 1) return false;
      if (options.paymentType === "prepaid") return number(candidate.payAtHotelFlag) !== 1;
      if (options.paymentType === "payAtHotel") return number(candidate.payAtHotelFlag) === 1;
      return true;
    });
    if (product) {
      selectedRoom = item;
      selectedProduct = product;
      break;
    }
  }
  if (!selectedRoom || !selectedProduct) throw new GlinkNoProductError("NO_BOOKABLE_PRODUCT");
  const rawPriceItems = array(selectedProduct.priceItems).map(record);
  const priceItems = rawPriceItems.map(item => ({
    saleDate: string(item.saleDate),
    salePrice: number(item.salePrice),
  })).filter(item => item.saleDate && item.salePrice >= 0);
  const total = number(selectedProduct.totalSalePrice, priceItems.reduce((sum, item) => sum + item.salePrice, 0));
  const next: HotelQuoteContext = {
    ...quote,
    id: `GQ-${quote.hotelId}-${randomUUID()}`,
    roomId: number(selectedRoom.roomId),
    roomName: string(selectedRoom.roomName, "实时可订房型"),
    ratePlanId: string(selectedProduct.ratePlanId),
    ratePlanName: string(selectedProduct.ratePlanName, "实时价格计划"),
    supplyCode: string(selectedProduct.supplyCode),
    currency: string(selectedProduct.currency, string(rawPriceItems[0]?.currency, quote.currency)),
    nightlyPrice: priceItems.length ? total / priceItems.length / Math.max(1, quote.roomNum) : total,
    productPriceItems: priceItems,
    payAtHotelFlag: number(selectedProduct.payAtHotelFlag),
    bedType: string(selectedProduct.bedType),
  };
  if (!next.roomId || !next.ratePlanId || !next.supplyCode) throw new Error("实时产品缺少下单标识，请重新选择房型");
  return {
    quote: next,
    offer: {
      id: next.id,
      inventorySource: "glink",
      name: next.hotelName,
      city: quote.city || "",
      district: quote.district || "G-Link 实时产品",
      rating: quote.rating || 4.8,
      stars: quote.stars || 5,
      image: quote.image || "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=900&q=80",
      tags: [...(quote.tags || []), "价格已刷新"].slice(0, 4),
      roomName: next.roomName || "实时可订房型",
      breakfast: string(selectedProduct.breakfastName, "早餐以验房结果为准"),
      cancelPolicy: string(selectedProduct.cancelPolicy, "取消政策以验房结果为准"),
      nightlyPrice: next.nightlyPrice,
      currency: next.currency,
      checkInDate: next.checkInDate,
      checkOutDate: next.checkOutDate,
      roomNum: next.roomNum,
      numberOfAdults: next.numberOfAdults,
      numberOfChildren: next.numberOfChildren || 0,
      childrenAges: next.childrenAges || [],
      nights: hotelNightCount(next.checkInDate, next.checkOutDate),
      totalPrice: total,
    } satisfies HotelOffer,
  };
}

export async function checkGlinkAvailability(client: FcgClient, quote: HotelQuoteContext) {
  if (!quote.roomId || !quote.ratePlanId || !quote.supplyCode) throw new Error("请先查询实时产品");
  const data = record(await client.glink<unknown>("/booking/availabilityCheck", {
    hotelId: quote.hotelId,
    roomId: quote.roomId,
    ratePlanId: quote.ratePlanId,
    checkInDate: quote.checkInDate,
    checkOutDate: quote.checkOutDate,
    roomNum: quote.roomNum,
    supplyCode: quote.supplyCode,
    numberOfAdults: quote.numberOfAdults,
    numberOfChildren: quote.numberOfChildren || 0,
    ...(quote.numberOfChildren ? { childrenAges: (quote.childrenAges || []).join(",") } : {}),
    nationality: "CN",
    language: "zh-CN",
  }));
  if (number(data.canBook) !== 1) throw new Error("实时验房失败：当前房型不可预订");
  return data;
}

export async function createGlinkOrder(
  client: FcgClient,
  quote: HotelQuoteContext,
  availability: JsonRecord,
  input: HotelBookingInput,
  coOrderCode: string,
) {
  const priceItems = array(availability.priceItems).map(record).map(item => ({
    saleDate: string(item.saleDate),
    salePrice: number(item.salePrice),
  })).filter(item => item.saleDate && item.salePrice >= 0);
  const guestInfos = input.guests.map(guest => ({
    firstName: guest.firstName,
    lastName: guest.lastName,
    guestName: `${guest.firstName} ${guest.lastName}`.trim(),
    guestType: 1,
    mobileNo: input.phone,
    countryCode: "86",
    roomIndex: String(guest.roomIndex),
  }));
  return record(await client.glink<unknown>("/booking/createOrder", {
    hotelId: quote.hotelId,
    roomId: quote.roomId,
    ratePlanId: quote.ratePlanId,
    supplyCode: quote.supplyCode,
    roomNum: quote.roomNum,
    checkInDate: quote.checkInDate,
    checkOutDate: quote.checkOutDate,
    totalAmount: number(availability.totalSalePrice),
    coOrderCode,
    breakfastNum: number(availability.breakfastNum, -1),
    ...(quote.payAtHotelFlag !== undefined ? { payAtHotelFlag: quote.payAtHotelFlag } : {}),
    ...(quote.bedType ? { bedType: quote.bedType } : {}),
    payStatus: 0,
    numberOfAdults: quote.numberOfAdults,
    numberOfChildren: quote.numberOfChildren || 0,
    ...(quote.numberOfChildren ? { childrenAges: (quote.childrenAges || []).join(",") } : {}),
    nationality: "CN",
    priceItems,
    guestInfos,
    linkMan: input.contactName,
    linkPhone: input.phone,
    linkEmail: input.email,
    linkInterCode: "86",
    arriveTime: input.arriveTime,
    latestArriveTime: input.latestArriveTime,
  }));
}

export async function searchFlinkFlights(
  client: FcgClient,
  input: {
    from: string;
    to: string;
    departureDate: string;
    adults: number;
    children?: number;
    infants?: number;
    tripType?: 1 | 2 | 3;
    journeys?: Array<{ origin: string; destination: string; date: string }>;
  },
) {
  const tripType = input.tripType || 1;
  const requestedJourneys = input.journeys?.length
    ? input.journeys
    : [{ origin: input.from, destination: input.to, date: input.departureDate }];
  const searchBody = {
    cabinClass: "economy",
    tripType,
    journeys: requestedJourneys.map(journey => ({
      date: journey.date,
      origin: journey.origin,
      destination: journey.destination,
      originType: 1,
      destinationType: 1,
    })),
    adultNum: input.adults,
    childNum: input.children || 0,
    infantNum: input.infants || 0,
    transferNumber: 0,
  };
  const initialData = record(await client.flink<unknown>("zh_CN", "/flight/search", searchBody));
  let flightItems = array(initialData.flight).map(record);
  const segments: JsonRecord = { ...record(initialData.segments) };

  // F-Link round trips are a two-stage search. The first response contains
  // outbound journeyId values without a usable priceKey. A second request,
  // scoped to an outbound journeyId, returns return-leg combinations and the
  // priceKey that must be preserved for verify/order creation.
  if (tripType === 2
    && flightItems.length
    && !flightItems.some(item => array(item.offerPriceList)
      .map(record)
      .some(offer => Boolean(string(offer.priceKey))))) {
    const outboundCandidates = flightItems
      .map(item => ({
        item,
        journeyId: string(record(array(item.journeys).map(record)[0]).journeyId),
      }))
      .filter(candidate => candidate.journeyId)
      .slice(0, 4);
    const followups = await Promise.allSettled(outboundCandidates.map(candidate =>
      client.flink<unknown>("zh_CN", "/flight/search", {
        ...searchBody,
        journeyId: [candidate.journeyId],
      }).then(response => ({ candidate, data: record(response) }))));
    const combined: JsonRecord[] = [];
    for (const followup of followups) {
      if (followup.status !== "fulfilled") continue;
      Object.assign(segments, record(followup.value.data.segments));
      const outboundJourneys = array(followup.value.candidate.item.journeys);
      for (const returnItem of array(followup.value.data.flight).map(record)) {
        combined.push({
          ...returnItem,
          journeys: [...outboundJourneys, ...array(returnItem.journeys)],
        });
      }
    }
    flightItems = combined;
  }
  const offers: FlightOffer[] = [];
  const quotes: FlightQuoteContext[] = [];
  for (const flightItem of flightItems) {
    const rawJourneys = array(flightItem.journeys).map(record);
    const journeySummaries = rawJourneys.map((journey, journeyIndex) => {
      const segmentIds = array(journey.airSegmentList).map(value => string(value)).filter(Boolean);
      const first = record(segments[segmentIds[0]]);
      const last = record(segments[segmentIds.at(-1) ?? ""]);
      const fallback = requestedJourneys[journeyIndex] ?? requestedJourneys[0];
      return {
        origin: string(first.departureAirport, string(journey.origin, fallback.origin)),
        destination: string(last.arrivalAirport, string(journey.destination, fallback.destination)),
        date: string(first.departureDate, string(journey.originDate, fallback.date)),
        flightNo: array(journey.flightNumberList).map(value => string(value)).join("/")
          || segmentIds.map(segmentId => string(record(segments[segmentId]).flightNumber)).filter(Boolean).join("/"),
        departureTime: string(first.departureTime, string(journey.originTime)),
        arrivalTime: string(last.arrivalTime, string(journey.destinationTime)),
        duration: string(journey.journeysTime, string(first.flightDuration)),
        stops: number(journey.transferCount),
        first,
        last,
      };
    }).filter(journey => journey.origin && journey.destination);
    const firstJourney = journeySummaries[0];
    const lastJourney = journeySummaries.at(-1);
    if (!firstJourney || !lastJourney) continue;
    for (const rawOffer of array(flightItem.offerPriceList).map(record).slice(0, 2)) {
      const priceDetail = array(rawOffer.priceDetail).map(record);
      const adultPrice = priceDetail.find(item => string(item.passengerType) === "adult") ?? priceDetail[0] ?? {};
      const price = number(adultPrice.salePrice, number(rawOffer.totalSalePrice));
      const passengerTotal = priceDetail.reduce(
        (sum, item) => sum + number(item.salePrice) * Math.max(1, number(item.number, 1)),
        0,
      );
      const baggage = record(record(array(rawOffer.baggageRules).map(record).find(item => string(item.passengerType) === "adult")).checkIn);
      const id = `FQ-${randomUUID()}`;
      const title = tripType === 2
        ? `${firstJourney.origin} ↔ ${firstJourney.destination}`
        : journeySummaries.map(journey => journey.origin).concat(lastJourney.destination).join(" → ");
      const subtitle = `${journeySummaries.map(journey => journey.flightNo).filter(Boolean).join(" / ")} · ${journeySummaries.map(journey => journey.date).join(" / ")}`;
      const quote: FlightQuoteContext = {
        id,
        priceKey: string(rawOffer.priceKey),
        from: input.from,
        to: input.to,
        departureDate: input.departureDate,
        adultNum: input.adults,
        childNum: input.children || 0,
        infantNum: input.infants || 0,
        totalAmount: number(rawOffer.totalSalePrice, passengerTotal || price * input.adults),
        currency: string(rawOffer.currency, "CNY"),
        title,
        subtitle,
        tripType,
        journeys: requestedJourneys,
      };
      if (!quote.priceKey) continue;
      quotes.push(quote);
      offers.push({
        id,
        airline: string(firstJourney.first.airlineName, "F-Link 航司"),
        airlineCode: string(firstJourney.first.airlineCode, "--"),
        flightNo: journeySummaries.map(journey => journey.flightNo).filter(Boolean).join(" / "),
        departureAirport: `${firstJourney.origin} ${string(firstJourney.first.departureAirportName)}${string(firstJourney.first.departureTerminal)}`.trim(),
        arrivalAirport: `${firstJourney.destination} ${string(firstJourney.last.arrivalAirportName)}${string(firstJourney.last.arrivalTerminal)}`.trim(),
        departureTime: firstJourney.departureTime,
        arrivalTime: firstJourney.arrivalTime,
        duration: firstJourney.duration,
        stops: firstJourney.stops,
        cabin: array(rawOffer.cabinClass).map(value => string(value)).join("/") || "economy",
        baggage: baggage.weight ? `${number(baggage.number, 1)}件${number(baggage.weight)}${string(baggage.unit, "KG")}` : "以运价规则为准",
        price,
        currency: quote.currency,
        priceKey: quote.priceKey,
        tripType,
        adultNum: input.adults,
        childNum: input.children || 0,
        infantNum: input.infants || 0,
        journeys: journeySummaries.map(({ first: _first, last: _last, ...journey }) => journey),
      });
    }
  }
  return { offers, quotes };
}

export async function verifyFlinkFlight(client: FcgClient, quote: FlightQuoteContext) {
  const data = record(await client.flink<unknown>("zh_CN", "/flight/verify", { priceKey: quote.priceKey }));
  const offerData = record(data.offerData);
  if (number(offerData.status, 1) !== 1) throw new Error("F-Link 运价验证失败，请重新搜索");
  const priceDetail = array(offerData.priceDetail).map(record);
  const totalAmount = priceDetail.reduce((sum, item) => sum + number(item.salePrice) * Math.max(1, number(item.number, 1)), 0)
    || number(offerData.totalSalePrice, quote.totalAmount);
  return {
    quote: { ...quote, priceKey: string(offerData.priceKey, quote.priceKey), totalAmount, currency: string(offerData.currency, quote.currency), verifiedAt: Date.now() },
    data,
  };
}

export async function refreshFlinkCabin(
  client: FcgClient,
  quote: FlightQuoteContext,
) {
  const data = record(await client.flink<unknown>("zh_CN", "/flight/cabin", {
    priceKey: quote.priceKey,
  }));
  const offers: JsonRecord[] = [];
  const visit = (value: unknown, depth = 0) => {
    if (depth > 8 || value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(item => visit(item, depth + 1));
      return;
    }
    const item = record(value);
    if (string(item.priceKey)
      && (Array.isArray(item.priceDetail) || number(item.totalSalePrice) > 0)) {
      offers.push(item);
    }
    Object.values(item).forEach(child => visit(child, depth + 1));
  };
  visit(data);
  const uniqueOffers = [...new Map(
    offers.map(item => [string(item.priceKey), item] as const),
  ).values()];
  if (!uniqueOffers.length) throw new Error("F-Link 舱位刷新未返回新的 priceKey");
  const quotes = uniqueOffers.map(refreshed => {
    const priceDetail = array(refreshed.priceDetail).map(record);
    const totalAmount = priceDetail.reduce(
      (sum, item) => sum + number(item.salePrice) * Math.max(1, number(item.number, 1)),
      0,
    ) || number(refreshed.totalSalePrice, quote.totalAmount);
    return {
      ...quote,
      priceKey: string(refreshed.priceKey),
      totalAmount,
      currency: string(refreshed.currency, quote.currency),
    };
  });
  return {
    quote: quotes[0],
    quotes,
    data,
  };
}

export async function createFlinkOrder(client: FcgClient, quote: FlightQuoteContext, input: FlightBookingInput) {
  return record(await client.flink<unknown>("zh_CN", "/flight/order/create", {
    priceKey: quote.priceKey,
    contactName: input.contactName,
    contactRegion: "86",
    contactPhone: input.contactPhone,
    contactEmail: input.contactEmail,
    passenger: input.passengers.map(passenger => ({
      ...passenger,
      type: passenger.type || "adult",
      region: "86",
      phone: input.contactPhone,
      email: input.contactEmail,
      adultPassengerName: passenger.adultPassengerName || "",
      airline: "",
      cardNo: "",
    })),
  }));
}

export async function payFlinkOrder(
  client: FcgClient,
  input: { orderNo: string; amount: number },
) {
  const paid = record(await client.flink<unknown>("zh_CN", "/flight/order/pay", {
    orderNo: input.orderNo,
    amount: input.amount,
    type: 0,
  }));
  const payStatus = number(paid.payStatus);
  if (payStatus !== 1) {
    throw new FcgError(
      string(paid.message, "F-Link 支付受理失败"),
      "FLINK_PAY_FAILED",
      422,
    );
  }

  try {
    const detail = record(await client.flink<unknown>("zh_CN", "/flight/order/detail", {
      orderNo: input.orderNo,
    }));
    return {
      payStatus,
      rawStatus: number(detail.status),
      detailPending: false,
      detail,
    };
  } catch (error) {
    // Payment is an irreversible supplier-side action. Once accepted, a detail
    // timeout must not leave the local order payable again. The maintenance job
    // will retry order detail at the configured low-frequency interval.
    return {
      payStatus,
      rawStatus: undefined,
      detailPending: true,
      detailError: {
        code: error instanceof FcgError ? error.code : "FLINK_DETAIL_PENDING",
        message: error instanceof Error ? error.message : String(error),
      },
      detail: {},
    };
  }
}

export async function getFlinkOrderAfterSalesSource(client: FcgClient, orderNo: string) {
  const detail = record(await client.flink<unknown>("zh_CN", "/flight/order/detail", { orderNo }));
  const passengers = array(detail.passenger).map(record).map(passenger => ({
    passengerCode: string(passenger.passengerCode),
    name: string(passenger.name),
  })).filter(passenger => passenger.passengerCode);
  const segments = array(detail.journeys).map(record).flatMap(journey =>
    array(journey.airSegmentList).map(record).map(segment => ({
      segmentId: string(segment.segmentId),
      origin: string(segment.departureAirport, string(segment.departure)),
      destination: string(segment.arrivalAirport, string(segment.arrival)),
      date: string(segment.departureDate),
      flightNo: string(segment.flightNumber),
    }))).filter(segment => segment.segmentId);
  return { supplierStatus: number(detail.status), passengers, segments, detail };
}

export async function searchFlinkChangeOffers(
  client: FcgClient,
  input: {
    orderNo: string;
    cabinClass: string;
    date: string;
    passengerCode: string;
    segmentId: string;
  },
) {
  const data = record(await client.flink<unknown>("zh_CN", "/flight/change/search", {
    orderNo: input.orderNo,
    cabinClass: input.cabinClass,
    date: input.date,
    passenger: input.passengerCode,
    segmentId: input.segmentId,
  }));
  const segments = record(data.segments);
  return array(data.flight).map(record).flatMap(flight => {
    const journey = record(array(flight.journeys)[0]);
    const segmentIds = array(journey.airSegmentList).map(value => string(value)).filter(Boolean);
    const first = record(segments[segmentIds[0]]);
    const last = record(segments[segmentIds.at(-1) || ""]);
    const flightNo = array(journey.flightNumberList).map(value => string(value)).filter(Boolean).join("/")
      || segmentIds.map(id => string(record(segments[id]).flightNumber)).filter(Boolean).join("/");
    return array(flight.offerPriceList).map(record).map(offer => ({
      priceKey: string(offer.priceKey),
      flightNo,
      airline: string(first.airlineName, string(offer.ticketingAirline)),
      departureTime: string(first.departureTime, string(journey.originTime)),
      arrivalTime: string(last.arrivalTime, string(journey.destinationTime)),
      duration: string(journey.journeysTime, string(first.flightDuration)),
      price: number(offer.totalSalePrice),
      currency: string(offer.currency, "CNY"),
    })).filter(offer => offer.priceKey);
  });
}

export async function applyFlinkChange(
  client: FcgClient,
  input: {
    orderNo: string;
    passengerCode: string;
    segmentId: string;
    priceKey: string;
    changeType: 1 | 2 | 3;
    contactName: string;
    contactPhone: string;
    contactEmail: string;
    reason: string;
    reasonType?: 1 | 2;
    evidenceFiles?: string[];
  },
) {
  const data = record(await client.flink<unknown>("zh_CN", "/flight/change/apply", {
    orderNo: input.orderNo,
    passenger: input.passengerCode,
    segmentId: input.segmentId,
    priceKey: input.priceKey,
    changeOrderType: 1,
    changeType: input.changeType,
    contactName: input.contactName,
    contactRegion: "86",
    contactPhone: input.contactPhone,
    contactEmail: input.contactEmail,
    changeReasonType: input.reasonType || 1,
    changeReason: input.reason,
    fileList: input.evidenceFiles || [],
  }));
  const changeOrderNo = string(data.changeOrderNo);
  if (!changeOrderNo) throw new FcgError("F-Link 改签申请未返回改签单号", "FLINK_CHANGE_ORDER_MISSING", 502);
  return { changeOrderNo, status: number(data.status) };
}

export const getFlinkChangeDetail = async (client: FcgClient, changeOrderNo: string) =>
  record(await client.flink<unknown>("zh_CN", "/flight/change/detail", { changeOrderNo }));

export const cancelFlinkChange = async (client: FcgClient, changeOrderNo: string) =>
  record(await client.flink<unknown>("zh_CN", "/flight/change/cancel", { changeOrderNo }));

export async function payFlinkChange(client: FcgClient, input: { changeOrderNo: string; amount: number }) {
  const data = record(await client.flink<unknown>("zh_CN", "/flight/order/pay", {
    orderNo: input.changeOrderNo,
    amount: input.amount,
    type: 1,
  }));
  if (number(data.payStatus) !== 1) {
    throw new FcgError(string(data.message, "F-Link 改签支付受理失败"), "FLINK_CHANGE_PAY_FAILED", 422);
  }
  return data;
}

export async function applyFlinkRefund(
  client: FcgClient,
  input: {
    orderNo: string;
    passengerCode: string;
    segmentId: string;
    refundType: 1 | 2;
    reason: string;
    contactName: string;
    contactPhone: string;
    contactEmail: string;
    evidenceFiles?: string[];
  },
) {
  const data = record(await client.flink<unknown>("zh_CN", "/flight/refund/apply", {
    orderNo: input.orderNo,
    orderType: 1,
    passenger: input.passengerCode,
    segmentId: input.segmentId,
    refundType: input.refundType,
    reasonType: 1,
    reason: input.reason,
    fileList: input.evidenceFiles || [],
    contactName: input.contactName,
    contactRegion: "86",
    contactPhone: input.contactPhone,
    contactEmail: input.contactEmail,
  }));
  const refundOrderNo = string(data.refundOrderNo);
  if (!refundOrderNo) throw new FcgError("F-Link 退票申请未返回退票单号", "FLINK_REFUND_ORDER_MISSING", 502);
  return { refundOrderNo, status: number(data.status) };
}

export const getFlinkRefundDetail = async (client: FcgClient, refundOrderNo: string) =>
  record(await client.flink<unknown>("zh_CN", "/flight/refund/detail", { refundOrderNo }));

export const confirmFlinkRefund = async (
  client: FcgClient,
  input: { refundOrderNo: string; confirm: "1" | "2" },
) => record(await client.flink<unknown>("zh_CN", "/flight/refund/confirm", input));

export const fcgValue = { record, array, string, number };

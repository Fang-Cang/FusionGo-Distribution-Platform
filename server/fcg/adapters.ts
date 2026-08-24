import { randomUUID } from "node:crypto";
import { HOTEL_POPULAR_FACILITY_CODES, type FlightDestination, type FlightOffer, type HotelBasicInfo, type HotelCancellationPolicyDetails, type HotelOffer, type HotelPopularFacilityCode, type HotelPriceBreakdown, type NationalityOption } from "../../src/types.js";
import { FcgError, type FcgClient } from "./client.js";

type JsonRecord = Record<string, unknown>;

const record = (value: unknown): JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const string = (value: unknown, fallback = ""): string => {
  if (value === undefined || value === null) return fallback;
  const normalized = (typeof value === "string" ? value : String(value)).trim();
  return !normalized || ["null", "undefined"].includes(normalized.toLowerCase()) ? fallback : normalized;
};
const number = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : Number(value) || fallback;
const optionalNumber = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const normalizeGlinkPopularFacilities = (value: unknown): HotelPopularFacilityCode[] => {
  const flags = record(value);
  return HOTEL_POPULAR_FACILITY_CODES.filter(code => string(flags[code]) === "1");
};
const googleDistanceKm = (
  originLat: number,
  originLng: number,
  targetLat: number | undefined,
  targetLng: number | undefined,
): number | undefined => {
  if (targetLat === undefined || targetLng === undefined
    || Math.abs(originLat) > 90 || Math.abs(targetLat) > 90
    || Math.abs(originLng) > 180 || Math.abs(targetLng) > 180) return undefined;
  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = toRadians(targetLat - originLat);
  const longitudeDelta = toRadians(targetLng - originLng);
  const originLatitude = toRadians(originLat);
  const targetLatitude = toRadians(targetLat);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(originLatitude) * Math.cos(targetLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  const normalizedHaversine = Math.min(1, Math.max(0, haversine));
  const distance = 6_371 * 2 * Math.atan2(Math.sqrt(normalizedHaversine), Math.sqrt(1 - normalizedHaversine));
  return Math.round(distance * 10) / 10;
};
export const GLINK_HOTEL_STAR_MAPPING = new Map<number, { stars: number; description: string }>([
  [19, { stars: 5, description: "五星级" }],
  [29, { stars: 5, description: "五星级" }],
  [39, { stars: 4, description: "四星级" }],
  [49, { stars: 4, description: "四星级" }],
  [59, { stars: 3, description: "三星级" }],
  [64, { stars: 3, description: "三星级" }],
  [69, { stars: 2, description: "二星级" }],
  [66, { stars: 2, description: "二星级" }],
  [79, { stars: 2, description: "二星级" }],
]);

const hotelStarDescription = (stars: number) => `${["", "一", "二", "三", "四", "五"][stars]}星级`;

export const resolveGlinkHotelStar = (...candidates: unknown[]): { starCode?: number; stars: number; starDescription: string } | undefined => {
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null || candidate === "") continue;
    const matched = String(candidate).match(/\d+(?:\.\d+)?/);
    if (!matched) continue;
    const raw = Number(matched[0]);
    const mapped = GLINK_HOTEL_STAR_MAPPING.get(raw);
    if (mapped) return { starCode: raw, stars: mapped.stars, starDescription: mapped.description };
    const normalized = raw >= 100 && raw <= 500 && raw % 100 === 0
      ? raw / 100
      : raw >= 10 && raw <= 50 && raw % 10 === 0
        ? raw / 10
        : raw;
    if (normalized >= 1 && normalized <= 5) {
      const stars = Math.round(normalized);
      return { stars, starDescription: hotelStarDescription(stars) };
    }
  }
  return undefined;
};

export const normalizeGlinkHotelStars = (...candidates: unknown[]): number | undefined =>
  resolveGlinkHotelStar(...candidates)?.stars;
const plainText = (value: unknown): string => string(value)
  .replace(/<br\s*\/?>/gi, "；")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/gi, " ")
  .replace(/&bull;|&#8226;/gi, "•")
  .replace(/&amp;/gi, "&")
  .replace(/&lt;/gi, "<")
  .replace(/&gt;/gi, ">")
  .replace(/\s+/g, " ")
  .trim();

export const formatGlinkDestinationDetail = (value: unknown, language: "zh-CN" | "zh-TW" | "en-US" = "zh-CN"): string => {
  const destination = record(value);
  const hierarchy = [destination.cityName, destination.provinceName, destination.countryName];
  const separator = language === "en-US" ? ", " : "，";
  return hierarchy.map(item => string(item)).filter(Boolean).join(separator);
};

const glinkDestinationRows = (data: unknown): unknown[] => {
  if (Array.isArray(data)) return data;
  const root = record(data);
  for (const key of ["data", "list", "destinationList", "destinationDTOList", "destinations"]) {
    const nested = root[key];
    if (Array.isArray(nested)) return nested;
    const nestedRecord = record(nested);
    if (Object.keys(nestedRecord).length) {
      const rows = glinkDestinationRows(nestedRecord);
      if (rows.length) return rows;
    }
  }
  return root.destinationName !== undefined || root.destinationType !== undefined || root.dataType !== undefined
    ? [root]
    : [];
};

export const normalizeGlinkDestinations = (
  data: unknown,
  language: "zh-CN" | "zh-TW" | "en-US" = "zh-CN",
) => glinkDestinationRows(data).flatMap(rawItem => {
  const outer = record(rawItem);
  const localizedNames = array(outer.destinationName).map(record);
  const localized = localizedNames.find(item => string(item.language) === language)
    ?? localizedNames.find(item => string(item.language) === "zh-CN")
    ?? localizedNames[0]
    ?? outer;
  const destinationType = number(outer.dataType, number(outer.destinationType, number(localized.dataType, number(localized.destinationType))));
  const merged = { ...outer, ...localized, destinationType };
  const flatDestinationName = Array.isArray(outer.destinationName) ? "" : string(outer.destinationName);
  const name = string(localized.name, string(localized.destinationName, flatDestinationName || string(localized.cityName)));
  const latGoogle = optionalNumber(localized.latGoogle) ?? optionalNumber(outer.latGoogle);
  const lngGoogle = optionalNumber(localized.lngGoogle) ?? optionalNumber(outer.lngGoogle);
  const source = optionalNumber(outer.source) ?? optionalNumber(localized.source);
  const hotelId = optionalNumber(localized.hotelId) ?? optionalNumber(outer.hotelId);
  if (!name || latGoogle === undefined || lngGoogle === undefined) return [];
  return [{
    name,
    detail: formatGlinkDestinationDetail(merged, language),
    cityCode: string(localized.cityCode, string(outer.cityCode)),
    ...(string(outer.destinationId, string(localized.destinationId)) ? { destinationId: string(outer.destinationId, string(localized.destinationId)) } : {}),
    destinationType,
    ...(source !== undefined ? { source } : {}),
    ...(hotelId !== undefined ? { hotelId } : {}),
    latGoogle,
    lngGoogle,
  }];
});

export function normalizeFlinkNationalities(data: unknown): Array<Omit<NationalityOption, "source">> {
  return array(data).map(record).map(item => ({
    code: string(item.code).toUpperCase(),
    nameZh: string(item.name),
    nameZhTw: string(item.tname, string(item.name)),
    nameEn: string(item.ename, string(item.name)),
    dialingCode: string(item.region),
  })).filter(item => /^[A-Z]{2,3}$/.test(item.code));
}

export async function listFlinkNationalities(
  client: FcgClient,
  lang: "zh_CN" | "zh_TW" | "en" = "zh_CN",
) {
  return normalizeFlinkNationalities(await client.flink<unknown>(lang, "/nationality/list", {}));
}

const flinkAirportRows = (data: unknown): unknown[] => {
  if (Array.isArray(data)) return data;
  const root = record(data);
  if (Array.isArray(root.data)) return root.data;
  const nested = record(root.data);
  return Array.isArray(nested.data) ? nested.data : [];
};

export function normalizeFlinkFlightDestinations(data: unknown): FlightDestination[] {
  const destinations = flinkAirportRows(data).flatMap(rawItem => {
    const item = record(rawItem);
    const cityCode = string(item.cityCode).toUpperCase();
    const airportCode = string(item.airPort, string(item.airport)).toUpperCase();
    const cityName = string(item.cityName, cityCode);
    const airportName = string(item.airPortName, string(item.airportName));
    const country = string(item.country);
    const results: FlightDestination[] = [];
    if (cityCode) results.push({
      code: cityCode,
      type: 1,
      cityCode,
      cityName,
      country,
      displayName: cityName,
      detail: [cityCode, country].filter(Boolean).join(" · "),
    });
    if (airportCode) results.push({
      code: airportCode,
      type: 2,
      cityCode: cityCode || airportCode,
      cityName,
      airportCode,
      airportName,
      country,
      displayName: airportName || cityName || airportCode,
      detail: [airportCode, cityName, country].filter(Boolean).join(" · "),
    });
    return results;
  });
  return destinations.filter((item, index, all) =>
    all.findIndex(candidate => candidate.type === item.type && candidate.code === item.code) === index);
}

export async function searchFlinkFlightDestinations(
  client: FcgClient,
  keyword: string,
  lang: "zh_CN" | "zh_TW" | "en" = "zh_CN",
) {
  return normalizeFlinkFlightDestinations(
    await client.flink<unknown>(lang, "/airports/search", { keyword }),
  );
}

export class GlinkNoProductError extends Error {
  constructor(readonly reason: "EMPTY_RESPONSE" | "NO_BOOKABLE_PRODUCT") {
    super(reason === "EMPTY_RESPONSE"
      ? "G-Link 沙箱未返回实时房态，请确认当前账号已配置可售酒店和测试库存"
      : "当前酒店没有可预订的实时房型");
    this.name = "GlinkNoProductError";
  }
}

export async function queryGlinkHotelBasicInfo(
  client: FcgClient,
  hotelId: number,
  language: "zh-CN" | "en-US",
): Promise<HotelBasicInfo> {
  const [detailResponse, imageResponse] = await Promise.all([
    client.glink<unknown>("/hotel/detail", {
      hotelIds: [String(hotelId)],
      language,
      settings: ["comment", "hotelFacilityNew", "importantNotices"],
    }),
    client.glink<unknown>("/hotel/images", { hotelIds: [String(hotelId)] }),
  ]);
  const detailData = record(detailResponse);
  const detail = record(array(detailData.hotelInfos)[0] ?? detailData);
  if (!number(detail.hotelId, hotelId)) throw new Error("上游未返回酒店基础信息");
  const comment = record(array(detail.comment)[0] ?? detail.comment);
  const imageData = record(imageResponse);
  const imageGroup = record(array(imageData.hotelImages)[0] ?? imageData);
  const images = array(imageGroup.images).map(record)
    .map(image => string(image.url, string(image.orgImageUrl, string(image.imageUrl))).replace(/^http:\/\//, "https://"))
    .filter((url, index, all) => Boolean(url) && all.indexOf(url) === index);
  const facilities = array(detail.facility).map(record)
    .filter(item => string(item.categoryType) !== "2" && number(item.status, 1) !== 0)
    .map(item => string(item.name)).filter((name, index, all) => Boolean(name) && all.indexOf(name) === index);
  const popularFacilities = normalizeGlinkPopularFacilities(detail.popularFacility);
  const rooms = array(detail.roomInfos).map(record).map(room => ({
    roomId: number(room.roomId),
    ...(optionalNumber(room.isAllowSmoking) !== undefined ? { smokingPolicy: optionalNumber(room.isAllowSmoking) } : {}),
    ...(string(room.roomAcreage) ? { roomArea: string(room.roomAcreage) } : {}),
    ...(string(room.roomFloor) ? { roomFloor: string(room.roomFloor) } : {}),
    ...(optionalNumber(room.windowDetail) !== undefined ? { windowType: optionalNumber(room.windowDetail) } : {}),
    ...(optionalNumber(room.wirelessBroadband) !== undefined ? { wirelessBroadband: optionalNumber(room.wirelessBroadband) } : {}),
  })).filter(room => room.roomId > 0);
  const hotelStar = resolveGlinkHotelStar(detail.hotelStar, detail.starRating, detail.hotelStarName);
  return {
    hotelId: number(detail.hotelId, hotelId),
    name: string(detail.hotelName, "未知酒店"),
    city: string(detail.cityName, string(detail.city)),
    district: string(detail.distinctName, string(detail.districtName, string(detail.businessName))),
    ...(string(detail.address) ? { address: string(detail.address) } : {}),
    ...(string(detail.telephone, string(detail.phone)) ? { phone: string(detail.telephone, string(detail.phone)) } : {}),
    ...(string(detail.openingDate) ? { openingDate: string(detail.openingDate) } : {}),
    ...(string(detail.fitmentDate) ? { renovatedDate: string(detail.fitmentDate) } : {}),
    ...(optionalNumber(detail.roomNum) !== undefined ? { numberOfRooms: optionalNumber(detail.roomNum) } : {}),
    ...(hotelStar || {}),
    ...(optionalNumber(comment.averageScore) !== undefined ? { rating: optionalNumber(comment.averageScore) } : {}),
    ...(string(comment.source) ? { ratingSource: string(comment.source) } : {}),
    ...(plainText(detail.hotelIntroduce) ? { introduction: plainText(detail.hotelIntroduce) } : {}),
    ...(string(detail.checkInTime) ? { checkInTime: string(detail.checkInTime) } : {}),
    ...(string(detail.checkInLateTime) ? { checkInLateTime: string(detail.checkInLateTime) } : {}),
    ...(string(detail.checkOutTime) ? { checkOutTime: string(detail.checkOutTime) } : {}),
    ...(Object.keys(record(detail.popularFacility)).length ? { popularFacilities } : {}),
    ...(rooms.length ? { rooms } : {}),
    facilities,
    images,
    importantNotices: array(detail.importantNotices).map(record).map(item => plainText(item.informText)).filter(Boolean),
  };
}

export interface HotelQuoteContext {
  id: string;
  hotelId: number;
  hotelName: string;
  language?: "zh-CN" | "en-US";
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
  payAtHotelFee?: number;
  payAtHotelFeeCurrency?: string;
  bedType?: string;
  bedTypeDescription?: string;
  windowType?: number;
  breakfast?: string;
  breakfastIncluded?: boolean;
  cancelPolicy?: string;
  cancellationPolicyDetails?: HotelCancellationPolicyDetails;
  cancelRestrictionType?: number;
  nonRefundable?: boolean;
  freeCancellation?: boolean;
  checkInInstructions?: string;
  specialCheckInInstructions?: string[];
  priceBreakdown?: HotelPriceBreakdown;
  city?: string;
  cityCode?: string;
  searchMatch?: "exact" | "nearby";
  distanceKm?: number;
  district?: string;
  rating?: number;
  ratingSource?: string;
  stars?: number;
  starCode?: number;
  starDescription?: string;
  image?: string;
  tags?: string[];
  lowestPriceVerifiedAt?: string;
}

const collectText = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.flatMap(collectText);
  const item = record(value);
  if (Object.keys(item).length) {
    return [plainText(item.details), plainText(item.title), plainText(item.informText)].filter(Boolean);
  }
    const normalized = plainText(value);
  return normalized ? [normalized] : [];
};

const productBedDescription = (product: JsonRecord): string => {
  const direct = string(product.bedInfoDesc);
  if (direct) return direct;
  const alternatives = array(product.bedTypeDetails).map(record).map(option => {
    const description = string(option.bedInfoDesc);
    if (description) return description;
    return array(option.bedInfos).map(record).map(bed => {
      const name = string(bed.bedTypeName);
      const count = optionalNumber(bed.bedNum);
      return [count && count > 1 ? `${count}张` : "", name].filter(Boolean).join("");
    }).filter(Boolean).join(" + ");
  }).filter(Boolean);
  return alternatives.join(" / ");
};

const productSpecialInstructions = (product: JsonRecord): string[] => array(product.tips)
  .map(record)
  .filter(tip => [3, 4].includes(number(tip.tipsType)))
  .flatMap(tip => collectText(tip.tipsDetails))
  .filter((value, index, all) => all.indexOf(value) === index);

const cancellationDescription = (product: JsonRecord): string => {
  const explicit = string(product.cancelPolicy);
  if (explicit) return explicit;
  const type = optionalNumber(product.cancelRestrictionType);
  const restrictionDay = optionalNumber(product.cancelRestrictionDay);
  const restrictionTime = string(product.cancelRestrictionTime);
  const formattedTime = /^\d{4}$/.test(restrictionTime)
    ? `${restrictionTime.slice(0, 2)}:${restrictionTime.slice(2)}`
    : restrictionTime;
  const cutoff = string(product.freeCancellationDateTime)
    || (restrictionDay !== undefined || formattedTime
      ? `${restrictionDay === 0 ? "入住日" : restrictionDay !== undefined ? `入住前${restrictionDay}天` : ""}${formattedTime ? ` ${formattedTime}` : ""}`.trim()
      : "");
  if (type === 1) return "不可取消、不可更改";
  if (type === 2) return cutoff ? `${cutoff} 后取消将收取罚金` : "超过免费取消时限后将收取罚金";
  if (type === 3) return cutoff ? `${cutoff} 后不可取消或更改` : "超过取消时限后不可取消或更改";
  if (type === 4) return "可免费取消";
  return "";
};

const cancellationPolicyDetails = (product: JsonRecord): HotelCancellationPolicyDetails | undefined => {
  const cancelRestrictionType = optionalNumber(product.cancelRestrictionType);
  const cancelRestrictionDay = optionalNumber(product.cancelRestrictionDay);
  const cancelRestrictionTime = string(product.cancelRestrictionTime);
  const freeCancellationDateTime = string(product.freeCancellationDateTime);
  const cancelPenalties = array(product.cancelPenalties).map(record).map(item => ({
    ...(optionalNumber(item.penaltiesType) !== undefined ? { penaltiesType: optionalNumber(item.penaltiesType) } : {}),
    ...(string(item.startDate) ? { startDate: string(item.startDate) } : {}),
    ...(string(item.endData, string(item.endDate)) ? { endDate: string(item.endData, string(item.endDate)) } : {}),
    ...(string(item.penaltiesValue) ? { penaltiesValue: string(item.penaltiesValue) } : {}),
    ...(string(item.currency) ? { currency: string(item.currency) } : {}),
  }));
  if (cancelRestrictionType === undefined && cancelRestrictionDay === undefined && !cancelRestrictionTime && !freeCancellationDateTime && !cancelPenalties.length) return undefined;
  return {
    ...(cancelRestrictionType !== undefined ? { cancelRestrictionType } : {}),
    ...(cancelRestrictionDay !== undefined ? { cancelRestrictionDay } : {}),
    ...(cancelRestrictionTime ? { cancelRestrictionTime } : {}),
    ...(freeCancellationDateTime ? { freeCancellationDateTime } : {}),
    cancelPenalties,
  };
};

const productPriceBreakdown = (product: JsonRecord, currency: string, total: number): HotelPriceBreakdown => {
  const priceItems = array(product.priceItems).map(record);
  const taxDetails = priceItems.map(item => record(item.taxDetail));
  const sum = (key: string) => taxDetails.reduce((amount, detail) => amount + number(detail[key]), 0);
  const taxAndFeeDetails = record(product.taxAndFeeDetails);
  const rawFeeItems = Array.isArray(taxAndFeeDetails.feeItems)
    ? array(taxAndFeeDetails.feeItems)
    : Object.keys(record(taxAndFeeDetails.feeItems)).length ? [taxAndFeeDetails.feeItems] : [];
  const feeItems = rawFeeItems.map(record).map(item => ({
    type: string(item.type, "fee"),
    value: number(item.value),
    currency: string(item.currency, currency),
    ...(string(item.date) ? { date: string(item.date) } : {}),
    ...(string(taxAndFeeDetails.chargeFrequency) ? { chargeFrequency: string(taxAndFeeDetails.chargeFrequency) } : {}),
  })).filter(item => item.value !== 0);
  const roomSubtotal = optionalNumber(product.roomPrice) ?? (sum("roomPrice") || undefined);
  const taxFee = sum("taxFee") || undefined;
  const salesTax = sum("salesTax") || undefined;
  const otherTax = sum("otherTax") || undefined;
  const chargesDueAtProperty = optionalNumber(product.payAtHotelFee);
  return {
    ...(roomSubtotal !== undefined ? { roomSubtotal } : {}),
    ...(taxFee !== undefined ? { taxFee } : {}),
    ...(salesTax !== undefined ? { salesTax } : {}),
    ...(otherTax !== undefined ? { otherTax } : {}),
    ...(chargesDueAtProperty !== undefined ? { chargesDueAtProperty } : {}),
    ...(string(product.payAtHotelFeeCurrency) ? { chargesDueAtPropertyCurrency: string(product.payAtHotelFeeCurrency) } : {}),
    total,
    currency,
    ...(feeItems.length ? { feeItems } : {}),
  };
};

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
  airline?: string;
  airlineCode?: string;
  flightNo?: string;
  cabin?: string;
  baggage?: string;
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
  if (!input.hotelIds.length) return { currency: "", prices: new Map<number, number>() };
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
  const currency = string(data.currency).toUpperCase();
  if (prices.size && !currency) throw new Error("G-Link 起价响应缺少币种，已阻止展示未完整价格");
  return { currency, prices };
}

export async function queryGlinkDailyLowestPrices(
  client: FcgClient,
  hotelIds: number[],
) {
  if (!hotelIds.length) return { currency: "", hotels: [] as Array<{
    hotelId: number;
    priceItems: Array<{ saleDate: string; salePrice: number }>;
  }> };
  const data = record(await client.glink<unknown>("/hotel/lowestPrice", {
    hotelIds: hotelIds.slice(0, 10),
  }));
  const hotels = array(data.hotelLowestPrices).map(record).map(hotel => ({
      hotelId: number(hotel.hotelId),
      priceItems: array(hotel.priceItems).map(record).map(item => ({
        saleDate: string(item.saleDate),
        salePrice: number(item.salePrice),
      })).filter(item => item.saleDate && item.salePrice > 0),
    })).filter(hotel => hotel.hotelId && hotel.priceItems.length);
  const currency = string(data.currency).toUpperCase();
  if (hotels.length && !currency) throw new Error("G-Link 每日起价响应缺少币种");
  return { currency, hotels };
}

export async function searchGlinkHotels(
  client: FcgClient,
  input: {
    destination: string;
    cityCode?: string;
    destinationId?: string;
    destinationType?: number;
    source?: number;
    hotelId?: number;
    latGoogle?: number;
    lngGoogle?: number;
    language?: "zh-CN" | "en-US";
    checkIn: string;
    checkOut: string;
    rooms?: number;
    adults?: number;
    children?: number;
    childAges?: number[];
    hotelFacilityCodes?: string[];
    roomFacilityCodes?: string[];
    page?: number;
    pageSize?: number;
  },
) {
  const language = input.language ?? "en-US";
  let destinationCityCode = string(input.cityCode).toUpperCase();
  let destinationType = number(input.destinationType);
  let latGoogle = optionalNumber(input.latGoogle);
  let lngGoogle = optionalNumber(input.lngGoogle);
  if (latGoogle === undefined || lngGoogle === undefined) {
    const destinations = await client.glink<unknown>("/search/destination", {
      keyWord: input.destination,
      source: 1,
    });
    const destinationCandidates = array(destinations).map(record);
    const normalizedDestination = input.destination.trim().toLowerCase().replace(/\s+/g, " ");
    const destination = destinationCandidates.find(item =>
      [string(item.destinationName), string(item.cityName), string(item.name)]
        .some(name => name.toLowerCase().replace(/\s+/g, " ") === normalizedDestination))
      ?? destinationCandidates.find(item => number(item.destinationType) === 2)
      ?? record(destinationCandidates[0]);
    destinationCityCode = string(destination.cityCode).toUpperCase();
    destinationType = number(destination.destinationType);
    latGoogle = optionalNumber(destination.latGoogle);
    lngGoogle = optionalNumber(destination.lngGoogle);
  }
  if (latGoogle === undefined || lngGoogle === undefined) throw new Error(`未找到目的地“${input.destination}”的经纬度`);
  const saleable = await queryGlinkSaleableHotelIds(client, {
    cityCode: destinationCityCode || undefined,
  });
  if (!saleable.hotelIds.length) {
    return {
      offers: [] as HotelOffer[],
      quotes: [] as HotelQuoteContext[],
      diagnostics: { saleableHotelCount: 0, lowestPriceHotelCount: 0 },
    };
  }
  const saleableIds = new Set(saleable.hotelIds);

  const requestedPage = input.page || 1;
  const requestedPageSize = Math.min(input.pageSize || 10, 10);
  const listRequest = {
    checkInDate: input.checkIn,
    checkOutDate: input.checkOut,
    currentPage: requestedPage,
    pageSize: requestedPageSize,
    sortBy: 1,
    language,
    ...(input.hotelFacilityCodes?.length ? { hotelFacilityCodes: input.hotelFacilityCodes } : {}),
    ...(input.roomFacilityCodes?.length ? { roomFacilityCodes: input.roomFacilityCodes } : {}),
  };
  const isHotelDestination = destinationType === 1;
  let searchMatch: "exact" | "nearby" = isHotelDestination ? "exact" : "nearby";
  let listData = isHotelDestination
    ? record(await client.glink<unknown>("/search/hotelList", input.destinationId
      ? { ...listRequest, destinationId: input.destinationId }
      : { ...listRequest, latGoogle, lngGoogle, distance: 10, keyWord: input.destination }))
    : record(await client.glink<unknown>("/search/hotelList", {
      ...listRequest, latGoogle, lngGoogle, distance: 10,
    }));
  let rawHotelRows = array(listData.list).map(record);
  if (isHotelDestination) {
    const normalizedHotelName = input.destination.trim().toLowerCase().replace(/\s+/g, " ");
    rawHotelRows = rawHotelRows.filter(item => input.hotelId
      ? number(item.hotelId) === input.hotelId
      : string(item.hotelName).trim().toLowerCase().replace(/\s+/g, " ") === normalizedHotelName);
  }
  const eligibleRows = (rows: JsonRecord[]) => rows.filter(item => saleableIds.has(number(item.hotelId))
      && Boolean(string(item.hotelName))
      && (!destinationCityCode || string(item.cityCode).toUpperCase() === destinationCityCode))
    .slice(0, requestedPageSize);
  let hotelRows = eligibleRows(rawHotelRows);
  if (isHotelDestination && !hotelRows.length) {
    searchMatch = "nearby";
    listData = record(await client.glink<unknown>("/search/hotelList", {
      ...listRequest, latGoogle, lngGoogle, distance: 10,
    }));
    hotelRows = eligibleRows(array(listData.list).map(record));
  }
  const pagination = {
    currentPage: requestedPage,
    pageSize: number(listData.pageSize, requestedPageSize),
    totalCount: number(listData.totalCount, rawHotelRows.length),
    totalPages: number(listData.totalPage, 1),
    hasMore: requestedPage < number(listData.totalPage, 1),
  };
  const candidateIds = hotelRows.map(item => number(item.hotelId)).filter(Boolean);
  if (!candidateIds.length) {
    return {
      offers: [] as HotelOffer[],
      quotes: [] as HotelQuoteContext[],
      pagination: { ...pagination, hasMore: false },
      diagnostics: { saleableHotelCount: saleable.totalCount, lowestPriceHotelCount: 0 },
    };
  }
  const lowest = await queryGlinkLowestPrices(client, {
    hotelIds: candidateIds,
    checkInDate: input.checkIn,
    checkOutDate: input.checkOut,
  });
  const pricedRows = hotelRows.filter(item => lowest.prices.has(number(item.hotelId)));
  const allowsUnpricedListings = destinationType !== 2;
  const displayRows = allowsUnpricedListings ? hotelRows : pricedRows;
  const hotelIds = displayRows.map(item => string(item.hotelId));
  if (!hotelIds.length) {
    return {
      offers: [] as HotelOffer[],
      quotes: [] as HotelQuoteContext[],
      pagination: { ...pagination, hasMore: false },
      diagnostics: { saleableHotelCount: saleable.totalCount, lowestPriceHotelCount: 0 },
    };
  }

  const [detailResponse, imageResponse] = await Promise.all([
    client.glink<unknown>("/hotel/detail", {
      hotelIds,
      language,
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
  const offers = displayRows.map((row): HotelOffer => {
    const hotelId = number(row.hotelId);
    const detail = details.get(string(row.hotelId)) ?? {};
    const comment = record(array(detail.comment)[0] ?? detail.comment);
    const upstreamRating = optionalNumber(row.hotelScore) ?? optionalNumber(comment.averageScore);
    const hotelStar = resolveGlinkHotelStar(
      row.hotelStar,
      detail.hotelStar,
      row.starRating,
      detail.starRating,
      row.hotelStarName,
      detail.hotelStarName,
    );
    const rating = upstreamRating !== undefined && upstreamRating > 0 ? upstreamRating : undefined;
    const image = string(row.mainUrl, images.get(string(row.hotelId)) || string(detail.appearancePicUrl))
      .replace(/^http:\/\//, "https://");
    const hotelName = string(detail.hotelName, string(row.hotelName));
    const city = string(row.cityName, string(detail.cityName, string(detail.city)));
    const district = string(row.districtName, string(row.businessName, string(detail.distinctName)));
    const distanceKm = destinationType === 8
      ? googleDistanceKm(
        latGoogle,
        lngGoogle,
        optionalNumber(row.latGoogle) ?? optionalNumber(detail.latGoogle),
        optionalNumber(row.lngGoogle) ?? optionalNumber(detail.lngGoogle),
      )
      : undefined;
    const quote: HotelQuoteContext = {
      id: `GH-${hotelId}-${randomUUID()}`,
      hotelId,
      hotelName,
      language,
      checkInDate: input.checkIn,
      checkOutDate: input.checkOut,
      roomNum: input.rooms || 1,
      numberOfAdults: input.adults || 2,
      numberOfChildren: input.children || 0,
      childrenAges: input.childAges || [],
      currency: lowest.currency,
      nightlyPrice: lowest.prices.get(hotelId) || 0,
      city,
      cityCode: destinationCityCode,
      searchMatch,
      ...(distanceKm !== undefined ? { distanceKm } : {}),
      district,
      ...(rating !== undefined ? { rating } : {}),
      ...(string(comment.source) ? { ratingSource: string(comment.source) } : {}),
      ...(hotelStar || {}),
      ...(image ? { image } : {}),
      tags: [
        ...array(row.hotelLabelNameList).map(label => string(label)).filter(Boolean),
        string(row.brandName),
        string(row.groupName),
      ].filter(Boolean),
      ...([string(detail.checkInTime), string(detail.checkInLateTime)].some(Boolean) ? {
        checkInInstructions: `办理入住：${string(detail.checkInTime, "上游未注明最早时间")}–${string(detail.checkInLateTime, "上游未注明最晚时间")}`,
      } : {}),
      ...(array(detail.importantNotices).length ? {
        specialCheckInInstructions: array(detail.importantNotices).map(record)
          .map(notice => plainText(notice.informText)).filter(Boolean),
      } : {}),
      lowestPriceVerifiedAt: new Date().toISOString(),
    };
    quotes.push(quote);
    return {
      id: quote.id,
      hotelId,
      inventorySource: "glink",
      name: quote.hotelName,
      city: quote.city || "",
      cityCode: quote.cityCode,
      searchMatch: quote.searchMatch,
      ...(quote.distanceKm !== undefined ? { distanceKm: quote.distanceKm } : {}),
      district: quote.district || "",
      ...(quote.rating !== undefined ? { rating: quote.rating } : {}),
      ...(quote.ratingSource ? { ratingSource: quote.ratingSource } : {}),
      ...(quote.stars !== undefined ? { stars: quote.stars } : {}),
      ...(quote.starCode !== undefined ? { starCode: quote.starCode } : {}),
      ...(quote.starDescription ? { starDescription: quote.starDescription } : {}),
      ...(quote.image ? { image: quote.image } : {}),
      tags: quote.tags || [],
      roomName: language === "en-US" ? "View real-time room types" : "进入详情查看实时房型",
      breakfast: language === "en-US" ? "Subject to real-time product details" : "以实时产品为准",
      cancelPolicy: language === "en-US" ? "Subject to real-time cancellation policy" : "以实时取消政策为准",
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
    pagination,
    diagnostics: {
      saleableHotelCount: saleable.totalCount,
      lowestPriceHotelCount: lowest.prices.size,
    },
  };
}

function mapGlinkProduct(
  quote: HotelQuoteContext,
  selectedRoom: JsonRecord,
  selectedProduct: JsonRecord,
) {
  const rawPriceItems = array(selectedProduct.priceItems).map(record);
  const priceItems = rawPriceItems.map(item => ({
    saleDate: string(item.saleDate),
    salePrice: number(item.salePrice),
  })).filter(item => item.saleDate && item.salePrice >= 0);
  const total = number(selectedProduct.totalSalePrice, priceItems.reduce((sum, item) => sum + item.salePrice, 0));
  const currency = string(selectedProduct.currency, string(rawPriceItems[0]?.currency, quote.currency));
  const cancelRestrictionType = optionalNumber(selectedProduct.cancelRestrictionType);
  const structuredCancellationPolicy = cancellationPolicyDetails(selectedProduct);
  const breakfastName = string(selectedProduct.breakfastName);
  const breakfastCounts = [optionalNumber(selectedProduct.breakfastNum), ...rawPriceItems.map(item => optionalNumber(item.breakfastNum))]
    .filter((value): value is number => value !== undefined);
  const breakfastIncluded = breakfastCounts.length
    ? breakfastCounts.some(value => value > 0)
    : breakfastName
      ? !/(no breakfast|without breakfast|无早|無早|不含早|不含早餐)/i.test(breakfastName)
      : undefined;
  const freeCancellation = cancelRestrictionType !== undefined && [2, 3, 4].includes(cancelRestrictionType);
  const productInstructions = productSpecialInstructions(selectedProduct);
  const allInstructions = [...(quote.specialCheckInInstructions || []), ...productInstructions]
    .filter((value, index, all) => all.indexOf(value) === index);
  const propertyChargeNotice = allInstructions.find(instruction => /到店支付|到店另付|pay at (?:the )?(?:hotel|property)|due at (?:the )?property/i.test(instruction));
  const initialPriceBreakdown = productPriceBreakdown(selectedProduct, currency, total);
  const next: HotelQuoteContext = {
    ...quote,
    id: `GQ-${quote.hotelId}-${randomUUID()}`,
    roomId: number(selectedRoom.roomId),
    roomName: string(selectedRoom.roomName, "实时可订房型"),
    ratePlanId: string(selectedProduct.ratePlanId),
    ratePlanName: string(selectedProduct.ratePlanName, "实时价格计划"),
    supplyCode: string(selectedProduct.supplyCode),
    currency,
    nightlyPrice: priceItems.length ? total / priceItems.length / Math.max(1, quote.roomNum) : total,
    productPriceItems: priceItems,
    payAtHotelFlag: number(selectedProduct.payAtHotelFlag),
    ...(optionalNumber(selectedProduct.payAtHotelFee) !== undefined ? { payAtHotelFee: optionalNumber(selectedProduct.payAtHotelFee) } : {}),
    ...(string(selectedProduct.payAtHotelFeeCurrency) ? { payAtHotelFeeCurrency: string(selectedProduct.payAtHotelFeeCurrency) } : {}),
    bedType: string(selectedProduct.bedType),
    bedTypeDescription: productBedDescription(selectedProduct)
      || string(selectedProduct.bedType),
    ...(optionalNumber(selectedProduct.windowType) !== undefined ? { windowType: optionalNumber(selectedProduct.windowType) } : {}),
    breakfast: breakfastName,
    breakfastIncluded,
    cancelPolicy: cancellationDescription(selectedProduct),
    ...(structuredCancellationPolicy ? { cancellationPolicyDetails: structuredCancellationPolicy } : {}),
    ...(cancelRestrictionType !== undefined ? { cancelRestrictionType } : {}),
    ...(cancelRestrictionType !== undefined ? { nonRefundable: cancelRestrictionType === 1 } : {}),
    ...(cancelRestrictionType !== undefined ? { freeCancellation } : {}),
    specialCheckInInstructions: allInstructions,
    priceBreakdown: {
      ...initialPriceBreakdown,
      ...(propertyChargeNotice && initialPriceBreakdown.chargesDueAtProperty === undefined
        ? { chargesDueAtPropertyNotice: propertyChargeNotice }
        : {}),
    },
  };
  if (!next.roomId || !next.ratePlanId || !next.supplyCode) throw new Error("实时产品缺少下单标识，请重新选择房型");
  return {
    quote: next,
    offer: {
      id: next.id,
      hotelId: next.hotelId,
      roomId: next.roomId,
      inventorySource: "glink",
      name: next.hotelName,
      city: quote.city || "",
      cityCode: quote.cityCode,
      district: quote.district || "",
      ...(quote.rating !== undefined ? { rating: quote.rating } : {}),
      ...(quote.ratingSource ? { ratingSource: quote.ratingSource } : {}),
      ...(quote.stars !== undefined ? { stars: quote.stars } : {}),
      ...(quote.starCode !== undefined ? { starCode: quote.starCode } : {}),
      ...(quote.starDescription ? { starDescription: quote.starDescription } : {}),
      ...(quote.image ? { image: quote.image } : {}),
      tags: [...(quote.tags || []), "G-Link 实时产品"].slice(0, 6),
      roomName: next.roomName || "实时可订房型",
      ratePlanName: next.ratePlanName,
      breakfast: next.breakfast || "上游未返回早餐信息",
      ...(next.breakfastIncluded !== undefined ? { breakfastIncluded: next.breakfastIncluded } : {}),
      cancelPolicy: next.cancelPolicy || "上游未返回取消政策",
      ...(next.cancellationPolicyDetails ? { cancellationPolicyDetails: next.cancellationPolicyDetails } : {}),
      ...(next.bedTypeDescription ? { bedTypeDescription: next.bedTypeDescription } : {}),
      ...(next.windowType !== undefined ? { windowType: next.windowType } : {}),
      ...(next.cancelRestrictionType !== undefined ? { cancelRestrictionType: next.cancelRestrictionType } : {}),
      ...(next.nonRefundable !== undefined ? { nonRefundable: next.nonRefundable } : {}),
      ...(next.freeCancellation !== undefined ? { freeCancellation: next.freeCancellation } : {}),
      ...(next.checkInInstructions ? { checkInInstructions: next.checkInInstructions } : {}),
      ...(next.specialCheckInInstructions?.length ? { specialCheckInInstructions: next.specialCheckInInstructions } : {}),
      payAtHotel: next.payAtHotelFlag === 1,
      paymentTiming: next.payAtHotelFlag === 1
        ? "由酒店在到店或退房时向旅客收取"
        : "提交订单后由 FusionGo 企业授信账户支付",
      paymentProcessor: next.payAtHotelFlag === 1 ? "预订酒店" : "FusionGo 企业授信",
      paymentProcessingLocation: next.payAtHotelFlag === 1 ? "酒店所在地" : "中国大陆",
      ...(next.priceBreakdown ? { priceBreakdown: next.priceBreakdown } : {}),
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
      ...(optionalNumber(selectedProduct.maxRoomCount) !== undefined
        ? { maxRoomCount: optionalNumber(selectedProduct.maxRoomCount) }
        : {}),
    } satisfies HotelOffer,
  };
}

export async function hydrateGlinkProducts(
  client: FcgClient,
  quote: HotelQuoteContext,
  options: { paymentType?: "prepaid" | "payAtHotel"; language?: "zh-CN" | "en-US" } = {},
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
    language: options.language ?? quote.language ?? "en-US",
  }));
  if (!Object.keys(data).length) throw new GlinkNoProductError("EMPTY_RESPONSE");

  const candidates = array(data.roomItems).map(record).flatMap(room =>
    array(room.products).map(record)
      .filter(product => number(product.bookType) === 1)
      .filter(product => options.paymentType !== "prepaid" || number(product.payAtHotelFlag) !== 1)
      .filter(product => options.paymentType !== "payAtHotel" || number(product.payAtHotelFlag) === 1)
      .filter(product => number(room.roomId) > 0 && string(product.ratePlanId) && string(product.supplyCode))
      .map(product => ({ room, product })),
  );
  if (!candidates.length) throw new GlinkNoProductError("NO_BOOKABLE_PRODUCT");

  const unique = new Map<string, { room: JsonRecord; product: JsonRecord }>();
  for (const candidate of candidates) {
    const key = [
      number(candidate.room.roomId),
      string(candidate.product.ratePlanId),
      string(candidate.product.supplyCode),
      string(candidate.product.bedType),
      number(candidate.product.payAtHotelFlag),
      number(candidate.product.totalSalePrice),
    ].join("|");
    if (!unique.has(key)) unique.set(key, candidate);
  }
  return [...unique.values()]
    .map(({ room, product }) => mapGlinkProduct(quote, room, product))
    .sort((left, right) => left.offer.totalPrice! - right.offer.totalPrice!);
}

export async function hydrateGlinkProduct(
  client: FcgClient,
  quote: HotelQuoteContext,
  options: { paymentType?: "prepaid" | "payAtHotel"; language?: "zh-CN" | "en-US" } = {},
) {
  return (await hydrateGlinkProducts(client, quote, options))[0];
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
    language: quote.language ?? "en-US",
  }));
  if (number(data.canBook) !== 1) throw new Error("实时验房失败：当前房型不可预订");
  return data;
}

export function synchronizeHotelQuoteFromAvailability(
  quote: HotelQuoteContext,
  availability: JsonRecord,
): HotelQuoteContext {
  const total = number(availability.totalSalePrice, quote.priceBreakdown?.total || 0);
  const currency = string(availability.currency, quote.currency);
  const availabilityBed = productBedDescription(availability);
  const instructions = productSpecialInstructions(availability);
  const cancelRestrictionType = optionalNumber(availability.cancelRestrictionType)
    ?? quote.cancelRestrictionType;
  const priceBreakdown = productPriceBreakdown(availability, currency, total);
  return {
    ...quote,
    currency,
    ...(availabilityBed ? { bedTypeDescription: availabilityBed } : {}),
    ...(string(availability.bedType) ? { bedType: string(availability.bedType) } : {}),
    ...(optionalNumber(availability.payAtHotelFee) !== undefined
      ? { payAtHotelFee: optionalNumber(availability.payAtHotelFee) }
      : {}),
    ...(string(availability.payAtHotelFeeCurrency)
      ? { payAtHotelFeeCurrency: string(availability.payAtHotelFeeCurrency) }
      : {}),
    ...(cancelRestrictionType !== undefined ? { cancelRestrictionType } : {}),
    ...(cancelRestrictionType !== undefined ? { nonRefundable: cancelRestrictionType === 1 } : {}),
    ...(cancellationDescription(availability) ? { cancelPolicy: cancellationDescription(availability) } : {}),
    specialCheckInInstructions: [...(quote.specialCheckInInstructions || []), ...instructions]
      .filter((value, index, all) => all.indexOf(value) === index),
    priceBreakdown: {
      ...quote.priceBreakdown,
      ...priceBreakdown,
      ...(priceBreakdown.chargesDueAtProperty === undefined && quote.payAtHotelFee !== undefined
        ? { chargesDueAtProperty: quote.payAtHotelFee }
        : {}),
      ...(priceBreakdown.chargesDueAtPropertyCurrency === undefined && quote.payAtHotelFeeCurrency
        ? { chargesDueAtPropertyCurrency: quote.payAtHotelFeeCurrency }
        : {}),
    },
  };
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
    journeys?: Array<{
      origin: string;
      destination: string;
      date: string;
      originType?: 1 | 2;
      destinationType?: 1 | 2;
    }>;
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
      originType: journey.originType ?? 1,
      destinationType: journey.destinationType ?? 1,
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
      const priceKey = string(rawOffer.priceKey);
      const currency = string(rawOffer.currency).toUpperCase();
      const totalAmount = number(rawOffer.totalSalePrice, passengerTotal || price * input.adults);
      if (!priceKey || !currency || price <= 0 || totalAmount <= 0) continue;
      const airlineCode = string(firstJourney.first.airlineCode, string(rawOffer.ticketingAirline));
      const airline = string(firstJourney.first.airlineName, string(rawOffer.ticketingAirline));
      const flightNo = journeySummaries.map(journey => journey.flightNo).filter(Boolean).join(" / ");
      const cabin = array(rawOffer.cabinClass).map(value => string(value)).filter(Boolean).join("/");
      const baggageDescription = baggage.weight
        ? `${number(baggage.number, 1)}件${number(baggage.weight)}${string(baggage.unit, "KG")}`
        : "";
      const title = tripType === 2
        ? `${firstJourney.origin} ↔ ${firstJourney.destination}`
        : journeySummaries.map(journey => journey.origin).concat(lastJourney.destination).join(" → ");
      const subtitle = `${journeySummaries.map(journey => journey.flightNo).filter(Boolean).join(" / ")} · ${journeySummaries.map(journey => journey.date).join(" / ")}`;
      const quote: FlightQuoteContext = {
        id,
        priceKey,
        from: input.from,
        to: input.to,
        departureDate: input.departureDate,
        adultNum: input.adults,
        childNum: input.children || 0,
        infantNum: input.infants || 0,
        totalAmount,
        currency,
        title,
        subtitle,
        tripType,
        journeys: requestedJourneys,
        airline,
        airlineCode,
        flightNo,
        cabin,
        baggage: baggageDescription,
      };
      quotes.push(quote);
      offers.push({
        id,
        airline: quote.airline || "上游未返回航司名称",
        airlineCode: quote.airlineCode || "",
        flightNo: quote.flightNo || "",
        departureAirport: `${firstJourney.origin} ${string(firstJourney.first.departureAirportName)}${string(firstJourney.first.departureTerminal)}`.trim(),
        arrivalAirport: `${firstJourney.destination} ${string(firstJourney.last.arrivalAirportName)}${string(firstJourney.last.arrivalTerminal)}`.trim(),
        departureTime: firstJourney.departureTime,
        arrivalTime: firstJourney.arrivalTime,
        duration: firstJourney.duration,
        stops: firstJourney.stops,
        cabin: quote.cabin || "上游未返回舱等",
        baggage: quote.baggage || "上游未返回托运行李额度",
        price,
        totalPrice: totalAmount,
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
      currency: string(offer.currency).toUpperCase(),
    })).filter(offer => offer.priceKey && offer.currency && offer.price > 0);
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

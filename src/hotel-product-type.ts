import type { HotelOffer } from "./types.js";

export const HOTEL_PRODUCT_TYPE_TITLES = {
  ROOM_ONLY: "Room Only",
  BREAKFAST: "Breakfast",
  FREE_CANCELLATION: "Free Cancellation",
  BREAKFAST_AND_FREE_CANCELLATION: "Breakfast and Free Cancellation",
} as const;

export type HotelProductType = keyof typeof HOTEL_PRODUCT_TYPE_TITLES;

const breakfastIncludedFromText = (value: string) => {
  const text = value.trim();
  if (!text || /(no breakfast|without breakfast|breakfast not included|room only|无早|無早|不含早|不含早餐|不含早餐)/i.test(text)) return false;
  return /(breakfast|含早|早餐|早)/i.test(text);
};

const freeCancellationFromText = (value: string) =>
  /(free cancellation|free cancel|可免费取消|可免費取消|免费取消|免費取消|限时免费取消|限時免費取消)/i.test(value);

export function resolveHotelProductType(product: Pick<HotelOffer,
  "breakfast" | "breakfastIncluded" | "cancelPolicy" | "cancelRestrictionType" | "freeCancellation" | "nonRefundable"
>): HotelProductType {
  const hasBreakfast = product.breakfastIncluded ?? breakfastIncludedFromText(product.breakfast);
  const hasFreeCancellation = product.freeCancellation
    ?? (product.cancelRestrictionType !== undefined
      ? [2, 3, 4].includes(product.cancelRestrictionType)
      : product.nonRefundable === true ? false : freeCancellationFromText(product.cancelPolicy));
  if (hasBreakfast && hasFreeCancellation) return "BREAKFAST_AND_FREE_CANCELLATION";
  if (hasBreakfast) return "BREAKFAST";
  if (hasFreeCancellation) return "FREE_CANCELLATION";
  return "ROOM_ONLY";
}

export const hotelProductTypeTitle = (product: Parameters<typeof resolveHotelProductType>[0]) =>
  HOTEL_PRODUCT_TYPE_TITLES[resolveHotelProductType(product)];

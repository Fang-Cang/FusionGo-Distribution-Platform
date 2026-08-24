import { describe, expect, it } from "vitest";
import { hotelProductTypeTitle, resolveHotelProductType } from "../src/hotel-product-type.js";

describe("hotel product type title", () => {
  it.each([
    [{ breakfast: "No breakfast", breakfastIncluded: false, cancelPolicy: "Non-refundable", cancelRestrictionType: 1, freeCancellation: false, nonRefundable: true }, "ROOM_ONLY", "Room Only"],
    [{ breakfast: "Breakfast for 2", breakfastIncluded: true, cancelPolicy: "Non-refundable", cancelRestrictionType: 1, freeCancellation: false, nonRefundable: true }, "BREAKFAST", "Breakfast"],
    [{ breakfast: "No breakfast", breakfastIncluded: false, cancelPolicy: "Free until 18:00", cancelRestrictionType: 2, freeCancellation: true, nonRefundable: false }, "FREE_CANCELLATION", "Free Cancellation"],
    [{ breakfast: "双早", breakfastIncluded: true, cancelPolicy: "可免费取消", cancelRestrictionType: 4, freeCancellation: true, nonRefundable: false }, "BREAKFAST_AND_FREE_CANCELLATION", "Breakfast and Free Cancellation"],
  ] as const)("maps product facts to %s", (product, type, title) => {
    expect(resolveHotelProductType(product)).toBe(type);
    expect(hotelProductTypeTitle(product)).toBe(title);
  });
});

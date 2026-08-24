import { describe, expect, it } from "vitest";
import { findFavoriteHotel, isSameHotel } from "../src/hotel-favorite.js";

describe("hotel favorite identity", () => {
  it("matches refreshed quotes by stable supplier hotel ID", () => {
    const saved = { id: "GH-100-old", hotelId: 100, name: "Example Hotel", city: "Shanghai" };
    const refreshed = { id: "GH-100-new", hotelId: "100", name: "Example Hotel EN", city: "Shanghai" };
    expect(isSameHotel(saved, refreshed)).toBe(true);
    expect(findFavoriteHotel([saved], refreshed)).toBe(saved);
  });

  it("matches historical snapshots without hotelId by normalized name and city", () => {
    const saved = { id: "old-quote", name: "Holiday Inn Shanghai Hongqiao Central", city: "Shanghai" };
    const refreshed = { id: "new-quote", hotelId: 10583772, name: "Holiday Inn Shanghai Hongqiao Central", city: "Shanghai" };
    expect(isSameHotel(saved, refreshed)).toBe(true);
  });

  it("does not merge different supplier hotel IDs", () => {
    expect(isSameHotel(
      { id: "one", hotelId: 100, name: "Same Name", city: "Shanghai" },
      { id: "two", hotelId: 200, name: "Same Name", city: "Shanghai" },
    )).toBe(false);
  });
});

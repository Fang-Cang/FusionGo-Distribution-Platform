import { describe, expect, it } from "vitest";
import { resolveHotelDateRangeSelection } from "../src/hotel-date-range.js";

describe("hotel date range selection", () => {
  it("completes the stay when the second date is later", () => {
    expect(resolveHotelDateRangeSelection("2026-08-12", "2026-08-15")).toEqual({
      checkIn: "2026-08-12",
      checkOut: "2026-08-15",
      complete: true,
    });
  });

  it("restarts from the latest selection when the second date is earlier", () => {
    expect(resolveHotelDateRangeSelection("2026-08-12", "2026-08-10")).toEqual({
      checkIn: "2026-08-10",
      checkOut: "",
      complete: false,
    });
  });

  it("requires another date when the same date is selected twice", () => {
    expect(resolveHotelDateRangeSelection("2026-08-12", "2026-08-12")).toEqual({
      checkIn: "2026-08-12",
      checkOut: "",
      complete: false,
    });
  });
});

import { describe, expect, it } from "vitest";
import { buildHotelCancellationPolicy, buildHotelCancellationSummary } from "../src/hotel-cancellation-policy.js";

describe("hotel cancellation policy rendering", () => {
  it("reduces list summaries to non-refundable or a clickable free-cancellation deadline", () => {
    expect(buildHotelCancellationSummary({ cancelRestrictionType: 1, cancelPenalties: [] }, "en", "2026-09-06")).toEqual({
      kind: "non-refundable", text: "Non-refundable", clickable: false,
    });
    expect(buildHotelCancellationSummary({ cancelRestrictionType: 3, cancelRestrictionDay: 1, cancelRestrictionTime: "1200", cancelPenalties: [] }, "en", "2026-09-06")).toEqual({
      kind: "limited-free-cancellation", text: "Free Cancellation before 12:00, Sep 5", clickable: true,
    });
  });

  it("renders a non-refundable policy in both languages", () => {
    const details = { cancelRestrictionType: 1, cancelPenalties: [] };
    expect(buildHotelCancellationPolicy(details, "zh-CN").lines[0]).toBe("如果修改、取消订单，将无法获得退款。");
    expect(buildHotelCancellationPolicy(details, "en").lines[0]).toContain("will not get a refund");
  });

  it("localizes a mismatched upstream fallback instead of leaking Chinese into English", () => {
    expect(buildHotelCancellationPolicy(undefined, "en", "2026-08-24", "2026-08-23 18:00:00 后不可取消或更改").lines[0])
      .toBe("Cancellation is not permitted after 18:00, Aug 23, 2026.");
  });

  it("derives the free-cancellation cutoff from check-in day, day offset and HHmm time", () => {
    const details = { cancelRestrictionType: 3, cancelRestrictionDay: 7, cancelRestrictionTime: "1200", cancelPenalties: [] };
    const zh = buildHotelCancellationPolicy(details, "zh-CN", "2024-06-03");
    expect(zh.timeline).toBe("full-to-none");
    expect(zh.lines).toEqual([
      "2024年5月27日12:00前取消订单，可全额退款。",
      "2024年5月27日12:00后取消订单，将收取全部房费。",
    ]);
    expect(buildHotelCancellationPolicy(details, "en", "2024-06-03").lines[0]).toContain("12:00, May 27, 2024");
  });

  it("renders first-night, fixed-value and percentage penalties from the structured array", () => {
    const base = { startDate: "2022-08-26T23:59:00.000+07:00", endDate: "2022-08-29T22:59:00.000+07:00" };
    const policy = buildHotelCancellationPolicy({ cancelRestrictionType: 2, cancelPenalties: [
      { ...base, penaltiesType: 1, penaltiesValue: "1", currency: "USD" },
      { ...base, penaltiesType: 2, penaltiesValue: "50", currency: "USD" },
      { ...base, penaltiesType: 3, penaltiesValue: "10%", currency: "USD" },
    ] }, "zh-CN", "2022-08-30");
    expect(policy.timeline).toBe("full-to-penalty");
    expect(policy.lines[0]).toContain("首晚房费加税费");
    expect(policy.lines[1]).toContain("USD 50");
    expect(policy.lines[2]).toContain("10%订单费用");
  });
});

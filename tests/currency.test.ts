import { describe, expect, it } from "vitest";
import { convertDisplayAmount, formatDisplayAmount } from "../src/currency.js";
import type { DisplayFxRates } from "../src/types.js";

const fx: DisplayFxRates = {
  base: "CNY",
  date: "2026-08-05",
  source: "Frankfurter",
  fetchedAt: "2026-08-05T09:00:00.000Z",
  rates: { CNY: 1, USD: 0.14816, HKD: 1.163, SGD: 0.19004 },
};

describe("display currency conversion", () => {
  it("converts supplier currencies through the CNY base table", () => {
    expect(convertDisplayAmount(100, "CNY", "USD", fx)).toBeCloseTo(14.816);
    expect(convertDisplayAmount(100, "USD", "CNY", fx)).toBeCloseTo(674.946);
    expect(convertDisplayAmount(100, "USD", "HKD", fx)).toBeCloseTo(784.962);
  });

  it("marks converted display values and leaves original currency when rates are unavailable", () => {
    expect(formatDisplayAmount(100, "CNY", "USD", fx)).toMatch(/^≈US\$/);
    expect(formatDisplayAmount(100, "USD", "USD", fx)).toBe("US$100");
    expect(formatDisplayAmount(100, "EUR", "USD", fx)).toBe("€100");
  });
});

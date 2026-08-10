import { afterEach, describe, expect, it, vi } from "vitest";
import { clearDisplayFxCache, getDisplayFxRates } from "../server/fx.js";

afterEach(() => clearDisplayFxCache());

describe("display FX service", () => {
  it("accepts a complete CNY reference-rate response", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify([
      { date: "2026-08-05", base: "CNY", quote: "USD", rate: 0.14816 },
      { date: "2026-08-05", base: "CNY", quote: "HKD", rate: 1.163 },
      { date: "2026-08-05", base: "CNY", quote: "SGD", rate: 0.19004 },
    ]), { status: 200 }));

    const result = await getDisplayFxRates(fetcher);
    expect(result).toMatchObject({ base: "CNY", date: "2026-08-05", source: "Frankfurter" });
    expect(result.rates).toEqual({ CNY: 1, USD: 0.14816, HKD: 1.163, SGD: 0.19004 });
  });

  it("rejects incomplete rate data instead of fabricating a conversion", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify([
      { date: "2026-08-05", base: "CNY", quote: "USD", rate: 0.14816 },
    ]), { status: 200 }));
    await expect(getDisplayFxRates(fetcher)).rejects.toThrow("missing required currencies");
  });
});

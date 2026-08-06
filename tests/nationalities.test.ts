import { describe, expect, it } from "vitest";
import { normalizeFlinkNationalities } from "../server/fcg/adapters.js";
import {
  ISO_3166_ALPHA_2_CODES,
  isoNationalityOptions,
  mergeSupplierNationalities,
} from "../server/reference/nationalities.js";

describe("nationality reference catalogue", () => {
  it("contains every officially assigned ISO 3166 alpha-2 code exactly once", () => {
    expect(ISO_3166_ALPHA_2_CODES).toHaveLength(249);
    expect(new Set(ISO_3166_ALPHA_2_CODES).size).toBe(249);
    expect(ISO_3166_ALPHA_2_CODES).toEqual(expect.arrayContaining(["CN", "HK", "SG", "TH", "US", "GB", "AQ"]));
    const options = isoNationalityOptions();
    expect(options).toHaveLength(249);
    expect(options.find(item => item.code === "CN")).toMatchObject({
      nameZh: "中国",
      nameEn: "China",
      source: "iso-3166",
    });
  });

  it("normalizes the documented F-Link response and retains the complete ISO fallback", () => {
    const supplier = normalizeFlinkNationalities([
      { code: "CN", name: "中国", tname: "中國", ename: "China", region: "86" },
      { code: "SG", name: "新加坡", tname: "新加坡", ename: "Singapore", region: "65" },
      { code: "", name: "invalid" },
    ]);
    expect(supplier).toHaveLength(2);
    expect(supplier[0]).toMatchObject({ code: "CN", nameZh: "中国", nameZhTw: "中國", nameEn: "China", dialingCode: "86" });
    const merged = mergeSupplierNationalities(supplier);
    expect(merged.length).toBeGreaterThanOrEqual(249);
    expect(merged.find(item => item.code === "CN")?.source).toBe("flink");
    expect(merged.find(item => item.code === "US")?.source).toBe("iso-3166");
  });
});

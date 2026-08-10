import { describe, expect, it } from "vitest";
import { createOrderDocumentPdf } from "../server/order-document.js";

describe("electronic order PDF", () => {
  it("renders a hotel confirmation from order snapshots", async () => {
    const pdf = await createOrderDocumentPdf({
      order: {
        id: "FG-REAL-001",
        productType: "hotel",
        supplierOrderNo: "H36-REAL-001",
        title: "深圳测试酒店",
        subtitle: "2026-08-27 至 2026-08-28 · 1间",
        customer: "寥宇旅行",
        amount: 56,
        currency: "USD",
        status: "CONFIRMED",
        createdAt: "08/27 18:00",
      },
      type: "confirmation",
      snapshots: {
        product: {
          checkInDate: "2026-08-27",
          checkOutDate: "2026-08-28",
          nights: 1,
          roomNum: 1,
          numberOfAdults: 2,
          roomName: "Deluxe King Room",
          ratePlanName: "Flexible",
          breakfast: "含双早",
          cancelPolicy: "以供应商实时政策为准",
        },
        contact: {
          guests: [{ roomIndex: 1, lastName: "TIANYE", firstName: "TEST" }],
          contact: { name: "TIANYE TEST", phone: "13800008866", email: "lin@example.com" },
        },
      },
    });

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(10_000);
    expect(pdf.toString("latin1")).toContain("/Title");
  }, 30_000);
});

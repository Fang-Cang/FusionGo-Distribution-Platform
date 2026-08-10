import { describe, expect, it } from "vitest";
import { createHotelConfirmationEmailHtml } from "../server/order-email.js";

describe("EPS hotel confirmation email", () => {
  it("contains real itinerary IDs, room facts, instructions, support and price breakdown", () => {
    const html = createHotelConfirmationEmailHtml({
      order: {
        id: "FG-REAL-001",
        productType: "hotel",
        supplierOrderNo: "GLINK-REAL-001",
        title: "深圳真实酒店",
        subtitle: "2026-09-01 至 2026-09-02 · 1间",
        customer: "企业客户",
        amount: 210,
        currency: "CNY",
        status: "CONFIRMED",
        createdAt: "刚刚",
      },
      snapshots: {
        product: {
          checkInDate: "2026-09-01",
          checkOutDate: "2026-09-02",
          roomName: "真实豪华房",
          bedTypeDescription: "1张 King Bed",
          nonRefundable: true,
          cancelPolicy: "不可取消、不可更改",
          checkInInstructions: "办理入住：15:00–23:00",
          specialCheckInInstructions: ["请携带护照原件"],
          priceBreakdown: {
            roomSubtotal: 180,
            taxFee: 20,
            serviceFee: 10,
            chargesDueAtProperty: 30,
            chargesDueAtPropertyCurrency: "THB",
            total: 210,
            currency: "CNY",
          },
        },
        contact: {
          guests: [{ lastName: "LIN", firstName: "JIACHENG" }],
          contact: { name: "LIN JIACHENG", email: "traveler@example.com", phone: "13800008866" },
        },
      },
      publicAppUrl: "https://fusiongo.example.com",
      supportUrl: "https://support.example.com",
      supportEmail: "support@example.com",
    });

    for (const expected of [
      "FG-REAL-001", "GLINK-REAL-001", "1张 King Bed", "Non-refundable", "请携带护照原件",
      "Room Subtotal", "Taxes &amp; Fees", "Charges at Property", "FusionGo Customer Support", "https://support.example.com",
    ]) expect(html).toContain(expected);
    expect(html).not.toContain("1284");
  });
});

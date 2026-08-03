import { describe, expect, it } from "vitest";
import {
  applyFlinkChange,
  applyFlinkRefund,
  cancelFlinkChange,
  confirmFlinkRefund,
  getFlinkChangeDetail,
  getFlinkOrderAfterSalesSource,
  getFlinkRefundDetail,
  payFlinkChange,
  searchFlinkChangeOffers,
} from "../server/fcg/adapters.js";
import type { FcgClient } from "../server/fcg/client.js";

function stubClient(responses: Record<string, unknown>) {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const client = {
    async flink(_lang: string, path: string, body: Record<string, unknown>) {
      calls.push({ path, body });
      return structuredClone(responses[path]);
    },
  } as unknown as FcgClient;
  return { client, calls };
}

describe("F-Link after-sales contract", () => {
  it("extracts supplier passengerCode and segmentId from ticketed order detail", async () => {
    const { client } = stubClient({
      "/flight/order/detail": {
        status: 8,
        passenger: [{ passengerCode: "passenger-bridge", name: "TEST/SANDBOX" }],
        journeys: [{ airSegmentList: [{
          segmentId: "20260806-SIN-BKK-SQ706",
          departureAirport: "SIN",
          arrivalAirport: "BKK",
          departureDate: "2026-08-06",
          flightNumber: "SQ706",
        }] }],
      },
    });
    await expect(getFlinkOrderAfterSalesSource(client, "dd-order")).resolves.toMatchObject({
      supplierStatus: 8,
      passengers: [{ passengerCode: "passenger-bridge" }],
      segments: [{ segmentId: "20260806-SIN-BKK-SQ706" }],
    });
  });

  it("preserves bridge identifiers through change search, apply, pay, detail and cancel", async () => {
    const { client, calls } = stubClient({
      "/flight/change/search": {
        segments: {
          segmentNew: {
            airlineName: "Singapore Airlines",
            departureTime: "10:00",
            arrivalTime: "12:30",
            flightDuration: "2h30m",
            flightNumber: "SQ708",
          },
        },
        flight: [{
          journeys: [{ airSegmentList: ["segmentNew"], flightNumberList: ["SQ708"], journeysTime: "2h30m" }],
          offerPriceList: [{ priceKey: "change-price-key", totalSalePrice: 380, currency: "CNY" }],
        }],
      },
      "/flight/change/apply": { changeOrderNo: "ch-order", status: 0 },
      "/flight/order/pay": { payStatus: 1 },
      "/flight/change/detail": { changeOrderNo: "ch-order", status: 4, priceTotal: 380 },
      "/flight/change/cancel": {},
    });
    const offers = await searchFlinkChangeOffers(client, {
      orderNo: "dd-order",
      cabinClass: "economy",
      date: "2026-08-07",
      passengerCode: "passenger-bridge",
      segmentId: "segment-bridge",
    });
    expect(offers[0]).toMatchObject({ priceKey: "change-price-key", price: 380 });
    await applyFlinkChange(client, {
      orderNo: "dd-order",
      passengerCode: "passenger-bridge",
      segmentId: "segment-bridge",
      priceKey: "change-price-key",
      changeType: 1,
      contactName: "TEST",
      contactPhone: "13800008866",
      contactEmail: "test@example.com",
      reason: "schedule changed",
    });
    await payFlinkChange(client, { changeOrderNo: "ch-order", amount: 380 });
    await getFlinkChangeDetail(client, "ch-order");
    await cancelFlinkChange(client, "ch-order");
    expect(calls[0]).toMatchObject({
      path: "/flight/change/search",
      body: { orderNo: "dd-order", passenger: "passenger-bridge", segmentId: "segment-bridge" },
    });
    expect(calls[1]).toMatchObject({
      path: "/flight/change/apply",
      body: {
        orderNo: "dd-order",
        passenger: "passenger-bridge",
        segmentId: "segment-bridge",
        priceKey: "change-price-key",
        changeOrderType: 1,
      },
    });
    expect(calls[2]).toMatchObject({ path: "/flight/order/pay", body: { orderNo: "ch-order", amount: 380, type: 1 } });
    expect(calls[3]).toMatchObject({ path: "/flight/change/detail", body: { changeOrderNo: "ch-order" } });
    expect(calls[4]).toMatchObject({ path: "/flight/change/cancel", body: { changeOrderNo: "ch-order" } });
  });

  it("preserves bridge identifiers through refund apply, confirm and detail", async () => {
    const { client, calls } = stubClient({
      "/flight/refund/apply": { refundOrderNo: "rf-order", status: 0 },
      "/flight/refund/confirm": {},
      "/flight/refund/detail": { refundOrderNo: "rf-order", status: 4, refundMoney: 600 },
    });
    await applyFlinkRefund(client, {
      orderNo: "dd-order",
      passengerCode: "passenger-bridge",
      segmentId: "segment-bridge",
      refundType: 1,
      reason: "trip cancelled",
      contactName: "TEST",
      contactPhone: "13800008866",
      contactEmail: "test@example.com",
    });
    await confirmFlinkRefund(client, { refundOrderNo: "rf-order", confirm: "1" });
    await getFlinkRefundDetail(client, "rf-order");
    expect(calls[0]).toMatchObject({
      path: "/flight/refund/apply",
      body: {
        orderNo: "dd-order",
        orderType: 1,
        passenger: "passenger-bridge",
        segmentId: "segment-bridge",
        refundType: 1,
        fileList: [],
      },
    });
    expect(calls[1]).toMatchObject({ path: "/flight/refund/confirm", body: { refundOrderNo: "rf-order", confirm: "1" } });
    expect(calls[2]).toMatchObject({ path: "/flight/refund/detail", body: { refundOrderNo: "rf-order" } });
  });
});

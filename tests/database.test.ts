import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FusionDatabase } from "../server/database.js";
import type { DistributionOrder } from "../src/types.js";

const tempDirectories: string[] = [];

afterEach(() => {
  tempDirectories.splice(0).forEach(directory =>
    rmSync(directory, { recursive: true, force: true }));
});

describe("FusionDatabase persistence", () => {
  it("migrates, seeds and keeps order state after reopening the database", () => {
    const directory = mkdtempSync(join(tmpdir(), "fusiongo-db-"));
    tempDirectories.push(directory);
    const path = join(directory, "integration.sqlite");

    const first = new FusionDatabase(path);
    first.seed();
    const hotel = first.findHotel("HTL-SHA-001")!;
    first.saveHotelAvailability(hotel);
    const order: DistributionOrder = {
      id: first.nextOrderId(),
      productType: "hotel",
      title: hotel.name,
      subtitle: "2晚",
      customer: "数据库测试客户",
      amount: hotel.nightlyPrice * 2,
      currency: hotel.currency,
      status: "PENDING_PAYMENT",
      createdAt: "刚刚",
    };
    first.insertOrder({
      order,
      supplier: "GLINK",
      userId: "test-user",
      productSnapshot: hotel,
      contactSnapshot: { name: "TEST USER" },
    });
    first.updateOrder(order.id, { status: "PROCESSING" }, "PAYMENT_ACCEPTED");
    first.updateAccountProfile({
      name: "头像测试用户",
      language: "en",
      phone: "138******66",
      email: "a****@***********",
    });
    first.saveAccountAvatar(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), "image/png");
    first.updateNotificationPreferences({ order: false, flight: true, marketing: true });
    const traveler = first.createAccountTraveler({
      type: "adult",
      surname: "CHEN",
      givenName: "MING",
      gender: "1",
      birthday: "1988-03-02",
      nationality: "CN",
      documentNo: "P99887766",
      issuingCountry: "CN",
      expiration: "2032-03-01",
    });
    first.updateAccountTraveler(traveler.id, {
      type: "adult",
      surname: "CHEN",
      givenName: "MINGYU",
      gender: "1",
      birthday: "1988-03-02",
      nationality: "CN",
      issuingCountry: "CN",
      expiration: "2032-03-01",
    });
    first.close();

    expect(readFileSync(path).includes(Buffer.from("P99887766"))).toBe(false);

    const reopened = new FusionDatabase(path);
    expect(reopened.findOrder(order.id, "test-user")?.status).toBe("PROCESSING");
    expect(reopened.listOrderEvents(order.id).map(event => event.eventType))
      .toEqual(["ORDER_CREATED", "PAYMENT_ACCEPTED"]);
    expect(reopened.getAccountProfile()).toMatchObject({
      name: "头像测试用户",
      language: "en",
      avatarMime: "image/png",
    });
    expect(reopened.getAccountAvatar().avatar_blob).toHaveLength(8);
    expect(reopened.getNotificationPreferences()).toMatchObject({ order: false, flight: true, marketing: true });
    expect(reopened.listAccountTravelers().find(item => item.id === traveler.id)).toMatchObject({
      surname: "CHEN",
      givenName: "MINGYU",
      documentNo: "P9•••••66",
    });
    expect(reopened.status().migrationVersion).toBe(11);
    reopened.close();
  });

  it("returns no hotels when a destination has no matching local test data", () => {
    const database = new FusionDatabase(":memory:");
    database.seed(true);
    expect(database.listHotels("上海")).toHaveLength(3);
    expect(database.listHotels("深圳")).toEqual([]);
    database.close();
  });
});

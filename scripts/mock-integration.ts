import type { AddressInfo } from "node:net";
import type { DistributionOrder, FlightOffer, HotelOffer } from "../src/types.js";

process.env.FCG_MODE = "mock";
process.env.FCG_ENV = "mock";
process.env.DATABASE_PATH ||= ".data/fusiongo-mock.sqlite";

const { app, database } = await import("../server/index.js");
if (process.argv.includes("--reset")) database.resetAndSeed();

let baseUrl = "";
const server = await new Promise<ReturnType<typeof app.listen>>(resolve => {
  const running = app.listen(0, "127.0.0.1", () => {
    const address = running.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
    resolve(running);
  });
});

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await response.json() as {
    code: string;
    message: string;
    data: T;
  };
  if (!response.ok || body.code !== "SUCCESS") {
    throw new Error(`${path}: ${body.code} ${body.message}`);
  }
  return body.data;
}

const post = <T>(path: string, data?: unknown) => request<T>(path, {
  method: "POST",
  body: data === undefined ? undefined : JSON.stringify(data),
});

try {
  const hotel = (await post<HotelOffer[]>("/api/hotels/search", {
    destination: "上海",
    checkIn: "2026-08-12",
    checkOut: "2026-08-14",
  }))[0];
  await post("/api/hotels/product-details", { offerId: hotel.id });
  await post("/api/hotels/availability", { offerId: hotel.id });
  const hotelOrder = await post<DistributionOrder>("/api/orders", {
    productType: "hotel",
    offerId: hotel.id,
    guest: { firstName: "JIACHENG", lastName: "LIN" },
    contact: { name: "林嘉诚", phone: "13800008866", email: "lin@example.com" },
    arriveTime: "18:00",
    latestArriveTime: "20:00",
  });
  const paidHotel = await post<DistributionOrder>(`/api/orders/${hotelOrder.id}/pay`);
  const confirmedHotel = await post<DistributionOrder>(`/api/orders/${hotelOrder.id}/refresh`);

  const flight = (await post<FlightOffer[]>("/api/flights/search", {
    from: "SHA",
    to: "HKG",
    departureDate: "2026-08-12",
    adults: 1,
  }))[0];
  await post("/api/flights/verify", {
    offerId: flight.id,
    priceKey: flight.priceKey,
    quantity: 1,
  });
  const flightOrder = await post<DistributionOrder>("/api/orders", {
    productType: "flight",
    offerId: flight.id,
    quantity: 1,
    contact: { name: "LIN/JIACHENG", phone: "13800008866", email: "lin@example.com" },
    passengers: [{
      surname: "LIN",
      name: "JIACHENG",
      nationality: "CN",
      gender: "1",
      idType: "2",
      idNumber: "E12345678",
      birthday: "1990-06-18",
      expiration: "2031-08-20",
    }],
  });
  const paidFlight = await post<DistributionOrder>(`/api/orders/${flightOrder.id}/pay`);
  const ticketedFlight = await post<DistributionOrder>(`/api/orders/${flightOrder.id}/refresh`);

  const hotelHistory = await request<Array<{ eventType: string }>>(
    `/api/orders/${hotelOrder.id}/history`,
  );
  const flightHistory = await request<Array<{ eventType: string }>>(
    `/api/orders/${flightOrder.id}/history`,
  );

  console.log(JSON.stringify({
    ok: true,
    environment: "mock",
    hotel: {
      orderId: confirmedHotel.id,
      supplierOrderNo: paidHotel.supplierOrderNo,
      status: confirmedHotel.status,
      events: hotelHistory.map(event => event.eventType),
    },
    flight: {
      orderId: ticketedFlight.id,
      supplierOrderNo: paidFlight.supplierOrderNo,
      status: ticketedFlight.status,
      events: flightHistory.map(event => event.eventType),
    },
    database: database.status(),
  }, null, 2));
} finally {
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
  database.close();
}

import "dotenv/config";

type Envelope<T> = {
  code: string;
  message: string;
  data: T;
};

type FlightOffer = {
  id: string;
  priceKey: string;
  flightNo: string;
  price: number;
  currency: string;
};

type Order = {
  id: string;
  supplierOrderNo?: string;
  status: string;
  amount: number;
  currency: string;
};

const confirmed = process.argv.includes("--confirm-sandbox-orders");
const skipCancelOrder = process.argv.includes("--skip-cancel-order");
const argumentValue = (name: string) =>
  process.argv.find(argument => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
const requestedFrom = argumentValue("from")?.trim().toUpperCase();
const requestedTo = argumentValue("to")?.trim().toUpperCase();
const baseUrl = (process.env.API_BASE_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const dateAfter = (days: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

async function request<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json() as Envelope<T>;
  if (!response.ok || body.code !== "SUCCESS") {
    throw new Error(`${path}: ${body.code} ${body.message}`);
  }
  return { response, data: body.data };
}

const post = <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
  request<T>(path, {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const integration = await request<{
  mode: string;
  environment: string;
  flinkConfigured: boolean;
}>("/api/integration/status");
if (integration.data.mode !== "sandbox" || integration.data.environment !== "sandbox") {
  throw new Error("Application F-Link acceptance only runs in the sandbox environment");
}
if (!integration.data.flinkConfigured) throw new Error("Application API has no F-Link sandbox credentials");

if ((requestedFrom && !requestedTo) || (!requestedFrom && requestedTo)) {
  throw new Error("Use --from and --to together when selecting an exact F-Link route");
}

const candidates = requestedFrom && requestedTo
  ? [{ from: requestedFrom, to: requestedTo }]
  : [
      { from: "WUH", to: "HKG" },
      { from: "HKG", to: "BKK" },
      { from: "HKG", to: "SIN" },
      { from: "SHA", to: "HKG" },
    ];
const dates = (requestedFrom ? [7, 14, 21, 30, 45, 60] : [21, 30, 45]).map(dateAfter);
const probes: Array<{
  route: string;
  departureDate: string;
  offers?: number;
  error?: string;
}> = [];
let route: { from: string; to: string } | undefined;
let departureDate = "";
let search: Awaited<ReturnType<typeof post<FlightOffer[]>>> | undefined;
for (const candidate of candidates) {
  for (const date of dates) {
    try {
      const result = await post<FlightOffer[]>("/api/flights/search", {
        ...candidate,
        departureDate: date,
        adults: 1,
      });
      probes.push({
        route: `${candidate.from}-${candidate.to}`,
        departureDate: date,
        offers: result.data.length,
      });
      if (!result.data.length) continue;
      route = candidate;
      departureDate = date;
      search = result;
      break;
    } catch (error) {
      probes.push({
        route: `${candidate.from}-${candidate.to}`,
        departureDate: date,
        error: error instanceof Error ? error.message : String(error),
      });
      // Sandbox product data can reject unsupported airports; probe the next candidate.
    }
  }
  if (search) break;
}
if (!route || !search) {
  console.log(JSON.stringify({ stage: "search-probes", probes }, null, 2));
  throw new Error(`No F-Link sandbox offer found for ${candidates
    .map(candidate => `${candidate.from}-${candidate.to}`)
    .join(", ")} on ${dates.join(", ")}`);
}

let selected: FlightOffer | undefined;
type Verification = { totalAmount: number; currency: string; priceKey: string };
let verified: Verification | undefined;
const verifyErrors: string[] = [];
for (const offer of search.data.slice(0, 60)) {
  try {
    const result = await post<Verification>("/api/flights/verify", {
      offerId: offer.id,
      priceKey: offer.priceKey,
      quantity: 1,
    });
    selected = offer;
    verified = result.data;
    break;
  } catch (error) {
    verifyErrors.push(error instanceof Error ? error.message : String(error));
    // A search result can expire between search and verify; try the next priceKey.
  }
}
if (!selected || !verified) {
  throw new Error(`F-Link returned offers but none passed real-time verification: ${[
    ...new Set(verifyErrors),
  ].slice(0, 3).join(" | ")}`);
}

console.log(JSON.stringify({
  stage: "search-and-verify",
  route: `${route.from}-${route.to}`,
  departureDate,
  offers: search.data.length,
  selectedFlight: selected.flightNo,
  priceKey: `${selected.priceKey.slice(0, 6)}…${selected.priceKey.slice(-4)}`,
  verifiedAmount: verified.totalAmount,
  currency: verified.currency,
}, null, 2));

if (!confirmed) {
  console.log("Search and verify passed. Add --confirm-sandbox-orders to create, pay, query and cancel sandbox orders.");
} else {
  const orderPayload = {
  productType: "flight",
  offerId: selected.id,
  quantity: 1,
  contact: {
    name: "SANDBOX TEST",
    phone: "13800138000",
    email: "sandbox-flight@example.com",
  },
  passengers: [{
    surname: "TEST",
    name: "SANDBOX",
    nationality: "CN",
    gender: "1",
    idType: "2",
    idNumber: "E12345678",
    birthday: "1990-06-18",
    expiration: "2031-08-20",
  }],
  addOns: { baggage: false, seat: false, insurance: false },
  paymentMethod: "credit",
};

const idempotencyKey = `flink-acceptance-${Date.now()}`;
const created = await post<Order>("/api/orders", orderPayload, {
  "Idempotency-Key": idempotencyKey,
});
if (!created.data.supplierOrderNo) throw new Error("Application order did not preserve F-Link orderNo");
const replayed = await post<Order>("/api/orders", orderPayload, {
  "Idempotency-Key": idempotencyKey,
});
if (replayed.data.id !== created.data.id
  || replayed.response.headers.get("Idempotency-Replayed") !== "true") {
  throw new Error("F-Link application order idempotency replay failed");
}

const paid = await post<Order>(`/api/orders/${created.data.id}/pay`, {
  paymentMethod: "credit",
});
const refreshed = await post<Order>(`/api/orders/${created.data.id}/refresh`);
const history = await request<Array<{ eventType: string }>>(
  `/api/orders/${created.data.id}/history`,
);

let cancelled: Order | undefined;
if (!skipCancelOrder) {
  const secondSearch = await post<FlightOffer[]>("/api/flights/search", {
    from: route.from,
    to: route.to,
    departureDate,
    adults: 1,
  });
  const cancelOffer = secondSearch.data.find(offer => offer.priceKey) || secondSearch.data[0];
  if (!cancelOffer) throw new Error("No second offer available for cancellation acceptance");
  await post("/api/flights/verify", {
    offerId: cancelOffer.id,
    priceKey: cancelOffer.priceKey,
    quantity: 1,
  });
  const cancellable = await post<Order>("/api/orders", {
    ...orderPayload,
    offerId: cancelOffer.id,
  }, {
    "Idempotency-Key": `flink-cancel-acceptance-${Date.now()}`,
  });
  cancelled = (await post<Order>(`/api/orders/${cancellable.data.id}/cancel`, {
    reason: "F-Link application sandbox acceptance",
  })).data;
}

  console.log(JSON.stringify({
  stage: "full-order-flow",
  paidOrder: {
    localOrderId: created.data.id,
    supplierOrderNo: created.data.supplierOrderNo,
    payStatus: paid.data.status,
    refreshedStatus: refreshed.data.status,
    events: history.data.map(event => event.eventType),
  },
  cancelledOrder: cancelled ? {
    localOrderId: cancelled.id,
    supplierOrderNo: cancelled.supplierOrderNo,
    status: cancelled.status,
  } : null,
  }, null, 2));
}

import type { DisplayCurrency, DisplayFxRates } from "../src/types.js";

type FxRow = { date?: unknown; base?: unknown; quote?: unknown; rate?: unknown };
type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const targets: DisplayCurrency[] = ["USD", "HKD", "SGD"];
const cacheTtlMs = 6 * 60 * 60 * 1000;
let cachedRates: DisplayFxRates | undefined;
let cachedUntil = 0;

export async function getDisplayFxRates(fetcher: FetchLike = fetch): Promise<DisplayFxRates> {
  if (cachedRates && Date.now() < cachedUntil) return cachedRates;
  const endpoint = process.env.FX_RATES_URL
    || "https://api.frankfurter.dev/v2/rates?base=CNY&quotes=USD,HKD,SGD";
  const response = await fetcher(endpoint, {
    headers: { Accept: "application/json", "User-Agent": "FusionGo/0.1" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Exchange rate service unavailable (HTTP ${response.status})`);
  const body = await response.json() as FxRow[];
  if (!Array.isArray(body)) throw new Error("Invalid exchange rate service response format");

  const rates: Record<DisplayCurrency, number> = { CNY: 1, USD: 0, HKD: 0, SGD: 0 };
  let date = "";
  for (const row of body) {
    const base = String(row.base || "").toUpperCase();
    const quote = String(row.quote || "").toUpperCase() as DisplayCurrency;
    const rate = Number(row.rate);
    if (base !== "CNY" || !targets.includes(quote) || !Number.isFinite(rate) || rate <= 0) continue;
    rates[quote] = rate;
    date ||= String(row.date || "");
  }
  if (!date || targets.some(currency => !(rates[currency] > 0))) {
    throw new Error("Exchange rate service missing required currencies");
  }
  cachedRates = {
    base: "CNY",
    date,
    source: "Frankfurter",
    fetchedAt: new Date().toISOString(),
    rates,
  };
  cachedUntil = Date.now() + cacheTtlMs;
  return cachedRates;
}

export function clearDisplayFxCache() {
  cachedRates = undefined;
  cachedUntil = 0;
}

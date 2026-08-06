import type { DisplayCurrency, DisplayFxRates } from "./types.js";

const displayCurrencies = new Set<DisplayCurrency>(["CNY", "USD", "HKD", "SGD"]);

export const isDisplayCurrency = (value: string): value is DisplayCurrency =>
  displayCurrencies.has(value as DisplayCurrency);

export function convertDisplayAmount(
  value: number,
  sourceCurrency: string,
  targetCurrency: DisplayCurrency,
  fx?: DisplayFxRates,
): number | undefined {
  const source = sourceCurrency.toUpperCase();
  if (!Number.isFinite(value)) return undefined;
  if (source === targetCurrency) return value;
  if (!fx || !isDisplayCurrency(source)) return undefined;
  const sourceRate = fx.rates[source];
  const targetRate = fx.rates[targetCurrency];
  if (!(sourceRate > 0) || !(targetRate > 0)) return undefined;
  return value / sourceRate * targetRate;
}

export const formatCurrencyAmount = (value: number, currency = "CNY") =>
  new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency,
    maximumFractionDigits: Math.abs(value) > 0 && Math.abs(value) < 1 ? 2 : 0,
  }).format(value);

export function formatDisplayAmount(
  value: number,
  sourceCurrency: string,
  targetCurrency: DisplayCurrency,
  fx?: DisplayFxRates,
) {
  const converted = convertDisplayAmount(value, sourceCurrency, targetCurrency, fx);
  if (converted === undefined) return formatCurrencyAmount(value, sourceCurrency);
  return `${sourceCurrency.toUpperCase() === targetCurrency ? "" : "≈"}${formatCurrencyAmount(converted, targetCurrency)}`;
}

import type { HotelCancellationPenalty, HotelCancellationPolicyDetails } from "./types.js";

export type CancellationPolicyLocale = "zh-CN" | "zh-TW" | "en";

export interface HotelCancellationPolicyDisplay {
  lines: string[];
  cutoffLabel?: string;
  checkInLabel?: string;
  timeline?: "full-to-none" | "full-to-penalty";
}

export interface HotelCancellationPolicySummary {
  kind: "non-refundable" | "limited-free-cancellation";
  text: string;
  clickable: boolean;
}

type LocalDateTime = { year: number; month: number; day: number; hour: number; minute: number };

const parseLocalDateTime = (value?: string): LocalDateTime | undefined => {
  if (!value) return undefined;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T|\s)(\d{2}):(\d{2})/);
  if (!match) return undefined;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), hour: Number(match[4]), minute: Number(match[5]) };
};

const parseStayDate = (value?: string): LocalDateTime | undefined => {
  if (!value) return undefined;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return undefined;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), hour: 0, minute: 0 };
};

const subtractDays = (value: LocalDateTime, days: number): LocalDateTime => {
  const date = new Date(Date.UTC(value.year, value.month - 1, value.day - days, value.hour, value.minute));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour: date.getUTCHours(), minute: date.getUTCMinutes() };
};

const withRestrictionTime = (value: LocalDateTime, time?: string): LocalDateTime => {
  const normalized = time?.replace(/\D/g, "") || "";
  if (normalized.length !== 4) return value;
  return { ...value, hour: Number(normalized.slice(0, 2)), minute: Number(normalized.slice(2)) };
};

const formatDateTime = (value: LocalDateTime, locale: CancellationPolicyLocale, includeYear = true): string => {
  const time = `${String(value.hour).padStart(2, "0")}:${String(value.minute).padStart(2, "0")}`;
  if (locale === "en") {
    const month = new Intl.DateTimeFormat("en-US", { month: "short" }).format(new Date(Date.UTC(value.year, value.month - 1, value.day)));
    return `${time}, ${month} ${value.day}${includeYear ? `, ${value.year}` : ""}`;
  }
  return `${includeYear ? `${value.year}年` : ""}${value.month}月${value.day}日${includeYear ? "" : " "}${time}`;
};

const formatShortDate = (value: LocalDateTime, locale: CancellationPolicyLocale): string => {
  if (locale === "en") {
    const month = new Intl.DateTimeFormat("en-US", { month: "short" }).format(new Date(Date.UTC(value.year, value.month - 1, value.day)));
    return `${value.day} ${month}`;
  }
  return `${value.month}月${value.day}日`;
};

const formatSummaryCutoff = (value: LocalDateTime, locale: CancellationPolicyLocale): string => {
  const time = `${String(value.hour).padStart(2, "0")}:${String(value.minute).padStart(2, "0")}`;
  if (locale === "en") {
    const month = new Intl.DateTimeFormat("en-US", { month: "short" }).format(new Date(Date.UTC(value.year, value.month - 1, value.day)));
    return `${time}, ${month} ${value.day}`;
  }
  return `${value.month}月${value.day}日 ${time}`;
};

const localizedFallback = (value: string, locale: CancellationPolicyLocale): string => {
  if (!value) return "";
  const containsCjk = /[\u3400-\u9fff]/.test(value);
  if (locale === "en") {
    if (!containsCjk) return value;
    const cutoff = parseLocalDateTime(value.replace(" ", "T"));
    if (/不可取消|不可更改|不退款/.test(value)) return cutoff
      ? `Cancellation is not permitted after ${formatDateTime(cutoff, locale)}.`
      : "This reservation is non-refundable.";
    if (/免费取消|免費取消/.test(value)) return "Free cancellation is available before the stated deadline.";
    if (/罚金|罰金|费用|費用/.test(value)) return "A cancellation penalty applies after the stated deadline.";
    return "Please refer to the supplier's real-time cancellation policy.";
  }
  if (containsCjk) return value;
  if (/non[- ]?refundable|no refund/i.test(value)) return locale === "zh-TW" ? "此訂單不可退款。" : "此订单不可退款。";
  if (/free cancellation/i.test(value)) return locale === "zh-TW" ? "可在規定時限前免費取消。" : "可在规定时限前免费取消。";
  return locale === "zh-TW" ? "請以供應商即時取消政策為準。" : "请以供应商实时取消政策为准。";
};

const policyCutoff = (details: HotelCancellationPolicyDetails, checkInDate?: string): LocalDateTime | undefined => {
  const explicit = parseLocalDateTime(details.freeCancellationDateTime);
  if (explicit) return explicit;
  const firstPenalty = details.cancelPenalties.map(item => parseLocalDateTime(item.startDate)).find(Boolean);
  if (firstPenalty) return firstPenalty;
  const checkIn = parseStayDate(checkInDate);
  if (!checkIn || details.cancelRestrictionDay === undefined) return undefined;
  return withRestrictionTime(subtractDays(checkIn, details.cancelRestrictionDay), details.cancelRestrictionTime);
};

export const buildHotelCancellationSummary = (
  details: HotelCancellationPolicyDetails | undefined,
  locale: CancellationPolicyLocale,
  checkInDate?: string,
  fallback = "",
  nonRefundable = false,
  freeCancellation = false,
): HotelCancellationPolicySummary => {
  const restrictionType = details?.cancelRestrictionType;
  const explicitlyNonRefundable = nonRefundable || restrictionType === 1
    || (restrictionType === undefined && /non[- ]?refundable|不可取消|不可更改|不退款/i.test(fallback));
  const supportsFreeWindow = !explicitlyNonRefundable && Boolean(
    freeCancellation
    || /free cancellation|free cancel|免费取消|免費取消/i.test(fallback)
    || details && ([2, 3, 4].includes(restrictionType ?? -1)
      || details.freeCancellationDateTime
      || details.cancelPenalties.length),
  );
  if (!supportsFreeWindow) return {
    kind: "non-refundable",
    clickable: false,
    text: locale === "en" ? "Non-refundable" : locale === "zh-TW" ? "不可取消" : "不可取消",
  };
  const cutoff = details ? policyCutoff(details, checkInDate) ?? (restrictionType === 4 ? parseStayDate(checkInDate) : undefined) : undefined;
  const cutoffText = cutoff ? formatSummaryCutoff(cutoff, locale) : "";
  return {
    kind: "limited-free-cancellation",
    clickable: true,
    text: locale === "en"
      ? `Free Cancellation${cutoffText ? ` before ${cutoffText}` : ""}`
      : locale === "zh-TW"
        ? `${cutoffText ? `${cutoffText}前` : "限時"}免費取消`
        : `${cutoffText ? `${cutoffText}前` : "限时"}免费取消`,
  };
};

const penaltyLine = (penalty: HotelCancellationPenalty, locale: CancellationPolicyLocale): string => {
  const start = parseLocalDateTime(penalty.startDate);
  const end = parseLocalDateTime(penalty.endDate);
  const range = start && end
    ? locale === "en"
      ? `between ${formatDateTime(start, locale)} and ${formatDateTime(end, locale)}`
      : `${formatDateTime(start, locale, false)} ～ ${formatDateTime(end, locale, false)}`
    : start
      ? locale === "en" ? `after ${formatDateTime(start, locale)}` : `${formatDateTime(start, locale, false)}后`
      : locale === "en" ? "during the penalty period" : "在罚则时段内";
  const value = penalty.penaltiesValue || "";
  const currency = penalty.currency || "";
  if (locale === "en") {
    if (penalty.penaltiesType === 1) {
      const nights = Math.max(1, Number.parseFloat(value) || 1);
      return `If you cancel your reservation ${range}, you'll be charged for ${nights === 1 ? "the first night" : `${nights} nights`} of your stay plus taxes and fees.`;
    }
    if (penalty.penaltiesType === 2) return `If you cancel your reservation ${range}, you'll be charged ${[currency, value].filter(Boolean).join(" ")}.`;
    if (penalty.penaltiesType === 3) return `If you cancel your reservation ${range}, you'll be charged ${value.includes("%") ? value : `${value}%`} of the total order amount.`;
    if (penalty.penaltiesType === 4) return `If you cancel your reservation ${range}, you'll be charged ${value.includes("%") ? value : `${value}%`} of the first night's room charge.`;
    return `A cancellation penalty applies ${range}.`;
  }
  const verb = locale === "zh-TW" ? "取消訂單，將" : "取消订单，将";
  if (penalty.penaltiesType === 1) {
    const nights = Math.max(1, Number.parseFloat(value) || 1);
    const charge = nights === 1 ? (locale === "zh-TW" ? "收取首晚房費加稅費" : "收取首晚房费加税费") : `${locale === "zh-TW" ? "收取" : "收取"}${nights}${locale === "zh-TW" ? "晚房費加稅費" : "晚房费加税费"}`;
    return `${range} ${verb}${charge}`;
  }
  if (penalty.penaltiesType === 2) return `${range} ${verb}${locale === "zh-TW" ? "收取" : "收取"} ${[currency, value].filter(Boolean).join(" ")} ${locale === "zh-TW" ? "的費用" : "的费用"}`;
  if (penalty.penaltiesType === 3) return `${range} ${verb}${locale === "zh-TW" ? "收取" : "收取"}${value.includes("%") ? value : `${value}%`}${locale === "zh-TW" ? "訂單費用" : "订单费用"}`;
  if (penalty.penaltiesType === 4) return `${range} ${verb}${locale === "zh-TW" ? "收取首晚房費的" : "收取首晚房费的"}${value.includes("%") ? value : `${value}%`}`;
  return `${range} ${locale === "zh-TW" ? "取消訂單將產生費用" : "取消订单将产生费用"}`;
};

export const buildHotelCancellationPolicy = (
  details: HotelCancellationPolicyDetails | undefined,
  locale: CancellationPolicyLocale,
  checkInDate?: string,
  fallback = "",
): HotelCancellationPolicyDisplay => {
  const fallbackText = localizedFallback(fallback, locale);
  if (!details) return { lines: [fallbackText || (locale === "en" ? "The supplier did not return a cancellation policy." : locale === "zh-TW" ? "供應商未返回取消政策。" : "供应商未返回取消政策。")] };
  const cutoff = policyCutoff(details, checkInDate);
  const checkIn = parseStayDate(checkInDate);
  const labels = { cutoffLabel: cutoff ? formatShortDate(cutoff, locale) : undefined, checkInLabel: checkIn ? formatShortDate(checkIn, locale) : undefined };

  if (details.cancelRestrictionType === 1) {
    return { lines: [locale === "en" ? "If you cancel your reservation, you will not get a refund or credit to use for a future stay." : locale === "zh-TW" ? "如果修改、取消訂單，將無法獲得退款。" : "如果修改、取消订单，将无法获得退款。"] };
  }
  if (details.cancelRestrictionType === 2) {
    const lines = details.cancelPenalties.map(item => penaltyLine(item, locale));
    return { ...labels, timeline: cutoff ? "full-to-penalty" : undefined, lines: lines.length ? lines : [fallbackText || (locale === "en" ? "A cancellation penalty applies after the free cancellation deadline." : locale === "zh-TW" ? "超過免費取消時限後將收取罰金。" : "超过免费取消时限后将收取罚金。")] };
  }
  if (details.cancelRestrictionType === 3 && cutoff) {
    const date = formatDateTime(cutoff, locale);
    return { ...labels, timeline: "full-to-none", lines: locale === "en"
      ? [`If you cancel before ${date}, you will get a full refund.`, `If you cancel after ${date}, you will not receive a refund.`]
      : locale === "zh-TW"
        ? [`${date}前取消訂單，可全額退款。`, `${date}後取消訂單，將收取全部房費。`]
        : [`${date}前取消订单，可全额退款。`, `${date}后取消订单，将收取全部房费。`] };
  }
  if (details.cancelRestrictionType === 4) {
    return { lines: [locale === "en" ? "You can cancel this reservation free of charge before check-in." : locale === "zh-TW" ? "入住前可免費取消訂單。" : "入住前可免费取消订单。"] };
  }
  return { lines: [fallbackText || (locale === "en" ? "Please refer to the supplier's real-time cancellation policy." : locale === "zh-TW" ? "請以供應商即時取消政策為準。" : "请以供应商实时取消政策为准。")] };
};

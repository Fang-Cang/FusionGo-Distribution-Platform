import type { DistributionOrder } from "../src/types.js";

type JsonRecord = Record<string, unknown>;
const record = (value: unknown): JsonRecord => value && typeof value === "object" && !Array.isArray(value)
  ? value as JsonRecord
  : {};
const array = (value: unknown) => Array.isArray(value) ? value : [];
const text = (value: unknown) => value === undefined || value === null ? "" : String(value).trim();
const amount = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};
const escapeHtml = (value: unknown) => text(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");
const money = (value: number, currency: string) => {
  try { return new Intl.NumberFormat("zh-CN", { style: "currency", currency }).format(value); }
  catch { return `${currency} ${value.toFixed(2)}`; }
};

export function createHotelConfirmationEmailHtml(input: {
  order: DistributionOrder;
  snapshots?: { product: unknown; contact: unknown };
  publicAppUrl?: string;
  supportEmail?: string;
  supportPhone?: string;
  supportUrl?: string;
}) {
  const { order } = input;
  const product = record(input.snapshots?.product);
  const contactSnapshot = record(input.snapshots?.contact);
  const contact = record(contactSnapshot.contact);
  const guests = array(contactSnapshot.guests).map(record);
  const breakdown = record(product.priceBreakdown);
  const currency = text(breakdown.currency) || order.currency;
  const detailUrl = input.publicAppUrl ? `${input.publicAppUrl.replace(/\/$/, "")}/?page=orders&order=${encodeURIComponent(order.id)}` : "";
  const supportUrl = input.supportUrl || detailUrl;
  const lines: Array<[string, string]> = [
    ["Room Subtotal", amount(breakdown.roomSubtotal) === undefined ? "" : money(amount(breakdown.roomSubtotal)!, currency)],
    ["Taxes & Fees", amount(breakdown.taxFee) === undefined ? "" : money(amount(breakdown.taxFee)!, currency)],
    ["Sales Tax", amount(breakdown.salesTax) === undefined ? "" : money(amount(breakdown.salesTax)!, currency)],
    ["Other Taxes", amount(breakdown.otherTax) === undefined ? "" : money(amount(breakdown.otherTax)!, currency)],
    ["FusionGo Service Fee", amount(breakdown.serviceFee) === undefined ? "" : money(amount(breakdown.serviceFee)!, currency)],
  ].filter((line): line is [string, string] => Boolean(line[1]));
  const propertyCharge = amount(breakdown.chargesDueAtProperty);
  const propertyChargeNotice = text(breakdown.chargesDueAtPropertyNotice);
  const specialInstructions = array(product.specialCheckInInstructions).map(text).filter(Boolean);
  const guestNames = guests.map(guest => [text(guest.lastName), text(guest.firstName)].filter(Boolean).join(" ")).filter(Boolean);
  const rows = lines.map(([label, value]) => `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Hotel Booking Confirmation - ${escapeHtml(order.id)}</title><style>
body{margin:0;background:#f3f6fb;color:#162033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif}.wrap{max-width:680px;margin:28px auto;background:#fff;border:1px solid #dfe6f0;border-radius:20px;overflow:hidden}.head{background:#173b70;color:#fff;padding:32px}.head h1{margin:8px 0 0;font-size:26px}.body{padding:28px}.status{display:inline-block;padding:6px 12px;border-radius:999px;background:#def7ec;color:#087f5b;font-weight:700}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:24px 0}.card{border:1px solid #e2e8f0;border-radius:14px;padding:16px}.card b,.card span{display:block}.card span{color:#64748b;font-size:13px;margin-top:5px}.section{border-top:1px solid #e2e8f0;padding-top:20px;margin-top:20px}.section h2{font-size:17px}table{width:100%;border-collapse:collapse}td{padding:9px 0;border-bottom:1px solid #edf1f6}td:last-child{text-align:right;font-weight:700}.total{font-size:20px;color:#4f46e5}.alert{padding:14px;border-radius:12px;background:#fff7ed;color:#9a3412}.support{background:#f5f3ff;padding:18px;border-radius:14px}.button{display:inline-block;background:#4f46e5;color:#fff!important;text-decoration:none;padding:11px 18px;border-radius:10px;font-weight:700}.muted{color:#64748b;font-size:13px}@media(max-width:700px){.wrap{margin:0;border-radius:0}.grid{grid-template-columns:1fr}}
</style></head><body><main class="wrap"><header class="head"><div>FusionGo · HOTEL CONFIRMATION</div><h1>Hotel Booking Confirmed</h1></header><div class="body"><span class="status">Confirmed</span><div class="grid"><div class="card"><b>Trip ID</b><span>${escapeHtml(order.id)}</span></div><div class="card"><b>Supplier Trip ID</b><span>${escapeHtml(order.supplierOrderNo || "Supplier did not return")}</span></div><div class="card"><b>Hotel</b><span>${escapeHtml(order.title)}</span></div><div class="card"><b>Stay Dates</b><span>${escapeHtml(product.checkInDate)} to ${escapeHtml(product.checkOutDate)}</span></div></div>
<section class="section"><h2>Room Type & Guests</h2><p><b>${escapeHtml(product.roomName || "Supplier did not return room type")}</b></p><p>Bed Type: ${escapeHtml(product.bedTypeDescription || "Supplier did not return bed type description")}</p><p>Guests: ${escapeHtml(guestNames.join(", ") || "Supplier did not return")}</p><p>Contact: ${escapeHtml([contact.surname, contact.givenName].filter(Boolean).join(" ") || contact.name)} · ${escapeHtml(contact.email)} · ${escapeHtml(contact.phone)}</p></section>
<section class="section"><h2>Check-in Instructions</h2><p>${escapeHtml(product.checkInInstructions || "Supplier did not return check-in time")}</p>${specialInstructions.length ? `<ul>${specialInstructions.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : "<p>No special check-in notes from supplier.</p>"}</section>
<section class="section"><h2>Cancellation Policy</h2><p class="${product.nonRefundable ? "alert" : ""}">${product.nonRefundable ? "Non-refundable · " : ""}${escapeHtml(product.cancelPolicy || "Supplier did not return cancellation policy")}</p></section>
<section class="section"><h2>Price Breakdown</h2><table>${rows || "<tr><td>Tax & Fee Breakdown</td><td>Supplier did not return breakdown</td></tr>"}${propertyCharge === undefined ? propertyChargeNotice ? `<tr><td>Charges at Property Notice</td><td>${escapeHtml(propertyChargeNotice)}</td></tr>` : "" : `<tr><td>Charges at Property</td><td>${escapeHtml(money(propertyCharge, text(breakdown.chargesDueAtPropertyCurrency) || currency))}</td></tr>`}<tr><td><b>Order Total</b></td><td class="total">${escapeHtml(money(order.amount, order.currency))}</td></tr></table></section>
<section class="section support"><h2>FusionGo Customer Support</h2><p>${input.supportEmail ? `Email: ${escapeHtml(input.supportEmail)}<br>` : ""}${input.supportPhone ? `Phone: ${escapeHtml(input.supportPhone)}` : ""}</p>${supportUrl ? `<a class="button" href="${escapeHtml(supportUrl)}">Open Online Support</a>` : "<p>Online support URL not configured; production launch will be blocked.</p>"}</section>
<p class="muted">This email content is from G-Link real-time products and verification results saved at order creation. No demo fields are used to fill gaps.</p></div></main></body></html>`;
}

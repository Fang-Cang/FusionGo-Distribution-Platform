import { existsSync } from "node:fs";
import { resolve } from "node:path";
import PDFDocument from "pdfkit";
import type { DistributionOrder, OrderStatus } from "../src/types.js";

type JsonRecord = Record<string, unknown>;
export type OrderDocumentType = "confirmation" | "receipt" | "ticket";

const record = (value: unknown): JsonRecord => value && typeof value === "object" && !Array.isArray(value)
  ? value as JsonRecord
  : {};
const array = (value: unknown) => Array.isArray(value) ? value : [];
const text = (value: unknown) => value === undefined || value === null ? "" : String(value).trim();
const positiveNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};
const shown = (value: unknown) => text(value) || "Not provided by supplier";
const maskDocument = (value: unknown) => {
  const raw = text(value);
  if (!raw) return "Not provided by supplier";
  if (raw.length <= 4) return "*".repeat(raw.length);
  return `${raw.slice(0, 2)}${"*".repeat(Math.max(3, raw.length - 4))}${raw.slice(-2)}`;
};

const statusLabels: Record<OrderStatus, string> = {
  PENDING_PAYMENT: "Pending Payment",
  PROCESSING: "Processing",
  CONFIRMED: "Confirmed",
  TICKETED: "Ticketed",
  CHANGING: "Changing",
  CANCELLED: "Cancelled",
  REFUNDING: "Refunding",
  REFUNDED: "Refunded",
  FAILED: "Failed",
};

const fontCandidates = [
  process.env.PDF_CJK_FONT_PATH,
  "/System/Library/Fonts/PingFang.ttc",
  "/System/Library/Fonts/STHeiti Light.ttc",
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf",
  "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
  resolve(process.cwd(), "node_modules/@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-400-normal.woff"),
].filter((path): path is string => Boolean(path));

const resolveFont = () => {
  const path = fontCandidates.find(existsSync);
  if (!path) throw new Error("CJK PDF font not found. Configure Noto Sans CJK or equivalent via PDF_CJK_FONT_PATH.");
  const regularFamily = process.env.PDF_CJK_FONT_FAMILY
    || (path.includes("PingFang.ttc") ? "PingFangSC-Regular" : undefined);
  const mediumFamily = process.env.PDF_CJK_FONT_MEDIUM_FAMILY
    || (path.includes("PingFang.ttc") ? "PingFangSC-Semibold" : regularFamily);
  return { path, mediumPath: path, regularFamily, mediumFamily };
};

const money = (amount: number, currency: string) => {
  try {
    return new Intl.NumberFormat("zh-CN", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
};

export async function createOrderDocumentPdf(input: {
  order: DistributionOrder;
  type: OrderDocumentType;
  snapshots?: { product: unknown; contact: unknown };
}) {
  const { order, type } = input;
  const product = record(input.snapshots?.product);
  const contactSnapshot = record(input.snapshots?.contact);
  const contact = record(contactSnapshot.contact);
  const passengers = array(contactSnapshot.passengers).map(record);
  const guest = record(contactSnapshot.guest);
  const guests = (array(contactSnapshot.guests).map(record).length
    ? array(contactSnapshot.guests).map(record)
    : Object.keys(guest).length ? [guest] : []);
  const generatedAt = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(new Date());

  const title = type === "ticket"
    ? "Flight E-Ticket & Itinerary Voucher"
    : type === "receipt"
      ? "Electronic Payment Voucher"
      : order.productType === "hotel" ? "Hotel Booking Confirmation Voucher" : "Flight Booking Confirmation Voucher";
  const font = resolveFont();
  const doc = new PDFDocument({ size: "A4", margin: 42, info: {
    Title: `${title} - ${order.id}`,
    Author: "FusionGo",
    Subject: "Supplier Order E-Voucher",
  } });
  doc.registerFont("FG-Regular", font.path, font.regularFamily);
  doc.registerFont("FG-Medium", font.mediumPath, font.mediumFamily);
  const chunks: Buffer[] = [];
  doc.on("data", chunk => chunks.push(Buffer.from(chunk)));
  const complete = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const pageWidth = doc.page.width;
  const contentWidth = pageWidth - 84;
  const navy = "#173B70";
  const indigo = "#5B5CF6";
  const ink = "#172033";
  const muted = "#64748B";
  const line = "#DCE3EE";
  const pale = "#F5F7FB";
  const green = "#168467";

  doc.rect(0, 0, pageWidth, 126).fill(navy);
  doc.roundedRect(42, 34, 46, 46, 12).fill(indigo);
  doc.fillColor("#FFFFFF").font("FG-Medium").fontSize(24).text("F", 42, 43, { width: 46, align: "center" });
  doc.font("FG-Medium").fontSize(19).text("FusionGo", 102, 37);
  doc.font("FG-Regular").fontSize(8.5).fillColor("#DCE8FF").text("Global Travel Distribution Platform", 102, 63);
  doc.font("FG-Regular").fontSize(8).fillColor("#BED0F2").text("ELECTRONIC TRAVEL DOCUMENT", 42, 99);

  const status = statusLabels[order.status];
  doc.roundedRect(pageWidth - 126, 38, 84, 28, 14).fill(order.status === "CONFIRMED" || order.status === "TICKETED" ? "#E7F7F0" : "#FFF3D9");
  doc.fillColor(order.status === "CONFIRMED" || order.status === "TICKETED" ? green : "#8A5A00")
    .font("FG-Medium").fontSize(10).text(status, pageWidth - 126, 47, { width: 84, align: "center" });

  let y = 154;
  doc.fillColor(ink).font("FG-Medium").fontSize(22).text(title, 42, y);
  y += 34;
  doc.fillColor(muted).font("FG-Regular").fontSize(9)
    .text("Please verify the order information below. Final fulfillment, refund/exchange, and service rules are subject to real-time supplier confirmation.", 42, y);
  y += 25;

  const metaY = y;
  doc.roundedRect(42, metaY, contentWidth, 66, 12).fill(pale);
  const meta = [
    ["Local Order ID", order.id],
    ["Supplier Order ID", order.supplierOrderNo || "Not returned by supplier"],
    ["Voucher Generated At", generatedAt],
  ];
  meta.forEach(([label, value], index) => {
    const x = 58 + index * (contentWidth / 3);
    doc.fillColor(muted).font("FG-Regular").fontSize(7.5).text(label, x, metaY + 14, { width: contentWidth / 3 - 20 });
    doc.fillColor(ink).font("FG-Medium").fontSize(9.5).text(value, x, metaY + 33, { width: contentWidth / 3 - 20, ellipsis: true });
    if (index < 2) doc.moveTo(x + contentWidth / 3 - 14, metaY + 13).lineTo(x + contentWidth / 3 - 14, metaY + 53).strokeColor(line).stroke();
  });
  y += 84;

  const sectionTitle = (label: string) => {
    doc.fillColor(indigo).rect(42, y + 1, 3, 16).fill();
    doc.fillColor(ink).font("FG-Medium").fontSize(13).text(label, 54, y);
    y += 25;
  };
  const row = (label: string, value: string, x = 56, width = contentWidth - 28) => {
    doc.fillColor(muted).font("FG-Regular").fontSize(8).text(label, x, y, { width: 112 });
    doc.fillColor(ink).font("FG-Regular").fontSize(9.5).text(value, x + 116, y - 1, { width: width - 116 });
    y += 23;
  };
  const cardStart = (height: number) => {
    doc.roundedRect(42, y, contentWidth, height, 12).fillAndStroke("#FFFFFF", line);
    y += 15;
  };

  sectionTitle(order.productType === "hotel" ? "Accommodation" : "Itinerary");
  cardStart(order.productType === "hotel" ? 152 : 140);
  row(order.productType === "hotel" ? "Hotel Name" : "Route", order.title);
  row("Trip Summary", order.subtitle);
  if (order.productType === "hotel") {
    const checkIn = text(product.checkInDate);
    const checkOut = text(product.checkOutDate);
    const rooms = positiveNumber(product.roomNum);
    const nights = positiveNumber(product.nights);
    row("Check-in / Check-out", checkIn && checkOut ? `${checkIn} / ${checkOut}` : "Not provided by supplier");
    row("Room Type / Rate Plan", [text(product.roomName), text(product.ratePlanName)].filter(Boolean).join(" / ") || "Not provided by supplier");
    row("Rooms / Nights / Guests", [rooms ? `${rooms} rooms` : "", nights ? `${nights} nights` : "", positiveNumber(product.numberOfAdults) ? `${positiveNumber(product.numberOfAdults)} adults` : ""].filter(Boolean).join(" / ") || "Not provided by supplier");
  } else {
    const journeys = array(product.journeys).map(record);
    const flightNos = journeys.map(item => text(item.flightNo)).filter(Boolean).join(" / ") || text(product.flightNo);
    row("Flight Number", shown(flightNos));
    row("Cabin Class", shown(product.cabin));
    row("Baggage Allowance", shown(product.baggage));
  }
  y += 20;

  sectionTitle(order.productType === "hotel" ? "Guests & Contact" : "Passengers & Contact");
  const people = order.productType === "hotel" ? guests : passengers;
  const peopleHeight = Math.max(105, 78 + Math.max(1, people.length) * 19);
  cardStart(peopleHeight);
  if (people.length) {
    people.forEach((person, index) => {
      const name = order.productType === "hotel"
        ? [text(person.lastName), text(person.firstName)].filter(Boolean).join(" ")
        : [text(person.surname), text(person.name)].filter(Boolean).join("/");
      const identity = order.productType === "flight" ? ` (Document ${maskDocument(person.idNumber)})` : "";
      row(`${order.productType === "hotel" ? `Room ${positiveNumber(person.roomIndex) || index + 1}` : `Passenger ${index + 1}`}`, `${name || "Not provided by supplier"}${identity}`);
    });
  } else {
    row(order.productType === "hotel" ? "Guest" : "Passenger", "Not provided by supplier");
  }
  row("Contact", shown([text(contact.surname), text(contact.givenName)].filter(Boolean).join(" ") || contact.name));
  row("Phone / Email", [text(contact.phone), text(contact.email)].filter(Boolean).join(" / ") || "Not provided by supplier");
  y += 18;

  sectionTitle("Amount & Service Details");
  cardStart(112);
  row("Order Amount", money(order.amount, order.currency));
  if (order.productType === "hotel") {
    row("Breakfast", shown(product.breakfast));
    row("Cancellation Policy", shown(product.cancelPolicy));
  } else {
    row("Refund / Exchange", "Subject to F-Link and airline real-time calculation");
    row("Ticketing Status", status);
  }

  const footerY = doc.page.height - 76;
  doc.moveTo(42, footerY).lineTo(pageWidth - 42, footerY).strokeColor(line).stroke();
  doc.fillColor(muted).font("FG-Regular").fontSize(7.5)
    .text("This voucher is for order verification only and does not replace a VAT invoice. Final status is subject to the latest supplier status in Bookings.", 42, footerY + 13, {
      width: contentWidth - 105,
      lineBreak: false,
      ellipsis: true,
    });
  doc.fillColor(navy).font("FG-Medium").fontSize(8).text("FusionGo  |  1 / 1", pageWidth - 142, footerY + 13, {
    width: 100,
    align: "right",
    lineBreak: false,
  });

  doc.end();
  return complete;
}

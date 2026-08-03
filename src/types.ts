export type ProductType = "hotel" | "flight";
export type OrderStatus =
  | "PENDING_PAYMENT"
  | "PROCESSING"
  | "CONFIRMED"
  | "TICKETED"
  | "CHANGING"
  | "CANCELLED"
  | "REFUNDING"
  | "REFUNDED"
  | "FAILED";

export type PaymentMethod = "credit" | "card";

export interface AccountProfile {
  id: string;
  name: string;
  language: "zh-CN" | "zh-TW" | "en";
  phone: string;
  email: string;
  avatarUrl?: string;
  avatarUpdatedAt?: string;
  updatedAt: string;
}

export interface AccountTraveler {
  id: string;
  type: "adult" | "child" | "infant";
  surname: string;
  givenName: string;
  gender: "1" | "2";
  birthday: string;
  nationality: string;
  documentNo: string;
  issuingCountry: string;
  expiration: string;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationPreferences {
  order: boolean;
  flight: boolean;
  marketing: boolean;
  updatedAt: string;
}

export interface FlightAddOns {
  baggage: boolean;
  seat: boolean;
  insurance: boolean;
}

export interface HotelOffer {
  id: string;
  inventorySource?: "glink" | "simulation";
  name: string;
  city: string;
  district: string;
  rating: number;
  stars: number;
  image: string;
  tags: string[];
  roomName: string;
  breakfast: string;
  cancelPolicy: string;
  nightlyPrice: number;
  currency: string;
  checkInDate?: string;
  checkOutDate?: string;
  roomNum?: number;
  numberOfAdults?: number;
  numberOfChildren?: number;
  childrenAges?: number[];
  nights?: number;
  totalPrice?: number;
}

export interface FlightOffer {
  id: string;
  airline: string;
  airlineCode: string;
  flightNo: string;
  departureAirport: string;
  arrivalAirport: string;
  departureTime: string;
  arrivalTime: string;
  duration: string;
  stops: number;
  cabin: string;
  baggage: string;
  price: number;
  currency: string;
  priceKey: string;
  tripType?: 1 | 2 | 3;
  adultNum?: number;
  childNum?: number;
  infantNum?: number;
  journeys?: FlightJourneySummary[];
}

export interface FlightJourneySummary {
  origin: string;
  destination: string;
  date: string;
  flightNo: string;
  departureTime: string;
  arrivalTime: string;
  duration: string;
  stops: number;
}

export interface DistributionOrder {
  id: string;
  productType: ProductType;
  supplierOrderNo?: string;
  title: string;
  subtitle: string;
  customer: string;
  amount: number;
  currency: string;
  status: OrderStatus;
  createdAt: string;
}

export interface OrderBookingDetails {
  travelerName: string;
  contactName: string;
  email: string;
  phone: string;
  documentMasked?: string;
  serviceSummary: string;
  hotelStay?: {
    checkInDate: string;
    checkOutDate: string;
    nights: number;
    roomNum: number;
    numberOfAdults: number;
    numberOfChildren?: number;
    childrenAges?: number[];
    guests: Array<{ roomIndex: number; name: string }>;
  };
}

export interface FlightAfterSalesPassenger {
  passengerCode: string;
  name: string;
}

export interface FlightAfterSalesSegment {
  segmentId: string;
  origin: string;
  destination: string;
  date: string;
  flightNo: string;
}

export interface FlightAfterSalesCase {
  kind: "change" | "refund";
  orderNo: string;
  status: number;
  statusLabel: string;
  amount?: number;
  currency?: string;
  targetDate?: string;
  rejectReason?: string;
  updatedAt: string;
}

export interface FlightAfterSalesContext {
  eligible: boolean;
  eligibilityReason?: string;
  supplierStatus: number;
  passengers: FlightAfterSalesPassenger[];
  segments: FlightAfterSalesSegment[];
  change?: FlightAfterSalesCase;
  refund?: FlightAfterSalesCase;
}

export interface FlightChangeOffer {
  priceKey: string;
  flightNo: string;
  airline: string;
  departureTime: string;
  arrivalTime: string;
  duration: string;
  price: number;
  currency: string;
}

export interface Customer {
  id: string;
  name: string;
  contactName: string;
  phone: string;
  email: string;
  status: "ACTIVE" | "SUSPENDED";
  creditLimit: number;
  creditUsed: number;
  createdAt: string;
}

export interface PricingRule {
  id: string;
  name: string;
  productType: ProductType | "all";
  calculationType: "percentage" | "fixed";
  value: number;
  priority: number;
  status: "ACTIVE" | "INACTIVE";
  createdAt: string;
}

export interface LedgerEntry {
  id: string;
  orderId?: string;
  entryType: "PAYMENT" | "REFUND_PENDING" | "REFUND" | "ADJUSTMENT";
  amount: number;
  currency: string;
  status: string;
  reference: string;
  createdAt: string;
}

export interface FinanceSummary {
  availableCredit: number;
  totalCredit: number;
  paid: number;
  paidByCurrency: Record<string, number>;
  refundPending: number;
  refundPendingByCurrency: Record<string, number>;
  entries: LedgerEntry[];
}

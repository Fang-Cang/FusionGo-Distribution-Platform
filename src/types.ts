export type ProductType = "hotel" | "flight";
export type DisplayCurrency = "CNY" | "USD" | "HKD" | "SGD";

export interface DisplayFxRates {
  base: "CNY";
  date: string;
  source: "Frankfurter";
  fetchedAt: string;
  rates: Record<DisplayCurrency, number>;
}
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

export interface AuthSession {
  authenticated: boolean;
  mode: "local" | "external";
  user?: {
    id: string;
    name: string;
    email: string;
    role: "admin" | "member";
  };
}

export interface RegistrationInput {
  surname: string;
  givenName: string;
  email: string;
  phone: string;
  password: string;
  language: "zh-CN" | "zh-TW" | "en";
  acceptedTerms: true;
}

export interface AccountProfile {
  id: string;
  name: string;
  surname?: string;
  givenName?: string;
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

export interface NationalityOption {
  code: string;
  nameZh: string;
  nameZhTw: string;
  nameEn: string;
  dialingCode: string;
  source: "flink" | "iso-3166";
}

export interface NationalityCatalog {
  items: NationalityOption[];
  source: "flink" | "iso-3166";
  count: number;
  fetchedAt: string;
  warning?: string;
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

export interface HotelCancellationPenalty {
  penaltiesType?: number;
  startDate?: string;
  endDate?: string;
  penaltiesValue?: string;
  currency?: string;
}

export interface HotelCancellationPolicyDetails {
  cancelRestrictionType?: number;
  cancelRestrictionDay?: number;
  cancelRestrictionTime?: string;
  freeCancellationDateTime?: string;
  cancelPenalties: HotelCancellationPenalty[];
}

export interface HotelOffer {
  id: string;
  hotelId?: number | string;
  roomId?: number | string;
  inventorySource?: "glink" | "simulation";
  name: string;
  city: string;
  cityCode?: string;
  searchMatch?: "exact" | "nearby";
  distanceKm?: number;
  district: string;
  rating?: number;
  ratingSource?: string;
  stars?: number;
  starCode?: number;
  starDescription?: string;
  image?: string;
  tags: string[];
  roomName: string;
  ratePlanName?: string;
  breakfast: string;
  breakfastIncluded?: boolean;
  cancelPolicy: string;
  cancellationPolicyDetails?: HotelCancellationPolicyDetails;
  bedTypeDescription?: string;
  windowType?: number;
  nonRefundable?: boolean;
  cancelRestrictionType?: number;
  freeCancellation?: boolean;
  checkInInstructions?: string;
  specialCheckInInstructions?: string[];
  payAtHotel?: boolean;
  paymentTiming?: string;
  paymentProcessor?: string;
  paymentProcessingLocation?: string;
  priceBreakdown?: HotelPriceBreakdown;
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
  maxRoomCount?: number;
}

export interface HotelSearchPage {
  items: HotelOffer[];
  currentPage: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  hasMore: boolean;
}

export interface HotelSearchFilterItem {
  code: string;
  name: string;
  count: number;
  facilityType?: number;
}

export interface HotelSearchFilters {
  hotelFacilities: HotelSearchFilterItem[];
  roomAmenities: HotelSearchFilterItem[];
}

export const HOTEL_POPULAR_FACILITY_CODES = [
  "shuttleService",
  "freeBreakfast",
  "petFriendly",
  "chargingStation",
  "meetingRoom",
  "laundryFacilities",
  "restaurant",
  "swimmingPool",
  "freeWiFi",
  "luggageStorage",
  "bar",
  "has24HourFrontDesk",
  "fitnessCenter",
  "parkingLot",
  "currencyExchange",
  "spaAndWellnessCenter",
] as const;

export type HotelPopularFacilityCode = typeof HOTEL_POPULAR_FACILITY_CODES[number];

export interface HotelRoomInfo {
  roomId: number | string;
  images?: string[];
  smokingPolicy?: number;
  roomArea?: string;
  roomFloor?: string;
  windowType?: number;
  wirelessBroadband?: number;
}

export interface HotelBasicInfo {
  hotelId: number | string;
  name: string;
  city: string;
  district: string;
  address?: string;
  phone?: string;
  openingDate?: string;
  renovatedDate?: string;
  numberOfRooms?: number;
  stars?: number;
  starCode?: number;
  starDescription?: string;
  rating?: number;
  ratingSource?: string;
  introduction?: string;
  checkInTime?: string;
  checkInLateTime?: string;
  checkOutTime?: string;
  popularFacilities?: HotelPopularFacilityCode[];
  rooms?: HotelRoomInfo[];
  facilities: string[];
  images: string[];
  importantNotices: string[];
}

export interface FavoriteHotel extends HotelOffer {
  favoritedAt: string;
}

export interface HotelPriceBreakdown {
  roomSubtotal?: number;
  taxFee?: number;
  salesTax?: number;
  otherTax?: number;
  serviceFee?: number;
  chargesDueAtProperty?: number;
  chargesDueAtPropertyCurrency?: string;
  chargesDueAtPropertyNotice?: string;
  total: number;
  currency: string;
  feeItems?: Array<{
    type: string;
    value: number;
    currency: string;
    date?: string;
    chargeFrequency?: string;
  }>;
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
  totalPrice?: number;
  currency: string;
  priceKey: string;
  tripType?: 1 | 2 | 3;
  adultNum?: number;
  childNum?: number;
  infantNum?: number;
  journeys?: FlightJourneySummary[];
}

export interface FlightDestination {
  code: string;
  type: 1 | 2;
  cityCode: string;
  cityName: string;
  airportCode?: string;
  airportName?: string;
  country: string;
  displayName: string;
  detail: string;
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
  createdAtIso?: string;
}

export interface OrderBookingDetails {
  travelerName: string;
  contactName: string;
  contactSurname?: string;
  contactGivenName?: string;
  email: string;
  phone: string;
  documentMasked?: string;
  serviceSummary: string;
  roomName?: string;
  breakfast?: string;
  cancelPolicy?: string;
  bedTypeDescription?: string;
  nonRefundable?: boolean;
  checkInInstructions?: string;
  specialCheckInInstructions?: string[];
  payAtHotel?: boolean;
  paymentTiming?: string;
  paymentProcessor?: string;
  paymentProcessingLocation?: string;
  priceBreakdown?: HotelPriceBreakdown;
  cabin?: string;
  baggage?: string;
  hotelStay?: {
    checkInDate: string;
    checkOutDate: string;
    nights?: number;
    roomNum?: number;
    numberOfAdults?: number;
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
  contactSurname?: string;
  contactGivenName?: string;
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

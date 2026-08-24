import type {
  AccountProfile,
  AccountTraveler,
  AuthSession,
  Customer,
  DistributionOrder,
  DisplayFxRates,
  FinanceSummary,
  FlightAddOns,
  FlightAfterSalesContext,
  FlightChangeOffer,
  FlightDestination,
  FlightOffer,
  FavoriteHotel,
  HotelOffer,
  HotelSearchFilters,
  HotelSearchPage,
  HotelBasicInfo,
  HotelPriceBreakdown,
  OrderBookingDetails,
  PaymentMethod,
  PricingRule,
  RegistrationInput,
  NotificationPreferences,
  NationalityCatalog,
} from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    throw new Error("Unable to connect to booking service. Please ensure local API is running and retry.");
  }
  let body: { code?: string; data?: T; message?: string };
  try {
    body = (await response.json()) as typeof body;
  } catch {
    throw new Error(response.ok ? "Booking service returned unrecognized data" : `Booking service temporarily unavailable (HTTP ${response.status})`);
  }
  if (!response.ok || (body.code && body.code !== "SUCCESS")) throw new Error(body.message || "Request failed");
  return body.data as T;
}

export const api = {
  getAuthSession: () => request<AuthSession>("/api/auth/session"),
  login: (credentials?: { email: string; password: string }) => request<AuthSession>("/api/auth/login", {
    method: "POST",
    body: credentials ? JSON.stringify(credentials) : undefined,
  }),
  register: (body: RegistrationInput) => request<AuthSession>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(body),
  }),
  logout: () => request<AuthSession>("/api/auth/logout", { method: "POST" }),
  listNationalities: (locale: "zh-CN" | "zh-TW" | "en") =>
    request<NationalityCatalog>(`/api/reference/nationalities?locale=${encodeURIComponent(locale)}`),
  getDisplayFxRates: () => request<DisplayFxRates>("/api/fx/rates"),
  getAccountProfile: () => request<AccountProfile>("/api/account/profile"),
  updateAccountProfile: (body: Pick<AccountProfile, "name" | "language" | "phone" | "email"> & Pick<AccountProfile, "surname" | "givenName">) =>
    request<AccountProfile>("/api/account/profile", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  uploadAccountAvatar: async (file: File) => {
    let response: Response;
    try {
      response = await fetch("/api/account/profile/avatar", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": file.type },
        body: file,
      });
    } catch {
      throw new Error("Unable to connect to avatar storage service. Please ensure local API is running and retry.");
    }
    const body = await response.json() as { code?: string; data?: AccountProfile; message?: string };
    if (!response.ok || (body.code && body.code !== "SUCCESS")) throw new Error(body.message || "Avatar save failed");
    return body.data as AccountProfile;
  },
  listAccountTravelers: () => request<AccountTraveler[]>("/api/account/travelers"),
  createAccountTraveler: (body: Omit<AccountTraveler, "id" | "createdAt" | "updatedAt">) =>
    request<AccountTraveler>("/api/account/travelers", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateAccountTraveler: (
    id: string,
    body: Omit<AccountTraveler, "id" | "documentNo" | "createdAt" | "updatedAt"> & { documentNo?: string },
  ) => request<AccountTraveler>(`/api/account/travelers/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  }),
  deleteAccountTraveler: (id: string) =>
    request<{ deleted: true }>(`/api/account/travelers/${encodeURIComponent(id)}`, { method: "DELETE" }),
  listFavoriteHotels: () => request<FavoriteHotel[]>("/api/account/hotel-favorites"),
  addFavoriteHotel: (hotel: HotelOffer) =>
    request<FavoriteHotel>("/api/account/hotel-favorites", {
      method: "POST",
      body: JSON.stringify({ hotel }),
    }),
  deleteFavoriteHotel: (hotelId: string) =>
    request<{ deleted: true }>(`/api/account/hotel-favorites/${encodeURIComponent(hotelId)}`, { method: "DELETE" }),
  getNotificationPreferences: () => request<NotificationPreferences>("/api/account/notifications"),
  updateNotificationPreferences: (body: Omit<NotificationPreferences, "updatedAt">) =>
    request<NotificationPreferences>("/api/account/notifications", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  getDestination: (keyword: string, language: "zh-CN" | "zh-TW" | "en-US", signal?: AbortSignal) =>
    request<Array<{ name: string; detail: string; cityCode: string; destinationId?: string; destinationType: number; source?: number; hotelId?: number; latGoogle: number; lngGoogle: number }>>("/api/hotels/destination", {
      method: "POST",
      body: JSON.stringify({ keyword, language }),
      signal,
    }),
  getHotelById: (hotelId: string, hotelName: string) =>
    request<HotelOffer>("/api/hotels/by-id", {
      method: "POST",
      body: JSON.stringify({ hotelId, hotelName }),
    }),
  searchHotels: (
    params: { destination: string; cityCode?: string; destinationId?: string; destinationType?: number; source?: number; hotelId?: number; latGoogle?: number; lngGoogle?: number; language?: "zh-CN" | "en-US"; checkIn: string; checkOut: string; rooms?: number; adults?: number; children?: number; childAges?: number[]; hotelFacilityCodes?: string[]; roomFacilityCodes?: string[] },
    signal?: AbortSignal,
  ) =>
    request<HotelOffer[]>("/api/hotels/search", {
      method: "POST",
      body: JSON.stringify(params),
      signal,
    }),
  searchHotelsPage: (
    params: { destination: string; cityCode?: string; destinationId?: string; destinationType?: number; source?: number; hotelId?: number; latGoogle?: number; lngGoogle?: number; language?: "zh-CN" | "en-US"; checkIn: string; checkOut: string; rooms?: number; adults?: number; children?: number; childAges?: number[]; hotelFacilityCodes?: string[]; roomFacilityCodes?: string[]; page?: number; pageSize?: number },
    signal?: AbortSignal,
  ) =>
    request<HotelSearchPage>("/api/hotels/search", {
      method: "POST",
      body: JSON.stringify({ ...params, paginated: true }),
      signal,
    }),
  getHotelFilters: (destinationId: string, language: "zh-CN" | "en-US") =>
    request<HotelSearchFilters>("/api/hotels/filters", {
      method: "POST",
      body: JSON.stringify({ destinationId, language }),
    }),
  getHotelProducts: (offerId: string, language: "zh-CN" | "en-US") =>
    request<HotelOffer[]>("/api/hotels/product-details", {
      method: "POST",
      body: JSON.stringify({ offerId, language }),
    }),
  getHotelDetail: (hotelId: number | string, language: "zh-CN" | "en-US") =>
    request<HotelBasicInfo>("/api/hotels/detail", {
      method: "POST",
      body: JSON.stringify({ hotelId, language }),
    }),
  checkHotelAvailability: (offerId: string) =>
    request<{
      available: true;
      checkedAt: string;
      price: number;
      currency: string;
      checkInDate?: string;
      checkOutDate?: string;
      roomNum?: number;
      numberOfAdults?: number;
      numberOfChildren?: number;
      childrenAges?: number[];
      nights?: number;
      bedTypeDescription?: string;
      nonRefundable?: boolean;
      cancelRestrictionType?: number;
      cancelPolicy?: string;
      checkInInstructions?: string;
      specialCheckInInstructions?: string[];
      payAtHotel?: boolean;
      paymentTiming?: string;
      paymentProcessor?: string;
      paymentProcessingLocation?: string;
      priceBreakdown?: HotelPriceBreakdown;
    }>("/api/hotels/availability", {
      method: "POST",
      body: JSON.stringify({ offerId }),
    }),
  searchFlights: (params: {
    from: string;
    to: string;
    departureDate: string;
    adults: number;
    children?: number;
    infants?: number;
    tripType?: 1 | 2 | 3;
    journeys?: Array<{
      origin: string;
      destination: string;
      date: string;
      originType: 1 | 2;
      destinationType: 1 | 2;
    }>;
  }) =>
    request<FlightOffer[]>("/api/flights/search", {
      method: "POST",
      body: JSON.stringify(params),
    }),
  searchFlightDestinations: (
    keyword: string,
    locale: "zh-CN" | "zh-TW" | "en",
    signal?: AbortSignal,
  ) => request<FlightDestination[]>("/api/flights/destinations", {
    method: "POST",
    body: JSON.stringify({ keyword, locale }),
    signal,
  }),
  verifyFlight: (body: { offerId: string; priceKey: string; quantity: number }) =>
    request<{ verified: true; priceKey: string; totalAmount: number; currency: string; expiresAt: string }>("/api/flights/verify", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  listOrders: () => request<DistributionOrder[]>("/api/orders"),
  getOrder: (orderId: string) => request<DistributionOrder>(`/api/orders/${orderId}`),
  getOrderDetails: (orderId: string) =>
    request<OrderBookingDetails>(`/api/orders/${orderId}/details`),
  createOrder: (body:
    | {
      productType: "hotel";
      offerId: string;
      customerId?: string;
      quantity?: number;
      guest?: { firstName: string; lastName: string };
      guests?: Array<{ roomIndex: number; firstName: string; lastName: string }>;
      contact?: { name: string; surname?: string; givenName?: string; phone: string; email: string };
      arriveTime?: string;
      latestArriveTime?: string;
    }
    | {
      productType: "flight";
      offerId: string;
      customerId?: string;
      quantity?: number;
      contact?: { name: string; surname?: string; givenName?: string; phone: string; email: string };
      passengers?: Array<{
        surname: string;
        name: string;
        nationality: string;
        gender: "1" | "2";
        idType: string;
        idNumber: string;
        birthday: string;
        expiration: string;
        type?: "adult" | "child" | "infant";
        adultPassengerName?: string;
      }>;
      addOns: FlightAddOns;
      paymentMethod: PaymentMethod;
    }) =>
    request<DistributionOrder>("/api/orders", {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify(body),
    }),
  payOrder: (orderId: string, paymentMethod: PaymentMethod = "credit") =>
    request<DistributionOrder>(`/api/orders/${orderId}/pay`, {
      method: "POST",
      body: JSON.stringify({ paymentMethod }),
    }),
  refreshOrder: (orderId: string) =>
    request<DistributionOrder>(`/api/orders/${orderId}/refresh`, { method: "POST" }),
  getFlightAfterSales: (orderId: string) =>
    request<FlightAfterSalesContext>(`/api/orders/${orderId}/flight-aftersales`),
  searchFlightChange: (orderId: string, body: { date: string; passengerCodes: string[]; segmentIds: string[] }) =>
    request<FlightChangeOffer[]>(`/api/orders/${orderId}/flight-aftersales/change/search`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  applyFlightChange: (orderId: string, body: {
    priceKey: string;
    passengerCodes: string[];
    segmentIds: string[];
    changeType: 1 | 2 | 3;
    reasonType: 1 | 2;
    reason: string;
    evidenceFiles: string[];
    contact: { name: string; surname?: string; givenName?: string; phone: string; email: string };
  }) => request<FlightAfterSalesContext>(`/api/orders/${orderId}/flight-aftersales/change/apply`, {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify(body),
  }),
  refreshFlightChange: (orderId: string) =>
    request<FlightAfterSalesContext>(`/api/orders/${orderId}/flight-aftersales/change/refresh`, { method: "POST" }),
  payFlightChange: (orderId: string) =>
    request<FlightAfterSalesContext>(`/api/orders/${orderId}/flight-aftersales/change/pay`, { method: "POST" }),
  cancelFlightChange: (orderId: string) =>
    request<FlightAfterSalesContext>(`/api/orders/${orderId}/flight-aftersales/change/cancel`, { method: "POST" }),
  applyFlightRefund: (orderId: string, body: {
    passengerCodes: string[];
    segmentIds: string[];
    refundType: 1 | 2;
    reason: string;
    evidenceFiles: string[];
    contact: { name: string; surname?: string; givenName?: string; phone: string; email: string };
  }) => request<FlightAfterSalesContext>(`/api/orders/${orderId}/flight-aftersales/refund/apply`, {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify(body),
  }),
  refreshFlightRefund: (orderId: string) =>
    request<FlightAfterSalesContext>(`/api/orders/${orderId}/flight-aftersales/refund/refresh`, { method: "POST" }),
  confirmFlightRefund: (orderId: string, confirm: "1" | "2") =>
    request<FlightAfterSalesContext>(`/api/orders/${orderId}/flight-aftersales/refund/confirm`, {
      method: "POST",
      body: JSON.stringify({ confirm }),
    }),
  cancelOrder: (orderId: string, reason = "Customer initiated cancellation") =>
    request<DistributionOrder>(`/api/orders/${orderId}/cancel`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),
  dashboard: () =>
    request<{
      salesToday: number;
      salesTodayByCurrency: Record<string, number>;
      ordersToday: number;
      successRate: number;
      alerts: number;
      trend: Array<{ date: string; hotels: number; flights: number }>;
      recentOrders: DistributionOrder[];
    }>("/api/dashboard"),
  listCustomers: () => request<Customer[]>("/api/customers"),
  createCustomer: (body: {
    name: string;
    contactName: string;
    contactSurname?: string;
    contactGivenName?: string;
    phone: string;
    email: string;
    creditLimit: number;
    status?: Customer["status"];
  }) => request<Customer>("/api/customers", {
    method: "POST",
    body: JSON.stringify(body),
  }),
  updateCustomerStatus: (customerId: string, status: Customer["status"]) =>
    request<Customer>(`/api/customers/${customerId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
  listPricingRules: () => request<PricingRule[]>("/api/pricing-rules"),
  createPricingRule: (body: {
    name: string;
    productType: PricingRule["productType"];
    calculationType: PricingRule["calculationType"];
    value: number;
    priority?: number;
    status?: PricingRule["status"];
  }) => request<PricingRule>("/api/pricing-rules", {
    method: "POST",
    body: JSON.stringify(body),
  }),
  updatePricingRuleStatus: (ruleId: string, status: PricingRule["status"]) =>
    request<PricingRule>(`/api/pricing-rules/${ruleId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
  financeSummary: () => request<FinanceSummary>("/api/finance/summary"),
};

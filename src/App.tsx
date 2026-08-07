import {
  ArrowLeft,
  ArrowRight,
  AlertTriangle,
  BadgePercent,
  BedDouble,
  Bell,
  Building2,
  CalendarDays,
  ChartNoAxesCombined,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  CreditCard,
  Eye,
  EyeOff,
  FileText,
  Globe2,
  Heart,
  ImageOff,
  Landmark,
  LoaderCircle,
  LayoutDashboard,
  LogIn,
  LogOut,
  LockKeyhole,
  Luggage,
  Mail,
  MapPin,
  Minus,
  Plane,
  Phone,
  Plus,
  ReceiptText,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  TicketCheck,
  UserRound,
  Users,
  WalletCards,
  X,
} from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { convertDisplayAmount, formatCurrencyAmount, formatDisplayAmount } from "./currency";
import type {
  AccountProfile,
  AccountTraveler,
  AuthSession,
  Customer,
  DistributionOrder,
  DisplayCurrency,
  DisplayFxRates,
  FinanceSummary,
  FlightAfterSalesContext,
  FlightChangeOffer,
  FlightOffer,
  FavoriteHotel,
  HotelOffer,
  NationalityCatalog,
  NationalityOption,
  OrderBookingDetails,
  OrderStatus,
  PaymentMethod,
  PricingRule,
  RegistrationInput,
} from "./types";

type Page =
  | "dashboard"
  | "hotels"
  | "flights"
  | "orders"
  | "account"
  | "customers"
  | "pricing"
  | "finance";

type LocaleCode = "zh-CN" | "zh-TW" | "en";
type TripType = "oneway" | "roundtrip" | "multicity";
type PersonNameParts = { surname: string; givenName: string };
type OrderProductFilter = "all" | "hotel" | "flight";
type OrderStatusFilter = "all" | "pending" | "confirmed" | "aftersales" | OrderStatus;
type OrderDatePreset = "all" | "today" | "7d" | "30d" | "custom";

const joinPersonName = ({ surname, givenName }: PersonNameParts) => [surname.trim(), givenName.trim()].filter(Boolean).join(" ");
const isValidInternationalPhone = (value: string) => {
  const trimmed = value.trim();
  if (!/^\+?[0-9 ()-]+$/.test(trimmed)) return false;
  const digitCount = trimmed.replace(/\D/g, "").length;
  return digitCount >= 7 && digitCount <= 15;
};

const nationalityMemory = new Map<LocaleCode, NationalityCatalog>();

function useNationalityCatalog(locale: LocaleCode) {
  const [catalog, setCatalog] = useState<NationalityCatalog | undefined>(() => nationalityMemory.get(locale));
  const [error, setError] = useState("");
  useEffect(() => {
    const remembered = nationalityMemory.get(locale);
    if (remembered) {
      setCatalog(remembered);
      setError("");
      return;
    }
    let active = true;
    api.listNationalities(locale).then(result => {
      if (!active) return;
      nationalityMemory.set(locale, result);
      setCatalog(result);
      setError("");
    }).catch(reason => {
      if (!active) return;
      setError(reason instanceof Error ? reason.message : "国籍列表加载失败");
    });
    return () => { active = false; };
  }, [locale]);
  return { catalog, error };
}

function nationalityName(item: NationalityOption, locale: LocaleCode) {
  return locale === "en" ? item.nameEn : locale === "zh-TW" ? item.nameZhTw : item.nameZh;
}

function NationalitySelect({
  value,
  onChange,
  locale,
  catalog,
  error,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  locale: LocaleCode;
  catalog?: NationalityCatalog;
  error?: string;
  ariaLabel: string;
}) {
  const items = useMemo(() => [...(catalog?.items || [])].sort((left, right) =>
    nationalityName(left, locale).localeCompare(nationalityName(right, locale), locale)), [catalog, locale]);
  return <>
    <select aria-label={ariaLabel} value={value} onChange={event => onChange(event.target.value)} disabled={!catalog}>
      {!catalog && <option value={value}>{error || (locale === "en" ? "Loading nationalities…" : "正在加载完整国籍列表…")}</option>}
      {catalog && value && !catalog.items.some(item => item.code === value) && <option value={value}>{value}</option>}
      {items.map(item => <option key={item.code} value={item.code}>{nationalityName(item, locale)} ({item.code})</option>)}
    </select>
    <small className={error ? "reference-source error" : "reference-source"}>
      {error || (catalog ? `${catalog.source === "flink" ? "F-Link" : "ISO 3166"} · ${catalog.count} ${locale === "en" ? "entries" : "项"}` : "")}
    </small>
  </>;
}
const splitPersonName = (value: string): PersonNameParts => {
  const normalized = value.trim().replace("/", " ").replace(/\s+/g, " ");
  if (!normalized) return { surname: "", givenName: "" };
  const parts = normalized.split(" ");
  if (parts.length > 1) return { surname: parts[0], givenName: parts.slice(1).join(" ") };
  if (/^[\u3400-\u9fff]{2,}$/.test(normalized)) return { surname: normalized.slice(0, 1), givenName: normalized.slice(1) };
  return { surname: normalized, givenName: "" };
};

const rememberFavoriteHotelSearch = (hotelName: string) => {
  window.sessionStorage.setItem("fusiongo.favoriteHotelSearch", hotelName);
};

const localeNames: Record<LocaleCode, string> = {
  "zh-CN": "简中",
  "zh-TW": "繁中",
  en: "EN",
};

const shellCopy: Record<LocaleCode, {
  tenant: string;
  plan: string;
  environment: string;
  language: string;
  currency: string;
  currencyNote: string;
  nav: Record<"dashboard" | "hotels" | "flights" | "orders" | "customers" | "pricing" | "finance", string>;
}> = {
  "zh-CN": {
    tenant: "寰宇旅行",
    plan: "企业专业版",
    environment: "沙箱环境",
    language: "显示语言",
    currency: "显示币种",
    currencyNote: "偏好已保存；订单和结算始终保留供应商原币种，避免隐含换汇。",
    nav: { dashboard: "经营总览", hotels: "酒店预订", flights: "机票预订", orders: "订单中心", customers: "客户管理", pricing: "定价策略", finance: "财务结算" },
  },
  "zh-TW": {
    tenant: "寰宇旅行",
    plan: "企業專業版",
    environment: "沙盒環境",
    language: "顯示語言",
    currency: "顯示幣種",
    currencyNote: "偏好已儲存；訂單與結算始終保留供應商原幣種，避免隱含換匯。",
    nav: { dashboard: "營運總覽", hotels: "飯店預訂", flights: "機票預訂", orders: "訂單中心", customers: "客戶管理", pricing: "定價策略", finance: "財務結算" },
  },
  en: {
    tenant: "Global Travel",
    plan: "Enterprise Pro",
    environment: "Sandbox",
    language: "Language",
    currency: "Display currency",
    currencyNote: "Preference saved. Orders and settlement keep the supplier currency to avoid hidden FX conversion.",
    nav: { dashboard: "Overview", hotels: "Hotels", flights: "Flights", orders: "Bookings", customers: "Customers", pricing: "Pricing", finance: "Finance" },
  },
};

const money = formatCurrencyAmount;
type CurrencyContextValue = {
  displayCurrency: DisplayCurrency;
  fxRates?: DisplayFxRates;
  fxLoading: boolean;
  fxError: string;
};
const CurrencyContext = createContext<CurrencyContextValue>({
  displayCurrency: "CNY",
  fxLoading: true,
  fxError: "",
});
const useDisplayMoney = () => {
  const context = useContext(CurrencyContext);
  const convert = useCallback((value: number, sourceCurrency = "CNY") =>
    convertDisplayAmount(value, sourceCurrency, context.displayCurrency, context.fxRates), [context.displayCurrency, context.fxRates]);
  const format = useCallback((value: number, sourceCurrency = "CNY") =>
    formatDisplayAmount(value, sourceCurrency, context.displayCurrency, context.fxRates), [context.displayCurrency, context.fxRates]);
  return { ...context, convert, money: format };
};
const localDateValue = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const stayDateLabel = (value?: string) => value
  ? new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "short", timeZone: "UTC" })
    .format(new Date(`${value}T00:00:00Z`))
  : "待确认";

const statusLabels: Record<OrderStatus, string> = {
  PENDING_PAYMENT: "待支付",
  PROCESSING: "处理中",
  CONFIRMED: "已确认",
  TICKETED: "已出票",
  CHANGING: "改签中",
  CANCELLED: "已取消",
  REFUNDING: "退款中",
  REFUNDED: "已退款",
  FAILED: "处理失败",
};
const statusLabelsEn: Record<OrderStatus, string> = {
  PENDING_PAYMENT: "Pending payment",
  PROCESSING: "Processing",
  CONFIRMED: "Confirmed",
  TICKETED: "Ticketed",
  CHANGING: "Changing",
  CANCELLED: "Cancelled",
  REFUNDING: "Refunding",
  REFUNDED: "Refunded",
  FAILED: "Failed",
};

const pendingOrderStatuses: OrderStatus[] = ["PENDING_PAYMENT", "PROCESSING"];
const confirmedOrderStatuses: OrderStatus[] = ["CONFIRMED", "TICKETED"];
const afterSalesOrderStatuses: OrderStatus[] = ["CHANGING", "CANCELLED", "REFUNDING", "REFUNDED", "FAILED"];
const concreteOrderStatuses: OrderStatus[] = [
  "PENDING_PAYMENT",
  "PROCESSING",
  "CONFIRMED",
  "TICKETED",
  "CHANGING",
  "CANCELLED",
  "REFUNDING",
  "REFUNDED",
  "FAILED",
];

const dateDaysAgo = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return localDateValue(date);
};

const orderCreatedDateValue = (order: DistributionOrder) => {
  const value = order.createdAtIso || order.createdAt;
  if (value === "刚刚" || value.includes("今天")) return localDateValue(new Date());
  if (value.includes("昨天")) return dateDaysAgo(1);
  const isoDate = /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0];
  if (isoDate) return isoDate;
  const monthDay = /^(\d{2})\/(\d{2})/.exec(value);
  if (monthDay) return `${new Date().getFullYear()}-${monthDay[1]}-${monthDay[2]}`;
  return "";
};

const orderMatchesStatusFilter = (order: DistributionOrder, filter: OrderStatusFilter) => {
  if (filter === "pending") return pendingOrderStatuses.includes(order.status);
  if (filter === "confirmed") return confirmedOrderStatuses.includes(order.status);
  if (filter === "aftersales") return afterSalesOrderStatuses.includes(order.status);
  if (filter === "all") return true;
  return order.status === filter;
};

const downloadOrderDocument = (
  orderId: string,
  type: "confirmation" | "receipt" | "ticket",
) => {
  const anchor = document.createElement("a");
  anchor.href = `/api/orders/${encodeURIComponent(orderId)}/documents/${type}`;
  anchor.download = "";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
};

function StatusPill({ status, locale = "zh-CN" }: { status: OrderStatus; locale?: LocaleCode }) {
  return <span className={`status status-${status.toLowerCase()}`}>{locale === "en" ? statusLabelsEn[status] : statusLabels[status]}</span>;
}

function SimulationNotice({ offer }: { offer: HotelOffer }) {
  if (offer.inventorySource !== "simulation") return null;
  return <div className="simulation-notice" role="status">
    <AlertTriangle size={19} />
    <span><strong>Sandbox Simulation</strong><small>G-Link account has no available test inventory. This room type is for validating booking, payment, and order status flows only, not real inventory.</small></span>
  </div>;
}

function Shell({
  page,
  setPage,
  locale,
  setLocale,
  displayCurrency,
  setDisplayCurrency,
  accountIdentity,
  authSession,
  authPromptOpen,
  authBusy,
  authError,
  onAuthPromptChange,
  onClearAuthError,
  onLogin,
  onRegister,
  onLogout,
  children,
}: {
  page: Page;
  setPage: (page: Page) => void;
  locale: LocaleCode;
  setLocale: (locale: LocaleCode) => void;
  displayCurrency: DisplayCurrency;
  setDisplayCurrency: (currency: DisplayCurrency) => void;
  accountIdentity: Pick<AccountProfile, "name" | "email" | "avatarUrl">;
  authSession?: AuthSession;
  authPromptOpen: boolean;
  authBusy: boolean;
  authError: string;
  onAuthPromptChange: (open: boolean) => void;
  onClearAuthError: () => void;
  onLogin: (credentials?: { email: string; password: string }) => void;
  onRegister: (input: RegistrationInput) => void;
  onLogout: () => void;
  children: React.ReactNode;
}) {
  const { fxRates, fxLoading, fxError } = useContext(CurrencyContext);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [preferenceOpen, setPreferenceOpen] = useState<"language" | "currency" | "">("");
  const [tenantOpen, setTenantOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const currencyPreferenceRef = useRef<HTMLDivElement>(null);
  const [notificationOrders, setNotificationOrders] = useState<DistributionOrder[]>([]);
  const [authView, setAuthView] = useState<"signin" | "register">("signin");
  const [authFormError, setAuthFormError] = useState("");
  const [showSignInPassword, setShowSignInPassword] = useState(false);
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [signInForm, setSignInForm] = useState({ email: "", password: "" });
  const [registrationForm, setRegistrationForm] = useState({ surname: "", givenName: "", email: "", phone: "", password: "", confirmPassword: "", acceptedTerms: false });
  const copy = shellCopy[locale];
  const english = locale === "en";
  const authenticated = Boolean(authSession?.authenticated);
  useEffect(() => {
    if (!authenticated) {
      setNotificationOrders([]);
      return;
    }
    let active = true;
    api.listOrders().then(orders => {
      if (active) setNotificationOrders(orders.filter(order => ["PENDING_PAYMENT", "PROCESSING", "CHANGING", "REFUNDING"].includes(order.status)));
    }).catch(() => { if (active) setNotificationOrders([]); });
    return () => { active = false; };
  }, [authenticated]);
  useEffect(() => {
    if (authPromptOpen) return;
    setAuthView("signin");
    setAuthFormError("");
    setShowSignInPassword(false);
    setShowRegPassword(false);
    setSignInForm({ email: "", password: "" });
    setRegistrationForm({ surname: "", givenName: "", email: "", phone: "", password: "", confirmPassword: "", acceptedTerms: false });
  }, [authPromptOpen]);
  useEffect(() => {
    if (preferenceOpen !== "currency") return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!currencyPreferenceRef.current?.contains(event.target as Node)) setPreferenceOpen("");
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreferenceOpen("");
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [preferenceOpen]);
  const switchAuthView = (view: "signin" | "register") => {
    setAuthView(view);
    setAuthFormError("");
    onClearAuthError();
  };
  const consumerMode = ["hotels", "flights", "orders", "account"].includes(page);
  const nav = [
    { id: "hotels" as Page, label: copy.nav.hotels, shortLabel: copy.nav.hotels, icon: BedDouble },
    { id: "flights" as Page, label: copy.nav.flights, shortLabel: copy.nav.flights, icon: Plane },
    { id: "orders" as Page, label: copy.nav.orders, shortLabel: copy.nav.orders, icon: TicketCheck },
    { id: "dashboard" as Page, label: copy.nav.dashboard, shortLabel: copy.nav.dashboard, icon: LayoutDashboard },
    { id: "customers" as Page, label: copy.nav.customers, shortLabel: copy.nav.customers, icon: Users },
    { id: "pricing" as Page, label: copy.nav.pricing, shortLabel: copy.nav.pricing, icon: BadgePercent },
    { id: "finance" as Page, label: copy.nav.finance, shortLabel: copy.nav.finance, icon: WalletCards },
  ].filter(item => {
    if (!authenticated) return item.id === "hotels" || item.id === "flights";
    if (authSession?.user?.role === "member") return item.id === "hotels" || item.id === "flights" || item.id === "orders" || item.id === "account";
    return true;
  });
  return (
    <div className={`app-shell ${consumerMode ? "consumer-shell" : ""}`}>
      <main className="main">
        <header className="booking-header glass glass-dark">
          <div className="header-primary">
            <button className="top-brand" onClick={() => setPage("hotels")} aria-label={english ? "Open hotel search" : "Open Hotel Search"}>
              <span className="brand-mark">F</span>
              <span><strong>FusionGo</strong><small>{english ? "Global travel distribution" : "Global Travel Distribution Platform"}</small></span>
            </button>
            {authenticated && <button className="top-tenant" aria-label={english ? `Current company: ${copy.tenant}` : `Current: ${copy.tenant}`} aria-haspopup="menu" aria-expanded={tenantOpen} onClick={() => { setTenantOpen(value => !value); setHelpOpen(false); setNotificationsOpen(false); setAccountOpen(false); setPreferenceOpen(""); }}>
              <span className="tenant-logo"><Building2 size={17} /></span>
              <span><strong>{copy.tenant}</strong><small>{copy.plan}</small></span>
              <ChevronDown size={14} />
            </button>}
            <div className="top-actions">
              <span className="environment"><i /> {copy.environment}</span>
              <div className="utility-control" ref={currencyPreferenceRef}>
                <button className="header-utility" aria-label={`${copy.currency}：${displayCurrency}`} aria-haspopup="menu" aria-expanded={preferenceOpen === "currency"} onClick={() => { setTenantOpen(false); setHelpOpen(false); setNotificationsOpen(false); setPreferenceOpen(value => value === "currency" ? "" : "currency"); }}>{displayCurrency}<ChevronDown size={13} /></button>
                {preferenceOpen === "currency" && <div className="preference-popover glass glass-light" role="menu" aria-label={copy.currency}>
                  <header><strong>{copy.currency}</strong><button onClick={() => setPreferenceOpen("")} aria-label={english ? "Close" : "Close"}><X size={16} /></button></header>
                  {(["CNY", "USD", "HKD", "SGD"] as DisplayCurrency[]).map(currency => <button key={currency} role="menuitemradio" aria-checked={displayCurrency === currency} onClick={() => { setDisplayCurrency(currency); setPreferenceOpen(""); }}><span><strong>{currency}</strong><small>{english ? { CNY: "Chinese Yuan", USD: "US Dollar", HKD: "Hong Kong Dollar", SGD: "Singapore Dollar" }[currency] : { CNY: "CNY", USD: "US Dollar", HKD: "HKD", SGD: "Singapore Dollar" }[currency]}</small></span>{displayCurrency === currency && <Check size={16} />}</button>)}
                  <p aria-live="polite">{fxRates
                    ? english
                      ? `Reference rate: ${fxRates.source}, ${fxRates.date}. Amounts marked ≈ are display estimates; bookings and settlement remain in supplier currency.`
                      : `Reference rate: ${fxRates.source}, ${fxRates.date}. Amounts marked "≈" are for display only; orders and settlements use supplier's original currency.`
                    : fxLoading
                      ? english ? "Loading reference rates…" : "Fetching reference rate..."
                      : english ? `Rate unavailable: ${fxError}. Original supplier currencies are shown.` : `Exchange rate unavailable: ${fxError}. Showing supplier's original currency.`}</p>
                </div>}
              </div>
              <div className="utility-control">
                <button className="header-utility" aria-label={`${copy.language}：${localeNames[locale]}`} aria-haspopup="menu" aria-expanded={preferenceOpen === "language"} onClick={() => { setTenantOpen(false); setHelpOpen(false); setNotificationsOpen(false); setPreferenceOpen(value => value === "language" ? "" : "language"); }}><Globe2 size={16} />{localeNames[locale]}<ChevronDown size={13} /></button>
                {preferenceOpen === "language" && <div className="preference-popover glass glass-light" role="menu" aria-label={copy.language}>
                  <header><strong>{copy.language}</strong><button onClick={() => setPreferenceOpen("")} aria-label={english ? "Close" : "Close"}><X size={16} /></button></header>
                  {([
                    ["zh-CN", "Simplified Chinese"],
                    ["zh-TW", "Traditional Chinese"],
                    ["en", "English"],
                  ] as Array<[LocaleCode, string]>).map(([code, label]) => <button key={code} role="menuitemradio" aria-checked={locale === code} onClick={() => { setLocale(code); setPreferenceOpen(""); }}><span><strong>{label}</strong><small>{code}</small></span>{locale === code && <Check size={16} />}</button>)}
                </div>}
              </div>
              <button className="icon-button" aria-label={english ? "Help and support" : "Help & Support"} aria-expanded={helpOpen} onClick={() => { setTenantOpen(false); setPreferenceOpen(""); setNotificationsOpen(false); setHelpOpen(value => !value); }}><CircleHelp size={19} /></button>
              {authenticated && <button className="icon-button" aria-label={english ? "Notifications" : "Notifications"} aria-expanded={notificationsOpen} onClick={() => { setTenantOpen(false); setHelpOpen(false); setPreferenceOpen(""); setAccountOpen(false); setNotificationsOpen(value => !value); }}><Bell size={19} />{notificationOrders.length > 0 && <b>{notificationOrders.length}</b>}</button>}
              {authenticated ? <button className="header-profile" onClick={() => { setAccountOpen(value => !value); setTenantOpen(false); setHelpOpen(false); setNotificationsOpen(false); setPreferenceOpen(""); }} aria-haspopup="menu" aria-expanded={accountOpen} aria-label={english ? "Open account menu" : "Open Account Menu"}>
                <span>{accountIdentity.avatarUrl ? <img src={accountIdentity.avatarUrl} alt="" /> : accountIdentity.name.slice(0, 1)}</span><strong>{accountIdentity.name}</strong><ChevronDown size={14} />
              </button> : <button className="header-sign-in" onClick={() => onAuthPromptChange(true)}><LogIn size={16} />{english ? "Sign in" : "Sign In"}</button>}
            </div>
            {authenticated && accountOpen && <div className="notification-popover account-popover glass glass-light" role="menu" aria-label={english ? "Account menu" : "Account Menu"}>
              <div className="account-popover-identity"><span>{accountIdentity.avatarUrl ? <img src={accountIdentity.avatarUrl} alt="" /> : accountIdentity.name.slice(0, 1)}</span><div><strong>{accountIdentity.name}</strong><small>{accountIdentity.email}</small></div></div>
              <button role="menuitem" onClick={() => { setAccountOpen(false); setPage("account"); }}><UserRound size={17} /><span>{english ? "Account settings" : "Account Settings"}</span></button>
              <button className="logout-menu-item" role="menuitem" onClick={() => { setAccountOpen(false); onLogout(); }} disabled={authBusy}><LogOut size={17} /><span>{english ? "Sign out" : "Sign Out"}</span></button>
            </div>}
            {authenticated && notificationsOpen && <div className="notification-popover glass glass-light" role="dialog" aria-label={english ? "Notification center" : "Notification Center"}>
              <div><strong>{english ? "Notification center" : "Notification Center"}</strong><button className="drawer-close" onClick={() => setNotificationsOpen(false)} aria-label={english ? "Close notifications" : "Close Notifications"}><X size={17} /></button></div>
              {notificationOrders.length ? notificationOrders.map(order => <button key={order.id} onClick={() => { setNotificationsOpen(false); setPage("orders"); }}><TicketCheck size={17} /><span><strong>{order.id} · {locale === "en" ? statusLabelsEn[order.status] : statusLabels[order.status]}</strong><small>{order.title} · {money(order.amount, order.currency)}</small></span></button>) : <p className="header-popover-copy">{english ? "No bookings currently need attention." : "No pending orders."}</p>}
            </div>}
            {authenticated && tenantOpen && <div className="notification-popover tenant-popover glass glass-light" role="menu" aria-label={english ? "Company menu" : "Organization Menu"}><div><strong>{copy.tenant}</strong><button className="drawer-close" onClick={() => setTenantOpen(false)} aria-label={english ? "Close company menu" : "Close Organization Menu"}><X size={17} /></button></div><button role="menuitem" onClick={() => { setTenantOpen(false); setPage("account"); }}><UserRound size={17} /><span><strong>{english ? "Company and account settings" : "Organization & Account Settings"}</strong><small>{english ? "Profile, security, and notifications" : "Profile, security, and notification preferences"}</small></span></button><button role="menuitem" onClick={() => { setTenantOpen(false); setPage("customers"); }}><Users size={17} /><span><strong>{english ? "Customer management" : "Customers"}</strong><small>{english ? "Status, contacts, and credit limits" : "Customer status, contacts, and credit limits"}</small></span></button></div>}
            {helpOpen && <div className="notification-popover help-popover glass glass-light" role="dialog" aria-label={english ? "Help and support" : "Help & Support"}><div><strong>{english ? "Help and support" : "Help & Support"}</strong><button className="drawer-close" onClick={() => setHelpOpen(false)} aria-label={english ? "Close help" : "Close Help"}><X size={17} /></button></div><p className="header-popover-copy">{english ? "You are in Sandbox. For booking issues, record the booking number, requestId, and traceId before checking supplier status in Bookings." : "Sandbox environment. For order exceptions, record order ID, requestId, and traceId first, then check supplier status in Bookings."}</p><button onClick={() => { setHelpOpen(false); setPage("orders"); }}><TicketCheck size={17} /><span><strong>{english ? "Go to bookings" : "Go to Bookings"}</strong><small>{english ? "Check bookings and supplier sync status" : "Check order and supplier sync status"}</small></span></button>{authSession?.user?.role === "admin" && <button onClick={() => { setHelpOpen(false); setPage("dashboard"); }}><CircleHelp size={17} /><span><strong>{english ? "Return to overview" : "Back to Overview"}</strong><small>{english ? "Review pending issues and quick actions" : "View pending exceptions and shortcuts"}</small></span></button>}</div>}
          </div>
          <div className="header-secondary">
            <nav className="booking-nav" aria-label={english ? "Main navigation" : "Main Navigation"}>
              {nav.map(({ id, label, shortLabel, icon: Icon }) => (
                <button
                  key={id}
                  className={page === id ? "active" : ""}
                  onClick={() => setPage(id)}
                  aria-current={page === id ? "page" : undefined}
                >
                  <Icon size={17} />
                  <span className="nav-full-label">{label}</span>
                  <span className="nav-short-label">{shortLabel}</span>
                </button>
              ))}
            </nav>
            {authenticated && <button className="header-search" onClick={() => setPage("orders")} aria-label={english ? "Search bookings, customers, or destinations" : "Search orders, customers, or destinations"}>
              <Search size={16} /><span>{english ? "Search bookings, customers, or destinations" : "Search orders, customers, or destinations"}</span><kbd>⌘ K</kbd>
            </button>}
          </div>
        </header>
        <div className={`page ${consumerMode ? "consumer-page" : ""}`}>{children}</div>
        {authPromptOpen && <div className="modal-layer" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target && !authBusy) onAuthPromptChange(false); }}>
          <form className="booking-modal auth-modal glass glass-light" role="dialog" aria-modal="true" aria-labelledby="auth-dialog-title" onSubmit={event => {
            event.preventDefault();
            setAuthFormError("");
            if (authView === "signin") {
              onLogin(signInForm);
              return;
            }
            if (registrationForm.password !== registrationForm.confirmPassword) {
              setAuthFormError(english ? "The passwords do not match." : "Passwords do not match");
              return;
            }
            if (!registrationForm.acceptedTerms) {
              setAuthFormError(english ? "Please accept the booking terms and privacy notice." : "Please read and agree to booking terms and privacy policy");
              return;
            }
            onRegister({
              surname: registrationForm.surname,
              givenName: registrationForm.givenName,
              email: registrationForm.email,
              phone: registrationForm.phone,
              password: registrationForm.password,
              language: locale,
              acceptedTerms: true,
            });
          }}>
            <button type="button" className="modal-close" onClick={() => onAuthPromptChange(false)} disabled={authBusy} aria-label={english ? "Close sign-in dialog" : "Close Login"}><X size={19} /></button>
            <p className="eyebrow">SECURE BOOKING</p>
            <h2 id="auth-dialog-title">{authView === "signin" ? english ? "Sign in to book" : "Sign in to book" : english ? "Create your account" : "Create New Account"}</h2>
            <p className="modal-subtitle">{authView === "signin"
              ? english ? "Use your email and password to access bookings and traveler profiles." : "Access bookings, frequent travelers, and account profile with email and password."
              : english ? "Names are stored separately to match passports and supplier booking requirements." : "Surname and given name are saved separately to meet passport and supplier booking requirements."}</p>

            {authView === "signin" ? <div className="auth-form-grid">
              <label><span>{english ? "Email address" : "Email"}</span><input type="email" autoComplete="email" required value={signInForm.email} onChange={event => setSignInForm(current => ({ ...current, email: event.target.value }))} /></label>
              <label className="password-field"><span>{english ? "Password" : "Password"}</span><div className="password-input-wrap"><input type={showSignInPassword ? "text" : "password"} autoComplete="current-password" required minLength={8} maxLength={72} value={signInForm.password} onChange={event => setSignInForm(current => ({ ...current, password: event.target.value }))} /><button type="button" className="password-toggle" onClick={() => setShowSignInPassword(v => !v)} tabIndex={-1} aria-label={showSignInPassword ? (english ? "Hide password" : "Hide Password") : (english ? "Show password" : "Show Password")}>{showSignInPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div><div className="auth-link-row"><button type="button" className="forgot-password" onClick={() => setAuthFormError(english ? "Contact your administrator to reset your password." : "Please contact admin to reset password.")}>{english ? "Forgot password?" : "Forgot password?"}</button><button type="button" className="auth-switch-link" onClick={() => switchAuthView("register")}>{english ? "Create account" : "Create account"}</button></div></label>
            </div> : <div className="auth-form-grid two-columns">
              <label><span>{english ? "Surname" : "Surname"}</span><input autoComplete="family-name" required maxLength={50} value={registrationForm.surname} onChange={event => setRegistrationForm(current => ({ ...current, surname: event.target.value }))} /></label>
              <label><span>{english ? "Given name" : "Given Name"}</span><input autoComplete="given-name" required maxLength={50} value={registrationForm.givenName} onChange={event => setRegistrationForm(current => ({ ...current, givenName: event.target.value }))} /></label>
              <label className="wide"><span>{english ? "Email address" : "Email"}</span><input type="email" autoComplete="email" required maxLength={120} value={registrationForm.email} onChange={event => setRegistrationForm(current => ({ ...current, email: event.target.value }))} /></label>
              <label className="wide"><span>{english ? "Mobile number" : "Phone Number"}</span><input type="tel" autoComplete="tel" required pattern="[+]?[0-9][0-9 -]{6,19}" value={registrationForm.phone} onChange={event => setRegistrationForm(current => ({ ...current, phone: event.target.value }))} /></label>
              <label className="password-field"><span>{english ? "Password" : "Password"}</span><div className="password-input-wrap"><input type={showRegPassword ? "text" : "password"} autoComplete="new-password" required minLength={8} maxLength={72} pattern="(?=.*[A-Za-z])(?=.*[0-9]).{8,72}" value={registrationForm.password} onChange={event => setRegistrationForm(current => ({ ...current, password: event.target.value }))} /><button type="button" className="password-toggle" onClick={() => setShowRegPassword(v => !v)} tabIndex={-1} aria-label={showRegPassword ? (english ? "Hide password" : "Hide Password") : (english ? "Show password" : "Show Password")}>{showRegPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div><small>{english ? "8–72 characters with letters and numbers" : "8–72 chars, must include letters and numbers"}</small></label>
              <label className="password-field"><span>{english ? "Confirm password" : "Confirm Password"}</span><div className="password-input-wrap"><input type={showRegPassword ? "text" : "password"} autoComplete="new-password" required minLength={8} maxLength={72} value={registrationForm.confirmPassword} onChange={event => setRegistrationForm(current => ({ ...current, confirmPassword: event.target.value }))} /><button type="button" className="password-toggle" onClick={() => setShowRegPassword(v => !v)} tabIndex={-1} aria-label={showRegPassword ? (english ? "Hide password" : "Hide Password") : (english ? "Show password" : "Show Password")}>{showRegPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label>
              <label className="auth-terms wide"><input type="checkbox" checked={registrationForm.acceptedTerms} onChange={event => setRegistrationForm(current => ({ ...current, acceptedTerms: event.target.checked }))} /><span>{english ? "I agree to the booking terms and privacy notice." : "I have read and agree to the booking terms and privacy policy."}</span></label>
              <div className="auth-link-row wide"><button type="button" className="auth-switch-link" onClick={() => switchAuthView("signin")}>{english ? "Already have an account? Sign in" : "Already have an account? Sign in"}</button></div>
            </div>}
            {(authFormError || authError) && <p className="error-copy" role="alert">{authFormError || authError}</p>}
            <div className="modal-actions auth-actions"><button className="primary" disabled={authBusy}>{authBusy ? <><LoaderCircle className="spinner" size={17} />{authView === "signin" ? english ? "Signing in…" : "Signing in..." : english ? "Creating account…" : "Creating account..."}</> : authView === "signin" ? <><LogIn size={17} />{english ? "Log in" : "Sign In"}</> : <><UserRound size={17} />{english ? "Create account" : "Register & Sign In"}</>}</button></div>
            {authView === "signin" && <button type="button" className="acceptance-login" onClick={() => onLogin()} disabled={authBusy}><UserRound size={14} />{english ? "Use the local acceptance account" : "Use local test account"}</button>}
            <small className="auth-environment-note">{english ? "Self-registration is available only in local and sandbox environments. Production uses corporate SSO." : "Self-registration is for local and sandbox only; production requires enterprise SSO."}</small>
          </form>
        </div>}
      </main>
    </div>
  );
}

function Dashboard({ navigate, locale, identityName }: { navigate: (page: Page) => void; locale: LocaleCode; identityName: string }) {
  const english = locale === "en";
  const { displayCurrency, convert, money } = useDisplayMoney();
  const [data, setData] = useState<Awaited<ReturnType<typeof api.dashboard>>>();
  const [favoriteHotels, setFavoriteHotels] = useState<FavoriteHotel[]>([]);
  const [favoritesLoading, setFavoritesLoading] = useState(true);
  useEffect(() => { api.dashboard().then(setData); }, []);
  useEffect(() => {
    let active = true;
    api.listFavoriteHotels().then(items => { if (active) setFavoriteHotels(items); })
      .catch(() => undefined)
      .finally(() => { if (active) setFavoritesLoading(false); });
    return () => { active = false; };
  }, []);
  const convertedTodaySales = data
    ? Object.entries(data.salesTodayByCurrency).map(([currency, amount]) => convert(amount, currency))
    : [];
  const salesToday = data
    ? convertedTodaySales.every(amount => amount !== undefined)
      ? formatCurrencyAmount(convertedTodaySales.reduce((sum, amount) => sum + (amount || 0), 0), displayCurrency)
      : Object.entries(data.salesTodayByCurrency).map(([currency, amount]) => money(amount, currency)).join(" · ") || formatCurrencyAmount(0, displayCurrency)
    : "—";
  const stats = [
    { label: "Today's Transaction Volume", value: salesToday, note: "Today's valid orders only", icon: CreditCard, tone: "blue" },
    { label: "Today's Orders", value: data?.ordersToday ?? "—", note: "Created today", icon: TicketCheck, tone: "violet" },
    { label: "Booking Success Rate", value: data ? `${data.successRate}%` : "—", note: "Confirmed or ticketed today", icon: ShieldCheck, tone: "green" },
    { label: "Pending Exceptions", value: data?.alerts ?? "—", note: "All pending order items", icon: Bell, tone: "orange" },
  ];
  const trendMax = Math.max(1, ...(data?.trend.flatMap(item => [item.hotels, item.flights]) || [1]));
  const todayHeading = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date());
  return (
    <>
      <section className="page-heading">
        <div><p className="eyebrow">{todayHeading}</p><h1>{`Good morning${identityName ? `, ${identityName}` : ""}`}</h1><p>Today's performance and to-do items from the business database.</p></div>
        <button className="primary" onClick={() => navigate("hotels")}><Search size={17} />New Booking</button>
      </section>
      <section className="stat-grid">
        {stats.map(({ label, value, note, icon: Icon, tone }) => (
          <article className="stat-card" key={label}>
            <div className={`stat-icon ${tone}`}><Icon size={20} /></div>
            <span>{label}</span><strong>{value}</strong><small className={tone === "orange" && Number(value) > 0 ? "warn" : ""}>{note}</small>
          </article>
        ))}
      </section>
      <section className="dashboard-favorites panel glass glass-light" aria-busy={favoritesLoading}>
        <div className="panel-title"><div><h2>My Favorite Hotels</h2><p>Personal hotel preferences · Prices and availability confirmed in real-time upon search</p></div><button className="text-button" onClick={() => { window.sessionStorage.setItem("fusiongo.accountSection", "favorites"); navigate("account"); }}>Manage Favorites →</button></div>
        {favoritesLoading ? <div className="favorite-hotel-grid"><div className="favorite-hotel-card skeleton-card" /><div className="favorite-hotel-card skeleton-card" /></div> : favoriteHotels.length ? <div className="favorite-hotel-grid">{favoriteHotels.slice(0, 4).map(hotel => <article className="favorite-hotel-card" key={hotel.id}>
          {hotel.image ? <img src={hotel.image} alt="" /> : <div className="favorite-image-placeholder"><Building2 size={22} /></div>}
          <div><span className="favorite-mark"><Heart size={13} fill="currentColor" />Favorited</span><h3>{hotel.name}</h3><p>{[hotel.city, hotel.district].filter(Boolean).join(" · ") || "Supplier did not provide location"}</p><button className="secondary" onClick={() => { rememberFavoriteHotelSearch(hotel.name); navigate("hotels"); }}>Search Live Rates</button></div>
        </article>)}</div> : <div className="favorite-empty"><Heart size={22} /><div><strong>No favorite hotels yet</strong><span>Save a property from hotel search results to see it here.</span></div><button className="secondary" onClick={() => navigate("hotels")}>Find hotels</button></div>}
      </section>
      <section className="dashboard-grid">
        <article className="panel performance">
          <div className="panel-title"><div><h2>Booking trend</h2><p>Actual hotel and flight booking counts over the last 7 days</p></div><span className="reference-source">Live database · Last 7 days</span></div>
          <div className="chart-legend"><span><i className="hotel-dot" />Hotels</span><span><i className="flight-dot" />Flights</span></div>
          <div className="chart">
            {(data?.trend || []).map(item => <div key={item.date} className="chart-column"><div className="bars"><i title={`Hotels: ${item.hotels}`} style={{ height: `${item.hotels ? Math.max(8, item.hotels / trendMax * 100) : 2}%` }} /><b title={`Flights: ${item.flights}`} style={{ height: `${item.flights ? Math.max(8, item.flights / trendMax * 100) : 2}%` }} /></div><span>{new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric" }).format(new Date(`${item.date}T12:00:00`))}</span></div>)}
          </div>
        </article>
        <article className="panel quick-actions">
          <div className="panel-title"><div><h2>Quick Actions</h2><p>Common business shortcuts</p></div></div>
          <button onClick={() => navigate("hotels")}><span className="action-icon hotel"><BedDouble size={21} /></span><div><strong>Book a hotel</strong><small>Live global hotel inventory</small></div><span>→</span></button>
          <button onClick={() => navigate("flights")}><span className="action-icon flight"><Plane size={21} /></span><div><strong>Book a flight</strong><small>International flights and live fares</small></div><span>→</span></button>
          <button onClick={() => navigate("orders")}><span className="action-icon order"><TicketCheck size={21} /></span><div><strong>Process bookings</strong><small>{data ? `${data.alerts} booking${data.alerts === 1 ? "" : "s"} need attention` : "Loading open bookings"}</small></div><span>→</span></button>
        </article>
      </section>
      <OrderTable orders={data?.recentOrders ?? []} onAll={() => navigate("orders")} locale={locale} />
    </>
  );
}

function OrderTable({ orders, onAll, onSelect, locale = "zh-CN" }: { orders: DistributionOrder[]; onAll?: () => void; onSelect?: (order: DistributionOrder) => void; locale?: LocaleCode }) {
  const english = locale === "en";
  return (
    <section className="panel orders-panel">
      <div className="panel-title"><div><h2>Latest bookings</h2><p>FCG supplier status synchronized in real time</p></div>{onAll && <button className="text-button" onClick={onAll}>View all →</button>}</div>
      <div className="table-wrap"><table><thead><tr><th>Booking ID</th><th>Product</th><th>Customer</th><th>Amount</th><th>Status</th><th>Created</th>{onSelect && <th>Action</th>}</tr></thead>
      <tbody>{orders.length ? orders.map(order => <tr key={order.id}><td><strong>{order.id}</strong><small>{order.supplierOrderNo || "Awaiting supplier order ID"}</small></td><td><div className="product-cell"><span className={order.productType}><>{order.productType === "hotel" ? <BedDouble size={16} /> : <Plane size={16} />}</></span><div>{order.title}<small>{order.subtitle}</small></div></div></td><td>{order.customer}</td><td><strong>{money(order.amount, order.currency)}</strong></td><td><StatusPill status={order.status} locale={locale} /></td><td>{order.createdAt}</td>{onSelect && <td><button className="table-action" onClick={() => onSelect(order)}>View Detail</button></td>}</tr>) : <tr><td colSpan={onSelect ? 7 : 6} className="empty-table-cell">No orders match the current filters.</td></tr>}</tbody></table></div>
    </section>
  );
}

function BookingProgress({ current, labels }: { current: number; labels: string[] }) {
  return <ol className="booking-progress" aria-label="预订进度">{labels.map((label, index) => <li className={index < current ? "complete" : index === current ? "active" : ""} key={label}><span>{index < current ? <Check size={14} /> : index + 1}</span><strong>{label}</strong></li>)}</ol>;
}

function BookingResult({ order, type, onDetails, onRestart }: { order: DistributionOrder; type: "hotel" | "flight"; onDetails: () => void; onRestart: () => void }) {
  const flight = type === "flight";
  const timeline = flight ? ["运价验证通过", "订单创建成功", "支付已受理", "等待航司出票"] : ["库存与价格确认", "订单创建成功", "支付已受理", "等待酒店确认"];
  return <section className="booking-flow-page result-page" aria-live="polite">
    <BookingProgress current={4} labels={flight ? ["查询", "选择航班", "乘机人", "支付", "出票确认", "订单详情"] : ["查询", "搜索结果", "酒店详情", "下单支付", "预订确认", "订单详情"]} />
    <div className="result-hero glass glass-light"><span className="result-icon"><CheckCircle2 size={34} /></span><p className="eyebrow">{flight ? "TICKETING IN PROGRESS" : "RESERVATION PROCESSING"}</p><h1>{flight ? "支付成功，正在出票" : "预订已提交，等待酒店确认"}</h1><p>订单号 <strong>{order.id}</strong>，最新状态将通过短信与站内通知同步。</p><div className="result-amount"><span>已支付</span><strong>{money(order.amount, order.currency)}</strong></div></div>
    <div className="result-timeline">{timeline.map((item, index) => <div className={index < 3 ? "done" : "waiting"} key={item}><span>{index < 3 ? <Check size={15} /> : <Clock3 size={15} />}</span><div><strong>{item}</strong><small>{index < 3 ? "Completed" : "Usually takes 1–10 minutes"}</small></div></div>)}</div>
    <div className="confirmation-panel glass glass-light"><div><Mail size={18} /><span><strong>Order Submitted</strong><small>{flight ? "E-ticket will be available for download after issuance" : "Confirmation email and check-in voucher will be generated after hotel confirms"}</small></span></div><button className="secondary" onClick={onDetails}><FileText size={16} />View Order Progress</button></div>
    <div className="result-actions"><button className="secondary" onClick={onRestart}>Continue Searching</button><button className="primary" onClick={onDetails}>View Order Detail<ChevronRight size={17} /></button></div>
  </section>;
}

function FlightAfterSalesPanel({
  order,
  onClose,
  onOrderChange,
}: {
  order: DistributionOrder;
  onClose: () => void;
  onOrderChange?: (order: DistributionOrder) => void;
}) {
  const [context, setContext] = useState<FlightAfterSalesContext>();
  const [mode, setMode] = useState<"change" | "refund">("change");
  const [offers, setOffers] = useState<FlightChangeOffer[]>([]);
  const [selectedOffer, setSelectedOffer] = useState("");
  const [passengerCodes, setPassengerCodes] = useState<string[]>([]);
  const [segmentIds, setSegmentIds] = useState<string[]>([]);
  const [targetDate, setTargetDate] = useState("");
  const [reason, setReason] = useState("Itinerary Adjustment");
  const [afterSalesType, setAfterSalesType] = useState<1 | 2>(1);
  const [evidenceText, setEvidenceText] = useState("");
  const [contactSurname, setContactSurname] = useState("");
  const [contactGivenName, setContactGivenName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [loading, setLoading] = useState("");
  const [error, setError] = useState("");
  const syncOrder = async () => {
    const latest = await api.getOrder(order.id);
    onOrderChange?.(latest);
  };
  const load = useCallback(async () => {
    setLoading("load"); setError("");
    try {
      const [data, bookingDetails] = await Promise.all([
        api.getFlightAfterSales(order.id),
        api.getOrderDetails(order.id),
      ]);
      setContext(data);
      const savedContact = bookingDetails.contactSurname || bookingDetails.contactGivenName
        ? { surname: bookingDetails.contactSurname || "", givenName: bookingDetails.contactGivenName || "" }
        : splitPersonName(bookingDetails.contactName);
      setContactSurname(savedContact.surname);
      setContactGivenName(savedContact.givenName);
      setContactPhone(bookingDetails.phone || "");
      setContactEmail(bookingDetails.email || "");
      setPassengerCodes(current => current.length ? current : data.passengers[0]?.passengerCode ? [data.passengers[0].passengerCode] : []);
      setSegmentIds(current => current.length ? current : data.segments[0]?.segmentId ? [data.segments[0].segmentId] : []);
      setTargetDate(current => current || (() => {
        const base = new Date(`${data.segments[0]?.date || localDateValue(new Date())}T12:00:00`);
        base.setDate(base.getDate() + 1);
        return localDateValue(base);
      })());
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Failed to load refund/exchange information"); }
    finally { setLoading(""); }
  }, [order.id]);
  useEffect(() => { void load(); }, [load]);
  const run = async (key: string, action: () => Promise<FlightAfterSalesContext>) => {
    setLoading(key); setError("");
    try {
      const data = await action();
      setContext(data);
      await syncOrder();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Operation failed, please try again later"); }
    finally { setLoading(""); }
  };
  const searchChange = () => run("search", async () => {
    const data = await api.searchFlightChange(order.id, { date: targetDate, passengerCodes, segmentIds });
    setOffers(data);
    setSelectedOffer(data[0]?.priceKey || "");
    if (!data.length) throw new Error("No exchangeable flights found for the new date; please choose a different date");
    return context!;
  });
  const applyChange = () => {
    if (!selectedOffer) return setError("Please search and select an exchange flight first");
    if (!contactSurname.trim() || !contactGivenName.trim()) return setError("Please fill in both contact surname and given name");
    if (!window.confirm("Confirm exchange submission? The supplier will review and a fare difference may apply.")) return;
    void run("apply-change", () => api.applyFlightChange(order.id, {
      priceKey: selectedOffer,
      passengerCodes,
      segmentIds,
      changeType: 1,
      reasonType: afterSalesType,
      reason,
      evidenceFiles: evidenceText.split(/\s|,/).map(value => value.trim()).filter(Boolean),
      contact: { name: joinPersonName({ surname: contactSurname, givenName: contactGivenName }), surname: contactSurname.trim(), givenName: contactGivenName.trim(), phone: contactPhone, email: contactEmail },
    }));
  };
  const applyRefund = () => {
    if (!contactSurname.trim() || !contactGivenName.trim()) return setError("Please fill in both contact surname and given name");
    if (!window.confirm("Confirm refund submission? Airline fees may apply after ticketing.")) return;
    void run("apply-refund", () => api.applyFlightRefund(order.id, {
      passengerCodes,
      segmentIds,
      refundType: afterSalesType,
      reason,
      evidenceFiles: evidenceText.split(/\s|,/).map(value => value.trim()).filter(Boolean),
      contact: { name: joinPersonName({ surname: contactSurname, givenName: contactGivenName }), surname: contactSurname.trim(), givenName: contactGivenName.trim(), phone: contactPhone, email: contactEmail },
    }));
  };
  const busy = Boolean(loading);
  return <div className="modal-layer" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="booking-modal aftersales-modal glass glass-light" role="dialog" aria-modal="true" aria-labelledby="aftersales-title">
      <button className="modal-close" onClick={onClose} aria-label="Close Refund/Exchange"><X size={18} /></button>
      <p className="eyebrow">F-LINK AFTER-SALES</p>
      <h2 id="aftersales-title">Flight Refund & Exchange</h2>
      <p className="modal-subtitle">Order {order.id} · Passenger and segment identifiers from F-Link order detail, submitted as-is to supplier.</p>
      {loading === "load" && <p className="aftersales-loading"><LoaderCircle className="spinner" size={18} />Reading airline order status...</p>}
      {error && <p className="error-copy" role="alert">{error}</p>}
      {context && <>
        <div className="aftersales-summary">
          <span><strong>Eligibility</strong><small>{context.eligible ? "Ticketed; refund/exchange available" : context.eligibilityReason}</small></span>
          <span><strong>Supplier Status</strong><small>F-Link #{context.supplierStatus}</small></span>
        </div>
        {(context.change || context.refund) && <div className="aftersales-cases">
          {context.change && <article><div><strong>Exchange Order {context.change.orderNo}</strong><small>{context.change.targetDate ? `New Date ${context.change.targetDate}` : "Exchange Request"}</small></div><span>{context.change.statusLabel}</span>
            <div className="case-actions"><button className="secondary" disabled={busy} onClick={() => void run("change-refresh", () => api.refreshFlightChange(order.id))}><RefreshCw size={15} />Refresh</button>
              {context.change.status === 1 && <button className="primary" disabled={busy} onClick={() => { if (window.confirm(`Confirm payment of exchange difference ${money(context.change?.amount || 0, context.change?.currency)}?`)) void run("change-pay", () => api.payFlightChange(order.id)); }}>Pay Difference</button>}
              {[0, 1].includes(context.change.status) && <button className="danger-action" disabled={busy} onClick={() => { if (window.confirm("Confirm cancellation of this exchange request?")) void run("change-cancel", () => api.cancelFlightChange(order.id)); }}>Cancel Exchange</button>}</div>
          </article>}
          {context.refund && <article><div><strong>Refund Order {context.refund.orderNo}</strong><small>{context.refund.amount !== undefined ? `Estimated Refund ${money(context.refund.amount, context.refund.currency)}` : "Pending supplier calculation"}</small></div><span>{context.refund.statusLabel}</span>
            <div className="case-actions"><button className="secondary" disabled={busy} onClick={() => void run("refund-refresh", () => api.refreshFlightRefund(order.id))}><RefreshCw size={15} />Refresh</button>
              {context.refund.status === 1 && <><button className="primary" disabled={busy} onClick={() => { if (window.confirm("Accept supplier calculation and proceed with refund?")) void run("refund-confirm", () => api.confirmFlightRefund(order.id, "1")); }}>Confirm Refund</button><button className="danger-action" disabled={busy} onClick={() => { if (window.confirm("Confirm cancellation of refund request and retain original ticket?")) void run("refund-cancel", () => api.confirmFlightRefund(order.id, "2")); }}>Cancel Refund</button></>}</div>
          </article>}
        </div>}
        <div className="aftersales-tabs" role="tablist">
          <button role="tab" aria-selected={mode === "change"} className={mode === "change" ? "active" : ""} onClick={() => { setMode("change"); setError(""); }}>Request Exchange</button>
          <button role="tab" aria-selected={mode === "refund"} className={mode === "refund" ? "active" : ""} onClick={() => { setMode("refund"); setError(""); }}>Request Refund</button>
        </div>
        <fieldset className="aftersales-form" disabled={!context.eligible || busy}>
          <div className="aftersales-choice"><span>Passengers (multi-select)</span>{context.passengers.map(item => <label key={item.passengerCode}><input type="checkbox" checked={passengerCodes.includes(item.passengerCode)} onChange={event => { setPassengerCodes(current => event.target.checked ? [...current, item.passengerCode] : current.filter(code => code !== item.passengerCode)); setOffers([]); setError(""); }} />{item.name}</label>)}</div>
          <div className="aftersales-choice"><span>Original Segments (multi-select)</span>{context.segments.map(item => <label key={item.segmentId}><input type="checkbox" checked={segmentIds.includes(item.segmentId)} onChange={event => { setSegmentIds(current => event.target.checked ? [...current, item.segmentId] : current.filter(id => id !== item.segmentId)); setOffers([]); setError(""); }} />{item.origin} → {item.destination} · {item.flightNo}</label>)}</div>
          {mode === "change" && <label><span>New Departure Date</span><input type="date" min={localDateValue(new Date())} value={targetDate} onChange={event => { setTargetDate(event.target.value); setOffers([]); setError(""); }} /></label>}
          <label><span>Request Type</span><select value={afterSalesType} onChange={event => { setAfterSalesType(Number(event.target.value) as 1 | 2); setError(""); }}><option value={1}>Voluntary</option><option value={2}>Involuntary</option></select></label>
          <label><span>{mode === "change" ? "Exchange Reason" : "Refund Reason"}</span><input value={reason} onChange={event => setReason(event.target.value)} /></label>
          {afterSalesType === 2 && <label className="wide"><span>Evidence links (max 5, separated by space or comma)</span><input type="url" value={evidenceText} onChange={event => setEvidenceText(event.target.value)} placeholder="https://…" /></label>}
          <label><span>Contact Surname</span><input required value={contactSurname} onChange={event => setContactSurname(event.target.value)} /></label>
          <label><span>Contact Given Name</span><input required value={contactGivenName} onChange={event => setContactGivenName(event.target.value)} /></label>
          <label><span>Phone</span><input value={contactPhone} onChange={event => setContactPhone(event.target.value)} /></label>
          <label className="wide"><span>Email</span><input type="email" value={contactEmail} onChange={event => setContactEmail(event.target.value)} /></label>
        </fieldset>
        {mode === "change" && <div className="change-offers">
          {offers.map(offer => <label className={selectedOffer === offer.priceKey ? "selected" : ""} key={offer.priceKey}><input type="radio" name="change-offer" value={offer.priceKey} checked={selectedOffer === offer.priceKey} onChange={() => setSelectedOffer(offer.priceKey)} /><span><strong>{offer.flightNo} · {offer.airline}</strong><small>{offer.departureTime}–{offer.arrivalTime} · {offer.duration}</small></span><b>{money(offer.price, offer.currency)}</b></label>)}
        </div>}
        <div className="modal-actions">
          <button className="secondary" onClick={onClose}>Later</button>
          {mode === "change" && <><button className="secondary" disabled={!context.eligible || busy || !targetDate || !passengerCodes.length || !segmentIds.length} onClick={() => void searchChange()}>{loading === "search" ? "Searching..." : "Search Exchange Flights"}</button><button className="primary" disabled={!context.eligible || busy || !selectedOffer || !passengerCodes.length || !segmentIds.length} onClick={applyChange}>{loading === "apply-change" ? "Submitting..." : "Submit Exchange Request"}</button></>}
          {mode === "refund" && <button className="danger-action" disabled={!context.eligible || busy || !passengerCodes.length || !segmentIds.length} onClick={applyRefund}>{loading === "apply-refund" ? "Submitting..." : "Submit Refund Request"}</button>}
        </div>
      </>}
    </section>
  </div>;
}

function OrderDetailView({
  initialOrder,
  locale,
  onBack,
  onRestart,
  onOrderChange,
}: {
  initialOrder: DistributionOrder;
  locale: LocaleCode;
  onBack: () => void;
  onRestart?: () => void;
  onOrderChange?: (order: DistributionOrder) => void;
}) {
  const tr = (zh: string, en: string, zhTw = zh) => locale === "en" ? en : locale === "zh-TW" ? zhTw : zh;
  const [order, setOrder] = useState(initialOrder);
  const [loading, setLoading] = useState<"refresh" | "cancel" | "">("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showAfterSales, setShowAfterSales] = useState(false);
  const [bookingDetails, setBookingDetails] = useState<OrderBookingDetails>();
  const flight = order.productType === "flight";
  const canCancel = !["CANCELLED", "CHANGING", "REFUNDING", "REFUNDED", "TICKETED"].includes(order.status);
  const refresh = async () => {
    setLoading("refresh"); setError(""); setNotice("");
    try {
      const previousStatus = order.status;
      const refreshed = await api.refreshOrder(order.id);
      setOrder(refreshed);
      onOrderChange?.(refreshed);
      const synchronizedAt = new Intl.DateTimeFormat(locale, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).format(new Date());
      const labels = locale === "en" ? statusLabelsEn : statusLabels;
      setNotice(refreshed.status === previousStatus
        ? tr(`Synced with supplier at ${synchronizedAt}, current status remains “${labels[refreshed.status]}”.`, `Synced with supplier at ${synchronizedAt}, current status remains “${labels[refreshed.status]}”.`)
        : tr(`Status updated from “${labels[previousStatus]}” to “${labels[refreshed.status]}” at ${synchronizedAt}.`, `Status updated from “${labels[previousStatus]}” to “${labels[refreshed.status]}” at ${synchronizedAt}.`));
    }
    catch (caught) { setError(caught instanceof Error ? caught.message : tr("Order status refresh failed", "Order status refresh failed")); }
    finally { setLoading(""); }
  };
  const cancel = async () => {
    if (!window.confirm(tr(`Cancel order ${order.id}? Cancellation subject to supplier policy.`, `Cancel order ${order.id}? Cancellation subject to supplier policy.`))) return;
    setLoading("cancel"); setError("");
    try {
      const cancelled = await api.cancelOrder(order.id);
      setOrder(cancelled);
      onOrderChange?.(cancelled);
      setNotice(tr("Cancellation result synced to order list.", "Cancellation result synced to order list."));
    }
    catch (caught) { setError(caught instanceof Error ? caught.message : tr("Order cancellation failed", "Order cancellation failed")); }
    finally { setLoading(""); }
  };
  const downloadVoucher = () => {
    if (!flight && order.status !== "CONFIRMED") {
      setNotice(tr("Hotel not yet confirmed. E-voucher will be available after status changes to ‘Confirmed’.", "Hotel not yet confirmed. E-voucher will be available after status changes to ‘Confirmed’."));
      return;
    }
    downloadOrderDocument(order.id, flight && order.status === "TICKETED" ? "ticket" : "confirmation");
  };
  const downloadTicket = () => {
    if (order.status !== "TICKETED") {
      setNotice(tr("Airline has not issued ticket. E-ticket will be available after status changes to ‘Ticketed’.", "Airline has not issued ticket. E-ticket will be available after status changes to ‘Ticketed’."));
      return;
    }
    downloadOrderDocument(order.id, "ticket");
  };
  const previewConfirmationEmail = () => {
    if (flight || order.status !== "CONFIRMED") {
      setNotice(tr("Confirmation email with real itinerary and pricing will be generated after hotel confirms.", "Confirmation email with real itinerary and pricing will be generated after hotel confirms."));
      return;
    }
    window.open(`/api/orders/${encodeURIComponent(order.id)}/documents/email-preview`, "_blank", "noopener,noreferrer");
  };
  useEffect(() => {
    let active = true;
    api.getOrderDetails(order.id).then(details => {
      if (active) setBookingDetails(details);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [order.id]);
  return <section className="booking-flow-page order-detail-page">
    <button className="back-link" onClick={onBack}><ArrowLeft size={17} />{tr("Go Back", "Go Back")}</button>
    <BookingProgress current={5} labels={flight ? [tr("Search", "Search"), tr("Select Flight", "Select Flight"), tr("Passengers", "Passengers"), tr("Payment", "Payment"), tr("Confirmation", "Confirmation"), tr("Order Detail", "Order Detail")] : [tr("Search", "Search"), tr("Results", "Results"), tr("Hotel Detail", "Hotel Detail"), tr("Checkout", "Checkout"), tr("Confirmation", "Confirmation"), tr("Order Detail", "Order Detail")]} />
    <header className="order-detail-head glass glass-light">
      <div><p className="eyebrow">{flight ? "FLIGHT ORDER" : "HOTEL ORDER"}</p><h1>{order.title}</h1><p>{order.subtitle}</p></div>
      <div className="order-status-stack"><StatusPill status={order.status} locale={locale} /><span>{tr("Local Order ID", "Local Order ID")} {order.id}</span><span>{tr("Supplier Order ID", "Supplier Order ID")} {order.supplierOrderNo || tr("Generated after confirmation", "Generated after confirmation")}</span></div>
    </header>
    <div className="order-detail-grid">
      <div className="order-detail-main">
        <section className="detail-section glass glass-light"><div className="panel-title"><div><h2>{flight ? tr("Flight & Passengers", "Flight & Passengers") : tr("Stay & Guests", "Stay & Guests")}</h2><p>{tr("Booking Summary", "Booking Summary")}</p></div></div>
          <div className="order-product-summary"><span className={`product-hero-icon ${order.productType}`}>{flight ? <Plane size={25} /> : <BedDouble size={25} />}</span><div><strong>{order.title}</strong><span>{order.subtitle}</span><small>{bookingDetails?.serviceSummary || tr("Loading order snapshot...", "Loading order snapshot...")}</small></div></div>
          <div className="detail-facts"><span><UserRound size={17} /><b>{bookingDetails?.travelerName || tr("Loading...", "Loading...")}</b><small>{flight ? (bookingDetails?.documentMasked ? `${tr("Document", "Document")} ${bookingDetails.documentMasked}` : tr("Passenger Details", "Passenger Details")) : tr("Primary Guest", "Primary Guest")}</small></span><span><Mail size={17} /><b>{bookingDetails?.email || "—"}</b><small>{tr("Confirmation Email", "Confirmation Email")}</small></span><span><Phone size={17} /><b>{bookingDetails?.phone || "—"}</b><small>{tr("Emergency Contact", "Emergency Contact")}</small></span></div>
        </section>
        <section className="detail-section glass glass-light"><div className="panel-title"><div><h2>{flight ? tr("Ticketing & Services", "Ticketing & Services") : tr("Policies & Check-in Notes", "Policies & Check-in Notes")}</h2><p>{tr("Subject to supplier confirmation", "Subject to supplier confirmation")}</p></div></div>
          <div className="policy-list">
            <div><ShieldCheck size={18} /><span><strong>{flight ? tr("Refund/Exchange Rules", "Refund/Exchange Rules") : tr("Cancellation Policy", "Cancellation Policy")}</strong><small>{flight ? tr("Refund/exchange fees subject to F-Link and airline real-time calculation", "Refund/exchange fees subject to F-Link and airline real-time calculation") : bookingDetails?.cancelPolicy || tr("Supplier did not return cancellation policy", "Supplier did not return cancellation policy")}</small></span><ChevronRight size={17} /></div>
            <div><Luggage size={18} /><span><strong>{flight ? tr("Cabin & Baggage", "Cabin & Baggage") : tr("Room, Bed Type & Breakfast", "Room, Bed Type & Breakfast")}</strong><small>{flight ? `${bookingDetails?.cabin || tr("Supplier did not return cabin class", "Supplier did not return cabin class")} · ${bookingDetails?.baggage || tr("Supplier did not return baggage allowance", "Supplier did not return baggage allowance")}` : `${bookingDetails?.roomName || tr("Supplier did not return room type", "Supplier did not return room type")} · ${bookingDetails?.bedTypeDescription || tr("Supplier did not return bed type", "Supplier did not return bed type")} · ${bookingDetails?.breakfast || tr("Supplier did not return breakfast info", "Supplier did not return breakfast info")}`}</small></span><ChevronRight size={17} /></div>
            {!flight && <div><Clock3 size={18} /><span><strong>{tr("Check-in & Special Notes", "Check-in & Special Notes")}</strong><small>{[bookingDetails?.checkInInstructions, ...(bookingDetails?.specialCheckInInstructions || [])].filter(Boolean).join(locale === "en" ? "; " : "；") || tr("Supplier did not return check-in instructions", "Supplier did not return check-in instructions")}</small></span><ChevronRight size={17} /></div>}
            <div><FileText size={18} /><span><strong>{tr("E-Voucher", "E-Voucher")}</strong><small>{flight ? tr("E-ticket and itinerary available for download after ticketing", "E-ticket and itinerary available for download after ticketing") : tr("Check-in confirmation available for download after hotel confirms", "Check-in confirmation available for download after hotel confirms")}</small></span><ChevronRight size={17} /></div>
          </div>
        </section>
      </div>
      <aside className="order-side glass glass-light"><h2>{tr("Order Amount", "Order Amount")}</h2><div className="price-lines">
        {!flight && bookingDetails?.priceBreakdown ? <>
          {bookingDetails.priceBreakdown.roomSubtotal !== undefined && <span>{tr("Room Subtotal", "Room Subtotal")}<b>{money(bookingDetails.priceBreakdown.roomSubtotal, bookingDetails.priceBreakdown.currency)}</b></span>}
          {bookingDetails.priceBreakdown.taxFee !== undefined && <span>{tr("Taxes & Fees", "Taxes & Fees")}<b>{money(bookingDetails.priceBreakdown.taxFee, bookingDetails.priceBreakdown.currency)}</b></span>}
          {bookingDetails.priceBreakdown.salesTax !== undefined && <span>{tr("Sales Tax", "Sales Tax")}<b>{money(bookingDetails.priceBreakdown.salesTax, bookingDetails.priceBreakdown.currency)}</b></span>}
          {bookingDetails.priceBreakdown.otherTax !== undefined && <span>{tr("Other Taxes", "Other Taxes")}<b>{money(bookingDetails.priceBreakdown.otherTax, bookingDetails.priceBreakdown.currency)}</b></span>}
          {bookingDetails.priceBreakdown.serviceFee !== undefined && <span>{tr("FusionGo Service Fee", "FusionGo Service Fee")}<b>{money(bookingDetails.priceBreakdown.serviceFee, bookingDetails.priceBreakdown.currency)}</b></span>}
          {bookingDetails.priceBreakdown.chargesDueAtProperty !== undefined && <span className="property-charge">{tr("Pay at Hotel", "Pay at Hotel")}<b>{money(bookingDetails.priceBreakdown.chargesDueAtProperty, bookingDetails.priceBreakdown.chargesDueAtPropertyCurrency || bookingDetails.priceBreakdown.currency)}</b></span>}
          {bookingDetails.priceBreakdown.chargesDueAtProperty === undefined && bookingDetails.priceBreakdown.chargesDueAtPropertyNotice && <span className="property-charge property-charge-notice">{tr("Pay-at-hotel items description", "Pay-at-hotel items description")}<b>{bookingDetails.priceBreakdown.chargesDueAtPropertyNotice}</b></span>}
        </> : <span>{tr("Price Breakdown", "Price Breakdown")}<b>{flight ? tr("Fare and taxes subject to supplier order", "Fare and taxes subject to supplier order") : tr("Supplier did not return itemized breakdown", "Supplier did not return itemized breakdown")}</b></span>}
        <span className="total">{tr("Total Paid", "Total Paid")}<strong>{money(order.amount, order.currency)}</strong></span>
      </div><p className="policy-note"><ShieldCheck size={16} />{flight ? tr("Payment status subject to supplier", "Payment status subject to supplier") : bookingDetails?.paymentTiming || tr("Loading collection timing...", "Loading collection timing...")}</p>
        {error && <p className="error-copy" role="alert">{error}</p>}
        {notice && <p className="notice-copy" role="status">{notice}</p>}
        <button className="primary wide-action" onClick={refresh} disabled={Boolean(loading)}>{loading === "refresh" ? <><LoaderCircle className="spinner" size={17} />{tr("Refreshing", "Refreshing")}</> : <><RefreshCw size={17} />{tr("Refresh Order Status", "Refresh Order Status")}</>}</button>
        {flight && <button className="secondary wide-action" onClick={() => setShowAfterSales(true)}><RefreshCw size={17} />{tr("Refund / Exchange", "Refund / Exchange")}</button>}
        {flight && <button className="secondary wide-action" onClick={downloadTicket}><TicketCheck size={17} />{tr("Online Check-in / Download Ticket", "Online Check-in / Download Ticket")}</button>}
        <button className="secondary wide-action" onClick={downloadVoucher}><ReceiptText size={17} />{tr("Download E-Voucher (PDF)", "Download E-Voucher (PDF)")}</button>
        {!flight && <button className="secondary wide-action" onClick={previewConfirmationEmail}><Mail size={17} />{tr("Preview Confirmation Email", "Preview Confirmation Email")}</button>}
        {canCancel && <button className="danger-action wide-action" onClick={cancel} disabled={Boolean(loading)}>{loading === "cancel" ? tr("Cancelling...", "Cancelling...") : tr("Cancel Order", "Cancel Order")}</button>}
        {onRestart && <button className="text-button wide-action" onClick={onRestart}>{tr("Book Again", "Book Again")}</button>}
      </aside>
    </div>
    {showAfterSales && <FlightAfterSalesPanel order={order} onClose={() => setShowAfterSales(false)} onOrderChange={changed => { setOrder(changed); onOrderChange?.(changed); }} />}
  </section>;
}

function HotelPriceBreakdownView({ offer, total }: { offer: HotelOffer; total: number }) {
  const { money } = useDisplayMoney();
  const breakdown = offer.priceBreakdown;
  const line = (label: string, value: number | undefined, currency = offer.currency) => value !== undefined
    ? <span><span>{label}</span><b>{money(value, currency)}</b></span>
    : null;
  return <div className="price-lines eps-price-breakdown" aria-label="Price Breakdown">
    {breakdown ? <>
      {line("Room Subtotal", breakdown.roomSubtotal)}
      {line("Taxes & Fees", breakdown.taxFee)}
      {line("Sales Tax", breakdown.salesTax)}
      {line("Other Taxes", breakdown.otherTax)}
      {line("FusionGo Service Fee", breakdown.serviceFee)}
      {breakdown.feeItems?.map((item, index) => <span key={`${item.type}-${item.date || index}`}><span>{item.type}{item.date ? ` · ${item.date}` : ""}</span><b>{money(item.value, item.currency)}</b></span>)}
      {breakdown.chargesDueAtProperty !== undefined && <span className="property-charge"><span>Pay at Hotel</span><b>{money(breakdown.chargesDueAtProperty, breakdown.chargesDueAtPropertyCurrency || offer.currency)}</b></span>}
      {breakdown.chargesDueAtProperty === undefined && breakdown.chargesDueAtPropertyNotice && <span className="property-charge property-charge-notice"><span>Pay-at-hotel items are settled directly with the property</span><b>{breakdown.chargesDueAtPropertyNotice}</b></span>}
    </> : <span><span>Tax & Fee Breakdown</span><b>Supplier did not return itemized breakdown</b></span>}
    <span className="total"><span>Total Payable</span><strong>{money(total, offer.currency)}</strong></span>
  </div>;
}

function HotelComplianceFacts({ offer, compact = false }: { offer: HotelOffer; compact?: boolean }) {
  return <div className={`eps-facts ${compact ? "compact" : ""}`}>
    <div><strong>Bed Type</strong><span>{offer.bedTypeDescription || "Supplier did not return bed type description"}</span></div>
    <div><strong>Cancellation Policy</strong><span className={offer.nonRefundable ? "non-refundable" : ""}>{offer.nonRefundable ? "Non-refundable" : offer.cancelPolicy || "Supplier did not return cancellation policy"}</span></div>
    <div><strong>Check-in Instructions</strong><span>{offer.checkInInstructions || "Supplier did not return check-in time"}</span></div>
    {!!offer.specialCheckInInstructions?.length && <div><strong>Special Check-in Notes</strong><span>{offer.specialCheckInInstructions.join("；")}</span></div>}
  </div>;
}

function HotelCheckout({ offer, onBack, onComplete }: { offer: HotelOffer; onBack: () => void; onComplete: (order: DistributionOrder) => void }) {
  const roomNum = offer.roomNum || 1;
  const nights = offer.nights || 1;
  const [guestNames, setGuestNames] = useState<PersonNameParts[]>(() => Array.from(
    { length: roomNum },
    () => ({ surname: "", givenName: "" }),
  ));
  const [contactSurname, setContactSurname] = useState("");
  const [contactGivenName, setContactGivenName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [arrivalWindow, setArrivalWindow] = useState("18:00-20:00");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("credit");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const total = offer.totalPrice ?? offer.nightlyPrice * nights * roomNum;
  const updateGuestName = (index: number, key: keyof PersonNameParts, value: string) => {
    setGuestNames(current => current.map((name, guestIndex) => guestIndex === index ? { ...name, [key]: value.toUpperCase() } : name));
    setError("");
  };
  const submit = async () => {
    if (guestNames.some(name => !name.surname.trim() || !name.givenName.trim()) || !contactSurname.trim() || !contactGivenName.trim() || phone.length < 8 || !email.includes("@")) return setError(`Please fill surname and given name for each of ${roomNum} room(s), and complete contact information`);
    if (guestNames.some(name => !/^[A-Za-z]+(?:[ '\-][A-Za-z]+)*$/.test(name.surname.trim()) || !/^[A-Za-z]+(?:[ '\-][A-Za-z]+)*$/.test(name.givenName.trim()))) return setError("Guest surname and given name may only contain English letters, spaces, hyphens, or apostrophes");
    setLoading(true); setError("");
    try {
      const guests = guestNames.map((guestName, index) => ({
        roomIndex: index + 1,
        firstName: guestName.givenName.trim().toUpperCase(),
        lastName: guestName.surname.trim().toUpperCase(),
      }));
      const contactName = joinPersonName({ surname: contactSurname, givenName: contactGivenName });
      const [arriveTime, latestArriveTime] = arrivalWindow === "After 22:00" ? ["22:00", "23:59"] : arrivalWindow.split("-");
      const created = await api.createOrder({
        productType: "hotel",
        offerId: offer.id,
        guests,
        contact: { name: contactName, surname: contactSurname.trim(), givenName: contactGivenName.trim(), phone, email },
        arriveTime,
        latestArriveTime,
      });
      onComplete(await api.payOrder(created.id, paymentMethod));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Submission failed, please try again later"); } finally { setLoading(false); }
  };
  return <section className="booking-flow-page">
    <button className="back-link" onClick={onBack}><ArrowLeft size={17} />Back to Hotel Detail</button>
    <BookingProgress current={3} labels={["Search", "Results", "Hotel Detail", "Checkout", "Confirmation", "Order Detail"]} />
    <SimulationNotice offer={offer} />
    <header className="flow-heading"><p className="eyebrow">COMPLETE YOUR STAY</p><h1>Guest & Payment Information</h1><p>Ensure guest names match travel documents exactly.</p></header>
    <div className="checkout-layout"><div className="checkout-main">
      <section className="form-section glass glass-light"><div className="section-title"><span>1</span><div><h2>Guest Information</h2><p>This order includes {roomNum} rooms, {nights} nights, {offer.numberOfAdults || roomNum} adults</p></div></div><div className="room-guest-list">
        {guestNames.map((guestName, index) => <div className="room-guest-row" key={index}><strong>Room {index + 1}</strong><label><span>Surname</span><div className="light-field"><UserRound size={17} /><input aria-label={`Room ${index + 1} guest surname`} autoComplete="family-name" value={guestName.surname} onChange={event => updateGuestName(index, "surname", event.target.value)} placeholder="ZHANG" /></div><small>Must match travel document</small></label><label><span>Given Name</span><div className="light-field"><UserRound size={17} /><input aria-label={`Room ${index + 1} guest given name`} autoComplete="given-name" value={guestName.givenName} onChange={event => updateGuestName(index, "givenName", event.target.value)} placeholder="SAN" /></div><small>Must match travel document</small></label></div>)}
      </div><div className="form-grid stay-preferences">
        <label><span>Estimated Arrival Time</span><select value={arrivalWindow} onChange={event => setArrivalWindow(event.target.value)}><option>18:00-20:00</option><option>20:00-22:00</option><option>After 22:00</option></select></label>
        <label><span>Selected Bed Type</span><div className="read-only-value">{offer.bedTypeDescription || "Supplier did not return bed type"}</div></label>
      </div></section>
      <section className="form-section glass glass-light"><div className="section-title"><span>2</span><div><h2>Policies & Check-in Notes</h2><p>The following comes from G-Link real-time products. Please review before payment.</p></div></div><HotelComplianceFacts offer={offer} />
        {(offer.numberOfChildren || 0) > 0 && <p className="child-age-recap"><Users size={17} /><strong>{offer.numberOfChildren} children</strong>: Age {offer.childrenAges?.join("、") || "Supplier did not return"} years</p>}
      </section>
      <section className="form-section glass glass-light"><div className="section-title"><span>3</span><div><h2>Contact</h2><p>For booking confirmation and exception notifications; transmitted via encrypted connection</p></div></div><div className="form-grid">
        <label><span>Contact Surname</span><div className="light-field"><UserRound size={17} /><input autoComplete="family-name" value={contactSurname} onChange={event => { setContactSurname(event.target.value); setError(""); }} /></div></label>
        <label><span>Contact Given Name</span><div className="light-field"><UserRound size={17} /><input autoComplete="given-name" value={contactGivenName} onChange={event => { setContactGivenName(event.target.value); setError(""); }} /></div></label>
        <label><span>Phone Number</span><div className="light-field"><Phone size={17} /><input value={phone} onChange={event => { setPhone(event.target.value); setError(""); }} /></div></label>
        <label className="wide"><span>Email</span><div className="light-field"><Mail size={17} /><input type="email" value={email} onChange={event => { setEmail(event.target.value); setError(""); }} /></div></label>
      </div></section>
      <section className="form-section glass glass-light"><div className="section-title"><span>4</span><div><h2>Payment Method & Collection</h2><p>{offer.paymentTiming || "Supplier did not return collection timing"}</p></div></div>
        <label className={`payment-option ${paymentMethod === "credit" ? "selected" : ""}`}><input type="radio" checked={paymentMethod === "credit"} onChange={() => setPaymentMethod("credit")} name="hotel-payment" /><Landmark size={20} /><span><strong>Enterprise Credit Account</strong><small>Available credit verified from database at submission</small></span>{paymentMethod === "credit" && <CheckCircle2 size={19} />}</label>
        <label className="payment-option disabled" aria-disabled="true"><input type="radio" disabled checked={paymentMethod === "card"} onChange={() => undefined} name="hotel-payment" /><CreditCard size={20} /><span><strong>Bank Card</strong><small>Production payment channel not connected, unavailable</small></span></label>
        <div className="payment-disclosure"><span><strong>Payee</strong>{offer.paymentProcessor || "Supplier did not return"}</span><span><strong>Expedia Group MoR</strong>N/A, this product is from G-Link</span><span><strong>Payment Processing Location</strong>{offer.paymentProcessingLocation || "N/A: Not Expedia Group MoR"}</span><span><strong>PSD2 / SCA</strong>{paymentMethod === "card" ? "Production requires compliant payment and SCA enablement" : "Enterprise credit payment; no card charges to travelers"}</span></div>
      </section>
    </div><aside className="price-summary glass glass-light">
      {offer.image ? <img src={offer.image} alt="" /> : <div className="hotel-image-placeholder compact"><Building2 size={24} /><span>No image from supplier</span></div>}<h2>{offer.name}</h2>{offer.district && <p>{offer.district}</p>}
      <div className="summary-detail"><span>{stayDateLabel(offer.checkInDate)} Check-in</span><span>{stayDateLabel(offer.checkOutDate)} Check-out · {nights} nights</span><span>{offer.roomName} · {roomNum} rooms</span><span>{offer.numberOfAdults || roomNum} adults · {offer.breakfast}</span></div>
      <HotelPriceBreakdownView offer={offer} total={total} />
      <p className="policy-note"><ShieldCheck size={16} />{offer.cancelPolicy}</p>{error && <p className="error-copy" role="alert">{error}</p>}
      <button className="primary pay-button" onClick={submit} disabled={loading} aria-busy={loading}>{loading ? <><LoaderCircle className="spinner" size={18} />Create Order & Pay</> : <><LockKeyhole size={17} />Confirm Payment {money(total, offer.currency)}</>}</button>
      <small className="secure-copy">By submitting, you agree to booking terms, cancellation policy, and privacy policy</small>
    </aside></div>
  </section>;
}

function HotelDetail({ offers, onBack, onCheckout, favorite, favoriteBusy, onToggleFavorite, authenticated, onLoginRequired }: { offers: HotelOffer[]; onBack: () => void; onCheckout: (offer: HotelOffer, availability: Partial<HotelOffer> & { price: number; currency: string }) => void; favorite: boolean; favoriteBusy: boolean; onToggleFavorite: () => void; authenticated: boolean; onLoginRequired: () => void }) {
  const { money } = useDisplayMoney();
  const offer = offers[0];
  const [checkingId, setCheckingId] = useState("");
  const [error, setError] = useState("");
  const check = async (selected: HotelOffer) => {
    if (!authenticated) {
      onLoginRequired();
      return;
    }
    setCheckingId(selected.id); setError("");
    try { onCheckout(selected, await api.checkHotelAvailability(selected.id)); } catch (caught) { setError(caught instanceof Error ? caught.message : "This room type is not available for booking"); } finally { setCheckingId(""); }
  };
  return <section className="booking-flow-page">
    <button className="back-link" onClick={onBack}><ArrowLeft size={17} />Back to Results</button>
    <BookingProgress current={2} labels={["Search", "Results", "Hotel Detail", "Checkout", "Confirmation", "Order Detail"]} />
    <SimulationNotice offer={offer} />
    <div className="hotel-gallery">{offer.image ? <img className="gallery-main" src={offer.image} alt={`${offer.name} Exterior`} /> : <div className="gallery-main gallery-unavailable"><Building2 size={38} /><span>G-Link did not provide hotel images</span></div>}<div className="gallery-unavailable"><ImageOff size={25} /><span>No more supplier images</span></div><div className="gallery-unavailable"><ImageOff size={25} /><span>No more supplier images</span></div></div>
    <div className={`hotel-detail-layout ${offer.rating === undefined ? "without-rating" : ""}`}><div>{offer.stars !== undefined && <p className="stars">{"★".repeat(offer.stars)}</p>}<div className="hotel-detail-title"><h1>{offer.name}</h1><button className={`favorite-button detail ${favorite ? "active" : ""}`} onClick={onToggleFavorite} disabled={favoriteBusy} aria-pressed={favorite} aria-label={favorite ? "Remove from Favorites" : "Add to Favorites"}><Heart size={18} fill={favorite ? "currentColor" : "none"} />{favorite ? "Favorited" : "Add to Favorites"}</button></div>{offer.district && <p className="detail-location"><MapPin size={16} />{offer.district}</p>}
      {!!offer.tags.length && <div className="amenity-strip">{offer.tags.map(item => <span key={item}><Check size={14} />{item}</span>)}</div>}
      <div className="rate-filter-bar glass glass-light"><strong>G-Link Real-time Available Products</strong><span>{offers.length} room types / rate plans</span><span className="upstream-only-badge">Showing API returned data only</span></div>
      <div className="room-offer-list">{offers.map((roomOffer, index) => <section className="room-offer glass glass-light" key={roomOffer.id}><div className="room-photo">{roomOffer.image ? <img src={roomOffer.image} alt="" /> : <div className="hotel-image-placeholder"><Building2 size={25} /><span>No room image from supplier</span></div>}</div><div className="room-copy"><p className="eyebrow">LIVE RATE · {index + 1}</p><div className="room-title-line"><h2>{roomOffer.roomName}</h2>{roomOffer.nonRefundable && <span className="non-refundable-badge">Non-refundable</span>}{roomOffer.payAtHotel && <span className="pay-at-hotel-badge">Pay at Hotel</span>}</div>{roomOffer.ratePlanName && <strong className="rate-plan-name">{roomOffer.ratePlanName}</strong>}<span>{roomOffer.roomNum || 1} rooms · {roomOffer.numberOfAdults || 2} adults · {roomOffer.nights || 1} nights{roomOffer.maxRoomCount ? ` · Max bookable ${roomOffer.maxRoomCount} rooms` : ""}</span><ul><li><BedDouble size={15} />{roomOffer.bedTypeDescription || "Supplier did not return bed type"}</li><li><Check size={15} />{roomOffer.breakfast}</li><li><ShieldCheck size={15} />{roomOffer.cancelPolicy}</li></ul><HotelComplianceFacts offer={roomOffer} compact /></div><div className="room-price"><small>Per room per night, tax included</small><strong>{money(roomOffer.nightlyPrice, roomOffer.currency)}</strong><span>{roomOffer.nights || 1} nights × {roomOffer.roomNum || 1} rooms, total {money(roomOffer.totalPrice ?? roomOffer.nightlyPrice * (roomOffer.nights || 1) * (roomOffer.roomNum || 1), roomOffer.currency)}</span><button className="primary" onClick={() => void check(roomOffer)} disabled={Boolean(checkingId)}>{checkingId === roomOffer.id ? <><LoaderCircle className="spinner" size={17} />Checking availability</> : authenticated ? "Book This Product" : "Sign in to Book"}</button></div></section>)}</div>{error && <p className="error-copy room-error" role="alert">{error}</p>}
    </div>{offer.rating !== undefined && <aside className="detail-rating glass glass-light"><strong>{offer.rating}</strong><span>Supplier Rating</span>{offer.ratingSource && <small>Rating source: {offer.ratingSource}</small>}</aside>}</div>
  </section>;
}

function HotelSearch({ locale, authenticated, onLoginRequired }: { locale: LocaleCode; authenticated: boolean; onLoginRequired: () => void }) {
  const english = locale === "en";
  const { displayCurrency, convert, money } = useDisplayMoney();
  const budget = useMemo(() => ({
    CNY: { min: 300, max: 3000, step: 100, shortcuts: [800, 1200, 2000, 3000] },
    USD: { min: 50, max: 500, step: 25, shortcuts: [120, 200, 320, 500] },
    HKD: { min: 300, max: 3500, step: 100, shortcuts: [900, 1500, 2400, 3500] },
    SGD: { min: 60, max: 600, step: 20, shortcuts: [150, 240, 400, 600] },
  })[displayCurrency], [displayCurrency]);
  const [destination, setDestination] = useState(() => {
    const remembered = window.sessionStorage.getItem("fusiongo.favoriteHotelSearch") || "";
    window.sessionStorage.removeItem("fusiongo.favoriteHotelSearch");
    return remembered;
  });
  const [checkIn, setCheckIn] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    return localDateValue(date);
  });
  const [checkOut, setCheckOut] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() + 2);
    return localDateValue(date);
  });
  const [lastSearch, setLastSearch] = useState("");
  const [items, setItems] = useState<HotelOffer[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState("");
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [occupancyOpen, setOccupancyOpen] = useState(false);
  const [rooms, setRooms] = useState(1);
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [childAges, setChildAges] = useState<number[]>([]);
  const [maxPrice, setMaxPrice] = useState(budget.max);
  const [starFilters, setStarFilters] = useState<number[]>([]);
  const [minRating, setMinRating] = useState(0);
  const [hotelNameQuery, setHotelNameQuery] = useState("");
  const [districtFilters, setDistrictFilters] = useState<string[]>([]);
  const [amenityFilters, setAmenityFilters] = useState<string[]>([]);
  const [breakfastOnly, setBreakfastOnly] = useState(false);
  const [freeCancellationOnly, setFreeCancellationOnly] = useState(false);
  const [bedType, setBedType] = useState<"" | "double" | "twin">("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [hotelSort, setHotelSort] = useState<"recommended" | "price" | "rating">("recommended");
  const [mapOpen, setMapOpen] = useState(false);
  const [selection, setSelection] = useState<HotelOffer>();
  const [roomOffers, setRoomOffers] = useState<HotelOffer[]>([]);
  const [selectedListing, setSelectedListing] = useState<HotelOffer>();
  const [hydratingId, setHydratingId] = useState("");
  const [favoriteHotels, setFavoriteHotels] = useState<FavoriteHotel[]>([]);
  const [favoritesLoading, setFavoritesLoading] = useState(false);
  const [favoriteBusyId, setFavoriteBusyId] = useState("");
  const [stage, setStage] = useState<"home" | "results" | "detail" | "checkout" | "result" | "orderDetail">("home");
  const [order, setOrder] = useState<DistributionOrder>();
  const resultsRef = useRef<HTMLElement>(null);
  const searchSequenceRef = useRef(0);
  const searchAbortRef = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    const names: Record<string, string> = english
      ? { Shanghai: "Shanghai", "Hong Kong": "Hong Kong", Beijing: "Beijing", Shenzhen: "Shenzhen", Bangkok: "Bangkok" }
      : { Shanghai: "Shanghai", "Hong Kong": "Hong Kong", Beijing: "Beijing", Shenzhen: "Shenzhen", Bangkok: "Bangkok" };
    setDestination(current => names[current] || current);
    setLastSearch(current => names[current] || current);
  }, [english]);
  const [destinationSuggestions, setDestinationSuggestions] = useState<Array<{ name: string; detail: string; destinationId: string; cityCode: string }>>([]);
  useEffect(() => {
    const keyword = destination.trim();
    if (keyword.length < 2) { setDestinationSuggestions([]); return; }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api.getDestination(keyword, controller.signal)
        .then(items => { if (!controller.signal.aborted) setDestinationSuggestions(items.slice(0, 8)); })
        .catch(() => undefined);
    }, 300);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [destination]);
  const suggestions = destinationSuggestions;
  const districtOptions = useMemo(() => Array.from(new Set(items.map(hotel => hotel.district).filter(Boolean)))
    .map(district => ({ district, count: items.filter(hotel => hotel.district === district).length })), [items]);
  const amenityOptions = useMemo(() => {
    const preferred = ["Free Parking", "Metro Access", "Family Friendly", "Indoor Pool", "Fitness Center", "Executive Lounge", "River View", "Design Hotel", "Newly Opened"];
    const counts = new Map<string, number>();
    items.forEach(hotel => hotel.tags.forEach(tag => counts.set(tag, (counts.get(tag) || 0) + 1)));
    return preferred.map(tag => ({ tag, count: counts.get(tag) || 0 }));
  }, [items]);
  const breakfastCount = useMemo(() => items.filter(hotel => !/(Breakfast Not Included|No Breakfast|without breakfast|no breakfast)/i.test(hotel.breakfast) && /(Breakfast Included|Breakfast|breakfast)/i.test(hotel.breakfast)).length, [items]);
  const freeCancellationCount = useMemo(() => items.filter(hotel => /(Free Cancellation|free cancellation|free cancel)/i.test(hotel.cancelPolicy)).length, [items]);
  const bedTypeOptions = useMemo(() => ([
    { value: "" as const, label: english ? "Any" : "Any", count: items.length },
    { value: "double" as const, label: english ? "King" : "King", count: items.filter(hotel => /(King|Double King|double|queen|king)/i.test(hotel.roomName)).length },
    { value: "twin" as const, label: english ? "Twin" : "Twin", count: items.filter(hotel => /(Twin|twin)/i.test(hotel.roomName)).length },
  ]), [english, items]);
  useEffect(() => { setMaxPrice(budget.max); }, [budget.max]);
  useEffect(() => () => searchAbortRef.current?.abort(), []);
  useEffect(() => {
    if (!authenticated) {
      setFavoriteHotels([]);
      setFavoritesLoading(false);
      return;
    }
    let active = true;
    setFavoritesLoading(true);
    api.listFavoriteHotels()
      .then(items => { if (active) setFavoriteHotels(items); })
      .catch(caught => {
        if (active) setError(caught instanceof Error ? caught.message : english ? "Failed to load favorite hotels" : "Failed to load favorite hotels");
      })
      .finally(() => { if (active) setFavoritesLoading(false); });
    return () => { active = false; };
  }, [authenticated, english]);
  const toggleFavorite = async (hotel: HotelOffer) => {
    if (!authenticated) {
      onLoginRequired();
      return;
    }
    setFavoriteBusyId(hotel.id);
    setError("");
    try {
      if (favoriteHotels.some(item => item.id === hotel.id)) {
        await api.deleteFavoriteHotel(hotel.id);
        setFavoriteHotels(current => current.filter(item => item.id !== hotel.id));
      } else {
        const saved = await api.addFavoriteHotel(hotel);
        setFavoriteHotels(current => [saved, ...current.filter(item => item.id !== saved.id)]);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : english ? "Failed to update favorite status" : "Failed to update favorite status");
    } finally {
      setFavoriteBusyId("");
    }
  };
  const activeFilterCount = starFilters.length + districtFilters.length + amenityFilters.length
    + Number(minRating > 0) + Number(maxPrice < budget.max) + Number(Boolean(hotelNameQuery.trim()))
    + Number(breakfastOnly) + Number(freeCancellationOnly) + Number(Boolean(bedType));
  const visibleHotels = useMemo(() => {
    const query = hotelNameQuery.trim().toLowerCase();
    const filtered = items.filter(hotel => {
      const searchable = [hotel.name, hotel.district, hotel.roomName, hotel.breakfast, hotel.cancelPolicy, ...hotel.tags].join(" ").toLowerCase();
      const breakfastText = hotel.breakfast.toLowerCase();
      const cancellationText = hotel.cancelPolicy.toLowerCase();
      const roomText = hotel.roomName.toLowerCase();
      const includesBreakfast = !/(Breakfast Not Included|No Breakfast|without breakfast|no breakfast)/i.test(breakfastText)
        && /(Breakfast Included|Breakfast|breakfast)/i.test(breakfastText);
      const supportsFreeCancellation = /(Free Cancellation|free cancellation|free cancel)/i.test(cancellationText);
      const matchesBed = !bedType
        || (bedType === "double" && /(King|Double King|double|queen|king)/i.test(roomText))
        || (bedType === "twin" && /(Twin|twin)/i.test(roomText));
      const displayPrice = convert(hotel.nightlyPrice, hotel.currency);
      return (displayPrice === undefined || displayPrice <= maxPrice)
        && (!starFilters.length || (hotel.stars !== undefined && starFilters.includes(hotel.stars)))
        && (minRating === 0 || (hotel.rating !== undefined && hotel.rating >= minRating))
        && (!query || searchable.includes(query))
        && (!districtFilters.length || districtFilters.includes(hotel.district))
        && (!amenityFilters.length || amenityFilters.every(tag => hotel.tags.includes(tag)))
        && (!breakfastOnly || includesBreakfast)
        && (!freeCancellationOnly || supportsFreeCancellation)
        && matchesBed;
    });
    return [...filtered].sort((a, b) => hotelSort === "price"
      ? a.nightlyPrice - b.nightlyPrice
      : hotelSort === "rating" ? (b.rating ?? -1) - (a.rating ?? -1) : 0);
  }, [amenityFilters, bedType, breakfastOnly, convert, districtFilters, freeCancellationOnly, hotelNameQuery, hotelSort, items, maxPrice, minRating, starFilters]);
  const clearHotelFilters = () => {
    setMaxPrice(budget.max);
    setStarFilters([]);
    setMinRating(0);
    setHotelNameQuery("");
    setDistrictFilters([]);
    setAmenityFilters([]);
    setBreakfastOnly(false);
    setFreeCancellationOnly(false);
    setBedType("");
  };
  const search = async (destinationOverride?: string) => {
    const cleanDestination = (destinationOverride ?? destination).trim();
    if (!cleanDestination) {
      setError(english ? "Enter city, landmark, or hotel name" : "Enter city, landmark, or hotel name");
      return;
    }
    if (!checkIn || !checkOut) {
      setError(english ? "Please select complete check-in and check-out dates" : "Please select complete check-in and check-out dates");
      return;
    }
    if (checkOut <= checkIn) {
      setError(english ? "Check-out date must be after check-in date" : "Check-out date must be after check-in date");
      return;
    }
    const searchSequence = ++searchSequenceRef.current;
    searchAbortRef.current?.abort();
    const abortController = new AbortController();
    searchAbortRef.current = abortController;
    setLoading(true);
    setError("");
    setSuggestionsOpen(false);
    setOccupancyOpen(false);
    setItems([]);
    setHasSearched(true);
    try {
      const nextItems = await api.searchHotels(
        { destination: cleanDestination, checkIn, checkOut, rooms, adults, children, childAges },
        abortController.signal,
      );
      if (searchSequence !== searchSequenceRef.current) return;
      const destinationCodes: Record<string, string> = {
        shanghai: "SHA",
        shenzhen: "SZX",
        "hong kong": "HKG",
        beijing: "BJS",
        singapore: "SIN",
        bangkok: "BKK",
      };
      const destinationAliases: Record<string, string[]> = {
        SHA: ["shanghai"], SZX: ["shenzhen"],
        HKG: ["hong kong"], BJS: ["beijing"],
        SIN: ["singapore"], BKK: ["bangkok"],
      };
      const expectedCode = destinationCodes[cleanDestination.toLowerCase()];
      const mismatched = expectedCode && nextItems.some(hotel => {
        if (hotel.cityCode) return hotel.cityCode.toUpperCase() !== expectedCode;
        return !destinationAliases[expectedCode].includes(hotel.city.trim().toLowerCase());
      });
      if (mismatched) {
        throw new Error(english
          ? "Supplier hotel results do not match the search destination. Please search again."
          : "Supplier hotel results do not match the search destination. Please search again.");
      }
      setLastSearch(cleanDestination);
      setItems(nextItems);
      setStage("results");
    } catch (caught) {
      if (searchSequence !== searchSequenceRef.current) return;
      setError(caught instanceof Error ? caught.message : english ? "Hotel search failed" : "Hotel search failed");
    } finally {
      if (searchSequence === searchSequenceRef.current) setLoading(false);
    }
  };
  const chooseHotel = async (hotel: HotelOffer) => {
    setHydratingId(hotel.id);
    setSuggestionsOpen(false);
    setError("");
    try {
      const products = await api.getHotelProducts(hotel.id);
      if (!products.length) throw new Error(english ? "Supplier did not return real-time available products" : "Supplier did not return real-time available products");
      setSelectedListing(hotel);
      setRoomOffers(products);
      setSelection(products[0]);
      setStage("detail");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : english ? "Real-time room query failed" : "Real-time room query failed");
    } finally {
      setHydratingId("");
    }
  };
  const searchFavoriteHotel = async (hotel: FavoriteHotel) => {
    setError("");
    try {
      const hotelDetail = await api.getHotelById(hotel.id, hotel.name);
      await chooseHotel(hotelDetail);
    } catch {
      setDestination(hotel.name);
      void search(hotel.name);
    }
  };
  useEffect(() => { window.scrollTo({ top: 0, behavior: "auto" }); }, [stage]);
  const searchForm = <form className="search-card glass glass-dark" aria-label={english ? "Hotel Search" : "Hotel Search"} noValidate onSubmit={event => { event.preventDefault(); void search(); }}>
    <label className="search-field field-destination"><span>{english ? "Destination / Hotel" : "Destination / Hotel"}</span><div><MapPin size={18} /><input aria-label={english ? "Destination or hotel" : "Destination or hotel"} autoComplete="off" value={destination} onFocus={() => setSuggestionsOpen(true)} onBlur={() => window.setTimeout(() => setSuggestionsOpen(false), 120)} onChange={e => { setDestination(e.target.value); setSuggestionsOpen(true); setError(""); }} onKeyDown={event => { if (event.key === "Escape") setSuggestionsOpen(false); if (event.key === "Enter") { event.preventDefault(); void search(); } }} /></div>
      {suggestionsOpen && <div className="light-popover glass glass-light" role="listbox" aria-label={english ? "Destination suggestions" : "Destination suggestions"}>
        {suggestions.length ? suggestions.map((item, index) => <button type="button" key={item.name} role="option" aria-selected={index === 0} onMouseDown={event => { event.preventDefault(); setDestination(item.name); setSuggestionsOpen(false); }}><MapPin size={16} /><span><strong>{item.name}</strong><small>{item.detail}</small></span></button>) : <p className="suggestion-empty">{english ? `Press Enter to search "${destination.trim()}"` : `Press Enter to search "${destination.trim()}"`}</p>}
      </div>}
    </label>
    <label className="search-field"><span>{english ? "Check-in Date" : "Check-in Date"}</span><div><CalendarDays size={18} /><input aria-label={english ? "Check-in Date" : "Check-in Date"} type="date" min={localDateValue(new Date())} value={checkIn} onChange={e => { const next = e.target.value; setCheckIn(next); setError(""); if (checkOut && checkOut <= next) { const following = new Date(`${next}T00:00:00`); following.setDate(following.getDate() + 1); setCheckOut(localDateValue(following)); } }} /></div></label>
    <label className="search-field"><span>{english ? "Check-out Date" : "Check-out Date"}</span><div><CalendarDays size={18} /><input aria-label={english ? "Check-out Date" : "Check-out Date"} type="date" min={checkIn} value={checkOut} onChange={e => { setCheckOut(e.target.value); setError(""); }} /></div></label>
    <div className="search-field occupancy-field"><span>{english ? "Rooms & Guests" : "Rooms & Guests"}</span><button type="button" className="field-button" onClick={() => setOccupancyOpen(value => !value)} aria-expanded={occupancyOpen}><Users size={18} />{english ? `${rooms} room${rooms > 1 ? "s" : ""} · ${adults} adult${adults > 1 ? "s" : ""}${children ? ` · ${children} child${children > 1 ? "ren" : ""}` : ""}` : `${rooms} room(s) · ${adults} adult(s)${children ? ` · ${children} child(ren)` : ""}`}<ChevronDown size={15} /></button>
      {occupancyOpen && <div className="light-popover traveler-popover glass glass-light" role="dialog" aria-label={english ? "Select rooms & guests" : "Select rooms & guests"}>
        <div><span><strong>{english ? "Rooms" : "Rooms"}</strong><small>{english ? "Max 8 rooms" : "Max 8 rooms"}</small></span><div className="counter"><button type="button" onClick={() => setRooms(Math.max(1, rooms - 1))} disabled={rooms === 1} aria-label={english ? "Fewer rooms" : "Fewer rooms"}><Minus size={15} /></button><b>{rooms}</b><button type="button" onClick={() => { const next = Math.min(8, rooms + 1); setRooms(next); setAdults(current => Math.max(current, next)); }} disabled={rooms === 8} aria-label={english ? "More rooms" : "More rooms"}><Plus size={15} /></button></div></div>
        <div><span><strong>{english ? "Adults" : "Adults"}</strong><small>{english ? "At least 1 per room" : "At least 1 per room"}</small></span><div className="counter"><button type="button" onClick={() => setAdults(Math.max(rooms, adults - 1))} disabled={adults === rooms} aria-label={english ? "Fewer adults" : "Fewer adults"}><Minus size={15} /></button><b>{adults}</b><button type="button" onClick={() => setAdults(Math.min(16, adults + 1))} disabled={adults === 16} aria-label={english ? "More adults" : "More adults"}><Plus size={15} /></button></div></div>
        <div><span><strong>{english ? "Children" : "Children"}</strong><small>{english ? "Ages 0–17, passed to G-Link" : "Ages 0–17, passed to G-Link"}</small></span><div className="counter"><button type="button" onClick={() => { setChildren(current => Math.max(0, current - 1)); setChildAges(current => current.slice(0, -1)); }} disabled={children === 0} aria-label={english ? "Fewer children" : "Fewer children"}><Minus size={15} /></button><b>{children}</b><button type="button" onClick={() => { if (children >= 8) return; setChildren(current => current + 1); setChildAges(current => [...current, 8]); }} disabled={children === 8} aria-label={english ? "More children" : "More children"}><Plus size={15} /></button></div></div>
        {childAges.length > 0 && <div className="child-age-grid" aria-label={english ? "Child Age" : "Child Age"}>{childAges.map((age, index) => <label key={index}><span>{english ? `Child ${index + 1} age` : `Child ${index + 1} age`}</span><select value={age} onChange={event => setChildAges(current => current.map((item, ageIndex) => ageIndex === index ? Number(event.target.value) : item))}>{Array.from({ length: 18 }, (_, value) => <option key={value} value={value}>{english ? `${value} yrs` : `${value} yrs`}</option>)}</select></label>)}</div>}
        <button type="button" className="popover-done" onClick={() => setOccupancyOpen(false)}>{english ? "Done" : "Done"}</button>
      </div>}
    </div>
    <button type="submit" className="primary search-cta" disabled={loading} aria-busy={loading}>{loading ? <><LoaderCircle className="spinner" size={18} />{english ? "Searching" : "Searching"}</> : <><Search size={18} />{english ? "Search Hotels" : "Search Hotels"}</>}</button>
    {error && <div className="search-inline-error" role="alert"><CircleHelp size={16} /><span>{error}</span><button type="button" onClick={() => void search()}>{english ? "Retry" : "Retry"}</button></div>}
  </form>;
  if (selection && roomOffers.length && stage === "detail") return <HotelDetail offers={roomOffers} favorite={Boolean(selectedListing && favoriteHotels.some(item => item.id === selectedListing.id))} favoriteBusy={favoriteBusyId === selectedListing?.id} onToggleFavorite={() => { if (selectedListing) void toggleFavorite(selectedListing); }} authenticated={authenticated} onLoginRequired={onLoginRequired} onBack={() => setStage("results")} onCheckout={(selectedOffer, availability) => { setSelection({ ...selectedOffer, ...availability, totalPrice: availability.price, currency: availability.currency }); setStage("checkout"); }} />;
  if (selection && stage === "checkout") return <HotelCheckout offer={selection} onBack={() => setStage("detail")} onComplete={created => { setOrder(created); setStage("result"); }} />;
  if (order && stage === "result") return <BookingResult order={order} type="hotel" onDetails={() => setStage("orderDetail")} onRestart={() => { setSelection(undefined); setRoomOffers([]); setSelectedListing(undefined); setOrder(undefined); setStage("home"); }} />;
  if (order && stage === "orderDetail") return <OrderDetailView initialOrder={order} locale={locale} onOrderChange={setOrder} onBack={() => setStage("result")} onRestart={() => { setSelection(undefined); setRoomOffers([]); setSelectedListing(undefined); setOrder(undefined); setStage("home"); }} />;
  if (stage === "home") return (
      <>
        <section className={`travel-hero hotel-hero ${suggestionsOpen ? "destination-popover-open" : ""}`}>
          <div className="hero-copy"><p className="eyebrow">STAY SOMEWHERE REMARKABLE</p><h1>{english ? <>Every destination,<br />a new perspective</> : <>Stay in Every Scene<br />of Your Destination</>}</h1><p>{english ? "Connecting to G-Link global hotel real-time inventory..." : "Connecting to G-Link global hotel real-time inventory..."}</p></div>
          {searchForm}
        </section>
        <section className="hotel-home-favorites glass glass-light" aria-labelledby="hotel-home-favorites-title" aria-busy={favoritesLoading}>
          <div className="hotel-home-favorites-heading">
            <div><span className="favorite-section-icon"><Heart size={18} fill="currentColor" /></span><div><p className="eyebrow">SAVED STAYS</p><h2 id="hotel-home-favorites-title">{english ? "My Favorite Hotels" : "My Favorite Hotels"}</h2><p>{english ? "Your personal hotel preferences..." : "Your personal hotel preferences..."}</p></div></div>
            {authenticated && favoriteHotels.length > 0 && <span className="favorite-count">{favoriteHotels.length} {english ? "favorites" : "favorites"}</span>}
          </div>
          {favoritesLoading ? <div className="favorite-hotel-grid" aria-hidden="true">{[1, 2, 3, 4].map(item => <div className="favorite-hotel-card skeleton-card" key={item} />)}</div>
            : !authenticated ? <div className="favorite-empty"><Heart size={22} /><div><strong>{english ? "Sign in to view your favorite hotels" : "Sign in to view your favorite hotels"}</strong><span>{english ? "Favorites are saved in your FusionGo account." : "Favorites are saved in your FusionGo account."}</span></div><button className="primary" onClick={onLoginRequired}>{english ? "Sign In" : "Sign In"}</button></div>
              : favoriteHotels.length ? <div className="favorite-hotel-grid">{favoriteHotels.map(hotel => <article className="favorite-hotel-card hotel-home-favorite-card" key={hotel.id}>
                {hotel.image ? <img src={hotel.image} alt="" /> : <div className="favorite-image-placeholder"><Building2 size={22} /></div>}
                <div><span className="favorite-mark"><Heart size={13} fill="currentColor" />{english ? "Favorited" : "Favorited"}</span><h3 title={hotel.name}>{hotel.name}</h3><p>{[hotel.city, hotel.district].filter(Boolean).join(" · ") || (english ? "Supplier did not provide location" : "Supplier did not provide location")}</p><div className="favorite-card-actions"><button className="secondary" onClick={() => { void searchFavoriteHotel(hotel); }} disabled={!!hydratingId}>{english ? "Search Live Rates" : "Search Live Rates"}</button><button className="favorite-remove" onClick={() => void toggleFavorite(hotel)} disabled={favoriteBusyId === hotel.id} aria-label={english ? `Remove from Favorites...${hotel.name}` : `Remove from Favorites...${hotel.name}`}><Heart size={15} fill="currentColor" /></button></div></div>
              </article>)}</div>
                : <div className="favorite-empty"><Heart size={22} /><div><strong>{english ? "No favorite hotels yet" : "No favorite hotels yet"}</strong><span>{english ? "Click the heart icon in search results or hotel detail pages to add favorites." : "Click the heart icon in search results or hotel detail pages to add favorites."}</span></div></div>}
        </section>
      </>
  );
  return (
    <section className="booking-flow-page search-results-page" ref={resultsRef}>
      <button className="back-link" onClick={() => setStage("home")}><ArrowLeft size={17} />{english ? "Back to Hotel Search" : "Back to Hotel Search"}</button>
      <BookingProgress current={1} labels={english ? ["Search", "Results", "Hotel details", "Payment", "Confirmation", "Booking details"] : ["Search", "Results", "Hotel details", "Payment", "Confirmation", "Booking details"]} />
      <div className="compact-search-shell">{searchForm}</div>
      <section className="results-stage" ref={resultsRef} aria-busy={loading}>
        <div className="result-heading"><div><p className="eyebrow">CURATED STAYS</p><h2>{english ? `Hotels in ${lastSearch}` : `hotels in ${lastSearch}`}</h2><p aria-live="polite">{loading ? english ? "Loading real-time hotel list..." : "Loading real-time hotel list..." : error ? english ? "Search incomplete, please modify criteria and retry" : "Search incomplete, please modify criteria and retry" : english ? `${visibleHotels.length} hotels matched · Room types and prices confirmed in detail page` : `${visibleHotels.length} hotels matched · Room types and prices confirmed in detail page`}</p></div><div className="sort-actions"><button className="secondary mobile-filter-button" onClick={() => setFiltersOpen(true)} aria-haspopup="dialog"><SlidersHorizontal size={15} />{english ? "Filters" : "Filters"}{activeFilterCount > 0 && <b>{activeFilterCount}</b>}</button><button className={`secondary ${mapOpen ? "active" : ""}`} onClick={() => setMapOpen(value => !value)} aria-pressed={mapOpen}><MapPin size={15} />{mapOpen ? english ? "List" : "List" : english ? "Map" : "Map"}</button><select className="secondary sort-select" aria-label={english ? "Sort Hotels" : "Sort Hotels"} value={hotelSort} onChange={event => setHotelSort(event.target.value as typeof hotelSort)} disabled={loading || items.length === 0}><option value="recommended">{english ? "Recommended" : "Recommended"}</option><option value="price">{english ? "Price: Low to High" : "Price: Low to High"}</option><option value="rating">{english ? "Rating: High to Low" : "Rating: High to Low"}</option></select></div></div>
        {mapOpen && <div className="hotel-map glass glass-light" role="region" aria-label="Hotel Map"><div className="map-grid" />{visibleHotels.slice(0, 6).map((hotel, index) => <button key={hotel.id} style={{ left: `${12 + (index % 3) * 34}%`, top: `${18 + Math.floor(index / 3) * 42}%` }} onClick={() => void chooseHotel(hotel)}><MapPin size={14} />{money(hotel.nightlyPrice, hotel.currency)}</button>)}</div>}
        <div className="result-with-filters">
          {filtersOpen && <button className="filter-drawer-backdrop" aria-label={english ? "Close Filters" : "Close Filters"} onClick={() => setFiltersOpen(false)} />}
          <aside className={`filter-panel glass glass-light ${filtersOpen ? "open" : ""}`} aria-label={english ? "Hotel Filters" : "Hotel Filters"}>
            <div className="filter-panel-head"><div><h3>{english ? "Filter Hotels" : "Filter Hotels"}{activeFilterCount > 0 && <span>{activeFilterCount}</span>}</h3><p>{english ? "Filters apply instantly" : "Filters apply instantly"}</p></div><button className="filter-panel-close" onClick={() => setFiltersOpen(false)} aria-label={english ? "Close Filters" : "Close Filters"}><X size={17} /></button></div>
            <label className="filter-search"><Search size={15} /><input value={hotelNameQuery} onChange={event => setHotelNameQuery(event.target.value)} placeholder={english ? "Hotel name or keyword" : "Hotel name or keyword"} aria-label={english ? "Search within results" : "Search within results"} /></label>
            <div className="filter-group">
              <div className="filter-group-title"><strong>{english ? "Budget per Night" : "Budget per Night"}</strong><span>{money(maxPrice, displayCurrency)}</span></div>
              <input type="range" min={budget.min} max={budget.max} step={budget.step} value={maxPrice} onChange={event => setMaxPrice(Number(event.target.value))} aria-label={english ? "Max price per night" : "Max price per night"} />
              <div className="price-shortcuts">{budget.shortcuts.map(price => <button key={price} className={maxPrice === price ? "active" : ""} onClick={() => setMaxPrice(price)}>{price === budget.max ? english ? "Any" : "Any" : `≤ ${money(price, displayCurrency)}`}</button>)}</div>
            </div>
            <div className="filter-group"><div className="filter-group-title"><strong>{english ? "Hotel Stars" : "Hotel Stars"}</strong></div>{[5, 4, 3, 2].map(star => { const count = items.filter(hotel => hotel.stars === star).length; return <label className="filter-option" key={star}><input type="checkbox" checked={starFilters.includes(star)} disabled={count === 0} onChange={event => setStarFilters(current => event.target.checked ? [...current, star] : current.filter(value => value !== star))} /><span>{star} {english ? "Stars" : "Stars"}</span><small>{count}</small></label>; })}</div>
            <div className="filter-group"><div className="filter-group-title"><strong>{english ? "Guest Rating" : "Guest Rating"}</strong></div>{[[0, english ? "Any" : "Any"], [4.5, english ? "Excellent 4.5+" : "Excellent 4.5+"], [4, english ? "Very Good 4.0+" : "Very Good 4.0+"], [3.5, english ? "Good 3.5+" : "Good 3.5+"]] .map(([rating, label]) => <label className="filter-option" key={rating}><input type="radio" name="hotel-rating" checked={minRating === rating} onChange={() => setMinRating(Number(rating))} /><span>{label}</span><small>{Number(rating) === 0 ? items.length : items.filter(hotel => hotel.rating !== undefined && hotel.rating >= Number(rating)).length}</small></label>)}</div>
            <div className="filter-group"><div className="filter-group-title"><strong>{english ? "Popular Filters" : "Popular Filters"}</strong></div><label className="filter-option"><input type="checkbox" checked={breakfastOnly} disabled={breakfastCount === 0} onChange={event => setBreakfastOnly(event.target.checked)} /><span>{english ? "Breakfast Included" : "Breakfast Included"}</span><small>{breakfastCount}</small></label><label className="filter-option"><input type="checkbox" checked={freeCancellationOnly} disabled={freeCancellationCount === 0} onChange={event => setFreeCancellationOnly(event.target.checked)} /><span>{english ? "Free Cancellation" : "Free Cancellation"}</span><small>{freeCancellationCount}</small></label></div>
            {!!districtOptions.length && <div className="filter-group"><div className="filter-group-title"><strong>{english ? "Location" : "Location"}</strong></div>{districtOptions.map(({ district, count }) => <label className="filter-option" key={district}><input type="checkbox" checked={districtFilters.includes(district)} onChange={event => setDistrictFilters(current => event.target.checked ? [...current, district] : current.filter(value => value !== district))} /><span>{district}</span><small>{count}</small></label>)}</div>}
            <div className="filter-group"><div className="filter-group-title"><strong>{english ? "Bed Type" : "Bed Type"}</strong></div>{bedTypeOptions.map(({ value, label, count }) => <label className="filter-option" key={value}><input type="radio" name="bed-type" checked={bedType === value} disabled={value !== "" && count === 0} onChange={() => setBedType(value)} /><span>{label}</span><small>{count}</small></label>)}</div>
            <div className="filter-group"><div className="filter-group-title"><strong>{english ? "Amenities & Features" : "Amenities & Features"}</strong></div>{amenityOptions.map(({ tag, count }) => <label className="filter-option" key={tag}><input type="checkbox" checked={amenityFilters.includes(tag)} disabled={count === 0} onChange={event => setAmenityFilters(current => event.target.checked ? [...current, tag] : current.filter(value => value !== tag))} /><span>{english ? ({ "Free Parking": "Free Parking", "Metro Access": "Metro Access", "Family Friendly": "Family Friendly", "Indoor Pool": "Indoor Pool", "Fitness Center": "Fitness Center", "Executive Lounge": "Executive Lounge", "River View": "River View", "Design Hotel": "Design Hotel", "Newly Opened": "Newly Opened" } as Record<string, string>)[tag] || tag : tag}</span><small>{count}</small></label>)}</div>
            <button className="filter-clear" onClick={clearHotelFilters} disabled={activeFilterCount === 0}>{english ? "Clear All Filters" : "Clear All Filters"}</button>
          </aside>
        <div className="result-list" aria-live="polite">
        {loading ? [1,2,3].map(item => <div className="hotel-card skeleton-card" key={item} aria-hidden="true" />) : visibleHotels.length ? visibleHotels.map(hotel => <article className="hotel-card" key={hotel.id}>
          {hotel.image ? <img src={hotel.image} alt="" /> : <div className="hotel-image-placeholder card"><Building2 size={28} /><span>{english ? "No image from supplier" : "No image from supplier"}</span></div>}
          <div className="hotel-info"><div className="hotel-top"><div>{hotel.stars !== undefined && <span className="stars">{"★".repeat(hotel.stars)}</span>}<h3>{hotel.name}</h3>{hotel.district && <p>{hotel.district}</p>}</div><div className="hotel-card-actions"><button className={`favorite-button ${favoriteHotels.some(item => item.id === hotel.id) ? "active" : ""}`} onClick={() => void toggleFavorite(hotel)} disabled={favoriteBusyId === hotel.id} aria-pressed={favoriteHotels.some(item => item.id === hotel.id)} aria-label={favoriteHotels.some(item => item.id === hotel.id) ? `Remove from Favorites...${hotel.name}` : `Add to Favorites...${hotel.name}`}><Heart size={17} fill={favoriteHotels.some(item => item.id === hotel.id) ? "currentColor" : "none"} /></button>{hotel.rating !== undefined && <span className="rating"><strong>{hotel.rating}</strong>{english ? "Supplier Rating" : "Supplier Rating"}{hotel.ratingSource && <small>{english ? "Source" : "Source"}: {hotel.ratingSource}</small>}</span>}</div></div>
          <div className="tags">{hotel.tags.map((tag, index) => <span key={`${tag}-${index}`}>{tag}</span>)}</div>
          <div className="room-line"><div><strong>{hotel.roomName}</strong><span>{hotel.breakfast} · {hotel.cancelPolicy}</span></div><div className="price"><small>per night, tax included</small><strong>{hotel.nightlyPrice ? money(hotel.nightlyPrice, hotel.currency) : "Real-time Query"}</strong><span>{hotel.nightlyPrice ? `${hotel.nights || 1} nights × ${hotel.roomNum || 1} rooms, total ${money(hotel.totalPrice ?? hotel.nightlyPrice * (hotel.nights || 1) * (hotel.roomNum || 1), hotel.currency)}` : "View detail for accurate pricing"}</span></div><button className="primary" onClick={() => chooseHotel(hotel)} disabled={hydratingId === hotel.id}>{hydratingId === hotel.id ? <><LoaderCircle className="spinner" size={16} />Search Live Products</> : "View Room Types"}</button></div></div>
        </article>) : hasSearched && !error ? <div className="hotel-empty-state glass glass-light"><div><Building2 size={28} /></div><h3>{english ? "No hotels match your criteria" : "No hotels match your criteria"}</h3><p>{items.length ? english ? "Please clear or relax some filter criteria." : "Please clear or relax some filter criteria." : english ? "Try a different destination or date..." : "Try a different destination or date..."}</p><button className="primary" onClick={() => { if (items.length) clearHotelFilters(); else setDestination("Hong Kong"); setError(""); window.scrollTo({ top: 0, behavior: "smooth" }); }}>{items.length ? english ? "Clear Filters" : "Clear Filters" : english ? "Search Hong Kong Hotels" : "Search Hong Kong Hotels"}</button></div> : null}
        </div></div>
      </section>
    </section>
  );
}

type FlightBookingDraft = {
  passengers: Array<{
    surname: string;
    givenName: string;
    documentNo: string;
    nationality: string;
    issuingCountry: string;
    gender: "1" | "2";
    idType: string;
    birthday: string;
    expiration: string;
    type: "adult" | "child" | "infant";
    adultPassengerName?: string;
  }>;
  contactSurname: string;
  contactGivenName: string;
  phone: string;
  email: string;
  baggage: boolean;
  insurance: boolean;
  seat: boolean;
};

function FlightItineraryCard({
  offer,
  badge,
  showFacts = false,
}: {
  offer: FlightOffer;
  badge: React.ReactNode;
  showFacts?: boolean;
}) {
  const journeys = offer.journeys?.length
    ? offer.journeys
    : [{
      origin: offer.departureAirport,
      destination: offer.arrivalAirport,
      date: "",
      flightNo: offer.flightNo,
      departureTime: offer.departureTime,
      arrivalTime: offer.arrivalTime,
      duration: offer.duration,
      stops: offer.stops,
    }];
  return <section className="itinerary-card glass glass-light">
    <div className="itinerary-head"><span className="airline-badge">{offer.airlineCode}</span><div><strong>{offer.airline} · {offer.flightNo}</strong><small>{journeys.map(journey => journey.date).filter(Boolean).join(" / ")} · {offer.cabin}</small></div>{badge}</div>
    <div className={`itinerary-journeys ${journeys.length > 1 ? "multiple" : ""}`}>{journeys.map((journey, index) => <div className="itinerary-route" key={`${journey.date}-${journey.origin}-${journey.destination}`}><div><small>{journeys.length > 1 ? offer.tripType === 2 ? index === 0 ? "Outbound" : "Return" : `Segment ${index + 1}` : journey.date}</small><strong>{journey.departureTime}</strong><span>{journey.origin}</span></div><div><small>{journey.date} · {journey.flightNo}</small><i /><span>{journey.duration} · {journey.stops ? `${journey.stops} stops` : "Direct"}</span></div><div><strong>{journey.arrivalTime}</strong><span>{journey.destination}</span></div></div>)}</div>
    {showFacts && <div className="fare-facts"><span><Luggage size={16} />Baggage Allowance {offer.baggage}</span><span><RefreshCw size={16} />Refund/change subject to airline rules</span><span><Clock3 size={16} />Ticketing usually takes 1–10 minutes</span></div>}
  </section>;
}

function FlightPassengerPage({
  offer,
  counts,
  travelDate,
  locale,
  onBack,
  onContinue,
}: {
  offer: FlightOffer;
  counts: { adults: number; children: number; infants: number };
  travelDate: string;
  locale: LocaleCode;
  onBack: () => void;
  onContinue: (draft: FlightBookingDraft) => void;
}) {
  const { catalog: nationalityCatalog, error: nationalityError } = useNationalityCatalog(locale);
  const tr = (zh: string, en: string, zhTw = zh) => locale === "en" ? en : locale === "zh-TW" ? zhTw : zh;
  const [passengers, setPassengers] = useState(() => ([
    ...Array.from({ length: counts.adults }, () => "adult" as const),
    ...Array.from({ length: counts.children }, () => "child" as const),
    ...Array.from({ length: counts.infants }, () => "infant" as const),
  ].map(type => ({
      surname: "",
      givenName: "",
      documentNo: "",
      nationality: "CN",
      issuingCountry: "CN",
      gender: "1" as "1" | "2",
      idType: "2",
      birthday: "",
      expiration: "",
      type,
      adultPassengerName: "",
    }))));
  const [contactSurname, setContactSurname] = useState("");
  const [contactGivenName, setContactGivenName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [baggage, setBaggage] = useState(false);
  const [insurance, setInsurance] = useState(false);
  const [seat, setSeat] = useState(false);
  const [error, setError] = useState("");
  const updatePassenger = (index: number, key: keyof (typeof passengers)[number], value: string) => {
    setPassengers(current => current.map((passenger, passengerIndex) =>
      passengerIndex === index ? { ...passenger, [key]: value } : passenger));
    setError("");
  };
  const next = () => {
    const englishNamePattern = /^[A-Za-z][A-Za-z '\-]*$/;
    if (passengers.some(passenger => !englishNamePattern.test(passenger.surname.trim()) || !englishNamePattern.test(passenger.givenName.trim()) || passenger.documentNo.length < 6 || !passenger.birthday || !passenger.expiration || !passenger.nationality || !passenger.issuingCountry) || !englishNamePattern.test(contactSurname.trim()) || !englishNamePattern.test(contactGivenName.trim()) || phone.length < 8 || !email.includes("@")) return setError(tr("Please complete passenger and contact surname, given name, and contact details per travel document", "Please complete passenger and contact surname, given name, and contact details per travel document", "Please complete passenger and contact surname, given name, and contact details per travel document"));
    const departure = new Date(`${travelDate}T12:00:00`);
    const ageOnDeparture = (birthday: string) => {
      const birth = new Date(`${birthday}T12:00:00`);
      let age = departure.getFullYear() - birth.getFullYear();
      if (departure.getMonth() < birth.getMonth() || (departure.getMonth() === birth.getMonth() && departure.getDate() < birth.getDate())) age -= 1;
      return age;
    };
    const invalidAge = passengers.some(passenger => {
      const age = ageOnDeparture(passenger.birthday);
      return passenger.type === "adult" ? age < 12 : passenger.type === "child" ? age < 2 || age >= 12 : age < 0 || age >= 2;
    });
    if (invalidAge) return setError(tr("Passenger birth date does not match the selected passenger type (adult/child/infant)", "Passenger birth date does not match the selected passenger type (adult/child/infant)", "Passenger birth date does not match the selected passenger type (adult/child/infant)"));
    const firstAdult = passengers.find(passenger => passenger.type === "adult");
    if (!firstAdult) return setError(tr("At least one adult passenger is required", "At least one adult passenger is required", "At least one adult passenger is required"));
    setError("");
    onContinue({ passengers: passengers.map(passenger => passenger.type === "infant" ? { ...passenger, adultPassengerName: `${firstAdult.surname}/${firstAdult.givenName}` } : passenger), contactSurname, contactGivenName, phone, email, baggage, insurance, seat });
  };
  const passengerTypeLabel = (type: "adult" | "child" | "infant") => type === "adult"
    ? tr("Adult", "Adult", "Adult")
    : type === "child" ? tr("Child", "Child", "Child") : tr("Infant", "Infant", "Infant");
  return <section className="booking-flow-page">
    <button className="back-link" onClick={onBack}><ArrowLeft size={17} />Back to Flight List</button>
    <BookingProgress current={2} labels={["Search", "Flights & Fares", "Passengers", "Payment", "Confirmation", "Order Detail"]} />
    <header className="flow-heading"><p className="eyebrow">PASSENGER & EXTRAS</p><h1>Passenger & Contact Information</h1><p>Fare locked for 14 minutes. Names and documents must match travel documents exactly.</p></header>
    <div className="checkout-layout"><div className="checkout-main">
      <FlightItineraryCard offer={offer} badge={<span className="verified-badge"><ShieldCheck size={15} />Fare Verified</span>} showFacts />
      <section className="form-section glass glass-light"><div className="section-title"><span>1</span><div><h2>Passenger Information</h2><p>Names must match travel documents</p></div></div>
        {passengers.map((passenger, index) => <div className="passenger-block" key={index}><strong>{passengerTypeLabel(passenger.type)} {passengers.slice(0, index + 1).filter(item => item.type === passenger.type).length}</strong><div className="form-grid">
          <label><span>Surname</span><div className="light-field"><UserRound size={17} /><input aria-label={`Passenger ${index + 1} Surname`} value={passenger.surname} onChange={event => updatePassenger(index, "surname", event.target.value.toUpperCase())} /></div><small>e.g. LIN</small></label>
          <label><span>Given Name</span><div className="light-field"><UserRound size={17} /><input aria-label={`Passenger ${index + 1} Given Name`} value={passenger.givenName} onChange={event => updatePassenger(index, "givenName", event.target.value.toUpperCase())} /></div><small>e.g. JIACHENG</small></label>
          <label><span>Document Type</span><select value={passenger.idType} onChange={event => updatePassenger(index, "idType", event.target.value)}><option value="2">Passport</option><option value="3">HK/Macau Permit</option><option value="1">ID Card</option></select></label>
          <label><span>Document Number</span><div className="light-field"><FileText size={17} /><input value={passenger.documentNo} onChange={event => updatePassenger(index, "documentNo", event.target.value.toUpperCase())} /></div></label>
          <label><span>Nationality</span><NationalitySelect ariaLabel={`Passenger ${index + 1} Nationality`} value={passenger.nationality} onChange={value => updatePassenger(index, "nationality", value)} locale={locale} catalog={nationalityCatalog} error={nationalityError} /></label>
          <label><span>Passport Issuing Country/Region</span><NationalitySelect ariaLabel={`Passenger ${index + 1} Passport Issuing Country/Region`} value={passenger.issuingCountry} onChange={value => updatePassenger(index, "issuingCountry", value)} locale={locale} catalog={nationalityCatalog} error={nationalityError} /></label>
          <label><span>Gender</span><select value={passenger.gender} onChange={event => updatePassenger(index, "gender", event.target.value)}><option value="1">Male</option><option value="2">Female</option></select></label>
          <label><span>Date of Birth</span><input type="date" value={passenger.birthday} onChange={event => updatePassenger(index, "birthday", event.target.value)} /></label>
          <label><span>Document Expiry</span><input type="date" value={passenger.expiration} onChange={event => updatePassenger(index, "expiration", event.target.value)} /></label>
        </div></div>)}
      </section>
      <section className="form-section glass glass-light"><div className="section-title"><span>2</span><div><h2>Contact & Notifications</h2><p>Flight changes, ticketing, and refund/exchange notifications will be sent to these contacts</p></div></div><div className="form-grid">
        <label><span>Contact Surname</span><div className="light-field"><UserRound size={17} /><input autoComplete="family-name" value={contactSurname} onChange={event => { setContactSurname(event.target.value.toUpperCase()); setError(""); }} /></div></label>
        <label><span>Contact Given Name</span><div className="light-field"><UserRound size={17} /><input autoComplete="given-name" value={contactGivenName} onChange={event => { setContactGivenName(event.target.value.toUpperCase()); setError(""); }} /></div></label>
        <label><span>Phone Number</span><div className="light-field"><Phone size={17} /><input value={phone} onChange={event => { setPhone(event.target.value); setError(""); }} /></div></label>
        <label><span>Email</span><div className="light-field"><Mail size={17} /><input type="email" value={email} onChange={event => { setEmail(event.target.value); setError(""); }} /></div></label>
      </div></section>
      <section className="form-section glass glass-light"><div className="section-title"><span>3</span><div><h2>Ancillary Services</h2><p>Only products with connected fulfillment are shown; none currently available</p></div></div><div className="addon-list">
        <label className="disabled" aria-disabled="true"><input type="checkbox" checked={baggage} onChange={() => setBaggage(false)} disabled /><Luggage size={19} /><span><strong>Extra Baggage</strong><small>Airline baggage API not connected</small></span><b>Coming Soon</b></label>
        <label className="disabled" aria-disabled="true"><input type="checkbox" checked={seat} onChange={() => setSeat(false)} disabled /><UserRound size={19} /><span><strong>Advance Seat Selection</strong><small>Airline seat selection API not connected</small></span><b>Coming Soon</b></label>
        <label className="disabled" aria-disabled="true"><input type="checkbox" checked={insurance} onChange={() => setInsurance(false)} disabled /><ShieldCheck size={19} /><span><strong>Flight Protection</strong><small>Insurance and fulfillment agreement not connected</small></span><b>Coming Soon</b></label>
      </div></section>
    </div><aside className="price-summary glass glass-light">
      <p className="eyebrow">REVIEW DETAILS</p><h2>Review & Pay</h2><div className="summary-detail"><span>{offer.journeys?.length ? offer.journeys.map(journey => journey.origin).concat(offer.journeys.at(-1)?.destination || "").filter(Boolean).join(offer.tripType === 2 ? " ↔ " : " → ") : `${offer.departureAirport.split(" ")[0]} → ${offer.arrivalAirport.split(" ")[0]}`}</span><span>{offer.flightNo} · {passengers.length} passengers</span><span>{offer.cabin} · {offer.baggage}</span></div>
      <p className="policy-note"><ShieldCheck size={16} />priceKey verified; fare will be re-validated at payment</p>{error && <p className="error-copy" role="alert">{error}</p>}
      <button className="primary pay-button" onClick={next}>Next: Review & Payment<ChevronRight size={17} /></button><small className="secure-copy">No upstream order will be created before reaching the payment page</small>
    </aside></div>
  </section>;
}

function FlightPaymentPage({
  offer,
  counts,
  verifiedTotal,
  draft,
  onBack,
  onComplete,
}: {
  offer: FlightOffer;
  counts: { adults: number; children: number; infants: number };
  verifiedTotal: number;
  draft: FlightBookingDraft;
  onBack: () => void;
  onComplete: (order: DistributionOrder) => void;
}) {
  const [paymentMethod, setPaymentMethod] = useState<"credit" | "card">("credit");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const totalTravelers = counts.adults + counts.children + counts.infants;
  const extras = 0;
  const payable = verifiedTotal + extras;
  const submit = async () => {
    setLoading(true); setError("");
    try {
      const created = await api.createOrder({
        productType: "flight",
        offerId: offer.id,
        quantity: totalTravelers,
        contact: { name: joinPersonName({ surname: draft.contactSurname, givenName: draft.contactGivenName }), surname: draft.contactSurname, givenName: draft.contactGivenName, phone: draft.phone, email: draft.email },
        passengers: draft.passengers.map(passenger => {
          return {
            surname: passenger.surname.trim().toUpperCase(),
            name: passenger.givenName.trim().toUpperCase(),
            nationality: passenger.nationality,
            gender: passenger.gender,
            idType: passenger.idType,
            idNumber: passenger.documentNo,
            birthday: passenger.birthday,
            expiration: passenger.expiration,
            type: passenger.type,
            adultPassengerName: passenger.adultPassengerName,
          };
        }),
        addOns: {
          baggage: draft.baggage,
          seat: draft.seat,
          insurance: draft.insurance,
        },
        paymentMethod,
      });
      onComplete(await api.payOrder(created.id, paymentMethod));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Payment or ticketing failed; please re-validate fare"); }
    finally { setLoading(false); }
  };
  return <section className="booking-flow-page">
    <button className="back-link" onClick={onBack}><ArrowLeft size={17} />Back to Passenger Info</button>
    <BookingProgress current={3} labels={["Search", "Flights & Fares", "Passengers", "Payment", "Confirmation", "Order Detail"]} />
    <header className="flow-heading"><p className="eyebrow">REVIEW & PAYMENT</p><h1>Review Order & Complete Payment</h1><p>Please verify passenger names, documents, flight times, and refund/exchange rules.</p></header>
    <div className="checkout-layout"><div className="checkout-main">
      <FlightItineraryCard offer={offer} badge={<span className="verified-badge"><Clock3 size={15} />Time remaining 13:42</span>} />
      <section className="form-section glass glass-light"><div className="section-title"><span>1</span><div><h2>Passenger & Contact Information</h2><p>{draft.passengers.length} passengers (Adults: {counts.adults}, Children: {counts.children}, Infants: {counts.infants})</p></div></div><div className="review-list">{draft.passengers.map((passenger, index) => <div key={passenger.documentNo}><span><strong>{passenger.type === "adult" ? "Adult" : passenger.type === "child" ? "Child" : "Infant"} {index + 1} · {passenger.surname} / {passenger.givenName}</strong><small>{passenger.idType === "2" ? "Passport" : "Travel Document"} {passenger.documentNo} · Issued: {passenger.nationality} · Expires: {passenger.expiration}</small></span><CheckCircle2 size={18} /></div>)}<div><span><strong>{draft.contactSurname} / {draft.contactGivenName}</strong><small>{draft.phone} · {draft.email}</small></span><CheckCircle2 size={18} /></div></div></section>
      <section className="form-section glass glass-light"><div className="section-title"><span>2</span><div><h2>Payment Method</h2><p>Ticketing will be initiated with F-Link automatically after payment</p></div></div>
        <label className={`payment-option ${paymentMethod === "credit" ? "selected" : ""}`}><input type="radio" checked={paymentMethod === "credit"} onChange={() => setPaymentMethod("credit")} name="flight-payment" /><Landmark size={20} /><span><strong>Enterprise Credit Account</strong><small>Available credit verified from business database at submission</small></span>{paymentMethod === "credit" && <CheckCircle2 size={19} />}</label>
        <label className="payment-option disabled" aria-disabled="true"><input type="radio" disabled checked={paymentMethod === "card"} onChange={() => undefined} name="flight-payment" /><CreditCard size={20} /><span><strong>Bank Card / Digital Wallet</strong><small>Production payment channel not connected, unavailable</small></span></label>
      </section>
    </div><aside className="price-summary glass glass-light"><p className="eyebrow">FARE SUMMARY</p><h2>Cost Breakdown</h2><div className="price-lines"><span>F-Link Verified Total · {totalTravelers} passengers<b>{money(verifiedTotal, offer.currency)}</b></span><span>Taxes & Fuel Surcharges<b>Included</b></span><span className="total">Total Payable<strong>{money(payable, offer.currency)}</strong></span></div><p className="policy-note"><ShieldCheck size={16} />F-Link real-time fare verification and order creation at submission; unconnected ancillary services are not charged</p>{error && <p className="error-copy" role="alert">{error}</p>}<button className="primary pay-button" onClick={submit} disabled={loading} aria-busy={loading}>{loading ? <><LoaderCircle className="spinner" size={18} />Create Order & Pay</> : <><LockKeyhole size={17} />Confirm Payment {money(payable, offer.currency)}</>}</button><small className="secure-copy">By submitting, you agree to fare rules, refund/exchange policy, and privacy terms</small></aside></div>
  </section>;
}

function FlightSearch({ locale, authenticated, onLoginRequired }: { locale: LocaleCode; authenticated: boolean; onLoginRequired: () => void }) {
  const english = locale === "en";
  const { displayCurrency, convert, money } = useDisplayMoney();
  const [from, setFrom] = useState("SHA");
  const [to, setTo] = useState("HKG");
  const [departureDate, setDepartureDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    return localDateValue(date);
  });
  const [returnDate, setReturnDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() + 8);
    return localDateValue(date);
  });
  const [tripType, setTripType] = useState<TripType>("oneway");
  const [multiSegments, setMultiSegments] = useState(() => {
    const first = new Date();
    first.setDate(first.getDate() + 1);
    const second = new Date();
    second.setDate(second.getDate() + 5);
    return [
      { origin: "SHA", destination: "HKG", date: localDateValue(first) },
      { origin: "HKG", destination: "BKK", date: localDateValue(second) },
    ];
  });
  const [items, setItems] = useState<FlightOffer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [travelersOpen, setTravelersOpen] = useState(false);
  const [adults, setAdults] = useState(1);
  const [children, setChildren] = useState(0);
  const [infants, setInfants] = useState(0);
  const [selection, setSelection] = useState<FlightOffer>();
  const [fareOffer, setFareOffer] = useState<FlightOffer>();
  const [fareError, setFareError] = useState("");
  const fareCloseRef = useRef<HTMLButtonElement>(null);
  const fareErrorRef = useRef<HTMLDivElement>(null);
  const fareTriggerRef = useRef<HTMLElement | null>(null);
  const [stage, setStage] = useState<"home" | "results" | "passengers" | "payment" | "result" | "orderDetail">("home");
  const [verifiedTotal, setVerifiedTotal] = useState(0);
  const [verifyingId, setVerifyingId] = useState("");
  const [order, setOrder] = useState<DistributionOrder>();
  const [bookingDraft, setBookingDraft] = useState<FlightBookingDraft>();
  const [directOnly, setDirectOnly] = useState(false);
  const [baggageOnly, setBaggageOnly] = useState(false);
  const [hideBudgetAirlines, setHideBudgetAirlines] = useState(false);
  const [selectedAlliances, setSelectedAlliances] = useState<string[]>([]);
  const [selectedAirlines, setSelectedAirlines] = useState<string[]>([]);
  const [airlineSearch, setAirlineSearch] = useState("");
  const [airlinesExpanded, setAirlinesExpanded] = useState(false);
  const [depTimeSlots, setDepTimeSlots] = useState<string[]>([]);
  const [arrTimeSlots, setArrTimeSlots] = useState<string[]>([]);
  const [maxStops, setMaxStops] = useState<number | null>(null);
  const [maxDuration, setMaxDuration] = useState<number | null>(null);
  const [durationExpanded, setDurationExpanded] = useState(false);
  const [stopsExpanded, setStopsExpanded] = useState(false);
  const [flightSort, setFlightSort] = useState<"price" | "departure" | "duration">("price");
  const [pageNumber, setPageNumber] = useState(1);
  const pageSize = 20;
  const travelerCount = adults + children + infants;
  const flightTotal = useCallback((flight: FlightOffer) => flight.totalPrice ?? flight.price * travelerCount, [travelerCount]);
  const comparableFlightTotal = useCallback((flight: FlightOffer) => convert(flightTotal(flight), flight.currency) ?? flightTotal(flight), [convert, flightTotal]);

  const airlineAllianceMap: Record<string, string> = {
    "Cathay Pacific": "oneworld",
    "Japan Airlines": "oneworld",
    "Qantas": "oneworld",
    "Finnair": "oneworld",
    "Malaysia Airlines": "oneworld",
    "Qatar Airways": "oneworld",
    "Royal Jordanian": "oneworld",
    "SriLankan Airlines": "oneworld",
    "EVA Air": "Star Alliance",
    "Air China": "Star Alliance",
    "Singapore Airlines": "Star Alliance",
    "Thai Airways": "Star Alliance",
    "ANA": "Star Alliance",
    "Asiana Airlines": "Star Alliance",
    "United Airlines": "Star Alliance",
    "Lufthansa": "Star Alliance",
    "Turkish Airlines": "Star Alliance",
    "China Eastern": "SkyTeam",
    "Delta": "SkyTeam",
    "Korean Air": "SkyTeam",
    "Air France": "SkyTeam",
    "KLM": "SkyTeam",
    "Vietnam Airlines": "SkyTeam",
    "Xiamen Airlines": "SkyTeam",
    "Garuda Indonesia": "SkyTeam",
    "China Southern": "SkyTeam",
  };
  const budgetAirlineCodes = new Set(["UO", "FD", "AK", "D7", "TR", "Z2", "5J", "PR", "VJ", "QH", "MM", "9C", "BK"]);

  const parseFlightTime = (time: string): number => {
    const match = time.match(/(\d{2}):(\d{2})/);
    if (!match) return 0;
    return parseInt(match[1], 10) + parseInt(match[2], 10) / 60;
  };
  const parseDurationMinutes = (duration: string): number => {
    let mins = 0;
    const hMatch = duration.match(/(\d+)h/);
    const mMatch = duration.match(/(\d+)m/);
    if (hMatch) mins += parseInt(hMatch[1], 10) * 60;
    if (mMatch) mins += parseInt(mMatch[1], 10);
    return mins;
  };
  const TIME_SLOT_RANGES: Record<string, [number, number]> = {
    early_morning: [0, 6],
    morning: [6, 12],
    afternoon: [12, 18],
    evening: [18, 24],
  };

  const allAirlines = useMemo(() => {
    const map = new Map<string, { count: number; minPrice: number }>();
    items.forEach(flight => {
      const existing = map.get(flight.airline);
      const price = comparableFlightTotal(flight);
      if (existing) {
        existing.count++;
        existing.minPrice = Math.min(existing.minPrice, price);
      } else {
        map.set(flight.airline, { count: 1, minPrice: price });
      }
    });
    return Array.from(map.entries())
      .map(([name, data]) => ({ name, code: name.split(" ")[0], ...data, alliance: airlineAllianceMap[name] || "" }))
      .sort((a, b) => a.minPrice - b.minPrice);
  }, [items, comparableFlightTotal]);

  const allianceStats = useMemo(() => {
    const map = new Map<string, { name: string; count: number; minPrice: number }>();
    items.forEach(flight => {
      const alliance = airlineAllianceMap[flight.airline];
      if (!alliance) return;
      const price = comparableFlightTotal(flight);
      const existing = map.get(alliance);
      if (existing) {
        existing.count++;
        existing.minPrice = Math.min(existing.minPrice, price);
      } else {
        map.set(alliance, { name: alliance, count: 1, minPrice: price });
      }
    });
    return Array.from(map.values()).sort((a, b) => a.minPrice - b.minPrice);
  }, [items, comparableFlightTotal]);

  const filteredAirlines = useMemo(() => {
    const normalized = airlineSearch.trim().toLowerCase();
    return allAirlines.filter(a => !normalized || a.name.toLowerCase().includes(normalized));
  }, [allAirlines, airlineSearch]);

  const visibleFlights = useMemo(() => [...items]
    .filter(flight => {
      if (directOnly && flight.stops !== 0) return false;
      if (baggageOnly && /0 pieces|None/.test(flight.baggage)) return false;
      if (hideBudgetAirlines && budgetAirlineCodes.has(flight.airlineCode)) return false;
      if (selectedAlliances.length > 0) {
        const alliance = airlineAllianceMap[flight.airline];
        if (!alliance || !selectedAlliances.includes(alliance)) return false;
      }
      if (selectedAirlines.length > 0 && !selectedAirlines.includes(flight.airline)) return false;
      const depHour = parseFlightTime(flight.departureTime);
      if (depTimeSlots.length > 0 && !depTimeSlots.some(slot => { const [s, e] = TIME_SLOT_RANGES[slot] || [0, 24]; return depHour >= s && depHour <= e; })) return false;
      const arrHour = parseFlightTime(flight.arrivalTime);
      if (arrTimeSlots.length > 0 && !arrTimeSlots.some(slot => { const [s, e] = TIME_SLOT_RANGES[slot] || [0, 24]; return arrHour >= s && arrHour <= e; })) return false;
      if (maxStops !== null && flight.stops > maxStops) return false;
      if (maxDuration !== null && parseDurationMinutes(flight.duration) > maxDuration) return false;
      return true;
    })
    .sort((a, b) => {
      if (flightSort === "price") return comparableFlightTotal(a) - comparableFlightTotal(b);
      if (flightSort === "departure") return a.departureTime.localeCompare(b.departureTime);
      return parseDurationMinutes(a.duration) - parseDurationMinutes(b.duration);
    }), [baggageOnly, comparableFlightTotal, directOnly, flightSort, hideBudgetAirlines, items, selectedAirlines, selectedAlliances, depTimeSlots, arrTimeSlots, maxStops, maxDuration]);
  const lowestVisibleFlight = useMemo(() => visibleFlights.reduce<FlightOffer | undefined>((lowest, flight) =>
    !lowest || comparableFlightTotal(flight) < comparableFlightTotal(lowest) ? flight : lowest, undefined), [comparableFlightTotal, visibleFlights]);
  const totalPages = Math.max(1, Math.ceil(visibleFlights.length / pageSize));
  const pagedFlights = visibleFlights.slice((pageNumber - 1) * pageSize, pageNumber * pageSize);

  const clearAllFilters = () => {
    setDirectOnly(false);
    setBaggageOnly(false);
    setHideBudgetAirlines(false);
    setSelectedAlliances([]);
    setSelectedAirlines([]);
    setAirlineSearch("");
    setDepTimeSlots([]);
    setArrTimeSlots([]);
    setMaxStops(null);
    setMaxDuration(null);
    setPageNumber(1);
  };
  const search = async (date = departureDate) => {
    const journeys = tripType === "multicity"
      ? multiSegments
      : tripType === "roundtrip"
        ? [
          { origin: from, destination: to, date },
          { origin: to, destination: from, date: returnDate },
        ]
        : [{ origin: from, destination: to, date }];
    if (journeys.some(journey => journey.origin.trim().length < 3
      || journey.destination.trim().length < 3
      || !journey.date)) {
      return setError(english ? "Complete the origin, destination, and date for every journey." : "Please fill departure, destination, and date for each segment");
    }
    if (journeys.some(journey => journey.origin === journey.destination)) {
      return setError(english ? "Origin and destination must be different." : "Departure and destination cannot be the same for a segment");
    }
    if (tripType === "roundtrip" && returnDate < date) {
      return setError(english ? "The return date cannot be earlier than departure." : "Return date cannot be earlier than outbound date");
    }
    if (tripType === "multicity"
      && journeys.some((journey, index) => index > 0 && journey.date < journeys[index - 1].date)) {
      return setError(english ? "Multi-city dates must follow journey order." : "Multi-city dates must be in chronological order");
    }
    setLoading(true);
    setError("");
    setFareError("");
    setTravelersOpen(false);
    setDepartureDate(date);
    try {
      const primary = journeys[0];
      setItems(await api.searchFlights({
        from: primary.origin,
        to: primary.destination,
        departureDate: primary.date,
        adults,
        children,
        infants,
        tripType: tripType === "oneway" ? 1 : tripType === "roundtrip" ? 2 : 3,
        journeys,
      }));
      setPageNumber(1);
      setStage("results");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : english ? "Flight search failed." : "Flight search failed");
    } finally {
      setLoading(false);
    }
  };
  const selectTripType = (value: TripType) => {
    setTripType(value);
    setItems([]);
    setError("");
    setStage("home");
  };
  const updateMultiSegment = (
    index: number,
    key: "origin" | "destination" | "date",
    value: string,
  ) => {
    setMultiSegments(current => current.map((segment, segmentIndex) =>
      segmentIndex === index
        ? { ...segment, [key]: key === "date" ? value : value.toUpperCase() }
        : segment));
    setError("");
  };
  const routeLabel = tripType === "roundtrip"
    ? `${from} ↔ ${to}`
    : tripType === "multicity"
      ? multiSegments.map(segment => segment.origin).concat(multiSegments.at(-1)?.destination || "").filter(Boolean).join(" → ")
      : `${from} → ${to}`;
  useEffect(() => { window.scrollTo({ top: 0, behavior: "auto" }); }, [stage]);
  useEffect(() => {
    if (!fareOffer) return;
    fareTriggerRef.current = document.activeElement as HTMLElement;
    fareCloseRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFareOffer(undefined);
        fareTriggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [fareOffer]);
  const continueFare = async () => {
    if (!fareOffer) return;
    if (!authenticated) {
      onLoginRequired();
      return;
    }
    setVerifyingId(fareOffer.id); setError(""); setFareError("");
    try {
      const verified = await api.verifyFlight({ offerId: fareOffer.id, priceKey: fareOffer.priceKey, quantity: travelerCount });
      setSelection(fareOffer); setVerifiedTotal(verified.totalAmount); setFareOffer(undefined); setStage("passengers");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : english ? "Fare verification failed. Search again." : "Fare verification failed; please search again";
      setFareError(message);
      window.requestAnimationFrame(() => fareErrorRef.current?.focus());
    } finally { setVerifyingId(""); }
  };
  const travelerField = <div className="search-field traveler-field"><span>{english ? "Travelers and cabin" : "Passengers & Cabin"}</span><button className="field-button" onClick={() => setTravelersOpen(value => !value)} aria-expanded={travelersOpen}><UserRound size={18} />{english ? `${adults} adult${adults > 1 ? "s" : ""}${children ? ` · ${children} child${children > 1 ? "ren" : ""}` : ""}${infants ? ` · ${infants} infant${infants > 1 ? "s" : ""}` : ""} · Economy` : `${adults} Adults${children ? ` · ${children} Children` : ""}${infants ? ` · ${infants} Infants` : ""} · Economy`}<ChevronDown size={15} /></button>
    {travelersOpen && <div className="light-popover traveler-popover glass glass-light" role="dialog" aria-label={english ? "Select flight travelers" : "Select Passengers"}>
      <div><span><strong>{english ? "Adults" : "Adults"}</strong><small>{english ? "Age 12 and above" : "12+ years"}</small></span><div className="counter"><button onClick={() => { const next = Math.max(1, adults - 1); setAdults(next); setInfants(current => Math.min(current, next)); }} disabled={adults === 1} aria-label={english ? "Remove adult" : "Fewer adults"}><Minus size={15} /></button><b>{adults}</b><button onClick={() => setAdults(Math.min(9 - children - infants, adults + 1))} disabled={travelerCount >= 9} aria-label={english ? "Add adult" : "More adults"}><Plus size={15} /></button></div></div>
      <div><span><strong>{english ? "Children" : "Children"}</strong><small>{english ? "Age 2–11" : "2–11 years"}</small></span><div className="counter"><button onClick={() => setChildren(Math.max(0, children - 1))} disabled={children === 0} aria-label={english ? "Remove child" : "Fewer children"}><Minus size={15} /></button><b>{children}</b><button onClick={() => setChildren(Math.min(8, children + 1))} disabled={travelerCount >= 9} aria-label={english ? "Add child" : "More children"}><Plus size={15} /></button></div></div>
      <div><span><strong>{english ? "Infants" : "Infants"}</strong><small>{english ? "Under 2 · one per adult" : "Under 2 · max 1 per adult"}</small></span><div className="counter"><button onClick={() => setInfants(Math.max(0, infants - 1))} disabled={infants === 0} aria-label={english ? "Remove infant" : "Fewer infants"}><Minus size={15} /></button><b>{infants}</b><button onClick={() => setInfants(Math.min(adults, infants + 1))} disabled={travelerCount >= 9 || infants >= adults} aria-label={english ? "Add infant" : "More infants"}><Plus size={15} /></button></div></div>
      <button className="popover-done" onClick={() => setTravelersOpen(false)}>{english ? "Done" : "Done"}</button></div>}
  </div>;
  const searchButton = <button className="primary search-cta" onClick={() => void search()} disabled={loading} aria-busy={loading}>{loading ? <><LoaderCircle className="spinner" size={18} />{english ? "Searching" : "Searching"}</> : <><Search size={18} />{english ? "Search flights" : "Search Flights"}</>}</button>;
  const searchForm = tripType === "multicity"
    ? <section className="search-card flight-search multicity-search glass glass-dark" aria-label={english ? "Multi-city flight search" : "Multi-city Flight Search"}>
      <div className="multi-segment-list">
        {multiSegments.map((segment, index) => <div className="multi-segment-row" key={`${index}-${segment.date}`}>
          <b>{english ? `Journey ${index + 1}` : `Segment ${index + 1}`}</b>
          <label className="search-field"><span>{english ? "From" : "From"}</span><div><Plane size={17} /><input aria-label={english ? `Journey ${index + 1} origin` : `Segment ${index + 1} origin`} value={segment.origin} onChange={event => updateMultiSegment(index, "origin", event.target.value)} /></div></label>
          <label className="search-field"><span>{english ? "To" : "To"}</span><div><MapPin size={17} /><input aria-label={english ? `Journey ${index + 1} destination` : `Segment ${index + 1} destination`} value={segment.destination} onChange={event => updateMultiSegment(index, "destination", event.target.value)} /></div></label>
          <label className="search-field"><span>{english ? "Departure date" : "Departure Date"}</span><div><CalendarDays size={17} /><input aria-label={english ? `Journey ${index + 1} departure date` : `Segment ${index + 1} date`} type="date" min={index === 0 ? localDateValue(new Date()) : multiSegments[index - 1].date} value={segment.date} onChange={event => updateMultiSegment(index, "date", event.target.value)} /></div></label>
          <button className="segment-remove" aria-label={english ? `Remove journey ${index + 1}` : `Remove segment ${index + 1}`} onClick={() => setMultiSegments(current => current.filter((_, segmentIndex) => segmentIndex !== index))} disabled={multiSegments.length === 2}><X size={16} /></button>
        </div>)}
      </div>
      <div className="multi-search-actions">
        <button className="add-segment" onClick={() => setMultiSegments(current => current.length >= 4 ? current : [...current, {
          origin: current.at(-1)?.destination || "",
          destination: "",
          date: current.at(-1)?.date || departureDate,
        }])} disabled={multiSegments.length >= 4}><Plus size={16} />{english ? "Add journey" : "Add Segment"}</button>
        {travelerField}
        {searchButton}
      </div>
      {error && stage === "home" && <div className="search-inline-error" role="alert"><CircleHelp size={16} /><span>{error}</span></div>}
    </section>
    : <section className={`search-card flight-search ${tripType === "roundtrip" ? "roundtrip-search" : ""} glass glass-dark`} aria-label={tripType === "roundtrip" ? english ? "Round-trip flight search" : "Round-trip Flight Search" : english ? "One-way flight search" : "One-way Flight Search"}>
      <label className="search-field"><span>{english ? "From" : "From"}</span><div><Plane size={18} /><input aria-label={english ? "Origin" : "From"} value={from} onChange={e => { setFrom(e.target.value.toUpperCase()); setError(""); }} /></div></label>
      <button className="route-swap" aria-label={english ? "Direction" : "Direction"}><ArrowRight size={16} /></button>
      <label className="search-field"><span>{english ? "To" : "To"}</span><div><MapPin size={18} /><input aria-label={english ? "Destination" : "To"} value={to} onChange={e => { setTo(e.target.value.toUpperCase()); setError(""); }} /></div></label>
      <label className="search-field"><span>{english ? "Departure date" : "Departure Date"}</span><div><CalendarDays size={18} /><input aria-label={english ? "Departure date" : "Departure Date"} type="date" min={localDateValue(new Date())} value={departureDate} onChange={e => { const next = e.target.value; setDepartureDate(next); setError(""); if (returnDate < next) setReturnDate(next); }} /></div></label>
      {tripType === "roundtrip" && <label className="search-field"><span>{english ? "Return date" : "Return Date"}</span><div><CalendarDays size={18} /><input aria-label={english ? "Return date" : "Return Date"} type="date" value={returnDate} min={departureDate} onChange={e => { setReturnDate(e.target.value); setError(""); }} /></div></label>}
      {travelerField}
      {searchButton}
      {error && stage === "home" && <div className="search-inline-error" role="alert"><CircleHelp size={16} /><span>{error}</span></div>}
    </section>;
  if (selection && stage === "passengers") return <FlightPassengerPage offer={selection} counts={{ adults, children, infants }} travelDate={departureDate} locale={locale} onBack={() => setStage("results")} onContinue={draft => { setBookingDraft(draft); setStage("payment"); }} />;
  if (selection && bookingDraft && stage === "payment") return <FlightPaymentPage offer={selection} counts={{ adults, children, infants }} verifiedTotal={verifiedTotal} draft={bookingDraft} onBack={() => setStage("passengers")} onComplete={created => { setOrder(created); setStage("result"); }} />;
  if (order && stage === "result") return <BookingResult order={order} type="flight" onDetails={() => setStage("orderDetail")} onRestart={() => { setSelection(undefined); setOrder(undefined); setBookingDraft(undefined); setStage("home"); }} />;
  if (order && stage === "orderDetail") return <OrderDetailView initialOrder={order} locale={locale} onOrderChange={setOrder} onBack={() => setStage("result")} onRestart={() => { setSelection(undefined); setOrder(undefined); setBookingDraft(undefined); setStage("home"); }} />;
  if (stage === "home") return (
      <section className="travel-hero flight-hero">
        <div className="hero-copy"><p className="eyebrow">THE WORLD IS CLOSER</p><h1>{english ? <>Your next journey,<br />on your terms</> : <>Your Next Destination,<br />Defined by You</>}</h1><p>{english ? "Connect to F-Link live global fares for search, verification, ticketing, changes, and refunds in one place." : "Connecting to F-Link global real-time fares..."}</p></div>
        <div className="trip-tabs glass glass-dark" aria-label={english ? "Trip type" : "Trip Type"}>
          <button className={tripType === "oneway" ? "active" : ""} aria-pressed={tripType === "oneway"} onClick={() => selectTripType("oneway")}>{english ? "One-way" : "One-way"}</button>
          <button className={tripType === "roundtrip" ? "active" : ""} aria-pressed={tripType === "roundtrip"} onClick={() => selectTripType("roundtrip")}>{english ? "Round trip" : "Round-trip"}</button>
          <button className={tripType === "multicity" ? "active" : ""} aria-pressed={tripType === "multicity"} onClick={() => selectTripType("multicity")}>{english ? "Multi-city" : "Multi-city"}</button>
        </div>
        {searchForm}
      </section>
  );
  return (
    <section className="booking-flow-page search-results-page">
      <button className="back-link" onClick={() => setStage("home")}><ArrowLeft size={17} />{english ? "Back to flight search" : "Back to Flight Search"}</button>
      <BookingProgress current={1} labels={english ? ["Search", "Flights and fares", "Passengers", "Payment", "Ticketing", "Booking details"] : ["Search", "Flights & Fares", "Passengers", "Payment", "Confirmation", "Order Detail"]} />
      <div className="compact-search-shell">{searchForm}</div>
      <section className="results-stage">
      {error && <div className="error-banner" role="alert">{error}<button onClick={() => void search()}>Search Again</button></div>}
      {tripType === "oneway" && <div className="low-fare-strip glass glass-light">{[-2,-1,0,1,2].map(offset => {
        const date = new Date(`${departureDate}T00:00:00`);
        date.setDate(date.getDate() + offset);
        const iso = localDateValue(date);
        return <button className={offset === 0 ? "active" : ""} aria-pressed={offset === 0} key={iso} onClick={() => void search(iso)} disabled={loading || iso < localDateValue(new Date())}><span>{new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric" }).format(date)}</span><strong>{offset === 0 && lowestVisibleFlight ? money(flightTotal(lowestVisibleFlight), lowestVisibleFlight.currency) : english ? "Check live fare" : "Check Live Price"}</strong></button>;
      })}</div>}
      <div className="result-heading"><div><p className="eyebrow">LIVE FARES</p><h2>{routeLabel}</h2><p>{tripType === "roundtrip" ? `${departureDate} ${english ? "to" : "to"} ${returnDate}` : tripType === "multicity" ? `${multiSegments.length} ${english ? "journeys" : "segment trip"}` : departureDate} · {english ? `${adults} adult${adults > 1 ? "s" : ""}${children ? `, ${children} child${children > 1 ? "ren" : ""}` : ""}${infants ? `, ${infants} infant${infants > 1 ? "s" : ""}` : ""}` : `${adults} Adults${children ? `, ${children} Children` : ""}${infants ? `, ${infants} Infants` : ""}`} · {english ? "Economy" : "Economy"} · {visibleFlights.length}{english ? " offers" : "flight options"}</p></div><div className="sort-actions"><select className="secondary sort-select" value={flightSort} onChange={event => { setFlightSort(event.target.value as typeof flightSort); setPageNumber(1); }} aria-label={english ? "Sort flights" : "Sort Flights"}><option value="price">{english ? "Lowest price" : "Price Priority"}</option><option value="departure">{english ? "Departure time" : "Departure Time Priority"}</option><option value="duration">{english ? "Shortest duration" : "Duration Priority"}</option></select></div></div>
      <div className="flight-result-layout"><aside className="filter-panel glass glass-light" aria-label={english ? "Flight filters" : "Flight Filters"}><div className="filter-panel-head"><h3>{english ? "Filter flights" : "Filter Flights"}</h3><button className="filter-clear" onClick={() => { clearAllFilters(); }}>{english ? "Clear all" : "Clear All"}</button></div>
      <div className="filter-group"><div className="filter-group-title"><strong>{english ? "Stops" : "Stops"}</strong></div><div className="time-slot-grid"><button className={maxStops === 0 ? "active" : ""} onClick={() => { setMaxStops(maxStops === 0 ? null : 0); setPageNumber(1); }}>{english ? "Nonstop" : "Nonstop"}</button><button className={maxStops === 1 ? "active" : ""} onClick={() => { setMaxStops(maxStops === 1 ? null : 1); setPageNumber(1); }}>≤ 1</button><button className={maxStops === 2 ? "active" : ""} onClick={() => { setMaxStops(maxStops === 2 ? null : 2); setPageNumber(1); }}>≤ 2</button></div></div>
      <div className="filter-group"><div className="filter-group-title"><strong>{english ? "Quick filters" : "Quick Filters"}</strong></div><label className="filter-option"><input type="checkbox" checked={directOnly} onChange={event => { setDirectOnly(event.target.checked); setPageNumber(1); }} /><span>{english ? "Nonstop only" : "Nonstop Only"}</span></label><label className="filter-option"><input type="checkbox" checked={baggageOnly} onChange={event => { setBaggageOnly(event.target.checked); setPageNumber(1); }} /><span>{english ? "Checked baggage included" : "Baggage Included"}</span></label><label className="filter-option"><input type="checkbox" checked={hideBudgetAirlines} onChange={event => { setHideBudgetAirlines(event.target.checked); setPageNumber(1); }} /><span>{english ? "Hide budget airlines" : "Hide Budget Airlines"}</span></label></div>
      {allianceStats.length > 0 && <div className="filter-group"><div className="filter-group-title"><strong>{english ? "Alliance" : "Alliance"}</strong></div>{allianceStats.map(a => <label className="filter-option" key={a.name}><input type="checkbox" checked={selectedAlliances.includes(a.name)} onChange={event => { setSelectedAlliances(current => event.target.checked ? [...current, a.name] : current.filter(value => value !== a.name)); setPageNumber(1); }} /><span>{a.name}</span><small>{a.count} · {money(a.minPrice, displayCurrency)}</small></label>)}</div>}
      <div className="filter-group"><div className="filter-group-title"><strong>{english ? "Airlines" : "Airlines"}</strong></div><label className="filter-search"><Search size={14} /><input placeholder={english ? "Search airline" : "Search Airline"} value={airlineSearch} onChange={event => { setAirlineSearch(event.target.value); setPageNumber(1); }} /></label>{filteredAirlines.slice(0, airlinesExpanded ? undefined : 5).map(a => <label className="filter-option" key={a.name}><input type="checkbox" checked={selectedAirlines.includes(a.name)} onChange={event => { setSelectedAirlines(current => event.target.checked ? [...current, a.name] : current.filter(value => value !== a.name)); setPageNumber(1); }} /><span>{a.name}</span><small>{a.count}</small></label>)}{filteredAirlines.length > 5 && <button className="text-button filter-expand" onClick={() => setAirlinesExpanded(value => !value)}>{airlinesExpanded ? (english ? "Show less" : "Show Less") : `${english ? "Show all" : "Show All"} (${filteredAirlines.length})`}</button>}</div>
      <div className="filter-group"><div className="filter-group-title"><strong>{english ? "Departure time" : "Departure Time"}</strong></div><div className="time-slot-grid"><button className={depTimeSlots.includes("early_morning") ? "active" : ""} onClick={() => { setDepTimeSlots(current => current.includes("early_morning") ? current.filter(v => v !== "early_morning") : [...current, "early_morning"]); setPageNumber(1); }}>{english ? "Early AM" : "Early AM"}<small>00-06</small></button><button className={depTimeSlots.includes("morning") ? "active" : ""} onClick={() => { setDepTimeSlots(current => current.includes("morning") ? current.filter(v => v !== "morning") : [...current, "morning"]); setPageNumber(1); }}>{english ? "Morning" : "Morning"}<small>06-12</small></button><button className={depTimeSlots.includes("afternoon") ? "active" : ""} onClick={() => { setDepTimeSlots(current => current.includes("afternoon") ? current.filter(v => v !== "afternoon") : [...current, "afternoon"]); setPageNumber(1); }}>{english ? "Afternoon" : "Afternoon"}<small>12-18</small></button><button className={depTimeSlots.includes("evening") ? "active" : ""} onClick={() => { setDepTimeSlots(current => current.includes("evening") ? current.filter(v => v !== "evening") : [...current, "evening"]); setPageNumber(1); }}>{english ? "Evening" : "Evening"}<small>18-24</small></button></div></div>
      <div className="filter-group"><div className="filter-group-title"><strong>{english ? "Arrival time" : "Arrival Time"}</strong></div><div className="time-slot-grid"><button className={arrTimeSlots.includes("early_morning") ? "active" : ""} onClick={() => { setArrTimeSlots(current => current.includes("early_morning") ? current.filter(v => v !== "early_morning") : [...current, "early_morning"]); setPageNumber(1); }}>{english ? "Early AM" : "Early AM"}<small>00-06</small></button><button className={arrTimeSlots.includes("morning") ? "active" : ""} onClick={() => { setArrTimeSlots(current => current.includes("morning") ? current.filter(v => v !== "morning") : [...current, "morning"]); setPageNumber(1); }}>{english ? "Morning" : "Morning"}<small>06-12</small></button><button className={arrTimeSlots.includes("afternoon") ? "active" : ""} onClick={() => { setArrTimeSlots(current => current.includes("afternoon") ? current.filter(v => v !== "afternoon") : [...current, "afternoon"]); setPageNumber(1); }}>{english ? "Afternoon" : "Afternoon"}<small>12-18</small></button><button className={arrTimeSlots.includes("evening") ? "active" : ""} onClick={() => { setArrTimeSlots(current => current.includes("evening") ? current.filter(v => v !== "evening") : [...current, "evening"]); setPageNumber(1); }}>{english ? "Evening" : "Evening"}<small>18-24</small></button></div></div>
      <div className="filter-group"><div className="filter-group-title"><strong>{english ? "Flight duration" : "Flight Duration"}</strong></div><div className="time-slot-grid"><button className={maxDuration === 180 ? "active" : ""} onClick={() => { setMaxDuration(maxDuration === 180 ? null : 180); setPageNumber(1); }}>≤ 3h</button><button className={maxDuration === 360 ? "active" : ""} onClick={() => { setMaxDuration(maxDuration === 360 ? null : 360); setPageNumber(1); }}>≤ 6h</button><button className={maxDuration === 600 ? "active" : ""} onClick={() => { setMaxDuration(maxDuration === 600 ? null : 600); setPageNumber(1); }}>≤ 10h</button></div></div>
      </aside>
      <div className="flight-list">{pagedFlights.map(flight => <article className={`flight-card ${flight.journeys && flight.journeys.length > 1 ? "multi-journey-card" : ""}`} key={flight.id}>
        <div className="airline-badge">{flight.airlineCode}</div><div className="airline"><strong>{flight.airline}</strong><span>{flight.flightNo} · {flight.cabin}</span></div>
        {flight.journeys && flight.journeys.length > 1
          ? <div className="journey-list">{flight.journeys.map((journey, index) => <div className="journey-row" key={`${journey.date}-${journey.origin}-${journey.destination}`}><b>{tripType === "roundtrip" ? index === 0 ? "Outbound" : "Return" : `Segment ${index + 1}`}</b><span><strong>{journey.departureTime}</strong><small>{journey.origin}</small></span><i><small>{journey.date} · {journey.flightNo}</small><em>{journey.duration} · {journey.stops ? `${journey.stops} stops` : "Direct"}</em></i><span><strong>{journey.arrivalTime}</strong><small>{journey.destination}</small></span></div>)}</div>
          : <><div className="flight-time"><strong>{flight.departureTime}</strong><span>{flight.departureAirport}</span></div>
            <div className="flight-route"><span>{flight.duration}</span><i /><small>{flight.stops ? `${flight.stops} stops` : "Direct"}</small></div>
            <div className="flight-time"><strong>{flight.arrivalTime}</strong><span>{flight.arrivalAirport}</span></div></>}
        <div className="baggage">{flight.baggage}<small>Total Tax Included</small></div>
        <div className="flight-price"><strong>{money(flightTotal(flight), flight.currency)}</strong><button className="primary" onClick={() => { setFareError(""); setFareOffer(flight); }}>{english ? "Select" : "Select"}</button></div>
      </article>)}{!pagedFlights.length && <div className="hotel-empty-state glass glass-light"><h3>{items.length ? "No flights match your filters" : "No available flights for the selected date"}</h3><p>{items.length ? "Please relax direct-only or baggage filters." : "F-Link did not return valid fares..."}</p><button className="primary" onClick={() => { if (items.length) { setDirectOnly(false); setBaggageOnly(false); } else { setStage("home"); } }}>{items.length ? "Clear Filters" : "Modify Search"}</button></div>}
      {totalPages > 1 && <nav className="pagination" aria-label="Flight Results Pagination"><button className="secondary" onClick={() => setPageNumber(value => Math.max(1, value - 1))} disabled={pageNumber === 1}>Previous</button><span>Page {pageNumber} / {totalPages}</span><button className="secondary" onClick={() => setPageNumber(value => Math.min(totalPages, value + 1))} disabled={pageNumber === totalPages}>Next</button></nav>}</div></div>
      </section>
      {fareOffer && <div className="overlay-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) setFareOffer(undefined); }}>
        <section className="fare-drawer glass glass-light" role="dialog" aria-modal="true" aria-labelledby="fare-title">
          <button ref={fareCloseRef} className="drawer-close" onClick={() => { setFareOffer(undefined); fareTriggerRef.current?.focus(); }} aria-label="Close Fare Selection"><X size={20} /></button>
          <header><p className="eyebrow">SELECT FARE</p><h2 id="fare-title">{routeLabel}</h2><p>{fareOffer.journeys && fareOffer.journeys.length > 1 ? `${fareOffer.journeys.length} segment itinerary · ${fareOffer.flightNo}` : `${fareOffer.airline} ${fareOffer.flightNo} · ${fareOffer.departureTime}—${fareOffer.arrivalTime} · ${fareOffer.duration}`}</p></header>
          {fareError && <div ref={fareErrorRef} className="fare-verification-error" role="alert" aria-live="assertive" tabIndex={-1}>
            <span><AlertTriangle size={21} /></span>
            <div><strong>{/price\s*key|运价.*(变化|失效|过期)/i.test(fareError) ? english ? "This fare has expired" : "This fare has expired" : english ? "Live fare verification failed" : "Real-time fare verification failed"}</strong><p>{english ? "F-Link could not confirm this price. Search again to get a new priceKey before continuing." : "F-Link could not confirm current fare..."}</p><small>{fareError}</small></div>
            <button className="fare-retry-button" onClick={() => { setFareOffer(undefined); setFareError(""); void search(); }} disabled={loading}><RefreshCw size={15} />{english ? "Search latest fares" : "Search for latest fares"}</button>
          </div>}
          <div className="fare-option-grid">
            <label className="fare-option selected"><input type="radio" checked readOnly name="fare-brand" /><span><strong>Standard Economy</strong><small>Real-time fare from F-Link</small><small>Baggage Allowance {fareOffer.baggage}</small><small>Refund/exchange subject to verified fare rules</small></span><b>{money(flightTotal(fareOffer), fareOffer.currency)}</b></label>
            <label className="fare-option disabled" aria-disabled="true"><input type="radio" disabled name="fare-brand" /><span><strong>Flexible Economy</strong><small>No matching priceKey returned for this search</small><small>Cannot be submitted as a real bookable fare</small></span><b>Not Bookable</b></label>
            <label className="fare-option disabled" aria-disabled="true"><input type="radio" disabled name="fare-brand" /><span><strong>Flexible Refund Protection</strong><small>Requires protection product and independent fulfillment agreement</small><small>Will not be included in order or charged</small></span><b>Coming Soon</b></label>
          </div>
          <footer><div><small>Real-time Total Tax Included</small><strong>{money(flightTotal(fareOffer), fareOffer.currency)}</strong></div><button className="primary" onClick={continueFare} disabled={verifyingId === fareOffer.id || Boolean(fareError)}>{verifyingId ? <><LoaderCircle className="spinner" size={17} />Verifying fare...</> : fareError ? <><AlertTriangle size={17} />{english ? "Fare expired" : "Fare Expired"}</> : authenticated ? <>Continue to Passengers<ChevronRight size={17} /></> : <><LogIn size={17} />Sign in to Book</>}</button></footer>
        </section>
      </div>}
    </section>
  );
}

function OrdersPage({ locale }: { locale: LocaleCode }) {
  const english = locale === "en";
  const [orders, setOrders] = useState<DistributionOrder[]>([]);
  const [selection, setSelection] = useState<DistributionOrder>();
  const [productFilter, setProductFilter] = useState<OrderProductFilter>("all");
  const [statusFilter, setStatusFilter] = useState<OrderStatusFilter>("all");
  const [datePreset, setDatePreset] = useState<OrderDatePreset>("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [keyword, setKeyword] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api.listOrders().then(items => { if (active) setOrders(items); })
      .catch(caught => { if (active) setError(caught instanceof Error ? caught.message : "Failed to load orders"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [english]);
  const visibleOrders = useMemo(() => orders.filter(order => {
    if (productFilter !== "all" && order.productType !== productFilter) return false;
    if (!orderMatchesStatusFilter(order, statusFilter)) return false;
    const createdDate = orderCreatedDateValue(order);
    if (startDate && (!createdDate || createdDate < startDate)) return false;
    if (endDate && (!createdDate || createdDate > endDate)) return false;
    if (minAmount && order.amount < Number(minAmount)) return false;
    if (maxAmount && order.amount > Number(maxAmount)) return false;
    const query = keyword.trim().toLowerCase();
    if (query) {
      const labels = locale === "en" ? statusLabelsEn : statusLabels;
      const haystack = [
        order.id,
        order.supplierOrderNo,
        order.title,
        order.subtitle,
        order.customer,
        order.currency,
        labels[order.status],
      ].filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  }), [endDate, keyword, locale, maxAmount, minAmount, orders, productFilter, startDate, statusFilter]);
  const synchronizeOrder = (updated: DistributionOrder) => {
    setSelection(updated);
    setOrders(current => current.map(order => order.id === updated.id ? updated : order));
  };
  if (selection) return <OrderDetailView initialOrder={selection} locale={locale} onOrderChange={synchronizeOrder} onBack={() => setSelection(undefined)} />;
  const filters: Array<[OrderStatusFilter, string]> = [
    ["all", "All Orders"],
    ["pending", "Pending"],
    ["confirmed", "Confirmed"],
    ["aftersales", "After-sales"],
  ];
  const updateDatePreset = (value: OrderDatePreset) => {
    setDatePreset(value);
    if (value === "all") {
      setStartDate("");
      setEndDate("");
    } else if (value === "today") {
      const today = localDateValue(new Date());
      setStartDate(today);
      setEndDate(today);
    } else if (value === "7d") {
      setStartDate(dateDaysAgo(6));
      setEndDate(localDateValue(new Date()));
    } else if (value === "30d") {
      setStartDate(dateDaysAgo(29));
      setEndDate(localDateValue(new Date()));
    }
  };
  const resetFilters = () => {
    setProductFilter("all");
    setStatusFilter("all");
    setDatePreset("all");
    setStartDate("");
    setEndDate("");
    setKeyword("");
    setMinAmount("");
    setMaxAmount("");
  };
  const activeFilterCount = [
    productFilter !== "all",
    statusFilter !== "all",
    datePreset !== "all" || Boolean(startDate || endDate),
    Boolean(keyword.trim()),
    Boolean(minAmount || maxAmount),
  ].filter(Boolean).length;
  return <section className="consumer-content-page orders-content-page"><section className="page-heading compact"><div><p className="eyebrow">MY BOOKINGS</p><h1>My Orders</h1><p>View hotel, flight, and after-sales progress in one place</p></div></section>
    {error && <div className="error-banner" role="alert">{error}</div>}
    <section className="booking-filter-panel glass glass-light" aria-label="Order Filters">
      <div className="booking-filter-head">
        <div><span><SlidersHorizontal size={17} /></span><div><strong>Filter Orders</strong><small>{`Showing ${visibleOrders.length} / ${orders.length} orders`}</small></div></div>
        <button className="text-button" onClick={resetFilters} disabled={!activeFilterCount}>Clear Filters{activeFilterCount ? ` · ${activeFilterCount}` : ""}</button>
      </div>
      <div className="filter-bar" aria-label="Quick Status Filter">{filters.map(([value, label]) => <button key={value} className={statusFilter === value ? "active" : ""} aria-pressed={statusFilter === value} onClick={() => setStatusFilter(value)}>{label}<span>{orders.filter(order => orderMatchesStatusFilter(order, value)).length}</span></button>)}</div>
      <div className="booking-filter-grid">
        <label className="wide"><span>Keyword</span><div className="input-with-icon"><Search size={16} /><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="Order ID, supplier ID, customer, hotel, or route" /></div></label>
        <label><span>Product Type</span><select value={productFilter} onChange={event => setProductFilter(event.target.value as OrderProductFilter)}><option value="all">All Products</option><option value="hotel">Hotels</option><option value="flight">Flights</option></select></label>
        <label><span>Exact Status</span><select value={statusFilter} onChange={event => setStatusFilter(event.target.value as OrderStatusFilter)}><option value="all">All Status</option><option value="pending">Pending</option><option value="confirmed">Confirmed</option><option value="aftersales">After-sales</option>{concreteOrderStatuses.map(status => <option key={status} value={status}>{english ? statusLabelsEn[status] : statusLabels[status]}</option>)}</select></label>
        <label><span>Created Time</span><select value={datePreset} onChange={event => updateDatePreset(event.target.value as OrderDatePreset)}><option value="all">Any Time</option><option value="today">Today</option><option value="7d">Last 7 Days</option><option value="30d">Last 30 Days</option><option value="custom">Custom</option></select></label>
        <label><span>Start Date</span><input type="date" value={startDate} onChange={event => { setDatePreset("custom"); setStartDate(event.target.value); }} /></label>
        <label><span>End Date</span><input type="date" value={endDate} onChange={event => { setDatePreset("custom"); setEndDate(event.target.value); }} /></label>
        <label><span>Min Amount</span><input type="number" min="0" inputMode="decimal" value={minAmount} onChange={event => setMinAmount(event.target.value)} placeholder="Any" /></label>
        <label><span>Max Amount</span><input type="number" min="0" inputMode="decimal" value={maxAmount} onChange={event => setMaxAmount(event.target.value)} placeholder="Any" /></label>
      </div>
    </section>
    {loading ? <div className="loading-state" aria-live="polite"><LoaderCircle className="spinner" size={20} />Loading orders...</div> : <OrderTable orders={visibleOrders} onSelect={setSelection} locale={locale} />}</section>;
}

type AccountSection = "profile" | "security" | "travelers" | "favorites" | "notifications" | "billing";

function AccountPage({
  navigate,
  locale,
  setLocale,
  onProfileSaved,
  role,
}: {
  navigate: (page: Page) => void;
  locale: LocaleCode;
  setLocale: (locale: LocaleCode) => void;
  onProfileSaved: (profile: AccountProfile) => void;
  role: "admin" | "member";
}) {
  const { catalog: nationalityCatalog, error: nationalityError } = useNationalityCatalog(locale);
  const tr = useCallback(
    (zh: string, en: string, zhTw = zh) => locale === "en" ? en : locale === "zh-TW" ? zhTw : zh,
    [locale],
  );
  const [section, setSection] = useState<AccountSection>(() => {
    const remembered = window.sessionStorage.getItem("fusiongo.accountSection");
    window.sessionStorage.removeItem("fusiongo.accountSection");
    return remembered === "favorites" ? "favorites" : "profile";
  });
  const [feedback, setFeedback] = useState<{ tone: "success" | "error" | "info"; text: string }>();
  const [dialog, setDialog] = useState<"password" | "traveler" | "credit" | "mfa" | "">("");
  const [profile, setProfile] = useState({
    surname: "",
    givenName: "",
    language: locale,
    phone: "",
    email: "",
  });
  const [savedName, setSavedName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [pendingAvatar, setPendingAvatar] = useState<File>();
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingTraveler, setSavingTraveler] = useState(false);
  const [savingNotifications, setSavingNotifications] = useState(false);
  const [editingTravelerId, setEditingTravelerId] = useState("");
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [passwordForm, setPasswordForm] = useState({ current: "", next: "", confirm: "" });
  const emptyTraveler = {
    surname: "", givenName: "", type: "adult" as "adult" | "child" | "infant",
    gender: "1" as "1" | "2", birthday: "", nationality: "CN",
    documentNo: "", issuingCountry: "CN", expiration: "",
  };
  const [travelerDraft, setTravelerDraft] = useState(emptyTraveler);
  const [travelers, setTravelers] = useState<AccountTraveler[]>([]);
  const [favoriteHotels, setFavoriteHotels] = useState<FavoriteHotel[]>([]);
  const [favoritesLoading, setFavoritesLoading] = useState(true);
  const [removingFavoriteId, setRemovingFavoriteId] = useState("");
  const [notifications, setNotifications] = useState({ order: true, flight: true, marketing: false });
  const [creditDraft, setCreditDraft] = useState({ amount: 250000, reason: "" });
  const [creditSummary, setCreditSummary] = useState<Pick<FinanceSummary, "totalCredit" | "availableCredit">>();

  const menu = ([
    { id: "profile", label: tr("Profile", "Profile", "Profile"), icon: UserRound },
    { id: "security", label: tr("Security", "Security", "Security"), icon: LockKeyhole },
    { id: "travelers", label: tr("Saved travelers", "Saved travelers", "Saved travelers"), icon: Users },
    { id: "favorites", label: tr("Favorite hotels", "Favorite hotels", "Favorite hotels"), icon: Heart },
    { id: "notifications", label: tr("Notifications", "Notifications", "Notifications"), icon: Bell },
    { id: "billing", label: tr("Payment & credit", "Payment & credit", "Payment & credit"), icon: CreditCard },
  ] satisfies Array<{ id: AccountSection; label: string; icon: typeof UserRound }>).filter(item => role === "admin" || item.id !== "billing");
  const showFeedback = (tone: "success" | "error" | "info", text: string) => setFeedback({ tone, text });
  useEffect(() => {
    let active = true;
    Promise.all([
      api.getAccountProfile(),
      api.listAccountTravelers(),
      api.getNotificationPreferences(),
      role === "admin" ? api.financeSummary() : Promise.resolve(undefined),
    ]).then(([saved, savedTravelers, savedNotifications, savedCredit]) => {
      if (!active) return;
      setProfile({
        ...(saved.surname || saved.givenName
          ? { surname: saved.surname || "", givenName: saved.givenName || "" }
          : splitPersonName(saved.name)),
        language: saved.language,
        phone: saved.phone,
        email: saved.email,
      });
      setSavedName(saved.name);
      setAvatarUrl(saved.avatarUrl || "");
      setTravelers(savedTravelers);
      setNotifications({
        order: savedNotifications.order,
        flight: savedNotifications.flight,
        marketing: savedNotifications.marketing,
      });
      if (savedCredit) {
        setCreditSummary({ totalCredit: savedCredit.totalCredit, availableCredit: savedCredit.availableCredit });
        setCreditDraft(current => ({ ...current, amount: Math.max(current.amount, savedCredit.totalCredit + 50000) }));
      }
      onProfileSaved(saved);
    }).catch(caught => {
      if (active) showFeedback("error", caught instanceof Error ? caught.message : tr("账户资料读取失败", "Could not load account profile.", "帳戶資料讀取失敗"));
    });
    return () => { active = false; };
  }, [onProfileSaved, role, setLocale]);
  useEffect(() => {
    let active = true;
    api.listFavoriteHotels().then(items => { if (active) setFavoriteHotels(items); })
      .catch(caught => { if (active) showFeedback("error", caught instanceof Error ? caught.message : tr("收藏酒店读取失败", "Could not load favorite hotels.", "收藏飯店讀取失敗")); })
      .finally(() => { if (active) setFavoritesLoading(false); });
    return () => { active = false; };
  }, []);
  const removeFavoriteHotel = async (hotel: FavoriteHotel) => {
    setRemovingFavoriteId(hotel.id);
    try {
      await api.deleteFavoriteHotel(hotel.id);
      setFavoriteHotels(current => current.filter(item => item.id !== hotel.id));
      showFeedback("success", tr(`Removed ${hotel.name} from favorites.`, `Removed ${hotel.name} from favorites.`, `Removed ${hotel.name} from favorites.`));
    } catch (caught) {
      showFeedback("error", caught instanceof Error ? caught.message : tr("Could not remove favorite.", "Could not remove favorite.", "Could not remove favorite."));
    } finally {
      setRemovingFavoriteId("");
    }
  };
  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!profile.surname.trim() || !profile.givenName.trim()) return showFeedback("error", tr("Enter surname and given name separately.", "Enter surname and given name separately.", "Enter surname and given name separately."));
    if (!isValidInternationalPhone(profile.phone)) return showFeedback("error", tr("Enter a valid international phone number with 7–15 digits and an optional country code.", "Enter a valid international phone number with 7–15 digits and an optional country code.", "Enter a valid international phone number with 7–15 digits and an optional country code."));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)) return showFeedback("error", tr("Enter a valid email address.", "Enter a valid email address.", "Enter a valid email address."));
    setSavingProfile(true);
    try {
      let saved = await api.updateAccountProfile({
        name: joinPersonName({ surname: profile.surname, givenName: profile.givenName }),
        surname: profile.surname.trim(),
        givenName: profile.givenName.trim(),
        language: profile.language,
        phone: profile.phone,
        email: profile.email,
      });
      if (pendingAvatar) saved = await api.uploadAccountAvatar(pendingAvatar);
      setSavedName(saved.name);
      setLocale(saved.language);
      setAvatarUrl(saved.avatarUrl || "");
      onProfileSaved(saved);
      setPendingAvatar(undefined);
      if (avatarInputRef.current) avatarInputRef.current.value = "";
      showFeedback("success", pendingAvatar ? tr("Profile and avatar saved.", "Profile and avatar saved.", "Profile and avatar saved.") : tr("Profile saved.", "Profile saved.", "Profile saved."));
    } catch (caught) {
      showFeedback("error", caught instanceof Error ? caught.message : tr("Could not save profile.", "Could not save profile.", "Could not save profile."));
    } finally {
      setSavingProfile(false);
    }
  };
  const chooseAvatar = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!["image/png", "image/jpeg"].includes(file.type) || file.size > 2 * 1024 * 1024) {
      showFeedback("error", tr("Choose a PNG or JPG image no larger than 2 MB.", "Choose a PNG or JPG image no larger than 2 MB.", "Choose a PNG or JPG image no larger than 2 MB."));
      event.target.value = "";
      return;
    }
    setPendingAvatar(file);
    const reader = new FileReader();
    reader.onload = () => {
      setAvatarUrl(String(reader.result || ""));
      showFeedback("info", tr(`${file.name} selected. Choose “Save changes” to finish.`, `${file.name} selected. Choose “Save changes” to finish.`, `${file.name} selected. Choose “Save changes” to finish.`));
    };
    reader.readAsDataURL(file);
  };
  const updatePassword = (event: React.FormEvent) => {
    event.preventDefault();
    if (passwordForm.next.length < 8) return showFeedback("error", tr("The new password must contain at least 8 characters.", "The new password must contain at least 8 characters.", "The new password must contain at least 8 characters."));
    if (passwordForm.next !== passwordForm.confirm) return showFeedback("error", tr("The new passwords do not match.", "The new passwords do not match.", "The new passwords do not match."));
    setDialog("");
    setPasswordForm({ current: "", next: "", confirm: "" });
    showFeedback("info", tr("Password validation passed. Production changes must be completed through the corporate identity service.", "Password validation passed. Production changes must be completed through the corporate identity service.", "Password validation passed. Production changes must be completed through the corporate identity service."));
  };
  const openNewTraveler = () => {
    setEditingTravelerId("");
    setTravelerDraft(emptyTraveler);
    setDialog("traveler");
  };
  const openEditTraveler = (traveler: AccountTraveler) => {
    setEditingTravelerId(traveler.id);
    setTravelerDraft({
      surname: traveler.surname,
      givenName: traveler.givenName,
      type: traveler.type,
      gender: traveler.gender,
      birthday: traveler.birthday,
      nationality: traveler.nationality,
      documentNo: "",
      issuingCountry: traveler.issuingCountry,
      expiration: traveler.expiration,
    });
    setDialog("traveler");
  };
  const saveTraveler = async (event: React.FormEvent) => {
    event.preventDefault();
    const englishNamePattern = /^[A-Za-z][A-Za-z '\-]*$/;
    if (!englishNamePattern.test(travelerDraft.surname.trim())) return showFeedback("error", tr("Surname may contain only Latin letters, spaces, hyphens, or apostrophes.", "Surname may contain only Latin letters, spaces, hyphens, or apostrophes.", "Surname may contain only Latin letters, spaces, hyphens, or apostrophes."));
    if (!englishNamePattern.test(travelerDraft.givenName.trim())) return showFeedback("error", tr("Given name may contain only Latin letters, spaces, hyphens, or apostrophes.", "Given name may contain only Latin letters, spaces, hyphens, or apostrophes.", "Given name may contain only Latin letters, spaces, hyphens, or apostrophes."));
    const documentNo = travelerDraft.documentNo.trim().toUpperCase();
    if ((!editingTravelerId || documentNo) && !/^[A-Z0-9]{5,20}$/.test(documentNo)) return showFeedback("error", tr("Enter a passport number containing 5–20 letters or digits.", "Enter a passport number containing 5–20 letters or digits.", "Enter a passport number containing 5–20 letters or digits."));
    if (!travelerDraft.birthday || travelerDraft.birthday >= new Date().toISOString().slice(0, 10)) return showFeedback("error", tr("Enter a valid date of birth.", "Enter a valid date of birth.", "Enter a valid date of birth."));
    if (!travelerDraft.expiration || travelerDraft.expiration <= new Date().toISOString().slice(0, 10)) return showFeedback("error", tr("The passport is expired or its expiry date is invalid.", "The passport is expired or its expiry date is invalid.", "The passport is expired or its expiry date is invalid."));
    const payload = {
      surname: travelerDraft.surname.trim().toUpperCase(),
      givenName: travelerDraft.givenName.trim().toUpperCase(),
      type: travelerDraft.type,
      gender: travelerDraft.gender,
      birthday: travelerDraft.birthday,
      nationality: travelerDraft.nationality,
      issuingCountry: travelerDraft.issuingCountry,
      expiration: travelerDraft.expiration,
    };
    setSavingTraveler(true);
    try {
      if (editingTravelerId) {
        const saved = await api.updateAccountTraveler(editingTravelerId, {
          ...payload,
          ...(documentNo ? { documentNo } : {}),
        });
        setTravelers(current => current.map(item => item.id === saved.id ? saved : item));
        showFeedback("success", tr("Saved traveler updated.", "Saved traveler updated.", "Saved traveler updated."));
      } else {
        const saved = await api.createAccountTraveler({ ...payload, documentNo });
        setTravelers(current => [...current, saved]);
        showFeedback("success", tr("Saved traveler added.", "Saved traveler added.", "Saved traveler added."));
      }
      setTravelerDraft(emptyTraveler);
      setEditingTravelerId("");
      setDialog("");
    } catch (caught) {
      showFeedback("error", caught instanceof Error ? caught.message : tr("Could not save traveler.", "Could not save traveler.", "Could not save traveler."));
    } finally {
      setSavingTraveler(false);
    }
  };
  const removeTraveler = async (traveler: AccountTraveler) => {
    try {
      await api.deleteAccountTraveler(traveler.id);
      setTravelers(current => current.filter(item => item.id !== traveler.id));
      showFeedback("success", tr(`${traveler.surname} / ${traveler.givenName} was removed.`, `${traveler.surname} / ${traveler.givenName} was removed.`, `${traveler.surname} / ${traveler.givenName} was removed.`));
    } catch (caught) {
      showFeedback("error", caught instanceof Error ? caught.message : tr("Could not remove traveler.", "Could not remove traveler.", "Could not remove traveler."));
    }
  };
  const saveNotifications = async () => {
    setSavingNotifications(true);
    try {
      const saved = await api.updateNotificationPreferences(notifications);
      setNotifications({ order: saved.order, flight: saved.flight, marketing: saved.marketing });
      showFeedback("success", tr("Notification preferences saved.", "Notification preferences saved.", "Notification preferences saved."));
    } catch (caught) {
      showFeedback("error", caught instanceof Error ? caught.message : tr("Could not save notification preferences.", "Could not save notification preferences.", "Could not save notification preferences."));
    } finally {
      setSavingNotifications(false);
    }
  };
  const submitCreditRequest = (event: React.FormEvent) => {
    event.preventDefault();
    const currentCredit = creditSummary?.totalCredit ?? 0;
    if (creditDraft.amount <= currentCredit) return showFeedback("error", tr(`The requested credit must exceed the current limit of ${money(currentCredit)}.`, `The requested credit must exceed the current limit of ${money(currentCredit)}.`, `The requested credit must exceed the current limit of ${money(currentCredit)}.`));
    if (!creditDraft.reason.trim()) return showFeedback("error", tr("Enter a reason for the credit adjustment.", "Enter a reason for the credit adjustment.", "Enter a reason for the credit adjustment."));
    setDialog("");
    showFeedback("info", tr(`Credit adjustment request for ${money(creditDraft.amount)} recorded; corporate approval integration is pending.`, `Credit adjustment request for ${money(creditDraft.amount)} recorded; corporate approval integration is pending.`, `Credit adjustment request for ${money(creditDraft.amount)} recorded; corporate approval integration is pending.`));
  };

  return <section className="consumer-content-page"><section className="page-heading compact"><div><p className="eyebrow">ACCOUNT SETTINGS</p><h1>{tr("Account settings", "Account settings", "Account settings")}</h1><p>{tr("Manage your profile, security, saved travelers, and notification preferences.", "Manage your profile, security, saved travelers, and notification preferences.", "Manage your profile, security, saved travelers, and notification preferences.")}</p></div></section>
    {feedback && <div className={`account-feedback ${feedback.tone}`} role={feedback.tone === "error" ? "alert" : "status"}><span>{feedback.text}</span><button onClick={() => setFeedback(undefined)}>{tr("Close", "Close", "Close")}</button></div>}
    <div className="account-layout"><aside className="account-menu glass glass-light" aria-label={tr("Account settings menu", "Account settings menu", "Account settings menu")}>{menu.map(({ id, label, icon: Icon }) => <button key={id} className={section === id ? "active" : ""} aria-current={section === id ? "page" : undefined} onClick={() => { setSection(id); setFeedback(undefined); }}><Icon size={17} />{label}</button>)}</aside>
      <div className="account-main">
        {section === "profile" && <form className="form-section glass glass-light" onSubmit={saveProfile}><div className="profile-heading"><div className="large-avatar">{avatarUrl ? <img src={avatarUrl} alt={tr("Profile avatar", "Profile avatar", "Profile avatar")} /> : savedName.slice(0, 1)}</div><div><h2>{savedName}</h2><p>{role === "admin" ? tr("Super administrator · Global Travel", "Super administrator · Global Travel", "Super administrator · Global Travel") : tr("Booking member · Global Travel", "Booking member · Global Travel", "Booking member · Global Travel")}{pendingAvatar ? tr(" · New avatar pending", " · New avatar pending", " · New avatar pending") : ""}</p></div><input ref={avatarInputRef} hidden type="file" accept="image/png,image/jpeg" onChange={chooseAvatar} /><button type="button" className="secondary" onClick={() => avatarInputRef.current?.click()} disabled={savingProfile}>{tr("Change avatar", "Change avatar", "Change avatar")}</button></div><div className="form-grid"><label><span>{tr("Surname", "Surname", "Surname")}</span><input aria-label={tr("Surname", "Surname", "Surname")} required value={profile.surname} onChange={event => setProfile(current => ({ ...current, surname: event.target.value }))} /></label><label><span>{tr("Given name", "Given name", "Given name")}</span><input aria-label={tr("Given name", "Given name", "Given name")} required value={profile.givenName} onChange={event => setProfile(current => ({ ...current, givenName: event.target.value }))} /></label><label><span>{tr("Display language", "Display language", "Display language")}</span><select aria-label={tr("Display language", "Display language", "Display language")} value={profile.language} onChange={event => setProfile(current => ({ ...current, language: event.target.value as LocaleCode }))}><option value="zh-CN">Simplified Chinese</option><option value="zh-TW">Traditional Chinese</option><option value="en">English</option></select></label><label><span>{tr("International phone number", "International phone number", "International phone number")}</span><input aria-label={tr("International phone number", "International phone number", "International phone number")} type="tel" inputMode="tel" autoComplete="tel" placeholder="+65 6474 0800" value={profile.phone} onChange={event => setProfile(current => ({ ...current, phone: event.target.value }))} /></label><label className="wide"><span>{tr("Email address", "Email address", "Email address")}</span><input aria-label={tr("Email address", "Email address", "Email address")} type="email" value={profile.email} onChange={event => setProfile(current => ({ ...current, email: event.target.value }))} /></label></div><div className="form-actions"><button className="primary" disabled={savingProfile} aria-busy={savingProfile}>{savingProfile ? <><LoaderCircle className="spinner" size={16} />{tr("Saving…", "Saving…", "Saving…")}</> : tr("Save changes", "Save changes", "Save changes")}</button></div></form>}

        {section === "security" && <section className="form-section glass glass-light"><div className="section-title"><span><ShieldCheck size={17} /></span><div><h2>{tr("Account security", "Account security", "Account security")}</h2><p>{tr("Real sign-in audit history is not connected in this sandbox.", "Real sign-in audit history is not connected in this sandbox.", "Real sign-in audit history is not connected in this sandbox.")}</p></div></div><div className="security-row"><div><strong>{tr("Password", "Password", "Password")}</strong><span>{tr("We recommend updating it every 90 days.", "We recommend updating it every 90 days.", "We recommend updating it every 90 days.")}</span></div><button className="secondary" onClick={() => setDialog("password")}>{tr("Change password", "Change password", "Change password")}</button></div><div className="security-row"><div><strong>{tr("Two-factor authentication", "Two-factor authentication", "Two-factor authentication")}</strong><span>{tr("尚未接入企业身份与短信验证服务", "Corporate identity and SMS verification are not connected.", "尚未接入企業身分與簡訊驗證服務")}</span></div><div className="security-actions"><span className="pending-badge">{tr("未开通", "Unavailable", "未開通")}</span><button className="secondary" disabled>{tr("管理验证", "Manage verification", "管理驗證")}</button></div></div></section>}

        {section === "travelers" && <section className="form-section glass glass-light"><div className="account-section-head"><div className="section-title"><span><Users size={17} /></span><div><h2>{tr("常用旅客", "Saved travelers", "常用旅客")}</h2><p>{tr("预订时可快速填充，证件号码默认脱敏展示", "Reuse traveler details during booking; document numbers remain masked.", "預訂時可快速填入，證件號碼預設遮罩顯示")}</p></div></div><button className="primary" onClick={openNewTraveler}><Plus size={16} />{tr("新增旅客", "Add traveler", "新增旅客")}</button></div><div className="traveler-list">{travelers.map(traveler => <article key={traveler.id}><div><strong>{traveler.surname} / {traveler.givenName}</strong><span>{traveler.type === "adult" ? tr("成人", "Adult", "成人") : traveler.type === "child" ? tr("儿童", "Child", "兒童") : tr("婴儿", "Infant", "嬰兒")} · {traveler.gender === "1" ? tr("男", "Male", "男") : tr("女", "Female", "女")} · {tr("国籍", "Nationality", "國籍")} {traveler.nationality} · {tr("出生", "Born", "出生")} {traveler.birthday}</span><span>{tr("护照", "Passport", "護照")} {traveler.documentNo} · {tr(`${traveler.issuingCountry} 签发`, `Issued by ${traveler.issuingCountry}`, `${traveler.issuingCountry} 簽發`)} · {tr("有效期", "Expires", "有效期")} {traveler.expiration}</span></div><div className="security-actions"><button className="secondary" onClick={() => openEditTraveler(traveler)}>{tr("编辑", "Edit", "編輯")}</button><button className="secondary" onClick={() => void removeTraveler(traveler)}>{tr("移除", "Remove", "移除")}</button></div></article>)}</div></section>}

        {section === "favorites" && <section className="form-section glass glass-light"><div className="account-section-head"><div className="section-title"><span><Heart size={17} /></span><div><h2>{tr("收藏酒店", "Favorite hotels", "收藏飯店")}</h2><p>{tr("仅保存 G-Link 真实接口返回的酒店偏好；房态和价格需重新查询", "Only G-Link hotels are saved. Availability and prices must be searched again.", "僅儲存 G-Link 真實介面回傳的飯店偏好；房況和價格需重新查詢")}</p></div></div><button className="primary" onClick={() => navigate("hotels")}><Search size={16} />{tr("继续找酒店", "Find more hotels", "繼續找飯店")}</button></div>{favoritesLoading ? <div className="favorite-preference-list"><div className="favorite-preference-row skeleton-card" /></div> : favoriteHotels.length ? <div className="favorite-preference-list">{favoriteHotels.map(hotel => <article className="favorite-preference-row" key={hotel.id}>{hotel.image ? <img src={hotel.image} alt="" /> : <div className="favorite-image-placeholder"><Building2 size={22} /></div>}<div><strong>{hotel.name}</strong><span>{[hotel.city, hotel.district].filter(Boolean).join(" · ") || tr("上游未提供位置", "Location not supplied", "上游未提供位置")}</span><small>{tr("收藏于", "Saved", "收藏於")} {new Date(hotel.favoritedAt).toLocaleString(locale)} · {tr("实时价格未缓存", "Live price not cached", "即時價格未快取")}</small></div><div className="security-actions"><button className="secondary" onClick={() => { rememberFavoriteHotelSearch(hotel.name); navigate("hotels"); }}>{tr("重新查询", "Search again", "重新查詢")}</button><button className="danger-action" onClick={() => void removeFavoriteHotel(hotel)} disabled={removingFavoriteId === hotel.id}>{removingFavoriteId === hotel.id ? tr("处理中…", "Removing…", "處理中…") : tr("取消收藏", "Remove favorite", "取消收藏")}</button></div></article>)}</div> : <div className="favorite-empty account"><Heart size={22} /><div><strong>{tr("还没有收藏酒店", "No favorite hotels yet", "還沒有收藏飯店")}</strong><span>{tr("在酒店搜索结果或酒店详情页点击心形按钮后，会显示在这里。", "Use the heart button in hotel results or details to save a favorite.", "在飯店搜尋結果或飯店詳情頁點選愛心按鈕後，會顯示在這裡。")}</span></div><button className="secondary" onClick={() => navigate("hotels")}>{tr("去找酒店", "Find hotels", "去找飯店")}</button></div>}</section>}

        {section === "notifications" && <section className="form-section glass glass-light"><div className="section-title"><span><Bell size={17} /></span><div><h2>{tr("通知偏好", "Notification preferences", "通知偏好")}</h2><p>{tr("控制订单、出票与营销信息的接收方式", "Choose how you receive booking, ticketing, and marketing updates.", "控制訂單、出票與行銷資訊的接收方式")}</p></div></div><div className="settings-list"><label><span><strong>{tr("订单状态通知", "Booking status", "訂單狀態通知")}</strong><small>{tr("确认、取消、退款等关键状态", "Confirmation, cancellation, refund, and other key updates", "確認、取消、退款等重要狀態")}</small></span><input aria-label={tr("订单状态通知", "Booking status notifications", "訂單狀態通知")} type="checkbox" checked={notifications.order} onChange={event => setNotifications(current => ({ ...current, order: event.target.checked }))} /></label><label><span><strong>{tr("出票与航变通知", "Ticketing and flight changes", "出票與航變通知")}</strong><small>{tr("出票成功、航班时间和航线变化", "Ticket issuance, schedule changes, and route changes", "出票成功、航班時間和航線變化")}</small></span><input aria-label={tr("出票与航变通知", "Ticketing and flight change notifications", "出票與航變通知")} type="checkbox" checked={notifications.flight} onChange={event => setNotifications(current => ({ ...current, flight: event.target.checked }))} /></label><label><span><strong>{tr("优惠与产品更新", "Offers and product updates", "優惠與產品更新")}</strong><small>{tr("新产品、价格活动与运营信息", "New products, promotions, and service updates", "新產品、價格活動與營運資訊")}</small></span><input aria-label={tr("优惠与产品更新", "Offers and product updates", "優惠與產品更新")} type="checkbox" checked={notifications.marketing} onChange={event => setNotifications(current => ({ ...current, marketing: event.target.checked }))} /></label></div><div className="form-actions"><button className="primary" onClick={() => void saveNotifications()} disabled={savingNotifications} aria-busy={savingNotifications}>{savingNotifications ? <><LoaderCircle className="spinner" size={16} />{tr("Saving…", "Saving…", "Saving…")}</> : tr("保存通知偏好", "Save notification preferences", "儲存通知偏好")}</button></div></section>}

        {section === "billing" && <section className="form-section glass glass-light"><div className="section-title"><span><CreditCard size={17} /></span><div><h2>{tr("支付与授信", "Payment & credit", "付款與授信")}</h2><p>{tr("当前仅开放企业授信；银行卡需接入正式收单机构后启用", "Enterprise credit is currently available. Card payments require a production payment provider.", "目前僅開放企業授信；銀行卡需接入正式收單機構後啟用")}</p></div></div><div className="account-credit-grid"><article><span>{tr("授信总额", "Total credit", "授信總額")}</span><strong>{creditSummary ? money(creditSummary.totalCredit) : "—"}</strong><small>{tr("业务数据库 · CNY", "Business database · CNY", "業務資料庫 · CNY")}</small></article><article><span>{tr("当前可用", "Available credit", "目前可用")}</span><strong>{creditSummary ? money(creditSummary.availableCredit) : "—"}</strong><small>{tr("与财务结算实时一致", "Live value from Finance", "與財務結算即時一致")}</small></article></div><div className="account-action-row"><button className="secondary" onClick={() => navigate("finance")}>{tr("查看财务结算", "Open finance", "查看財務結算")}</button><button className="primary" onClick={() => setDialog("credit")} disabled={!creditSummary}>{tr("申请调整授信", "Request credit adjustment", "申請調整授信")}</button></div></section>}
      </div>
    </div>

    {dialog && <div className="modal-layer" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setDialog(""); }}>
      {dialog === "password" && <form className="booking-modal glass glass-light" role="dialog" aria-modal="true" aria-labelledby="password-title" onSubmit={updatePassword}><button type="button" className="modal-close" onClick={() => setDialog("")} aria-label={tr("关闭修改密码", "Close password dialog", "關閉修改密碼")}><X size={18} /></button><h2 id="password-title">{tr("Change password", "Change password", "Change password")}</h2><p className="modal-subtitle">{tr("沙箱环境只验证交互与密码规则，不会修改真实企业登录凭证。", "The sandbox validates interactions and password rules only; it does not change corporate credentials.", "沙箱環境只驗證互動與密碼規則，不會修改真實企業登入憑證。")}</p><div className="form-grid"><label className="wide"><span>{tr("当前密码", "Current password", "目前密碼")}</span><input aria-label={tr("当前密码", "Current password", "目前密碼")} type="password" required value={passwordForm.current} onChange={event => setPasswordForm(current => ({ ...current, current: event.target.value }))} /></label><label><span>{tr("新密码", "New password", "新密碼")}</span><input aria-label={tr("新密码", "New password", "新密碼")} type="password" required minLength={8} value={passwordForm.next} onChange={event => setPasswordForm(current => ({ ...current, next: event.target.value }))} /></label><label><span>{tr("确认新密码", "Confirm new password", "確認新密碼")}</span><input aria-label={tr("确认新密码", "Confirm new password", "確認新密碼")} type="password" required minLength={8} value={passwordForm.confirm} onChange={event => setPasswordForm(current => ({ ...current, confirm: event.target.value }))} /></label></div><div className="modal-actions"><button type="button" className="secondary" onClick={() => setDialog("")}>{tr("Cancel", "Cancel", "Cancel")}</button><button className="primary">{tr("验证并提交", "Validate and submit", "驗證並提交")}</button></div></form>}
      {dialog === "traveler" && <form className="booking-modal traveler-modal glass glass-light" role="dialog" aria-modal="true" aria-labelledby="traveler-title" onSubmit={saveTraveler}><button type="button" className="modal-close" onClick={() => setDialog("")} aria-label={tr("关闭常用旅客表单", "Close traveler form", "關閉常用旅客表單")}><X size={18} /></button><h2 id="traveler-title">{editingTravelerId ? tr("编辑常用旅客", "Edit saved traveler", "編輯常用旅客") : tr("新增常用旅客", "Add saved traveler", "新增常用旅客")}</h2><p className="modal-subtitle">{tr("姓与名请按护照机读信息分开填写，保存后证件号码仅脱敏展示。", "Enter surname and given name separately as shown in the passport machine-readable zone. Document numbers remain masked after saving.", "姓與名請依護照機讀資訊分開填寫，儲存後證件號碼僅遮罩顯示。")}</p><div className="form-grid">
        <label><span>{tr("英文姓 / Surname", "Surname", "英文姓 / Surname")}</span><input aria-label={tr("英文姓", "Surname", "英文姓")} autoComplete="family-name" required value={travelerDraft.surname} onChange={event => setTravelerDraft(current => ({ ...current, surname: event.target.value.toUpperCase() }))} placeholder={tr("例如 LIN", "e.g. LIN", "例如 LIN")} /></label>
        <label><span>{tr("英文名 / Given name", "Given name", "英文名 / Given name")}</span><input aria-label={tr("英文名", "Given name", "英文名")} autoComplete="given-name" required value={travelerDraft.givenName} onChange={event => setTravelerDraft(current => ({ ...current, givenName: event.target.value.toUpperCase() }))} placeholder={tr("例如 JIACHENG", "e.g. JIACHENG", "例如 JIACHENG")} /></label>
        <label><span>{tr("旅客类型", "Traveler type", "旅客類型")}</span><select aria-label={tr("旅客类型", "Traveler type", "旅客類型")} value={travelerDraft.type} onChange={event => setTravelerDraft(current => ({ ...current, type: event.target.value as typeof current.type }))}><option value="adult">{tr("成人", "Adult", "成人")}</option><option value="child">{tr("儿童", "Child", "兒童")}</option><option value="infant">{tr("婴儿", "Infant", "嬰兒")}</option></select></label>
        <label><span>{tr("性别", "Gender", "性別")}</span><select aria-label={tr("性别", "Gender", "性別")} value={travelerDraft.gender} onChange={event => setTravelerDraft(current => ({ ...current, gender: event.target.value as typeof current.gender }))}><option value="1">{tr("男", "Male", "男")}</option><option value="2">{tr("女", "Female", "女")}</option></select></label>
        <label><span>{tr("出生日期", "Date of birth", "出生日期")}</span><input aria-label={tr("出生日期", "Date of birth", "出生日期")} type="date" required max={new Date().toISOString().slice(0, 10)} value={travelerDraft.birthday} onChange={event => setTravelerDraft(current => ({ ...current, birthday: event.target.value }))} /></label>
        <label><span>{tr("国籍", "Nationality", "國籍")}</span><NationalitySelect ariaLabel={tr("国籍", "Nationality", "國籍")} value={travelerDraft.nationality} onChange={value => setTravelerDraft(current => ({ ...current, nationality: value }))} locale={locale} catalog={nationalityCatalog} error={nationalityError} /></label>
        <label><span>{tr("护照号码", "Passport number", "護照號碼")}</span><input aria-label={tr("护照号码", "Passport number", "護照號碼")} autoComplete="off" required={!editingTravelerId} value={travelerDraft.documentNo} onChange={event => setTravelerDraft(current => ({ ...current, documentNo: event.target.value.toUpperCase() }))} placeholder={editingTravelerId ? tr("留空保留原护照号码", "Leave blank to keep the saved number", "留空保留原護照號碼") : tr("5–20 位字母或数字", "5–20 letters or digits", "5–20 位字母或數字")} /></label>
        <label><span>{tr("护照签发国家/地区", "Passport issuing country/region", "護照簽發國家/地區")}</span><NationalitySelect ariaLabel={tr("护照签发国家或地区", "Passport issuing country or region", "護照簽發國家或地區")} value={travelerDraft.issuingCountry} onChange={value => setTravelerDraft(current => ({ ...current, issuingCountry: value }))} locale={locale} catalog={nationalityCatalog} error={nationalityError} /></label>
        <label><span>{tr("护照有效期", "Passport expiry date", "護照有效期")}</span><input aria-label={tr("护照有效期", "Passport expiry date", "護照有效期")} type="date" required min={new Date().toISOString().slice(0, 10)} value={travelerDraft.expiration} onChange={event => setTravelerDraft(current => ({ ...current, expiration: event.target.value }))} /></label>
      </div><p className="passport-privacy-note"><ShieldCheck size={15} />{tr("护照信息属于敏感个人信息；本地数据库使用 AES-256-GCM 加密存储，页面与接口仅返回脱敏号码。", "Passport data is sensitive personal information. The local database uses AES-256-GCM encryption, and pages and APIs return masked numbers only.", "護照資訊屬於敏感個人資訊；本機資料庫使用 AES-256-GCM 加密儲存，頁面與介面僅回傳遮罩號碼。")}</p><div className="modal-actions"><button type="button" className="secondary" onClick={() => setDialog("")} disabled={savingTraveler}>{tr("Cancel", "Cancel", "Cancel")}</button><button className="primary" disabled={savingTraveler} aria-busy={savingTraveler}>{savingTraveler ? <><LoaderCircle className="spinner" size={16} />{tr("Saving…", "Saving…", "Saving…")}</> : editingTravelerId ? tr("Save changes", "Save changes", "Save changes") : tr("保存旅客", "Save traveler", "儲存旅客")}</button></div></form>}
      {dialog === "credit" && <form className="booking-modal glass glass-light" role="dialog" aria-modal="true" aria-labelledby="credit-title" onSubmit={submitCreditRequest}><button type="button" className="modal-close" onClick={() => setDialog("")} aria-label={tr("关闭授信申请", "Close credit request", "關閉授信申請")}><X size={18} /></button><h2 id="credit-title">{tr("申请调整授信", "Request credit adjustment", "申請調整授信")}</h2><p className="modal-subtitle">{tr("申请将进入企业审核流程；当前沙箱仅记录交互结果。", "The request will enter corporate approval. The sandbox records the interaction only.", "申請將進入企業審核流程；目前沙箱僅記錄互動結果。")}</p><div className="form-grid"><label><span>{tr("申请额度（CNY）", "Requested credit (CNY)", "申請額度（CNY）")}</span><input aria-label={tr("申请额度", "Requested credit", "申請額度")} type="number" min={(creditSummary?.totalCredit ?? 0) + 1} required value={creditDraft.amount} onChange={event => setCreditDraft(current => ({ ...current, amount: Number(event.target.value) }))} /></label><label className="wide"><span>{tr("调整原因", "Reason for adjustment", "調整原因")}</span><input aria-label={tr("调整原因", "Reason for adjustment", "調整原因")} required value={creditDraft.reason} onChange={event => setCreditDraft(current => ({ ...current, reason: event.target.value }))} /></label></div><div className="modal-actions"><button type="button" className="secondary" onClick={() => setDialog("")}>{tr("Cancel", "Cancel", "Cancel")}</button><button className="primary">{tr("提交申请", "Submit request", "提交申請")}</button></div></form>}
      {dialog === "mfa" && <section className="booking-modal glass glass-light" role="dialog" aria-modal="true" aria-labelledby="mfa-title"><button type="button" className="modal-close" onClick={() => setDialog("")} aria-label={tr("关闭双重验证", "Close two-factor authentication", "關閉雙重驗證")}><X size={18} /></button><h2 id="mfa-title">{tr("Two-factor authentication", "Two-factor authentication", "Two-factor authentication")}</h2><p className="modal-subtitle">{tr("当前已绑定手机号 138****8866。生产环境的重新绑定与关闭操作需通过企业身份服务和短信校验。", "Mobile number 138****8866 is linked. Rebinding or disabling it in production requires the corporate identity service and SMS verification.", "目前已綁定手機號碼 138****8866。正式環境的重新綁定與關閉操作需透過企業身分服務和簡訊驗證。")}</p><div className="modal-actions"><button className="primary" onClick={() => setDialog("")}>{tr("我知道了", "Got it", "我知道了")}</button></div></section>}
    </div>}
  </section>;
}

function CustomersPage({ locale }: { locale: LocaleCode }) {
  const english = locale === "en";
  const [items, setItems] = useState<Customer[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    contactSurname: "",
    contactGivenName: "",
    phone: "",
    email: "",
    creditLimit: 100000,
  });
  const load = useCallback(() => {
    api.listCustomers().then(setItems).catch(error => setError(error.message));
  }, []);
  useEffect(load, [load]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.createCustomer({
        name: form.name,
        contactName: joinPersonName({ surname: form.contactSurname, givenName: form.contactGivenName }),
        contactSurname: form.contactSurname.trim(),
        contactGivenName: form.contactGivenName.trim(),
        phone: form.phone,
        email: form.email,
        creditLimit: form.creditLimit,
      });
      setOpen(false);
      setForm({ name: "", contactSurname: "", contactGivenName: "", phone: "", email: "", creditLimit: 100000 });
      load();
    } catch (error) {
      setError(error instanceof Error ? error.message : english ? "Could not create the customer." : "Customer creation failed");
    } finally {
      setSaving(false);
    }
  };
  const toggle = async (customer: Customer) => {
    try {
      const updated = await api.updateCustomerStatus(
        customer.id,
        customer.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE",
      );
      setItems(current => current.map(item => item.id === updated.id ? updated : item));
    } catch (error) {
      setError(error instanceof Error ? error.message : english ? "Could not update customer status." : "Customer status update failed");
    }
  };
  return <section className="operations-page">
    <section className="page-heading compact"><div><p className="eyebrow">CUSTOMERS</p><h1>{english ? "Customers" : "Customers"}</h1><p>{english ? "Manage corporate customers, contacts, account status, and credit limits." : "Manage enterprise customers, contacts, account status, and credit limits"}</p></div><button className="primary" onClick={() => setOpen(true)}><Plus size={16} />{english ? "New customer" : "New Customer"}</button></section>
    {error && <div className="error-banner" role="alert">{error}<button onClick={() => setError("")}>{english ? "Dismiss" : "Close"}</button></div>}
    <section className="operations-summary">
      <article><span>{english ? "Corporate customers" : "Enterprise Customers"}</span><strong>{items.length}</strong><small>{english ? "Persisted in the business database" : "Persisted to business database"}</small></article>
      <article><span>{english ? "Active customers" : "Active Customers"}</span><strong>{items.filter(item => item.status === "ACTIVE").length}</strong><small>{english ? "Can book and use credit" : "Can book and charge normally"}</small></article>
      <article><span>{english ? "Total credit limit" : "Total Credit"}</span><strong>{money(items.reduce((sum, item) => sum + item.creditLimit, 0))}</strong><small>{english ? "Controlled per customer" : "Controlled per customer"}</small></article>
    </section>
    <section className="panel operations-panel glass glass-light"><div className="panel-title"><div><h2>{english ? "Customer list" : "Customer List"}</h2><p>{english ? "Suspended customers retain history but cannot create new transactions." : "Deactivated customers retain order history but cannot create new transactions"}</p></div></div>
      <div className="table-wrap"><table><thead><tr><th>{english ? "Customer" : "Customer"}</th><th>{english ? "Contact" : "Contact"}</th><th>{english ? "Contact details" : "Contact Info"}</th><th>{english ? "Credit used" : "Credit Used"}</th><th>{english ? "Status" : "Status"}</th><th>{english ? "Action" : "Actions"}</th></tr></thead><tbody>{items.length ? items.map(customer => <tr key={customer.id}><td><strong>{customer.name}</strong><small className="table-subline">{customer.id}</small></td><td>{customer.contactName}</td><td>{customer.phone}<small className="table-subline">{customer.email}</small></td><td>{money(customer.creditUsed)} / {money(customer.creditLimit)}</td><td><span className={`business-status ${customer.status.toLowerCase()}`}>{customer.status === "ACTIVE" ? english ? "Active" : "Activate" : english ? "Suspended" : "Deactivate"}</span></td><td><button className="table-action" onClick={() => toggle(customer)}>{customer.status === "ACTIVE" ? english ? "Suspend" : "Deactivate" : english ? "Activate" : "Activate"}</button></td></tr>) : <tr><td colSpan={6} className="empty-table-cell">{english ? "No customers yet." : "No customers yet."}</td></tr>}</tbody></table></div>
    </section>
    {open && <div className="modal-layer" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setOpen(false); }}><form className="booking-modal glass glass-light" role="dialog" aria-modal="true" aria-labelledby="new-customer-title" onSubmit={submit}><button type="button" className="modal-close" onClick={() => setOpen(false)} aria-label={english ? "Close" : "Close"}><X size={18} /></button><h2 id="new-customer-title">{english ? "New corporate customer" : "New Enterprise Customer"}</h2><p className="modal-subtitle">{english ? "Configure independent credit and pricing after creating the customer." : "After creation, customers can be configured with independent credit and pricing rules."}</p><div className="form-grid"><label><span>{english ? "Company name" : "Company Name"}</span><input required value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} /></label><label><span>{english ? "Contact surname" : "Contact Surname"}</span><input required value={form.contactSurname} onChange={event => setForm(current => ({ ...current, contactSurname: event.target.value }))} /></label><label><span>{english ? "Contact given name" : "Contact Given Name"}</span><input required value={form.contactGivenName} onChange={event => setForm(current => ({ ...current, contactGivenName: event.target.value }))} /></label><label><span>{english ? "Phone" : "Phone Number"}</span><input required value={form.phone} onChange={event => setForm(current => ({ ...current, phone: event.target.value }))} /></label><label><span>{english ? "Email" : "Email"}</span><input type="email" required value={form.email} onChange={event => setForm(current => ({ ...current, email: event.target.value }))} /></label><label className="wide"><span>{english ? "Credit limit" : "Credit Limit"}</span><input type="number" min="0" required value={form.creditLimit} onChange={event => setForm(current => ({ ...current, creditLimit: Number(event.target.value) }))} /></label></div><div className="modal-actions"><button type="button" className="secondary" onClick={() => setOpen(false)}>{english ? "Cancel" : "Cancel"}</button><button className="primary" disabled={saving}>{saving ? <><LoaderCircle className="spinner" size={16} />{english ? "Saving…" : "Saving"}</> : english ? "Create customer" : "Create Customer"}</button></div></form></div>}
  </section>;
}

function PricingPage({ locale }: { locale: LocaleCode }) {
  const english = locale === "en";
  const [rules, setRules] = useState<PricingRule[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    productType: "hotel" as PricingRule["productType"],
    calculationType: "percentage" as PricingRule["calculationType"],
    value: 8,
    priority: 100,
  });
  const load = useCallback(() => {
    api.listPricingRules().then(setRules).catch(error => setError(error.message));
  }, []);
  useEffect(load, [load]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.createPricingRule({ ...form, status: "INACTIVE" });
      setOpen(false);
      setForm({ name: "", productType: "hotel", calculationType: "percentage", value: 8, priority: 100 });
      load();
    } catch (error) {
      setError(error instanceof Error ? error.message : english ? "Could not create the pricing rule." : "Rule creation failed");
    } finally {
      setSaving(false);
    }
  };
  const toggle = async (rule: PricingRule) => {
    try {
      const updated = await api.updatePricingRuleStatus(
        rule.id,
        rule.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
      );
      setRules(current => current.map(item => item.id === updated.id ? updated : item));
    } catch (error) {
      setError(error instanceof Error ? error.message : english ? "Could not update the pricing rule." : "Rule status update failed");
    }
  };
  const productLabel = (value: PricingRule["productType"]) =>
    value === "hotel" ? english ? "Hotels" : "Hotels" : value === "flight" ? english ? "Flights" : "Flights" : english ? "All products" : "All Products";
  return <section className="operations-page">
    <section className="page-heading compact"><div><p className="eyebrow">PRICING</p><h1>{english ? "Pricing" : "Pricing Strategy"}</h1><p>{english ? "Configure percentage markups or fixed service fees. Active rules affect live search and verified prices." : "Configure percentage markup or fixed service fee by product..."}</p></div><button className="primary" onClick={() => setOpen(true)}><Plus size={16} />{english ? "New rule" : "New Rule"}</button></section>
    {error && <div className="error-banner" role="alert">{error}<button onClick={() => setError("")}>{english ? "Dismiss" : "Close"}</button></div>}
    <section className="panel operations-panel glass glass-light"><div className="panel-title"><div><h2>{english ? "Pricing rules" : "Pricing Rules"}</h2><p>{english ? "The active rule with the lowest priority number is applied first." : "For each product, the first enabled rule with the smallest priority number is matched"}</p></div></div>
      <div className="table-wrap"><table><thead><tr><th>{english ? "Rule" : "Rule Name"}</th><th>{english ? "Products" : "Product"}</th><th>{english ? "Calculation" : "Calculation"}</th><th>{english ? "Priority" : "Priority"}</th><th>{english ? "Status" : "Status"}</th><th>{english ? "Action" : "Actions"}</th></tr></thead><tbody>{rules.length ? rules.map(rule => <tr key={rule.id}><td><strong>{rule.name}</strong><small className="table-subline">{rule.id}</small></td><td>{productLabel(rule.productType)}</td><td>{rule.calculationType === "percentage" ? `${english ? "Cost" : "Cost Price"} + ${rule.value}%` : `${english ? "Cost" : "Cost Price"} + ${money(rule.value)}`}</td><td>{rule.priority}</td><td><span className={`business-status ${rule.status.toLowerCase()}`}>{rule.status === "ACTIVE" ? english ? "Active" : "Enabled" : english ? "Inactive" : "Disabled"}</span></td><td><button className="table-action" onClick={() => toggle(rule)}>{rule.status === "ACTIVE" ? english ? "Disable" : "Deactivate" : english ? "Enable" : "Activate"}</button></td></tr>) : <tr><td colSpan={6} className="empty-table-cell">{english ? "No pricing rules yet." : "No pricing rules yet."}</td></tr>}</tbody></table></div>
    </section>
    {open && <div className="modal-layer" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setOpen(false); }}><form className="booking-modal glass glass-light" role="dialog" aria-modal="true" aria-labelledby="new-rule-title" onSubmit={submit}><button type="button" className="modal-close" onClick={() => setOpen(false)} aria-label={english ? "Close" : "Close"}><X size={18} /></button><h2 id="new-rule-title">{english ? "New pricing rule" : "New Pricing Rule"}</h2><p className="modal-subtitle">{english ? "New rules are inactive until you review and enable them." : "New rules are disabled by default. Verify impact scope before manually enabling."}</p><div className="form-grid"><label className="wide"><span>{english ? "Rule name" : "Rule Name"}</span><input required value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} /></label><label><span>{english ? "Products" : "Product"}</span><select value={form.productType} onChange={event => setForm(current => ({ ...current, productType: event.target.value as PricingRule["productType"] }))}><option value="hotel">{english ? "Hotels" : "Hotels"}</option><option value="flight">{english ? "Flights" : "Flights"}</option><option value="all">{english ? "All products" : "All Products"}</option></select></label><label><span>{english ? "Calculation" : "Calculation"}</span><select value={form.calculationType} onChange={event => setForm(current => ({ ...current, calculationType: event.target.value as PricingRule["calculationType"] }))}><option value="percentage">{english ? "Percentage markup" : "Percentage Markup"}</option><option value="fixed">{english ? "Fixed service fee" : "Fixed Service Fee"}</option></select></label><label><span>{form.calculationType === "percentage" ? english ? "Markup (%)" : "Markup (%)" : english ? "Fixed amount (CNY)" : "Fixed Amount (CNY)"}</span><input type="number" min="0" step={form.calculationType === "percentage" ? "0.1" : "1"} required value={form.value} onChange={event => setForm(current => ({ ...current, value: Number(event.target.value) }))} /></label><label><span>{english ? "Priority" : "Priority"}</span><input type="number" min="1" required value={form.priority} onChange={event => setForm(current => ({ ...current, priority: Number(event.target.value) }))} /></label></div><div className="modal-actions"><button type="button" className="secondary" onClick={() => setOpen(false)}>{english ? "Cancel" : "Cancel"}</button><button className="primary" disabled={saving}>{saving ? <><LoaderCircle className="spinner" size={16} />{english ? "Saving…" : "Saving"}</> : english ? "Save rule" : "Save Rule"}</button></div></form></div>}
  </section>;
}

function FinancePage({ locale }: { locale: LocaleCode }) {
  const english = locale === "en";
  const [summary, setSummary] = useState<FinanceSummary>();
  const [error, setError] = useState("");
  useEffect(() => {
    api.financeSummary().then(setSummary).catch(error => setError(error.message));
  }, []);
  const exportLedger = () => {
    if (!summary) return;
    const rows = [
      english ? ["Ledger ID", "Order ID", "Type", "Amount", "Currency", "Status", "Time"] : ["Transaction ID", "Order ID", "Type", "Amount", "Currency", "Status", "Time"],
      ...summary.entries.map(entry => [
        entry.id,
        entry.orderId || "",
        entry.entryType,
        String(entry.amount),
        entry.currency,
        entry.status,
        entry.createdAt,
      ]),
    ];
    const blob = new Blob([`\uFEFF${rows.map(row => row.map(cell => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n")}`], { type: "text/csv;charset=utf-8" });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `fusiongo-ledger-${localDateValue(new Date())}.csv`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  };
  return <section className="operations-page">
    <section className="page-heading compact"><div><p className="eyebrow">FINANCE</p><h1>{english ? "Finance" : "Finance"}</h1><p>{english ? "Review corporate credit, payments, pending refunds, and reconciliation data." : "View enterprise credit, payment transactions, pending refunds, and reconciliation data"}</p></div><button className="secondary" onClick={exportLedger} disabled={!summary}><FileText size={16} />{english ? "Export ledger" : "Export Transactions"}</button></section>
    {error && <div className="error-banner" role="alert">{error}<button onClick={() => setError("")}>{english ? "Dismiss" : "Close"}</button></div>}
    <div className="wallet-overview"><article><span>{english ? "Available credit" : "Available Credit"}</span><strong>{money(summary?.availableCredit || 0)}</strong><small>{english ? `Total credit ${money(summary?.totalCredit || 0)} · foreign currencies are separate` : `Total credit ${money(summary?.totalCredit || 0)} · Foreign currencies not combined`}</small></article><article><span>{english ? "Paid to date (CNY)" : "Total Paid (CNY)"}</span><strong>{money(summary?.paid || 0)}</strong><small>{summary ? Object.entries(summary.paidByCurrency).filter(([currency]) => currency !== "CNY").map(([currency, amount]) => money(amount, currency)).join(" · ") || (english ? "No foreign-currency payments" : "No foreign currency payments") : english ? "Loading…" : "Loading"}</small></article><article><span>{english ? "Pending refunds (CNY)" : "Pending Refunds (CNY)"}</span><strong>{money(summary?.refundPending || 0)}</strong><small>{english ? "Foreign-currency refunds remain in their original currency" : "Foreign currency refunds shown separately by original currency"}</small></article></div>
    <section className="panel operations-panel glass glass-light"><div className="panel-title"><div><h2>{english ? "Ledger" : "Transactions"}</h2><p>{english ? "Payments and refunds use idempotent ledger entries; retries do not duplicate records." : "Payments and refunds are idempotent per order..."}</p></div></div><div className="table-wrap"><table><thead><tr><th>{english ? "Entry" : "Transaction"}</th><th>{english ? "Order" : "Order"}</th><th>{english ? "Type" : "Type"}</th><th>{english ? "Amount" : "Amount"}</th><th>{english ? "Status" : "Status"}</th><th>{english ? "Time" : "Time"}</th></tr></thead><tbody>{summary?.entries.length ? summary.entries.map(entry => <tr key={entry.id}><td>{entry.reference}<small className="table-subline">{entry.id.slice(0, 8)}</small></td><td>{entry.orderId || "—"}</td><td>{entry.entryType === "PAYMENT" ? english ? "Order payment" : "Order Payment" : entry.entryType === "REFUND_PENDING" ? english ? "Refund pending" : "Pending Refund" : entry.entryType}</td><td className="transaction-amount">{money(entry.amount, entry.currency)}</td><td><span className={`business-status ${entry.status.toLowerCase()}`}>{entry.status}</span></td><td>{new Date(entry.createdAt).toLocaleString(locale)}</td></tr>) : <tr><td colSpan={6} className="empty-table-cell">{english ? "No ledger entries yet. A payment will create one automatically." : "No transactions yet. They will be generated after the first payment."}</td></tr>}</tbody></table></div></section>
  </section>;
}

export function App() {
  const [page, setPage] = useState<Page>("hotels");
  const [pageInstance, setPageInstance] = useState(0);
  const [authSession, setAuthSession] = useState<AuthSession>();
  const [authPromptOpen, setAuthPromptOpen] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [locale, setLocale] = useState<LocaleCode>(() => {
    const stored = window.localStorage.getItem("fusiongo.locale");
    return stored === "zh-CN" || stored === "zh-TW" || stored === "en" ? stored : "en";
  });
  const [displayCurrency, setDisplayCurrency] = useState<DisplayCurrency>(() => {
    const stored = window.localStorage.getItem("fusiongo.displayCurrency");
    return stored === "USD" || stored === "HKD" || stored === "SGD" ? stored : "CNY";
  });
  const [fxRates, setFxRates] = useState<DisplayFxRates>();
  const [fxLoading, setFxLoading] = useState(true);
  const [fxError, setFxError] = useState("");
  const [accountIdentity, setAccountIdentity] = useState<Pick<AccountProfile, "name" | "email" | "avatarUrl">>({ name: "", email: "" });
  const navigate = useCallback((nextPage: Page) => {
    const protectedPages: Page[] = ["dashboard", "orders", "account", "customers", "pricing", "finance"];
    const adminPages: Page[] = ["dashboard", "customers", "pricing", "finance"];
    if (protectedPages.includes(nextPage) && !authSession?.authenticated) {
      setAuthError("");
      setAuthPromptOpen(true);
      return;
    }
    if (adminPages.includes(nextPage) && authSession?.user?.role !== "admin") {
      setPage("hotels");
      return;
    }
    if (page === nextPage) setPageInstance(value => value + 1);
    setPage(nextPage);
  }, [authSession?.authenticated, authSession?.user?.role, page]);
  useEffect(() => { window.scrollTo({ top: 0, behavior: "auto" }); }, [page]);
  useEffect(() => {
    document.documentElement.lang = locale;
    window.localStorage.setItem("fusiongo.locale", locale);
  }, [locale]);
  useEffect(() => {
    window.localStorage.setItem("fusiongo.displayCurrency", displayCurrency);
  }, [displayCurrency]);
  useEffect(() => {
    let active = true;
    api.getDisplayFxRates().then(rates => {
      if (!active) return;
      setFxRates(rates);
      setFxError("");
    }).catch(error => {
      if (!active) return;
      setFxError(error instanceof Error ? error.message : "Exchange rate service temporarily unavailable");
    }).finally(() => { if (active) setFxLoading(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    api.getAuthSession().then(session => {
      if (!active) return;
      setAuthSession(session);
      if (session.user) setAccountIdentity({ name: session.user.name, email: session.user.email });
    }).catch(error => {
      if (!active) return;
      setAuthSession({ authenticated: false, mode: "local" });
      setAuthError(error instanceof Error ? error.message : "无法确认登录状态");
    });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!authSession?.authenticated) return;
    api.getAccountProfile().then(profile => {
      setAccountIdentity({ name: profile.name, email: profile.email, avatarUrl: profile.avatarUrl });
    }).catch(() => undefined);
  }, [authSession?.authenticated]);
  const handleLogin = useCallback(async (credentials?: { email: string; password: string }) => {
    setAuthBusy(true);
    setAuthError("");
    try {
      const session = await api.login(credentials);
      setAuthSession(session);
      if (session.user) setAccountIdentity({ name: session.user.name, email: session.user.email });
      setAuthPromptOpen(false);
    } catch (caught) {
      setAuthError(caught instanceof Error ? caught.message : "登录失败，请稍后重试");
    } finally {
      setAuthBusy(false);
    }
  }, []);
  const handleRegister = useCallback(async (input: RegistrationInput) => {
    setAuthBusy(true);
    setAuthError("");
    try {
      const session = await api.register(input);
      setAuthSession(session);
      if (session.user) setAccountIdentity({ name: session.user.name, email: session.user.email });
      setLocale(input.language);
      setAuthPromptOpen(false);
    } catch (caught) {
      setAuthError(caught instanceof Error ? caught.message : "注册失败，请稍后重试");
    } finally {
      setAuthBusy(false);
    }
  }, []);
  const handleLogout = useCallback(async () => {
    setAuthBusy(true);
    setAuthError("");
    try {
      const session = await api.logout();
      setAuthSession(session);
      setAccountIdentity({ name: "", email: "" });
      setPage("hotels");
      setPageInstance(value => value + 1);
    } catch (caught) {
      setAuthError(caught instanceof Error ? caught.message : "退出登录失败，请稍后重试");
    } finally {
      setAuthBusy(false);
    }
  }, []);
  const handleProfileSaved = useCallback((profile: AccountProfile) => {
    setAccountIdentity({ name: profile.name, email: profile.email, avatarUrl: profile.avatarUrl });
  }, []);
  const content = useMemo(() => {
    if (page === "dashboard") return <Dashboard key={`dashboard-${pageInstance}`} navigate={navigate} locale={locale} identityName={accountIdentity.name} />;
    if (page === "hotels") return <HotelSearch key={`hotels-${pageInstance}`} locale={locale} authenticated={Boolean(authSession?.authenticated)} onLoginRequired={() => { setAuthError(""); setAuthPromptOpen(true); }} />;
    if (page === "flights") return <FlightSearch key={`flights-${pageInstance}`} locale={locale} authenticated={Boolean(authSession?.authenticated)} onLoginRequired={() => { setAuthError(""); setAuthPromptOpen(true); }} />;
    if (page === "orders") return <OrdersPage key={`orders-${pageInstance}`} locale={locale} />;
    if (page === "account") return <AccountPage navigate={navigate} locale={locale} setLocale={setLocale} onProfileSaved={handleProfileSaved} role={authSession?.user?.role || "member"} />;
    if (page === "customers") return <CustomersPage locale={locale} />;
    if (page === "pricing") return <PricingPage locale={locale} />;
    return <FinancePage locale={locale} />;
  }, [authSession?.authenticated, authSession?.user?.role, handleProfileSaved, locale, navigate, page, pageInstance]);
  const currencyContext = useMemo<CurrencyContextValue>(() => ({
    displayCurrency,
    fxRates,
    fxLoading,
    fxError,
  }), [displayCurrency, fxError, fxLoading, fxRates]);
  return <CurrencyContext.Provider value={currencyContext}><Shell
    page={page}
    setPage={navigate}
    locale={locale}
    setLocale={setLocale}
    displayCurrency={displayCurrency}
    setDisplayCurrency={setDisplayCurrency}
    accountIdentity={accountIdentity}
    authSession={authSession}
    authPromptOpen={authPromptOpen}
    authBusy={authBusy}
    authError={authError}
    onAuthPromptChange={open => { setAuthPromptOpen(open); if (!open) setAuthError(""); }}
    onClearAuthError={() => setAuthError("")}
    onLogin={credentials => void handleLogin(credentials)}
    onRegister={input => void handleRegister(input)}
    onLogout={() => void handleLogout()}
  >{content}</Shell></CurrencyContext.Provider>;
}

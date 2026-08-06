import {
  ArrowLeft,
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
    <span><strong>沙箱模拟房态</strong><small>当前 G-Link 账号未配置可售测试库存，本房型仅用于验证下单、支付与订单状态流程，不代表真实可售库存。</small></span>
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
            <button className="top-brand" onClick={() => setPage("hotels")} aria-label={english ? "Open hotel search" : "打开酒店查询"}>
              <span className="brand-mark">F</span>
              <span><strong>FusionGo</strong><small>{english ? "Global travel distribution" : "全球商旅分销平台"}</small></span>
            </button>
            {authenticated && <button className="top-tenant" aria-label={english ? `Current company: ${copy.tenant}` : "当前企业：寰宇旅行"} aria-haspopup="menu" aria-expanded={tenantOpen} onClick={() => { setTenantOpen(value => !value); setHelpOpen(false); setNotificationsOpen(false); setAccountOpen(false); setPreferenceOpen(""); }}>
              <span className="tenant-logo"><Building2 size={17} /></span>
              <span><strong>{copy.tenant}</strong><small>{copy.plan}</small></span>
              <ChevronDown size={14} />
            </button>}
            <div className="top-actions">
              <span className="environment"><i /> {copy.environment}</span>
              <div className="utility-control" ref={currencyPreferenceRef}>
                <button className="header-utility" aria-label={`${copy.currency}：${displayCurrency}`} aria-haspopup="menu" aria-expanded={preferenceOpen === "currency"} onClick={() => { setTenantOpen(false); setHelpOpen(false); setNotificationsOpen(false); setPreferenceOpen(value => value === "currency" ? "" : "currency"); }}>{displayCurrency}<ChevronDown size={13} /></button>
                {preferenceOpen === "currency" && <div className="preference-popover glass glass-light" role="menu" aria-label={copy.currency}>
                  <header><strong>{copy.currency}</strong><button onClick={() => setPreferenceOpen("")} aria-label={english ? "Close" : "关闭"}><X size={16} /></button></header>
                  {(["CNY", "USD", "HKD", "SGD"] as DisplayCurrency[]).map(currency => <button key={currency} role="menuitemradio" aria-checked={displayCurrency === currency} onClick={() => { setDisplayCurrency(currency); setPreferenceOpen(""); }}><span><strong>{currency}</strong><small>{english ? { CNY: "Chinese Yuan", USD: "US Dollar", HKD: "Hong Kong Dollar", SGD: "Singapore Dollar" }[currency] : { CNY: "人民币", USD: "US Dollar", HKD: "港币", SGD: "Singapore Dollar" }[currency]}</small></span>{displayCurrency === currency && <Check size={16} />}</button>)}
                  <p aria-live="polite">{fxRates
                    ? english
                      ? `Reference rate: ${fxRates.source}, ${fxRates.date}. Amounts marked ≈ are display estimates; bookings and settlement remain in supplier currency.`
                      : `参考汇率：${fxRates.source}，${fxRates.date}。标记“≈”的金额仅供展示，订单与结算仍使用供应商原币种。`
                    : fxLoading
                      ? english ? "Loading reference rates…" : "正在获取参考汇率…"
                      : english ? `Rate unavailable: ${fxError}. Original supplier currencies are shown.` : `汇率不可用：${fxError}。当前显示供应商原币种。`}</p>
                </div>}
              </div>
              <div className="utility-control">
                <button className="header-utility" aria-label={`${copy.language}：${localeNames[locale]}`} aria-haspopup="menu" aria-expanded={preferenceOpen === "language"} onClick={() => { setTenantOpen(false); setHelpOpen(false); setNotificationsOpen(false); setPreferenceOpen(value => value === "language" ? "" : "language"); }}><Globe2 size={16} />{localeNames[locale]}<ChevronDown size={13} /></button>
                {preferenceOpen === "language" && <div className="preference-popover glass glass-light" role="menu" aria-label={copy.language}>
                  <header><strong>{copy.language}</strong><button onClick={() => setPreferenceOpen("")} aria-label={english ? "Close" : "关闭"}><X size={16} /></button></header>
                  {([
                    ["zh-CN", "简体中文"],
                    ["zh-TW", "繁體中文"],
                    ["en", "English"],
                  ] as Array<[LocaleCode, string]>).map(([code, label]) => <button key={code} role="menuitemradio" aria-checked={locale === code} onClick={() => { setLocale(code); setPreferenceOpen(""); }}><span><strong>{label}</strong><small>{code}</small></span>{locale === code && <Check size={16} />}</button>)}
                </div>}
              </div>
              <button className="icon-button" aria-label={english ? "Help and support" : "帮助与支持"} aria-expanded={helpOpen} onClick={() => { setTenantOpen(false); setPreferenceOpen(""); setNotificationsOpen(false); setHelpOpen(value => !value); }}><CircleHelp size={19} /></button>
              {authenticated && <button className="icon-button" aria-label={english ? "Notifications" : "通知"} aria-expanded={notificationsOpen} onClick={() => { setTenantOpen(false); setHelpOpen(false); setPreferenceOpen(""); setAccountOpen(false); setNotificationsOpen(value => !value); }}><Bell size={19} />{notificationOrders.length > 0 && <b>{notificationOrders.length}</b>}</button>}
              {authenticated ? <button className="header-profile" onClick={() => { setAccountOpen(value => !value); setTenantOpen(false); setHelpOpen(false); setNotificationsOpen(false); setPreferenceOpen(""); }} aria-haspopup="menu" aria-expanded={accountOpen} aria-label={english ? "Open account menu" : "打开账户菜单"}>
                <span>{accountIdentity.avatarUrl ? <img src={accountIdentity.avatarUrl} alt="" /> : accountIdentity.name.slice(0, 1)}</span><strong>{accountIdentity.name}</strong><ChevronDown size={14} />
              </button> : <button className="header-sign-in" onClick={() => onAuthPromptChange(true)}><LogIn size={16} />{english ? "Sign in" : "登录"}</button>}
            </div>
            {authenticated && accountOpen && <div className="notification-popover account-popover glass glass-light" role="menu" aria-label={english ? "Account menu" : "账户菜单"}>
              <div className="account-popover-identity"><span>{accountIdentity.avatarUrl ? <img src={accountIdentity.avatarUrl} alt="" /> : accountIdentity.name.slice(0, 1)}</span><div><strong>{accountIdentity.name}</strong><small>{accountIdentity.email}</small></div></div>
              <button role="menuitem" onClick={() => { setAccountOpen(false); setPage("account"); }}><UserRound size={17} /><span><strong>{english ? "Account settings" : "账户设置"}</strong><small>{english ? "Profile, travelers, and preferences" : "个人资料、常用旅客和偏好"}</small></span></button>
              <button className="logout-menu-item" role="menuitem" onClick={() => { setAccountOpen(false); onLogout(); }} disabled={authBusy}><LogOut size={17} /><span><strong>{english ? "Sign out" : "退出登录"}</strong><small>{english ? "End this session on this device" : "结束此设备上的当前会话"}</small></span></button>
            </div>}
            {authenticated && notificationsOpen && <div className="notification-popover glass glass-light" role="dialog" aria-label={english ? "Notification center" : "通知中心"}>
              <div><strong>{english ? "Notification center" : "通知中心"}</strong><button className="drawer-close" onClick={() => setNotificationsOpen(false)} aria-label={english ? "Close notifications" : "关闭通知"}><X size={17} /></button></div>
              {notificationOrders.length ? notificationOrders.map(order => <button key={order.id} onClick={() => { setNotificationsOpen(false); setPage("orders"); }}><TicketCheck size={17} /><span><strong>{order.id} · {locale === "en" ? statusLabelsEn[order.status] : statusLabels[order.status]}</strong><small>{order.title} · {money(order.amount, order.currency)}</small></span></button>) : <p className="header-popover-copy">{english ? "No bookings currently need attention." : "当前没有需要处理的订单。"}</p>}
            </div>}
            {authenticated && tenantOpen && <div className="notification-popover tenant-popover glass glass-light" role="menu" aria-label={english ? "Company menu" : "企业菜单"}><div><strong>{copy.tenant}</strong><button className="drawer-close" onClick={() => setTenantOpen(false)} aria-label={english ? "Close company menu" : "关闭企业菜单"}><X size={17} /></button></div><button role="menuitem" onClick={() => { setTenantOpen(false); setPage("account"); }}><UserRound size={17} /><span><strong>{english ? "Company and account settings" : "企业与账户设置"}</strong><small>{english ? "Profile, security, and notifications" : "个人资料、安全和通知偏好"}</small></span></button><button role="menuitem" onClick={() => { setTenantOpen(false); setPage("customers"); }}><Users size={17} /><span><strong>{english ? "Customer management" : "客户管理"}</strong><small>{english ? "Status, contacts, and credit limits" : "客户状态、联系人和授信额度"}</small></span></button></div>}
            {helpOpen && <div className="notification-popover help-popover glass glass-light" role="dialog" aria-label={english ? "Help and support" : "帮助与支持"}><div><strong>{english ? "Help and support" : "帮助与支持"}</strong><button className="drawer-close" onClick={() => setHelpOpen(false)} aria-label={english ? "Close help" : "关闭帮助"}><X size={17} /></button></div><p className="header-popover-copy">{english ? "You are in Sandbox. For booking issues, record the booking number, requestId, and traceId before checking supplier status in Bookings." : "当前为 Sandbox 环境。订单异常请先记录订单号、requestId 和 traceId，再进入订单中心核对上游状态。"}</p><button onClick={() => { setHelpOpen(false); setPage("orders"); }}><TicketCheck size={17} /><span><strong>{english ? "Go to bookings" : "前往订单中心"}</strong><small>{english ? "Check bookings and supplier sync status" : "查询订单与供应商同步状态"}</small></span></button>{authSession?.user?.role === "admin" && <button onClick={() => { setHelpOpen(false); setPage("dashboard"); }}><CircleHelp size={17} /><span><strong>{english ? "Return to overview" : "返回经营总览"}</strong><small>{english ? "Review pending issues and quick actions" : "查看待处理异常和快捷入口"}</small></span></button>}</div>}
          </div>
          <div className="header-secondary">
            <nav className="booking-nav" aria-label={english ? "Main navigation" : "主导航"}>
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
            {authenticated && <button className="header-search" onClick={() => setPage("orders")} aria-label={english ? "Search bookings, customers, or destinations" : "搜索订单、客户或目的地"}>
              <Search size={16} /><span>{english ? "Search bookings, customers, or destinations" : "搜索订单、客户或目的地"}</span><kbd>⌘ K</kbd>
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
              setAuthFormError(english ? "The passwords do not match." : "两次输入的密码不一致");
              return;
            }
            if (!registrationForm.acceptedTerms) {
              setAuthFormError(english ? "Please accept the booking terms and privacy notice." : "请阅读并同意预订条款与隐私说明");
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
            <button type="button" className="modal-close" onClick={() => onAuthPromptChange(false)} disabled={authBusy} aria-label={english ? "Close sign-in dialog" : "关闭登录窗口"}><X size={19} /></button>
            <div className="auth-modal-icon"><LockKeyhole size={24} /></div>
            <p className="eyebrow">SECURE BOOKING</p>
            <h2 id="auth-dialog-title">{authView === "signin" ? english ? "Sign in to book" : "登录后即可预订" : english ? "Create your account" : "创建新账号"}</h2>
            <p className="modal-subtitle">{authView === "signin"
              ? english ? "Use your email and password to access bookings and traveler profiles." : "使用邮箱和密码访问订单、常用旅客与账户资料。"
              : english ? "Names are stored separately to match passports and supplier booking requirements." : "姓与名将分别保存，以符合护照和供应商预订要求。"}</p>
            <div className="auth-segmented" role="tablist" aria-label={english ? "Authentication mode" : "账号入口"}><button type="button" role="tab" aria-selected={authView === "signin"} className={authView === "signin" ? "active" : ""} onClick={() => switchAuthView("signin")}>{english ? "Sign in" : "登录"}</button><button type="button" role="tab" aria-selected={authView === "register"} className={authView === "register" ? "active" : ""} onClick={() => switchAuthView("register")}>{english ? "Create account" : "注册新账号"}</button></div>
            {authView === "signin" ? <div className="auth-form-grid">
              <label><span>{english ? "Email address" : "电子邮箱"}</span><input type="email" autoComplete="email" required value={signInForm.email} onChange={event => setSignInForm(current => ({ ...current, email: event.target.value }))} /></label>
              <label><span>{english ? "Password" : "密码"}</span><input type="password" autoComplete="current-password" required minLength={8} maxLength={72} value={signInForm.password} onChange={event => setSignInForm(current => ({ ...current, password: event.target.value }))} /></label>
            </div> : <div className="auth-form-grid two-columns">
              <label><span>{english ? "Surname" : "姓"}</span><input autoComplete="family-name" required maxLength={50} value={registrationForm.surname} onChange={event => setRegistrationForm(current => ({ ...current, surname: event.target.value }))} /></label>
              <label><span>{english ? "Given name" : "名"}</span><input autoComplete="given-name" required maxLength={50} value={registrationForm.givenName} onChange={event => setRegistrationForm(current => ({ ...current, givenName: event.target.value }))} /></label>
              <label className="wide"><span>{english ? "Email address" : "电子邮箱"}</span><input type="email" autoComplete="email" required maxLength={120} value={registrationForm.email} onChange={event => setRegistrationForm(current => ({ ...current, email: event.target.value }))} /></label>
              <label className="wide"><span>{english ? "Mobile number" : "手机号码"}</span><input type="tel" autoComplete="tel" required pattern="[+]?[0-9][0-9 -]{6,19}" value={registrationForm.phone} onChange={event => setRegistrationForm(current => ({ ...current, phone: event.target.value }))} /></label>
              <label><span>{english ? "Password" : "密码"}</span><input type="password" autoComplete="new-password" required minLength={8} maxLength={72} pattern="(?=.*[A-Za-z])(?=.*[0-9]).{8,72}" value={registrationForm.password} onChange={event => setRegistrationForm(current => ({ ...current, password: event.target.value }))} /><small>{english ? "8–72 characters with letters and numbers" : "8–72 位，必须同时包含字母和数字"}</small></label>
              <label><span>{english ? "Confirm password" : "确认密码"}</span><input type="password" autoComplete="new-password" required minLength={8} maxLength={72} value={registrationForm.confirmPassword} onChange={event => setRegistrationForm(current => ({ ...current, confirmPassword: event.target.value }))} /></label>
              <label className="auth-terms wide"><input type="checkbox" checked={registrationForm.acceptedTerms} onChange={event => setRegistrationForm(current => ({ ...current, acceptedTerms: event.target.checked }))} /><span>{english ? "I agree to the booking terms and privacy notice." : "我已阅读并同意预订条款与隐私说明。"}</span></label>
            </div>}
            {(authFormError || authError) && <p className="error-copy" role="alert">{authFormError || authError}</p>}
            <div className="modal-actions auth-actions"><button type="button" className="secondary" onClick={() => onAuthPromptChange(false)} disabled={authBusy}>{english ? "Continue searching" : "继续查询"}</button><button className="primary" disabled={authBusy}>{authBusy ? <><LoaderCircle className="spinner" size={17} />{authView === "signin" ? english ? "Signing in…" : "登录中…" : english ? "Creating account…" : "正在创建账号…"}</> : authView === "signin" ? <><LogIn size={17} />{english ? "Sign in" : "登录"}</> : <><UserRound size={17} />{english ? "Create account" : "注册并登录"}</>}</button></div>
            {authView === "signin" && <button type="button" className="acceptance-login" onClick={() => onLogin()} disabled={authBusy}>{english ? "Use the local acceptance account" : "使用本地验收账号"}</button>}
            <small className="auth-environment-note">{english ? "Self-registration is available only in local and sandbox environments. Production uses corporate SSO." : "自助注册仅用于本地与沙箱环境；生产环境必须使用企业统一身份认证。"}</small>
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
    { label: english ? "Sales today" : "今日交易额", value: salesToday, note: english ? "Paid and processing bookings today" : "仅统计今日有效订单", icon: CreditCard, tone: "blue" },
    { label: english ? "Bookings today" : "今日订单", value: data?.ordersToday ?? "—", note: english ? "Created today" : "今日创建", icon: TicketCheck, tone: "violet" },
    { label: english ? "Booking success" : "预订成功率", value: data ? `${data.successRate}%` : "—", note: english ? "Confirmed or ticketed today" : "今日已确认或已出票", icon: ShieldCheck, tone: "green" },
    { label: english ? "Open alerts" : "待处理异常", value: data?.alerts ?? "—", note: english ? "Across all active bookings" : "全部订单待处理项", icon: Bell, tone: "orange" },
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
        <div><p className="eyebrow">{todayHeading}</p><h1>{english ? `Good morning${identityName ? `, ${identityName}` : ""}` : `早上好${identityName ? `，${identityName}` : ""}`}</h1><p>{english ? "Here is today’s performance and priority work from the business database." : "以下为业务数据库中的今日表现与待办事项。"}</p></div>
        <button className="primary" onClick={() => navigate("hotels")}><Search size={17} />{english ? "Create booking" : "创建新预订"}</button>
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
        <div className="panel-title"><div><h2>{english ? "Favorite hotels" : "我收藏的酒店"}</h2><p>{english ? "Your saved G-Link properties · Live prices are checked when you search again" : "个人偏好酒店 · 价格与房态将在重新查询时实时确认"}</p></div><button className="text-button" onClick={() => { window.sessionStorage.setItem("fusiongo.accountSection", "favorites"); navigate("account"); }}>{english ? "Manage favorites" : "管理收藏"} →</button></div>
        {favoritesLoading ? <div className="favorite-hotel-grid"><div className="favorite-hotel-card skeleton-card" /><div className="favorite-hotel-card skeleton-card" /></div> : favoriteHotels.length ? <div className="favorite-hotel-grid">{favoriteHotels.slice(0, 4).map(hotel => <article className="favorite-hotel-card" key={hotel.id}>
          {hotel.image ? <img src={hotel.image} alt="" /> : <div className="favorite-image-placeholder"><Building2 size={22} /></div>}
          <div><span className="favorite-mark"><Heart size={13} fill="currentColor" />{english ? "Saved" : "已收藏"}</span><h3>{hotel.name}</h3><p>{[hotel.city, hotel.district].filter(Boolean).join(" · ") || (english ? "Location not supplied" : "上游未提供位置")}</p><button className="secondary" onClick={() => { rememberFavoriteHotelSearch(hotel.name); navigate("hotels"); }}>{english ? "Search live rates" : "查询实时房价"}</button></div>
        </article>)}</div> : <div className="favorite-empty"><Heart size={22} /><div><strong>{english ? "No favorite hotels yet" : "还没有收藏酒店"}</strong><span>{english ? "Save a property from hotel search results to see it here." : "在酒店搜索结果或详情页点击心形按钮即可收藏。"}</span></div><button className="secondary" onClick={() => navigate("hotels")}>{english ? "Find hotels" : "去找酒店"}</button></div>}
      </section>
      <section className="dashboard-grid">
        <article className="panel performance">
          <div className="panel-title"><div><h2>{english ? "Booking trend" : "订单趋势"}</h2><p>{english ? "Actual hotel and flight booking counts over the last 7 days" : "近 7 天酒店与机票真实订单量"}</p></div><span className="reference-source">{english ? "Live database · Last 7 days" : "业务数据库 · 近7天"}</span></div>
          <div className="chart-legend"><span><i className="hotel-dot" />{english ? "Hotels" : "酒店"}</span><span><i className="flight-dot" />{english ? "Flights" : "机票"}</span></div>
          <div className="chart">
            {(data?.trend || []).map(item => <div key={item.date} className="chart-column"><div className="bars"><i title={`${english ? "Hotels" : "酒店"}: ${item.hotels}`} style={{ height: `${item.hotels ? Math.max(8, item.hotels / trendMax * 100) : 2}%` }} /><b title={`${english ? "Flights" : "机票"}: ${item.flights}`} style={{ height: `${item.flights ? Math.max(8, item.flights / trendMax * 100) : 2}%` }} /></div><span>{new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric" }).format(new Date(`${item.date}T12:00:00`))}</span></div>)}
          </div>
        </article>
        <article className="panel quick-actions">
          <div className="panel-title"><div><h2>{english ? "Quick actions" : "快捷操作"}</h2><p>{english ? "Common business tasks" : "常用业务入口"}</p></div></div>
          <button onClick={() => navigate("hotels")}><span className="action-icon hotel"><BedDouble size={21} /></span><div><strong>{english ? "Book a hotel" : "酒店预订"}</strong><small>{english ? "Live global hotel inventory" : "全球酒店实时库存"}</small></div><span>→</span></button>
          <button onClick={() => navigate("flights")}><span className="action-icon flight"><Plane size={21} /></span><div><strong>{english ? "Book a flight" : "机票预订"}</strong><small>{english ? "International flights and live fares" : "国际航班与实时运价"}</small></div><span>→</span></button>
          <button onClick={() => navigate("orders")}><span className="action-icon order"><TicketCheck size={21} /></span><div><strong>{english ? "Process bookings" : "订单处理"}</strong><small>{data ? english ? `${data.alerts} booking${data.alerts === 1 ? "" : "s"} need attention` : `${data.alerts} 个订单等待处理` : english ? "Loading open bookings" : "正在读取待处理订单"}</small></div><span>→</span></button>
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
      <div className="panel-title"><div><h2>{english ? "Latest bookings" : "最新订单"}</h2><p>{english ? "FCG supplier status synchronized in real time" : "实时同步 FCG 上游状态"}</p></div>{onAll && <button className="text-button" onClick={onAll}>{english ? "View all" : "查看全部"} →</button>}</div>
      <div className="table-wrap"><table><thead><tr><th>{english ? "Booking ID" : "订单号"}</th><th>{english ? "Product" : "产品"}</th><th>{english ? "Customer" : "客户"}</th><th>{english ? "Amount" : "金额"}</th><th>{english ? "Status" : "状态"}</th><th>{english ? "Created" : "创建时间"}</th>{onSelect && <th>{english ? "Action" : "操作"}</th>}</tr></thead>
      <tbody>{orders.length ? orders.map(order => <tr key={order.id}><td><strong>{order.id}</strong><small>{order.supplierOrderNo || (english ? "Awaiting supplier reference" : "等待上游单号")}</small></td><td><div className="product-cell"><span className={order.productType}><>{order.productType === "hotel" ? <BedDouble size={16} /> : <Plane size={16} />}</></span><div>{order.title}<small>{order.subtitle}</small></div></div></td><td>{order.customer}</td><td><strong>{money(order.amount, order.currency)}</strong></td><td><StatusPill status={order.status} locale={locale} /></td><td>{order.createdAt}</td>{onSelect && <td><button className="table-action" onClick={() => onSelect(order)}>{english ? "Details" : "查看详情"}</button></td>}</tr>) : <tr><td colSpan={onSelect ? 7 : 6} className="empty-table-cell">{english ? "No bookings match the current filter." : "当前筛选条件下没有订单。"}</td></tr>}</tbody></table></div>
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
    <div className="result-timeline">{timeline.map((item, index) => <div className={index < 3 ? "done" : "waiting"} key={item}><span>{index < 3 ? <Check size={15} /> : <Clock3 size={15} />}</span><div><strong>{item}</strong><small>{index < 3 ? "已完成" : "通常需要 1–10 分钟"}</small></div></div>)}</div>
    <div className="confirmation-panel glass glass-light"><div><Mail size={18} /><span><strong>订单已提交</strong><small>{flight ? "出票后可下载电子客票" : "酒店确认后将生成确认邮件与入住凭证"}</small></span></div><button className="secondary" onClick={onDetails}><FileText size={16} />查看订单进度</button></div>
    <div className="result-actions"><button className="secondary" onClick={onRestart}>继续搜索</button><button className="primary" onClick={onDetails}>查看订单详情<ChevronRight size={17} /></button></div>
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
  const [reason, setReason] = useState("行程计划调整");
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
    } catch (caught) { setError(caught instanceof Error ? caught.message : "退改信息加载失败"); }
    finally { setLoading(""); }
  }, [order.id]);
  useEffect(() => { void load(); }, [load]);
  const run = async (key: string, action: () => Promise<FlightAfterSalesContext>) => {
    setLoading(key); setError("");
    try {
      const data = await action();
      setContext(data);
      await syncOrder();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "操作失败，请稍后重试"); }
    finally { setLoading(""); }
  };
  const searchChange = () => run("search", async () => {
    const data = await api.searchFlightChange(order.id, { date: targetDate, passengerCodes, segmentIds });
    setOffers(data);
    setSelectedOffer(data[0]?.priceKey || "");
    if (!data.length) throw new Error("新日期没有可改签航班，请更换日期");
    return context!;
  });
  const applyChange = () => {
    if (!selectedOffer) return setError("请先查询并选择改签航班");
    if (!contactSurname.trim() || !contactGivenName.trim()) return setError("请分别填写联系人姓和名");
    if (!window.confirm("确认提交改签申请？提交后将由供应商审核并可能产生差价。")) return;
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
    if (!contactSurname.trim() || !contactGivenName.trim()) return setError("请分别填写联系人姓和名");
    if (!window.confirm("确认提交退票申请？出票后退票可能产生航司手续费。")) return;
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
      <button className="modal-close" onClick={onClose} aria-label="关闭退改签"><X size={18} /></button>
      <p className="eyebrow">F-LINK AFTER-SALES</p>
      <h2 id="aftersales-title">机票退票与改签</h2>
      <p className="modal-subtitle">订单 {order.id} · 旅客和航段标识来自 F-Link 订单详情，并原样提交给供应商。</p>
      {loading === "load" && <p className="aftersales-loading"><LoaderCircle className="spinner" size={18} />正在读取航司订单状态…</p>}
      {error && <p className="error-copy" role="alert">{error}</p>}
      {context && <>
        <div className="aftersales-summary">
          <span><strong>可办理状态</strong><small>{context.eligible ? "已出票，可发起退改" : context.eligibilityReason}</small></span>
          <span><strong>供应商状态</strong><small>F-Link #{context.supplierStatus}</small></span>
        </div>
        {(context.change || context.refund) && <div className="aftersales-cases">
          {context.change && <article><div><strong>改签单 {context.change.orderNo}</strong><small>{context.change.targetDate ? `新日期 ${context.change.targetDate}` : "改签申请"}</small></div><span>{context.change.statusLabel}</span>
            <div className="case-actions"><button className="secondary" disabled={busy} onClick={() => void run("change-refresh", () => api.refreshFlightChange(order.id))}><RefreshCw size={15} />刷新</button>
              {context.change.status === 1 && <button className="primary" disabled={busy} onClick={() => { if (window.confirm(`确认支付改签差价 ${money(context.change?.amount || 0, context.change?.currency)}？`)) void run("change-pay", () => api.payFlightChange(order.id)); }}>支付差价</button>}
              {[0, 1].includes(context.change.status) && <button className="danger-action" disabled={busy} onClick={() => { if (window.confirm("确认撤销本次改签申请？")) void run("change-cancel", () => api.cancelFlightChange(order.id)); }}>撤销改签</button>}</div>
          </article>}
          {context.refund && <article><div><strong>退票单 {context.refund.orderNo}</strong><small>{context.refund.amount !== undefined ? `预计退款 ${money(context.refund.amount, context.refund.currency)}` : "等待供应商核算"}</small></div><span>{context.refund.statusLabel}</span>
            <div className="case-actions"><button className="secondary" disabled={busy} onClick={() => void run("refund-refresh", () => api.refreshFlightRefund(order.id))}><RefreshCw size={15} />刷新</button>
              {context.refund.status === 1 && <><button className="primary" disabled={busy} onClick={() => { if (window.confirm("确认接受供应商核算结果并继续退款？")) void run("refund-confirm", () => api.confirmFlightRefund(order.id, "1")); }}>确认退款</button><button className="danger-action" disabled={busy} onClick={() => { if (window.confirm("确认撤销退票申请并保留原客票？")) void run("refund-cancel", () => api.confirmFlightRefund(order.id, "2")); }}>撤销退票</button></>}</div>
          </article>}
        </div>}
        <div className="aftersales-tabs" role="tablist">
          <button role="tab" aria-selected={mode === "change"} className={mode === "change" ? "active" : ""} onClick={() => { setMode("change"); setError(""); }}>申请改签</button>
          <button role="tab" aria-selected={mode === "refund"} className={mode === "refund" ? "active" : ""} onClick={() => { setMode("refund"); setError(""); }}>申请退票</button>
        </div>
        <fieldset className="aftersales-form" disabled={!context.eligible || busy}>
          <div className="aftersales-choice"><span>乘机人（可多选）</span>{context.passengers.map(item => <label key={item.passengerCode}><input type="checkbox" checked={passengerCodes.includes(item.passengerCode)} onChange={event => { setPassengerCodes(current => event.target.checked ? [...current, item.passengerCode] : current.filter(code => code !== item.passengerCode)); setOffers([]); setError(""); }} />{item.name}</label>)}</div>
          <div className="aftersales-choice"><span>原航段（可多选）</span>{context.segments.map(item => <label key={item.segmentId}><input type="checkbox" checked={segmentIds.includes(item.segmentId)} onChange={event => { setSegmentIds(current => event.target.checked ? [...current, item.segmentId] : current.filter(id => id !== item.segmentId)); setOffers([]); setError(""); }} />{item.origin} → {item.destination} · {item.flightNo}</label>)}</div>
          {mode === "change" && <label><span>新出发日期</span><input type="date" min={localDateValue(new Date())} value={targetDate} onChange={event => { setTargetDate(event.target.value); setOffers([]); setError(""); }} /></label>}
          <label><span>申请类型</span><select value={afterSalesType} onChange={event => { setAfterSalesType(Number(event.target.value) as 1 | 2); setError(""); }}><option value={1}>自愿退改</option><option value={2}>非自愿退改</option></select></label>
          <label><span>{mode === "change" ? "改签原因" : "退票原因"}</span><input value={reason} onChange={event => setReason(event.target.value)} /></label>
          {afterSalesType === 2 && <label className="wide"><span>证明材料链接（最多5个，以空格或逗号分隔）</span><input type="url" value={evidenceText} onChange={event => setEvidenceText(event.target.value)} placeholder="https://…" /></label>}
          <label><span>联系人姓 / Surname</span><input required value={contactSurname} onChange={event => setContactSurname(event.target.value)} /></label>
          <label><span>联系人名 / Given name</span><input required value={contactGivenName} onChange={event => setContactGivenName(event.target.value)} /></label>
          <label><span>联系电话</span><input value={contactPhone} onChange={event => setContactPhone(event.target.value)} /></label>
          <label className="wide"><span>联系邮箱</span><input type="email" value={contactEmail} onChange={event => setContactEmail(event.target.value)} /></label>
        </fieldset>
        {mode === "change" && <div className="change-offers">
          {offers.map(offer => <label className={selectedOffer === offer.priceKey ? "selected" : ""} key={offer.priceKey}><input type="radio" name="change-offer" value={offer.priceKey} checked={selectedOffer === offer.priceKey} onChange={() => setSelectedOffer(offer.priceKey)} /><span><strong>{offer.flightNo} · {offer.airline}</strong><small>{offer.departureTime}–{offer.arrivalTime} · {offer.duration}</small></span><b>{money(offer.price, offer.currency)}</b></label>)}
        </div>}
        <div className="modal-actions">
          <button className="secondary" onClick={onClose}>稍后处理</button>
          {mode === "change" && <><button className="secondary" disabled={!context.eligible || busy || !targetDate || !passengerCodes.length || !segmentIds.length} onClick={() => void searchChange()}>{loading === "search" ? "查询中…" : "查询改签航班"}</button><button className="primary" disabled={!context.eligible || busy || !selectedOffer || !passengerCodes.length || !segmentIds.length} onClick={applyChange}>{loading === "apply-change" ? "提交中…" : "提交改签申请"}</button></>}
          {mode === "refund" && <button className="danger-action" disabled={!context.eligible || busy || !passengerCodes.length || !segmentIds.length} onClick={applyRefund}>{loading === "apply-refund" ? "提交中…" : "提交退票申请"}</button>}
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
        ? tr(`已于 ${synchronizedAt} 向上游同步，当前状态仍为“${labels[refreshed.status]}”。`, `Supplier status synchronized at ${synchronizedAt}. The booking remains “${labels[refreshed.status]}”.`)
        : tr(`状态已从“${labels[previousStatus]}”更新为“${labels[refreshed.status]}”（${synchronizedAt}）。`, `Status updated from “${labels[previousStatus]}” to “${labels[refreshed.status]}” at ${synchronizedAt}.`));
    }
    catch (caught) { setError(caught instanceof Error ? caught.message : tr("订单状态刷新失败", "Could not refresh booking status.")); }
    finally { setLoading(""); }
  };
  const cancel = async () => {
    if (!window.confirm(tr(`确认取消订单 ${order.id}？取消结果以上游政策为准。`, `Cancel booking ${order.id}? The supplier policy and response determine the final result.`))) return;
    setLoading("cancel"); setError("");
    try {
      const cancelled = await api.cancelOrder(order.id);
      setOrder(cancelled);
      onOrderChange?.(cancelled);
      setNotice(tr("取消结果已同步到订单列表。", "The cancellation result has been synchronized to the booking list."));
    }
    catch (caught) { setError(caught instanceof Error ? caught.message : tr("订单取消失败", "Could not cancel the booking.")); }
    finally { setLoading(""); }
  };
  const downloadVoucher = () => {
    if (!flight && order.status !== "CONFIRMED") {
      setNotice(tr("酒店尚未确认，电子凭证将在状态变为“已确认”后开放下载。", "The hotel has not confirmed this booking. The voucher becomes available after confirmation."));
      return;
    }
    downloadOrderDocument(order.id, flight && order.status === "TICKETED" ? "ticket" : "confirmation");
  };
  const downloadTicket = () => {
    if (order.status !== "TICKETED") {
      setNotice(tr("航司尚未出票，电子客票将在状态变为“已出票”后开放下载。", "The airline has not issued the ticket. The e-ticket becomes available after ticketing."));
      return;
    }
    downloadOrderDocument(order.id, "ticket");
  };
  const previewConfirmationEmail = () => {
    if (flight || order.status !== "CONFIRMED") {
      setNotice(tr("酒店确认后才会生成包含真实行程与价格数据的确认邮件。", "The confirmation email is generated with actual itinerary and price data after the hotel confirms the booking."));
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
    <button className="back-link" onClick={onBack}><ArrowLeft size={17} />{tr("返回上一页", "Back")}</button>
    <BookingProgress current={5} labels={flight ? [tr("查询", "Search"), tr("选择航班", "Select flight"), tr("乘机人", "Passengers"), tr("支付", "Payment"), tr("出票确认", "Ticketing"), tr("订单详情", "Booking details")] : [tr("查询", "Search"), tr("搜索结果", "Results"), tr("酒店详情", "Hotel details"), tr("下单支付", "Payment"), tr("预订确认", "Confirmation"), tr("订单详情", "Booking details")]} />
    <header className="order-detail-head glass glass-light">
      <div><p className="eyebrow">{flight ? "FLIGHT ORDER" : "HOTEL ORDER"}</p><h1>{order.title}</h1><p>{order.subtitle}</p></div>
      <div className="order-status-stack"><StatusPill status={order.status} locale={locale} /><span>{tr("本地订单号", "FusionGo booking ID")} {order.id}</span><span>{tr("上游订单号", "Supplier booking ID")} {order.supplierOrderNo || tr("确认后生成", "Generated after confirmation")}</span></div>
    </header>
    <div className="order-detail-grid">
      <div className="order-detail-main">
        <section className="detail-section glass glass-light"><div className="panel-title"><div><h2>{flight ? tr("航班与乘机人", "Flight and passengers") : tr("住宿与入住人", "Stay and guests")}</h2><p>{tr("预订核心信息", "Core booking information")}</p></div></div>
          <div className="order-product-summary"><span className={`product-hero-icon ${order.productType}`}>{flight ? <Plane size={25} /> : <BedDouble size={25} />}</span><div><strong>{order.title}</strong><span>{order.subtitle}</span><small>{bookingDetails?.serviceSummary || tr("订单快照读取中…", "Loading booking snapshot…")}</small></div></div>
          <div className="detail-facts"><span><UserRound size={17} /><b>{bookingDetails?.travelerName || tr("读取中…", "Loading…")}</b><small>{flight ? (bookingDetails?.documentMasked ? `${tr("证件", "Document")} ${bookingDetails.documentMasked}` : tr("乘机人资料", "Passenger details")) : tr("主要入住人", "Primary guest")}</small></span><span><Mail size={17} /><b>{bookingDetails?.email || "—"}</b><small>{tr("确认通知邮箱", "Confirmation email")}</small></span><span><Phone size={17} /><b>{bookingDetails?.phone || "—"}</b><small>{tr("紧急联系人", "Emergency contact")}</small></span></div>
        </section>
        <section className="detail-section glass glass-light"><div className="panel-title"><div><h2>{flight ? tr("票务与服务", "Ticketing and services") : tr("政策与入住须知", "Policies and stay information")}</h2><p>{tr("具体执行以上游确认结果为准", "The supplier confirmation determines the applicable terms.")}</p></div></div>
          <div className="policy-list">
            <div><ShieldCheck size={18} /><span><strong>{flight ? tr("退改签规则", "Change and refund rules") : tr("取消政策", "Cancellation policy")}</strong><small>{flight ? tr("退改费用以 F-Link 及航司实时核算结果为准", "Change and refund fees are calculated live by F-Link and the airline.") : bookingDetails?.cancelPolicy || tr("上游未返回取消政策", "Supplier cancellation policy unavailable")}</small></span><ChevronRight size={17} /></div>
            <div><Luggage size={18} /><span><strong>{flight ? tr("舱等与行李", "Cabin and baggage") : tr("房型、床型与早餐", "Room, bed and breakfast")}</strong><small>{flight ? `${bookingDetails?.cabin || tr("上游未返回舱等", "Cabin not supplied")} · ${bookingDetails?.baggage || tr("上游未返回行李额度", "Baggage allowance not supplied")}` : `${bookingDetails?.roomName || tr("上游未返回房型", "Room type not supplied")} · ${bookingDetails?.bedTypeDescription || tr("上游未返回床型描述", "Bed type not supplied")} · ${bookingDetails?.breakfast || tr("上游未返回早餐信息", "Breakfast information not supplied")}`}</small></span><ChevronRight size={17} /></div>
            {!flight && <div><Clock3 size={18} /><span><strong>{tr("办理入住与特别提示", "Check-in and special instructions")}</strong><small>{[bookingDetails?.checkInInstructions, ...(bookingDetails?.specialCheckInInstructions || [])].filter(Boolean).join(locale === "en" ? "; " : "；") || tr("上游未返回入住说明", "Check-in instructions not supplied")}</small></span><ChevronRight size={17} /></div>}
            <div><FileText size={18} /><span><strong>{tr("电子凭证", "Electronic documents")}</strong><small>{flight ? tr("出票完成后可下载电子客票与行程单", "Download the e-ticket and itinerary after ticketing.") : tr("酒店确认后可下载入住确认单", "Download the stay confirmation after hotel confirmation.")}</small></span><ChevronRight size={17} /></div>
          </div>
        </section>
      </div>
      <aside className="order-side glass glass-light"><h2>{tr("订单金额", "Booking amount")}</h2><div className="price-lines">
        {!flight && bookingDetails?.priceBreakdown ? <>
          {bookingDetails.priceBreakdown.roomSubtotal !== undefined && <span>{tr("房费小计", "Room subtotal")}<b>{money(bookingDetails.priceBreakdown.roomSubtotal, bookingDetails.priceBreakdown.currency)}</b></span>}
          {bookingDetails.priceBreakdown.taxFee !== undefined && <span>{tr("税费", "Taxes and fees")}<b>{money(bookingDetails.priceBreakdown.taxFee, bookingDetails.priceBreakdown.currency)}</b></span>}
          {bookingDetails.priceBreakdown.salesTax !== undefined && <span>{tr("销售税", "Sales tax")}<b>{money(bookingDetails.priceBreakdown.salesTax, bookingDetails.priceBreakdown.currency)}</b></span>}
          {bookingDetails.priceBreakdown.otherTax !== undefined && <span>{tr("其他税费", "Other taxes")}<b>{money(bookingDetails.priceBreakdown.otherTax, bookingDetails.priceBreakdown.currency)}</b></span>}
          {bookingDetails.priceBreakdown.serviceFee !== undefined && <span>{tr("FusionGo 服务费", "FusionGo service fee")}<b>{money(bookingDetails.priceBreakdown.serviceFee, bookingDetails.priceBreakdown.currency)}</b></span>}
          {bookingDetails.priceBreakdown.chargesDueAtProperty !== undefined && <span className="property-charge">{tr("到店另付", "Due at property")}<b>{money(bookingDetails.priceBreakdown.chargesDueAtProperty, bookingDetails.priceBreakdown.chargesDueAtPropertyCurrency || bookingDetails.priceBreakdown.currency)}</b></span>}
          {bookingDetails.priceBreakdown.chargesDueAtProperty === undefined && bookingDetails.priceBreakdown.chargesDueAtPropertyNotice && <span className="property-charge property-charge-notice">{tr("到店另付说明", "Property charge notice")}<b>{bookingDetails.priceBreakdown.chargesDueAtPropertyNotice}</b></span>}
        </> : <span>{tr("价格明细", "Price details")}<b>{flight ? tr("票价与税费以上游订单为准", "Fare and taxes follow the supplier booking.") : tr("上游未返回拆分", "Supplier breakdown unavailable")}</b></span>}
        <span className="total">{tr("实付总额", "Total paid")}<strong>{money(order.amount, order.currency)}</strong></span>
      </div><p className="policy-note"><ShieldCheck size={16} />{flight ? tr("支付状态以上游为准", "Payment status follows the supplier record.") : bookingDetails?.paymentTiming || tr("收款时点读取中…", "Loading payment timing…")}</p>
        {error && <p className="error-copy" role="alert">{error}</p>}
        {notice && <p className="notice-copy" role="status">{notice}</p>}
        <button className="primary wide-action" onClick={refresh} disabled={Boolean(loading)}>{loading === "refresh" ? <><LoaderCircle className="spinner" size={17} />{tr("刷新中", "Refreshing…")}</> : <><RefreshCw size={17} />{tr("刷新订单状态", "Refresh booking status")}</>}</button>
        {flight && <button className="secondary wide-action" onClick={() => setShowAfterSales(true)}><RefreshCw size={17} />{tr("退票 / 改签", "Refund / Change")}</button>}
        {flight && <button className="secondary wide-action" onClick={downloadTicket}><TicketCheck size={17} />{tr("在线值机 / 下载客票", "Check in / Download ticket")}</button>}
        <button className="secondary wide-action" onClick={downloadVoucher}><ReceiptText size={17} />{tr("下载电子凭证（PDF）", "Download voucher (PDF)")}</button>
        {!flight && <button className="secondary wide-action" onClick={previewConfirmationEmail}><Mail size={17} />{tr("预览确认邮件", "Preview confirmation email")}</button>}
        {canCancel && <button className="danger-action wide-action" onClick={cancel} disabled={Boolean(loading)}>{loading === "cancel" ? tr("取消处理中…", "Cancelling…") : tr("取消订单", "Cancel booking")}</button>}
        {onRestart && <button className="text-button wide-action" onClick={onRestart}>{tr("重新预订", "Book again")}</button>}
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
  return <div className="price-lines eps-price-breakdown" aria-label="价格明细">
    {breakdown ? <>
      {line("房费小计", breakdown.roomSubtotal)}
      {line("税费", breakdown.taxFee)}
      {line("销售税", breakdown.salesTax)}
      {line("其他税费", breakdown.otherTax)}
      {line("FusionGo 服务费", breakdown.serviceFee)}
      {breakdown.feeItems?.map((item, index) => <span key={`${item.type}-${item.date || index}`}><span>{item.type}{item.date ? ` · ${item.date}` : ""}</span><b>{money(item.value, item.currency)}</b></span>)}
      {breakdown.chargesDueAtProperty !== undefined && <span className="property-charge"><span>到店另付</span><b>{money(breakdown.chargesDueAtProperty, breakdown.chargesDueAtPropertyCurrency || offer.currency)}</b></span>}
      {breakdown.chargesDueAtProperty === undefined && breakdown.chargesDueAtPropertyNotice && <span className="property-charge property-charge-notice"><span>到店另付说明</span><b>{breakdown.chargesDueAtPropertyNotice}</b></span>}
    </> : <span><span>税费与费用明细</span><b>上游未返回拆分</b></span>}
    <span className="total"><span>应付总额</span><strong>{money(total, offer.currency)}</strong></span>
  </div>;
}

function HotelComplianceFacts({ offer, compact = false }: { offer: HotelOffer; compact?: boolean }) {
  return <div className={`eps-facts ${compact ? "compact" : ""}`}>
    <div><strong>床型</strong><span>{offer.bedTypeDescription || "上游未返回床型描述"}</span></div>
    <div><strong>取消条件</strong><span className={offer.nonRefundable ? "non-refundable" : ""}>{offer.nonRefundable ? "不可退款" : offer.cancelPolicy || "上游未返回取消政策"}</span></div>
    <div><strong>入住说明</strong><span>{offer.checkInInstructions || "上游未返回办理入住时间"}</span></div>
    {!!offer.specialCheckInInstructions?.length && <div><strong>特别入住提示</strong><span>{offer.specialCheckInInstructions.join("；")}</span></div>}
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
    if (guestNames.some(name => !name.surname.trim() || !name.givenName.trim()) || !contactSurname.trim() || !contactGivenName.trim() || phone.length < 8 || !email.includes("@")) return setError(`请为 ${roomNum} 间房分别填写姓和名，并补全联系人信息`);
    if (guestNames.some(name => !/^[A-Za-z]+(?:[ '\-][A-Za-z]+)*$/.test(name.surname.trim()) || !/^[A-Za-z]+(?:[ '\-][A-Za-z]+)*$/.test(name.givenName.trim()))) return setError("入住人的英文姓和英文名只能包含英文字母、空格、连字符或撇号");
    setLoading(true); setError("");
    try {
      const guests = guestNames.map((guestName, index) => ({
        roomIndex: index + 1,
        firstName: guestName.givenName.trim().toUpperCase(),
        lastName: guestName.surname.trim().toUpperCase(),
      }));
      const contactName = joinPersonName({ surname: contactSurname, givenName: contactGivenName });
      const [arriveTime, latestArriveTime] = arrivalWindow === "22:00后" ? ["22:00", "23:59"] : arrivalWindow.split("-");
      const created = await api.createOrder({
        productType: "hotel",
        offerId: offer.id,
        guests,
        contact: { name: contactName, surname: contactSurname.trim(), givenName: contactGivenName.trim(), phone, email },
        arriveTime,
        latestArriveTime,
      });
      onComplete(await api.payOrder(created.id, paymentMethod));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "提交失败，请稍后重试"); } finally { setLoading(false); }
  };
  return <section className="booking-flow-page">
    <button className="back-link" onClick={onBack}><ArrowLeft size={17} />返回酒店详情</button>
    <BookingProgress current={3} labels={["查询", "搜索结果", "酒店详情", "下单支付", "预订确认", "订单详情"]} />
    <SimulationNotice offer={offer} />
    <header className="flow-heading"><p className="eyebrow">COMPLETE YOUR STAY</p><h1>填写入住与支付信息</h1><p>请确保入住人姓名与有效证件完全一致。</p></header>
    <div className="checkout-layout"><div className="checkout-main">
      <section className="form-section glass glass-light"><div className="section-title"><span>1</span><div><h2>入住人信息</h2><p>本订单包含 {roomNum} 间房、{nights} 晚，共 {offer.numberOfAdults || roomNum} 位成人</p></div></div><div className="room-guest-list">
        {guestNames.map((guestName, index) => <div className="room-guest-row" key={index}><strong>房间 {index + 1}</strong><label><span>英文姓 / Surname</span><div className="light-field"><UserRound size={17} /><input aria-label={`房间${index + 1}入住人英文姓`} autoComplete="family-name" value={guestName.surname} onChange={event => updateGuestName(index, "surname", event.target.value)} placeholder="ZHANG" /></div><small>必须与入住证件一致</small></label><label><span>英文名 / Given name</span><div className="light-field"><UserRound size={17} /><input aria-label={`房间${index + 1}入住人英文名`} autoComplete="given-name" value={guestName.givenName} onChange={event => updateGuestName(index, "givenName", event.target.value)} placeholder="SAN" /></div><small>必须与入住证件一致</small></label></div>)}
      </div><div className="form-grid stay-preferences">
        <label><span>预计到店时间</span><select value={arrivalWindow} onChange={event => setArrivalWindow(event.target.value)}><option>18:00-20:00</option><option>20:00-22:00</option><option>22:00后</option></select></label>
        <label><span>已选床型</span><div className="read-only-value">{offer.bedTypeDescription || "上游未返回床型描述"}</div></label>
      </div></section>
      <section className="form-section glass glass-light"><div className="section-title"><span>2</span><div><h2>政策与入住须知</h2><p>以下内容来自 G-Link 实时产品，请在支付前确认</p></div></div><HotelComplianceFacts offer={offer} />
        {(offer.numberOfChildren || 0) > 0 && <p className="child-age-recap"><Users size={17} /><strong>{offer.numberOfChildren} 位儿童</strong>：年龄 {offer.childrenAges?.join("、") || "上游未返回"} 岁</p>}
      </section>
      <section className="form-section glass glass-light"><div className="section-title"><span>3</span><div><h2>联系人</h2><p>用于接收确认单和异常通知；提交过程仅通过加密连接传输</p></div></div><div className="form-grid">
        <label><span>联系人姓 / Surname</span><div className="light-field"><UserRound size={17} /><input autoComplete="family-name" value={contactSurname} onChange={event => { setContactSurname(event.target.value); setError(""); }} /></div></label>
        <label><span>联系人名 / Given name</span><div className="light-field"><UserRound size={17} /><input autoComplete="given-name" value={contactGivenName} onChange={event => { setContactGivenName(event.target.value); setError(""); }} /></div></label>
        <label><span>手机号码</span><div className="light-field"><Phone size={17} /><input value={phone} onChange={event => { setPhone(event.target.value); setError(""); }} /></div></label>
        <label className="wide"><span>电子邮箱</span><div className="light-field"><Mail size={17} /><input type="email" value={email} onChange={event => { setEmail(event.target.value); setError(""); }} /></div></label>
      </div></section>
      <section className="form-section glass glass-light"><div className="section-title"><span>4</span><div><h2>支付方式与收款说明</h2><p>{offer.paymentTiming || "上游未返回收款时点"}</p></div></div>
        <label className={`payment-option ${paymentMethod === "credit" ? "selected" : ""}`}><input type="radio" checked={paymentMethod === "credit"} onChange={() => setPaymentMethod("credit")} name="hotel-payment" /><Landmark size={20} /><span><strong>企业授信账户</strong><small>提交时从本地数据库实时校验可用额度</small></span>{paymentMethod === "credit" && <CheckCircle2 size={19} />}</label>
        <label className="payment-option disabled" aria-disabled="true"><input type="radio" disabled checked={paymentMethod === "card"} onChange={() => undefined} name="hotel-payment" /><CreditCard size={20} /><span><strong>银行卡支付</strong><small>当前未接入生产收单渠道，不可选择</small></span></label>
        <div className="payment-disclosure"><span><strong>收款方</strong>{offer.paymentProcessor || "上游未返回"}</span><span><strong>Expedia Group MoR</strong>不适用，本产品来自 G-Link</span><span><strong>支付处理地点</strong>{offer.paymentProcessingLocation || "不适用：非 Expedia Group MoR"}</span><span><strong>PSD2 / SCA</strong>{paymentMethod === "card" ? "生产环境仅在已启用合规收单与强客户认证后开放" : "企业授信支付，不向终端旅客收取银行卡款项"}</span></div>
      </section>
    </div><aside className="price-summary glass glass-light">
      {offer.image ? <img src={offer.image} alt="" /> : <div className="hotel-image-placeholder compact"><Building2 size={24} /><span>上游未提供图片</span></div>}<h2>{offer.name}</h2>{offer.district && <p>{offer.district}</p>}
      <div className="summary-detail"><span>{stayDateLabel(offer.checkInDate)} 入住</span><span>{stayDateLabel(offer.checkOutDate)} 退房 · {nights}晚</span><span>{offer.roomName} · {roomNum}间</span><span>{offer.numberOfAdults || roomNum}位成人 · {offer.breakfast}</span></div>
      <HotelPriceBreakdownView offer={offer} total={total} />
      <p className="policy-note"><ShieldCheck size={16} />{offer.cancelPolicy}</p>{error && <p className="error-copy" role="alert">{error}</p>}
      <button className="primary pay-button" onClick={submit} disabled={loading} aria-busy={loading}>{loading ? <><LoaderCircle className="spinner" size={18} />创建订单并支付</> : <><LockKeyhole size={17} />确认支付 {money(total, offer.currency)}</>}</button>
      <small className="secure-copy">提交即表示同意预订条款、取消政策与隐私政策</small>
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
    try { onCheckout(selected, await api.checkHotelAvailability(selected.id)); } catch (caught) { setError(caught instanceof Error ? caught.message : "当前房型无法预订"); } finally { setCheckingId(""); }
  };
  return <section className="booking-flow-page">
    <button className="back-link" onClick={onBack}><ArrowLeft size={17} />返回搜索结果</button>
    <BookingProgress current={2} labels={["查询", "搜索结果", "酒店详情", "下单支付", "预订确认", "订单详情"]} />
    <SimulationNotice offer={offer} />
    <div className="hotel-gallery">{offer.image ? <img className="gallery-main" src={offer.image} alt={`${offer.name}外观`} /> : <div className="gallery-main gallery-unavailable"><Building2 size={38} /><span>G-Link 未提供酒店图片</span></div>}<div className="gallery-unavailable"><ImageOff size={25} /><span>暂无更多上游图片</span></div><div className="gallery-unavailable"><ImageOff size={25} /><span>暂无更多上游图片</span></div></div>
    <div className={`hotel-detail-layout ${offer.rating === undefined ? "without-rating" : ""}`}><div>{offer.stars !== undefined && <p className="stars">{"★".repeat(offer.stars)}</p>}<div className="hotel-detail-title"><h1>{offer.name}</h1><button className={`favorite-button detail ${favorite ? "active" : ""}`} onClick={onToggleFavorite} disabled={favoriteBusy} aria-pressed={favorite} aria-label={favorite ? "取消收藏酒店" : "收藏酒店"}><Heart size={18} fill={favorite ? "currentColor" : "none"} />{favorite ? "已收藏" : "收藏酒店"}</button></div>{offer.district && <p className="detail-location"><MapPin size={16} />{offer.district}</p>}
      {!!offer.tags.length && <div className="amenity-strip">{offer.tags.map(item => <span key={item}><Check size={14} />{item}</span>)}</div>}
      <div className="rate-filter-bar glass glass-light"><strong>G-Link 实时可订产品</strong><span>{offers.length} 个房型/价格计划</span><span className="upstream-only-badge">仅展示接口返回数据</span></div>
      <div className="room-offer-list">{offers.map((roomOffer, index) => <section className="room-offer glass glass-light" key={roomOffer.id}><div className="room-photo">{roomOffer.image ? <img src={roomOffer.image} alt="" /> : <div className="hotel-image-placeholder"><Building2 size={25} /><span>上游未提供房型图片</span></div>}</div><div className="room-copy"><p className="eyebrow">LIVE RATE · {index + 1}</p><div className="room-title-line"><h2>{roomOffer.roomName}</h2>{roomOffer.nonRefundable && <span className="non-refundable-badge">不可退款</span>}{roomOffer.payAtHotel && <span className="pay-at-hotel-badge">到店付</span>}</div>{roomOffer.ratePlanName && <strong className="rate-plan-name">{roomOffer.ratePlanName}</strong>}<span>{roomOffer.roomNum || 1}间 · {roomOffer.numberOfAdults || 2}位成人 · {roomOffer.nights || 1}晚{roomOffer.maxRoomCount ? ` · 最多可订${roomOffer.maxRoomCount}间` : ""}</span><ul><li><BedDouble size={15} />{roomOffer.bedTypeDescription || "上游未返回床型描述"}</li><li><Check size={15} />{roomOffer.breakfast}</li><li><ShieldCheck size={15} />{roomOffer.cancelPolicy}</li></ul><HotelComplianceFacts offer={roomOffer} compact /></div><div className="room-price"><small>每间每晚含税</small><strong>{money(roomOffer.nightlyPrice, roomOffer.currency)}</strong><span>{roomOffer.nights || 1}晚 × {roomOffer.roomNum || 1}间，共 {money(roomOffer.totalPrice ?? roomOffer.nightlyPrice * (roomOffer.nights || 1) * (roomOffer.roomNum || 1), roomOffer.currency)}</span><button className="primary" onClick={() => void check(roomOffer)} disabled={Boolean(checkingId)}>{checkingId === roomOffer.id ? <><LoaderCircle className="spinner" size={17} />正在确认库存</> : authenticated ? "预订此产品" : "登录后预订"}</button></div></section>)}</div>{error && <p className="error-copy room-error" role="alert">{error}</p>}
    </div>{offer.rating !== undefined && <aside className="detail-rating glass glass-light"><strong>{offer.rating}</strong><span>上游评分</span>{offer.ratingSource && <small>评分来源：{offer.ratingSource}</small>}</aside>}</div>
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
      ? { "上海": "Shanghai", "香港": "Hong Kong", "北京": "Beijing", "深圳": "Shenzhen", "曼谷": "Bangkok" }
      : { Shanghai: "上海", "Hong Kong": "香港", Beijing: "北京", Shenzhen: "深圳", Bangkok: "曼谷" };
    setDestination(current => names[current] || current);
    setLastSearch(current => names[current] || current);
  }, [english]);
  const suggestions = useMemo(() => {
    const normalized = destination.trim().toLowerCase();
    return (english ? [
      { name: "Shanghai", detail: "China · Business and leisure favorite" },
      { name: "Hong Kong", detail: "Hong Kong SAR · Harbour city" },
      { name: "Beijing", detail: "China · Historic capital" },
      { name: "Shenzhen", detail: "China · Greater Bay Area" },
      { name: "Bangkok", detail: "Thailand · Popular international destination" },
    ] : [
      { name: "上海", detail: "中国 · 商务与度假热门" },
      { name: "香港", detail: "中国香港 · 海港城市" },
      { name: "北京", detail: "中国 · 历史文化名城" },
      { name: "深圳", detail: "中国 · 粤港澳大湾区" },
      { name: "曼谷", detail: "泰国 · 热门国际目的地" },
    ]).filter(item => !normalized || `${item.name}${item.detail}`.toLowerCase().includes(normalized)).slice(0, 5);
  }, [destination, english]);
  const districtOptions = useMemo(() => Array.from(new Set(items.map(hotel => hotel.district).filter(Boolean)))
    .map(district => ({ district, count: items.filter(hotel => hotel.district === district).length })), [items]);
  const amenityOptions = useMemo(() => {
    const preferred = ["免费停车", "地铁直达", "亲子友好", "室内泳池", "健身中心", "行政酒廊", "外滩景观", "设计酒店", "新开业"];
    const counts = new Map<string, number>();
    items.forEach(hotel => hotel.tags.forEach(tag => counts.set(tag, (counts.get(tag) || 0) + 1)));
    return preferred.map(tag => ({ tag, count: counts.get(tag) || 0 }));
  }, [items]);
  const breakfastCount = useMemo(() => items.filter(hotel => !/(不含早|无早餐|without breakfast|no breakfast)/i.test(hotel.breakfast) && /(含早|早餐|breakfast)/i.test(hotel.breakfast)).length, [items]);
  const freeCancellationCount = useMemo(() => items.filter(hotel => /(免费取消|可免费取消|free cancellation|free cancel)/i.test(hotel.cancelPolicy)).length, [items]);
  const bedTypeOptions = useMemo(() => ([
    { value: "" as const, label: english ? "Any bed type" : "不限", count: items.length },
    { value: "double" as const, label: english ? "Double / queen bed" : "大床", count: items.filter(hotel => /(大床|双人大床|double|queen|king)/i.test(hotel.roomName)).length },
    { value: "twin" as const, label: english ? "Twin beds" : "双床", count: items.filter(hotel => /(双床|twin)/i.test(hotel.roomName)).length },
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
        if (active) setError(caught instanceof Error ? caught.message : english ? "Could not load favorite hotels." : "收藏酒店读取失败");
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
      setError(caught instanceof Error ? caught.message : english ? "Could not update favorite." : "收藏状态更新失败");
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
      const includesBreakfast = !/(不含早|无早餐|without breakfast|no breakfast)/i.test(breakfastText)
        && /(含早|早餐|breakfast)/i.test(breakfastText);
      const supportsFreeCancellation = /(免费取消|可免费取消|free cancellation|free cancel)/i.test(cancellationText);
      const matchesBed = !bedType
        || (bedType === "double" && /(大床|双人大床|double|queen|king)/i.test(roomText))
        || (bedType === "twin" && /(双床|twin)/i.test(roomText));
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
      setError(english ? "Enter a city, landmark, or hotel name." : "请输入城市、地标或酒店名称");
      return;
    }
    if (!checkIn || !checkOut) {
      setError(english ? "Select both check-in and check-out dates." : "请选择完整的入住和退房日期");
      return;
    }
    if (checkOut <= checkIn) {
      setError(english ? "Check-out must be after check-in." : "退房日期必须晚于入住日期");
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
        "上海": "SHA", shanghai: "SHA",
        "深圳": "SZX", shenzhen: "SZX",
        "香港": "HKG", "hong kong": "HKG",
        "北京": "BJS", beijing: "BJS",
        "新加坡": "SIN", singapore: "SIN",
        "曼谷": "BKK", bangkok: "BKK",
      };
      const destinationAliases: Record<string, string[]> = {
        SHA: ["上海", "shanghai"], SZX: ["深圳", "shenzhen"],
        HKG: ["香港", "hong kong"], BJS: ["北京", "beijing"],
        SIN: ["新加坡", "singapore"], BKK: ["曼谷", "bangkok"],
      };
      const expectedCode = destinationCodes[cleanDestination.toLowerCase()];
      const mismatched = expectedCode && nextItems.some(hotel => {
        if (hotel.cityCode) return hotel.cityCode.toUpperCase() !== expectedCode;
        return !destinationAliases[expectedCode].includes(hotel.city.trim().toLowerCase());
      });
      if (mismatched) {
        throw new Error(english
          ? "Supplier results do not match the requested destination. Display has been blocked."
          : "上游酒店结果与搜索目的地不一致，已阻止展示，请重新搜索");
      }
      setLastSearch(cleanDestination);
      setItems(nextItems);
      setStage("results");
    } catch (caught) {
      if (searchSequence !== searchSequenceRef.current) return;
      setError(caught instanceof Error ? caught.message : english ? "Hotel search failed." : "酒店搜索失败");
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
      if (!products.length) throw new Error(english ? "No live bookable products returned." : "上游未返回实时可订产品");
      setSelectedListing(hotel);
      setRoomOffers(products);
      setSelection(products[0]);
      setStage("detail");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : english ? "Live room search failed." : "实时房型查询失败");
    } finally {
      setHydratingId("");
    }
  };
  useEffect(() => { window.scrollTo({ top: 0, behavior: "auto" }); }, [stage]);
  const searchForm = <form className="search-card glass glass-dark" aria-label={english ? "Hotel search" : "酒店搜索"} noValidate onSubmit={event => { event.preventDefault(); void search(); }}>
    <label className="search-field field-destination"><span>{english ? "Destination / hotel" : "目的地 / 酒店"}</span><div><MapPin size={18} /><input aria-label={english ? "Destination or hotel" : "目的地或酒店"} autoComplete="off" value={destination} onFocus={() => setSuggestionsOpen(true)} onBlur={() => window.setTimeout(() => setSuggestionsOpen(false), 120)} onChange={e => { setDestination(e.target.value); setSuggestionsOpen(true); setError(""); }} onKeyDown={event => { if (event.key === "Escape") setSuggestionsOpen(false); if (event.key === "Enter") { event.preventDefault(); void search(); } }} /></div>
      {suggestionsOpen && <div className="light-popover glass glass-light" role="listbox" aria-label={english ? "Destination suggestions" : "目的地建议"}>
        {suggestions.length ? suggestions.map((item, index) => <button type="button" key={item.name} role="option" aria-selected={index === 0} onMouseDown={event => { event.preventDefault(); setDestination(item.name); setSuggestionsOpen(false); }}><MapPin size={16} /><span><strong>{item.name}</strong><small>{item.detail}</small></span></button>) : <p className="suggestion-empty">{english ? `Press Enter to search “${destination.trim()}”` : `按回车直接搜索“${destination.trim()}”`}</p>}
      </div>}
    </label>
    <label className="search-field"><span>{english ? "Check-in" : "入住日期"}</span><div><CalendarDays size={18} /><input aria-label={english ? "Check-in date" : "入住日期"} type="date" min={localDateValue(new Date())} value={checkIn} onChange={e => { const next = e.target.value; setCheckIn(next); setError(""); if (checkOut && checkOut <= next) { const following = new Date(`${next}T00:00:00`); following.setDate(following.getDate() + 1); setCheckOut(localDateValue(following)); } }} /></div></label>
    <label className="search-field"><span>{english ? "Check-out" : "退房日期"}</span><div><CalendarDays size={18} /><input aria-label={english ? "Check-out date" : "退房日期"} type="date" min={checkIn} value={checkOut} onChange={e => { setCheckOut(e.target.value); setError(""); }} /></div></label>
    <div className="search-field occupancy-field"><span>{english ? "Rooms and guests" : "房间与住客"}</span><button type="button" className="field-button" onClick={() => setOccupancyOpen(value => !value)} aria-expanded={occupancyOpen}><Users size={18} />{english ? `${rooms} room${rooms > 1 ? "s" : ""} · ${adults} adult${adults > 1 ? "s" : ""}${children ? ` · ${children} child${children > 1 ? "ren" : ""}` : ""}` : `${rooms}间 · ${adults}位成人${children ? ` · ${children}名儿童` : ""}`}<ChevronDown size={15} /></button>
      {occupancyOpen && <div className="light-popover traveler-popover glass glass-light" role="dialog" aria-label={english ? "Select rooms and guests" : "选择房间与住客"}>
        <div><span><strong>{english ? "Rooms" : "房间"}</strong><small>{english ? "Up to 8 rooms" : "最多 8 间"}</small></span><div className="counter"><button type="button" onClick={() => setRooms(Math.max(1, rooms - 1))} disabled={rooms === 1} aria-label={english ? "Remove room" : "减少房间"}><Minus size={15} /></button><b>{rooms}</b><button type="button" onClick={() => { const next = Math.min(8, rooms + 1); setRooms(next); setAdults(current => Math.max(current, next)); }} disabled={rooms === 8} aria-label={english ? "Add room" : "增加房间"}><Plus size={15} /></button></div></div>
        <div><span><strong>{english ? "Adults" : "成人"}</strong><small>{english ? "At least 1 per room" : "每间至少 1 位"}</small></span><div className="counter"><button type="button" onClick={() => setAdults(Math.max(rooms, adults - 1))} disabled={adults === rooms} aria-label={english ? "Remove adult" : "减少成人"}><Minus size={15} /></button><b>{adults}</b><button type="button" onClick={() => setAdults(Math.min(16, adults + 1))} disabled={adults === 16} aria-label={english ? "Add adult" : "增加成人"}><Plus size={15} /></button></div></div>
        <div><span><strong>{english ? "Children" : "儿童"}</strong><small>{english ? "Age 0–17; ages are sent to G-Link" : "0–17岁，年龄将传给 G-Link"}</small></span><div className="counter"><button type="button" onClick={() => { setChildren(current => Math.max(0, current - 1)); setChildAges(current => current.slice(0, -1)); }} disabled={children === 0} aria-label={english ? "Remove child" : "减少儿童"}><Minus size={15} /></button><b>{children}</b><button type="button" onClick={() => { if (children >= 8) return; setChildren(current => current + 1); setChildAges(current => [...current, 8]); }} disabled={children === 8} aria-label={english ? "Add child" : "增加儿童"}><Plus size={15} /></button></div></div>
        {childAges.length > 0 && <div className="child-age-grid" aria-label={english ? "Children ages" : "儿童年龄"}>{childAges.map((age, index) => <label key={index}><span>{english ? `Child ${index + 1} age` : `儿童 ${index + 1} 年龄`}</span><select value={age} onChange={event => setChildAges(current => current.map((item, ageIndex) => ageIndex === index ? Number(event.target.value) : item))}>{Array.from({ length: 18 }, (_, value) => <option key={value} value={value}>{english ? `${value} year${value === 1 ? "" : "s"}` : `${value}岁`}</option>)}</select></label>)}</div>}
        <button type="button" className="popover-done" onClick={() => setOccupancyOpen(false)}>{english ? "Done" : "完成"}</button>
      </div>}
    </div>
    <button type="submit" className="primary search-cta" disabled={loading} aria-busy={loading}>{loading ? <><LoaderCircle className="spinner" size={18} />{english ? "Searching" : "正在搜索"}</> : <><Search size={18} />{english ? "Search hotels" : "搜索酒店"}</>}</button>
    {error && <div className="search-inline-error" role="alert"><CircleHelp size={16} /><span>{error}</span><button type="button" onClick={() => void search()}>{english ? "Retry" : "重试"}</button></div>}
  </form>;
  if (selection && roomOffers.length && stage === "detail") return <HotelDetail offers={roomOffers} favorite={Boolean(selectedListing && favoriteHotels.some(item => item.id === selectedListing.id))} favoriteBusy={favoriteBusyId === selectedListing?.id} onToggleFavorite={() => { if (selectedListing) void toggleFavorite(selectedListing); }} authenticated={authenticated} onLoginRequired={onLoginRequired} onBack={() => setStage("results")} onCheckout={(selectedOffer, availability) => { setSelection({ ...selectedOffer, ...availability, totalPrice: availability.price, currency: availability.currency }); setStage("checkout"); }} />;
  if (selection && stage === "checkout") return <HotelCheckout offer={selection} onBack={() => setStage("detail")} onComplete={created => { setOrder(created); setStage("result"); }} />;
  if (order && stage === "result") return <BookingResult order={order} type="hotel" onDetails={() => setStage("orderDetail")} onRestart={() => { setSelection(undefined); setRoomOffers([]); setSelectedListing(undefined); setOrder(undefined); setStage("home"); }} />;
  if (order && stage === "orderDetail") return <OrderDetailView initialOrder={order} locale={locale} onOrderChange={setOrder} onBack={() => setStage("result")} onRestart={() => { setSelection(undefined); setRoomOffers([]); setSelectedListing(undefined); setOrder(undefined); setStage("home"); }} />;
  if (stage === "home") return (
      <>
        <section className={`travel-hero hotel-hero ${suggestionsOpen ? "destination-popover-open" : ""}`}>
          <div className="hero-copy"><p className="eyebrow">STAY SOMEWHERE REMARKABLE</p><h1>{english ? <>Every destination,<br />a new perspective</> : <>住进目的地的<br />每一种风景</>}</h1><p>{english ? "Connect to G-Link live global hotel inventory and find the right stay for every journey." : "连接 G-Link 全球酒店实时库存，为每一次出发找到理想住所。"}</p></div>
          {searchForm}
        </section>
        <section className="hotel-home-favorites glass glass-light" aria-labelledby="hotel-home-favorites-title" aria-busy={favoritesLoading}>
          <div className="hotel-home-favorites-heading">
            <div><span className="favorite-section-icon"><Heart size={18} fill="currentColor" /></span><div><p className="eyebrow">SAVED STAYS</p><h2 id="hotel-home-favorites-title">{english ? "My favorite hotels" : "我的个人收藏酒店"}</h2><p>{english ? "Your saved hotel list. Availability and prices are confirmed live when you search again." : "你的个人酒店偏好；重新查询时将实时确认房态与价格。"}</p></div></div>
            {authenticated && favoriteHotels.length > 0 && <span className="favorite-count">{favoriteHotels.length} {english ? "saved" : "家收藏"}</span>}
          </div>
          {favoritesLoading ? <div className="favorite-hotel-grid" aria-hidden="true">{[1, 2, 3, 4].map(item => <div className="favorite-hotel-card skeleton-card" key={item} />)}</div>
            : !authenticated ? <div className="favorite-empty"><Heart size={22} /><div><strong>{english ? "Sign in to see your favorite hotels" : "登录后查看你的收藏酒店"}</strong><span>{english ? "Favorites stay linked to your personal FusionGo account." : "收藏记录会保存在你的 FusionGo 个人账户中。"}</span></div><button className="primary" onClick={onLoginRequired}>{english ? "Sign in" : "立即登录"}</button></div>
              : favoriteHotels.length ? <div className="favorite-hotel-grid">{favoriteHotels.map(hotel => <article className="favorite-hotel-card hotel-home-favorite-card" key={hotel.id}>
                {hotel.image ? <img src={hotel.image} alt="" /> : <div className="favorite-image-placeholder"><Building2 size={22} /></div>}
                <div><span className="favorite-mark"><Heart size={13} fill="currentColor" />{english ? "Saved" : "已收藏"}</span><h3 title={hotel.name}>{hotel.name}</h3><p>{[hotel.city, hotel.district].filter(Boolean).join(" · ") || (english ? "Location not supplied" : "上游未提供位置")}</p><div className="favorite-card-actions"><button className="secondary" onClick={() => { setDestination(hotel.name); void search(hotel.name); }}>{english ? "Search live rates" : "查询实时房价"}</button><button className="favorite-remove" onClick={() => void toggleFavorite(hotel)} disabled={favoriteBusyId === hotel.id} aria-label={english ? `Remove ${hotel.name} from favorites` : `取消收藏${hotel.name}`}><Heart size={15} fill="currentColor" /></button></div></div>
              </article>)}</div>
                : <div className="favorite-empty"><Heart size={22} /><div><strong>{english ? "No favorite hotels yet" : "还没有收藏酒店"}</strong><span>{english ? "Use the heart button in hotel results or details to save a property here." : "在酒店搜索结果或详情页点击心形按钮，收藏后会显示在这里。"}</span></div></div>}
        </section>
      </>
  );
  return (
    <section className="booking-flow-page search-results-page" ref={resultsRef}>
      <button className="back-link" onClick={() => setStage("home")}><ArrowLeft size={17} />{english ? "Back to hotel search" : "返回酒店查询"}</button>
      <BookingProgress current={1} labels={english ? ["Search", "Results", "Hotel details", "Payment", "Confirmation", "Booking details"] : ["查询", "搜索结果", "酒店详情", "下单支付", "预订确认", "订单详情"]} />
      <div className="compact-search-shell">{searchForm}</div>
      <section className="results-stage" ref={resultsRef} aria-busy={loading}>
        <div className="result-heading"><div><p className="eyebrow">CURATED STAYS</p><h2>{english ? `Hotels in ${lastSearch}` : `${lastSearch}的酒店`}</h2><p aria-live="polite">{loading ? english ? "Loading live hotel availability…" : "正在获取实时酒店列表…" : error ? english ? "Search incomplete. Adjust the criteria and try again." : "搜索未完成，请修改条件后重试" : english ? `${visibleHotels.length} properties match · Live room and price confirmation on the details page` : `${visibleHotels.length} 家酒店匹配 · 房型与价格进入详情实时确认`}</p></div><div className="sort-actions"><button className="secondary mobile-filter-button" onClick={() => setFiltersOpen(true)} aria-haspopup="dialog"><SlidersHorizontal size={15} />{english ? "Filters" : "筛选"}{activeFilterCount > 0 && <b>{activeFilterCount}</b>}</button><button className={`secondary ${mapOpen ? "active" : ""}`} onClick={() => setMapOpen(value => !value)} aria-pressed={mapOpen}><MapPin size={15} />{mapOpen ? english ? "List" : "列表" : english ? "Map" : "地图"}</button><select className="secondary sort-select" aria-label={english ? "Hotel sort" : "酒店排序"} value={hotelSort} onChange={event => setHotelSort(event.target.value as typeof hotelSort)} disabled={loading || items.length === 0}><option value="recommended">{english ? "Recommended" : "推荐排序"}</option><option value="price">{english ? "Price: low to high" : "价格从低到高"}</option><option value="rating">{english ? "Guest rating" : "评分从高到低"}</option></select></div></div>
        {mapOpen && <div className="hotel-map glass glass-light" role="region" aria-label="酒店地图"><div className="map-grid" />{visibleHotels.slice(0, 6).map((hotel, index) => <button key={hotel.id} style={{ left: `${12 + (index % 3) * 34}%`, top: `${18 + Math.floor(index / 3) * 42}%` }} onClick={() => void chooseHotel(hotel)}><MapPin size={14} />{money(hotel.nightlyPrice, hotel.currency)}</button>)}</div>}
        <div className="result-with-filters">
          {filtersOpen && <button className="filter-drawer-backdrop" aria-label={english ? "Close filters" : "关闭筛选"} onClick={() => setFiltersOpen(false)} />}
          <aside className={`filter-panel glass glass-light ${filtersOpen ? "open" : ""}`} aria-label={english ? "Hotel filters" : "酒店筛选"}>
            <div className="filter-panel-head"><div><h3>{english ? "Filter properties" : "筛选酒店"}{activeFilterCount > 0 && <span>{activeFilterCount}</span>}</h3><p>{english ? "Narrow results instantly" : "筛选条件即时生效"}</p></div><button className="filter-panel-close" onClick={() => setFiltersOpen(false)} aria-label={english ? "Close filters" : "关闭筛选"}><X size={17} /></button></div>
            <label className="filter-search"><Search size={15} /><input value={hotelNameQuery} onChange={event => setHotelNameQuery(event.target.value)} placeholder={english ? "Hotel name or keyword" : "酒店名称或关键词"} aria-label={english ? "Search within results" : "在结果中搜索"} /></label>
            <div className="filter-group">
              <div className="filter-group-title"><strong>{english ? "Nightly budget" : "每晚预算"}</strong><span>{money(maxPrice, displayCurrency)}</span></div>
              <input type="range" min={budget.min} max={budget.max} step={budget.step} value={maxPrice} onChange={event => setMaxPrice(Number(event.target.value))} aria-label={english ? "Maximum nightly price" : "每晚最高价格"} />
              <div className="price-shortcuts">{budget.shortcuts.map(price => <button key={price} className={maxPrice === price ? "active" : ""} onClick={() => setMaxPrice(price)}>{price === budget.max ? english ? "Any" : "不限" : `≤ ${money(price, displayCurrency)}`}</button>)}</div>
            </div>
            <div className="filter-group"><div className="filter-group-title"><strong>{english ? "Star rating" : "酒店星级"}</strong></div>{[5, 4, 3, 2].map(star => { const count = items.filter(hotel => hotel.stars === star).length; return <label className="filter-option" key={star}><input type="checkbox" checked={starFilters.includes(star)} disabled={count === 0} onChange={event => setStarFilters(current => event.target.checked ? [...current, star] : current.filter(value => value !== star))} /><span>{star} {english ? "stars" : "星级"}</span><small>{count}</small></label>; })}</div>
            <div className="filter-group"><div className="filter-group-title"><strong>{english ? "Guest rating" : "住客评分"}</strong></div>{[[0, english ? "Any rating" : "不限"], [4.5, english ? "Exceptional 4.5+" : "卓越 4.5+"], [4, english ? "Very good 4.0+" : "很好 4.0+"], [3.5, english ? "Good 3.5+" : "不错 3.5+"]] .map(([rating, label]) => <label className="filter-option" key={rating}><input type="radio" name="hotel-rating" checked={minRating === rating} onChange={() => setMinRating(Number(rating))} /><span>{label}</span><small>{Number(rating) === 0 ? items.length : items.filter(hotel => hotel.rating !== undefined && hotel.rating >= Number(rating)).length}</small></label>)}</div>
            <div className="filter-group"><div className="filter-group-title"><strong>{english ? "Popular choices" : "热门条件"}</strong></div><label className="filter-option"><input type="checkbox" checked={breakfastOnly} disabled={breakfastCount === 0} onChange={event => setBreakfastOnly(event.target.checked)} /><span>{english ? "Breakfast included" : "含早餐"}</span><small>{breakfastCount}</small></label><label className="filter-option"><input type="checkbox" checked={freeCancellationOnly} disabled={freeCancellationCount === 0} onChange={event => setFreeCancellationOnly(event.target.checked)} /><span>{english ? "Free cancellation" : "免费取消"}</span><small>{freeCancellationCount}</small></label></div>
            {!!districtOptions.length && <div className="filter-group"><div className="filter-group-title"><strong>{english ? "Area" : "区域位置"}</strong></div>{districtOptions.map(({ district, count }) => <label className="filter-option" key={district}><input type="checkbox" checked={districtFilters.includes(district)} onChange={event => setDistrictFilters(current => event.target.checked ? [...current, district] : current.filter(value => value !== district))} /><span>{district}</span><small>{count}</small></label>)}</div>}
            <div className="filter-group"><div className="filter-group-title"><strong>{english ? "Bed preference" : "床型偏好"}</strong></div>{bedTypeOptions.map(({ value, label, count }) => <label className="filter-option" key={value}><input type="radio" name="bed-type" checked={bedType === value} disabled={value !== "" && count === 0} onChange={() => setBedType(value)} /><span>{label}</span><small>{count}</small></label>)}</div>
            <div className="filter-group"><div className="filter-group-title"><strong>{english ? "Amenities and features" : "设施与特色"}</strong></div>{amenityOptions.map(({ tag, count }) => <label className="filter-option" key={tag}><input type="checkbox" checked={amenityFilters.includes(tag)} disabled={count === 0} onChange={event => setAmenityFilters(current => event.target.checked ? [...current, tag] : current.filter(value => value !== tag))} /><span>{english ? ({ "免费停车": "Free parking", "地铁直达": "Metro access", "亲子友好": "Family friendly", "室内泳池": "Indoor pool", "健身中心": "Fitness center", "行政酒廊": "Executive lounge", "外滩景观": "Bund view", "设计酒店": "Design hotel", "新开业": "Newly opened" } as Record<string, string>)[tag] || tag : tag}</span><small>{count}</small></label>)}</div>
            <button className="filter-clear" onClick={clearHotelFilters} disabled={activeFilterCount === 0}>{english ? "Clear all filters" : "清除全部筛选"}</button>
          </aside>
        <div className="result-list" aria-live="polite">
        {loading ? [1,2,3].map(item => <div className="hotel-card skeleton-card" key={item} aria-hidden="true" />) : visibleHotels.length ? visibleHotels.map(hotel => <article className="hotel-card" key={hotel.id}>
          {hotel.image ? <img src={hotel.image} alt="" /> : <div className="hotel-image-placeholder card"><Building2 size={28} /><span>{english ? "No supplier image" : "上游未提供图片"}</span></div>}
          <div className="hotel-info"><div className="hotel-top"><div>{hotel.stars !== undefined && <span className="stars">{"★".repeat(hotel.stars)}</span>}<h3>{hotel.name}</h3>{hotel.district && <p>{hotel.district}</p>}</div><div className="hotel-card-actions"><button className={`favorite-button ${favoriteHotels.some(item => item.id === hotel.id) ? "active" : ""}`} onClick={() => void toggleFavorite(hotel)} disabled={favoriteBusyId === hotel.id} aria-pressed={favoriteHotels.some(item => item.id === hotel.id)} aria-label={favoriteHotels.some(item => item.id === hotel.id) ? `取消收藏${hotel.name}` : `收藏${hotel.name}`}><Heart size={17} fill={favoriteHotels.some(item => item.id === hotel.id) ? "currentColor" : "none"} /></button>{hotel.rating !== undefined && <span className="rating"><strong>{hotel.rating}</strong>{english ? "Supplier rating" : "上游评分"}{hotel.ratingSource && <small>{english ? "Source" : "来源"}：{hotel.ratingSource}</small>}</span>}</div></div>
          <div className="tags">{hotel.tags.map((tag, index) => <span key={`${tag}-${index}`}>{tag}</span>)}</div>
          <div className="room-line"><div><strong>{hotel.roomName}</strong><span>{hotel.breakfast} · {hotel.cancelPolicy}</span></div><div className="price"><small>每晚含税</small><strong>{hotel.nightlyPrice ? money(hotel.nightlyPrice, hotel.currency) : "实时查询"}</strong><span>{hotel.nightlyPrice ? `${hotel.nights || 1}晚 × ${hotel.roomNum || 1}间，共 ${money(hotel.totalPrice ?? hotel.nightlyPrice * (hotel.nights || 1) * (hotel.roomNum || 1), hotel.currency)}` : "进入详情获取准确价格"}</span></div><button className="primary" onClick={() => chooseHotel(hotel)} disabled={hydratingId === hotel.id}>{hydratingId === hotel.id ? <><LoaderCircle className="spinner" size={16} />查询实时产品</> : "查看房型"}</button></div></div>
        </article>) : hasSearched && !error ? <div className="hotel-empty-state glass glass-light"><div><Building2 size={28} /></div><h3>{english ? "No properties match these filters" : "暂无符合条件的酒店"}</h3><p>{items.length ? english ? "Clear or relax one or more filters to see additional properties." : "请清除或放宽部分筛选条件。" : english ? "Try another destination or date. Sandbox availability must also be configured for this account." : "尝试更换目的地或日期。沙箱环境还需要为当前账号配置可售测试酒店与未来房态。"}</p><button className="primary" onClick={() => { if (items.length) clearHotelFilters(); else setDestination(english ? "Hong Kong" : "香港"); setError(""); window.scrollTo({ top: 0, behavior: "smooth" }); }}>{items.length ? english ? "Clear filters" : "清除筛选" : english ? "Search Hong Kong" : "搜索香港酒店"}</button></div> : null}
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
    <div className={`itinerary-journeys ${journeys.length > 1 ? "multiple" : ""}`}>{journeys.map((journey, index) => <div className="itinerary-route" key={`${journey.date}-${journey.origin}-${journey.destination}`}><div><small>{journeys.length > 1 ? offer.tripType === 2 ? index === 0 ? "去程" : "返程" : `第${index + 1}程` : journey.date}</small><strong>{journey.departureTime}</strong><span>{journey.origin}</span></div><div><small>{journey.date} · {journey.flightNo}</small><i /><span>{journey.duration} · {journey.stops ? `${journey.stops}次中转` : "直飞"}</span></div><div><strong>{journey.arrivalTime}</strong><span>{journey.destination}</span></div></div>)}</div>
    {showFacts && <div className="fare-facts"><span><Luggage size={16} />托运行李 {offer.baggage}</span><span><RefreshCw size={16} />退改以航司规则为准</span><span><Clock3 size={16} />预计出票 1–10 分钟</span></div>}
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
    if (passengers.some(passenger => !englishNamePattern.test(passenger.surname.trim()) || !englishNamePattern.test(passenger.givenName.trim()) || passenger.documentNo.length < 6 || !passenger.birthday || !passenger.expiration || !passenger.nationality || !passenger.issuingCountry) || !englishNamePattern.test(contactSurname.trim()) || !englishNamePattern.test(contactGivenName.trim()) || phone.length < 8 || !email.includes("@")) return setError(tr("请按证件完整填写乘机人与联系人姓、名及联系方式", "Complete every passenger and contact field exactly as shown on the travel documents.", "請依證件完整填寫乘機人與聯絡人的姓、名及聯絡方式"));
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
    if (invalidAge) return setError(tr("乘机人出生日期与成人、儿童或婴儿类型不匹配", "A passenger's date of birth does not match the selected adult, child, or infant type.", "乘機人出生日期與成人、兒童或嬰兒類型不符"));
    const firstAdult = passengers.find(passenger => passenger.type === "adult");
    if (!firstAdult) return setError(tr("至少需要一位成人乘机人", "At least one adult passenger is required.", "至少需要一位成人乘機人"));
    setError("");
    onContinue({ passengers: passengers.map(passenger => passenger.type === "infant" ? { ...passenger, adultPassengerName: `${firstAdult.surname}/${firstAdult.givenName}` } : passenger), contactSurname, contactGivenName, phone, email, baggage, insurance, seat });
  };
  const passengerTypeLabel = (type: "adult" | "child" | "infant") => type === "adult"
    ? tr("成人", "Adult", "成人")
    : type === "child" ? tr("儿童", "Child", "兒童") : tr("婴儿", "Infant", "嬰兒");
  return <section className="booking-flow-page">
    <button className="back-link" onClick={onBack}><ArrowLeft size={17} />返回航班列表</button>
    <BookingProgress current={2} labels={["查询", "航班与票价", "乘机人", "支付", "出票确认", "订单详情"]} />
    <header className="flow-heading"><p className="eyebrow">PASSENGER & EXTRAS</p><h1>填写乘机人与联系人</h1><p>票价已锁定 14 分钟，姓名和证件必须与旅行证件完全一致。</p></header>
    <div className="checkout-layout"><div className="checkout-main">
      <FlightItineraryCard offer={offer} badge={<span className="verified-badge"><ShieldCheck size={15} />运价已验证</span>} showFacts />
      <section className="form-section glass glass-light"><div className="section-title"><span>1</span><div><h2>乘机人信息</h2><p>英文姓名必须与旅行证件一致</p></div></div>
        {passengers.map((passenger, index) => <div className="passenger-block" key={index}><strong>{passengerTypeLabel(passenger.type)} {passengers.slice(0, index + 1).filter(item => item.type === passenger.type).length}</strong><div className="form-grid">
          <label><span>英文姓 / Surname</span><div className="light-field"><UserRound size={17} /><input aria-label={`乘机人${index + 1}英文姓`} value={passenger.surname} onChange={event => updatePassenger(index, "surname", event.target.value.toUpperCase())} /></div><small>例如 LIN</small></label>
          <label><span>英文名 / Given name</span><div className="light-field"><UserRound size={17} /><input aria-label={`乘机人${index + 1}英文名`} value={passenger.givenName} onChange={event => updatePassenger(index, "givenName", event.target.value.toUpperCase())} /></div><small>例如 JIACHENG</small></label>
          <label><span>证件类型</span><select value={passenger.idType} onChange={event => updatePassenger(index, "idType", event.target.value)}><option value="2">护照</option><option value="3">港澳通行证</option><option value="1">身份证</option></select></label>
          <label><span>证件号码</span><div className="light-field"><FileText size={17} /><input value={passenger.documentNo} onChange={event => updatePassenger(index, "documentNo", event.target.value.toUpperCase())} /></div></label>
          <label><span>国籍</span><NationalitySelect ariaLabel={`乘机人${index + 1}国籍`} value={passenger.nationality} onChange={value => updatePassenger(index, "nationality", value)} locale={locale} catalog={nationalityCatalog} error={nationalityError} /></label>
          <label><span>护照签发国家/地区</span><NationalitySelect ariaLabel={`乘机人${index + 1}护照签发国家或地区`} value={passenger.issuingCountry} onChange={value => updatePassenger(index, "issuingCountry", value)} locale={locale} catalog={nationalityCatalog} error={nationalityError} /></label>
          <label><span>性别</span><select value={passenger.gender} onChange={event => updatePassenger(index, "gender", event.target.value)}><option value="1">男</option><option value="2">女</option></select></label>
          <label><span>出生日期</span><input type="date" value={passenger.birthday} onChange={event => updatePassenger(index, "birthday", event.target.value)} /></label>
          <label><span>证件有效期</span><input type="date" value={passenger.expiration} onChange={event => updatePassenger(index, "expiration", event.target.value)} /></label>
        </div></div>)}
      </section>
      <section className="form-section glass glass-light"><div className="section-title"><span>2</span><div><h2>联系人与通知</h2><p>航变、出票及退改信息会发送至以下联系方式</p></div></div><div className="form-grid">
        <label><span>联系人英文姓 / Surname</span><div className="light-field"><UserRound size={17} /><input autoComplete="family-name" value={contactSurname} onChange={event => { setContactSurname(event.target.value.toUpperCase()); setError(""); }} /></div></label>
        <label><span>联系人英文名 / Given name</span><div className="light-field"><UserRound size={17} /><input autoComplete="given-name" value={contactGivenName} onChange={event => { setContactGivenName(event.target.value.toUpperCase()); setError(""); }} /></div></label>
        <label><span>手机号码</span><div className="light-field"><Phone size={17} /><input value={phone} onChange={event => { setPhone(event.target.value); setError(""); }} /></div></label>
        <label><span>电子邮箱</span><div className="light-field"><Mail size={17} /><input type="email" value={email} onChange={event => { setEmail(event.target.value); setError(""); }} /></div></label>
      </div></section>
      <section className="form-section glass glass-light"><div className="section-title"><span>3</span><div><h2>增值服务</h2><p>仅展示已接入并可真实履约的产品；当前均未开通</p></div></div><div className="addon-list">
        <label className="disabled" aria-disabled="true"><input type="checkbox" checked={baggage} onChange={() => setBaggage(false)} disabled /><Luggage size={19} /><span><strong>额外托运行李</strong><small>尚未接入航司付费行李接口</small></span><b>待开通</b></label>
        <label className="disabled" aria-disabled="true"><input type="checkbox" checked={seat} onChange={() => setSeat(false)} disabled /><UserRound size={19} /><span><strong>提前选座</strong><small>尚未接入航司选座接口</small></span><b>待开通</b></label>
        <label className="disabled" aria-disabled="true"><input type="checkbox" checked={insurance} onChange={() => setInsurance(false)} disabled /><ShieldCheck size={19} /><span><strong>航班保障</strong><small>尚未接入保险产品及履约协议</small></span><b>待开通</b></label>
      </div></section>
    </div><aside className="price-summary glass glass-light">
      <p className="eyebrow">REVIEW DETAILS</p><h2>下一步核对并支付</h2><div className="summary-detail"><span>{offer.journeys?.length ? offer.journeys.map(journey => journey.origin).concat(offer.journeys.at(-1)?.destination || "").filter(Boolean).join(offer.tripType === 2 ? " ↔ " : " → ") : `${offer.departureAirport.split(" ")[0]} → ${offer.arrivalAirport.split(" ")[0]}`}</span><span>{offer.flightNo} · {passengers.length}位旅客</span><span>{offer.cabin} · {offer.baggage}</span></div>
      <p className="policy-note"><ShieldCheck size={16} />priceKey 已验证，票价将在支付页再次校验</p>{error && <p className="error-copy" role="alert">{error}</p>}
      <button className="primary pay-button" onClick={next}>下一步：核对与支付<ChevronRight size={17} /></button><small className="secure-copy">进入支付页前不会创建上游订单</small>
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
    } catch (caught) { setError(caught instanceof Error ? caught.message : "支付或出票受理失败，请重新验价"); }
    finally { setLoading(false); }
  };
  return <section className="booking-flow-page">
    <button className="back-link" onClick={onBack}><ArrowLeft size={17} />返回乘机人信息</button>
    <BookingProgress current={3} labels={["查询", "航班与票价", "乘机人", "支付", "出票确认", "订单详情"]} />
    <header className="flow-heading"><p className="eyebrow">REVIEW & PAYMENT</p><h1>核对订单并完成支付</h1><p>请重点核对乘机人姓名、证件、航班时间和退改签规则。</p></header>
    <div className="checkout-layout"><div className="checkout-main">
      <FlightItineraryCard offer={offer} badge={<span className="verified-badge"><Clock3 size={15} />剩余 13:42</span>} />
      <section className="form-section glass glass-light"><div className="section-title"><span>1</span><div><h2>乘机人与联系信息</h2><p>共 {draft.passengers.length} 位旅客（成人 {counts.adults}、儿童 {counts.children}、婴儿 {counts.infants}）</p></div></div><div className="review-list">{draft.passengers.map((passenger, index) => <div key={passenger.documentNo}><span><strong>{passenger.type === "adult" ? "成人" : passenger.type === "child" ? "儿童" : "婴儿"} {index + 1} · {passenger.surname} / {passenger.givenName}</strong><small>{passenger.idType === "2" ? "护照" : "旅行证件"} {passenger.documentNo} · {passenger.nationality}签发 · 有效期 {passenger.expiration}</small></span><CheckCircle2 size={18} /></div>)}<div><span><strong>{draft.contactSurname} / {draft.contactGivenName}</strong><small>{draft.phone} · {draft.email}</small></span><CheckCircle2 size={18} /></div></div></section>
      <section className="form-section glass glass-light"><div className="section-title"><span>2</span><div><h2>支付方式</h2><p>支付成功后自动向 F-Link 发起出票</p></div></div>
        <label className={`payment-option ${paymentMethod === "credit" ? "selected" : ""}`}><input type="radio" checked={paymentMethod === "credit"} onChange={() => setPaymentMethod("credit")} name="flight-payment" /><Landmark size={20} /><span><strong>企业授信账户</strong><small>提交时从业务数据库实时校验可用额度</small></span>{paymentMethod === "credit" && <CheckCircle2 size={19} />}</label>
        <label className="payment-option disabled" aria-disabled="true"><input type="radio" disabled checked={paymentMethod === "card"} onChange={() => undefined} name="flight-payment" /><CreditCard size={20} /><span><strong>银行卡 / 数字钱包</strong><small>当前未接入生产收单渠道，不可选择</small></span></label>
      </section>
    </div><aside className="price-summary glass glass-light"><p className="eyebrow">FARE SUMMARY</p><h2>费用明细</h2><div className="price-lines"><span>F-Link 验价总额 · {totalTravelers}位旅客<b>{money(verifiedTotal, offer.currency)}</b></span><span>税费及燃油费<b>已包含</b></span><span className="total">应付总额<strong>{money(payable, offer.currency)}</strong></span></div><p className="policy-note"><ShieldCheck size={16} />提交时再次执行 F-Link 实时验价并创建订单；未接入的增值服务不计费</p>{error && <p className="error-copy" role="alert">{error}</p>}<button className="primary pay-button" onClick={submit} disabled={loading} aria-busy={loading}>{loading ? <><LoaderCircle className="spinner" size={18} />创建订单并支付</> : <><LockKeyhole size={17} />确认支付 {money(payable, offer.currency)}</>}</button><small className="secure-copy">提交即表示同意运价、退改签与隐私条款</small></aside></div>
  </section>;
}

function FlightSearch({ locale, authenticated, onLoginRequired }: { locale: LocaleCode; authenticated: boolean; onLoginRequired: () => void }) {
  const english = locale === "en";
  const { convert, money } = useDisplayMoney();
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
  const [flightSort, setFlightSort] = useState<"price" | "departure">("price");
  const [pageNumber, setPageNumber] = useState(1);
  const pageSize = 20;
  const travelerCount = adults + children + infants;
  const flightTotal = useCallback((flight: FlightOffer) => flight.totalPrice ?? flight.price * travelerCount, [travelerCount]);
  const comparableFlightTotal = useCallback((flight: FlightOffer) => convert(flightTotal(flight), flight.currency) ?? flightTotal(flight), [convert, flightTotal]);
  const visibleFlights = useMemo(() => [...items]
    .filter(flight => (!directOnly || flight.stops === 0) && (!baggageOnly || !/0件|无/.test(flight.baggage)))
    .sort((a, b) => flightSort === "price"
      ? comparableFlightTotal(a) - comparableFlightTotal(b)
      : a.departureTime.localeCompare(b.departureTime)), [baggageOnly, comparableFlightTotal, directOnly, flightSort, items]);
  const lowestVisibleFlight = useMemo(() => visibleFlights.reduce<FlightOffer | undefined>((lowest, flight) =>
    !lowest || comparableFlightTotal(flight) < comparableFlightTotal(lowest) ? flight : lowest, undefined), [comparableFlightTotal, visibleFlights]);
  const totalPages = Math.max(1, Math.ceil(visibleFlights.length / pageSize));
  const pagedFlights = visibleFlights.slice((pageNumber - 1) * pageSize, pageNumber * pageSize);
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
      return setError(english ? "Complete the origin, destination, and date for every journey." : "请填写每一段行程的出发地、目的地和日期");
    }
    if (journeys.some(journey => journey.origin === journey.destination)) {
      return setError(english ? "Origin and destination must be different." : "同一航段的出发地和目的地不能相同");
    }
    if (tripType === "roundtrip" && returnDate < date) {
      return setError(english ? "The return date cannot be earlier than departure." : "返程日期不能早于去程日期");
    }
    if (tripType === "multicity"
      && journeys.some((journey, index) => index > 0 && journey.date < journeys[index - 1].date)) {
      return setError(english ? "Multi-city dates must follow journey order." : "多程日期必须按行程顺序递增");
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
      setError(caught instanceof Error ? caught.message : english ? "Flight search failed." : "航班搜索失败");
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
      const message = caught instanceof Error ? caught.message : english ? "Fare verification failed. Search again." : "验价失败，请重新搜索";
      setFareError(message);
      window.requestAnimationFrame(() => fareErrorRef.current?.focus());
    } finally { setVerifyingId(""); }
  };
  const travelerField = <div className="search-field traveler-field"><span>{english ? "Travelers and cabin" : "旅客与舱位"}</span><button className="field-button" onClick={() => setTravelersOpen(value => !value)} aria-expanded={travelersOpen}><UserRound size={18} />{english ? `${adults} adult${adults > 1 ? "s" : ""}${children ? ` · ${children} child${children > 1 ? "ren" : ""}` : ""}${infants ? ` · ${infants} infant${infants > 1 ? "s" : ""}` : ""} · Economy` : `${adults}成人${children ? ` · ${children}儿童` : ""}${infants ? ` · ${infants}婴儿` : ""} · 经济舱`}<ChevronDown size={15} /></button>
    {travelersOpen && <div className="light-popover traveler-popover glass glass-light" role="dialog" aria-label={english ? "Select flight travelers" : "选择机票旅客"}>
      <div><span><strong>{english ? "Adults" : "成人"}</strong><small>{english ? "Age 12 and above" : "12岁及以上"}</small></span><div className="counter"><button onClick={() => { const next = Math.max(1, adults - 1); setAdults(next); setInfants(current => Math.min(current, next)); }} disabled={adults === 1} aria-label={english ? "Remove adult" : "减少成人"}><Minus size={15} /></button><b>{adults}</b><button onClick={() => setAdults(Math.min(9 - children - infants, adults + 1))} disabled={travelerCount >= 9} aria-label={english ? "Add adult" : "增加成人"}><Plus size={15} /></button></div></div>
      <div><span><strong>{english ? "Children" : "儿童"}</strong><small>{english ? "Age 2–11" : "2–11岁"}</small></span><div className="counter"><button onClick={() => setChildren(Math.max(0, children - 1))} disabled={children === 0} aria-label={english ? "Remove child" : "减少儿童"}><Minus size={15} /></button><b>{children}</b><button onClick={() => setChildren(Math.min(8, children + 1))} disabled={travelerCount >= 9} aria-label={english ? "Add child" : "增加儿童"}><Plus size={15} /></button></div></div>
      <div><span><strong>{english ? "Infants" : "婴儿"}</strong><small>{english ? "Under 2 · one per adult" : "未满2岁 · 每位成人限带1名"}</small></span><div className="counter"><button onClick={() => setInfants(Math.max(0, infants - 1))} disabled={infants === 0} aria-label={english ? "Remove infant" : "减少婴儿"}><Minus size={15} /></button><b>{infants}</b><button onClick={() => setInfants(Math.min(adults, infants + 1))} disabled={travelerCount >= 9 || infants >= adults} aria-label={english ? "Add infant" : "增加婴儿"}><Plus size={15} /></button></div></div>
      <button className="popover-done" onClick={() => setTravelersOpen(false)}>{english ? "Done" : "完成"}</button></div>}
  </div>;
  const searchButton = <button className="primary search-cta" onClick={() => void search()} disabled={loading} aria-busy={loading}>{loading ? <><LoaderCircle className="spinner" size={18} />{english ? "Searching" : "搜索中"}</> : <><Search size={18} />{english ? "Search flights" : "搜索航班"}</>}</button>;
  const searchForm = tripType === "multicity"
    ? <section className="search-card flight-search multicity-search glass glass-dark" aria-label={english ? "Multi-city flight search" : "多程机票搜索"}>
      <div className="multi-segment-list">
        {multiSegments.map((segment, index) => <div className="multi-segment-row" key={`${index}-${segment.date}`}>
          <b>{english ? `Journey ${index + 1}` : `第 ${index + 1} 程`}</b>
          <label className="search-field"><span>{english ? "From" : "出发地"}</span><div><Plane size={17} /><input aria-label={english ? `Journey ${index + 1} origin` : `第${index + 1}程出发地`} value={segment.origin} onChange={event => updateMultiSegment(index, "origin", event.target.value)} /></div></label>
          <label className="search-field"><span>{english ? "To" : "目的地"}</span><div><MapPin size={17} /><input aria-label={english ? `Journey ${index + 1} destination` : `第${index + 1}程目的地`} value={segment.destination} onChange={event => updateMultiSegment(index, "destination", event.target.value)} /></div></label>
          <label className="search-field"><span>{english ? "Departure date" : "出发日期"}</span><div><CalendarDays size={17} /><input aria-label={english ? `Journey ${index + 1} departure date` : `第${index + 1}程出发日期`} type="date" min={index === 0 ? localDateValue(new Date()) : multiSegments[index - 1].date} value={segment.date} onChange={event => updateMultiSegment(index, "date", event.target.value)} /></div></label>
          <button className="segment-remove" aria-label={english ? `Remove journey ${index + 1}` : `删除第${index + 1}程`} onClick={() => setMultiSegments(current => current.filter((_, segmentIndex) => segmentIndex !== index))} disabled={multiSegments.length === 2}><X size={16} /></button>
        </div>)}
      </div>
      <div className="multi-search-actions">
        <button className="add-segment" onClick={() => setMultiSegments(current => current.length >= 4 ? current : [...current, {
          origin: current.at(-1)?.destination || "",
          destination: "",
          date: current.at(-1)?.date || departureDate,
        }])} disabled={multiSegments.length >= 4}><Plus size={16} />{english ? "Add journey" : "添加一程"}</button>
        {travelerField}
        {searchButton}
      </div>
      {error && stage === "home" && <div className="search-inline-error" role="alert"><CircleHelp size={16} /><span>{error}</span></div>}
    </section>
    : <section className={`search-card flight-search ${tripType === "roundtrip" ? "roundtrip-search" : ""} glass glass-dark`} aria-label={tripType === "roundtrip" ? english ? "Round-trip flight search" : "往返机票搜索" : english ? "One-way flight search" : "单程机票搜索"}>
      <label className="search-field"><span>{english ? "From" : "出发地"}</span><div><Plane size={18} /><input aria-label={english ? "Origin" : "出发地"} value={from} onChange={e => { setFrom(e.target.value.toUpperCase()); setError(""); }} /></div></label>
      <button className="route-swap" aria-label={english ? "Swap origin and destination" : "交换出发地和目的地"} onClick={() => { setFrom(to); setTo(from); }}><RefreshCw size={16} /></button>
      <label className="search-field"><span>{english ? "To" : "目的地"}</span><div><MapPin size={18} /><input aria-label={english ? "Destination" : "目的地"} value={to} onChange={e => { setTo(e.target.value.toUpperCase()); setError(""); }} /></div></label>
      <label className="search-field"><span>{english ? "Departure date" : "出发日期"}</span><div><CalendarDays size={18} /><input aria-label={english ? "Departure date" : "出发日期"} type="date" min={localDateValue(new Date())} value={departureDate} onChange={e => { const next = e.target.value; setDepartureDate(next); setError(""); if (returnDate < next) setReturnDate(next); }} /></div></label>
      {tripType === "roundtrip" && <label className="search-field"><span>{english ? "Return date" : "返程日期"}</span><div><CalendarDays size={18} /><input aria-label={english ? "Return date" : "返程日期"} type="date" value={returnDate} min={departureDate} onChange={e => { setReturnDate(e.target.value); setError(""); }} /></div></label>}
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
        <div className="hero-copy"><p className="eyebrow">THE WORLD IS CLOSER</p><h1>{english ? <>Your next journey,<br />on your terms</> : <>下一站，<br />由你定义</>}</h1><p>{english ? "Connect to F-Link live global fares for search, verification, ticketing, changes, and refunds in one place." : "连接 F-Link 全球实时运价，搜索、验价、出票与退改签一站完成。"}</p></div>
        <div className="trip-tabs glass glass-dark" aria-label={english ? "Trip type" : "行程类型"}>
          <button className={tripType === "oneway" ? "active" : ""} aria-pressed={tripType === "oneway"} onClick={() => selectTripType("oneway")}>{english ? "One-way" : "单程"}</button>
          <button className={tripType === "roundtrip" ? "active" : ""} aria-pressed={tripType === "roundtrip"} onClick={() => selectTripType("roundtrip")}>{english ? "Round trip" : "往返"}</button>
          <button className={tripType === "multicity" ? "active" : ""} aria-pressed={tripType === "multicity"} onClick={() => selectTripType("multicity")}>{english ? "Multi-city" : "多程"}</button>
        </div>
        {searchForm}
      </section>
  );
  return (
    <section className="booking-flow-page search-results-page">
      <button className="back-link" onClick={() => setStage("home")}><ArrowLeft size={17} />{english ? "Back to flight search" : "返回机票查询"}</button>
      <BookingProgress current={1} labels={english ? ["Search", "Flights and fares", "Passengers", "Payment", "Ticketing", "Booking details"] : ["查询", "航班与票价", "乘机人", "支付", "出票确认", "订单详情"]} />
      <div className="compact-search-shell">{searchForm}</div>
      <section className="results-stage">
      {error && <div className="error-banner" role="alert">{error}<button onClick={() => void search()}>重新搜索</button></div>}
      {tripType === "oneway" && <div className="low-fare-strip glass glass-light">{[-2,-1,0,1,2].map(offset => {
        const date = new Date(`${departureDate}T00:00:00`);
        date.setDate(date.getDate() + offset);
        const iso = localDateValue(date);
        return <button className={offset === 0 ? "active" : ""} aria-pressed={offset === 0} key={iso} onClick={() => void search(iso)} disabled={loading || iso < localDateValue(new Date())}><span>{new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric" }).format(date)}</span><strong>{offset === 0 && lowestVisibleFlight ? money(flightTotal(lowestVisibleFlight), lowestVisibleFlight.currency) : english ? "Check live fare" : "查询实时价"}</strong></button>;
      })}</div>}
      <div className="result-heading"><div><p className="eyebrow">LIVE FARES</p><h2>{routeLabel}</h2><p>{tripType === "roundtrip" ? `${departureDate} ${english ? "to" : "至"} ${returnDate}` : tripType === "multicity" ? `${multiSegments.length} ${english ? "journeys" : "段行程"}` : departureDate} · {english ? `${adults} adult${adults > 1 ? "s" : ""}${children ? `, ${children} child${children > 1 ? "ren" : ""}` : ""}${infants ? `, ${infants} infant${infants > 1 ? "s" : ""}` : ""}` : `${adults}成人${children ? `、${children}儿童` : ""}${infants ? `、${infants}婴儿` : ""}`} · {english ? "Economy" : "经济舱"} · {visibleFlights.length}{english ? " offers" : "个航班方案"}</p></div><div className="sort-actions"><select className="secondary sort-select" value={flightSort} onChange={event => { setFlightSort(event.target.value as typeof flightSort); setPageNumber(1); }} aria-label={english ? "Sort flights" : "航班排序"}><option value="price">{english ? "Lowest price" : "价格优先"}</option><option value="departure">{english ? "Departure time" : "起飞时间优先"}</option></select></div></div>
      <div className="flight-result-layout"><aside className="filter-panel glass glass-light" aria-label={english ? "Flight filters" : "航班筛选"}><h3>{english ? "Filter flights" : "筛选航班"}</h3><label className="flight-filter-row"><input type="checkbox" checked={directOnly} onChange={event => { setDirectOnly(event.target.checked); setPageNumber(1); }} />{english ? "Nonstop only" : "仅看直飞"}</label><label className="flight-filter-row"><input type="checkbox" checked={baggageOnly} onChange={event => { setBaggageOnly(event.target.checked); setPageNumber(1); }} />{english ? "Checked baggage included" : "含托运行李"}</label><button className="text-button" onClick={() => { setDirectOnly(false); setBaggageOnly(false); setPageNumber(1); }}>{english ? "Clear filters" : "清除筛选"}</button></aside>
      <div className="flight-list">{pagedFlights.map(flight => <article className={`flight-card ${flight.journeys && flight.journeys.length > 1 ? "multi-journey-card" : ""}`} key={flight.id}>
        <div className="airline-badge">{flight.airlineCode}</div><div className="airline"><strong>{flight.airline}</strong><span>{flight.flightNo} · {flight.cabin}</span></div>
        {flight.journeys && flight.journeys.length > 1
          ? <div className="journey-list">{flight.journeys.map((journey, index) => <div className="journey-row" key={`${journey.date}-${journey.origin}-${journey.destination}`}><b>{tripType === "roundtrip" ? index === 0 ? "去程" : "返程" : `第${index + 1}程`}</b><span><strong>{journey.departureTime}</strong><small>{journey.origin}</small></span><i><small>{journey.date} · {journey.flightNo}</small><em>{journey.duration} · {journey.stops ? `${journey.stops}次中转` : "直飞"}</em></i><span><strong>{journey.arrivalTime}</strong><small>{journey.destination}</small></span></div>)}</div>
          : <><div className="flight-time"><strong>{flight.departureTime}</strong><span>{flight.departureAirport}</span></div>
            <div className="flight-route"><span>{flight.duration}</span><i /><small>{flight.stops ? `${flight.stops}次中转` : "直飞"}</small></div>
            <div className="flight-time"><strong>{flight.arrivalTime}</strong><span>{flight.arrivalAirport}</span></div></>}
        <div className="baggage">{flight.baggage}<small>含税总价</small></div>
        <div className="flight-price"><strong>{money(flightTotal(flight), flight.currency)}</strong><button className="primary" onClick={() => { setFareError(""); setFareOffer(flight); }}>{english ? "Select" : "选择"}</button></div>
      </article>)}{!pagedFlights.length && <div className="hotel-empty-state glass glass-light"><h3>{items.length ? "暂无符合筛选条件的航班" : "当前日期暂无可售航班"}</h3><p>{items.length ? "请放宽直飞或行李筛选条件。" : "F-Link 当前没有返回有效报价，请尝试其他日期或航线。"}</p><button className="primary" onClick={() => { if (items.length) { setDirectOnly(false); setBaggageOnly(false); } else { setStage("home"); } }}>{items.length ? "清除筛选" : "修改查询条件"}</button></div>}
      {totalPages > 1 && <nav className="pagination" aria-label="航班结果分页"><button className="secondary" onClick={() => setPageNumber(value => Math.max(1, value - 1))} disabled={pageNumber === 1}>上一页</button><span>第 {pageNumber} / {totalPages} 页</span><button className="secondary" onClick={() => setPageNumber(value => Math.min(totalPages, value + 1))} disabled={pageNumber === totalPages}>下一页</button></nav>}</div></div>
      </section>
      {fareOffer && <div className="overlay-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) setFareOffer(undefined); }}>
        <section className="fare-drawer glass glass-light" role="dialog" aria-modal="true" aria-labelledby="fare-title">
          <button ref={fareCloseRef} className="drawer-close" onClick={() => { setFareOffer(undefined); fareTriggerRef.current?.focus(); }} aria-label="关闭票价选择"><X size={20} /></button>
          <header><p className="eyebrow">SELECT FARE</p><h2 id="fare-title">{routeLabel}</h2><p>{fareOffer.journeys && fareOffer.journeys.length > 1 ? `${fareOffer.journeys.length} 段组合行程 · ${fareOffer.flightNo}` : `${fareOffer.airline} ${fareOffer.flightNo} · ${fareOffer.departureTime}—${fareOffer.arrivalTime} · ${fareOffer.duration}`}</p></header>
          {fareError && <div ref={fareErrorRef} className="fare-verification-error" role="alert" aria-live="assertive" tabIndex={-1}>
            <span><AlertTriangle size={21} /></span>
            <div><strong>{/price\s*key|运价.*(变化|失效|过期)/i.test(fareError) ? english ? "This fare has expired" : "该票价已失效" : english ? "Live fare verification failed" : "实时验价未通过"}</strong><p>{english ? "F-Link could not confirm this price. Search again to get a new priceKey before continuing." : "F-Link 无法确认当前运价，请重新搜索获取最新 priceKey 后再继续。"}</p><small>{fareError}</small></div>
            <button className="fare-retry-button" onClick={() => { setFareOffer(undefined); setFareError(""); void search(); }} disabled={loading}><RefreshCw size={15} />{english ? "Search latest fares" : "重新搜索最新票价"}</button>
          </div>}
          <div className="fare-option-grid">
            <label className="fare-option selected"><input type="radio" checked readOnly name="fare-brand" /><span><strong>标准经济舱</strong><small>F-Link 实时返回的可售运价</small><small>托运行李 {fareOffer.baggage}</small><small>退改签以验价结果为准</small></span><b>{money(flightTotal(fareOffer), fareOffer.currency)}</b></label>
            <label className="fare-option disabled" aria-disabled="true"><input type="radio" disabled name="fare-brand" /><span><strong>灵活经济舱</strong><small>本次搜索未返回对应 priceKey</small><small>不可作为真实可售运价提交</small></span><b>暂不可订</b></label>
            <label className="fare-option disabled" aria-disabled="true"><input type="radio" disabled name="fare-brand" /><span><strong>易退改保障</strong><small>需接入保障产品及独立履约协议</small><small>当前不会计入订单或扣款</small></span><b>待开通</b></label>
          </div>
          <footer><div><small>实时含税总价</small><strong>{money(flightTotal(fareOffer), fareOffer.currency)}</strong></div><button className="primary" onClick={continueFare} disabled={verifyingId === fareOffer.id || Boolean(fareError)}>{verifyingId ? <><LoaderCircle className="spinner" size={17} />实时验价中</> : fareError ? <><AlertTriangle size={17} />{english ? "Fare expired" : "票价已失效"}</> : authenticated ? <>继续填写乘机人<ChevronRight size={17} /></> : <><LogIn size={17} />登录后预订</>}</button></footer>
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
      .catch(caught => { if (active) setError(caught instanceof Error ? caught.message : english ? "Could not load bookings." : "订单加载失败"); })
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
    ["all", english ? "All bookings" : "全部订单"],
    ["pending", english ? "Pending" : "待处理"],
    ["confirmed", english ? "Confirmed" : "已确认"],
    ["aftersales", english ? "After-sales" : "售后中"],
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
  return <section className="consumer-content-page orders-content-page"><section className="page-heading compact"><div><p className="eyebrow">MY BOOKINGS</p><h1>{english ? "My bookings" : "我的订单"}</h1><p>{english ? "Track hotel, flight, and after-sales progress in one place." : "统一查看酒店、机票与售后处理进度"}</p></div></section>
    {error && <div className="error-banner" role="alert">{error}</div>}
    <section className="booking-filter-panel glass glass-light" aria-label={english ? "Booking filters" : "订单筛选条件"}>
      <div className="booking-filter-head">
        <div><span><SlidersHorizontal size={17} /></span><div><strong>{english ? "Filter bookings" : "筛选订单"}</strong><small>{english ? `${visibleOrders.length} of ${orders.length} bookings shown` : `当前显示 ${visibleOrders.length} / ${orders.length} 个订单`}</small></div></div>
        <button className="text-button" onClick={resetFilters} disabled={!activeFilterCount}>{english ? "Clear filters" : "清空筛选"}{activeFilterCount ? ` · ${activeFilterCount}` : ""}</button>
      </div>
      <div className="filter-bar" aria-label={english ? "Booking status shortcuts" : "订单状态快捷筛选"}>{filters.map(([value, label]) => <button key={value} className={statusFilter === value ? "active" : ""} aria-pressed={statusFilter === value} onClick={() => setStatusFilter(value)}>{label}<span>{orders.filter(order => orderMatchesStatusFilter(order, value)).length}</span></button>)}</div>
      <div className="booking-filter-grid">
        <label className="wide"><span>{english ? "Search" : "关键词"}</span><div className="input-with-icon"><Search size={16} /><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder={english ? "Booking ID, supplier reference, customer, hotel or route" : "订单号、上游单号、客户、酒店或航线"} /></div></label>
        <label><span>{english ? "Product" : "产品类型"}</span><select value={productFilter} onChange={event => setProductFilter(event.target.value as OrderProductFilter)}><option value="all">{english ? "All products" : "全部产品"}</option><option value="hotel">{english ? "Hotels" : "酒店"}</option><option value="flight">{english ? "Flights" : "机票"}</option></select></label>
        <label><span>{english ? "Exact status" : "精确状态"}</span><select value={statusFilter} onChange={event => setStatusFilter(event.target.value as OrderStatusFilter)}><option value="all">{english ? "All statuses" : "全部状态"}</option><option value="pending">{english ? "Pending group" : "待处理分组"}</option><option value="confirmed">{english ? "Confirmed group" : "已确认分组"}</option><option value="aftersales">{english ? "After-sales group" : "售后分组"}</option>{concreteOrderStatuses.map(status => <option key={status} value={status}>{english ? statusLabelsEn[status] : statusLabels[status]}</option>)}</select></label>
        <label><span>{english ? "Created" : "创建时间"}</span><select value={datePreset} onChange={event => updateDatePreset(event.target.value as OrderDatePreset)}><option value="all">{english ? "Any time" : "不限时间"}</option><option value="today">{english ? "Today" : "今日"}</option><option value="7d">{english ? "Last 7 days" : "近7天"}</option><option value="30d">{english ? "Last 30 days" : "近30天"}</option><option value="custom">{english ? "Custom range" : "自定义"}</option></select></label>
        <label><span>{english ? "From" : "开始日期"}</span><input type="date" value={startDate} onChange={event => { setDatePreset("custom"); setStartDate(event.target.value); }} /></label>
        <label><span>{english ? "To" : "结束日期"}</span><input type="date" value={endDate} onChange={event => { setDatePreset("custom"); setEndDate(event.target.value); }} /></label>
        <label><span>{english ? "Min amount" : "最低金额"}</span><input type="number" min="0" inputMode="decimal" value={minAmount} onChange={event => setMinAmount(event.target.value)} placeholder={english ? "No min" : "不限"} /></label>
        <label><span>{english ? "Max amount" : "最高金额"}</span><input type="number" min="0" inputMode="decimal" value={maxAmount} onChange={event => setMaxAmount(event.target.value)} placeholder={english ? "No max" : "不限"} /></label>
      </div>
    </section>
    {loading ? <div className="loading-state" aria-live="polite"><LoaderCircle className="spinner" size={20} />{english ? "Loading bookings…" : "正在加载订单…"}</div> : <OrderTable orders={visibleOrders} onSelect={setSelection} locale={locale} />}</section>;
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
    { id: "profile", label: tr("个人资料", "Profile", "個人資料"), icon: UserRound },
    { id: "security", label: tr("安全", "Security", "安全"), icon: LockKeyhole },
    { id: "travelers", label: tr("常用旅客", "Saved travelers", "常用旅客"), icon: Users },
    { id: "favorites", label: tr("收藏酒店", "Favorite hotels", "收藏飯店"), icon: Heart },
    { id: "notifications", label: tr("通知偏好", "Notifications", "通知偏好"), icon: Bell },
    { id: "billing", label: tr("支付与授信", "Payment & credit", "付款與授信"), icon: CreditCard },
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
      showFeedback("success", tr(`已取消收藏 ${hotel.name}`, `Removed ${hotel.name} from favorites.`, `已取消收藏 ${hotel.name}`));
    } catch (caught) {
      showFeedback("error", caught instanceof Error ? caught.message : tr("取消收藏失败", "Could not remove favorite.", "取消收藏失敗"));
    } finally {
      setRemovingFavoriteId("");
    }
  };
  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!profile.surname.trim() || !profile.givenName.trim()) return showFeedback("error", tr("请分别填写姓和名", "Enter surname and given name separately.", "請分別填寫姓和名"));
    if (!isValidInternationalPhone(profile.phone)) return showFeedback("error", tr("请输入有效的国际电话号码（7–15 位数字，可包含国家码）", "Enter a valid international phone number with 7–15 digits and an optional country code.", "請輸入有效的國際電話號碼（7–15 位數字，可包含國家碼）"));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)) return showFeedback("error", tr("请输入有效的电子邮箱", "Enter a valid email address.", "請輸入有效的電子郵件地址"));
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
      showFeedback("success", pendingAvatar ? tr("个人资料和头像已保存", "Profile and avatar saved.", "個人資料和頭像已儲存") : tr("个人资料已保存", "Profile saved.", "個人資料已儲存"));
    } catch (caught) {
      showFeedback("error", caught instanceof Error ? caught.message : tr("个人资料保存失败", "Could not save profile.", "個人資料儲存失敗"));
    } finally {
      setSavingProfile(false);
    }
  };
  const chooseAvatar = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!["image/png", "image/jpeg"].includes(file.type) || file.size > 2 * 1024 * 1024) {
      showFeedback("error", tr("请选择不超过 2 MB 的 PNG 或 JPG 图片", "Choose a PNG or JPG image no larger than 2 MB.", "請選擇不超過 2 MB 的 PNG 或 JPG 圖片"));
      event.target.value = "";
      return;
    }
    setPendingAvatar(file);
    const reader = new FileReader();
    reader.onload = () => {
      setAvatarUrl(String(reader.result || ""));
      showFeedback("info", tr(`已选择 ${file.name}，请点击“保存修改”完成保存`, `${file.name} selected. Choose “Save changes” to finish.`, `已選擇 ${file.name}，請點選「儲存變更」完成儲存`));
    };
    reader.readAsDataURL(file);
  };
  const updatePassword = (event: React.FormEvent) => {
    event.preventDefault();
    if (passwordForm.next.length < 8) return showFeedback("error", tr("新密码至少需要 8 个字符", "The new password must contain at least 8 characters.", "新密碼至少需要 8 個字元"));
    if (passwordForm.next !== passwordForm.confirm) return showFeedback("error", tr("两次输入的新密码不一致", "The new passwords do not match.", "兩次輸入的新密碼不一致"));
    setDialog("");
    setPasswordForm({ current: "", next: "", confirm: "" });
    showFeedback("info", tr("密码规则验证通过；生产环境需由企业身份服务完成修改", "Password validation passed. Production changes must be completed through the corporate identity service.", "密碼規則驗證通過；正式環境需由企業身分服務完成修改"));
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
    if (!englishNamePattern.test(travelerDraft.surname.trim())) return showFeedback("error", tr("英文姓仅支持英文字母、空格、连字符或撇号", "Surname may contain only Latin letters, spaces, hyphens, or apostrophes.", "英文姓僅支援英文字母、空格、連字號或撇號"));
    if (!englishNamePattern.test(travelerDraft.givenName.trim())) return showFeedback("error", tr("英文名仅支持英文字母、空格、连字符或撇号", "Given name may contain only Latin letters, spaces, hyphens, or apostrophes.", "英文名僅支援英文字母、空格、連字號或撇號"));
    const documentNo = travelerDraft.documentNo.trim().toUpperCase();
    if ((!editingTravelerId || documentNo) && !/^[A-Z0-9]{5,20}$/.test(documentNo)) return showFeedback("error", tr("请输入 5–20 位英文字母或数字组成的护照号码", "Enter a passport number containing 5–20 letters or digits.", "請輸入 5–20 位英文字母或數字組成的護照號碼"));
    if (!travelerDraft.birthday || travelerDraft.birthday >= new Date().toISOString().slice(0, 10)) return showFeedback("error", tr("请输入有效的出生日期", "Enter a valid date of birth.", "請輸入有效的出生日期"));
    if (!travelerDraft.expiration || travelerDraft.expiration <= new Date().toISOString().slice(0, 10)) return showFeedback("error", tr("护照已过期或有效期填写错误", "The passport is expired or its expiry date is invalid.", "護照已過期或有效期填寫錯誤"));
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
        showFeedback("success", tr("常用旅客已更新并保存", "Saved traveler updated.", "常用旅客已更新並儲存"));
      } else {
        const saved = await api.createAccountTraveler({ ...payload, documentNo });
        setTravelers(current => [...current, saved]);
        showFeedback("success", tr("常用旅客已添加并保存", "Saved traveler added.", "常用旅客已新增並儲存"));
      }
      setTravelerDraft(emptyTraveler);
      setEditingTravelerId("");
      setDialog("");
    } catch (caught) {
      showFeedback("error", caught instanceof Error ? caught.message : tr("常用旅客保存失败", "Could not save traveler.", "常用旅客儲存失敗"));
    } finally {
      setSavingTraveler(false);
    }
  };
  const removeTraveler = async (traveler: AccountTraveler) => {
    try {
      await api.deleteAccountTraveler(traveler.id);
      setTravelers(current => current.filter(item => item.id !== traveler.id));
      showFeedback("success", tr(`已永久移除 ${traveler.surname} / ${traveler.givenName}`, `${traveler.surname} / ${traveler.givenName} was removed.`, `已永久移除 ${traveler.surname} / ${traveler.givenName}`));
    } catch (caught) {
      showFeedback("error", caught instanceof Error ? caught.message : tr("常用旅客移除失败", "Could not remove traveler.", "常用旅客移除失敗"));
    }
  };
  const saveNotifications = async () => {
    setSavingNotifications(true);
    try {
      const saved = await api.updateNotificationPreferences(notifications);
      setNotifications({ order: saved.order, flight: saved.flight, marketing: saved.marketing });
      showFeedback("success", tr("通知偏好已保存", "Notification preferences saved.", "通知偏好已儲存"));
    } catch (caught) {
      showFeedback("error", caught instanceof Error ? caught.message : tr("通知偏好保存失败", "Could not save notification preferences.", "通知偏好儲存失敗"));
    } finally {
      setSavingNotifications(false);
    }
  };
  const submitCreditRequest = (event: React.FormEvent) => {
    event.preventDefault();
    const currentCredit = creditSummary?.totalCredit ?? 0;
    if (creditDraft.amount <= currentCredit) return showFeedback("error", tr(`申请额度需高于当前授信 ${money(currentCredit)}`, `The requested credit must exceed the current limit of ${money(currentCredit)}.`, `申請額度需高於目前授信 ${money(currentCredit)}`));
    if (!creditDraft.reason.trim()) return showFeedback("error", tr("请填写额度调整原因", "Enter a reason for the credit adjustment.", "請填寫額度調整原因"));
    setDialog("");
    showFeedback("info", tr(`授信调整申请 ${money(creditDraft.amount)} 已记录，等待企业审核服务接入`, `Credit adjustment request for ${money(creditDraft.amount)} recorded; corporate approval integration is pending.`, `授信調整申請 ${money(creditDraft.amount)} 已記錄，等待企業審核服務接入`));
  };

  return <section className="consumer-content-page"><section className="page-heading compact"><div><p className="eyebrow">ACCOUNT SETTINGS</p><h1>{tr("账户设置", "Account settings", "帳戶設定")}</h1><p>{tr("管理个人资料、安全设置、常用旅客与通知偏好", "Manage your profile, security, saved travelers, and notification preferences.", "管理個人資料、安全設定、常用旅客與通知偏好")}</p></div></section>
    {feedback && <div className={`account-feedback ${feedback.tone}`} role={feedback.tone === "error" ? "alert" : "status"}><span>{feedback.text}</span><button onClick={() => setFeedback(undefined)}>{tr("关闭", "Close", "關閉")}</button></div>}
    <div className="account-layout"><aside className="account-menu glass glass-light" aria-label={tr("账户设置菜单", "Account settings menu", "帳戶設定選單")}>{menu.map(({ id, label, icon: Icon }) => <button key={id} className={section === id ? "active" : ""} aria-current={section === id ? "page" : undefined} onClick={() => { setSection(id); setFeedback(undefined); }}><Icon size={17} />{label}</button>)}</aside>
      <div className="account-main">
        {section === "profile" && <form className="form-section glass glass-light" onSubmit={saveProfile}><div className="profile-heading"><div className="large-avatar">{avatarUrl ? <img src={avatarUrl} alt={tr("个人头像", "Profile avatar", "個人頭像")} /> : savedName.slice(0, 1)}</div><div><h2>{savedName}</h2><p>{role === "admin" ? tr("超级管理员 · 寰宇旅行", "Super administrator · Global Travel", "超級管理員 · 寰宇旅行") : tr("预订成员 · 寰宇旅行", "Booking member · Global Travel", "預訂成員 · 寰宇旅行")}{pendingAvatar ? tr(" · 新头像待保存", " · New avatar pending", " · 新頭像待儲存") : ""}</p></div><input ref={avatarInputRef} hidden type="file" accept="image/png,image/jpeg" onChange={chooseAvatar} /><button type="button" className="secondary" onClick={() => avatarInputRef.current?.click()} disabled={savingProfile}>{tr("更换头像", "Change avatar", "更換頭像")}</button></div><div className="form-grid"><label><span>{tr("姓 / Surname", "Surname", "姓 / Surname")}</span><input aria-label={tr("姓", "Surname", "姓")} required value={profile.surname} onChange={event => setProfile(current => ({ ...current, surname: event.target.value }))} /></label><label><span>{tr("名 / Given name", "Given name", "名 / Given name")}</span><input aria-label={tr("名", "Given name", "名")} required value={profile.givenName} onChange={event => setProfile(current => ({ ...current, givenName: event.target.value }))} /></label><label><span>{tr("显示语言", "Display language", "顯示語言")}</span><select aria-label={tr("显示语言", "Display language", "顯示語言")} value={profile.language} onChange={event => setProfile(current => ({ ...current, language: event.target.value as LocaleCode }))}><option value="zh-CN">简体中文</option><option value="zh-TW">繁體中文</option><option value="en">English</option></select></label><label><span>{tr("国际电话号码", "International phone number", "國際電話號碼")}</span><input aria-label={tr("国际电话号码", "International phone number", "國際電話號碼")} type="tel" inputMode="tel" autoComplete="tel" placeholder="+65 6474 0800" value={profile.phone} onChange={event => setProfile(current => ({ ...current, phone: event.target.value }))} /></label><label className="wide"><span>{tr("电子邮箱", "Email address", "電子郵件地址")}</span><input aria-label={tr("电子邮箱", "Email address", "電子郵件地址")} type="email" value={profile.email} onChange={event => setProfile(current => ({ ...current, email: event.target.value }))} /></label></div><div className="form-actions"><button className="primary" disabled={savingProfile} aria-busy={savingProfile}>{savingProfile ? <><LoaderCircle className="spinner" size={16} />{tr("保存中", "Saving…", "儲存中")}</> : tr("保存修改", "Save changes", "儲存變更")}</button></div></form>}

        {section === "security" && <section className="form-section glass glass-light"><div className="section-title"><span><ShieldCheck size={17} /></span><div><h2>{tr("账户安全", "Account security", "帳戶安全")}</h2><p>{tr("当前沙箱未接入真实登录审计记录", "Real sign-in audit history is not connected in this sandbox.", "目前沙盒未接入真實登入稽核記錄")}</p></div></div><div className="security-row"><div><strong>{tr("登录密码", "Password", "登入密碼")}</strong><span>{tr("建议每 90 天更新一次", "We recommend updating it every 90 days.", "建議每 90 天更新一次")}</span></div><button className="secondary" onClick={() => setDialog("password")}>{tr("修改密码", "Change password", "修改密碼")}</button></div><div className="security-row"><div><strong>{tr("双重验证", "Two-factor authentication", "雙重驗證")}</strong><span>{tr("尚未接入企业身份与短信验证服务", "Corporate identity and SMS verification are not connected.", "尚未接入企業身分與簡訊驗證服務")}</span></div><div className="security-actions"><span className="pending-badge">{tr("未开通", "Unavailable", "未開通")}</span><button className="secondary" disabled>{tr("管理验证", "Manage verification", "管理驗證")}</button></div></div></section>}

        {section === "travelers" && <section className="form-section glass glass-light"><div className="account-section-head"><div className="section-title"><span><Users size={17} /></span><div><h2>{tr("常用旅客", "Saved travelers", "常用旅客")}</h2><p>{tr("预订时可快速填充，证件号码默认脱敏展示", "Reuse traveler details during booking; document numbers remain masked.", "預訂時可快速填入，證件號碼預設遮罩顯示")}</p></div></div><button className="primary" onClick={openNewTraveler}><Plus size={16} />{tr("新增旅客", "Add traveler", "新增旅客")}</button></div><div className="traveler-list">{travelers.map(traveler => <article key={traveler.id}><div><strong>{traveler.surname} / {traveler.givenName}</strong><span>{traveler.type === "adult" ? tr("成人", "Adult", "成人") : traveler.type === "child" ? tr("儿童", "Child", "兒童") : tr("婴儿", "Infant", "嬰兒")} · {traveler.gender === "1" ? tr("男", "Male", "男") : tr("女", "Female", "女")} · {tr("国籍", "Nationality", "國籍")} {traveler.nationality} · {tr("出生", "Born", "出生")} {traveler.birthday}</span><span>{tr("护照", "Passport", "護照")} {traveler.documentNo} · {tr(`${traveler.issuingCountry} 签发`, `Issued by ${traveler.issuingCountry}`, `${traveler.issuingCountry} 簽發`)} · {tr("有效期", "Expires", "有效期")} {traveler.expiration}</span></div><div className="security-actions"><button className="secondary" onClick={() => openEditTraveler(traveler)}>{tr("编辑", "Edit", "編輯")}</button><button className="secondary" onClick={() => void removeTraveler(traveler)}>{tr("移除", "Remove", "移除")}</button></div></article>)}</div></section>}

        {section === "favorites" && <section className="form-section glass glass-light"><div className="account-section-head"><div className="section-title"><span><Heart size={17} /></span><div><h2>{tr("收藏酒店", "Favorite hotels", "收藏飯店")}</h2><p>{tr("仅保存 G-Link 真实接口返回的酒店偏好；房态和价格需重新查询", "Only G-Link hotels are saved. Availability and prices must be searched again.", "僅儲存 G-Link 真實介面回傳的飯店偏好；房況和價格需重新查詢")}</p></div></div><button className="primary" onClick={() => navigate("hotels")}><Search size={16} />{tr("继续找酒店", "Find more hotels", "繼續找飯店")}</button></div>{favoritesLoading ? <div className="favorite-preference-list"><div className="favorite-preference-row skeleton-card" /></div> : favoriteHotels.length ? <div className="favorite-preference-list">{favoriteHotels.map(hotel => <article className="favorite-preference-row" key={hotel.id}>{hotel.image ? <img src={hotel.image} alt="" /> : <div className="favorite-image-placeholder"><Building2 size={22} /></div>}<div><strong>{hotel.name}</strong><span>{[hotel.city, hotel.district].filter(Boolean).join(" · ") || tr("上游未提供位置", "Location not supplied", "上游未提供位置")}</span><small>{tr("收藏于", "Saved", "收藏於")} {new Date(hotel.favoritedAt).toLocaleString(locale)} · {tr("实时价格未缓存", "Live price not cached", "即時價格未快取")}</small></div><div className="security-actions"><button className="secondary" onClick={() => { rememberFavoriteHotelSearch(hotel.name); navigate("hotels"); }}>{tr("重新查询", "Search again", "重新查詢")}</button><button className="danger-action" onClick={() => void removeFavoriteHotel(hotel)} disabled={removingFavoriteId === hotel.id}>{removingFavoriteId === hotel.id ? tr("处理中…", "Removing…", "處理中…") : tr("取消收藏", "Remove favorite", "取消收藏")}</button></div></article>)}</div> : <div className="favorite-empty account"><Heart size={22} /><div><strong>{tr("还没有收藏酒店", "No favorite hotels yet", "還沒有收藏飯店")}</strong><span>{tr("在酒店搜索结果或酒店详情页点击心形按钮后，会显示在这里。", "Use the heart button in hotel results or details to save a favorite.", "在飯店搜尋結果或飯店詳情頁點選愛心按鈕後，會顯示在這裡。")}</span></div><button className="secondary" onClick={() => navigate("hotels")}>{tr("去找酒店", "Find hotels", "去找飯店")}</button></div>}</section>}

        {section === "notifications" && <section className="form-section glass glass-light"><div className="section-title"><span><Bell size={17} /></span><div><h2>{tr("通知偏好", "Notification preferences", "通知偏好")}</h2><p>{tr("控制订单、出票与营销信息的接收方式", "Choose how you receive booking, ticketing, and marketing updates.", "控制訂單、出票與行銷資訊的接收方式")}</p></div></div><div className="settings-list"><label><span><strong>{tr("订单状态通知", "Booking status", "訂單狀態通知")}</strong><small>{tr("确认、取消、退款等关键状态", "Confirmation, cancellation, refund, and other key updates", "確認、取消、退款等重要狀態")}</small></span><input aria-label={tr("订单状态通知", "Booking status notifications", "訂單狀態通知")} type="checkbox" checked={notifications.order} onChange={event => setNotifications(current => ({ ...current, order: event.target.checked }))} /></label><label><span><strong>{tr("出票与航变通知", "Ticketing and flight changes", "出票與航變通知")}</strong><small>{tr("出票成功、航班时间和航线变化", "Ticket issuance, schedule changes, and route changes", "出票成功、航班時間和航線變化")}</small></span><input aria-label={tr("出票与航变通知", "Ticketing and flight change notifications", "出票與航變通知")} type="checkbox" checked={notifications.flight} onChange={event => setNotifications(current => ({ ...current, flight: event.target.checked }))} /></label><label><span><strong>{tr("优惠与产品更新", "Offers and product updates", "優惠與產品更新")}</strong><small>{tr("新产品、价格活动与运营信息", "New products, promotions, and service updates", "新產品、價格活動與營運資訊")}</small></span><input aria-label={tr("优惠与产品更新", "Offers and product updates", "優惠與產品更新")} type="checkbox" checked={notifications.marketing} onChange={event => setNotifications(current => ({ ...current, marketing: event.target.checked }))} /></label></div><div className="form-actions"><button className="primary" onClick={() => void saveNotifications()} disabled={savingNotifications} aria-busy={savingNotifications}>{savingNotifications ? <><LoaderCircle className="spinner" size={16} />{tr("保存中", "Saving…", "儲存中")}</> : tr("保存通知偏好", "Save notification preferences", "儲存通知偏好")}</button></div></section>}

        {section === "billing" && <section className="form-section glass glass-light"><div className="section-title"><span><CreditCard size={17} /></span><div><h2>{tr("支付与授信", "Payment & credit", "付款與授信")}</h2><p>{tr("当前仅开放企业授信；银行卡需接入正式收单机构后启用", "Enterprise credit is currently available. Card payments require a production payment provider.", "目前僅開放企業授信；銀行卡需接入正式收單機構後啟用")}</p></div></div><div className="account-credit-grid"><article><span>{tr("授信总额", "Total credit", "授信總額")}</span><strong>{creditSummary ? money(creditSummary.totalCredit) : "—"}</strong><small>{tr("业务数据库 · CNY", "Business database · CNY", "業務資料庫 · CNY")}</small></article><article><span>{tr("当前可用", "Available credit", "目前可用")}</span><strong>{creditSummary ? money(creditSummary.availableCredit) : "—"}</strong><small>{tr("与财务结算实时一致", "Live value from Finance", "與財務結算即時一致")}</small></article></div><div className="account-action-row"><button className="secondary" onClick={() => navigate("finance")}>{tr("查看财务结算", "Open finance", "查看財務結算")}</button><button className="primary" onClick={() => setDialog("credit")} disabled={!creditSummary}>{tr("申请调整授信", "Request credit adjustment", "申請調整授信")}</button></div></section>}
      </div>
    </div>

    {dialog && <div className="modal-layer" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setDialog(""); }}>
      {dialog === "password" && <form className="booking-modal glass glass-light" role="dialog" aria-modal="true" aria-labelledby="password-title" onSubmit={updatePassword}><button type="button" className="modal-close" onClick={() => setDialog("")} aria-label={tr("关闭修改密码", "Close password dialog", "關閉修改密碼")}><X size={18} /></button><h2 id="password-title">{tr("修改密码", "Change password", "修改密碼")}</h2><p className="modal-subtitle">{tr("沙箱环境只验证交互与密码规则，不会修改真实企业登录凭证。", "The sandbox validates interactions and password rules only; it does not change corporate credentials.", "沙箱環境只驗證互動與密碼規則，不會修改真實企業登入憑證。")}</p><div className="form-grid"><label className="wide"><span>{tr("当前密码", "Current password", "目前密碼")}</span><input aria-label={tr("当前密码", "Current password", "目前密碼")} type="password" required value={passwordForm.current} onChange={event => setPasswordForm(current => ({ ...current, current: event.target.value }))} /></label><label><span>{tr("新密码", "New password", "新密碼")}</span><input aria-label={tr("新密码", "New password", "新密碼")} type="password" required minLength={8} value={passwordForm.next} onChange={event => setPasswordForm(current => ({ ...current, next: event.target.value }))} /></label><label><span>{tr("确认新密码", "Confirm new password", "確認新密碼")}</span><input aria-label={tr("确认新密码", "Confirm new password", "確認新密碼")} type="password" required minLength={8} value={passwordForm.confirm} onChange={event => setPasswordForm(current => ({ ...current, confirm: event.target.value }))} /></label></div><div className="modal-actions"><button type="button" className="secondary" onClick={() => setDialog("")}>{tr("取消", "Cancel", "取消")}</button><button className="primary">{tr("验证并提交", "Validate and submit", "驗證並提交")}</button></div></form>}
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
      </div><p className="passport-privacy-note"><ShieldCheck size={15} />{tr("护照信息属于敏感个人信息；本地数据库使用 AES-256-GCM 加密存储，页面与接口仅返回脱敏号码。", "Passport data is sensitive personal information. The local database uses AES-256-GCM encryption, and pages and APIs return masked numbers only.", "護照資訊屬於敏感個人資訊；本機資料庫使用 AES-256-GCM 加密儲存，頁面與介面僅回傳遮罩號碼。")}</p><div className="modal-actions"><button type="button" className="secondary" onClick={() => setDialog("")} disabled={savingTraveler}>{tr("取消", "Cancel", "取消")}</button><button className="primary" disabled={savingTraveler} aria-busy={savingTraveler}>{savingTraveler ? <><LoaderCircle className="spinner" size={16} />{tr("保存中", "Saving…", "儲存中")}</> : editingTravelerId ? tr("保存修改", "Save changes", "儲存變更") : tr("保存旅客", "Save traveler", "儲存旅客")}</button></div></form>}
      {dialog === "credit" && <form className="booking-modal glass glass-light" role="dialog" aria-modal="true" aria-labelledby="credit-title" onSubmit={submitCreditRequest}><button type="button" className="modal-close" onClick={() => setDialog("")} aria-label={tr("关闭授信申请", "Close credit request", "關閉授信申請")}><X size={18} /></button><h2 id="credit-title">{tr("申请调整授信", "Request credit adjustment", "申請調整授信")}</h2><p className="modal-subtitle">{tr("申请将进入企业审核流程；当前沙箱仅记录交互结果。", "The request will enter corporate approval. The sandbox records the interaction only.", "申請將進入企業審核流程；目前沙箱僅記錄互動結果。")}</p><div className="form-grid"><label><span>{tr("申请额度（CNY）", "Requested credit (CNY)", "申請額度（CNY）")}</span><input aria-label={tr("申请额度", "Requested credit", "申請額度")} type="number" min={(creditSummary?.totalCredit ?? 0) + 1} required value={creditDraft.amount} onChange={event => setCreditDraft(current => ({ ...current, amount: Number(event.target.value) }))} /></label><label className="wide"><span>{tr("调整原因", "Reason for adjustment", "調整原因")}</span><input aria-label={tr("调整原因", "Reason for adjustment", "調整原因")} required value={creditDraft.reason} onChange={event => setCreditDraft(current => ({ ...current, reason: event.target.value }))} /></label></div><div className="modal-actions"><button type="button" className="secondary" onClick={() => setDialog("")}>{tr("取消", "Cancel", "取消")}</button><button className="primary">{tr("提交申请", "Submit request", "提交申請")}</button></div></form>}
      {dialog === "mfa" && <section className="booking-modal glass glass-light" role="dialog" aria-modal="true" aria-labelledby="mfa-title"><button type="button" className="modal-close" onClick={() => setDialog("")} aria-label={tr("关闭双重验证", "Close two-factor authentication", "關閉雙重驗證")}><X size={18} /></button><h2 id="mfa-title">{tr("双重验证", "Two-factor authentication", "雙重驗證")}</h2><p className="modal-subtitle">{tr("当前已绑定手机号 138****8866。生产环境的重新绑定与关闭操作需通过企业身份服务和短信校验。", "Mobile number 138****8866 is linked. Rebinding or disabling it in production requires the corporate identity service and SMS verification.", "目前已綁定手機號碼 138****8866。正式環境的重新綁定與關閉操作需透過企業身分服務和簡訊驗證。")}</p><div className="modal-actions"><button className="primary" onClick={() => setDialog("")}>{tr("我知道了", "Got it", "我知道了")}</button></div></section>}
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
      setError(error instanceof Error ? error.message : english ? "Could not create the customer." : "客户创建失败");
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
      setError(error instanceof Error ? error.message : english ? "Could not update customer status." : "客户状态更新失败");
    }
  };
  return <section className="operations-page">
    <section className="page-heading compact"><div><p className="eyebrow">CUSTOMERS</p><h1>{english ? "Customers" : "客户管理"}</h1><p>{english ? "Manage corporate customers, contacts, account status, and credit limits." : "维护企业客户、联系人、账号状态与授信额度"}</p></div><button className="primary" onClick={() => setOpen(true)}><Plus size={16} />{english ? "New customer" : "新建客户"}</button></section>
    {error && <div className="error-banner" role="alert">{error}<button onClick={() => setError("")}>{english ? "Dismiss" : "关闭"}</button></div>}
    <section className="operations-summary">
      <article><span>{english ? "Corporate customers" : "企业客户"}</span><strong>{items.length}</strong><small>{english ? "Persisted in the business database" : "已持久化至业务数据库"}</small></article>
      <article><span>{english ? "Active customers" : "启用客户"}</span><strong>{items.filter(item => item.status === "ACTIVE").length}</strong><small>{english ? "Can book and use credit" : "可正常预订与记账"}</small></article>
      <article><span>{english ? "Total credit limit" : "总授信额度"}</span><strong>{money(items.reduce((sum, item) => sum + item.creditLimit, 0))}</strong><small>{english ? "Controlled per customer" : "按客户独立控制"}</small></article>
    </section>
    <section className="panel operations-panel glass glass-light"><div className="panel-title"><div><h2>{english ? "Customer list" : "客户列表"}</h2><p>{english ? "Suspended customers retain history but cannot create new transactions." : "停用后保留历史订单，但不能继续创建新交易"}</p></div></div>
      <div className="table-wrap"><table><thead><tr><th>{english ? "Customer" : "客户"}</th><th>{english ? "Contact" : "联系人"}</th><th>{english ? "Contact details" : "联系方式"}</th><th>{english ? "Credit used" : "授信使用"}</th><th>{english ? "Status" : "状态"}</th><th>{english ? "Action" : "操作"}</th></tr></thead><tbody>{items.length ? items.map(customer => <tr key={customer.id}><td><strong>{customer.name}</strong><small className="table-subline">{customer.id}</small></td><td>{customer.contactName}</td><td>{customer.phone}<small className="table-subline">{customer.email}</small></td><td>{money(customer.creditUsed)} / {money(customer.creditLimit)}</td><td><span className={`business-status ${customer.status.toLowerCase()}`}>{customer.status === "ACTIVE" ? english ? "Active" : "启用" : english ? "Suspended" : "停用"}</span></td><td><button className="table-action" onClick={() => toggle(customer)}>{customer.status === "ACTIVE" ? english ? "Suspend" : "停用" : english ? "Activate" : "启用"}</button></td></tr>) : <tr><td colSpan={6} className="empty-table-cell">{english ? "No customers yet." : "暂无客户。"}</td></tr>}</tbody></table></div>
    </section>
    {open && <div className="modal-layer" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setOpen(false); }}><form className="booking-modal glass glass-light" role="dialog" aria-modal="true" aria-labelledby="new-customer-title" onSubmit={submit}><button type="button" className="modal-close" onClick={() => setOpen(false)} aria-label={english ? "Close" : "关闭"}><X size={18} /></button><h2 id="new-customer-title">{english ? "New corporate customer" : "新建企业客户"}</h2><p className="modal-subtitle">{english ? "Configure independent credit and pricing after creating the customer." : "客户创建后即可配置独立授信和定价策略。"}</p><div className="form-grid"><label><span>{english ? "Company name" : "企业名称"}</span><input required value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} /></label><label><span>{english ? "Contact surname" : "联系人姓 / Surname"}</span><input required value={form.contactSurname} onChange={event => setForm(current => ({ ...current, contactSurname: event.target.value }))} /></label><label><span>{english ? "Contact given name" : "联系人名 / Given name"}</span><input required value={form.contactGivenName} onChange={event => setForm(current => ({ ...current, contactGivenName: event.target.value }))} /></label><label><span>{english ? "Phone" : "手机号码"}</span><input required value={form.phone} onChange={event => setForm(current => ({ ...current, phone: event.target.value }))} /></label><label><span>{english ? "Email" : "电子邮箱"}</span><input type="email" required value={form.email} onChange={event => setForm(current => ({ ...current, email: event.target.value }))} /></label><label className="wide"><span>{english ? "Credit limit" : "授信额度"}</span><input type="number" min="0" required value={form.creditLimit} onChange={event => setForm(current => ({ ...current, creditLimit: Number(event.target.value) }))} /></label></div><div className="modal-actions"><button type="button" className="secondary" onClick={() => setOpen(false)}>{english ? "Cancel" : "取消"}</button><button className="primary" disabled={saving}>{saving ? <><LoaderCircle className="spinner" size={16} />{english ? "Saving…" : "保存中"}</> : english ? "Create customer" : "创建客户"}</button></div></form></div>}
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
      setError(error instanceof Error ? error.message : english ? "Could not create the pricing rule." : "规则创建失败");
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
      setError(error instanceof Error ? error.message : english ? "Could not update the pricing rule." : "规则状态更新失败");
    }
  };
  const productLabel = (value: PricingRule["productType"]) =>
    value === "hotel" ? english ? "Hotels" : "酒店" : value === "flight" ? english ? "Flights" : "机票" : english ? "All products" : "全部产品";
  return <section className="operations-page">
    <section className="page-heading compact"><div><p className="eyebrow">PRICING</p><h1>{english ? "Pricing" : "定价策略"}</h1><p>{english ? "Configure percentage markups or fixed service fees. Active rules affect live search and verified prices." : "按产品配置百分比加价或固定服务费；启用后实时影响搜索与验价售价"}</p></div><button className="primary" onClick={() => setOpen(true)}><Plus size={16} />{english ? "New rule" : "新建规则"}</button></section>
    {error && <div className="error-banner" role="alert">{error}<button onClick={() => setError("")}>{english ? "Dismiss" : "关闭"}</button></div>}
    <section className="panel operations-panel glass glass-light"><div className="panel-title"><div><h2>{english ? "Pricing rules" : "定价规则"}</h2><p>{english ? "The active rule with the lowest priority number is applied first." : "同一产品按优先级从小到大匹配首条启用规则"}</p></div></div>
      <div className="table-wrap"><table><thead><tr><th>{english ? "Rule" : "规则名称"}</th><th>{english ? "Products" : "适用产品"}</th><th>{english ? "Calculation" : "计算方式"}</th><th>{english ? "Priority" : "优先级"}</th><th>{english ? "Status" : "状态"}</th><th>{english ? "Action" : "操作"}</th></tr></thead><tbody>{rules.length ? rules.map(rule => <tr key={rule.id}><td><strong>{rule.name}</strong><small className="table-subline">{rule.id}</small></td><td>{productLabel(rule.productType)}</td><td>{rule.calculationType === "percentage" ? `${english ? "Cost" : "成本价"} + ${rule.value}%` : `${english ? "Cost" : "成本价"} + ${money(rule.value)}`}</td><td>{rule.priority}</td><td><span className={`business-status ${rule.status.toLowerCase()}`}>{rule.status === "ACTIVE" ? english ? "Active" : "已启用" : english ? "Inactive" : "未启用"}</span></td><td><button className="table-action" onClick={() => toggle(rule)}>{rule.status === "ACTIVE" ? english ? "Disable" : "停用" : english ? "Enable" : "启用"}</button></td></tr>) : <tr><td colSpan={6} className="empty-table-cell">{english ? "No pricing rules yet." : "暂无定价规则。"}</td></tr>}</tbody></table></div>
    </section>
    {open && <div className="modal-layer" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setOpen(false); }}><form className="booking-modal glass glass-light" role="dialog" aria-modal="true" aria-labelledby="new-rule-title" onSubmit={submit}><button type="button" className="modal-close" onClick={() => setOpen(false)} aria-label={english ? "Close" : "关闭"}><X size={18} /></button><h2 id="new-rule-title">{english ? "New pricing rule" : "新建定价规则"}</h2><p className="modal-subtitle">{english ? "New rules are inactive until you review and enable them." : "新规则默认停用，确认影响范围后再手动启用。"}</p><div className="form-grid"><label className="wide"><span>{english ? "Rule name" : "规则名称"}</span><input required value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} /></label><label><span>{english ? "Products" : "适用产品"}</span><select value={form.productType} onChange={event => setForm(current => ({ ...current, productType: event.target.value as PricingRule["productType"] }))}><option value="hotel">{english ? "Hotels" : "酒店"}</option><option value="flight">{english ? "Flights" : "机票"}</option><option value="all">{english ? "All products" : "全部产品"}</option></select></label><label><span>{english ? "Calculation" : "计算方式"}</span><select value={form.calculationType} onChange={event => setForm(current => ({ ...current, calculationType: event.target.value as PricingRule["calculationType"] }))}><option value="percentage">{english ? "Percentage markup" : "百分比加价"}</option><option value="fixed">{english ? "Fixed service fee" : "固定服务费"}</option></select></label><label><span>{form.calculationType === "percentage" ? english ? "Markup (%)" : "加价比例（%）" : english ? "Fixed amount (CNY)" : "固定金额（CNY）"}</span><input type="number" min="0" step={form.calculationType === "percentage" ? "0.1" : "1"} required value={form.value} onChange={event => setForm(current => ({ ...current, value: Number(event.target.value) }))} /></label><label><span>{english ? "Priority" : "优先级"}</span><input type="number" min="1" required value={form.priority} onChange={event => setForm(current => ({ ...current, priority: Number(event.target.value) }))} /></label></div><div className="modal-actions"><button type="button" className="secondary" onClick={() => setOpen(false)}>{english ? "Cancel" : "取消"}</button><button className="primary" disabled={saving}>{saving ? <><LoaderCircle className="spinner" size={16} />{english ? "Saving…" : "保存中"}</> : english ? "Save rule" : "保存规则"}</button></div></form></div>}
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
      english ? ["Ledger ID", "Order ID", "Type", "Amount", "Currency", "Status", "Time"] : ["流水号", "订单号", "类型", "金额", "币种", "状态", "时间"],
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
    <section className="page-heading compact"><div><p className="eyebrow">FINANCE</p><h1>{english ? "Finance" : "财务结算"}</h1><p>{english ? "Review corporate credit, payments, pending refunds, and reconciliation data." : "查看企业授信、支付流水、退款待处理与对账数据"}</p></div><button className="secondary" onClick={exportLedger} disabled={!summary}><FileText size={16} />{english ? "Export ledger" : "导出流水"}</button></section>
    {error && <div className="error-banner" role="alert">{error}<button onClick={() => setError("")}>{english ? "Dismiss" : "关闭"}</button></div>}
    <div className="wallet-overview"><article><span>{english ? "Available credit" : "账户可用授信"}</span><strong>{money(summary?.availableCredit || 0)}</strong><small>{english ? `Total credit ${money(summary?.totalCredit || 0)} · foreign currencies are separate` : `总授信 ${money(summary?.totalCredit || 0)} · 不混算外币`}</small></article><article><span>{english ? "Paid to date (CNY)" : "累计已支付（CNY）"}</span><strong>{money(summary?.paid || 0)}</strong><small>{summary ? Object.entries(summary.paidByCurrency).filter(([currency]) => currency !== "CNY").map(([currency, amount]) => money(amount, currency)).join(" · ") || (english ? "No foreign-currency payments" : "暂无外币支付") : english ? "Loading…" : "正在加载"}</small></article><article><span>{english ? "Pending refunds (CNY)" : "退款待处理（CNY）"}</span><strong>{money(summary?.refundPending || 0)}</strong><small>{english ? "Foreign-currency refunds remain in their original currency" : "外币退款按原币种单独展示"}</small></article></div>
    <section className="panel operations-panel glass glass-light"><div className="panel-title"><div><h2>{english ? "Ledger" : "资金流水"}</h2><p>{english ? "Payments and refunds use idempotent ledger entries; retries do not duplicate records." : "支付和退款按订单幂等记账，重复请求不会重复入账"}</p></div></div><div className="table-wrap"><table><thead><tr><th>{english ? "Entry" : "流水"}</th><th>{english ? "Order" : "关联订单"}</th><th>{english ? "Type" : "类型"}</th><th>{english ? "Amount" : "金额"}</th><th>{english ? "Status" : "状态"}</th><th>{english ? "Time" : "时间"}</th></tr></thead><tbody>{summary?.entries.length ? summary.entries.map(entry => <tr key={entry.id}><td>{entry.reference}<small className="table-subline">{entry.id.slice(0, 8)}</small></td><td>{entry.orderId || "—"}</td><td>{entry.entryType === "PAYMENT" ? english ? "Order payment" : "订单支付" : entry.entryType === "REFUND_PENDING" ? english ? "Refund pending" : "退款待处理" : entry.entryType}</td><td className="transaction-amount">{money(entry.amount, entry.currency)}</td><td><span className={`business-status ${entry.status.toLowerCase()}`}>{entry.status}</span></td><td>{new Date(entry.createdAt).toLocaleString(locale)}</td></tr>) : <tr><td colSpan={6} className="empty-table-cell">{english ? "No ledger entries yet. A payment will create one automatically." : "暂无资金流水，完成一笔支付后将自动生成。"}</td></tr>}</tbody></table></div></section>
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
      setFxError(error instanceof Error ? error.message : "汇率服务暂时不可用");
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

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
  Landmark,
  LoaderCircle,
  LayoutDashboard,
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
  TicketCheck,
  UserRound,
  Users,
  WalletCards,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import type {
  AccountProfile,
  AccountTraveler,
  Customer,
  DistributionOrder,
  FinanceSummary,
  FlightAfterSalesContext,
  FlightChangeOffer,
  FlightOffer,
  HotelOffer,
  OrderBookingDetails,
  OrderStatus,
  PaymentMethod,
  PricingRule,
} from "./types";

type Page =
  | "dashboard"
  | "hotels"
  | "flights"
  | "orders"
  | "transactions"
  | "account"
  | "customers"
  | "pricing"
  | "finance";

type LocaleCode = "zh-CN" | "zh-TW" | "en";
type DisplayCurrency = "CNY" | "USD" | "HKD" | "SGD";
type TripType = "oneway" | "roundtrip" | "multicity";

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

const money = (value: number, currency = "CNY") =>
  new Intl.NumberFormat("zh-CN", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
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

function StatusPill({ status }: { status: OrderStatus }) {
  return <span className={`status status-${status.toLowerCase()}`}>{statusLabels[status]}</span>;
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
  children,
}: {
  page: Page;
  setPage: (page: Page) => void;
  locale: LocaleCode;
  setLocale: (locale: LocaleCode) => void;
  displayCurrency: DisplayCurrency;
  setDisplayCurrency: (currency: DisplayCurrency) => void;
  accountIdentity: Pick<AccountProfile, "name" | "avatarUrl">;
  children: React.ReactNode;
}) {
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [preferenceOpen, setPreferenceOpen] = useState<"language" | "currency" | "">("");
  const [tenantOpen, setTenantOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const copy = shellCopy[locale];
  const consumerMode = ["hotels", "flights", "orders", "transactions", "account"].includes(page);
  const nav = [
    { id: "dashboard" as Page, label: copy.nav.dashboard, shortLabel: copy.nav.dashboard, icon: LayoutDashboard },
    { id: "hotels" as Page, label: copy.nav.hotels, shortLabel: copy.nav.hotels, icon: BedDouble },
    { id: "flights" as Page, label: copy.nav.flights, shortLabel: copy.nav.flights, icon: Plane },
    { id: "orders" as Page, label: copy.nav.orders, shortLabel: copy.nav.orders, icon: TicketCheck },
    { id: "customers" as Page, label: copy.nav.customers, shortLabel: copy.nav.customers, icon: Users },
    { id: "pricing" as Page, label: copy.nav.pricing, shortLabel: copy.nav.pricing, icon: BadgePercent },
    { id: "finance" as Page, label: copy.nav.finance, shortLabel: copy.nav.finance, icon: WalletCards },
  ];
  return (
    <div className={`app-shell ${consumerMode ? "consumer-shell" : ""}`}>
      <main className="main">
        <header className="booking-header glass glass-dark">
          <div className="header-primary">
            <button className="top-brand" onClick={() => setPage("dashboard")} aria-label="返回经营总览">
              <span className="brand-mark">F</span>
              <span><strong>FusionGo</strong><small>全球商旅分销平台</small></span>
            </button>
            <button className="top-tenant" aria-label="当前企业：寰宇旅行" aria-haspopup="menu" aria-expanded={tenantOpen} onClick={() => { setTenantOpen(value => !value); setHelpOpen(false); setNotificationsOpen(false); setPreferenceOpen(""); }}>
              <span className="tenant-logo"><Building2 size={17} /></span>
              <span><strong>{copy.tenant}</strong><small>{copy.plan}</small></span>
              <ChevronDown size={14} />
            </button>
            <div className="top-actions">
              <span className="environment"><i /> {copy.environment}</span>
              <div className="utility-control">
                <button className="header-utility" aria-label={`${copy.currency}：${displayCurrency}`} aria-haspopup="menu" aria-expanded={preferenceOpen === "currency"} onClick={() => { setTenantOpen(false); setHelpOpen(false); setNotificationsOpen(false); setPreferenceOpen(value => value === "currency" ? "" : "currency"); }}>{displayCurrency}<ChevronDown size={13} /></button>
                {preferenceOpen === "currency" && <div className="preference-popover glass glass-light" role="menu" aria-label={copy.currency}>
                  <header><strong>{copy.currency}</strong><button onClick={() => setPreferenceOpen("")} aria-label="关闭"><X size={16} /></button></header>
                  {(["CNY", "USD", "HKD", "SGD"] as DisplayCurrency[]).map(currency => <button key={currency} role="menuitemradio" aria-checked={displayCurrency === currency} onClick={() => { setDisplayCurrency(currency); setPreferenceOpen(""); }}><span><strong>{currency}</strong><small>{{ CNY: "人民币", USD: "US Dollar", HKD: "港币", SGD: "Singapore Dollar" }[currency]}</small></span>{displayCurrency === currency && <Check size={16} />}</button>)}
                  <p>{copy.currencyNote}</p>
                </div>}
              </div>
              <div className="utility-control">
                <button className="header-utility" aria-label={`${copy.language}：${localeNames[locale]}`} aria-haspopup="menu" aria-expanded={preferenceOpen === "language"} onClick={() => { setTenantOpen(false); setHelpOpen(false); setNotificationsOpen(false); setPreferenceOpen(value => value === "language" ? "" : "language"); }}><Globe2 size={16} />{localeNames[locale]}<ChevronDown size={13} /></button>
                {preferenceOpen === "language" && <div className="preference-popover glass glass-light" role="menu" aria-label={copy.language}>
                  <header><strong>{copy.language}</strong><button onClick={() => setPreferenceOpen("")} aria-label="关闭"><X size={16} /></button></header>
                  {([
                    ["zh-CN", "简体中文"],
                    ["zh-TW", "繁體中文"],
                    ["en", "English"],
                  ] as Array<[LocaleCode, string]>).map(([code, label]) => <button key={code} role="menuitemradio" aria-checked={locale === code} onClick={() => { setLocale(code); setPreferenceOpen(""); }}><span><strong>{label}</strong><small>{code}</small></span>{locale === code && <Check size={16} />}</button>)}
                </div>}
              </div>
              <button className="icon-button" aria-label="帮助与支持" aria-expanded={helpOpen} onClick={() => { setTenantOpen(false); setPreferenceOpen(""); setNotificationsOpen(false); setHelpOpen(value => !value); }}><CircleHelp size={19} /></button>
              <button className="icon-button" aria-label="通知" aria-expanded={notificationsOpen} onClick={() => { setTenantOpen(false); setHelpOpen(false); setPreferenceOpen(""); setNotificationsOpen(value => !value); }}><Bell size={19} /><b>3</b></button>
              <button className="header-profile" onClick={() => setPage("account")} aria-label="打开账户设置">
                <span>{accountIdentity.avatarUrl ? <img src={accountIdentity.avatarUrl} alt="" /> : accountIdentity.name.slice(0, 1)}</span><strong>{accountIdentity.name}</strong><ChevronDown size={14} />
              </button>
            </div>
            {notificationsOpen && <div className="notification-popover glass glass-light" role="dialog" aria-label="通知中心">
              <div><strong>通知中心</strong><button className="drawer-close" onClick={() => setNotificationsOpen(false)} aria-label="关闭通知"><X size={17} /></button></div>
              <button onClick={() => { setNotificationsOpen(false); setPage("orders"); }}><TicketCheck size={17} /><span><strong>订单状态待确认</strong><small>有 2 个订单正在等待上游处理</small></span></button>
              <button onClick={() => { setNotificationsOpen(false); setPage("finance"); }}><ReceiptText size={17} /><span><strong>本月账单可核对</strong><small>请在结算日前完成差异确认</small></span></button>
              <button onClick={() => setNotificationsOpen(false)}><ShieldCheck size={17} /><span><strong>账户安全正常</strong><small>最近登录设备未发现异常</small></span></button>
            </div>}
            {tenantOpen && <div className="notification-popover tenant-popover glass glass-light" role="menu" aria-label="企业菜单"><div><strong>寰宇旅行</strong><button className="drawer-close" onClick={() => setTenantOpen(false)} aria-label="关闭企业菜单"><X size={17} /></button></div><button role="menuitem" onClick={() => { setTenantOpen(false); setPage("account"); }}><UserRound size={17} /><span><strong>企业与账户设置</strong><small>个人资料、安全和通知偏好</small></span></button><button role="menuitem" onClick={() => { setTenantOpen(false); setPage("customers"); }}><Users size={17} /><span><strong>客户管理</strong><small>客户状态、联系人和授信额度</small></span></button></div>}
            {helpOpen && <div className="notification-popover help-popover glass glass-light" role="dialog" aria-label="帮助与支持"><div><strong>帮助与支持</strong><button className="drawer-close" onClick={() => setHelpOpen(false)} aria-label="关闭帮助"><X size={17} /></button></div><p className="header-popover-copy">当前为 Sandbox 环境。订单异常请先记录订单号、requestId 和 traceId，再进入订单中心核对上游状态。</p><button onClick={() => { setHelpOpen(false); setPage("orders"); }}><TicketCheck size={17} /><span><strong>前往订单中心</strong><small>查询订单与供应商同步状态</small></span></button><button onClick={() => { setHelpOpen(false); setPage("dashboard"); }}><CircleHelp size={17} /><span><strong>返回经营总览</strong><small>查看待处理异常和快捷入口</small></span></button></div>}
          </div>
          <div className="header-secondary">
            <nav className="booking-nav" aria-label="主导航">
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
            <button className="header-search" onClick={() => setPage("orders")} aria-label="搜索订单、客户或目的地">
              <Search size={16} /><span>搜索订单、客户或目的地</span><kbd>⌘ K</kbd>
            </button>
          </div>
        </header>
        <div className={`page ${consumerMode ? "consumer-page" : ""}`}>{children}</div>
      </main>
    </div>
  );
}

function Dashboard({ navigate }: { navigate: (page: Page) => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.dashboard>>>();
  useEffect(() => { api.dashboard().then(setData); }, []);
  const stats = [
    { label: "今日交易额", value: data ? money(data.salesToday) : "—", delta: "+12.8%", icon: CreditCard, tone: "blue" },
    { label: "今日订单", value: data?.ordersToday ?? "—", delta: "+8.2%", icon: TicketCheck, tone: "violet" },
    { label: "预订成功率", value: data ? `${data.successRate}%` : "—", delta: "+1.4%", icon: ShieldCheck, tone: "green" },
    { label: "待处理异常", value: data?.alerts ?? "—", delta: "需关注", icon: Bell, tone: "orange" },
  ];
  return (
    <>
      <section className="page-heading">
        <div><p className="eyebrow">2026年7月29日 · 星期三</p><h1>早上好，林嘉诚</h1><p>这是寰宇旅行今天的业务表现与待办事项。</p></div>
        <button className="primary" onClick={() => navigate("hotels")}><Search size={17} />创建新预订</button>
      </section>
      <section className="stat-grid">
        {stats.map(({ label, value, delta, icon: Icon, tone }) => (
          <article className="stat-card" key={label}>
            <div className={`stat-icon ${tone}`}><Icon size={20} /></div>
            <span>{label}</span><strong>{value}</strong><small className={delta === "需关注" ? "warn" : ""}>{delta} <em>较昨日</em></small>
          </article>
        ))}
      </section>
      <section className="dashboard-grid">
        <article className="panel performance">
          <div className="panel-title"><div><h2>交易趋势</h2><p>近 7 天酒店与机票成交额</p></div><button className="secondary">近7天 <ChevronDown size={14} /></button></div>
          <div className="chart-legend"><span><i className="hotel-dot" />酒店</span><span><i className="flight-dot" />机票</span></div>
          <div className="chart">
            {[42, 66, 53, 72, 61, 88, 78].map((n, i) => <div key={i} className="chart-column"><div className="bars"><i style={{ height: `${n}%` }} /><b style={{ height: `${Math.max(25, n - 18)}%` }} /></div><span>{["周四","周五","周六","周日","周一","周二","今天"][i]}</span></div>)}
          </div>
        </article>
        <article className="panel quick-actions">
          <div className="panel-title"><div><h2>快捷操作</h2><p>常用业务入口</p></div></div>
          <button onClick={() => navigate("hotels")}><span className="action-icon hotel"><BedDouble size={21} /></span><div><strong>酒店预订</strong><small>全球酒店实时库存</small></div><span>→</span></button>
          <button onClick={() => navigate("flights")}><span className="action-icon flight"><Plane size={21} /></span><div><strong>机票预订</strong><small>国际航班与实时运价</small></div><span>→</span></button>
          <button onClick={() => navigate("orders")}><span className="action-icon order"><TicketCheck size={21} /></span><div><strong>订单处理</strong><small>3 个订单等待处理</small></div><span>→</span></button>
        </article>
      </section>
      <OrderTable orders={data?.recentOrders ?? []} onAll={() => navigate("orders")} />
    </>
  );
}

function OrderTable({ orders, onAll, onSelect }: { orders: DistributionOrder[]; onAll?: () => void; onSelect?: (order: DistributionOrder) => void }) {
  return (
    <section className="panel orders-panel">
      <div className="panel-title"><div><h2>最新订单</h2><p>实时同步 FCG 上游状态</p></div>{onAll && <button className="text-button" onClick={onAll}>查看全部 →</button>}</div>
      <div className="table-wrap"><table><thead><tr><th>订单号</th><th>产品</th><th>客户</th><th>金额</th><th>状态</th><th>创建时间</th>{onSelect && <th>操作</th>}</tr></thead>
      <tbody>{orders.map(order => <tr key={order.id}><td><strong>{order.id}</strong><small>{order.supplierOrderNo || "等待上游单号"}</small></td><td><div className="product-cell"><span className={order.productType}><>{order.productType === "hotel" ? <BedDouble size={16} /> : <Plane size={16} />}</></span><div>{order.title}<small>{order.subtitle}</small></div></div></td><td>{order.customer}</td><td><strong>{money(order.amount, order.currency)}</strong></td><td><StatusPill status={order.status} /></td><td>{order.createdAt}</td>{onSelect && <td><button className="table-action" onClick={() => onSelect(order)}>查看详情</button></td>}</tr>)}</tbody></table></div>
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
    <div className="confirmation-panel glass glass-light"><div><Mail size={18} /><span><strong>确认信息已发送</strong><small>电子确认单将发送至预订联系人邮箱</small></span></div><button className="secondary" onClick={() => downloadOrderDocument(order.id, "confirmation")}><FileText size={16} />下载确认单</button></div>
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
  const [contactName, setContactName] = useState("林嘉诚");
  const [contactPhone, setContactPhone] = useState("13800008866");
  const [contactEmail, setContactEmail] = useState("lin@example.com");
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
      setContactName(bookingDetails.contactName || contactName);
      setContactPhone(bookingDetails.phone || contactPhone);
      setContactEmail(bookingDetails.email || contactEmail);
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
    if (!window.confirm("确认提交改签申请？提交后将由供应商审核并可能产生差价。")) return;
    void run("apply-change", () => api.applyFlightChange(order.id, {
      priceKey: selectedOffer,
      passengerCodes,
      segmentIds,
      changeType: 1,
      reasonType: afterSalesType,
      reason,
      evidenceFiles: evidenceText.split(/\s|,/).map(value => value.trim()).filter(Boolean),
      contact: { name: contactName, phone: contactPhone, email: contactEmail },
    }));
  };
  const applyRefund = () => {
    if (!window.confirm("确认提交退票申请？出票后退票可能产生航司手续费。")) return;
    void run("apply-refund", () => api.applyFlightRefund(order.id, {
      passengerCodes,
      segmentIds,
      refundType: afterSalesType,
      reason,
      evidenceFiles: evidenceText.split(/\s|,/).map(value => value.trim()).filter(Boolean),
      contact: { name: contactName, phone: contactPhone, email: contactEmail },
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
          <label><span>联系人</span><input value={contactName} onChange={event => setContactName(event.target.value)} /></label>
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
  onBack,
  onRestart,
  onOrderChange,
}: {
  initialOrder: DistributionOrder;
  onBack: () => void;
  onRestart?: () => void;
  onOrderChange?: (order: DistributionOrder) => void;
}) {
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
      const synchronizedAt = new Intl.DateTimeFormat("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).format(new Date());
      setNotice(refreshed.status === previousStatus
        ? `已于 ${synchronizedAt} 向上游同步，当前状态仍为“${statusLabels[refreshed.status]}”。`
        : `状态已从“${statusLabels[previousStatus]}”更新为“${statusLabels[refreshed.status]}”（${synchronizedAt}）。`);
    }
    catch (caught) { setError(caught instanceof Error ? caught.message : "订单状态刷新失败"); }
    finally { setLoading(""); }
  };
  const cancel = async () => {
    if (!window.confirm(`确认取消订单 ${order.id}？取消结果以上游政策为准。`)) return;
    setLoading("cancel"); setError("");
    try {
      const cancelled = await api.cancelOrder(order.id);
      setOrder(cancelled);
      onOrderChange?.(cancelled);
      setNotice("取消结果已同步到订单列表。");
    }
    catch (caught) { setError(caught instanceof Error ? caught.message : "订单取消失败"); }
    finally { setLoading(""); }
  };
  const downloadReceipt = () => downloadOrderDocument(order.id, "receipt");
  const downloadTicket = () => {
    if (order.status !== "TICKETED") {
      setNotice("航司尚未出票，电子客票将在状态变为“已出票”后开放下载。");
      return;
    }
    downloadOrderDocument(order.id, "ticket");
  };
  useEffect(() => {
    let active = true;
    api.getOrderDetails(order.id).then(details => {
      if (active) setBookingDetails(details);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [order.id]);
  return <section className="booking-flow-page order-detail-page">
    <button className="back-link" onClick={onBack}><ArrowLeft size={17} />返回上一页</button>
    <BookingProgress current={5} labels={flight ? ["查询", "选择航班", "乘机人", "支付", "出票确认", "订单详情"] : ["查询", "搜索结果", "酒店详情", "下单支付", "预订确认", "订单详情"]} />
    <header className="order-detail-head glass glass-light">
      <div><p className="eyebrow">{flight ? "FLIGHT ORDER" : "HOTEL ORDER"}</p><h1>{order.title}</h1><p>{order.subtitle}</p></div>
      <div className="order-status-stack"><StatusPill status={order.status} /><span>本地订单号 {order.id}</span><span>上游订单号 {order.supplierOrderNo || "确认后生成"}</span></div>
    </header>
    <div className="order-detail-grid">
      <div className="order-detail-main">
        <section className="detail-section glass glass-light"><div className="panel-title"><div><h2>{flight ? "航班与乘机人" : "住宿与入住人"}</h2><p>预订核心信息</p></div></div>
          <div className="order-product-summary"><span className={`product-hero-icon ${order.productType}`}>{flight ? <Plane size={25} /> : <BedDouble size={25} />}</span><div><strong>{order.title}</strong><span>{order.subtitle}</span><small>{flight ? "经济舱 · 成人 1 位 · 行李 1件23kg" : bookingDetails?.hotelStay ? `${bookingDetails.hotelStay.roomNum}间 · ${bookingDetails.hotelStay.nights}晚 · 成人 ${bookingDetails.hotelStay.numberOfAdults}位` : "住宿信息读取中…"}</small></div></div>
          <div className="detail-facts"><span><UserRound size={17} /><b>{bookingDetails?.travelerName || "读取中…"}</b><small>{flight ? (bookingDetails?.documentMasked ? `证件 ${bookingDetails.documentMasked}` : "乘机人资料") : "主要入住人"}</small></span><span><Mail size={17} /><b>{bookingDetails?.email || "—"}</b><small>确认通知邮箱</small></span><span><Phone size={17} /><b>{bookingDetails?.phone || "—"}</b><small>紧急联系人</small></span></div>
        </section>
        <section className="detail-section glass glass-light"><div className="panel-title"><div><h2>{flight ? "票务与服务" : "政策与入住须知"}</h2><p>具体执行以上游确认结果为准</p></div></div>
          <div className="policy-list">
            <div><ShieldCheck size={18} /><span><strong>{flight ? "退改签规则" : "取消政策"}</strong><small>{flight ? "出票后退改费用以航司运价规则计算" : "入住前1天可免费取消，逾期按首晚房费收取"}</small></span><ChevronRight size={17} /></div>
            <div><Luggage size={18} /><span><strong>{flight ? "行李与选座" : "入住权益"}</strong><small>{flight ? "托运行李 1件23kg，可在订单中继续增购" : "含双早、免费 Wi-Fi、健身中心及泳池"}</small></span><ChevronRight size={17} /></div>
            <div><FileText size={18} /><span><strong>电子凭证</strong><small>{flight ? "出票完成后可下载电子客票与行程单" : "酒店确认后可下载入住确认单"}</small></span><ChevronRight size={17} /></div>
          </div>
        </section>
      </div>
      <aside className="order-side glass glass-light"><h2>订单金额</h2><div className="price-lines"><span>产品金额<b>{money(order.amount, order.currency)}</b></span><span>税费与服务费<b>已包含</b></span><span className="total">实付总额<strong>{money(order.amount, order.currency)}</strong></span></div><p className="policy-note"><ShieldCheck size={16} />企业授信账户 · 安全支付</p>
        {error && <p className="error-copy" role="alert">{error}</p>}
        {notice && <p className="notice-copy" role="status">{notice}</p>}
        <button className="primary wide-action" onClick={refresh} disabled={Boolean(loading)}>{loading === "refresh" ? <><LoaderCircle className="spinner" size={17} />刷新中</> : <><RefreshCw size={17} />刷新订单状态</>}</button>
        {flight && <button className="secondary wide-action" onClick={() => setShowAfterSales(true)}><RefreshCw size={17} />退票 / 改签</button>}
        {flight && <button className="secondary wide-action" onClick={downloadTicket}><TicketCheck size={17} />在线值机 / 下载客票</button>}
        <button className="secondary wide-action" onClick={downloadReceipt}><ReceiptText size={17} />下载电子收据</button>
        {canCancel && <button className="danger-action wide-action" onClick={cancel} disabled={Boolean(loading)}>{loading === "cancel" ? "取消处理中…" : "取消订单"}</button>}
        {onRestart && <button className="text-button wide-action" onClick={onRestart}>重新预订</button>}
      </aside>
    </div>
    {showAfterSales && <FlightAfterSalesPanel order={order} onClose={() => setShowAfterSales(false)} onOrderChange={changed => { setOrder(changed); onOrderChange?.(changed); }} />}
  </section>;
}

function HotelCheckout({ offer, onBack, onComplete }: { offer: HotelOffer; onBack: () => void; onComplete: (order: DistributionOrder) => void }) {
  const roomNum = offer.roomNum || 1;
  const nights = offer.nights || 1;
  const [guestNames, setGuestNames] = useState<string[]>(() => Array.from(
    { length: roomNum },
    (_, index) => index === 0 ? "LIN JIACHENG" : "",
  ));
  const [contactName, setContactName] = useState("林嘉诚");
  const [phone, setPhone] = useState("13800008866");
  const [email, setEmail] = useState("lin@example.com");
  const [arrivalWindow, setArrivalWindow] = useState("18:00-20:00");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("credit");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const total = offer.totalPrice ?? offer.nightlyPrice * nights * roomNum;
  const updateGuestName = (index: number, value: string) => {
    setGuestNames(current => current.map((name, guestIndex) => guestIndex === index ? value.toUpperCase() : name));
    setError("");
  };
  const submit = async () => {
    if (guestNames.some(name => !name.trim()) || !contactName.trim() || phone.length < 8 || !email.includes("@")) return setError(`请为 ${roomNum} 间房分别填写主要入住人，并补全联系人信息`);
    if (guestNames.some(name => !/^[A-Za-z]+(?: [A-Za-z]+)*$/.test(name.trim()))) return setError("入住人英文姓名只能包含英文字母和空格");
    setLoading(true); setError("");
    try {
      const guests = guestNames.map((guestName, index) => {
        const [lastName, ...givenNames] = guestName.trim().split(/\s+/);
        return { roomIndex: index + 1, firstName: givenNames.join(" ") || lastName, lastName };
      });
      const [arriveTime, latestArriveTime] = arrivalWindow === "22:00后" ? ["22:00", "23:59"] : arrivalWindow.split("-");
      const created = await api.createOrder({
        productType: "hotel",
        offerId: offer.id,
        guests,
        contact: { name: contactName, phone, email },
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
        {guestNames.map((guestName, index) => <div className="room-guest-row" key={index}><strong>房间 {index + 1}</strong><label><span>主要入住人英文姓名</span><div className="light-field"><UserRound size={17} /><input aria-label={`房间${index + 1}主要入住人`} autoComplete="name" value={guestName} onChange={event => updateGuestName(index, event.target.value)} placeholder="ZHANG SAN" /></div><small>必须与入住证件一致</small></label></div>)}
      </div><div className="form-grid stay-preferences">
        <label><span>预计到店时间</span><select value={arrivalWindow} onChange={event => setArrivalWindow(event.target.value)}><option>18:00-20:00</option><option>20:00-22:00</option><option>22:00后</option></select></label>
        <label><span>床型偏好</span><select defaultValue="大床"><option>大床</option><option>双床</option></select></label>
      </div></section>
      <section className="form-section glass glass-light"><div className="section-title"><span>2</span><div><h2>联系人</h2><p>用于接收确认单和异常通知</p></div></div><div className="form-grid">
        <label><span>联系人姓名</span><div className="light-field"><UserRound size={17} /><input value={contactName} onChange={event => { setContactName(event.target.value); setError(""); }} /></div></label>
        <label><span>手机号码</span><div className="light-field"><Phone size={17} /><input value={phone} onChange={event => { setPhone(event.target.value); setError(""); }} /></div></label>
        <label className="wide"><span>电子邮箱</span><div className="light-field"><Mail size={17} /><input type="email" value={email} onChange={event => { setEmail(event.target.value); setError(""); }} /></div></label>
      </div></section>
      <section className="form-section glass glass-light"><div className="section-title"><span>3</span><div><h2>支付方式</h2><p>{offer.inventorySource === "simulation" ? "本次为本地模拟支付，不会向 G-Link 发起真实扣款" : "企业授信余额充足，支付结果以 G-Link 回调为准"}</p></div></div>
        <label className={`payment-option ${paymentMethod === "credit" ? "selected" : ""}`}><input type="radio" checked={paymentMethod === "credit"} onChange={() => setPaymentMethod("credit")} name="hotel-payment" /><Landmark size={20} /><span><strong>企业授信账户</strong><small>可用额度 {money(128600)}</small></span>{paymentMethod === "credit" && <CheckCircle2 size={19} />}</label>
        <label className={`payment-option ${paymentMethod === "card" ? "selected" : ""}`}><input type="radio" checked={paymentMethod === "card"} onChange={() => setPaymentMethod("card")} name="hotel-payment" /><CreditCard size={20} /><span><strong>银行卡支付</strong><small>沙箱可模拟；生产需启用收单渠道</small></span>{paymentMethod === "card" && <CheckCircle2 size={19} />}</label>
      </section>
    </div><aside className="price-summary glass glass-light">
      <img src={offer.image} alt="" /><h2>{offer.name}</h2><p>{offer.district}</p>
      <div className="summary-detail"><span>{stayDateLabel(offer.checkInDate)} 入住</span><span>{stayDateLabel(offer.checkOutDate)} 退房 · {nights}晚</span><span>{offer.roomName} · {roomNum}间</span><span>{offer.numberOfAdults || roomNum}位成人 · {offer.breakfast}</span></div>
      <div className="price-lines"><span>房费（{nights}晚 × {roomNum}间）<b>{money(total, offer.currency)}</b></span><span>税费及服务费<b>已包含</b></span><span className="total">应付总额<strong>{money(total, offer.currency)}</strong></span></div>
      <p className="policy-note"><ShieldCheck size={16} />{offer.cancelPolicy}</p>{error && <p className="error-copy" role="alert">{error}</p>}
      <button className="primary pay-button" onClick={submit} disabled={loading} aria-busy={loading}>{loading ? <><LoaderCircle className="spinner" size={18} />创建订单并支付</> : <><LockKeyhole size={17} />确认支付 {money(total, offer.currency)}</>}</button>
      <small className="secure-copy">提交即表示同意预订条款、取消政策与隐私政策</small>
    </aside></div>
  </section>;
}

function HotelDetail({ offer, onBack, onCheckout }: { offer: HotelOffer; onBack: () => void; onCheckout: (availability: { price: number; currency: string }) => void }) {
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [rateFilter, setRateFilter] = useState<"all" | "breakfast" | "cancel" | "prepaid">("all");
  const check = async () => {
    setChecking(true); setError("");
    try { onCheckout(await api.checkHotelAvailability(offer.id)); } catch (caught) { setError(caught instanceof Error ? caught.message : "当前房型无法预订"); } finally { setChecking(false); }
  };
  return <section className="booking-flow-page">
    <button className="back-link" onClick={onBack}><ArrowLeft size={17} />返回搜索结果</button>
    <BookingProgress current={2} labels={["查询", "搜索结果", "酒店详情", "下单支付", "预订确认", "订单详情"]} />
    <SimulationNotice offer={offer} />
    <div className="hotel-gallery"><img className="gallery-main" src={offer.image} alt={`${offer.name}外观`} /><img src="https://images.unsplash.com/photo-1611892440504-42a792e24d32?auto=format&fit=crop&w=900&q=80" alt="客房" /><img src="https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=900&q=80" alt="酒店设施" /></div>
    <div className="hotel-detail-layout"><div><p className="stars">{"★".repeat(offer.stars)}</p><h1>{offer.name}</h1><p className="detail-location"><MapPin size={16} />{offer.district} · 距市中心 1.8 km</p>
      <div className="amenity-strip">{["免费 Wi-Fi", "24小时前台", "健身中心", "室内泳池", "行李寄存"].map(item => <span key={item}><Check size={14} />{item}</span>)}</div>
      <section className="detail-copy"><h2>酒店亮点</h2><p>在城市核心地段享受舒适住宿体验。房间拥有开阔景观，商务与休闲设施完善，适合企业差旅及度假出行。</p></section>
      <div className="rate-filter-bar glass glass-light"><strong>选择房型与价格</strong>
        {([
          ["all", "全部房型"],
          ["breakfast", "含早餐"],
          ["cancel", "免费取消"],
          ["prepaid", "在线预付"],
        ] as const).map(([value, label]) => <button key={value} className={rateFilter === value ? "active" : ""} aria-pressed={rateFilter === value} onClick={() => setRateFilter(value)}>{label}</button>)}
      </div>
      <section className="room-offer glass glass-light"><div className="room-photo"><img src="https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=700&q=80" alt="" /></div><div className="room-copy"><p className="eyebrow">RECOMMENDED RATE</p><h2>{offer.roomName}</h2><span>{offer.roomNum || 1}间 · {offer.numberOfAdults || 2}位成人 · {offer.nights || 1}晚</span><ul><li><Check size={15} />{offer.breakfast}</li><li><Check size={15} />{offer.cancelPolicy}</li><li><Check size={15} />到店前无需再次确认</li></ul></div><div className="room-price"><small>每间每晚含税</small><strong>{money(offer.nightlyPrice, offer.currency)}</strong><span>{offer.nights || 1}晚 × {offer.roomNum || 1}间，共 {money(offer.totalPrice ?? offer.nightlyPrice * (offer.nights || 1) * (offer.roomNum || 1), offer.currency)}</span><button className="primary" onClick={check} disabled={checking}>{checking ? <><LoaderCircle className="spinner" size={17} />正在确认库存</> : "预订此房型"}</button>{error && <p className="error-copy">{error}</p>}</div></section>
      <section className="compact-rate-list glass glass-light" aria-label="其他价格计划">
        {rateFilter !== "prepaid" && <div><span><strong>灵活取消价</strong><small>含双早 · 入住前1天免费取消 · 在线预付</small></span><b>{money(offer.nightlyPrice + 120)}</b><button className="secondary" onClick={check}>选择</button></div>}
        {(rateFilter === "all" || rateFilter === "prepaid") && <div><span><strong>会员专享价</strong><small>不含早 · 不可取消 · 在线预付 · 即时确认</small></span><b>{money(Math.max(1, offer.nightlyPrice - 80))}</b><button className="secondary" onClick={check}>选择</button></div>}
      </section>
    </div><aside className="detail-rating glass glass-light"><strong>{offer.rating}</strong><span>卓越</span><small>基于 1,284 条真实点评</small><hr /><p>“位置极佳，服务专业，客房景观非常出色。”</p></aside></div>
  </section>;
}

function HotelSearch({ navigate }: { navigate: (page: Page) => void }) {
  const [destination, setDestination] = useState("上海");
  const [checkIn, setCheckIn] = useState("2026-08-12");
  const [checkOut, setCheckOut] = useState("2026-08-14");
  const [lastSearch, setLastSearch] = useState("上海");
  const [items, setItems] = useState<HotelOffer[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState("");
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [occupancyOpen, setOccupancyOpen] = useState(false);
  const [rooms, setRooms] = useState(1);
  const [adults, setAdults] = useState(2);
  const [maxPrice, setMaxPrice] = useState(3000);
  const [starFilters, setStarFilters] = useState<number[]>([]);
  const [minRating, setMinRating] = useState(0);
  const [hotelSort, setHotelSort] = useState<"recommended" | "price" | "rating">("recommended");
  const [mapOpen, setMapOpen] = useState(false);
  const [selection, setSelection] = useState<HotelOffer>();
  const [hydratingId, setHydratingId] = useState("");
  const [stage, setStage] = useState<"home" | "results" | "detail" | "checkout" | "result" | "orderDetail">("home");
  const [order, setOrder] = useState<DistributionOrder>();
  const resultsRef = useRef<HTMLElement>(null);
  const suggestions = useMemo(() => {
    const normalized = destination.trim().toLowerCase();
    return [
      { name: "上海", detail: "中国 · 商务与度假热门" },
      { name: "香港", detail: "中国香港 · 海港城市" },
      { name: "北京", detail: "中国 · 历史文化名城" },
      { name: "深圳", detail: "中国 · 粤港澳大湾区" },
      { name: "曼谷", detail: "泰国 · 热门国际目的地" },
    ].filter(item => !normalized || `${item.name}${item.detail}`.toLowerCase().includes(normalized)).slice(0, 5);
  }, [destination]);
  const visibleHotels = useMemo(() => {
    const filtered = items.filter(hotel =>
      hotel.nightlyPrice <= maxPrice
      && (!starFilters.length || starFilters.includes(hotel.stars))
      && hotel.rating >= minRating);
    return [...filtered].sort((a, b) => hotelSort === "price"
      ? a.nightlyPrice - b.nightlyPrice
      : hotelSort === "rating" ? b.rating - a.rating : 0);
  }, [hotelSort, items, maxPrice, minRating, starFilters]);
  const search = async () => {
    const cleanDestination = destination.trim();
    if (!cleanDestination) {
      setError("请输入城市、地标或酒店名称");
      return;
    }
    if (!checkIn || !checkOut) {
      setError("请选择完整的入住和退房日期");
      return;
    }
    if (checkOut <= checkIn) {
      setError("退房日期必须晚于入住日期");
      return;
    }
    setLoading(true);
    setError("");
    setSuggestionsOpen(false);
    setOccupancyOpen(false);
    setItems([]);
    setLastSearch(cleanDestination);
    setHasSearched(true);
    try {
      const nextItems = await api.searchHotels({ destination: cleanDestination, checkIn, checkOut, rooms, adults });
      setItems(nextItems);
      setStage("results");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "酒店搜索失败");
    } finally {
      setLoading(false);
    }
  };
  const chooseHotel = async (hotel: HotelOffer) => {
    setHydratingId(hotel.id);
    setSuggestionsOpen(false);
    setError("");
    try {
      setSelection(await api.getHotelProduct(hotel.id));
      setStage("detail");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "实时房型查询失败");
    } finally {
      setHydratingId("");
    }
  };
  useEffect(() => { window.scrollTo({ top: 0, behavior: "auto" }); }, [stage]);
  const searchForm = <form className="search-card glass glass-dark" aria-label="酒店搜索" noValidate onSubmit={event => { event.preventDefault(); void search(); }}>
    <label className="search-field field-destination"><span>目的地 / 酒店</span><div><MapPin size={18} /><input aria-label="目的地或酒店" autoComplete="off" value={destination} onFocus={() => setSuggestionsOpen(true)} onBlur={() => window.setTimeout(() => setSuggestionsOpen(false), 120)} onChange={e => { setDestination(e.target.value); setSuggestionsOpen(true); setError(""); }} onKeyDown={event => { if (event.key === "Escape") setSuggestionsOpen(false); if (event.key === "Enter") { event.preventDefault(); void search(); } }} /></div>
      {suggestionsOpen && <div className="light-popover glass glass-light" role="listbox" aria-label="目的地建议">
        {suggestions.length ? suggestions.map((item, index) => <button type="button" key={item.name} role="option" aria-selected={index === 0} onMouseDown={event => { event.preventDefault(); setDestination(item.name); setSuggestionsOpen(false); }}><MapPin size={16} /><span><strong>{item.name}</strong><small>{item.detail}</small></span></button>) : <p className="suggestion-empty">按回车直接搜索“{destination.trim()}”</p>}
      </div>}
    </label>
    <label className="search-field"><span>入住日期</span><div><CalendarDays size={18} /><input aria-label="入住日期" type="date" value={checkIn} onChange={e => { const next = e.target.value; setCheckIn(next); setError(""); if (checkOut && checkOut <= next) { const following = new Date(`${next}T00:00:00`); following.setDate(following.getDate() + 1); setCheckOut(localDateValue(following)); } }} /></div></label>
    <label className="search-field"><span>退房日期</span><div><CalendarDays size={18} /><input aria-label="退房日期" type="date" min={checkIn} value={checkOut} onChange={e => { setCheckOut(e.target.value); setError(""); }} /></div></label>
    <div className="search-field occupancy-field"><span>房间与住客</span><button type="button" className="field-button" onClick={() => setOccupancyOpen(value => !value)} aria-expanded={occupancyOpen}><Users size={18} />{rooms}间 · {adults}位成人<ChevronDown size={15} /></button>
      {occupancyOpen && <div className="light-popover traveler-popover glass glass-light" role="dialog" aria-label="选择房间与住客">
        <div><span><strong>房间</strong><small>最多 8 间</small></span><div className="counter"><button type="button" onClick={() => setRooms(Math.max(1, rooms - 1))} disabled={rooms === 1} aria-label="减少房间"><Minus size={15} /></button><b>{rooms}</b><button type="button" onClick={() => setRooms(Math.min(8, rooms + 1))} disabled={rooms === 8} aria-label="增加房间"><Plus size={15} /></button></div></div>
        <div><span><strong>成人</strong><small>每间至少 1 位</small></span><div className="counter"><button type="button" onClick={() => setAdults(Math.max(rooms, adults - 1))} disabled={adults === rooms} aria-label="减少成人"><Minus size={15} /></button><b>{adults}</b><button type="button" onClick={() => setAdults(Math.min(16, adults + 1))} disabled={adults === 16} aria-label="增加成人"><Plus size={15} /></button></div></div>
        <button type="button" className="popover-done" onClick={() => setOccupancyOpen(false)}>完成</button>
      </div>}
    </div>
    <button type="submit" className="primary search-cta" disabled={loading} aria-busy={loading}>{loading ? <><LoaderCircle className="spinner" size={18} />正在搜索</> : <><Search size={18} />搜索酒店</>}</button>
    {error && <div className="search-inline-error" role="alert"><CircleHelp size={16} /><span>{error}</span><button type="button" onClick={() => void search()}>重试</button></div>}
  </form>;
  if (selection && stage === "detail") return <HotelDetail offer={selection} onBack={() => setStage("results")} onCheckout={availability => { setSelection(current => current ? { ...current, totalPrice: availability.price, currency: availability.currency } : current); setStage("checkout"); }} />;
  if (selection && stage === "checkout") return <HotelCheckout offer={selection} onBack={() => setStage("detail")} onComplete={created => { setOrder(created); setStage("result"); }} />;
  if (order && stage === "result") return <BookingResult order={order} type="hotel" onDetails={() => setStage("orderDetail")} onRestart={() => { setSelection(undefined); setOrder(undefined); setStage("home"); }} />;
  if (order && stage === "orderDetail") return <OrderDetailView initialOrder={order} onOrderChange={setOrder} onBack={() => setStage("result")} onRestart={() => { setSelection(undefined); setOrder(undefined); setStage("home"); }} />;
  if (stage === "home") return (
      <section className="travel-hero hotel-hero">
        <div className="hero-copy"><p className="eyebrow">STAY SOMEWHERE REMARKABLE</p><h1>住进目的地的<br />每一种风景</h1><p>连接 G-Link 全球酒店实时库存，为每一次出发找到理想住所。</p></div>
        <div className="mode-switch glass glass-dark" aria-label="产品类型">
          <button className="active" aria-pressed="true"><BedDouble size={18} />酒店</button>
          <button onClick={() => navigate("flights")} aria-pressed="false"><Plane size={18} />机票</button>
        </div>
        {searchForm}
      </section>
  );
  return (
    <section className="booking-flow-page search-results-page" ref={resultsRef}>
      <button className="back-link" onClick={() => setStage("home")}><ArrowLeft size={17} />返回酒店查询</button>
      <BookingProgress current={1} labels={["查询", "搜索结果", "酒店详情", "下单支付", "预订确认", "订单详情"]} />
      <div className="compact-search-shell">{searchForm}</div>
      <section className="results-stage" ref={resultsRef} aria-busy={loading}>
        <div className="result-heading"><div><p className="eyebrow">CURATED STAYS</p><h2>{lastSearch}的酒店</h2><p aria-live="polite">{loading ? "正在获取实时酒店列表…" : error ? "搜索未完成，请修改条件后重试" : `${visibleHotels.length} 家酒店匹配 · 房型与价格进入详情实时确认`}</p></div><div className="sort-actions"><button className={`secondary ${mapOpen ? "active" : ""}`} onClick={() => setMapOpen(value => !value)} aria-pressed={mapOpen}><MapPin size={15} />{mapOpen ? "列表" : "地图"}</button><select className="secondary sort-select" aria-label="酒店排序" value={hotelSort} onChange={event => setHotelSort(event.target.value as typeof hotelSort)} disabled={loading || items.length === 0}><option value="recommended">推荐排序</option><option value="price">价格从低到高</option><option value="rating">评分从高到低</option></select></div></div>
        {mapOpen && <div className="hotel-map glass glass-light" role="region" aria-label="酒店地图"><div className="map-grid" />{visibleHotels.slice(0, 6).map((hotel, index) => <button key={hotel.id} style={{ left: `${12 + (index % 3) * 34}%`, top: `${18 + Math.floor(index / 3) * 42}%` }} onClick={() => void chooseHotel(hotel)}><MapPin size={14} />{money(hotel.nightlyPrice)}</button>)}</div>}
        <div className="result-with-filters"><aside className="filter-panel glass glass-light"><h3>筛选酒店</h3>
          <div className="filter-group"><strong>每晚最高价：{money(maxPrice)}</strong><input type="range" min="300" max="3000" step="100" value={maxPrice} onChange={event => setMaxPrice(Number(event.target.value))} aria-label="每晚最高价格" /></div>
          <div className="filter-group"><strong>酒店星级</strong>{[5, 4].map(star => <label key={star}><input type="checkbox" checked={starFilters.includes(star)} onChange={event => setStarFilters(current => event.target.checked ? [...current, star] : current.filter(value => value !== star))} />{star}星级</label>)}</div>
          <div className="filter-group"><strong>住客评分</strong>{[4.5, 4].map(rating => <label key={rating}><input type="radio" name="hotel-rating" checked={minRating === rating} onChange={() => setMinRating(rating)} />{rating}分以上</label>)}</div>
          <button className="text-button" onClick={() => { setMaxPrice(3000); setStarFilters([]); setMinRating(0); }}>清除筛选</button>
        </aside>
        <div className="result-list" aria-live="polite">
        {loading ? [1,2,3].map(item => <div className="hotel-card skeleton-card" key={item} aria-hidden="true" />) : visibleHotels.length ? visibleHotels.map(hotel => <article className="hotel-card" key={hotel.id}>
          <img src={hotel.image} alt="" />
          <div className="hotel-info"><div className="hotel-top"><div><span className="stars">{"★".repeat(hotel.stars)}</span><h3>{hotel.name}</h3><p>{hotel.district} · 距市中心 1.8 km</p></div><span className="rating"><strong>{hotel.rating}</strong>卓越<small>1,284 条点评</small></span></div>
          <div className="tags">{hotel.tags.map((tag, index) => <span key={`${tag}-${index}`}>{tag}</span>)}</div>
          <div className="room-line"><div><strong>{hotel.roomName}</strong><span>{hotel.breakfast} · {hotel.cancelPolicy}</span></div><div className="price"><small>每晚含税</small><strong>{hotel.nightlyPrice ? money(hotel.nightlyPrice) : "实时查询"}</strong><span>{hotel.nightlyPrice ? `2晚共 ${money(hotel.nightlyPrice * 2)}` : "进入详情获取准确价格"}</span></div><button className="primary" onClick={() => chooseHotel(hotel)} disabled={hydratingId === hotel.id}>{hydratingId === hotel.id ? <><LoaderCircle className="spinner" size={16} />查询实时产品</> : "查看房型"}</button></div></div>
        </article>) : hasSearched && !error ? <div className="hotel-empty-state glass glass-light"><div><Building2 size={28} /></div><h3>暂无符合条件的酒店</h3><p>{items.length ? "请放宽价格、星级或评分筛选。" : "尝试更换目的地或日期。沙箱环境还需要为当前账号配置可售测试酒店与未来房态。"}</p><button className="primary" onClick={() => { if (items.length) { setMaxPrice(3000); setStarFilters([]); setMinRating(0); } else { setDestination("香港"); } setError(""); window.scrollTo({ top: 0, behavior: "smooth" }); }}>{items.length ? "清除筛选" : "搜索香港酒店"}</button></div> : null}
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
  }>;
  contactName: string;
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
  travelers,
  onBack,
  onContinue,
}: {
  offer: FlightOffer;
  travelers: number;
  onBack: () => void;
  onContinue: (draft: FlightBookingDraft) => void;
}) {
  const [passengers, setPassengers] = useState(() => Array.from({ length: travelers }, (_, index) => ({
    surname: index === 0 ? "LIN" : `TRAVELER${index + 1}`,
    givenName: index === 0 ? "JIACHENG" : "TEST",
    documentNo: `E1234567${index + 8}`,
    nationality: "CN",
    issuingCountry: "CN",
    gender: "1" as "1" | "2",
    idType: "2",
    birthday: "1990-06-18",
    expiration: "2031-08-20",
  })));
  const [contactName, setContactName] = useState("LIN/JIACHENG");
  const [phone, setPhone] = useState("13800008866");
  const [email, setEmail] = useState("lin@example.com");
  const [baggage, setBaggage] = useState(false);
  const [insurance, setInsurance] = useState(true);
  const [seat, setSeat] = useState(false);
  const [error, setError] = useState("");
  const updatePassenger = (index: number, key: keyof (typeof passengers)[number], value: string) => {
    setPassengers(current => current.map((passenger, passengerIndex) =>
      passengerIndex === index ? { ...passenger, [key]: value } : passenger));
    setError("");
  };
  const next = () => {
    const englishNamePattern = /^[A-Za-z][A-Za-z '\-]*$/;
    if (passengers.some(passenger => !englishNamePattern.test(passenger.surname.trim()) || !englishNamePattern.test(passenger.givenName.trim()) || passenger.documentNo.length < 6 || !passenger.birthday || !passenger.expiration || !passenger.nationality || !passenger.issuingCountry) || phone.length < 8 || !email.includes("@")) return setError("请按证件完整填写乘机人与联系人信息");
    setError("");
    onContinue({ passengers, contactName, phone, email, baggage, insurance, seat });
  };
  return <section className="booking-flow-page">
    <button className="back-link" onClick={onBack}><ArrowLeft size={17} />返回航班列表</button>
    <BookingProgress current={2} labels={["查询", "航班与票价", "乘机人", "支付", "出票确认", "订单详情"]} />
    <header className="flow-heading"><p className="eyebrow">PASSENGER & EXTRAS</p><h1>填写乘机人与联系人</h1><p>票价已锁定 14 分钟，姓名和证件必须与旅行证件完全一致。</p></header>
    <div className="checkout-layout"><div className="checkout-main">
      <FlightItineraryCard offer={offer} badge={<span className="verified-badge"><ShieldCheck size={15} />运价已验证</span>} showFacts />
      <section className="form-section glass glass-light"><div className="section-title"><span>1</span><div><h2>乘机人信息</h2><p>英文姓名必须与旅行证件一致</p></div></div>
        {passengers.map((passenger, index) => <div className="passenger-block" key={index}><strong>成人 {index + 1}</strong><div className="form-grid">
          <label><span>英文姓 / Surname</span><div className="light-field"><UserRound size={17} /><input aria-label={`乘机人${index + 1}英文姓`} value={passenger.surname} onChange={event => updatePassenger(index, "surname", event.target.value.toUpperCase())} /></div><small>例如 LIN</small></label>
          <label><span>英文名 / Given name</span><div className="light-field"><UserRound size={17} /><input aria-label={`乘机人${index + 1}英文名`} value={passenger.givenName} onChange={event => updatePassenger(index, "givenName", event.target.value.toUpperCase())} /></div><small>例如 JIACHENG</small></label>
          <label><span>证件类型</span><select value={passenger.idType} onChange={event => updatePassenger(index, "idType", event.target.value)}><option value="2">护照</option><option value="3">港澳通行证</option><option value="1">身份证</option></select></label>
          <label><span>证件号码</span><div className="light-field"><FileText size={17} /><input value={passenger.documentNo} onChange={event => updatePassenger(index, "documentNo", event.target.value.toUpperCase())} /></div></label>
          <label><span>国籍</span><select value={passenger.nationality} onChange={event => updatePassenger(index, "nationality", event.target.value)}><option value="CN">中国</option><option value="HK">中国香港</option><option value="SG">新加坡</option></select></label>
          <label><span>护照签发国家/地区</span><select value={passenger.issuingCountry} onChange={event => updatePassenger(index, "issuingCountry", event.target.value)}><option value="CN">中国</option><option value="HK">中国香港</option><option value="SG">新加坡</option><option value="TH">泰国</option></select></label>
          <label><span>性别</span><select value={passenger.gender} onChange={event => updatePassenger(index, "gender", event.target.value)}><option value="1">男</option><option value="2">女</option></select></label>
          <label><span>出生日期</span><input type="date" value={passenger.birthday} onChange={event => updatePassenger(index, "birthday", event.target.value)} /></label>
          <label><span>证件有效期</span><input type="date" value={passenger.expiration} onChange={event => updatePassenger(index, "expiration", event.target.value)} /></label>
        </div></div>)}
      </section>
      <section className="form-section glass glass-light"><div className="section-title"><span>2</span><div><h2>联系人与通知</h2><p>航变、出票及退改信息会发送至以下联系方式</p></div></div><div className="form-grid">
        <label><span>联系人姓名</span><div className="light-field"><UserRound size={17} /><input value={contactName} onChange={event => { setContactName(event.target.value.toUpperCase()); setError(""); }} /></div></label>
        <label><span>手机号码</span><div className="light-field"><Phone size={17} /><input value={phone} onChange={event => { setPhone(event.target.value); setError(""); }} /></div></label>
        <label><span>电子邮箱</span><div className="light-field"><Mail size={17} /><input type="email" value={email} onChange={event => { setEmail(event.target.value); setError(""); }} /></div></label>
      </div></section>
      <section className="form-section glass glass-light"><div className="section-title"><span>3</span><div><h2>增值服务</h2><p>可在支付前自由增减，不影响基础机票价格</p></div></div><div className="addon-list">
        <label className={baggage ? "selected" : ""}><input type="checkbox" checked={baggage} onChange={event => setBaggage(event.target.checked)} /><Luggage size={19} /><span><strong>额外托运行李</strong><small>增加1件23kg行李</small></span><b>+¥260</b></label>
        <label className={seat ? "selected" : ""}><input type="checkbox" checked={seat} onChange={event => setSeat(event.target.checked)} /><UserRound size={19} /><span><strong>提前选座</strong><small>优先选择靠窗或靠过道座位</small></span><b>+¥80</b></label>
        <label className={insurance ? "selected" : ""}><input type="checkbox" checked={insurance} onChange={event => setInsurance(event.target.checked)} /><ShieldCheck size={19} /><span><strong>航班保障</strong><small>航延与意外保障</small></span><b>+¥68</b></label>
      </div></section>
    </div><aside className="price-summary glass glass-light">
      <p className="eyebrow">REVIEW DETAILS</p><h2>下一步核对并支付</h2><div className="summary-detail"><span>{offer.journeys?.length ? offer.journeys.map(journey => journey.origin).concat(offer.journeys.at(-1)?.destination || "").filter(Boolean).join(offer.tripType === 2 ? " ↔ " : " → ") : `${offer.departureAirport.split(" ")[0]} → ${offer.arrivalAirport.split(" ")[0]}`}</span><span>{offer.flightNo} · {travelers}位成人</span><span>{offer.cabin} · {offer.baggage}</span></div>
      <p className="policy-note"><ShieldCheck size={16} />priceKey 已验证，票价将在支付页再次校验</p>{error && <p className="error-copy" role="alert">{error}</p>}
      <button className="primary pay-button" onClick={next}>下一步：核对与支付<ChevronRight size={17} /></button><small className="secure-copy">进入支付页前不会创建上游订单</small>
    </aside></div>
  </section>;
}

function FlightPaymentPage({
  offer,
  travelers,
  verifiedTotal,
  draft,
  onBack,
  onComplete,
}: {
  offer: FlightOffer;
  travelers: number;
  verifiedTotal: number;
  draft: FlightBookingDraft;
  onBack: () => void;
  onComplete: (order: DistributionOrder) => void;
}) {
  const [paymentMethod, setPaymentMethod] = useState<"credit" | "card">("credit");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const extras = (draft.baggage ? 260 : 0) + (draft.seat ? 80 : 0) + (draft.insurance ? 68 : 0);
  const payable = verifiedTotal + extras;
  const submit = async () => {
    setLoading(true); setError("");
    try {
      const created = await api.createOrder({
        productType: "flight",
        offerId: offer.id,
        quantity: travelers,
        contact: { name: draft.contactName, phone: draft.phone, email: draft.email },
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
      <section className="form-section glass glass-light"><div className="section-title"><span>1</span><div><h2>乘机人与联系信息</h2><p>共 {draft.passengers.length} 位成人</p></div></div><div className="review-list">{draft.passengers.map((passenger, index) => <div key={passenger.documentNo}><span><strong>成人 {index + 1} · {passenger.surname} / {passenger.givenName}</strong><small>{passenger.idType === "2" ? "护照" : "旅行证件"} {passenger.documentNo} · {passenger.nationality}签发 · 有效期 {passenger.expiration}</small></span><CheckCircle2 size={18} /></div>)}<div><span><strong>{draft.contactName}</strong><small>{draft.phone} · {draft.email}</small></span><CheckCircle2 size={18} /></div></div></section>
      <section className="form-section glass glass-light"><div className="section-title"><span>2</span><div><h2>支付方式</h2><p>支付成功后自动向 F-Link 发起出票</p></div></div>
        <label className={`payment-option ${paymentMethod === "credit" ? "selected" : ""}`}><input type="radio" checked={paymentMethod === "credit"} onChange={() => setPaymentMethod("credit")} name="flight-payment" /><Landmark size={20} /><span><strong>企业授信账户</strong><small>可用额度 {money(128600)}</small></span>{paymentMethod === "credit" && <CheckCircle2 size={19} />}</label>
        <label className={`payment-option ${paymentMethod === "card" ? "selected" : ""}`}><input type="radio" checked={paymentMethod === "card"} onChange={() => setPaymentMethod("card")} name="flight-payment" /><CreditCard size={20} /><span><strong>银行卡 / 数字钱包</strong><small>支持银联、Visa、Mastercard</small></span>{paymentMethod === "card" && <CheckCircle2 size={19} />}</label>
      </section>
    </div><aside className="price-summary glass glass-light"><p className="eyebrow">FARE SUMMARY</p><h2>费用明细</h2><div className="price-lines"><span>成人票价 × {travelers}<b>{money(offer.price * travelers, offer.currency)}</b></span><span>税费及燃油费<b>已包含</b></span>{draft.baggage && <span>额外托运行李<b>¥260</b></span>}{draft.seat && <span>提前选座<b>¥80</b></span>}{draft.insurance && <span>航班保障<b>¥68</b></span>}<span className="total">应付总额<strong>{money(payable, offer.currency)}</strong></span></div><p className="policy-note"><ShieldCheck size={16} />提交时再次执行 F-Link 实时验价并创建订单</p>{error && <p className="error-copy" role="alert">{error}</p>}<button className="primary pay-button" onClick={submit} disabled={loading} aria-busy={loading}>{loading ? <><LoaderCircle className="spinner" size={18} />创建订单并支付</> : <><LockKeyhole size={17} />确认支付 {money(payable, offer.currency)}</>}</button><small className="secure-copy">提交即表示同意运价、退改签与隐私条款</small></aside></div>
  </section>;
}

function FlightSearch({ navigate }: { navigate: (page: Page) => void }) {
  const [from, setFrom] = useState("SHA");
  const [to, setTo] = useState("HKG");
  const [departureDate, setDepartureDate] = useState("2026-08-12");
  const [returnDate, setReturnDate] = useState("2026-08-19");
  const [tripType, setTripType] = useState<TripType>("oneway");
  const [multiSegments, setMultiSegments] = useState([
    { origin: "SHA", destination: "HKG", date: "2026-08-12" },
    { origin: "HKG", destination: "BKK", date: "2026-08-16" },
  ]);
  const [items, setItems] = useState<FlightOffer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [travelersOpen, setTravelersOpen] = useState(false);
  const [travelers, setTravelers] = useState(1);
  const [selection, setSelection] = useState<FlightOffer>();
  const [fareOffer, setFareOffer] = useState<FlightOffer>();
  const fareCloseRef = useRef<HTMLButtonElement>(null);
  const fareTriggerRef = useRef<HTMLElement | null>(null);
  const [stage, setStage] = useState<"home" | "results" | "passengers" | "payment" | "result" | "orderDetail">("home");
  const [verifiedTotal, setVerifiedTotal] = useState(0);
  const [verifyingId, setVerifyingId] = useState("");
  const [order, setOrder] = useState<DistributionOrder>();
  const [bookingDraft, setBookingDraft] = useState<FlightBookingDraft>();
  const [directOnly, setDirectOnly] = useState(false);
  const [baggageOnly, setBaggageOnly] = useState(false);
  const [flightSort, setFlightSort] = useState<"price" | "departure">("price");
  const [priceAlert, setPriceAlert] = useState(false);
  const [pageNumber, setPageNumber] = useState(1);
  const pageSize = 20;
  const visibleFlights = useMemo(() => [...items]
    .filter(flight => (!directOnly || flight.stops === 0) && (!baggageOnly || !/0件|无/.test(flight.baggage)))
    .sort((a, b) => flightSort === "price"
      ? a.price - b.price
      : a.departureTime.localeCompare(b.departureTime)), [baggageOnly, directOnly, flightSort, items]);
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
      return setError("请填写每一段行程的出发地、目的地和日期");
    }
    if (journeys.some(journey => journey.origin === journey.destination)) {
      return setError("同一航段的出发地和目的地不能相同");
    }
    if (tripType === "roundtrip" && returnDate < date) {
      return setError("返程日期不能早于去程日期");
    }
    if (tripType === "multicity"
      && journeys.some((journey, index) => index > 0 && journey.date < journeys[index - 1].date)) {
      return setError("多程日期必须按行程顺序递增");
    }
    setLoading(true);
    setError("");
    setTravelersOpen(false);
    setDepartureDate(date);
    try {
      const primary = journeys[0];
      setItems(await api.searchFlights({
        from: primary.origin,
        to: primary.destination,
        departureDate: primary.date,
        adults: travelers,
        tripType: tripType === "oneway" ? 1 : tripType === "roundtrip" ? 2 : 3,
        journeys,
      }));
      setPageNumber(1);
      setStage("results");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "航班搜索失败");
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
    setVerifyingId(fareOffer.id); setError("");
    try {
      const verified = await api.verifyFlight({ offerId: fareOffer.id, priceKey: fareOffer.priceKey, quantity: travelers });
      setSelection(fareOffer); setVerifiedTotal(verified.totalAmount); setFareOffer(undefined); setStage("passengers");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "验价失败，请重新搜索"); } finally { setVerifyingId(""); }
  };
  const travelerField = <div className="search-field traveler-field"><span>旅客与舱位</span><button className="field-button" onClick={() => setTravelersOpen(value => !value)} aria-expanded={travelersOpen}><UserRound size={18} />{travelers}位成人 · 经济舱<ChevronDown size={15} /></button>
    {travelersOpen && <div className="light-popover traveler-popover glass glass-light"><div><span><strong>成人</strong><small>12岁及以上</small></span><div className="counter"><button onClick={() => setTravelers(Math.max(1, travelers - 1))} disabled={travelers === 1} aria-label="减少成人"><Minus size={15} /></button><b>{travelers}</b><button onClick={() => setTravelers(Math.min(9, travelers + 1))} disabled={travelers === 9} aria-label="增加成人"><Plus size={15} /></button></div></div><button className="popover-done" onClick={() => setTravelersOpen(false)}>完成</button></div>}
  </div>;
  const searchButton = <button className="primary search-cta" onClick={() => void search()} disabled={loading} aria-busy={loading}>{loading ? <><LoaderCircle className="spinner" size={18} />搜索中</> : <><Search size={18} />搜索航班</>}</button>;
  const searchForm = tripType === "multicity"
    ? <section className="search-card flight-search multicity-search glass glass-dark" aria-label="多程机票搜索">
      <div className="multi-segment-list">
        {multiSegments.map((segment, index) => <div className="multi-segment-row" key={`${index}-${segment.date}`}>
          <b>第 {index + 1} 程</b>
          <label className="search-field"><span>出发地</span><div><Plane size={17} /><input aria-label={`第${index + 1}程出发地`} value={segment.origin} onChange={event => updateMultiSegment(index, "origin", event.target.value)} /></div></label>
          <label className="search-field"><span>目的地</span><div><MapPin size={17} /><input aria-label={`第${index + 1}程目的地`} value={segment.destination} onChange={event => updateMultiSegment(index, "destination", event.target.value)} /></div></label>
          <label className="search-field"><span>出发日期</span><div><CalendarDays size={17} /><input aria-label={`第${index + 1}程出发日期`} type="date" value={segment.date} onChange={event => updateMultiSegment(index, "date", event.target.value)} /></div></label>
          <button className="segment-remove" aria-label={`删除第${index + 1}程`} onClick={() => setMultiSegments(current => current.filter((_, segmentIndex) => segmentIndex !== index))} disabled={multiSegments.length === 2}><X size={16} /></button>
        </div>)}
      </div>
      <div className="multi-search-actions">
        <button className="add-segment" onClick={() => setMultiSegments(current => current.length >= 4 ? current : [...current, {
          origin: current.at(-1)?.destination || "",
          destination: "",
          date: current.at(-1)?.date || departureDate,
        }])} disabled={multiSegments.length >= 4}><Plus size={16} />添加一程</button>
        {travelerField}
        {searchButton}
      </div>
      {error && stage === "home" && <div className="search-inline-error" role="alert"><CircleHelp size={16} /><span>{error}</span></div>}
    </section>
    : <section className={`search-card flight-search ${tripType === "roundtrip" ? "roundtrip-search" : ""} glass glass-dark`} aria-label={tripType === "roundtrip" ? "往返机票搜索" : "单程机票搜索"}>
      <label className="search-field"><span>出发地</span><div><Plane size={18} /><input aria-label="出发地" value={from} onChange={e => { setFrom(e.target.value.toUpperCase()); setError(""); }} /></div></label>
      <button className="route-swap" aria-label="交换出发地和目的地" onClick={() => { setFrom(to); setTo(from); }}><RefreshCw size={16} /></button>
      <label className="search-field"><span>目的地</span><div><MapPin size={18} /><input aria-label="目的地" value={to} onChange={e => { setTo(e.target.value.toUpperCase()); setError(""); }} /></div></label>
      <label className="search-field"><span>出发日期</span><div><CalendarDays size={18} /><input aria-label="出发日期" type="date" value={departureDate} onChange={e => { setDepartureDate(e.target.value); setError(""); }} /></div></label>
      {tripType === "roundtrip" && <label className="search-field"><span>返程日期</span><div><CalendarDays size={18} /><input aria-label="返程日期" type="date" value={returnDate} min={departureDate} onChange={e => { setReturnDate(e.target.value); setError(""); }} /></div></label>}
      {travelerField}
      {searchButton}
      {error && stage === "home" && <div className="search-inline-error" role="alert"><CircleHelp size={16} /><span>{error}</span></div>}
    </section>;
  if (selection && stage === "passengers") return <FlightPassengerPage offer={selection} travelers={travelers} onBack={() => setStage("results")} onContinue={draft => { setBookingDraft(draft); setStage("payment"); }} />;
  if (selection && bookingDraft && stage === "payment") return <FlightPaymentPage offer={selection} travelers={travelers} verifiedTotal={verifiedTotal} draft={bookingDraft} onBack={() => setStage("passengers")} onComplete={created => { setOrder(created); setStage("result"); }} />;
  if (order && stage === "result") return <BookingResult order={order} type="flight" onDetails={() => setStage("orderDetail")} onRestart={() => { setSelection(undefined); setOrder(undefined); setBookingDraft(undefined); setStage("home"); }} />;
  if (order && stage === "orderDetail") return <OrderDetailView initialOrder={order} onOrderChange={setOrder} onBack={() => setStage("result")} onRestart={() => { setSelection(undefined); setOrder(undefined); setBookingDraft(undefined); setStage("home"); }} />;
  if (stage === "home") return (
      <section className="travel-hero flight-hero">
        <div className="hero-copy"><p className="eyebrow">THE WORLD IS CLOSER</p><h1>下一站，<br />由你定义</h1><p>连接 F-Link 全球实时运价，搜索、验价、出票与退改签一站完成。</p></div>
        <div className="mode-switch glass glass-dark" aria-label="产品类型">
          <button onClick={() => navigate("hotels")} aria-pressed="false"><BedDouble size={18} />酒店</button>
          <button className="active" aria-pressed="true"><Plane size={18} />机票</button>
        </div>
        <div className="trip-tabs glass glass-dark" aria-label="行程类型">
          <button className={tripType === "oneway" ? "active" : ""} aria-pressed={tripType === "oneway"} onClick={() => selectTripType("oneway")}>单程</button>
          <button className={tripType === "roundtrip" ? "active" : ""} aria-pressed={tripType === "roundtrip"} onClick={() => selectTripType("roundtrip")}>往返</button>
          <button className={tripType === "multicity" ? "active" : ""} aria-pressed={tripType === "multicity"} onClick={() => selectTripType("multicity")}>多程</button>
        </div>
        {searchForm}
      </section>
  );
  return (
    <section className="booking-flow-page search-results-page">
      <button className="back-link" onClick={() => setStage("home")}><ArrowLeft size={17} />返回机票查询</button>
      <BookingProgress current={1} labels={["查询", "航班与票价", "乘机人", "支付", "出票确认", "订单详情"]} />
      <div className="compact-search-shell">{searchForm}</div>
      <section className="results-stage">
      {error && <div className="error-banner" role="alert">{error}<button onClick={() => void search()}>重新搜索</button></div>}
      {tripType === "oneway" && <div className="low-fare-strip glass glass-light">{[-2,-1,0,1,2].map(offset => {
        const date = new Date(`${departureDate}T00:00:00`);
        date.setDate(date.getDate() + offset);
        const iso = localDateValue(date);
        return <button className={offset === 0 ? "active" : ""} aria-pressed={offset === 0} key={iso} onClick={() => void search(iso)} disabled={loading}><span>{date.getMonth() + 1}月{date.getDate()}日</span><strong>{offset === 0 && items[0] ? money(items[0].price * travelers) : "查询实时价"}</strong></button>;
      })}</div>}
      <div className="result-heading"><div><p className="eyebrow">LIVE FARES</p><h2>{routeLabel}</h2><p>{tripType === "roundtrip" ? `${departureDate} 至 ${returnDate}` : tripType === "multicity" ? `${multiSegments.length} 段行程` : departureDate} · {travelers}位成人 · 经济舱 · {visibleFlights.length}个航班方案</p></div><div className="sort-actions"><button className={`secondary ${priceAlert ? "active" : ""}`} onClick={() => setPriceAlert(value => !value)} aria-pressed={priceAlert}>{priceAlert ? "已创建降价提醒" : "创建降价提醒"}</button><select className="secondary sort-select" value={flightSort} onChange={event => { setFlightSort(event.target.value as typeof flightSort); setPageNumber(1); }} aria-label="航班排序"><option value="price">价格优先</option><option value="departure">起飞时间优先</option></select></div></div>
      <div className="flight-result-layout"><aside className="filter-panel glass glass-light"><h3>筛选航班</h3><label className="flight-filter-row"><input type="checkbox" checked={directOnly} onChange={event => { setDirectOnly(event.target.checked); setPageNumber(1); }} />仅看直飞</label><label className="flight-filter-row"><input type="checkbox" checked={baggageOnly} onChange={event => { setBaggageOnly(event.target.checked); setPageNumber(1); }} />含托运行李</label><button className="text-button" onClick={() => { setDirectOnly(false); setBaggageOnly(false); setPageNumber(1); }}>清除筛选</button></aside>
      <div className="flight-list">{pagedFlights.map(flight => <article className={`flight-card ${flight.journeys && flight.journeys.length > 1 ? "multi-journey-card" : ""}`} key={flight.id}>
        <div className="airline-badge">{flight.airlineCode}</div><div className="airline"><strong>{flight.airline}</strong><span>{flight.flightNo} · {flight.cabin}</span></div>
        {flight.journeys && flight.journeys.length > 1
          ? <div className="journey-list">{flight.journeys.map((journey, index) => <div className="journey-row" key={`${journey.date}-${journey.origin}-${journey.destination}`}><b>{tripType === "roundtrip" ? index === 0 ? "去程" : "返程" : `第${index + 1}程`}</b><span><strong>{journey.departureTime}</strong><small>{journey.origin}</small></span><i><small>{journey.date} · {journey.flightNo}</small><em>{journey.duration} · {journey.stops ? `${journey.stops}次中转` : "直飞"}</em></i><span><strong>{journey.arrivalTime}</strong><small>{journey.destination}</small></span></div>)}</div>
          : <><div className="flight-time"><strong>{flight.departureTime}</strong><span>{flight.departureAirport}</span></div>
            <div className="flight-route"><span>{flight.duration}</span><i /><small>{flight.stops ? `${flight.stops}次中转` : "直飞"}</small></div>
            <div className="flight-time"><strong>{flight.arrivalTime}</strong><span>{flight.arrivalAirport}</span></div></>}
        <div className="baggage">{flight.baggage}<small>含税总价</small></div>
        <div className="flight-price"><strong>{money(flight.price * travelers, flight.currency)}</strong><button className="primary" onClick={() => setFareOffer(flight)}>选择</button></div>
      </article>)}{!pagedFlights.length && <div className="hotel-empty-state glass glass-light"><h3>{items.length ? "暂无符合筛选条件的航班" : "当前日期暂无可售航班"}</h3><p>{items.length ? "请放宽直飞或行李筛选条件。" : "F-Link 当前没有返回有效报价，请尝试其他日期或航线。"}</p><button className="primary" onClick={() => { if (items.length) { setDirectOnly(false); setBaggageOnly(false); } else { setStage("home"); } }}>{items.length ? "清除筛选" : "修改查询条件"}</button></div>}
      {totalPages > 1 && <nav className="pagination" aria-label="航班结果分页"><button className="secondary" onClick={() => setPageNumber(value => Math.max(1, value - 1))} disabled={pageNumber === 1}>上一页</button><span>第 {pageNumber} / {totalPages} 页</span><button className="secondary" onClick={() => setPageNumber(value => Math.min(totalPages, value + 1))} disabled={pageNumber === totalPages}>下一页</button></nav>}</div></div>
      </section>
      {fareOffer && <div className="overlay-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) setFareOffer(undefined); }}>
        <section className="fare-drawer glass glass-light" role="dialog" aria-modal="true" aria-labelledby="fare-title">
          <button ref={fareCloseRef} className="drawer-close" onClick={() => { setFareOffer(undefined); fareTriggerRef.current?.focus(); }} aria-label="关闭票价选择"><X size={20} /></button>
          <header><p className="eyebrow">SELECT FARE</p><h2 id="fare-title">{routeLabel}</h2><p>{fareOffer.journeys && fareOffer.journeys.length > 1 ? `${fareOffer.journeys.length} 段组合行程 · ${fareOffer.flightNo}` : `${fareOffer.airline} ${fareOffer.flightNo} · ${fareOffer.departureTime}—${fareOffer.arrivalTime} · ${fareOffer.duration}`}</p></header>
          <div className="fare-option-grid">
            <label className="fare-option selected"><input type="radio" checked readOnly name="fare-brand" /><span><strong>标准经济舱</strong><small>F-Link 实时返回的可售运价</small><small>托运行李 {fareOffer.baggage}</small><small>退改签以验价结果为准</small></span><b>{money(fareOffer.price * travelers, fareOffer.currency)}</b></label>
            <label className="fare-option disabled" aria-disabled="true"><input type="radio" disabled name="fare-brand" /><span><strong>灵活经济舱</strong><small>本次搜索未返回对应 priceKey</small><small>不可作为真实可售运价提交</small></span><b>暂不可订</b></label>
            <label className="fare-option disabled" aria-disabled="true"><input type="radio" disabled name="fare-brand" /><span><strong>易退改保障</strong><small>需接入保障产品及独立履约协议</small><small>当前不会计入订单或扣款</small></span><b>待开通</b></label>
          </div>
          <footer><div><small>实时含税总价</small><strong>{money(fareOffer.price * travelers, fareOffer.currency)}</strong></div><button className="primary" onClick={continueFare} disabled={verifyingId === fareOffer.id}>{verifyingId ? <><LoaderCircle className="spinner" size={17} />实时验价中</> : <>继续填写乘机人<ChevronRight size={17} /></>}</button></footer>
        </section>
      </div>}
    </section>
  );
}

function OrdersPage() {
  const [orders, setOrders] = useState<DistributionOrder[]>([]);
  const [selection, setSelection] = useState<DistributionOrder>();
  useEffect(() => { api.listOrders().then(setOrders); }, []);
  const synchronizeOrder = (updated: DistributionOrder) => {
    setSelection(updated);
    setOrders(current => current.map(order => order.id === updated.id ? updated : order));
  };
  if (selection) return <OrderDetailView initialOrder={selection} onOrderChange={synchronizeOrder} onBack={() => setSelection(undefined)} />;
  return <section className="consumer-content-page"><section className="page-heading compact"><div><p className="eyebrow">MY BOOKINGS</p><h1>我的订单</h1><p>统一查看酒店、机票与售后处理进度</p></div></section><div className="filter-bar"><button className="active">全部订单</button><button>待处理</button><button>已确认</button><button>售后中</button></div><OrderTable orders={orders} onSelect={setSelection} /></section>;
}

function TransactionsPage() {
  const transactions = [
    ["TX202607290018", "酒店订单支付", "FG202607290018", "-¥3,376", "支付成功", "今天 09:43"],
    ["TX202607290017", "机票订单支付", "FG202607290017", "-¥3,360", "支付成功", "今天 09:19"],
    ["TX202607280089", "酒店退款", "FG202607280089", "+¥7,980", "退款处理中", "昨天 22:18"],
  ];
  return <section className="consumer-content-page"><section className="page-heading compact"><div><p className="eyebrow">TRANSACTIONS</p><h1>交易记录</h1><p>企业账户支付、退款与余额变动</p></div><button className="secondary">导出账单</button></section>
    <div className="wallet-overview"><article><span>账户可用余额</span><strong>{money(128600)}</strong><small>授信总额 ¥200,000</small></article><article><span>本月已支付</span><strong>{money(48320)}</strong><small>18 笔交易</small></article><article><span>退款处理中</span><strong>{money(7980)}</strong><small>预计 1–3 个工作日</small></article></div>
    <section className="panel ledger-panel"><div className="panel-title"><div><h2>最近交易</h2><p>所有金额均以企业账户记账币种显示</p></div></div><div className="table-wrap"><table><thead><tr><th>交易号</th><th>类型</th><th>关联订单</th><th>金额</th><th>状态</th><th>时间</th></tr></thead><tbody>{transactions.map(row => <tr key={row[0]}>{row.map((cell, index) => <td key={cell} className={index === 3 ? "transaction-amount" : ""}>{cell}</td>)}</tr>)}</tbody></table></div></section>
  </section>;
}

type AccountSection = "profile" | "security" | "travelers" | "notifications" | "billing";

function AccountPage({
  navigate,
  locale,
  setLocale,
  onProfileSaved,
}: {
  navigate: (page: Page) => void;
  locale: LocaleCode;
  setLocale: (locale: LocaleCode) => void;
  onProfileSaved: (profile: AccountProfile) => void;
}) {
  const [section, setSection] = useState<AccountSection>("profile");
  const [feedback, setFeedback] = useState<{ tone: "success" | "error" | "info"; text: string }>();
  const [dialog, setDialog] = useState<"password" | "traveler" | "credit" | "mfa" | "">("");
  const [profile, setProfile] = useState({
    name: "林嘉诚",
    language: locale,
    phone: "13800008866",
    email: "lin@example.com",
  });
  const [savedName, setSavedName] = useState("林嘉诚");
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
  const [notifications, setNotifications] = useState({ order: true, flight: true, marketing: false });
  const [creditDraft, setCreditDraft] = useState({ amount: 250000, reason: "" });

  const menu: Array<{ id: AccountSection; label: string; icon: typeof UserRound }> = [
    { id: "profile", label: "个人资料", icon: UserRound },
    { id: "security", label: "安全", icon: LockKeyhole },
    { id: "travelers", label: "常用旅客", icon: Users },
    { id: "notifications", label: "通知偏好", icon: Bell },
    { id: "billing", label: "支付与授信", icon: CreditCard },
  ];
  const showFeedback = (tone: "success" | "error" | "info", text: string) => setFeedback({ tone, text });
  useEffect(() => {
    let active = true;
    Promise.all([
      api.getAccountProfile(),
      api.listAccountTravelers(),
      api.getNotificationPreferences(),
    ]).then(([saved, savedTravelers, savedNotifications]) => {
      if (!active) return;
      setProfile({ name: saved.name, language: saved.language, phone: saved.phone, email: saved.email });
      setSavedName(saved.name);
      setLocale(saved.language);
      setAvatarUrl(saved.avatarUrl || "");
      setTravelers(savedTravelers);
      setNotifications({
        order: savedNotifications.order,
        flight: savedNotifications.flight,
        marketing: savedNotifications.marketing,
      });
      onProfileSaved(saved);
    }).catch(caught => {
      if (active) showFeedback("error", caught instanceof Error ? caught.message : "账户资料读取失败");
    });
    return () => { active = false; };
  }, [onProfileSaved, setLocale]);
  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!profile.name.trim()) return showFeedback("error", "请输入姓名");
    if (!/^1\d{10}$/.test(profile.phone)) return showFeedback("error", "请输入有效的 11 位手机号码");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)) return showFeedback("error", "请输入有效的电子邮箱");
    setSavingProfile(true);
    try {
      let saved = await api.updateAccountProfile({ ...profile, name: profile.name.trim() });
      if (pendingAvatar) saved = await api.uploadAccountAvatar(pendingAvatar);
      setSavedName(saved.name);
      setLocale(saved.language);
      setAvatarUrl(saved.avatarUrl || "");
      onProfileSaved(saved);
      setPendingAvatar(undefined);
      if (avatarInputRef.current) avatarInputRef.current.value = "";
      showFeedback("success", pendingAvatar ? "个人资料和头像已持久化保存" : "个人资料已持久化保存");
    } catch (caught) {
      showFeedback("error", caught instanceof Error ? caught.message : "个人资料保存失败");
    } finally {
      setSavingProfile(false);
    }
  };
  const chooseAvatar = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!["image/png", "image/jpeg"].includes(file.type) || file.size > 2 * 1024 * 1024) {
      showFeedback("error", "请选择不超过 2 MB 的 PNG 或 JPG 图片");
      event.target.value = "";
      return;
    }
    setPendingAvatar(file);
    const reader = new FileReader();
    reader.onload = () => {
      setAvatarUrl(String(reader.result || ""));
      showFeedback("info", `已选择 ${file.name}，请点击“保存修改”完成持久化`);
    };
    reader.readAsDataURL(file);
  };
  const updatePassword = (event: React.FormEvent) => {
    event.preventDefault();
    if (passwordForm.next.length < 8) return showFeedback("error", "新密码至少需要 8 个字符");
    if (passwordForm.next !== passwordForm.confirm) return showFeedback("error", "两次输入的新密码不一致");
    setDialog("");
    setPasswordForm({ current: "", next: "", confirm: "" });
    showFeedback("info", "密码规则验证通过；生产环境需由企业身份服务完成修改");
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
    if (!englishNamePattern.test(travelerDraft.surname.trim())) return showFeedback("error", "英文姓仅支持英文字母、空格、连字符或撇号");
    if (!englishNamePattern.test(travelerDraft.givenName.trim())) return showFeedback("error", "英文名仅支持英文字母、空格、连字符或撇号");
    const documentNo = travelerDraft.documentNo.trim().toUpperCase();
    if ((!editingTravelerId || documentNo) && !/^[A-Z0-9]{5,20}$/.test(documentNo)) return showFeedback("error", "请输入 5–20 位英文字母或数字组成的护照号码");
    if (!travelerDraft.birthday || travelerDraft.birthday >= new Date().toISOString().slice(0, 10)) return showFeedback("error", "请输入有效的出生日期");
    if (!travelerDraft.expiration || travelerDraft.expiration <= new Date().toISOString().slice(0, 10)) return showFeedback("error", "护照已过期或有效期填写错误");
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
        showFeedback("success", "常用旅客已更新并持久化保存");
      } else {
        const saved = await api.createAccountTraveler({ ...payload, documentNo });
        setTravelers(current => [...current, saved]);
        showFeedback("success", "常用旅客已添加并持久化保存");
      }
      setTravelerDraft(emptyTraveler);
      setEditingTravelerId("");
      setDialog("");
    } catch (caught) {
      showFeedback("error", caught instanceof Error ? caught.message : "常用旅客保存失败");
    } finally {
      setSavingTraveler(false);
    }
  };
  const removeTraveler = async (traveler: AccountTraveler) => {
    try {
      await api.deleteAccountTraveler(traveler.id);
      setTravelers(current => current.filter(item => item.id !== traveler.id));
      showFeedback("success", `已永久移除 ${traveler.surname} / ${traveler.givenName}`);
    } catch (caught) {
      showFeedback("error", caught instanceof Error ? caught.message : "常用旅客移除失败");
    }
  };
  const saveNotifications = async () => {
    setSavingNotifications(true);
    try {
      const saved = await api.updateNotificationPreferences(notifications);
      setNotifications({ order: saved.order, flight: saved.flight, marketing: saved.marketing });
      showFeedback("success", "通知偏好已持久化保存");
    } catch (caught) {
      showFeedback("error", caught instanceof Error ? caught.message : "通知偏好保存失败");
    } finally {
      setSavingNotifications(false);
    }
  };
  const submitCreditRequest = (event: React.FormEvent) => {
    event.preventDefault();
    if (creditDraft.amount <= 200000) return showFeedback("error", "申请额度需高于当前授信 ¥200,000");
    if (!creditDraft.reason.trim()) return showFeedback("error", "请填写额度调整原因");
    setDialog("");
    showFeedback("info", `授信调整申请 ${money(creditDraft.amount)} 已记录，等待企业审核服务接入`);
  };

  return <section className="consumer-content-page"><section className="page-heading compact"><div><p className="eyebrow">ACCOUNT SETTINGS</p><h1>账户设置</h1><p>管理个人资料、安全设置、常用旅客与通知偏好</p></div></section>
    {feedback && <div className={`account-feedback ${feedback.tone}`} role={feedback.tone === "error" ? "alert" : "status"}><span>{feedback.text}</span><button onClick={() => setFeedback(undefined)}>关闭</button></div>}
    <div className="account-layout"><aside className="account-menu glass glass-light" aria-label="账户设置菜单">{menu.map(({ id, label, icon: Icon }) => <button key={id} className={section === id ? "active" : ""} aria-current={section === id ? "page" : undefined} onClick={() => { setSection(id); setFeedback(undefined); }}><Icon size={17} />{label}</button>)}</aside>
      <div className="account-main">
        {section === "profile" && <form className="form-section glass glass-light" onSubmit={saveProfile}><div className="profile-heading"><div className="large-avatar">{avatarUrl ? <img src={avatarUrl} alt="个人头像" /> : savedName.slice(0, 1)}</div><div><h2>{savedName}</h2><p>超级管理员 · 寰宇旅行{pendingAvatar ? " · 新头像待保存" : ""}</p></div><input ref={avatarInputRef} hidden type="file" accept="image/png,image/jpeg" onChange={chooseAvatar} /><button type="button" className="secondary" onClick={() => avatarInputRef.current?.click()} disabled={savingProfile}>更换头像</button></div><div className="form-grid"><label><span>姓名</span><input aria-label="姓名" value={profile.name} onChange={event => setProfile(current => ({ ...current, name: event.target.value }))} /></label><label><span>显示语言</span><select aria-label="显示语言" value={profile.language} onChange={event => setProfile(current => ({ ...current, language: event.target.value as LocaleCode }))}><option value="zh-CN">简体中文</option><option value="zh-TW">繁體中文</option><option value="en">English</option></select></label><label><span>手机号码</span><input aria-label="手机号码" inputMode="tel" value={profile.phone} onChange={event => setProfile(current => ({ ...current, phone: event.target.value }))} /></label><label><span>电子邮箱</span><input aria-label="电子邮箱" type="email" value={profile.email} onChange={event => setProfile(current => ({ ...current, email: event.target.value }))} /></label></div><div className="form-actions"><button className="primary" disabled={savingProfile} aria-busy={savingProfile}>{savingProfile ? <><LoaderCircle className="spinner" size={16} />保存中</> : "保存修改"}</button></div></form>}

        {section === "security" && <section className="form-section glass glass-light"><div className="section-title"><span><ShieldCheck size={17} /></span><div><h2>账户安全</h2><p>上次登录：今天 08:56 · 上海 · Chrome on macOS</p></div></div><div className="security-row"><div><strong>登录密码</strong><span>建议每 90 天更新一次</span></div><button className="secondary" onClick={() => setDialog("password")}>修改密码</button></div><div className="security-row"><div><strong>双重验证</strong><span>已绑定手机验证</span></div><div className="security-actions"><span className="verified-badge"><Check size={14} />已开启</span><button className="secondary" onClick={() => setDialog("mfa")}>管理验证</button></div></div></section>}

        {section === "travelers" && <section className="form-section glass glass-light"><div className="account-section-head"><div className="section-title"><span><Users size={17} /></span><div><h2>常用旅客</h2><p>预订时可快速填充，证件号码默认脱敏展示</p></div></div><button className="primary" onClick={openNewTraveler}><Plus size={16} />新增旅客</button></div><div className="traveler-list">{travelers.map(traveler => <article key={traveler.id}><div><strong>{traveler.surname} / {traveler.givenName}</strong><span>{traveler.type === "adult" ? "成人" : traveler.type === "child" ? "儿童" : "婴儿"} · {traveler.gender === "1" ? "男" : "女"} · 国籍 {traveler.nationality} · 出生 {traveler.birthday}</span><span>护照 {traveler.documentNo} · {traveler.issuingCountry} 签发 · 有效期 {traveler.expiration}</span></div><div className="security-actions"><button className="secondary" onClick={() => openEditTraveler(traveler)}>编辑</button><button className="secondary" onClick={() => void removeTraveler(traveler)}>移除</button></div></article>)}</div></section>}

        {section === "notifications" && <section className="form-section glass glass-light"><div className="section-title"><span><Bell size={17} /></span><div><h2>通知偏好</h2><p>控制订单、出票与营销信息的接收方式</p></div></div><div className="settings-list"><label><span><strong>订单状态通知</strong><small>确认、取消、退款等关键状态</small></span><input aria-label="订单状态通知" type="checkbox" checked={notifications.order} onChange={event => setNotifications(current => ({ ...current, order: event.target.checked }))} /></label><label><span><strong>出票与航变通知</strong><small>出票成功、航班时间和航线变化</small></span><input aria-label="出票与航变通知" type="checkbox" checked={notifications.flight} onChange={event => setNotifications(current => ({ ...current, flight: event.target.checked }))} /></label><label><span><strong>优惠与产品更新</strong><small>新产品、价格活动与运营信息</small></span><input aria-label="优惠与产品更新" type="checkbox" checked={notifications.marketing} onChange={event => setNotifications(current => ({ ...current, marketing: event.target.checked }))} /></label></div><div className="form-actions"><button className="primary" onClick={() => void saveNotifications()} disabled={savingNotifications} aria-busy={savingNotifications}>{savingNotifications ? <><LoaderCircle className="spinner" size={16} />保存中</> : "保存通知偏好"}</button></div></section>}

        {section === "billing" && <section className="form-section glass glass-light"><div className="section-title"><span><CreditCard size={17} /></span><div><h2>支付与授信</h2><p>当前仅开放企业授信；银行卡需接入正式收单机构后启用</p></div></div><div className="account-credit-grid"><article><span>授信总额</span><strong>{money(200000)}</strong><small>企业账户 · CNY</small></article><article><span>当前可用</span><strong>{money(128600)}</strong><small>数据以财务结算页为准</small></article></div><div className="account-action-row"><button className="secondary" onClick={() => navigate("finance")}>查看财务结算</button><button className="primary" onClick={() => setDialog("credit")}>申请调整授信</button></div></section>}
      </div>
    </div>

    {dialog && <div className="modal-layer" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setDialog(""); }}>
      {dialog === "password" && <form className="booking-modal glass glass-light" role="dialog" aria-modal="true" aria-labelledby="password-title" onSubmit={updatePassword}><button type="button" className="modal-close" onClick={() => setDialog("")} aria-label="关闭修改密码"><X size={18} /></button><h2 id="password-title">修改密码</h2><p className="modal-subtitle">沙箱环境只验证交互与密码规则，不会修改真实企业登录凭证。</p><div className="form-grid"><label className="wide"><span>当前密码</span><input aria-label="当前密码" type="password" required value={passwordForm.current} onChange={event => setPasswordForm(current => ({ ...current, current: event.target.value }))} /></label><label><span>新密码</span><input aria-label="新密码" type="password" required minLength={8} value={passwordForm.next} onChange={event => setPasswordForm(current => ({ ...current, next: event.target.value }))} /></label><label><span>确认新密码</span><input aria-label="确认新密码" type="password" required minLength={8} value={passwordForm.confirm} onChange={event => setPasswordForm(current => ({ ...current, confirm: event.target.value }))} /></label></div><div className="modal-actions"><button type="button" className="secondary" onClick={() => setDialog("")}>取消</button><button className="primary">验证并提交</button></div></form>}
      {dialog === "traveler" && <form className="booking-modal traveler-modal glass glass-light" role="dialog" aria-modal="true" aria-labelledby="traveler-title" onSubmit={saveTraveler}><button type="button" className="modal-close" onClick={() => setDialog("")} aria-label="关闭常用旅客表单"><X size={18} /></button><h2 id="traveler-title">{editingTravelerId ? "编辑常用旅客" : "新增常用旅客"}</h2><p className="modal-subtitle">姓与名请按护照机读信息分开填写，保存后证件号码仅脱敏展示。</p><div className="form-grid">
        <label><span>英文姓 / Surname</span><input aria-label="英文姓" autoComplete="family-name" required value={travelerDraft.surname} onChange={event => setTravelerDraft(current => ({ ...current, surname: event.target.value.toUpperCase() }))} placeholder="例如 LIN" /></label>
        <label><span>英文名 / Given name</span><input aria-label="英文名" autoComplete="given-name" required value={travelerDraft.givenName} onChange={event => setTravelerDraft(current => ({ ...current, givenName: event.target.value.toUpperCase() }))} placeholder="例如 JIACHENG" /></label>
        <label><span>旅客类型</span><select aria-label="旅客类型" value={travelerDraft.type} onChange={event => setTravelerDraft(current => ({ ...current, type: event.target.value as typeof current.type }))}><option value="adult">成人</option><option value="child">儿童</option><option value="infant">婴儿</option></select></label>
        <label><span>性别</span><select aria-label="性别" value={travelerDraft.gender} onChange={event => setTravelerDraft(current => ({ ...current, gender: event.target.value as typeof current.gender }))}><option value="1">男</option><option value="2">女</option></select></label>
        <label><span>出生日期</span><input aria-label="出生日期" type="date" required max={new Date().toISOString().slice(0, 10)} value={travelerDraft.birthday} onChange={event => setTravelerDraft(current => ({ ...current, birthday: event.target.value }))} /></label>
        <label><span>国籍</span><select aria-label="国籍" value={travelerDraft.nationality} onChange={event => setTravelerDraft(current => ({ ...current, nationality: event.target.value }))}><option value="CN">中国</option><option value="HK">中国香港</option><option value="SG">新加坡</option><option value="TH">泰国</option></select></label>
        <label><span>护照号码</span><input aria-label="护照号码" autoComplete="off" required={!editingTravelerId} value={travelerDraft.documentNo} onChange={event => setTravelerDraft(current => ({ ...current, documentNo: event.target.value.toUpperCase() }))} placeholder={editingTravelerId ? "留空保留原护照号码" : "5–20 位字母或数字"} /></label>
        <label><span>护照签发国家/地区</span><select aria-label="护照签发国家或地区" value={travelerDraft.issuingCountry} onChange={event => setTravelerDraft(current => ({ ...current, issuingCountry: event.target.value }))}><option value="CN">中国</option><option value="HK">中国香港</option><option value="SG">新加坡</option><option value="TH">泰国</option></select></label>
        <label><span>护照有效期</span><input aria-label="护照有效期" type="date" required min={new Date().toISOString().slice(0, 10)} value={travelerDraft.expiration} onChange={event => setTravelerDraft(current => ({ ...current, expiration: event.target.value }))} /></label>
      </div><p className="passport-privacy-note"><ShieldCheck size={15} />护照信息属于敏感个人信息；本地数据库使用 AES-256-GCM 加密存储，页面与接口仅返回脱敏号码。</p><div className="modal-actions"><button type="button" className="secondary" onClick={() => setDialog("")} disabled={savingTraveler}>取消</button><button className="primary" disabled={savingTraveler} aria-busy={savingTraveler}>{savingTraveler ? <><LoaderCircle className="spinner" size={16} />保存中</> : editingTravelerId ? "保存修改" : "保存旅客"}</button></div></form>}
      {dialog === "credit" && <form className="booking-modal glass glass-light" role="dialog" aria-modal="true" aria-labelledby="credit-title" onSubmit={submitCreditRequest}><button type="button" className="modal-close" onClick={() => setDialog("")} aria-label="关闭授信申请"><X size={18} /></button><h2 id="credit-title">申请调整授信</h2><p className="modal-subtitle">申请将进入企业审核流程；当前沙箱仅记录交互结果。</p><div className="form-grid"><label><span>申请额度（CNY）</span><input aria-label="申请额度" type="number" min="200001" required value={creditDraft.amount} onChange={event => setCreditDraft(current => ({ ...current, amount: Number(event.target.value) }))} /></label><label className="wide"><span>调整原因</span><input aria-label="调整原因" required value={creditDraft.reason} onChange={event => setCreditDraft(current => ({ ...current, reason: event.target.value }))} /></label></div><div className="modal-actions"><button type="button" className="secondary" onClick={() => setDialog("")}>取消</button><button className="primary">提交申请</button></div></form>}
      {dialog === "mfa" && <section className="booking-modal glass glass-light" role="dialog" aria-modal="true" aria-labelledby="mfa-title"><button type="button" className="modal-close" onClick={() => setDialog("")} aria-label="关闭双重验证"><X size={18} /></button><h2 id="mfa-title">双重验证</h2><p className="modal-subtitle">当前已绑定手机号 138****8866。生产环境的重新绑定与关闭操作需通过企业身份服务和短信校验。</p><div className="modal-actions"><button className="primary" onClick={() => setDialog("")}>我知道了</button></div></section>}
    </div>}
  </section>;
}

function CustomersPage() {
  const [items, setItems] = useState<Customer[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    contactName: "",
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
      await api.createCustomer(form);
      setOpen(false);
      setForm({ name: "", contactName: "", phone: "", email: "", creditLimit: 100000 });
      load();
    } catch (error) {
      setError(error instanceof Error ? error.message : "客户创建失败");
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
      setError(error instanceof Error ? error.message : "客户状态更新失败");
    }
  };
  return <section className="operations-page">
    <section className="page-heading compact"><div><p className="eyebrow">CUSTOMERS</p><h1>客户管理</h1><p>维护企业客户、联系人、账号状态与授信额度</p></div><button className="primary" onClick={() => setOpen(true)}><Plus size={16} />新建客户</button></section>
    {error && <div className="error-banner" role="alert">{error}<button onClick={() => setError("")}>关闭</button></div>}
    <section className="operations-summary">
      <article><span>企业客户</span><strong>{items.length}</strong><small>已持久化至业务数据库</small></article>
      <article><span>启用客户</span><strong>{items.filter(item => item.status === "ACTIVE").length}</strong><small>可正常预订与记账</small></article>
      <article><span>总授信额度</span><strong>{money(items.reduce((sum, item) => sum + item.creditLimit, 0))}</strong><small>按客户独立控制</small></article>
    </section>
    <section className="panel operations-panel glass glass-light"><div className="panel-title"><div><h2>客户列表</h2><p>停用后保留历史订单，但不能继续创建新交易</p></div></div>
      <div className="table-wrap"><table><thead><tr><th>客户</th><th>联系人</th><th>联系方式</th><th>授信使用</th><th>状态</th><th>操作</th></tr></thead><tbody>{items.map(customer => <tr key={customer.id}><td><strong>{customer.name}</strong><small className="table-subline">{customer.id}</small></td><td>{customer.contactName}</td><td>{customer.phone}<small className="table-subline">{customer.email}</small></td><td>{money(customer.creditUsed)} / {money(customer.creditLimit)}</td><td><span className={`business-status ${customer.status.toLowerCase()}`}>{customer.status === "ACTIVE" ? "启用" : "停用"}</span></td><td><button className="table-action" onClick={() => toggle(customer)}>{customer.status === "ACTIVE" ? "停用" : "启用"}</button></td></tr>)}</tbody></table></div>
    </section>
    {open && <div className="modal-layer" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setOpen(false); }}><form className="booking-modal glass glass-light" role="dialog" aria-modal="true" aria-labelledby="new-customer-title" onSubmit={submit}><button type="button" className="modal-close" onClick={() => setOpen(false)} aria-label="关闭"><X size={18} /></button><h2 id="new-customer-title">新建企业客户</h2><p className="modal-subtitle">客户创建后即可配置独立授信和定价策略。</p><div className="form-grid"><label><span>企业名称</span><input required value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} /></label><label><span>联系人</span><input required value={form.contactName} onChange={event => setForm(current => ({ ...current, contactName: event.target.value }))} /></label><label><span>手机号码</span><input required value={form.phone} onChange={event => setForm(current => ({ ...current, phone: event.target.value }))} /></label><label><span>电子邮箱</span><input type="email" required value={form.email} onChange={event => setForm(current => ({ ...current, email: event.target.value }))} /></label><label className="wide"><span>授信额度</span><input type="number" min="0" required value={form.creditLimit} onChange={event => setForm(current => ({ ...current, creditLimit: Number(event.target.value) }))} /></label></div><div className="modal-actions"><button type="button" className="secondary" onClick={() => setOpen(false)}>取消</button><button className="primary" disabled={saving}>{saving ? <><LoaderCircle className="spinner" size={16} />保存中</> : "创建客户"}</button></div></form></div>}
  </section>;
}

function PricingPage() {
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
      setError(error instanceof Error ? error.message : "规则创建失败");
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
      setError(error instanceof Error ? error.message : "规则状态更新失败");
    }
  };
  const productLabel = (value: PricingRule["productType"]) =>
    value === "hotel" ? "酒店" : value === "flight" ? "机票" : "全部产品";
  return <section className="operations-page">
    <section className="page-heading compact"><div><p className="eyebrow">PRICING</p><h1>定价策略</h1><p>按产品配置百分比加价或固定服务费；启用后实时影响搜索与验价售价</p></div><button className="primary" onClick={() => setOpen(true)}><Plus size={16} />新建规则</button></section>
    {error && <div className="error-banner" role="alert">{error}<button onClick={() => setError("")}>关闭</button></div>}
    <section className="panel operations-panel glass glass-light"><div className="panel-title"><div><h2>定价规则</h2><p>同一产品按优先级从小到大匹配首条启用规则</p></div></div>
      <div className="table-wrap"><table><thead><tr><th>规则名称</th><th>适用产品</th><th>计算方式</th><th>优先级</th><th>状态</th><th>操作</th></tr></thead><tbody>{rules.map(rule => <tr key={rule.id}><td><strong>{rule.name}</strong><small className="table-subline">{rule.id}</small></td><td>{productLabel(rule.productType)}</td><td>{rule.calculationType === "percentage" ? `成本价 + ${rule.value}%` : `成本价 + ${money(rule.value)}`}</td><td>{rule.priority}</td><td><span className={`business-status ${rule.status.toLowerCase()}`}>{rule.status === "ACTIVE" ? "已启用" : "未启用"}</span></td><td><button className="table-action" onClick={() => toggle(rule)}>{rule.status === "ACTIVE" ? "停用" : "启用"}</button></td></tr>)}</tbody></table></div>
    </section>
    {open && <div className="modal-layer" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setOpen(false); }}><form className="booking-modal glass glass-light" role="dialog" aria-modal="true" aria-labelledby="new-rule-title" onSubmit={submit}><button type="button" className="modal-close" onClick={() => setOpen(false)} aria-label="关闭"><X size={18} /></button><h2 id="new-rule-title">新建定价规则</h2><p className="modal-subtitle">新规则默认停用，确认影响范围后再手动启用。</p><div className="form-grid"><label className="wide"><span>规则名称</span><input required value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} /></label><label><span>适用产品</span><select value={form.productType} onChange={event => setForm(current => ({ ...current, productType: event.target.value as PricingRule["productType"] }))}><option value="hotel">酒店</option><option value="flight">机票</option><option value="all">全部产品</option></select></label><label><span>计算方式</span><select value={form.calculationType} onChange={event => setForm(current => ({ ...current, calculationType: event.target.value as PricingRule["calculationType"] }))}><option value="percentage">百分比加价</option><option value="fixed">固定服务费</option></select></label><label><span>{form.calculationType === "percentage" ? "加价比例（%）" : "固定金额（CNY）"}</span><input type="number" min="0" step={form.calculationType === "percentage" ? "0.1" : "1"} required value={form.value} onChange={event => setForm(current => ({ ...current, value: Number(event.target.value) }))} /></label><label><span>优先级</span><input type="number" min="1" required value={form.priority} onChange={event => setForm(current => ({ ...current, priority: Number(event.target.value) }))} /></label></div><div className="modal-actions"><button type="button" className="secondary" onClick={() => setOpen(false)}>取消</button><button className="primary" disabled={saving}>{saving ? <><LoaderCircle className="spinner" size={16} />保存中</> : "保存规则"}</button></div></form></div>}
  </section>;
}

function FinancePage() {
  const [summary, setSummary] = useState<FinanceSummary>();
  const [error, setError] = useState("");
  useEffect(() => {
    api.financeSummary().then(setSummary).catch(error => setError(error.message));
  }, []);
  const exportLedger = () => {
    if (!summary) return;
    const rows = [
      ["流水号", "订单号", "类型", "金额", "币种", "状态", "时间"],
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
    <section className="page-heading compact"><div><p className="eyebrow">FINANCE</p><h1>财务结算</h1><p>查看企业授信、支付流水、退款待处理与对账数据</p></div><button className="secondary" onClick={exportLedger} disabled={!summary}><FileText size={16} />导出流水</button></section>
    {error && <div className="error-banner" role="alert">{error}<button onClick={() => setError("")}>关闭</button></div>}
    <div className="wallet-overview"><article><span>账户可用授信</span><strong>{money(summary?.availableCredit || 0)}</strong><small>总授信 {money(summary?.totalCredit || 0)} · 不混算外币</small></article><article><span>累计已支付（CNY）</span><strong>{money(summary?.paid || 0)}</strong><small>{summary ? Object.entries(summary.paidByCurrency).filter(([currency]) => currency !== "CNY").map(([currency, amount]) => money(amount, currency)).join(" · ") || "暂无外币支付" : "正在加载"}</small></article><article><span>退款待处理（CNY）</span><strong>{money(summary?.refundPending || 0)}</strong><small>外币退款按原币种单独展示</small></article></div>
    <section className="panel operations-panel glass glass-light"><div className="panel-title"><div><h2>资金流水</h2><p>支付和退款按订单幂等记账，重复请求不会重复入账</p></div></div><div className="table-wrap"><table><thead><tr><th>流水</th><th>关联订单</th><th>类型</th><th>金额</th><th>状态</th><th>时间</th></tr></thead><tbody>{summary?.entries.length ? summary.entries.map(entry => <tr key={entry.id}><td>{entry.reference}<small className="table-subline">{entry.id.slice(0, 8)}</small></td><td>{entry.orderId || "—"}</td><td>{entry.entryType === "PAYMENT" ? "订单支付" : entry.entryType === "REFUND_PENDING" ? "退款待处理" : entry.entryType}</td><td className="transaction-amount">{money(entry.amount, entry.currency)}</td><td><span className={`business-status ${entry.status.toLowerCase()}`}>{entry.status}</span></td><td>{new Date(entry.createdAt).toLocaleString("zh-CN")}</td></tr>) : <tr><td colSpan={6} className="empty-table-cell">暂无资金流水，完成一笔支付后将自动生成。</td></tr>}</tbody></table></div></section>
  </section>;
}

export function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const [pageInstance, setPageInstance] = useState(0);
  const [locale, setLocale] = useState<LocaleCode>(() => {
    const stored = window.localStorage.getItem("fusiongo.locale");
    return stored === "zh-TW" || stored === "en" ? stored : "zh-CN";
  });
  const [displayCurrency, setDisplayCurrency] = useState<DisplayCurrency>(() => {
    const stored = window.localStorage.getItem("fusiongo.displayCurrency");
    return stored === "USD" || stored === "HKD" || stored === "SGD" ? stored : "CNY";
  });
  const [accountIdentity, setAccountIdentity] = useState<Pick<AccountProfile, "name" | "avatarUrl">>({ name: "林嘉诚" });
  const navigate = useCallback((nextPage: Page) => {
    if (page === nextPage) setPageInstance(value => value + 1);
    setPage(nextPage);
  }, [page]);
  useEffect(() => { window.scrollTo({ top: 0, behavior: "auto" }); }, [page]);
  useEffect(() => {
    document.documentElement.lang = locale;
    window.localStorage.setItem("fusiongo.locale", locale);
  }, [locale]);
  useEffect(() => {
    window.localStorage.setItem("fusiongo.displayCurrency", displayCurrency);
  }, [displayCurrency]);
  useEffect(() => {
    api.getAccountProfile().then(profile => {
      setAccountIdentity({ name: profile.name, avatarUrl: profile.avatarUrl });
      setLocale(profile.language);
    }).catch(() => undefined);
  }, []);
  const handleProfileSaved = useCallback((profile: AccountProfile) => {
    setAccountIdentity({ name: profile.name, avatarUrl: profile.avatarUrl });
  }, []);
  const content = useMemo(() => {
    if (page === "dashboard") return <Dashboard key={`dashboard-${pageInstance}`} navigate={navigate} />;
    if (page === "hotels") return <HotelSearch key={`hotels-${pageInstance}`} navigate={navigate} />;
    if (page === "flights") return <FlightSearch key={`flights-${pageInstance}`} navigate={navigate} />;
    if (page === "orders") return <OrdersPage key={`orders-${pageInstance}`} />;
    if (page === "transactions") return <TransactionsPage />;
    if (page === "account") return <AccountPage navigate={navigate} locale={locale} setLocale={setLocale} onProfileSaved={handleProfileSaved} />;
    if (page === "customers") return <CustomersPage />;
    if (page === "pricing") return <PricingPage />;
    return <FinancePage />;
  }, [handleProfileSaved, locale, navigate, page, pageInstance]);
  return <Shell
    page={page}
    setPage={navigate}
    locale={locale}
    setLocale={setLocale}
    displayCurrency={displayCurrency}
    setDisplayCurrency={setDisplayCurrency}
    accountIdentity={accountIdentity}
  >{content}</Shell>;
}

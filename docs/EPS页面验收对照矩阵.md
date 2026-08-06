# EPS 酒店页面验收对照矩阵

更新日期：2026-08-05  
范围：用户截图中可见的 Hotel/Room Availability、Booking Page、Confirmation Page、Confirmation Email 条目。

## 验收原则

- 商品、价格、政策、床型和入住提示只读取 G-Link `hotel/detail`、`booking/productDetails`、`booking/availabilityCheck` 与订单快照。
- 上游未返回的字段显示“上游未返回”，禁止用演示文案或推测值补齐。
- Expedia Group MoR 专属条目不冒充适用；G-Link 产品明确显示“不适用：本订单非 Expedia Group MoR”。
- 生产环境在 HTTPS、外部认证、持久数据库、PII 加密、支付安全或客服配置缺失时，`/api/ready` 返回 503，阻止上线。

| 编号 | 验收要求 | FusionGo 实现 | 真实数据来源 / 控制 | 状态 |
|---|---|---|---|---|
| AP1 | 每个房型展示床型描述 | 房型卡独立展示“床型”；优先取 `bedInfoDesc`，其次解析 `bedTypeDetails`，最后使用上游房型名 | `booking/productDetails` | 已实现 |
| AP2 | 不可退款标识清晰 | `cancelRestrictionType=1` 显示红色“不可退款”标签；其他类型展示真实取消政策 | `booking/productDetails.cancelRestrictionType` | 已实现 |
| AP3 | 入住及特殊入住说明 | 房型卡展示办理入住时间、酒店重要通知和产品特殊提示 | `hotel/detail.checkInTime/checkInLateTime/importantNotices`、`productDetails.tips` | 已实现；缺失时明确提示 |
| BP1 | 个人数据使用 SSL | 生产模式拒绝非 HTTPS 请求并发送 HSTS；`PUBLIC_APP_URL` 必须为 HTTPS | 反向代理 `X-Forwarded-Proto`、生产就绪检查 | 已实现；部署时必须配置证书 |
| BP2 | 结账页显示入住说明 | “政策与入住须知”在联系人及支付前展示 | 订单报价快照 | 已实现 |
| BP3 | 取消政策和不可退标签 | 结账页重复展示取消政策；不可退使用高对比警示 | `cancelRestrictionType`、取消政策字段 | 已实现 |
| BP4 | 到店另付费用单独展示 | 价格明细使用“到店另付”独立警示行并保留当地币种 | `payAtHotelFee/payAtHotelFeeCurrency` | 已实现；仅有返回值时显示 |
| BP5 | 总价、税费和费用拆分 | 分别展示房费、税费、销售税、其他税费、服务费、上游 feeItems、总额 | `priceItems[].taxDetail`、`taxAndFeeDetails`、本地定价差额 | 已实现；不重复推算缺失税费 |
| BP7 | 重申儿童年龄 | 有儿童时在支付前显示儿童人数及每位年龄 | 搜索请求及订单报价快照 | 已实现 |
| BP8 | 说明收款方与收款时点 | 预付显示 FusionGo 企业授信；到店付显示酒店到店/退房收款 | `payAtHotelFlag` | 已实现 |
| BP9 | PSD2 | 企业授信场景明确为非终端旅客银行卡收款；卡支付生产环境要求 `PAYMENT_PSD2_SCA_ENABLED=true`，否则 API 阻断 | 支付模式与生产环境变量 | 条件满足 |
| BP10 | Expedia MoR 支付处理地点 | G-Link 产品明确显示 Expedia MoR 不适用，不伪造 Expedia 收款主体；到店付显示酒店所在地 | 产品来源、`payAtHotelFlag` | 已实现 / 不适用 |
| CP1 | 确认页显示总价与税费 | 订单详情页从订单创建时快照展示房费、税费、服务费、到店另付和实付总额 | 本地订单快照 | 已实现 |
| ER1 | 确认邮件正确显示行程 ID | 邮件模板同时展示本地订单号和 G-Link 上游订单号 | `order.id`、`supplierOrderNo` | 已实现 |
| ER2 | 清晰展示客户支持和在线工具 | 确认邮件展示真实客服链接与邮箱/电话；生产就绪检查强制配置 | `CUSTOMER_SUPPORT_*` | 已实现；部署前配置必填 |
| ER3 | 确认邮件显示床型 | 邮件房型区展示真实床型描述 | 订单快照 | 已实现 |
| ER4 | 确认邮件显示入住提示 | 邮件展示入住时间及特别入住提示 | 订单快照 | 已实现 |
| ER5 | 邮件单列到店费用 | `chargesDueAtProperty` 独立显示并保留当地币种 | 订单快照 | 已实现；适用时显示 |
| ER6 | 邮件总价及税费拆分 | 邮件价格表展示已返回的各项费用与订单总额 | 订单快照 | 已实现 |

## 部署前必须配置

```dotenv
PUBLIC_APP_URL=https://test.example.com
WEBHOOK_PUBLIC_URL=https://test.example.com/api/webhooks/glink/order-status
CUSTOMER_SUPPORT_URL=https://support.example.com
CUSTOMER_SUPPORT_EMAIL=support@example.com
CUSTOMER_SUPPORT_PHONE=真实客服电话

# 仅在银行卡支付服务商已经启用 3DS/SCA 时设置为 true
PAYMENT_PSD2_SCA_ENABLED=false
```

## 验收入口

- 房型可售页：酒店搜索 → 查看房型。
- 结账页：实时房型 → 预订此房型（先调用 `booking/availabilityCheck`）。
- 确认页：订单详情，状态必须为“已确认”。
- 确认邮件：订单详情 → “预览确认邮件”；仅已确认酒店订单开放。
- 生产门禁：`GET /api/ready`，必须返回 HTTP 200 且 `ready=true`。

## 自动化覆盖

- `tests/glink-workflow.test.ts`：AP1/AP2/AP3、BP3/BP4/BP5/BP7/BP8 字段映射与缺失值策略。
- `tests/order-email.test.ts`：ER1–ER6 邮件内容。
- `tests/global-smoke.test.ts`、`tests/mock-integration.test.ts`：页面/API 主流程（需要允许本地监听端口的测试环境）。


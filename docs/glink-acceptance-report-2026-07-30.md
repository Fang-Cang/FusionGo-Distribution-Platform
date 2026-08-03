# G-Link 酒店必接接口验收报告

验收日期：2026-07-30  
目标环境：`sandbox`  
接口契约：`docs/swagger/glink-api.json`（2026-04-24）  
集成模式：Standard API Integration  
测试范围：酒店功能全流程，不含性能测试

## 验收结论

产品资源配置已经生效，G-Link 酒店预付产品的供应商接口与当前分销系统 API
真实沙箱主链路均已通过：

```text
可售目录 → 最低价 → 实时产品 → 首次试订 → 二次试订
→ 创建订单 → 支付通知 → 订单详情
```

同时创建了第二笔未支付沙箱订单，并通过 `/order/cancelOrder` 成功取消。

应用层另外完成了完整的本地落库测试，证明系统没有绕开本地订单直接向供应商
下单：本地订单先生成并记录 `ORDER_CREATED`，供应商创建成功后再记录
`GLINK_ORDER_CREATED` 和双订单号。

本轮唯一尚未完成的外部验收项是供应商真实 `/notify/orderStatus` 推送，因为当前
环境未配置公网 HTTPS `WEBHOOK_PUBLIC_URL`。本地回调接收器的签名校验、nonce
防重放与业务幂等已经通过。

## 实际预订数据

| 字段 | 值 |
| --- | --- |
| 城市 | 上海 |
| 酒店 | Mandarin Oriental Pudong Shanghai |
| 酒店 ID | `606680` |
| 入住/离店 | 2026-08-06 / 2026-08-07 |
| 房型 | River View Suite |
| 房型 ID | `2387084` |
| 价格计划 | Business travel rate |
| Rate Plan ID | `5860c71dd7154f5886bcec0c527b68f8` |
| Supply Code | `TS10002549` |
| 支付类型 | 预付，`payAtHotelFlag=0` |
| 房间/成人 | 1 间 / 1 成人 |
| 币种/金额 | USD 0.15 |

## 必接接口结果

| 接口 | 实际结果 | 状态 |
| --- | --- | --- |
| `/search/hotelIdList` | 当前 Partner 共 713 家可售酒店 | 通过 |
| `/search/destination` | 14/14 个官方测试目的地可检索 | 通过 |
| `/hotel/detail` | 148/148 家官方测试酒店返回详情 | 通过 |
| `/hotel/lowestPrice` | 14 个目的地代表酒店 × 4 组日期，共获得 56 个有效酒店日期价格 | 通过 |
| `/booking/productDetails` | 获得真实可订产品三元组 | 通过 |
| `/booking/availabilityCheck` 首次 | `canBook=1`，总价 USD 0.15 | 通过 |
| `/booking/availabilityCheck` 二次 | `canBook=1`，价格保持 USD 0.15 | 通过 |
| `/booking/createOrder` | 成功返回真实 `fcOrderCode` | 通过 |
| `/booking/payOrder` | `payStatus=1` | 通过 |
| `/order/orderDetail` | `orderStatus=2`，供应商处理中 | 通过 |
| `/booking/createOrder` 取消用订单 | 第二笔真实沙箱订单创建成功 | 通过 |
| `/order/cancelOrder` | `cancelResult=1` | 通过 |
| `/notify/orderStatus` 本地接收 | 首次接收成功、相同事件重放识别为重复 | 通过 |
| `/notify/orderStatus` 真实推送 | 尚无公网 HTTPS 回调地址 | 待配置 |

## 真实沙箱订单

### 已支付订单

- `coOrderCode`：`OPACC1785380139572P182`
- `fcOrderCode`：`H3626073000000051`
- 创建结果：`result=1`
- 支付结果：`payStatus=1`
- 最新订单状态：`orderStatus=2`，含义为处理中
- 最新订单详情请求：
  - `request_id`：`req_dddpdy3yfg4buaaaaaaaaarcrywoq5l3ltypnlgbfu`
  - `trace_id`：`trc_dddpdy3yfhcqqaaaaaaaaarcr5omhufe6ugb4ypxnq`

创建与支付追踪：

| 接口 | `request_id` | `trace_id` |
| --- | --- | --- |
| `/booking/createOrder` | `req_dddpdrzdxxs7gaaaaaaaaarea7umcurniiqcuf7ddi` | `trc_dddpdrzdxxxxcaaaaaaaaarebcul3pq6mlmkj7jseu` |
| `/booking/payOrder` | `req_dddpdr24b5miqaaaaaaaaarcnfxmekbur2ywl5fmvi` | `trc_dddpdr24b5sxmaaaaaaaaarcnkpjfbqhjke4yycg54` |

### 已取消订单

- `coOrderCode`：`OPACC1785380142021C958`
- `fcOrderCode`：`H3626073000000052`
- 取消结果：`cancelResult=1`
- 创建 `request_id`：`req_dddpdr5wyvgtaaaaaaaaaarcofc6j5m2ywfkqhtatu`
- 取消 `request_id`：`req_dddpdr7rtjemcaaaaaaaaarecc3kpitaiivafnfigq`

取消成功后已停止查询该订单，符合终态停止轮询要求。

## 当前分销系统端到端验收

验收命令：

```bash
npm run acceptance:glink-app
```

系统 API 流程：

```text
/api/hotels/search
→ /api/hotels/product-details
→ /api/hotels/availability
→ /api/orders
→ /api/orders/:id/pay
→ /api/orders/:id/refresh
```

### 应用层已支付订单

| 字段 | 值 |
| --- | --- |
| 本地订单号 | `FG20260730000001` |
| 分销商订单号 | `OPFG1785380508624966` |
| 供应商订单号 | `H3626073000000055` |
| 酒店 | 上海虹桥君丽假日酒店 |
| 房型 | 单卧大床套房123123 |
| 金额 | USD 1.48 |
| 支付后状态 | `PROCESSING` |
| 补偿查单后状态 | `PROCESSING` |
| 创建幂等重放 | 返回原订单，`Idempotency-Replayed=true` |

订单事件顺序：

1. `ORDER_CREATED`
2. `GLINK_ORDER_CREATED`
3. `PAYMENT_ACCEPTED`
4. `SUPPLIER_STATUS_SYNCED`

其中 `GLINK_ORDER_CREATED` 事件持久化了
`coOrderCode=OPFG1785380508624966`、
`fcOrderCode=H3626073000000055` 和 `result=1`。

### 应用层已取消订单

| 字段 | 值 |
| --- | --- |
| 本地订单号 | `FG20260730000002` |
| 分销商订单号 | `OPFG1785380513228377` |
| 供应商订单号 | `H3626073000000056` |
| 最终状态 | `CANCELLED` |

订单事件顺序：

1. `ORDER_CREATED`
2. `GLINK_ORDER_CREATED`
3. `ORDER_CANCELLED`

### 数据库验证

- 数据库：`fusiongo-sandbox.sqlite`
- Migration：版本 2
- 本轮完成后累计订单：13
- 累计支付记录：7
- 累计订单事件：25
- 累计回调记录：2

## 回调幂等验证

本地接口：`/api/webhooks/glink/order-status`

| 场景 | HTTP | 业务码 | `accepted` | `duplicate` |
| --- | ---: | --- | --- | --- |
| 首次签名事件 | 200 | `SUCCESS` | `true` | `false` |
| 相同事件重放 | 200 | `SUCCESS` | `true` | `true` |

该验证证明接收器逻辑正确，但不替代真实公网供应商推送验收。生产前必须提供公网
HTTPS 地址并配置：

```env
WEBHOOK_PUBLIC_URL=https://your-domain.example/api/webhooks/glink/order-status
```

## 非阻塞发现

所选酒店存在到店付产品，但试订返回：

- 业务码：`SUPPLIER_BIZ_ERROR`
- 信息：`不满足预订条款`
- `request_id`：`req_dddpdrwobtwqgaaaaaaaaarcl5onkbitumnuunz2te`
- `trace_id`：`trc_dddpdrwobt322aaaaaaaaarcmbnbznorexjszssdda`

预付主链路不受影响。若上线范围包含到店付，需要使用其他酒店/日期继续覆盖到店付
的试订、创建和取消场景。

## 应用侧保护

1. 官方测试酒店只能在 `sandbox` 使用，生产模式会拒绝自动验收下单。
2. 只有最低价、产品查询和两次试订成功后才允许创建供应商订单。
3. 创建订单保存 `coOrderCode` 与 `fcOrderCode`，后续支付、查单、取消均复用。
4. 支付后以状态推送为主，订单详情只作低频补偿。
5. 已确认、已取消等终态停止轮询。
6. 回调校验签名、环境、事件头、nonce 与 `idempotency_key`。
7. 日志仅保存请求追踪编号，不记录 App Secret。

## 复测命令

```bash
npm run acceptance:glink -- --confirm-sandbox-orders
npm run acceptance:glink-app
npm run smoke:glink-webhook
```

前两条命令会创建真实沙箱订单，不允许用于生产环境。

## 自动化回归结果

- TypeScript 类型检查：通过
- Vitest：6 个测试文件、25 项测试全部通过
- 服务端 TypeScript 生产编译：通过
- Vite 前端生产构建：通过

## 2026-07-31 最终确认补充验收

- 本地订单号：`FG20260730000001`
- 分销商订单号：`OPFG1785380508624966`
- G-Link 供应商订单号：`H3626073000000055`
- `/order/orderDetail` 补偿查单原始状态：`3`
- 本地映射状态：`CONFIRMED`
- 状态事件：`SUPPLIER_STATUS_SYNCED`，`PROCESSING → CONFIRMED`
- 订单中心与订单详情页均显示“已确认”，双订单号、入住人和金额一致。
- 订单已进入终态，后台维护任务不再把该订单纳入 `PROCESSING` 补偿集合。

结论：GL-18“支付后最终确认”通过。真实公网 Webhook 推送仍作为独立的
GL-13 验收项保留，不影响本次通过低频 `/order/orderDetail` 补偿完成最终确认验收。

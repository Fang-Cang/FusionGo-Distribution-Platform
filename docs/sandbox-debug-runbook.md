# FCG 沙箱必接接口联调手册

当前工程采用 G-Link 标准接入门禁并保留目的地搜索体验，接口契约版本为 2026-04-24。

## 1. 本地安全配置

在项目根目录创建 `.env`，不要把密钥发到前端、日志或版本库：

```dotenv
FCG_MODE=sandbox
FCG_ENV=sandbox
FCG_BASE_URL=https://open.fusionconnectgroup.com
FCG_SANDBOX_HOTEL_SIMULATION=false

# 两个产品共用平台凭证时配置这组
FCG_APP_KEY=
FCG_APP_SECRET=

# 两个产品使用不同映射时改为分别配置
FCG_GLINK_APP_KEY=
FCG_GLINK_APP_SECRET=
FCG_FLINK_APP_KEY=
FCG_FLINK_APP_SECRET=

PORT=8787
```

`open_app_id` 对应 App Key，`open_app_secret` 必须使用首次签发或重置时获得的明文值。沙箱和生产密钥不可混用。

## 2. 无下单副作用的鉴权检查

```bash
npm run smoke:fcg
```

脚本只调用 G-Link 国家列表和 F-Link 机场搜索，不创建订单。

常见错误：

- `APP_KEY_INVALID`：App Key 或环境不匹配。
- `SIGN_ERROR`：检查密钥、实际公共路径、请求体哈希和换行顺序。
- `TIMESTAMP_EXPIRED`：本机时钟偏差超过约 5 分钟。
- `NONCE_REPLAY`：nonce 被重复使用。
- `PRODUCT_FORBIDDEN`：产品权限、环境状态或 IP 白名单未生效。

## 3. 酒店完整链路

系统按以下顺序执行：

1. `/search/hotelIdList` 建立当前账号的可售酒店门禁。
2. `/search/destination` 与 `/search/hotelList` 获取目的地候选酒店。
3. 候选酒店必须存在于可售酒店门禁中。
4. `/hotel/lowestPrice` 返回入住日期起价后，酒店才允许显示在列表。
5. `/hotel/detail` 与 `/hotel/images` 补全静态信息。
6. 进入详情时实时调用 `/booking/productDetails`。
7. `/booking/availabilityCheck` 按实际房间数执行首次验房并持久化15分钟。
8. 用户填写入住人与联系人。
9. 提交前再次 `/booking/availabilityCheck`；价格变化时拦截并要求重新确认。
10. 本地订单成功落库后调用 `/booking/createOrder`。
11. 本地客户支付成功或确认需要处理时调用 `/booking/payOrder`。
12. `/notify/orderStatus` 对应的统一 Webhook 为主要状态来源。
13. 未收到推送时才使用 `/order/orderDetail` 低频补偿；终态后停止。
14. 超时未支付或客户主动取消时调用 `/order/cancelOrder`，按 `cancelResult` 更新本地状态。

调试时需要平台提供一个可售测试酒店、未来入住日期和可用授信余额。

执行验收：

```bash
npm run acceptance:glink
npm run acceptance:glink -- --confirm-sandbox-orders
```

Webhook 地址：

```text
POST https://你的公网域名/api/webhooks/glink/order-status
```

接收器验证 `X-OP-App-Key`、时间戳、nonce 和 `X-OP-Sign`，并使用 `idempotency_key` 去重。

## 4. 机票完整链路

系统按以下顺序执行：

1. `/flight/search`
2. 保存搜索返回的 `priceKey`
3. `/flight/verify`
4. 使用验价后的 `priceKey` 调用 `/flight/order/create`
5. 保存 `orderNo`
6. `/flight/order/pay`，普通订单使用 `type=0`
7. `/flight/order/detail`
8. `/flight/order/cancel`

调试时需要平台提供可售测试航线、未来出发日期和沙箱允许使用的测试旅客证件规则。

## 5. 验收记录

每次沙箱调用需记录但不得记录敏感信息：

- 接口短路径与 HTTP 状态。
- 平台业务 `code`。
- `request_id`、`trace_id`、`downstream_request_id`。
- 本地订单号、脱敏后的 `coOrderCode/fcOrderCode/orderNo`。
- 请求耗时、是否重试、最终业务状态。

验收通过条件：

- 酒店和机票各完成一笔搜索到支付/确认的沙箱订单。
- 重复请求不会生成重复订单。
- 酒店回调重放能被识别为重复事件。
- 支付后未收到异步结果时，详情补偿可以恢复最终状态。
- 取消接口成功后停止继续查询。

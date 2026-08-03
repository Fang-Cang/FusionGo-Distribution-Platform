# GL-15 多间多晚真实 Sandbox 验收报告

验收日期：2026-08-03  
环境：FCG Open Platform / G-Link Sandbox  
集成模式：标准 API 集成  
结论：**通过**

## 验收范围

使用 Open 平台“酒店测试数据”中的官方测试酒店，验证 `2 间 × 3 晚 × 4 位成人`在实时产品、两次试订、创建、支付、订单详情和取消链路中的一致性。

测试数据：

- 城市：上海
- 酒店 ID：`606680`
- 入住：`2026-08-10`
- 退房：`2026-08-13`
- 房间：2 间
- 成人：4 位
- 晚数：3 晚

## 真实接口结果

| 步骤 | 接口 | 结果 | TraceID |
| --- | --- | --- | --- |
| 实时产品 | `/booking/productDetails` | 预付与到店付产品均返回可订产品三元组 | `trc_ddectf456nbn2aaaaaaaaah4yqtknhtngn6vixo3g4` |
| 首次试订 | `/booking/availabilityCheck` | `roomNum=2`，`canBook=1`，预付总价 USD 0.90 | `trc_ddectf66qjqiaaaaaaaaaah6uc4tf5xmmzgnoqpq2y` |
| 二次试订 | `/booking/availabilityCheck` | `roomNum=2`，总价仍为 USD 0.90 | `trc_ddectgcus4owiaaaaaaaaah4zstvwd77zrgyib5m4m` |
| 创建预付订单 | `/booking/createOrder` | `result=1`，真实供应商订单创建成功 | `trc_ddectgdjqrcqiaaaaaaaaah6vacdcwi27wf2ggdrxe` |
| 支付通知 | `/booking/payOrder` | `payStatus=1` | `trc_ddectggpzyn7saaaaaaaaah6vuukoyhb7fj7isqu5q` |
| 订单详情 | `/order/orderDetail` | `orderStatus=2`，供应商处理中 | `trc_ddectghem6t2aaaaaaaaaah42dvhhmd4dywwxz46iy` |
| 低频补偿查单 | `/order/orderDetail` | 仍为 `orderStatus=2`，请求成功 | `trc_ddectpzy7f3wsaaaaaaaaah63q6prgmp4tyyhht5hy` |
| 最终低频复核 | `/order/orderDetail` | 仍为 `orderStatus=2`，转由 GL-18 跟踪 | `trc_ddecuyzehuxu2aaaaaaaaah5qz4jndrjwvcsgggze4` |
| 到店付二次试订 | `/booking/availabilityCheck` | `roomNum=2`，两次总价均为 USD 10.68 | `trc_ddectgsovcd3caaaaaaaaah422dkmhnq7sr6pjoywi` |
| 创建取消测试单 | `/booking/createOrder` | `result=1`，同规格订单创建成功 | `trc_ddectgtyuhhgsaaaaaaaaah6wnh2dn3tcgj3migegi` |
| 取消订单 | `/order/cancelOrder` | `cancelResult=1` | `trc_ddectgvnrdoqsaaaaaaaaah6xbol3aj6oasqxgi3qq` |

## 真实订单号

已支付订单：

- 分销端订单号：`OPACC1785722986557P707`
- G-Link 供应商订单号：`H3626080300000004`
- 金额：USD 0.90
- 当前供应商状态：`orderStatus=2`（处理中）

取消测试订单：

- 分销端订单号：`OPACC1785722995125C859`
- G-Link 供应商订单号：`H3626080300000005`
- 金额：USD 10.68
- 取消结果：`cancelResult=1`

## 数据一致性断言

- 两次试订均传递实际 `roomNum=2`，价格保持一致后才允许创单。
- 创建订单传递 3 个逐日 `priceItems`，覆盖完整 3 晚。
- 创建订单传递两个主要入住人，`guestInfos[].roomIndex` 分别为 `1`、`2`。
- 预付创单、支付和订单详情复用同一组 `coOrderCode/fcOrderCode`。
- 取消用订单与支付用订单隔离，避免取消影响已支付订单状态观察。

## 本轮发现并修复的缺陷

第一次真实创单使用了 `TEST1/TEST2`，供应商返回：`First name format is incorrect, only English letters and spaces are supported`，TraceID 为 `trc_ddecs65dkawksaaaaaaaaah6gskdxm4642go26i3uu`。该请求未创建供应商订单。

修复内容：

- 验收测试入住人姓名改为纯英文字母。
- 前端提交前校验酒店入住人英文姓名只能包含字母和空格。
- 后端订单 Schema 增加同样校验，避免无效请求到达上游。

## 与其他测试项的边界

- `orderStatus=2` 的最终确认由 GL-18“支付后最终确认”继续跟踪，不影响 GL-15 对多间多晚参数、金额、入住人及交易接口一致性的验收结论。
- 真实公网 `/notify/orderStatus` 仍由 GL-13 单独验收，需要公网 HTTPS 回调地址。

## 回归验证

- `npm run typecheck`：通过。
- `npm test -- --run`：8 个测试文件、47/47 用例通过。
- `npm run build`：生产构建通过。

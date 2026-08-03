# FusionGo 功能验收更新（2026-08-03）

## 本次结论

- F-Link 真实沙箱改签取消已完成：本地订单 `FG20260730000006`，供应商改签单 `ch20260731110115471201486`，状态由 `0 / 待审核` 更新为 `5 / 已取消`。
- 上述已出票原单已真实提交自愿退票：供应商退票单 `refund20260803091800512241868`，当前 `0 / 待审核`。
- 退票详情 traceId：`trc_ddecntmqp4fnuaaaaaaaaah3b2f4yvz6xihhqzq4wa`；改签取消前详情 traceId：`trc_ddecnlsysaogmaaaaaaaaah2zqbu6oe2sbgznns5j4`。
- 独立退票候选单 `FG20260731000001` / `dd20260731110236124026434` 已于 `2026-08-03` 查询到 `8 / 已出票`、`payStatus=1`，并通过正式刷新接口将本地状态从 `PROCESSING` 同步为 `TICKETED`。本次 order.detail traceId：`trc_ddeehzt7ydtdkaaaaaaaaaiw52otoe6phaywuqbqha`，requestId：`req_ddeehzt7ydnowaaaaaaaaaiw5vequyr3oa733lkz4e`。

## 机票核心流程状态

| 流程 | 真实沙箱结果 | 结论 |
|---|---|---|
| 查询、验价、创单、支付、详情 | SIN → BKK 真实单已出票 | 通过 |
| 改签查询与申请 | 真实改签单创建成功 | 通过 |
| 改签审核与补款 | 供应商四天内一直为待审核，未进入 `status=1` | 外部等待，不允许越状态补款 |
| 改签取消 | 真实 `change.cancel` 成功 | 通过 |
| 退票申请 | 真实 `refund.apply` 返回退票单号 | 通过 |
| 退票详情刷新 | 待审核状态可同步 | 通过 |
| 退票确认 | 尚未进入 `status=1`，且无明确退款金额 | 等待供应商 |
| 退票完成、账本与授信恢复 | Mock 幂等已通过，真实单未终态 | 等待供应商 |

## 酒店多间多晚验收

- 入住/退房日期、晚数、房间数、成人数和供应商总价已贯穿搜索、实时产品、验房、创单、支付和订单详情。
- 每间房必须提交一位主要入住人；后端校验数量、`roomIndex` 唯一性及与 `roomNum` 一致性。
- G-Link `availabilityCheck` 和 `createOrder` 原样传递实际 `roomNum`；`guestInfos[].roomIndex` 按房间分配；多晚 `priceItems` 按日传递。
- 新增自动化用例 `2间 × 3晚 × 4位成人`，验证总价、入住人和订单详情一致。
- 真实 G-Link 浏览器只读验收：上海、2间、4位成人，实时产品与验房成功，支付页显示 2 个分房入住人字段。第 2 间留空时被拦截，未创建供应商订单。

### GL-15 真实 Sandbox 补充验收

- 使用 Open 平台官方测试酒店 `606680（上海）`，入住 `2026-08-10`、退房 `2026-08-13`，完成 `2间 × 3晚 × 4位成人`真实验收。
- 预付产品两次 `/booking/availabilityCheck` 均为 `canBook=1`，总价稳定为 USD 0.90。
- 真实创建并支付供应商订单 `H3626080300000004`，`payStatus=1`；订单详情当前为 `orderStatus=2`，最终确认继续由 GL-18 跟踪。
- 另创建同规格到店付订单 `H3626080300000005`，随后 `/order/cancelOrder` 返回 `cancelResult=1`。
- GL-15 已由“部分通过”更新为“通过”。完整 TraceID 见 [GL-15 验收报告](./glink-gl15-acceptance-2026-08-03.md)。

## 缺陷修复

- 酒店支付页不再硬编码“1间、2晚”和二晚金额。
- 多间房不再把同一入住人复制到所有房间。
- 供应商未返回 `refundMoney` 时，不再误显示“预计退款 ¥0”，而显示“等待供应商核算”。
- 只有退票 `status=1` 且已有明确 `refundMoney` 时允许确认退票。
- 酒店入住人英文姓名增加前后端格式校验；包含数字的姓名在本地拦截，不再提交给 G-Link。
- 本轮回归：类型检查通过，8 个测试文件 49/49 用例通过，生产构建通过。

## 验证结果

- TypeScript 类型检查：通过。
- Vitest：8 个测试文件，49 个用例全部通过。
- 生产构建：通过。
- 桌面浏览器：多房搜索、实时产品、验房、分房入住人、必填拦截通过；真实退票状态刷新通过。
- 390px 移动端：`scrollWidth = innerWidth = 390`，2 个分房入住人行正常堆叠。

## 待续测

1. 低频查询 `refund20260803091800512241868`，等待 `status=1` 和明确退款金额。
2. 核对金额和费用后执行 `refund.confirm(confirm=1)`，再等待 `status=4`。
3. 验收本地 `REFUNDED`、退款账本幂等和 CNY 授信恢复。
4. 使用已出票候选单 `FG20260731000001` 创建独立待确认退票单，补测 `refund.confirm(confirm=2)` 取消确认路径；提交真实退票申请前需再次确认。
5. 新建独立改签测试单，待 `status=1` 后验收真实差价支付及改签终态。

## 测试范围调整

- 到店付、加床、真实价格变化、价格更新与 cabin 恢复、改签补款调整为 `暂不处理`，不计入当前未闭环。
- 原 GL-16 已拆分为：GL-16A 儿童入住（通过）、GL-16B 加床（暂不处理）、GL-16C 多人入住（通过）。
- 儿童与多人继续作为当前有效测试范围；详细口径见 [功能测试范围调整](./test-scope-update-2026-08-03.md)。

## 儿童、多人、往返与多程扩展验收

- G-Link 官方测试酒店 `606680` 已完成儿童入住和单间多人真实创单、详情核对及取消，GL-16A、GL-16C 更新为“通过”。
- F-Link 儿童订单 `dd20260803122642476531714` 已验价、创单、支付并核对 `adult + child` 旅客类型；最新同步为 `status=8 / 已出票`，traceId `trc_ddeejk6a243ysaaaaaaaaaixl6ndrxtxvs6mrtkbxy`。
- F-Link 往返订单 `dd20260803122655677762248` 已验价、创单、支付并完成出票；最新同步为 `status=8 / 已出票`，traceId `trc_ddeejk7rmvkboaaaaaaaaaixtrgdudpvlb4icacx6a`。
- 婴儿覆盖 25 个现有组合、多程覆盖 35 个现有组合，均未获得可验价 `priceKey`，按外部 Sandbox 产品资源阻塞记录，未虚构订单。
- 完整订单号、TraceID 和场景证据见 [扩展验收报告](./extended-scope-acceptance-2026-08-03.md)。

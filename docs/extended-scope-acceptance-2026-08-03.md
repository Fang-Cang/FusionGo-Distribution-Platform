# GL-16A / GL-16C / FL-18 / FL-19 / FL-20 扩展验收报告

验收日期：2026-08-03  
环境：Open 平台 Sandbox  
原则：仅使用 Open 平台官方酒店测试数据和当前可售航班；供应商异步状态不越级、不伪造终态。

## 验收结论

| 用例 | 场景 | 结果 | 真实证据摘要 |
|---|---|---|---|
| GL-16A | 1 间、2 成人、1 名 8 岁儿童 | 通过 | 酒店 `606680`；实时产品、两次试订、创单、详情入住人数核对、取消均成功 |
| GL-16C | 1 间 2 成人；1 间 3 成人 | 通过 | 两个场景分别创单、查询详情并取消；结合既有 `2 间 × 3 晚 × 4 成人` 证据完成覆盖 |
| FL-18 | 1 成人 + 1 儿童 | 通过 | SIN → BKK 搜索、验价、创单、支付、详情成功；最新供应商详情为 `status=8 / 已出票` |
| FL-18 | 1 成人 + 1 婴儿 | 外部阻塞 | 5 个日期 × 5 条既有路线共 25 个组合均搜索成功，但没有可验价的 `priceKey`，未创建订单 |
| FL-19 | SIN ↔ BKK 往返 | 通过 | 搜索、验价、创单、支付、详情和出票均成功；实际航段为 SIN → DMK、DMK → SIN，最新供应商详情为 `status=8 / 已出票` |
| FL-20 | 两段多程组合 | 外部阻塞 | 5 个日期 × 7 套既有航线组合共 35 个组合均未获得可验价报价，未创建订单 |

## G-Link 真实验收证据

### GL-16A 儿童入住

- 酒店：`606680（上海）`
- 日期：`2026-08-10` 至 `2026-08-11`
- 入住：`1 间、2 成人、1 儿童，儿童年龄 8 岁`
- 产品：`roomId=2387084`，`ratePlanId=dc07ae647ce14fcf8c482d4ee5d0ad53`，`supplyCode=TS10002549`
- 两次试订：`canBook=1`，总价均为 `USD 0.15`
- 分销订单号：`OPX1785731190780GL16A511`
- 供应商订单号：`H3626080300000017`
- 详情返回入住人数：`numberOfAdults=2`、`numberOfChildren=1`、`childrenAges=8`
- 取消：`cancelResult=1`

关键 TraceID：

- 实时产品：`trc_ddedcdrqnnn2iaaaaaaaaaiesbykjezx7e6sjvvnca`
- 首次试订：`trc_ddedcdtvrwnbyaaaaaaaaaiesrdhw7lt2gqsamn3qa`
- 二次试订：`trc_ddedcdurqsmccaaaaaaaaaietdwe66ianwbkf2mque`
- 创建订单：`trc_ddedcdvepmcjeaaaaaaaaaietrjm5g4e3ihgpjlauq`
- 订单详情：`trc_ddedcdwkynlceaaaaaaaaaieues2zapee2j6yhp6ii`
- 取消订单：`trc_ddedcdxbwead6aaaaaaaaaieuwfzv67wevycprwida`

### GL-16C 多人入住

两组用例均使用酒店 `606680`、`2026-08-10` 至 `2026-08-11`，总价 `USD 0.15`。

| 入住组合 | 分销订单号 | 供应商订单号 | 详情核对 | 取消结果 |
|---|---|---|---|---|
| 1 间、2 成人 | `OPX1785731193981GL16C569` | `H3626080300000018` | `numberOfAdults=2` | `cancelResult=1` |
| 1 间、3 成人 | `OPX1785731197420GL16C298` | `H3626080300000019` | `numberOfAdults=3` | `cancelResult=1` |

关键 TraceID：

- 1 间 2 成人：创建 `trc_ddedcd3dkvlw6aaaaaaaaaiew6vk2mjaqrqmjv53fa`；详情 `trc_ddedcd4ki5nhuaaaaaaaaaiexrv4v2qlh3aaybihg4`；取消 `trc_ddedcd475alrwaaaaaaaaaaieyax2e7wgzmy52xieoq`
- 1 间 3 成人：创建 `trc_ddedcecak6ayqaaaaaaaaaie2cgo3wufk37nu4thsu`；详情 `trc_ddedcedfmx7ysaaaaaaaaaie2xxrqfpaluwy2hbliu`；取消 `trc_ddedced4r3lawaaaaaaaaaie3g6n7gbct4mejwo2ca`

## F-Link 真实验收证据

### FL-18 儿童旅客

- 行程：SIN → BKK，`2026-08-10`
- 旅客：1 成人 + 1 儿童
- 报价：搜索返回 43 个报价；选中航班 `3U3920 / 3U3937`，1 次中转
- 验价与创单金额：`CNY 6,073`
- 供应商订单号：`dd20260803122642476531714`
- 支付：`payStatus=1`
- 订单详情：旅客类型为 `adult、child`
- 2026-08-03 最新补偿查询：`status=8 / 已出票`、`payStatus=1`，旅客类型为 `adult、child`

关键 TraceID：

- 搜索：`trc_ddedcee7y4z7iaaaaaaaaaie3vlz3d7odc66xpkapm`
- 验价：`trc_ddedcehnkglvsaaaaaaaaaie4feft3kpqk77ufdg7u`
- 创建订单：`trc_ddedcejypf2fkaaaaaaaaaaie4wf5tdui6t5fpp2cqe`
- 支付：`trc_ddedcekko6z6kaaaaaaaaaaie5tnzp4cbh5q3ofhezm`
- 首次详情：`trc_ddedcel636rbeaaaaaaaaaie6dhtonmpsps6yw5upq`
- 低频状态同步：`trc_ddedhsvqcqedwaaaaaaaaaiiqqz2maeguw2lsa3z2y`
- 已出票状态同步：`trc_ddeejk6a243ysaaaaaaaaaixl6ndrxtxvs6mrtkbxy`；Request ID：`req_ddeejk6a24wnkaaaaaaaaaixl2volg6jqolidnjbta`；Downstream Request ID：`dreq_ddeejk7h7krgcaaaaaaaaaixmdsnm3nfuokymuskfm`

### FL-18 婴儿旅客

- 查询范围：5 个日期，路线 SIN-BKK、HKG-BKK、HKG-SIN、WUH-HKG、SHA-HKG，共 25 个组合。
- 结果：接口均返回 `SUCCESS`，但没有可校验的 `priceKey`；为避免虚构报价和无依据创单，流程在验价前停止。
- 首个搜索 TraceID：`trc_ddedcemrejahmaaaaaaaaaaie6qx4cqolmwf7wmmoru`

### FL-19 往返

- 搜索条件：SIN ↔ BKK，去程 `2026-08-10`，返程 `2026-08-17`
- 返回：7 个报价；实际机场组合为 SIN → DMK、DMK → SIN
- 验价与创单金额：`CNY 2,898`
- 供应商订单号：`dd20260803122655677762248`
- 支付：`payStatus=1`
- 2026-08-03 最新补偿查询：`status=8 / 已出票`、`payStatus=1`

关键 TraceID：

- 搜索：`trc_ddedce7nqhpliaaaaaaaaaifllwzc2qqeybwrgh3r4`
- 验价：`trc_ddedcfbunh5xyaaaaaaaaaaifnizm2dsrjsgafcccym`
- 创建订单：`trc_ddedcfcmza5n6aaaaaaaaaifnyddzrhy4nqcifbvre`
- 支付：`trc_ddedcfc6osyecaaaaaaaaaifopnwp4ljohfckciazy`
- 首次详情：`trc_ddedcfeinhigeaaaaaaaaaifo7ihf5msbea3r6dhkq`
- 低频状态同步：`trc_ddedhsw7ofby2aaaaaaaaaiirccswe2pw6a2hwdp6a`
- 已出票状态同步：`trc_ddeejk7rmvkboaaaaaaaaaixtrgdudpvlb4icacx6a`；Request ID：`req_ddeejk7rmveu6aaaaaaaaaixtn53yrnyqh3k5viflq`；Downstream Request ID：`dreq_ddeejlaylu2a4aaaaaaaaaixtxv4ttaylficomyyqa`

### FL-20 多程

- 查询范围：5 个日期 × 7 套两段组合，共 35 个组合。
- 路线覆盖：SIN-BKK-BKK-HKG、HKG-BKK-BKK-SIN、SIN-KUL-KUL-BKK、SIN-BKK-BKK-SIN、WUH-HKG-HKG-BKK、SHA-HKG-HKG-SIN、HKG-SIN-SIN-BKK。
- 结果：接口均返回 `SUCCESS`，但没有可校验 `priceKey`，未创建订单。
- 首个搜索 TraceID：`trc_ddedcfezdynnmaaaaaaaaaifpn3hkt7yswzefxfbia`

## 状态判定与后续动作

- `GL-16A`、`GL-16C` 已完成其占用规则验收目标，更新为“通过”。
- `FL-18` 儿童链路已完成出票并通过；整体仍为“部分通过”，仅剩婴儿受当前 Sandbox 产品资源阻塞。
- `FL-19` 已完成搜索、验价、创单、支付、详情和出票，更新为“通过”。
- `FL-20` 参数契约与本地自动化已通过，真实供应商无多程可验价报价，保持“部分通过/外部资源阻塞”。
- 对状态为 `5` 的机票订单只执行低频补偿查询；收到出票推送或到达下一补偿窗口后再同步，不进行密集轮询。

## 本轮回归验证

- TypeScript 类型检查：通过。
- Vitest：8 个测试文件、49 个用例全部通过。
- 生产构建：通过。
- Excel 测试矩阵：公式错误扫描为 0，4 个工作表均完成渲染核验。

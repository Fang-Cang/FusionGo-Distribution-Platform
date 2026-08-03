# FCG 酒店与机票分销系统

本仓库用于从分销端接入 FCG Developer Platform，并逐步建设可面向下游用户售卖酒店、机票资源的完整系统。

## 当前状态

- 已确认开放平台产品范围：G-Link 酒店 API、F-Link 机票 API、TMC 白标能力。
- 已安装并读取 G-Link Hotel API 与 F-Link Flight API 官方 Skills。
- 已实现开放平台 `X-OP-App-Key`、`X-OP-Timestamp`、`X-OP-Nonce`、`X-OP-Sign` 签名客户端。
- 已按 2026-04-24 OpenAPI 契约接入酒店、机票必接接口适配器。
- 酒店链路：目的地 → 酒店列表/静态信息 → 实时产品 → 两次验房 → 下单 → 支付 → 查单补偿 → 回调/取消。
- 机票链路：搜索 → `priceKey` 验价 → 乘机人下单 → `orderNo` 支付 → 订单详情/取消。
- 已完成经营工作台、酒店/机票完整预订页、订单、交易和账户设置。
- 已建立 PostgreSQL 生产基线，并实现 SQLite 本地持久化数据库、迁移和测试种子。
- 模拟环境强制执行酒店验房、机票 `priceKey` 验价、支付和状态流转。
- 当前默认使用 Mock 模式；填入沙箱凭证后进入真实接口联调阶段。

## 文档

- [系统建设总蓝图](docs/system-blueprint.md)
- [接口资料准入清单](docs/integration-prerequisites.md)
- [沙箱必接接口联调手册](docs/sandbox-debug-runbook.md)
- [数据库基线模型](docs/database-schema.sql)
- [本地数据库与模拟联调](docs/local-database.md)
- [沉浸式玻璃前端视觉系统](docs/frontend-visual-system.md)
- [失败项修复与回归报告](docs/frontend-repair-regression-report-2026-07-29.md)
- [系统搭建阻塞问题与复盘记录](docs/system-build-blockers-retrospective.md)
- [G-Link 酒店必接接口验收报告](docs/glink-acceptance-report-2026-07-30.md)
- [生产部署准入清单](docs/production-deployment-checklist.md)
- [G-Link OpenAPI JSON](docs/swagger/glink-api.json)
- [F-Link OpenAPI JSON](docs/swagger/flink-api.json)

## 本地运行

```bash
npm install
cp .env.example .env
npm run dev
```

- 用户界面：`http://localhost:5173`
- API 服务：`http://localhost:8787`
- 健康检查：`http://localhost:8787/api/health`

验证命令：

```bash
npm run db:migrate
npm run db:seed
npm run mock:integration
npm run typecheck
npm test
npm run build
npm start
```

`npm run build && npm start` 会启动编译后的单进程版本：同一端口同时提供前端静态文件和 `/api`。

## FCG 接入模式

默认 `FCG_MODE=mock`，无需凭证即可体验界面与本地订单流程。

`FCG_MODE=sandbox` 默认只接受 G-Link 真实映射酒店与实时库存。只有显式设置
`FCG_SANDBOX_HOTEL_SIMULATION=true` 才会启用带有醒目标识的本地演示房态；这类订单不会向
G-Link 创建订单，不能作为接口验收结果。生产环境始终禁止该降级。

默认数据库位于 `.data/fusiongo-<FCG_ENV>.sqlite`，服务启动时自动迁移并幂等初始化测试数据。

切换沙箱前，将平台颁发的沙箱凭证写入本机 `.env`：

```dotenv
FCG_MODE=sandbox
FCG_BASE_URL=https://open.fusionconnectgroup.com
FCG_APP_KEY=your_sandbox_open_app_id
FCG_APP_SECRET=your_sandbox_open_app_secret
FCG_ENV=sandbox
```

如果两个产品使用不同的平台映射凭证，可分别配置：

```dotenv
FCG_GLINK_APP_KEY=
FCG_GLINK_APP_SECRET=
FCG_FLINK_APP_KEY=
FCG_FLINK_APP_SECRET=
```

不要提交 `.env`，也不要把明文 App Secret 写进源码、日志或前端配置。

凭证配置完成后先运行无下单副作用的基础数据冒烟检查：

```bash
npm run smoke:fcg
npm run smoke:fcg -- --product=glink
npm run smoke:fcg -- --product=flink
```

G-Link 全接口沙箱验收：

```bash
# 先检查映射酒店、每日最低价、实时产品与验房，不允许下单
npm run acceptance:glink

# 明确允许创建、支付和取消沙箱测试订单
npm run acceptance:glink -- --confirm-sandbox-orders
```

验收脚本拒绝在生产环境运行，并输出每个成功请求的 `request_id`、`trace_id` 和
`downstream_request_id`，不会输出 App Secret。

服务状态接口 `GET /api/integration/status` 只返回环境与配置状态，不返回密钥。

## 推荐推进顺序

1. 申请 G-Link/F-Link 沙箱应用及平台凭证。
2. 使用平台测试酒店和测试航班完成沙箱全链路验收。
3. 配置 G-Link 订单状态回调公网地址并验证回调重放。
4. 将本地 SQLite repository 切换为 PostgreSQL，并将实时报价会话迁移到 Redis。
5. 接入真实支付、消息队列、身份认证、监控与生产发布能力。

## 生产安全门槛

`FCG_MODE=production` 时，服务会强制检查生产凭证、HTTPS 站点、Webhook、CORS 白名单、外部认证、持久化数据库和支付策略。任一项缺失都会拒绝启动；完整变量和验收步骤见 [生产部署准入清单](docs/production-deployment-checklist.md)。

项目提供 `Dockerfile`，但不会自动绕过生产准入检查，也不会把 `.env` 或本地数据库打入镜像。

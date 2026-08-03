# FusionGo 生产部署准入清单

生产模式默认启用强制准入检查。以下项目未全部满足时，API 会拒绝启动。

## 必需配置

```dotenv
FCG_MODE=production
FCG_ENV=production
FCG_BASE_URL=https://open.fusionconnectgroup.com
FCG_GLINK_APP_KEY=
FCG_GLINK_APP_SECRET=
FCG_FLINK_APP_KEY=
FCG_FLINK_APP_SECRET=
FCG_SANDBOX_HOTEL_SIMULATION=false

PUBLIC_APP_URL=https://booking.example.com
WEBHOOK_PUBLIC_URL=https://booking.example.com/api/webhooks/glink/order-status
CORS_ALLOWED_ORIGINS=https://booking.example.com

AUTH_MODE=external
DATABASE_PATH=/data/fusiongo-production.sqlite
PRODUCTION_DATABASE_PERSISTENT=true
PII_ENCRYPTION_KEY=由 KMS/部署平台注入的至少 32 位随机值

PAYMENT_MODE=enterprise_credit
PAYMENT_CARD_ENABLED=false
ALLOW_FOREIGN_CURRENCY_CREDIT=false
ORDER_MAINTENANCE_ENABLED=true
ORDER_MAINTENANCE_INTERVAL_MINUTES=5
UNPAID_ORDER_TIMEOUT_MINUTES=30
ORDER_COMPENSATION_INTERVAL_MINUTES=15
ORDER_MAINTENANCE_BATCH_SIZE=50
MAINTENANCE_API_KEY=由部署平台生成的高强度随机值
PORT=8787
```

所有 Secret 必须写入部署平台的 Secret/Environment 管理，不得写入镜像、代码仓库、前端变量或构建日志。

## 上线前验证

1. 生产 G-Link 与 F-Link 凭证均为 `production_active`，不得复用 Sandbox 密钥。
2. 关闭 `FCG_SANDBOX_HOTEL_SIMULATION`，真实酒店搜索、实时产品、两次验房、创建、支付、回调、查单、取消全部通过。
3. 真实机票搜索、`priceKey` 验价、创建、支付、出票回调/查单、取消全部通过。
4. 外部身份系统已保护整个站点和 API，用户、租户、角色可追溯。
5. `/data` 已挂载持久化磁盘并完成备份/恢复演练；多实例部署前切换 PostgreSQL 与 Redis。
6. 企业授信余额、额度冻结、扣减、退款、对账已与财务系统核对。未接收单机构时保持银行卡关闭。
   未配置外币授信或汇率结算时保持 `ALLOW_FOREIGN_CURRENCY_CREDIT=false`，系统会拒绝使用 CNY 授信直接支付外币订单。
7. HTTPS、域名、CORS 白名单、Webhook 公网地址和签名重放保护全部验证。
8. 监控覆盖 5xx、供应商业务错误、签名失败、Webhook 重放、金额差异和终态冲突。
9. 隐私政策、预订条款、退改签规则、客服与紧急联系人已发布。
10. 运行 `npm run typecheck && npm test && npm run build`，并对生产构建执行双流程人工验收。
11. 定时任务已验证：30 分钟未支付订单自动调用供应商取消；处理中订单每 15 分钟低频补偿查询；终态订单停止查询。
12. 客户、定价规则和财务流水已完成数据库备份恢复与权限隔离验证。
13. 旅客护照等敏感信息的加密密钥已由 KMS/部署平台托管，并完成轮换、解密授权和审计验证；头像已迁移至私有对象存储。

## 容器运行

项目根目录包含 `Dockerfile`。容器内使用单进程同时提供生产前端和 API，默认监听 `8787`。

生产必须挂载持久化目录：

```text
宿主或云盘 / 持久化卷  ->  /data
```

生产准入状态：

```http
GET /api/ready
```

返回 200 表示当前环境通过配置检查；返回 503 时查看 `data.blockers`。

订单维护任务也可由受保护的外部调度器触发：

```http
POST /api/admin/maintenance/orders/run
X-Maintenance-Key: <MAINTENANCE_API_KEY>
```

生产环境只允许调度器访问该接口。单进程内置调度和外部调度二选一，避免重复运行。

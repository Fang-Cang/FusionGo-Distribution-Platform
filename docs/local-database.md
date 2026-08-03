# 本地数据库与模拟联调

## 运行模型

本地和模拟环境使用 Node.js 原生 SQLite，生产目标仍为
`docs/database-schema.sql` 中的 PostgreSQL 多租户模型。

默认数据库路径：

```text
.data/fusiongo-<FCG_ENV>.sqlite
```

可通过环境变量覆盖：

```dotenv
DATABASE_PATH=.data/fusiongo-mock.sqlite
```

数据库文件、WAL 文件和本地密钥均已加入 `.gitignore`。

## 当前持久化范围

- 酒店和机票模拟商品目录。
- 酒店验房与机票 `priceKey` 验价会话，有效期 15 分钟。
- 酒店、机票订单及上游桥接标识。
- 支付记录。
- 订单状态事件历史。
- Webhook inbox、nonce 与幂等去重。
- 创建订单 `Idempotency-Key`。
- 企业客户、状态与授信额度。
- 酒店/机票百分比加价和固定服务费规则。
- 支付、退款待处理与调整类财务流水。
- 订单维护任务运行记录。
- 账户个人资料与头像二进制内容。
- 常用旅客新增、修改、删除；护照号码使用 AES-256-GCM 加密，查询只返回脱敏号码。
- 订单、出票与营销通知偏好。

## 数据库命令

```bash
# 执行未应用的迁移
npm run db:migrate

# 幂等写入基础测试数据
npm run db:seed

# 清空业务测试数据并重新初始化
npm run db:reset

# 脱敏查看数据库版本、表计数和账户数据
npm run db:inspect
```

`db:reset` 只应用于本地测试数据库，不应指向生产数据库。

服务启动时会自动执行未应用迁移和幂等种子初始化。

本地 `.env` 建议配置独立的 32 位以上 `PII_ENCRYPTION_KEY`。开发环境未配置时会使用固定的本地后备值，便于重复启动读取；生产环境就绪检查会阻止缺少正式密钥的服务上线。

数据库状态：

```text
GET /api/database/status
```

订单状态历史：

```text
GET /api/orders/{orderId}/history
```

## 模拟全链路

执行：

```bash
npm run mock:integration
```

脚本会使用独立的 `.data/fusiongo-mock.sqlite`，依次执行：

1. 酒店搜索、产品详情、验房、创建订单、支付、状态刷新。
2. 机票搜索、`priceKey` 验价、创建订单、支付、状态刷新。
3. 检查本地订单、支付记录和状态事件。

预期最终状态：

- 酒店：`CONFIRMED`
- 机票：`TICKETED`

自动化联调测试：

```bash
npm run test:integration
```

测试覆盖：

- 未验房的酒店订单被拒绝。
- 未验价或过期 `priceKey` 的机票订单被拒绝。
- 乘机人数必须与验价人数一致。
- 重复支付被拒绝。
- 相同 `Idempotency-Key` 不会生成重复订单。
- Webhook 重放被识别为重复事件。
- 数据库重启后订单和事件仍存在。
- 数据库重启后个人资料、头像、常用旅客和通知偏好仍存在。
- 护照明文不会写入 SQLite 文件，也不会从账户 API 返回。
- 客户和定价规则可创建、启停并持久化。
- 启用的定价规则会影响搜索和验价售价，但供应商成本单独保存。
- 30 分钟未支付订单可自动取消，处理中订单可低频补偿查询。
- 支付流水按订单幂等入账，取消已支付订单生成退款待处理流水。

## 生产迁移边界

SQLite 用于本地开发和模拟联调。生产部署时应：

1. 使用 `docs/database-schema.sql` 创建 PostgreSQL 基线。
2. 将 `FusionDatabase` 替换为同接口的 PostgreSQL repository。
3. 将实时报价会话迁移到 Redis，并设置与上游一致的 TTL。
4. 通过 KMS/密钥管理服务保存供应商密钥，数据库只存引用。
5. 为订单写入、支付和事件落库增加事务与 outbox。

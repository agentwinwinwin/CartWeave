# Atelier Flow：Codex 执行文档

> 日期：2026-09-29  
> 目标：从空仓库开始，以可验收的纵向切片交付 Atelier Flow  
> 上位事实源：`docs/电商自动化中枢-业务逻辑优化稿-v2.0.md`

## 1. 执行目标

先交付一个可靠的“商品上架试运营”切片，同时确保真实订单可见、可人工接管；随后交付自动采购与履约；最后补齐售后和利润对账。禁止先铺满所有页面再补业务语义。

技术栈：Next.js 15、TypeScript、Tailwind、shadcn/ui、PostgreSQL、Prisma、Auth.js v5、Inngest、Redis。React Flow 负责流程视图；TanStack Table 与 `defineEntity<T>()` 负责实体列表外壳。

## 2. 不可违背的实现规则

1. 发布产生不可变 ExecutionPlan，固定 Inngest dispatcher 解释执行。不得运行时动态注册 Inngest 函数。
2. Inngest 是异步任务真相源；Redis 不承担第二套队列。
3. 所有外部副作用必须先写 EffectLedger，并使用稳定 effect key。UNKNOWN 状态只允许对账。
4. Approval、Incident、HumanTask 分表；前端仅用 Action Inbox 合并展示。
5. 商品、渠道发布、Variant 库存、健康度分别建模。
6. 所有金额使用 Decimal 与 currency；禁止 JS 浮点参与财务计算。
7. LLM 只生成或解读；指标和利润来自确定性服务。问答写操作只生成命令草稿。
8. 所有外部数据带 source、observed_at 和 freshness；超过阈值的高风险动作关闸。
9. 所有状态迁移通过领域服务并写 append-only event；禁止 UI 直接改状态。
10. tenant_id 进入全部唯一键、索引、查询和事件信封。

## 3. 首批架构决策

### ADR-001 工作流执行

`WorkflowVersion.plan_json` 保存 canonical ExecutionPlan。发布服务完成 DAG、Schema、凭据、预算、审批、幂等和补偿校验，生成 `plan_hash`。Inngest 仅注册：

- `workflow-dispatcher`
- `node-executor`
- `approval-resumer`
- `provider-reconciler`
- `entity-sync-reconciler`

### ADR-002 外部副作用

```text
effect_key = tenant_id
           + workflow_run_id
           + immutable_node_key
           + operation
           + target_entity_id
           + deterministic_item_key
```

`retry_attempt` 不进入 effect key。能向供应商传幂等键时透传；不能时保存 request fingerprint、provider request ID 和 provider object ID。

### ADR-003 事件与一致性

所有输入使用 Inbox 去重；业务写库与 Outbox 同事务。事件信封：

```ts
type EventEnvelope<T> = {
  eventId: string;
  eventType: string;
  schema: { name: string; version: string; hash: string };
  tenantId: string;
  occurredAt: string;
  producer: string;
  correlationId: string;
  causationId?: string;
  idempotencyKey: string;
  entity: { type: string; id: string };
  data: T;
};
```

### ADR-004 数据快照

工作流版本冻结节点名、Skill/Prompt/Schema 版本和 hash。NodeRun 再保存运行时快照。大 Payload 使用加密 blob/object reference + SHA-256；列表与回放只读脱敏 projection。

## 4. 建议目录

```text
app/
  (dashboard)/
    page.tsx                         # 问答与行动中心
    products/
    orders/
    workflows/
    inbox/
    settings/credentials/
  api/
    workflows/[id]/publish/
    workflow-runs/
    node-runs/[id]/retry/
    approvals/[id]/decision/
    incidents/
    commands/
    search/
    webhooks/{shopify,cj}/
components/
  action-inbox/
  entity/
  workflow/
  qa/
domain/
  workflow/
  execution/
  catalog/
  commerce/
  finance/
  incidents/
  approvals/
lib/
  contracts/
  entities/
  providers/{shopify,cj}/
  inngest/
  security/
  money/
prisma/
  schema.prisma
tests/
  contract/
  integration/
  e2e/
```

依赖方向：UI → application command/query → domain → repository/provider ports。Provider adapter 不得把 Shopify/CJ 原始对象直接泄漏到领域层。

## 5. 数据模型实施顺序

### 5.1 Phase 0 必建

- Tenant、User、Actor、CredentialRef。
- Workflow、WorkflowVersion、WorkflowRun、NodeRun、NodeAttempt。
- EffectLedger、ExecutionEvent、InboxEvent、OutboxEvent、ReconciliationJob。
- ApprovalRequest、IncidentGroup、IncidentOccurrence、HumanTask。
- ContractDefinition、SkillDefinition、PromptVersion。
- Product、Variant、SupplierOffer、VariantMapping、ChannelListing、MerchantOverride。
- Order、OrderLine，以及最小 FinancialEvent。

每张业务表包含 tenant_id、created_at、updated_at；事件和账本类只追加，不更新历史内容。

### 5.2 关键唯一约束

- `workflow_version(workflow_id, version_no)`
- `workflow_run(tenant_id, trigger_event_id, workflow_version_id)`
- `node_run(workflow_run_id, immutable_node_key, deterministic_item_key)`
- `effect_ledger(tenant_id, effect_key)`
- `inbox_event(tenant_id, event_id)`
- `variant(tenant_id, provider, source_product_id, source_variant_id)`
- `variant_mapping(tenant_id, shopify_variant_id, cj_variant_id)`，有效映射唯一
- `order(tenant_id, channel, external_order_id)`
- `financial_event(tenant_id, source_type, source_id, event_type, source_revision)`

## 6. API 最小集合

```text
POST /api/workflows/:id/publish
POST /api/workflow-runs
POST /api/runs/:id/pause
POST /api/runs/:id/resume
POST /api/runs/:id/cancel
POST /api/node-runs/:id/retry
POST /api/approvals/:id/decision
GET  /api/incidents?groupBy=rootCause|fingerprint
POST /api/incidents/:id/ack
GET  /api/executions/:id/replay
POST /api/commands/preview
POST /api/commands/execute
GET  /api/search
POST /api/credentials/:provider/reauthorize
POST /api/webhooks/:provider
```

所有写接口接受 idempotency key；审批决定附带 payload hash、expected version 和 reason；非法迁移返回 409。`retry` 在 Effect 为 SUBMITTED/UNKNOWN 时返回 409，并提示先执行 reconcile。

## 7. 分阶段任务清单

### Phase 0：工程与领域基础

交付物：可运行项目、数据库、鉴权、领域模型、契约注册表、Mock Provider。

- 初始化 Next.js、TypeScript、Tailwind、shadcn、Prisma、Postgres、Auth.js、Inngest 和 Redis 连接。
- 创建 Money、UTC 时间、EntityRef、Actor、Freshness 等基础值对象。
- 创建状态枚举和显式迁移函数，补非法迁移测试。
- 创建 EventEnvelope、Inbox/Outbox 与本地投递器。
- 创建 Contract Registry；从 JSON Schema 生成/校验 Zod 与 Pydantic 一致性。
- 定义 Skill manifest 和白名单加载器。
- 建 Shopify/CJ adapter port 与可脚本控制的 fake adapter，支持成功、429、5xx、超时已成功、凭据失效、缺货。

完成标准：迁移可从空库执行；种子数据可创建一个租户、一个 Owner、两套假凭据和一个内置模板；CI 可运行类型检查、迁移校验和领域测试。

### Phase 1：可靠工作流内核

交付物：从触发到节点执行的可追溯运行链路。

- 实现 draft → publish compiler，输出 canonical plan、validation report 和 plan hash。
- 实现 dispatcher、node executor、attempt history、错误分类和依赖调度。
- 实现稳定 EffectLedger 与 provider reconciler。
- 实现供应商级限流、Retry-After、指数退避+jitter、retry budget 和 circuit breaker。
- 实现 pause scheduling、cancel intent 与 dry-run replay。
- 实现结构化日志、correlation/causation ID 和基础 metrics。

完成标准：同一触发重复 100 次只创建一个 Run；任意数据库写入点模拟崩溃后，外部副作用至多发生一次或进入 UNKNOWN；Run 能完整回放。

### Phase 2：审批、异常与安全

交付物：人工可控、异常可定位、凭据安全。

- ApprovalRequest 使用 payload hash、expires_at、决策者和乐观锁。
- Incident Group/Occurrence 与 root cause 投影。
- Action Inbox query，分 tab 和分指标展示审批、异常、人工任务。
- 凭据 secret reference、字段级脱敏、Payload 保留策略与访问审计。
- Webhook 签名、时间窗和 replay 防护。
- LLM cost reservation；达到预算只阻止新调用。

完成标准：审批后参数变化不能执行；47 次相同错误形成 1 Group + 47 Occurrence；日志、Inngest Payload、回放和 Prompt 中无 token/敏感 PII。

### Phase 3：商品上架 Demo 纵向切片

交付物：CJ 候选到 Shopify draft 的完整链路。

- 实现候选导入、Variant 去重、SupplierOffer 快照和唯一映射。
- 实现确定性利润计算、数据 freshness gate 和规则过滤。
- 实现受事实约束的文案生成；Schema 外事实一律拒绝。
- 实现上架审批、Shopify draft 创建、回写 ID 和对账。
- 实现商品看板/列表/详情时间线、只读运行画布、异常详情、凭据页。
- 实现限定问答：今日待办、商品失败原因、执行来源。

完成标准：同一 CJ Variant 重复导入只产生一个 Variant；无唯一映射不得上架；重复执行只创建一个 Shopify 商品；Demo 仅写 draft。

### Phase 4：商品上架 Pilot 安全网

交付物：少量真实商品可发布，真实订单不会静默遗失。

- Shopify paid/cancelled/refunded 订单只读同步，Webhook + 定时补拉。
- 新付费订单 5 分钟内创建 HumanTask，显示 SLA 和人工 CJ 交接字段。
- 成本、库存、运费、时效定时同步与 freshness gate。
- 快速隐藏商品/Variant 命令，经过 preview、审批、EffectLedger 与审计。
- Cmd+K 覆盖 SKU、商品、订单、Run 和 Incident。
- 首页行动队列显示最老未履约时长、缺货、待审批金额和同步健康。

完成标准：白名单≤10 商品/30 Variant；20 次连续发布无错；前 5 个真实订单完成捕获、人工 CJ 下单、CJ 单号与 tracking 回填；任一同步/凭据/利润守门失败时禁止继续发布。

### Phase 5：自动采购与基础履约 Pilot

交付物：单供应商、单仓、固定 `REVIEW_BEFORE_EXECUTE` 的真实采购闭环。

- 建 ProcurementOrder、Fulfillment、Shipment。
- 下单前重查付款、取消、风控、地址、Variant、库存、运费、时效和利润。
- CJ 采购计划预览、审批、提交、UNKNOWN 对账和结果回写。
- Tracking 回写 Shopify，确认是否触发客户通知。
- 逐单缺货、凭据、余额、部分失败处理。
- 基础 FinancialEvent：收入、折扣、退款、CJ 货品和运费。

完成标准：连续 14 天或累计 100 单；零重复采购/发货；失败可逐单恢复；订单—采购单—包裹全链路可追溯；对账差异≤1%。

### Phase 6：可经营版本

交付物：复杂履约、售后和已实现利润。

- OrderLine 级拆单/合单、多包裹、部分缺货、换仓和换款。
- 物流首扫、逾期、送达与客户补救 SLA。
- 取消、退货、退款、重发、拒付和 SupportCase。
- 完整 append-only FinancialEvent 与重算器。
- 客户 consent/suppression；邮件仅在独立风险评审后接入。
- SKU/订单/周期利润分析与确定性问答。

完成标准：连续 30 天覆盖≥95%订单；自动处理成功率≥95%；剩余全部进入行动队列；月度对账差异≤0.5%；恢复演练通过。

## 8. UI 实施顺序

1. Action Inbox 与全局状态条。
2. 商品列表/看板/详情时间线。
3. 工作流只读运行图、节点配置和模板参数编辑。
4. 订单与人工履约待办。
5. 异常详情、审批详情和执行回放。
6. Cmd+K。
7. 限定问答与确定性今日概览。

不要先做客户、竞品、完整模板市场、自由连线和深色模式。

## 9. 错误分类与系统动作

| 错误 | 默认动作 |
|---|---|
| VALIDATION_SCHEMA | 不重试；LLM 输出可做至多一次结构修复 |
| VALIDATION_BUSINESS | warning、审批或人工任务 |
| AUTH_EXPIRED | blocker；重新授权；不自动重试 |
| RATE_LIMIT | 尊重 Retry-After，全局供应商限流 |
| TRANSIENT_NETWORK / PROVIDER_5XX | 退避重试，受 retry budget 限制 |
| PROVIDER_4XX | 不重试，显示明确修复项 |
| INSUFFICIENT_STOCK | 进入业务分支或人工处理 |
| BUDGET_EXCEEDED | 停止新 LLM 调用，不阻断收尾 |
| UNKNOWN_EXTERNAL_RESULT | 先对账，禁止直接重试 |
| INTERNAL_BUG | blocker，保留关联链 |

## 10. 必须自动化的测试

### Contract

- JSON Schema 与 Zod/Pydantic 一致性。
- Minor 版本向后兼容；破坏性变更必须新 major。
- Money、time、enum、optional/null 规则。

### Domain

- 每个状态机的合法与非法迁移。
- 利润计算及退款、重发、汇率变化后的重算。
- 商品四维状态互不污染。
- 审批 payload hash 与过期行为。

### Integration

- Inbox 去重和 Outbox 原子性。
- Effect 从 PREPARED 到 UNKNOWN 再 reconcile。
- Webhook 重放、乱序、延迟与漏单补拉。
- 429、5xx、凭据失效、缺货、部分批量失败。
- 同一 SKU 的并发上架/隐藏冲突。

### E2E

- CJ 候选 → Shopify draft。
- 真实发布前全部守门条件。
- 订单捕获 → 人工履约待办 → tracking 回填。
- 全局栏 → Group → Occurrence → NodeRun → 回放 → 修复。
- LLM 停机和预算耗尽时非 LLM 功能继续工作。

避免为纯展示组件写镜像实现的低价值测试；测试重点放在资金、副作用、状态迁移和恢复路径。

## 11. 可观测性与 SLO

每个 Run 使用 correlation ID 串起 trigger、attempt、effect、approval、incident 和 reconciliation。最低指标：成功率、p95 时延、重试率、UNKNOWN 数、积压、供应商 429、Webhook 延迟、同步 freshness、LLM token 与费用。

目标：

- 重复外部副作用：0。
- blocker 发现延迟：小于 1 分钟。
- 审批决定后恢复：小于 30 秒。
- 已付款订单生成待办：小于 5 分钟。
- 执行回放数据完整率：高于 99.9%。

## 12. 每阶段交付格式

Codex 每完成一个阶段，必须提交：

1. 本阶段完成的用户结果。
2. 数据库迁移与回滚说明。
3. 新增/变更 API 和事件契约。
4. 自动化验证结果。
5. 未解决风险与进入下一阶段的闸门结果。
6. 一份可复现的演示脚本，使用 fake provider 或受控白名单数据。

未满足闸门时，不得仅凭 UI 完成度宣布阶段完成。

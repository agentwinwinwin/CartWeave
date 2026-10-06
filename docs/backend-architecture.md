# CommerceOS 后端建设基线

本方案是用户采纳的后端建设基线。目标是跨境电商通用工作流系统，而不是给测试站单独建设一套业务后台。第一阶段实现范围见 [实现规格](backend-phase-one-spec.md) 与 [启动说明](../backend/README.md)；本基线中的后续规划不表示所有功能均已实现。

## 已确认的范围

- 首批用户是内部团队，不开放商家注册或建设公开 SaaS；数据保留团队归属和成员权限。
- 使用 Django 与 DRF，采用模块化单体，不先拆微服务。
- 第一阶段跑通审批后发布到测试站，不执行真实采购、采购付款、广告花费或邮件发送。
- 只能绑定经过团队审核、注册的不可变 Skill 版本。运营不能上传脚本后立即执行。
- 测试站是一个渠道执行目标，不是工作流系统的业务核心。当前 Crownley 仍是前端模拟夹具，真实接口另行实现。

## 后端职责分层

| 层 | 职责 | 边界 |
| --- | --- | --- |
| DRF API | 身份认证、请求解析、权限检查、返回资源和操作结果 | 不在 HTTP 请求中执行完整工作流 |
| 应用服务 | 创建任务、冻结版本、提交审批、组织数据库事务 | 不混入平台请求细节 |
| 业务规则 | 固定职责、字段语义、审批有效性、状态转换、动作授权 | 不由 Skill 输出覆盖规则 |
| 工作流运行器 | 调度节点、保存进度、等待与恢复、记录尝试 | 不自行批准商品或解释外部成功 |
| Skill 执行 | 执行已审核策略、保存输入输出与产物 | 不凭清单自报权限获取凭证 |
| 渠道适配 | 将统一动作转换为平台接口，统一返回回执和状态 | 不绕过系统审批、幂等和事实核验 |
| 基础设施 | PostgreSQL、任务队列、文件、凭证和日志 | 不承载业务决策 |

PostgreSQL 保存运行事实。Celery 执行后台任务，Redis 用于任务排队，不作为运行事实的唯一来源。图片、原始响应与产物使用文件存储，并保存哈希和来源。

等待审批或外部事件时，运行器保存等待条件并释放任务，不让 Worker 持续阻塞。数据库提交与队列投递之间使用事务 Outbox：业务变更和待投递事件同事务保存，由后台可靠投递。任务和事件可能重复到达，必须去重。

## 模块与代码组织

```text
backend/
  config/           Django 配置、路由与 Celery 配置
  apps/
    identity/       内部成员、团队与角色权限
    connections/    店铺、CJ 连接、凭证引用与能力验收
    registry/       受信节点、契约与实现注册表
    skills/         Skill 不可变版本与审核记录
    workflows/      流程草稿、版本与图校验
    runtime/        运行、节点尝试、等待条件与运行事件
    catalog/        商品、规格、来源资料与渠道映射
    listings/       上架草稿、发布操作与可售结果
    approvals/      审批请求、决定与授权范围
    integrations/   测试站及后续其他适配器
    audit/          审计、外部操作与事件收发
  contracts/        Pydantic 版本化契约
  tests/            跨模块场景与恢复测试
```

模块按需要使用 models、serializers、services、selectors、views、tasks；不机械创建所有文件。views 和 tasks 调用应用服务，不重复业务规则。优先使用 Django ORM，不提前包一套通用 Repository。

测试站的服务接口与工作流服务独立。可以同仓部署，但工作流适配器通过接口发布、查询，不直接修改测试站商品表。

## 核心数据模型

| 分组 | 对象 | 约束 |
| --- | --- | --- |
| 团队 | Team、Membership | 数据按团队限定，成员权限由服务端核验 |
| 连接 | Store、Connection、ConnectionCapability | 渠道、店铺、凭证与已验收能力分开 |
| 注册表 | NodeDefinitionVersion、ContractVersion、SkillVersion | 服务端决定职责、白名单与允许实现 |
| 流程 | WorkflowDraft、WorkflowVersion | 草稿可改，发布版本不可变 |
| 运行 | WorkflowRun、NodeRun、NodeAttempt、RunEvent、WaitCondition | 绑定不可变版本，保留每次尝试 |
| 商品 | Product、Variant、SourceSnapshot、SupplierVariantMapping | 店铺规格追溯到 CJ pid 与 vid |
| 上架 | ListingDraft、ListingRevision、ChannelListing | 草稿版本、回执与可售事实分开 |
| 审批 | ApprovalRequest、ApprovalDecision | 绑定对象、版本、摘要、动作与目标店铺 |
| 外部操作 | ExternalOperation、InboxEvent、OutboxEvent | 记录幂等键、未知结果与事件去重 |
| 产物 | Artifact | 保存引用、哈希、来源、生成方式与访问控制 |

金额使用 Decimal 并明确币种。库存、报价和配送信息保留来源与采集时间；缺失不能默认成零。不能通过标题或规格显示文本猜 CJ vid。

## 节点与 Skill 的实现边界

系统固定 Handler 负责资料标准化、筛选、核算、权限、审批有效性和归档。相同输入输出的自建 Skill 不能替代这些职责。

策略 Skill 负责建议、文案与图片，只输出建议或草稿。第一版策略环境不获得店铺写入凭证。Pydantic 验证数据结构；事实、权限、候选引用、金额与状态仍需业务规则检查。

渠道接口包可以同时提供 validate_listing、publish_listing、get_listing_status 等动作。运营一次配置店铺接入，各节点引用具体动作，不重复配置相同接口包。接入开发 Skill 是代码生成工具；生成产物需要部署、验收和注册，不能把代码生成成功当成已接入。

Skill 审核记录包括版本、产物哈希、契约、适用渠道、动作和执行权限。修改代码产生新版本，重新审核。模型可以辅助审查，执行许可由团队授权人员确认。紧急停用已审核版本后，不允许再启动新动作；进行中的外部操作需先核对结果，不能直接重放。

## 第一阶段执行链路

第一阶段从有来源依据、经人工确认的商品与售价方案开始，对应现有 product.authorize 至 listing.end，不冒充已完成 CJ 选品。

1. 保存商品、CJ 规格映射、售价、市场与人工商品方案确认。
2. 冻结流程版本、输入方案、Skill 版本和连接配置版本，创建运行。
3. 内容 Skill 生成 ListingDraft 与素材产物。
4. 系统检查事实和统一字段，渠道适配器检查目标接口要求。
5. 创建最终上架审批，进入 waiting_approval。
6. 审批通过后创建发布操作，由后台调用测试站接口。
7. 保存 PublicationReceipt，再查询商品、规格、售价和可售状态。
8. 核验成功后产出 PublishedProduct 并完成；异常进入等待、失败或人工处理。

商品售价确认和最终上架审批是两次不同授权，不能合并成 Skill 自报 approved。审批拒绝后受控返工，新草稿重新检查和审批，历史不覆盖。

运行状态包括 queued、running、waiting_approval、waiting_event、succeeded、failed、needs_attention、cancelled。取消阻止后续动作，不等于撤销已经发生的发布。画布按有序 RunEvent 展示运行和传递，不用前端计时器伪造完成。

## 第一阶段 API 范围

以下是接口规划，具体字段、错误码、分页和版本条件由 spec 定义。

| 接口 | 用途 |
| --- | --- |
| GET /api/v1/node-definitions | 受信节点、契约与编辑策略 |
| GET /api/v1/skills | 当前成员可绑定的已审核版本 |
| GET /api/v1/stores | 店铺与已验收动作能力 |
| POST /api/v1/workflows | 创建草稿 |
| PATCH /api/v1/workflows/{id} | 带预期 revision 更新草稿 |
| POST /api/v1/workflows/{id}/validate | 服务端图、参数、契约与实现校验 |
| POST /api/v1/workflows/{id}/versions | 冻结可执行版本 |
| POST /api/v1/runs | 幂等创建运行，异步执行 |
| GET /api/v1/runs/{id}/events?after_sequence=… | 增量、有序、可恢复事件 |
| POST /api/v1/approvals/{id}/decisions | 批准或拒绝指定版本 |
| GET /api/v1/listings/{id} | 草稿、发布操作和可售证据 |

先使用事件轮询，不要求第一版引入 SSE。运行启动与实际动作执行时重新核验权限、连接及审批，不把验证票据当永久通行证。

## 安全与故障处理

- 所有查询和写操作核验团队与对象权限；管理员也不能跳过业务检查。
- 保存、审批和发布使用预期 revision，防止旧页面覆盖新数据。
- 审批绑定内容摘要、店铺、动作及关键执行配置；相关变化使旧批准失效。
- 发布使用稳定幂等键，同键不同内容拒绝。重复任务不得重复创建商品。
- 请求超时标记未知结果并查询；未核对结果前不盲目重发。
- 事务保持短小，不在数据库锁内等待远程 HTTP 请求。
- 凭证仅服务端保管与注入，不进入流程 JSON、提示词或日志。
- 脚本不在 DRF Web 进程直接执行，按审核版本限制网络、工具、时间与资源。
- 测试和生产连接隔离，修改流程参数不能切换到生产凭证。

本方案不承诺外部副作用恰好发生一次，而是通过幂等、持久化记录与对账控制重复和不确定结果。

## 实施顺序与验收

1. 身份权限、连接、注册表、契约、数据库与审计。
2. 流程保存、服务端校验、不可变版本、运行器、事件与审批。
3. 受审内容 Skill、测试站接口包、发布与可售核验。
4. 故障测试和前端对接。
5. 后续扩展固定 CJ 采集选品链，以及独立的已付款订单到 CJ 履约链。

第一阶段验收必须覆盖：

- 获批商品能够发布到测试站，消费者页面可见且规格与价格一致。
- 未批准、旧版本批准、未审核 Skill、无权限或未验收连接均不能发布。
- 重复启动、重复任务与重复审批不产生重复副作用。
- 发布超时、Worker 重启与事件重复后仍能恢复和追溯。
- 商品方案与最终草稿审批均可追溯，修改后旧批准失效。
- 不调用真实采购、采购付款、广告花费或邮件服务。

## 后续 spec 需要补齐的细节

本方案确定架构与范围，但不是完整实现 spec。后续需要定义各契约字段、约束与样例，审批状态转换，并发控制和幂等冲突，事件序列及错误码，连接验收协议，Skill 执行环境，测试站动作接口，以及媒体来源与访问策略。

现有 docs/workflow-integration.md 和前端 v2 模型是对接参考，不能直接视为服务端受信规则；浏览器草稿不自动迁移成可执行版本。尚未补齐或注册的节点禁止实际执行。

## 技术依据

- [Django 事务文档](https://docs.djangoproject.com/en/5.2/topics/db/transactions/)：本地业务状态原子提交与回滚。
- [DRF 权限文档](https://www.django-rest-framework.org/api-guide/permissions/)：API 与对象权限检查。
- [Celery 任务文档](https://docs.celeryq.dev/en/stable/userguide/tasks.html)：后台任务与幂等执行要求。

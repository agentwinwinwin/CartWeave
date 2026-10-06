# 工作流后端第一阶段实现规格

本规格描述已经实现的内部团队发布后端，配合 backend/README.md 使用。范围是从人工提供的商品方案开始，经过两轮批准后创建测试站商品并核验可售；不是完整 CJ 选品、广告、订单或售后引擎。

## 执行范围

DRF 服务入口为 `/api/v1`，Next.js 同源代理为 `/backend/v1`。工作台入口为 `/workflow/live`。原 `/workflow/builder` 保留本地草稿和模拟执行，不自动将旧 v2 文档迁移成可执行版本。

第一阶段注册以下主线，不允许删除、插入、并行或改变顺序。未注册的节点、渠道、自建清单和参数覆盖都拒绝执行。受控返工使用运行修订接口，而不是执行任意回放边。

| 节点 | 执行职责 |
| --- | --- |
| product.authorize | 人工核对商品方案、规格、来源和售价 |
| content.make | 调用审核注册的确定性内容整理 Skill |
| listing.validate | 系统字段与事实检查，再调用测试站校验接口 |
| listing.authorize | 人工批准最终商品草稿版本 |
| listing.publish | 核验两次批准，创建幂等外部发布操作 |
| listing.wait | 查询并核对实际商品内容、店铺、规格、价格和可售状态 |
| listing.end | 保存可售证据，结束本次运行 |

内容 Skill 当前只整理已提供的文案与素材，不调用 LLM、不生成新图片、不执行上传脚本。审核登记只允许闭合注册表中的已安装 Handler。扩展模型或素材服务，需要新增受信实现、契约与测试，不能更换 entrypoint 字符串直接执行。

运行器通过 `apps/integrations/registry.py` 的受信适配器注册表调用渠道接口，统一约定校验、操作查询、发布和可售核验四项职责。适配器负责渠道差异；审批、操作幂等键、运行状态和证据核对归运行器管理。新增渠道须同时实现适配器、连接能力验收和契约验证，不通过修改流程中的类名加载代码。接口开发 Skill 仍然是接入开发工具，不是每个执行节点重复配置的前提。

## 身份与权限

使用 Django Session 和 CSRF。登录接口也强制 CSRF，没有公开注册接口。通过成员归属限定所有运营数据访问，多团队账号须提供 X-Team-ID。

| 角色 | 权限 |
| --- | --- |
| admin | 团队管理、已安装 Skill 注册审核停用、测试店铺创建验收，以及运营和审批动作 |
| operator | 编辑合法流程、创建运行、修订、恢复与取消 |
| approver | 审阅并批准或拒绝当前版本 |
| viewer | 团队资源只读 |

后台实际执行时重新检查启动人权限、Skill 审核状态、产物哈希、连接能力与配置版本；发布还检查审批人的当前资格。第一阶段不要求批准人与提交人不同。禁止降级或停用最后一名管理员。

店铺写 API 使用独立 Bearer 身份，不因工作台 Session 获得发布权限。数据库保存令牌哈希；工作流连接保存 Fernet 加密令牌。API、日志和流程文档不返回令牌。第一阶段店铺只能创建已安装的 test-store.v1 连接，不接受任意 URL。

## 输入与数据契约

Pydantic 模型是 `backend/contracts/`，拒绝未知字段。文档图结构校验与业务语义校验是两个独立步骤，不能仅以 JSON 形状通过判断可执行。

启动输入为 ProductBrief@1。它是当前手动起点的契约，不声称等同于已经执行的 SelectionAssessment@1，也不声称完成 CJ 供货核验。

| 字段 | 当前规则 |
| --- | --- |
| product_id | 新商品稳定标识，字母数字下划线或连字符，最多 100 字符 |
| title 与 description | 必填且非纯空白，有明确长度限制 |
| selling_points | 1 至 10 项 |
| images | 1 至 8 个已有本地测试商品图片引用，不接受远程 URL 或路径穿越 |
| market 与 currency | 当前仅 US 与 USD |
| variants | 1 至 50 个规格，SKU、CJ vid 和尺码各自唯一 |
| variant.price | 正数 Decimal，最多两位小数，不接受 NaN 或 Infinity |
| variant.inventory | 非负严格整数，测试库存，不代表已预留供应库存 |
| variant.cj_pid 与 cj_vid | 明确保存映射，不从标题猜测；示例使用 fixture 前缀的合成映射 |
| source_kind | test_fixture 或 manual_evidence |
| evidence_ref 与 source_note | 必填来源引用与说明，不自动认证其真实性 |

ListingDraft@1 保存 product_id、title、description、bullets、images、currency、market 和 variants。内容步骤不得修改已确认的商品、币种、市场、规格和售价；图片必须来自已确认方案。禁止改变售价后只复用最终草稿批准。

发布回执和可售证据分别由 PublicationReceipt 与 PublishedEvidence 校验。回执包括 external_id、product_id、digest、status 和 storefront_id；可售证据另外包含实际 Listing。运行器核对店铺、商品、内容摘要和实际完整内容。

## 版本与历史

- WorkflowDraft 使用 revision 做乐观并发控制。更新须提交 expected_revision。
- WorkflowVersion 冻结文档、Skill 版本和摘要；API 不提供修改或删除历史版本入口。
- 运行保存不可变版本引用、启动请求摘要、目标连接配置版本和启动身份。
- 商品和规格方案当前保存为受控 JSON 快照，不拆成完整商品主数据系统。历史方案保留在审批快照，生成草稿保留在 ListingRevision。
- NodeAttempt 保存每次尝试；节点当前状态由运行游标和尝试记录形成只读视图，不另建重复的可写 NodeRun 状态表。
- 模型历史对象禁止普通实例 save/delete 更新；这是应用层保护，不宣称能够阻止数据库管理员直接修改表。

## 运行与审批状态

运行状态包括 queued、running、waiting_approval、waiting_event、succeeded、needs_attention 和 cancelled。

审批节点创建 ApprovalRequest 后进入 waiting_approval，没有自动放行计时器。请求保存阶段、运行 revision、输入快照、授权摘要和 24 小时有效期。批准摘要包含商品或草稿、流程摘要、Skill 产物哈希、目标店铺及连接配置版本。

批准当前版本后，后端记录不可变决定并推进；拒绝后进入 needs_attention。相同审批人、决定与原因的重复提交返回既有结果，不重复推进；不同决定或原因冲突返回 409。

包括审批节点在内，每次向下一步推进都会记录当前冻结文档中的 edge ID。前端按服务端事件回放传递动画，显示中的短暂动画不改变数据库运行状态或审批结果。

运行修订仅允许在商品或最终草稿待审批／拒绝时，需原因与当前 revision，最多三轮返工。有发布操作后禁止返工。商品方案修改使两轮批准都失效；最终文案修订保留仍有效的商品方案确认，但重新进行渠道检查和最终批准。

运行取消只停止后续执行，不撤销已经发布的商品。节点正在执行时拒绝取消，避免把在途外部动作假装撤销。普通失败可以恢复并核对结果；审批拒绝必须修订，不能用恢复接口跳过。

## 持久化任务与恢复

Outbox 与业务状态同事务提交。任务处理先取得 90 秒租约，数据库记录执行尝试，再离开事务调用远程接口，完成时核对租约令牌、游标和返工代数。

Celery Beat 定期分发到 Redis 队列，Worker 执行同一 process_job。消息可能重复到达，已完成或被其他任务持有有效租约的任务不重复处理。过期租约可恢复，旧未结束尝试标记 interrupted。

本地提供 runworker 单进程直接处理数据库任务，不依赖 Redis。该模式不是自动回退：启动命令和健康接口会明确显示 SQLite。PostgreSQL 为生产配置要求，本地 SQLite 仅做功能验收，不作为生产并发证明。

外部超时或服务异常进入 waiting_event，十秒后核对，最多五次任务尝试后转 needs_attention。Celery 设置 45 秒软超时、60 秒硬超时，租约过期后可以恢复。

## 发布幂等与测试站边界

发布动作使用店铺和批准摘要生成稳定操作键。同一操作键不能更换内容；启动运行的幂等键绑定流程版本、店铺配置版本和商品输入。

发送发布请求前，ExternalOperation 先持久化为 unknown。响应丢失或 Worker 重启后查询原键；若确实查不到，仅对已经验收支持原键幂等的测试站使用相同键提交。不会改键重发。

测试站发布 API 以独立 client 身份限定资源，事务保证同键同内容返回同一商品。当前为创建新商品动作：同商品标识用不同键再次发布会返回 409，不隐式覆盖。更新既有商品需要后续独立动作契约。

测试站 API 与工作流运行器虽然同仓部署，但运行器通过 HTTP 调用发布与查询，不直接写 PublishedProduct 表。商品公开目录不公开 CJ 映射和执行凭证；购物车、付款与订单流程仍为前端模拟，不投递真实运行事件。

## API 清单

所有运营 API 默认要求认证。只读健康、Session 初始化与店铺公开目录例外。

| 路径 | 方法与用途 |
| --- | --- |
| /api/v1/health | GET，数据库连接与执行阶段 |
| /api/v1/auth/session | GET，Session 与 CSRF 初始化 |
| /api/v1/auth/login 与 logout | POST，登录与退出 |
| /api/v1/members | GET 与 POST，成员列表与内部创建 |
| /api/v1/members/{id} | PATCH，角色与启停 |
| /api/v1/node-definitions | GET，服务端受信节点 |
| /api/v1/skills | GET 与 POST，清单与已安装实现版本登记 |
| /api/v1/skills/{id}/review | POST，批准或停用版本 |
| /api/v1/stores | GET 与 POST，测试站目录与创建 |
| /api/v1/stores/{id}/verify | POST，接口身份与能力验收 |
| /api/v1/templates | GET，第一阶段受信模板与明确标识的测试输入 |
| /api/v1/workflows | GET 与 POST，草稿目录与创建 |
| /api/v1/workflows/{id} | GET 与 PATCH，读取与并发更新 |
| /api/v1/workflows/{id}/validate | POST，重新检查指定 revision |
| /api/v1/workflows/{id}/versions | POST，冻结指定 revision |
| /api/v1/runs | GET 与 POST，运行目录与幂等启动 |
| /api/v1/runs/{id} | GET，状态、审批和尝试历史 |
| /api/v1/runs/{id}/events | GET，after_sequence 增量事件，单次最多 200 项 |
| /api/v1/runs/{id}/revise | POST，受控返工 |
| /api/v1/runs/{id}/resume 与 cancel | POST，恢复或停止后续执行 |
| /api/v1/approvals/{id}/decisions | POST，当前版本审批 |
| /api/v1/listings/{run_id} | GET，草稿历史、操作回执与可售证据 |
| /api/v1/audit | GET，管理员审计查询，当前最多 100 项 |

测试站接口包为 `/api/test-store/v1`：GET capabilities、POST validate、POST products、GET operations/{key}、GET products/{external_id}。这些接口要求 Bearer，不允许匿名写入。

公开商品目录为 GET catalog/{storefront_id}。无 storefront_id 的 catalog 仅本地模式可用；部署后前端必须明确指定目标测试站，不能猜测其他团队店铺。

状态码包括 400 字段或结构错误、401 店铺接口身份错误、403 运营身份／权限／CSRF 错误、404 不存在或其他团队资源、409 并发或幂等冲突、422 业务规则拒绝、429 限流。运营接口异常统一返回 code 和 detail。未预期执行异常不把凭证或远程响应泄漏给前端。

## 实施与验收范围

### 增补：CJ 供应源凭证接入

商品任务编辑器使用 `ProductQuery@2` 的可选 categoryQueries 扩展，每项为 {categoryId, keyword}，最多 10 个唯一类目；省略时继续使用旧 categoryId + keyword，空数组为不限类目。多选时旧 categoryId 和全局 keyword 必须为空，limit 必须不小于类目数；市场、币种与总数量不变。旧手填类目不自动映射新 ID。`GET /api/v1/connections/cj/categories` 按团队和连接版本缓存 CJ 类目目录一小时，`?refresh=1` 显式刷新。`POST /api/v1/connections/cj/search-preview` 使用 Pydantic 校验输入，并核对所有类目 ID 后才搜索。总候选额度均分、余数按选择顺序分配；只读预览使用 min(limit,20) 的独立样本预算同样均分，每类只查第一页，按商品 ID 合并去重。没有用完的额度不转给其他类目；不是完整采集或实际销量。返回 groups，逐类报告 quota、previewQuota、attempts、products 与 results/no_results/error；部分失败返回 partial，全失败返回 error，权限或连接版本变化仍中止整次查询。40 秒后不再启动新类目查询，剩余类目标记失败；单次已启动的请求仍受 CJ 请求超时控制。仅显式 drop_keyword_once 对有关键词的零结果类目重试一次，保持类目不变。market、requestedCurrency 不直接传给 CJ 搜索；销售国家不等于仓库国家，供货价不按任务币种改写。完整采集工作流尚未执行此多类目任务，后续运行器必须遵循同样契约。

`GET /api/v1/connections/cj` 返回本团队连接状态；管理员使用 `PUT` 提交 `api_key` 与 `expected_version` 加密保存，`POST /api/v1/connections/cj/verify` 执行只读认证和最多三条商品采样。独立 SupplierConnection 不属于销售渠道 Store，不授予发布、采购或付款能力。浏览器只在提交期间持有输入，不持久化或回显凭证。

验证使用 [CJ 官方认证接口](https://developers.cjdropshipping.com/en/api/api2/api/auth.html) 和 [Product List V2](https://developers.cjdropshipping.com/en/api/api2/api/product.html)。只有认证和商品列表结构检查均通过才记为 verified；失败不回传上游原始错误。状态包括 saved、verifying、verified、error。60 秒验证租约防止并发重复调用，验证结束后保留短暂冷却；密钥版本与租约不匹配的旧结果不得覆盖新连接。有效访问令牌缓存并加密，到期使用保存的密钥重新获取，不保存本阶段不用的刷新令牌。

样本展示供货报价、商品 ID、SKU、上架次数及返回的库存字段；缺失值保持未知，上架次数不解释为销量。尚未提供完整采集任务、自动选品或配送核验。六项 CJ 专项测试使用受控响应，真实账号验证需要用户在页面填写完整密钥。

测试包含两轮审批闭环、旧批准和过期批准拒绝、固定图约束、未审核与停用 Skill 拒绝、重复启动与任务、价格不能通过内容返工修改、团队隔离、CSRF、超时后核对、租约恢复、连接版本变化、测试站同键幂等与禁止隐式覆盖。

浏览器验收脚本验证登录、接口验收、两轮审批、HTTP 发布、商品详情可见、刷新持久化和响应式布局。它会创建一个测试商品，不会采购、付款或发送邮件。

2026-10-02 本地验收：Django 22 项测试、前端工作流 62 项测试、测试站 3 项测试通过；Next.js 生产构建通过；Chrome 对生产构建的上述完整发布流程通过。另已停止 Worker 创建持久化任务，再重启 API 与 Worker，验证任务恢复、两轮审批与实际发布成功。Compose 配置语法检查通过，但本机 Docker daemon 不可用，未验证容器内 PostgreSQL／Redis／Celery 的部署及并发行为。依赖的已验收版本固定在 backend/requirements.lock。

当前未实现 CJ 采集、运费实时核验、真实模型／图片服务、生产脚本沙箱、订单履约、广告和售后。Docker 配置提供 PostgreSQL、Redis 与 Celery；实际部署仍需部署环境验收、HTTPS、备份、监控和凭证管理。本地通过不代表可直接用于生产资金动作。
# 人工审核开关补充

私人本机测试站支持在 product.authorize / listing.authorize 的 binding.parameters 中设置 approvalEnabled（严格布尔值，缺省 true）。两轮独立配置，只有新建冻结版本及运行使用新配置，不修改在途任务。关闭后校验继续执行，记录绑定商品/内容、版本、Skill 与店铺版本摘要的免人工审核证据，以及 approval.skipped 审计；不伪造人工批准。后续使用该证据前重新核对摘要、当前运行环境与工作区所有者权限。普通团队部署拒绝关闭。该能力不适用于采购付款、广告预算或其他尚未实现的真实运行。

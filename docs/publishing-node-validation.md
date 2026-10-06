# 映射与发布节点检查（2026-10-03）

## 节点职责与已修正设置

同一画布保留：最终草稿审核 → 接口字段映射 → 提交渠道发布 → 等待真实可售结果。

- 映射：模型连接、接口资料、系统映射规则 Skill；锁定当前渠道的上架动作，不编辑商品或固定契约。已分析记录可关联到节点并随草稿导出，换渠道清空；编辑和模拟模式都打开同一原生 dialog。
- 映射引用保存会话 UUID 与修订号，不是可执行映射，不是验收证据。模型密钥和完整对话仍在后端，流程导出不包含它们。历史目前按渠道与动作匹配，不是按店铺凭证版本验收；不同店铺不能据此认定接口已经可用。
- 发布：运营设置直接展示执行 Skill 选择；连接继承店铺接入。默认示例移除重复市场/超时/资源参数，继承商品任务的市场和币种。接口开发指南折叠，接口模式只读继承统一接入配置。
- 映射不改 ApprovedListing；新增预检拒绝把此透传步骤插在 PublicationReceipt 等其他上下文之后。
- 映射草案与已注册适配代码分开。旧草稿不自动改写，原有未知参数需要运营显式重新选择实现。审批、审核注册与幂等规则未放宽。

## 验证层次与结论

1. 前端图和模拟接口：`npm run test:workflow`，71 项通过。测试夹具只在 scripts 中，在内存模拟独立站和 Amazon 请求/响应，不注册到运行后端。
2. Django：`COMMERCE_ENV=local ../server/.venv/bin/python manage.py test tests`，67 项通过。包括四种模型协议、模型结果结构/固定路径校验、映射不发布、CJ 模拟数据到两轮审批与实际 DRF 测试站接口。
3. 浏览器：`node scripts/test-publishing-nodes-browser.cjs`，独立站和 Amazon 的 15 步 UI 演示均完成；检查记录关联保存、重开、跨渠道历史过滤、模拟入口一致、1100/760/390px 不溢出。审批与可售等待不会定时放行。模型、注册表和映射 API 在隔离浏览器中拦截，无真实数据库写入或模型费用。
4. `npm run build` 通过；未向任何真实渠道发布商品。

模拟接口案例覆盖：

| 案例 | 结果 |
| --- | --- |
| 独立站售价 USD 主单位 → 美分字段 | 23.00 → 2300；原审核对象不变 |
| Amazon 提交 ACCEPTED，但查询无 BUYABLE | 保持等待，不产出可售商品 |
| 明确的可售查询证据 | 才产出模拟 PublishedProduct@1 |
| 缺 sellerId / marketplaceId / productType | 拒绝生成模拟 Amazon 请求 |
| 发布被拒绝 | 不继续交付可售结果 |
| 原幂等键 + 相同输入 | 复用原记录，不重复写入 |
| 原幂等键 + 不同输入 | 拒绝冲突 |
| 写入后超时 | 查询原回执，不盲目重复创建 |
| Amazon 原始回执套用测试站 Pydantic 输出 | 拒绝，不伪造 UUID 或 active |

## 尚不能称为跑通的部分

Amazon 实际发布尚未接通。当前真实后端 test-store.v1 输出要求 UUID、active 与店铺摘要，不适用于 Amazon 的 SKU、submissionId 与 ACCEPTED。画布 v2 草案虽然能表达 accepted/processing，但不是已实现的服务端渠道运行契约。不能修改前端标签或填充虚构 ID 来绕过该差异。

本轮验证的模型回复是预设模拟数据，并非真实 LLM 对外部文档做出的答案。必须配置真实模型并对真实接口样例进行语义验收，随后开发、审核注册适配代码，才能实际调用 Amazon。还需真实商品类型 Schema、账号/市场权限、商品标识或豁免、品牌和类目要求、规格关系、履约模式等证据；模拟单 SKU 请求未证明这些事实。

独立站真实执行仍是现有七步测试站主线，15 步设计图不等于任意 DAG 已实现。映射记录当前不被该七步后端消费，不应称为“模型映射完成后自动执行适配包”。

业务依据：Amazon 官方 [Listings Items API](https://developer-docs.amazon.com/sp-api/lang-en_EN/docs/listings-items-api) 与 [Manage Product Listings](https://developer-docs.amazon.com/sp-api/lang-en_EN/docs/manage-product-listings-guide)。提交接受与可售查询是不同状态，商品类型要求不能只靠通用标题、售价和库存推断。

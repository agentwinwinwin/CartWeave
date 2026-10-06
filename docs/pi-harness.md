# Pi 模型运行层

## 为什么接，而不是改整个业务引擎

真实模型调用统一进入 `apps.agents.harness.complete`。它运行 Pi 官方开源
`@earendil-works/pi-agent-core` / `@earendil-works/pi-ai` **1.0.4**，复用 Agent 的
会话转换、运行生命周期和事件；不是重新写一个同名假 harness。
上游原地址 `badlogic/pi-mono` 当前重定向到 [earendil-works/pi](https://github.com/earendil-works/pi)。
使用 MIT 发布包，精确版本及完整性校验保存在 package-lock.json。

这是受控嵌入核心，不是把 Pi coding-agent CLI 整套塞进电商后端。
不开放 bash、任意文件读写、上传脚本、OAuth 或自动安装扩展。
没有声称实现完整 CLI 的压缩、订阅登录或任意工具循环。

```text
前端明确发送 / 后端明确请求模型
  → Django：权限、Skill 摘要、会话 revision 与租约
  → Pi Agent：上下文与模型请求生命周期
  → 私有 IPC → Django provider transport：四种协议、解密密钥
  → Pi 完成事件 → Django Pydantic / 字段语义校验
  → 保存建议或映射草案
```

Pi 不监听端口。每轮启动一个受控子进程，收到输入后只允许一次模型请求；
父进程核对其上下文与已授权输入完全一致，不接任意工具请求。
密钥不进入子进程参数、环境、IPC 或消息历史。
网络仍由原 Django transport 执行，保留公网 HTTPS / 本机回环检查、禁止重定向、
不使用环境代理、55 秒请求超时、2 MB 响应限制及密钥回显脱敏。
模型执行失败不回退到旧直连、模拟回复或另一个模型；不自动重试付费调用。
IPC 等待预算 70 秒，HTTP 同步读取保留独立超时及逐块时间检查（不是操作系统强制的整请求硬截止），现有 API 90 秒代理预算。事件是实际 Pi 生命周期，
当前 HTTP 接口在整轮完成后返回，**不是逐 token SSE**。

## Skill 四种含义不要混淆

| 类型 | 用途 | 是否进入 Pi |
| --- | --- | --- |
| 接口开发规则 Skill | 给编程 AI 增量生成独立站 API | 不在日常业务中执行 |
| 确定性算法 Skill | 订单/刊登/成本评分、原素材整理 | 否，原受信 Python 处理器 |
| 店铺接口适配包 | 检查、发布、下架、订单/客户/账目读取 | 否，原固定代码及契约 |
| 运行时模型 Skill | 对话、客服回复、商品图方案 | 是，服务端闭合策略表 |

`backend/apps/agents/rules` 的三个 SKILL.md 是代码维护的运行策略，
不扫描用户任意目录，不执行其中的脚本，不冒充已登记的 SkillVersion。
会话固定规则摘要；文件变更会拒绝继续旧会话，需新建对话，不隐式替换。
后续自定义策略版本应独立审核与绑定，不能放宽原工作流注册表。

## 已接入与未接入

- **接口分析**：原映射入口经 Pi；固定契约、字段路径、依据、缺口、revision 和租约仍由 Django 检查。草案不自动成为适配代码。
- **运营助手**：真实模型调用、后端历史、显式选模型；不自动读取经营记录或写业务。
- **智能客服**：`SupportReply@1` 回复草稿、事实依据、问题、转人工标记。需要用户提供必要资料，尚无查单/发送/退款工具；不宣称已发给客户。
- **商品图方案**：`ProductImagePlan@1` 提示词、保留特征、禁改项、问题。尚无图像服务调用与图片文件交付。
- **商品图完整流程**仍是之前的设计图，未因接入 harness 就自动可运行或自动冻结。后续图像服务只能通过受信、单独鉴权、按任务授权的工具接入 Pi，不允许前端任意传 URL 或绕过商品事实检查。

已有选品到上线图、冻结版本、算法 hash、审批、店铺连接、接口包、幂等键及发布 worker 没有改写。
没有调用模型的节点不经过 Pi。普通测试站发布仍复用已验收适配代码。

## API 与运行

- `GET /api/v1/agent-skills`：模型策略目录（不含提示词与密钥）。
- `GET/POST /api/v1/agent-sessions`：读取/新建会话，新建不调用模型。
- `GET/POST /api/v1/agent-sessions/{id}`：读取/明确发送一轮；发送要求 connection_id、expected_revision、message。
- 使用现有 model-connections 配置，四种协议继续支持。没有自动模型回退。
- 每会话最多 20 轮；客服资料仅在当前团队保存，不广播给其他租户。

需要 **Node.js >=22.19**；`npm ci` 安装固定开源依赖。
`npm run desktop` 将所用 Node 路径交给 Django；单独启动 Django 时需设置
`COMMERCE_HARNESS_NODE` 为兼容 Node 的可执行路径。容器/生产部署也需要安装
Node 与根 npm 依赖，只有 Python 镜像不够。Dockerfile 已增加 Node 24 与运行依赖阶段、接入规则文件及 85 秒 API 超时；尚未构建或验收容器与生产并发，不把静态配置当成部署成功。
新增迁移只创建 AgentSession，不修改现有工作流或 Skill 表。

## 验证范围

Node 测试运行真实 Pi 核心，Python 测试运行真实子进程并模拟远端模型响应，
检查事件、凭证脱敏、Pydantic、无工具权限、无直连回退与租户隔离。
旧发布与选品回归继续运行。模拟 provider 不等于实际付费模型或真人客服验收。

依赖检查：本次改用维护中的 Pi 1.0.4 后，Pi 的新增依赖链没有 audit 告警；当前整体仍有 4 项告警落在既有前端依赖链（Next/PostCSS、sharp、source-map-js）。未执行可能破坏已有前端的强制大版本升级，部署前需单独处理并回归。这不是隐私扫描结果或安全无风险的保证。

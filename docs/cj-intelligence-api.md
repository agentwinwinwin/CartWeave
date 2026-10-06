# CJ 行情：普通 Chrome 扩展连接

当前读取器使用用户正常登录的 Chrome，通过项目自带的 Manifest V3 扩展传回两个固定榜单的可见表格。无需 Codex、模型、Playwright 或远程浏览器控制。旧自动化登录接口已停用；旧 session.enc 不读取、不迁移，也不擅自删除。

扩展1.0.2允许广告仪表板装饰性标题变化：标题未匹配时，仅返回已识别表格前唯一的更新时间和明确的Platform/Region All元数据，不传侧栏全文、不凭URL猜范围。缺范围、日期或元数据歧义仍停止；服务端继续校验完整两榜。

扩展 1.0.1 支持已确认的中文销售表头（排名/类目、销售额/销量、排名增长率、操作）与英文表头；已知广告表头使用明确别名，不模糊识别任意列。日期、Amazon来源、All Sites及广告All范围仍必须从页面读到。DOM提取按明确表头选表，元数据只读取仪表板标题到表格之前，不读取账号侧栏；仅行内换行差异兼容，不补充未知排名或类目ID。销售/广告失败原因分别标明，遇到未知标题、结构或语言不猜测。

从ZIP安装的扩展不会随项目源文件自动更新。下载新版后覆盖最初加载的扩展文件夹内文件，再在 chrome://extensions 点该扩展的重新加载；保留原目录/扩展ID以复用配对。如改目录导致扩展ID变化须重新配对。工作台刷新不替代扩展重新加载。

## 安装与配对

1. 启动 `npm run desktop`，在 /connections/cj 或行情首节点下载扩展 ZIP。
2. 解压，在普通 Chrome 的 chrome://extensions 开启开发者模式，加载解压的文件夹。源码为 browser-extension/cj-reader。
3. 工作台生成一次性配对码，5 分钟内粘贴到扩展弹窗。码仅一次有效，不存入流程或 localStorage。
4. 通过扩展链接打开 CJ，使用正常 Chrome 登录并自行处理安全验证。
5. 回到工作台采集两组前十，或运行已经配置并冻结的行情首节点。

扩展约每 30 秒领取一次本机任务，打开弹窗可立即检查。该轮询只访问本机；没有任务不访问 CJ。Chrome、项目均须运行，电脑休眠或 Chrome 关闭不保证定时采集；旧快照不可冒充新结果。

扩展仅申请 storage、scripting、alarms，站点权限限 CJ 与 127.0.0.1:8010。不申请 cookies、history、debugger 或全站权限。项目不读取密码、Cookie、浏览历史或复制 Chrome 配置。扩展凭证只允许两榜任务，30 天到期，工作台可以撤销；凭证不可访问普通业务 API，不使用服务器桌面凭证。

采集可以复用已打开的精确、无筛选榜单页面；没有该页则在同一正常 Chrome 开临时后台页，读完关闭。不会跳转用户已有标签页、改筛选、点击安全质询或执行平台业务动作。两榜读取顺序固定；网页加载仍包含正常资源请求，不是总共两次 HTTP 请求。普通 Chrome 能登录不保证采集不会被 CJ 限制，请确认 CJ 允许此用途。验证/失效/结构变化即停止，无自动重试或每小时冷却。

## HTTP 边界

工作台 API 沿用团队身份及本机同源代理，浏览器不持有内部桌面凭证：

| 方法 | 路径前缀 /api/v1 | 作用 |
| --- | --- | --- |
| GET | /connections/cj/intelligence | 配对状态、最近心跳与历史快照，不访问 CJ |
| POST | /connections/cj/intelligence/chrome-pairing | 管理员生成一次性码，仅返回当前请求 |
| DELETE | /connections/cj/intelligence/chrome-pairing | 管理员撤销扩展和未用配对码 |
| POST | /connections/cj/intelligence/collect | operator/admin 请求本轮两榜，最多等待70秒 |
| POST | /connections/cj/intelligence/login | 已停用，明确422，不再弹自动化浏览器 |
| POST | /connections/cj/intelligence/plans | 创建已确认的供货类目方案 |
| GET | /connections/cj/intelligence/plans/UUID | 查询当前团队不可变方案 |

扩展独立窄通道为 POST /api/v1/cj-browser/pair、poll、complete。只接受 loopback 来源、固定8010 Host、chrome-extension:// 的32位扩展 Origin；配对后凭证绑定该 Origin。pair 需要一次性码，其他动作需要专用 Bearer。没有放开全项目匿名访问；不得把这些扩展权限套到普通业务端点。CORS 只返回合法扩展 Origin，无通配符或浏览器 Cookie 鉴权。

poll 只返回随机任务ID与两个固定URL，不接受任意URL/脚本；同一任务仅领取一次。complete 仅接受当前连接领取且未过期的任务，拒绝迟到、重复、跨连接结果和额外字段。Pydantic 检查输入后复用既有排行、来源、表头、范围、日期及唯一类目校验。两个榜都通过才提交 snapshot.json；失败保留旧快照作为历史但不会返回其充当本轮成功。

仅 LOCAL + DESKTOP_MODE，目录 .local/cj-intelligence/团队UUID 的0700/0600私有文件；pair-code.enc、extension.enc 加密，存摘要而非扩展原凭证；extension-job.json 保存窄表格任务。API与单worker共用文件锁阻止重复采集，扩展领取不复用长运行锁，避免死锁。尚未验收远程部署、多worker或分布式浏览器。

## 工作流

保持同一画布 market.intelligence → 原十一节点，默认关闭。旧文档只允许显式添加、保存冻结，历史运行不改。启用后每轮真实采集两榜，确认的方向继承到商品任务；关闭保留原搜索词。

当前供货方向仍使用不可变 cj.category-plan@1：source=sales|advertising，mappings=[{source_category_id,category_id}]，1–10个已确认的真实供货叶类目，重复目标合并。两榜体系不同，榜单ID不能直接用作CJ目录ID。本次接入方式变更不擅自改变已确认的选择和算法。方向离榜、名称变化、类目失效或连接版本变化停在首节点，不回退或扩大范围；后续订单/库存/配送/价格/审批检查不变。

新任务 `finalSelectionMode=global` 时，各方向仍按冻结搜索额度采集，合格商品合并后统一评分选前N款，不再给每类分配最终名额；一类没有合格商品，不阻挡其他类目填满总目标。完整范围核验前不提前选取，去重、事实门槛和证据时效不变。缺此字段的旧冻结任务保持按类目分配；编辑稿显式更新后保存冻结，不改旧运行。

GET中的 session_saved 为旧客户端兼容字段，仅表示扩展已配对，不表示CJ网页登录态保存或验证成功；新UI读取 extension.paired/online。

输出 cj.intelligence.top10@1 包含 captured_at、sales、advertising、collector=chrome_extension，每榜保留 source_url、updated_on、scope、data_source、period=null、precision=rounded_web_display 与10行。销售来源为网页标明的 Amazon 市场 All Sites，广告为 TikTok/Facebook All 地区；K/M 保留原显示，不把广告数或该市场销量当 CJ 单品订单或供货销量。

## 验证

在 backend 执行：

```sh
COMMERCE_ENV=local ../server/.venv/bin/python manage.py test tests.test_cj_browser_bridge tests.test_cj_intelligence tests.test_intelligence_workflow
```

测试使用临时数据库与模拟表格，覆盖配对单次/Origin/远端拒绝/撤销/权限隔离/完整两榜传递/失败校验/迟到/离线/原流程/完整批次。前端需通过 npm run build。真实 Chrome 扩展加载、用户登录及实际CJ表格采集仍需用户安装后联调，不声称已通过 Cloudflare 或真人端到端验收。

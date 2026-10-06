# CartWeave 工作流后端

Django + DRF 模块化单体，Pydantic 定义运行与店铺 HTTP 契约。当前可执行主线为 CJ 选品到本地测试站发布与可售确认；不支持任意 DAG，也未接入 Amazon/Shopify 真实执行器。

## 初始化与启动

完整步骤见根目录 README。建议 Node.js 22 和 Python 3.12；安装 requirements.lock，生成新的本机配置、迁移数据库并运行 bootstrap_local。不要复制其他工作区的数据库或密钥。

在 backend 目录注册默认 CJ v5 策略：

```bash
COMMERCE_ENV=local COMMERCE_DESKTOP=1 ../server/.venv/bin/python manage.py register_opportunity_skill --cj-listings
```

根目录执行 npm run build 与 npm run desktop，同时启动 Next.js 3000、Django 8010 和单 worker，仅监听回环地址。私人本机模式无需运营用户登录；内部身份仍用于审计与归属，不是生产免认证方案。

开发时可以分别启动 Django 与 worker：

```bash
COMMERCE_ENV=local COMMERCE_DESKTOP=1 ../server/.venv/bin/python manage.py runserver 127.0.0.1:8010 --noreload
COMMERCE_ENV=local COMMERCE_DESKTOP=1 ../server/.venv/bin/python manage.py runworker
```

前端使用同源 /backend 代理。凭证由服务端加密保存，不能放入 NEXT_PUBLIC、日志、流程参数或浏览器持久化。

## 核心职责

- workflows：保存草稿、expected_revision 检查、不可变 DesignRelease 与独立 ReleaseRetirement。
- runtime：Outbox、节点尝试、租约、批次研究、断点、停止和完整流程调度。
- connections / skills：供应源、店铺与模型连接分离，执行时重查审核版本与代码摘要。
- approvals / listings / audit：批准绑定内容摘要，外部操作幂等与未知结果核对。
- commerce / finance：订单、客户投影与增量游标，财务事实与确定性核算，不补编费用。
- teststore：独立鉴权接口，商品发布、查询与下架落数据库，结账仍模拟。

## 店铺接口包

当前受信包 test-store.v1 1.4.0 包含 listing.validate、listing.publish、listing.wait、publication.lookup、listing.unpublish、listing.status、orders.read、customers.read、finance.read。

接口包版本与节点描述版本独立，1.4 包复用 1.3 发布描述。历史冻结按明确兼容规则执行，新冻结要求已安装版本，不静默改旧快照。

GET /api/v1/integration-packages 提供已安装包与实际 HTTP Schema；店铺鉴权入口为 /api/test-store/v1/contracts 和 /api/test-store/v1/actions/{action}。只读业务分页每页最多 50 条，失败不推进游标，重复同步不重复入账。共用连接不等于所有动作均获授权。

## AI 与固定执行分层

映射支持 OpenAI Chat 兼容、Responses、Anthropic Messages、Gemini。连接和会话在服务端保存，密钥不回显；契约来自受信注册表，模型结果是待验收草案，不自动安装代码、修改商品或调用发布接口。

默认内容处理器仅整理原素材与文案，无 LLM 生图执行器。v5 是确定性评分，不承诺盈利；订单数不声称为目标国家近 90 天销量。算法边界见 ../docs/cj-listing-opportunity.md。

## 测试与部署边界

```bash
COMMERCE_ENV=local COMMERCE_DESKTOP=1 ../server/.venv/bin/python manage.py check
COMMERCE_ENV=local ../server/.venv/bin/python manage.py test tests
```

回归使用模拟 CJ、合成样例及临时数据库，不代表真实渠道全部通过。浏览器回归需额外 Playwright，部分脚本写本机测试站，运行前阅读说明。

SQLite + 单 worker 是当前本机方式。compose.yaml 提供 PostgreSQL、Redis、Gunicorn、Celery 和 Beat 配置，尚未做生产并发验收；MySQL 与设备自适应 worker 为后续事项。生产不能用 bootstrap_local 或桌面免登录模式。

取消仅停止后续动作，不撤销已发布商品；外部结果未知时核对原操作键，不盲目重发。数据库和加密配置应一起安全备份，丢失密钥会使连接无法解密。

进一步阅读：根目录 README，以及 docs 下的 backend-architecture、cj-launch-runtime、store-business-sync、workflow-scheduling。历史规格反映当时阶段；当前闭合注册表与回归决定实际执行范围。

# 本地测试站业务读取 · 接口包 1.4.0

在现有 `test-store.v1` 中追加三个已实现的只读动作，原六个发布/下架动作不改字段。后端 `GET /api/v1/integration-packages` 和鉴权的测试站 `/contracts` 导出同一份九动作契约；前端“下载实际接口契约”使用该响应，不维护另一份静态Schema。新映射会话自动快照1.4.0全部动作，旧会话保留原Schema。

| 动作 | 来源事实 | 本地去向 |
| --- | --- | --- |
| orders.read | 来源订单ID、版本、金额币种、支付状态、履约状态、下单/观测时间、来源依据 | commerce.BusinessRecord → /orders |
| customers.read | 来源客户ID、版本、姓名/邮箱/国家（可未知）、删除状态、观测时间、来源依据 | commerce.BusinessRecord → /customers |
| finance.read | FinancialFact实际收款、税款、退款、成本、来源事件及连续版本 | finance.OrderFinancialFact → /earnings |

POST `/api/test-store/v1/actions/<action>` 需要已绑定storefront Bearer。请求cursor默认0、limit最多50；响应items、next_cursor、has_more。来源为私有追加的teststore.BusinessEvent，按sequence读取，不开放前端写入事件接口，不读取前端demo结账。来源业务服务需在实际订单/客户/账目发生时输出这些事实；目前测试站没有真实支付/订单/成本服务，因此用户数据库同步可能是空页，不能宣称已接入支付。

工作台GET `/api/v1/business/orders|customers` 是团队隔离的持久化列表，支持店铺、搜索、分页。POST `/api/v1/stores/{id}/sync/orders|customers|finance` 仅允许approver/admin，空请求；只调用已安装适配器及已验收能力，不接受任意URL、脚本或用户传入业务资料。每次一页，has_more时“同步下一页”；刷新只读本地投影。同步游标与店铺版本绑定，30秒租约防重复，网络请求不持有数据库事务，单页校验与写入原子提交；失败不推进游标。版本变更目前明确阻塞，需核对来源后处理，不自动重置。

原店铺不会自动获得新增能力，页面提供重新验收入口。来源重复版本不重复投影，同版本不同资料冲突；客户/订单较旧版本不覆盖新版本。财务来源事件幂等、版本连续，仍保留税款/退款约束；资料页异常整页回滚，不能部分入账后丢游标。

利润仍由既有finance服务计算，不接受模型猜测、建议售价或模拟付款。未知成本为null，明确零才为0；广告缺失可展示广告前利润，任何其他成本缺失不展示完整利润；币种不混合。客户订单数/累计消费不从局部同步记录伪造完整历史。

当前是手动分页同步，不是自动调度、实时Webhook、通用上传脚本执行器或其他渠道已接入。不调用CJ采购/支付、发货、邮件、广告、退款。不擅自创建测试订单或污染真实账目；回归用临时数据库中的明确测试事实验证接口→同步→模块投影。

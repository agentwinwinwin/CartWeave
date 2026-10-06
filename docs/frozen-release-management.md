# 冻结版本管理

入口 `/workflow/releases`，工作流编辑器和定时器均提供链接。管理单位为完整流程的冻结快照，不是节点；列表分页展示流程、店铺、版本、冻结时间及运行/定时引用，可查看只读节点参数。

删除为可恢复删除：独立 `ReleaseRetirement` 保存可见性，不修改不可变 `DesignRelease` 或执行版本。删除后不能启动新运行、创建定时器或再次冻结得到同一个隐藏版本；用户可以恢复，或编辑保存新修订后冻结。历史运行、审批、商品及外部操作凭据不删除。原幂等重放继续返回旧结果。

未结束运行（包括待审核、待回执、异常待处理）或启用定时器时拒绝删除。已暂停定时器保留引用，但不能启用已删除版本。恢复只恢复版本可见性，不自动启动任务或启用计划；业务、连接及Skill检查仍独立执行。

接口：

- `GET /api/v1/workflow-releases?view=active|deleted&page=1`：团队隔离，每页50个。
- `GET /api/v1/workflow-releases/{id}`：只读原快照，包括删除状态。
- `DELETE /api/v1/workflow-releases/{id}/lifecycle`：operator/admin可恢复删除，冲突返回409。
- `POST /api/v1/workflow-releases/{id}/lifecycle`：operator/admin恢复。

服务端重查引用，不依赖按钮禁用。新运行与删除使用团队锁，定时器写入锁定版本；SQLite本机验收不代表生产并发已验收。数据库迁移仅新增状态表，没有清理任何用户数据。

回归：`manage.py test tests.test_release_management tests.test_saved_design tests.test_schedules`。用临时数据库，不删除用户工作区中的版本。

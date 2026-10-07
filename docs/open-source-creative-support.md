# 复盘、客服归档与开源制作规则

> 当前能力更新：下文保留早期离线归档模式说明。客服标准七步已支持测试站 HTTP 收件、政策与订单、答复回执和冻结持续监听；商品图标准六步已支持批次执行与素材交付。以 [业务执行](business-workflow-runtime.md)、[图片运行](product-image-runtime.md) 和 [调度说明](workflow-scheduling.md) 为准，离线模拟仍不冒充真实运行或邮件。

## 页面与数据

主导航移除独立对话 AI，新增 `/reviews` 和 `/support`。旧 `/assistant` 跳转客服，
不删除历史 AgentSession，也不删除映射/商品图内部使用的 Pi infrastructure。

`OperationReport` 保存工作区隔离的执行结果与时间、请求幂等键、输入摘要。
`operation-reports/reviews` 生成最近七天真实已同步的财务只读快照、缺失成本和人工调整建议。
没有事实时利润是 null，不把报价当成本；当前不是完整 optimize WorkflowRun，不自动应用调整。
经营复盘画布 `insight.propose` 复用归档窗口，原节点 ID、参数、连线及冻结版本不变。

`operation-reports/support` 保存模拟收信、检索、回复与检查记录；人工确认后
`operation-report/{id}` 记录模拟发送、模拟送达及归档。渠道动作全部标明 simulated，
不访问真实客户、订单、支付或消息接口，不冒充完整 WorkflowRun 或渠道回执。
退款、取消、订单事实不足或无相关政策停在转人工。历史客服草稿只读展示，未重写。
mode=fixture 是确定性提取测试，没有调用大模型；mode=pi 经官方 Pi 核心与私有 transport，
GroundedSupportReply@1 校验及引用白名单检查。语义正确性仍须人工确认；结构校验不是事实证明。

## GitHub 来源与许可

- 摄影模板：<https://github.com/JeremyGDM/awesome-ai-product-photography-prompts>
  CC0-1.0，提交 `6815dab9c17ce20c5c554df4ecf28336fd0aef0a`。
  使用其白背景、特写、场景摄影构图思路，改写为受控 `product_image_photography` v3。
  不下载示例商品图片，不执行第三方脚本。仍输出 ProductImagePlan@2，沿用原检查与人工确认。
  新窗口可选择 v3 或原 v2；缺 planner_skill 的旧批次按 v2，不自动升级摘要。
- 客服知识：<https://github.com/LaelaZorana/ecom-support-copilot>
  MIT，提交 `058c8bc3101655ecd90d65d12f9b1534667f1917`，复制 `data/policies.md` 六段政策，
  仅改前言标明测试；版权与许可证保留在 `backend/apps/agents/knowledge/LICENSE`。
  **这是 Northwind Outdoors 测试政策，不是当前商户真实政策**，必须明确确认后用于模拟。
  检索为固定六段的中英文关键词检索，最多三段，保存内容摘要与固定来源链接。
  不引入向量数据库/embedding 费用，不复制订单、客户数据或 upstream agent 执行器。

## 测试边界

`tests.test_operations` 验证七步模拟、转人工、引用、幂等与团队隔离；其中 Pi 测试
真的运行官方 Node 子进程，但 provider HTTP 是模拟，不是生产模型验收。
`tests.test_product_images` 验证开源 v3 接入及素材交付，默认图像与 provider 为夹具。
可选实际 PNG smoke 接真实图文件，仍为模拟 HTTP，不表示 Sunburst 已充值或付费验收。
渠道客服七步调度、真实消息发送与经营策略自动调整尚未实现；不能冻结或定时执行它们。

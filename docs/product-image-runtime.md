# 已上架商品图制作 · 初版执行链路

## 使用

在工作流目录打开“商品图生成”，点击画布“运行商品图流程”或任意原六步节点。
单选、多选或全选已确认上架商品；待确认发布、已下架和下架结果待核对记录不参与。
初版一次最多 500 件，每件 1–5 张，默认 1 张；超过 500 件时禁用全选，明确提示分批，而不冒充全量。

选择已登记的对话模型用于方案；新增 Sunburst 连接使用既有模型连接表单，预填
`https://api.openai.com/v1`、`gpt-image-2.5-sunburst`。凭证由后端加密保存。
初版仅支持 OpenAI 官方 Images API，不将“OpenAI Chat 兼容”解释为所有中转都支持图片编辑。

1. 保存批次配置与已上架商品快照，Worker 逐商品经 Pi 1.0.4 执行代码内置制作 Skill v2。
2. Pydantic 校验 `ProductImagePlan@2` 的逐张方案和张数；存在 questions 时停下补资料。
3. 人工确认方案、原图发送目的地和调用数量后，再进入付费生图；方案模型也可能收费。
4. Sunburst 每次用商品第一张原图执行一次 `/images/edits`，不把提示词当成图片。
5. PNG 解码、尺寸与大小检查成功后保存真实图片；外观、文字事实、用途许可仍由人核对。
6. 选择采用的图片，确认后交付 `ApprovedProductImagePack@1`，可下载图片和素材清单。

## 分层与边界

- `apps.agents.image_service`：独立图片批次与持久化阶段，不挂入旧发布运行器，不改 WorkflowRun、冻结或审批。
- `apps.agents.harness`：所有逐张方案对话统一走 Pi，私有 provider transport 仍只属于此边界。
- `apps.agents.image_transport`：明确授权后的生图执行器，凭证不进入 Pi IPC、Node、浏览器存储或导出。
- `ProductImageBatch` / `ProductImageAsset`：商品、模型配置指纹、规则摘要、方案、真实文件与来源；初版 PNG 使用数据库私有 BinaryField，不放入 public，也不代理任意 URL。
- 原图只支持项目测试素材或既有受信 CJ CDN；拒绝重定向，下载有限大小和时限，不能把模型凭证传给 CDN。
- 图片下载要求本工作区授权；素材包记录商品、原发布记录、用途、版本和文件摘要。

旧 `ProductImagePlan@1` 与原会话完全保留，v2 是独立代码内置 Skill，不隐式升级旧方案。
原画布六个节点 ID 不变；运行窗口展示当前固定六阶段批次，不执行任意用户修改 DAG。
任务配置快照与 WorkflowDesign 的展示草稿分开；窗口保存的是实际批次配置。刷新仅 GET 恢复，不重新调用模型。
该批次尚不支持 DesignRelease 冻结/业务定时器，不自动替换线上商品图，也没有把素材包自动写入上架或广告适配器。
后续消费端必须显式引用已确认素材包，不应以素材确认替代商品发布或广告花费授权。

## 稳定性

本机 runworker 和既有 Celery dispatch 都可领取图片任务，持久化租约避免并发重入。
同一请求键仅创建一次批次，同文档已有活跃批次时拒绝新任务。
图片调用不自动重试；超时/5xx/结果异常/过期租约进入结果未知，防止重复费用。
手动停止不撤销费用；在途成功结果保存后停止，不开始下一张。
模型配置或 Skill 摘要改变不能静默替换。方案和图片均不保证商品事实真实，必须人工核对。
大批次按张串行，可能很慢；初版没有虚构剩余时间、报价、额度可用或生产多 worker 验收。

## 验证

`tests.test_product_images` 使用临时测试数据库、合成 PNG 与模拟模型/HTTP，覆盖
单批次幂等、逐张方案、真实文件校验、交付、团队隔离、连接变更、停止及未知结果不重试。
模拟验证不代表真实 OpenAI 账户、计费或商品保真度已验收。实际试图由用户配置连接并明确确认。

可选真实图片烟雾测试：设置 `COMMERCE_IMAGE_SMOKE_FILE` 为本地 PNG 路径后运行
`tests.test_product_images`。图片内容来自真实生成文件，但商品目录、Pi 方案及 HTTP 回包仍使用隔离夹具，
不是正式工作区的真实模型执行。1024×1024 文件验证检查、私有下载与素材包交付；
其他尺寸验证拒绝路径，不能放宽正式输出契约。测试不创建真实发布、不修改线上图片，不自动缩放。
生成图和私人测试记录不得同步开源副本。

API：`product-image-products`、`product-image-batches`、`product-image-batches/{id}`、`product-image-assets/{id}`。
接口形状参考 [OpenAI 官方图片生成文档](https://developers.openai.com/api/docs/guides/image-generation)。

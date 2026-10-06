/** Trusted UI policy, not a credential or a substitute for server-side authorization. */
import type { NodeInstance } from "./universal";
export type NodeEditMode = "fixed" | "parameters" | "skill";
export type NodeOperatorPolicy = {
  mode: NodeEditMode;
  description: string;
  result: string;
  editableParameters: string[];
  /** A replaceable interface is not permission to remove its business responsibility. */
  structuralEditing?: boolean;
  implementationKind?: "adapter";
};
const fixed = (description: string, result: string): NodeOperatorPolicy => ({ mode: "fixed", description, result, editableParameters: [] });
const parameters = (description: string, result: string, editableParameters: string[]): NodeOperatorPolicy => ({ mode: "parameters", description, result, editableParameters });
const skill = (description: string, result: string): NodeOperatorPolicy => ({ mode: "skill", description, result, editableParameters: [] });
const adapter = (description: string, result: string): NodeOperatorPolicy => ({ ...skill(description, result), implementationKind: "adapter", structuralEditing: false });

export const nodeOperatorPolicies: Record<string, NodeOperatorPolicy> = {
  'image.start':parameters('选择商品事实、规格与原图；独立制作素材，不要求商品已上架。','可追溯的商品与参考素材',['productRef','referenceAssets','usage','imageCount']),
  'image.brief':skill('制定主图、场景图与细节图方案，保留不可改变的商品事实。','版本化图片制作方案'),
  'image.generate':skill('选择图片生成 Skill 和服务连接；输出真实素材，不把提示词当图片。','生成图片及来源记录'),
  'image.check':fixed('检查文件、尺寸与商品一致性，无法自动核实的项目交人工确认。','检查记录与待人工核验项'),
  'image.authorize':parameters('逐张审核图片外观、授权与用途，不合格返回制作方案。','确认后的商品图素材包',['reviewChecklist']),
  'image.end':fixed('交付素材包供上架与推广显式引用，不自动改线上商品。','版本化商品图素材包'),
  'market.intelligence':parameters('开启后采集销售与广告榜各前十，按已确认的类目方案确定搜索方向；关闭则跳过，保留原商品任务搜索词。','两组榜单快照与 CJ 供货类目方向',['enabled','categoryPlanRef','categoryQueries']),
"product.start": parameters("在开始前集中设置搜索、需求门槛、库存供货、配送时效及费用假设；采集后按同一配置统一核验并补选。", "完整选品条件与范围", ["market", "category", "categoryId", "categoryQueries", "keyword", "emptyResultPolicy", "candidateSource", "limit", "requestedCurrency", "variantsPerProduct", "marketEvidenceRef", "allowEstimatedSales", "marketEvidenceSource", "minimumCJSales90d", "minimumCJOrderCount", "demandFirstCollection", "batchPublishing", "scanBudget","minimumInventory","requireVerifiedInventory","allowFactorySupply","factoryProcessingDays","factorySaleLimit","maximumDeliveryDays","allowCrossBorderShipping","platformFeeRate","paymentFeeRate","returnReserveRate","targetContributionRate","taxReserveUsd"]),
  "product.collect": fixed("继承任务条件，先排除同店铺已上架或提交中的 CJ 商品，再核验订单需求、排序并确定候选；之后才研究规格、库存与配送，已上架商品不占候选名额。", "去重后的需求达标候选、订单证据与排除原因"),
  "product.normalize": fixed("检查商品、变体、原报价币种、销量周期和库存来源；核算币种继承第一步，未知信息不编造。", "标准化商品资料与缺失项"),
  "product.verify": fixed("统一继承第一步条件，核验资料、库存、配送与成本；新主线内部调用已选策略建议售价，再由系统独立复核。缺额继续补选，保留逐商品原因，不替代人工批准。", "合格商品、经复核的建议售价与排除明细"),
  "product.filter": parameters("核验 CJ 仓现货；新批次没有合格规格的商品立即淘汰补位，不占合格目标，不继续查运费。工厂报量需显式开启、设置备货天数和限售量，并强制人工确认，不能标为已核实现货。", "可继续研究的候选与排除原因", ["minimumInventory", "requireVerifiedInventory", "allowFactorySupply", "factoryProcessingDays", "factorySaleLimit"]),
  "product.delivery": parameters("系统核验目标国家的配送线路、运费、时效与价格契约；研究完本次扫描范围后统一排序选优，不因达到目标数量提前停止；目标市场继承第一步，销售国家不等于仓库国家。", "可用配送方案与到货成本缺失项", ["maximumDeliveryDays", "allowCrossBorderShipping"]),
  "product.cost": fixed("继承任务的费用条件，独立复核策略建议售价及经营空间；不再重复配置。缺税费或运费不能当零，广告前贡献不是净利润。", "经系统复核的售价与经营空间"),
  "product.decide": skill("比较销量证据、卖点、供货和配送，建议商品、规格与售价；这是策略建议，不是批准或已验证盈利。", "选品与售价建议、证据和风险"),
  "product.authorize": parameters("核对系统核算结果，人工确认商品、规格、售价与目标市场；待研究和资料不足不能自动批准。", "经确认的商品与售价方案", ["reviewChecklist"]),
  "content.make": skill("按已确认的商品事实制作标题、卖点、详情和产品图。", "商品文案与图片草稿"),
  "listing.validate": adapter("选择渠道检查 Skill 核对刊登要求；统一字段、素材真实性与授权约束仍由系统检查，接口返回通过不能覆盖系统规则。", "渠道检查结果与需要修正的内容"),
  "listing.authorize": parameters("人工审核最终文案、图片、售价和配送承诺；修改内容后需要重新检查和审核，不复用旧批准。", "获准发布的最终草稿版本", ["reviewChecklist"]),
  "listing.publish": adapter("选择店铺对应的上架 Skill，转换字段并调用发布接口。系统仍核验两轮授权、草稿版本和防重复提交，提交成功不等于可售。", "统一发布回执与平台原始结果"),
  "listing.map": parameters("选择店铺与已验收映射方案。执行映射、检查必填字段；缺少事实停在此步，不猜值。首次接口分析仅用于开发方案。", "已检查的渠道发布请求；继承店铺、接口包和批准摘要", ["mappingMode", "mappingSessionRef", "mappingSessionRevision", "mappingPlanRef", "mappingPlanVersion", "mappingStoreRef", "mappingStoreVersion"]),
  "listing.wait": adapter("选择可售查询或事件适配 Skill，识别该渠道的真实可售状态；提交成功或 Skill 自报成功不能替代可售证据。", "实际可售或异常状态与证据"),
  "listing.end": fixed("记录可售商品；是否开始推广由另一个任务决定。", "可售商品记录"),
  "campaign.start": parameters("为已上架商品设定推广市场、目标与本轮范围。", "本轮推广任务", ["market", "reviewChecklist"]),
  "campaign.creative": skill("制作广告文案与推广创意，引用商品图素材包；新商品图由独立流程制作。", "待审核的推广素材"),
  "campaign.authorize": parameters("确认广告素材与花费范围，未确认不允许投放。", "已确认的投放范围", ["reviewChecklist"]),
  "campaign.submit": adapter("配置广告平台提交 Skill，将已批准素材以暂停状态提交；系统限制动作及花费范围，不能提前投放。", "广告提交回执"),
  "campaign.wait": adapter("配置广告平台审核查询或事件 Skill；无真实审核结果时保持等待，不自动启动。", "审核结果与平台证据"),
  "campaign.activate": adapter("配置广告平台启用 Skill；系统仍检查审核、授权和预算，只允许启动已批准的广告。", "实际投放结果"),
  "campaign.end": fixed("保存本轮结果，下一次复盘独立触发。", "推广记录"),
  "order.start": adapter("配置店铺订单事件 Skill，统一订单字段并保留平台原始状态；真实性、去重与付款核验由系统负责。", "待处理订单资料"),
  "order.eligible": fixed("检查付款状态、库存、地址和谁负责发货。", "可履约订单与责任方"),
  "order.authorize": parameters("核对履约权限；平台负责发货时不重复采购或发货。", "经授权的履约计划", ["reviewChecklist"]),
  "order.dispatch": adapter("选择供应商、仓库或平台观察 Skill；系统限制履约责任、授权和采购花费，平台履约不能重复下单或发货。", "履约提交或平台状态"),
  "order.wait": adapter("配置出库查询或事件 Skill，读取供应商、仓库或平台的运单证据；提交发货不等于已出库。", "真实出库与运单证据"),
  "order.record": adapter("配置店铺回写与通知 Skill，按通知所有权更新履约；系统校验出库证据和幂等，避免重复发邮件。", "同步与通知结果"),
  "order.delivery": adapter("配置物流跟踪或平台交付事件 Skill；只有真实签收或异常证据才能推进，出库不等于交付。", "包裹交付结果"),
  "order.end": fixed("归档交付结果，异常交给售后处理。", "交付记录"),
  "insight.start": adapter("配置店铺、广告或分析数据采集 Skill，汇总销售、库存、退款与广告表现；保留各自口径和数据来源。", "本轮经营数据"),
  "insight.check": fixed("检查数据是否够新、样本是否足够以及供货是否正常。", "可用于分析的数据"),
  "insight.propose": skill("解释商品表现，并建议维持、调整或暂停经营动作。", "经营建议与依据"),
  "insight.authorize": parameters("确认本轮允许调整的范围和预算。", "经确认的调整范围", ["reviewChecklist"]),
  "insight.apply": adapter("配置对应平台的调整 Skill；系统限制已确认的目标、预算、变化幅度及幂等，不让建议直接修改账户。", "实际调整结果"),
  "insight.end": fixed("保存本轮复盘，下轮独立开始。", "经营复盘记录"),
  "support.start": adapter("配置客服、邮件或平台问题事件 Skill；系统按订单和问题去重，适配器不能自行改变付款或履约事实。", "待处理问题"),
  "support.context": adapter("按咨询收集商品、订单、物流与政策；当前由用户提供已确认资料，未来连接器按最小权限读取，不虚构订单状态。", "客服资料与缺失项"),
  "support.propose": skill("选择已配置模型，通过 Pi harness 执行系统客服 Skill；依据提供的商品、订单与政策资料生成回复、追问或转人工建议，不发送消息。", "回复草稿、依据与转人工建议"),
  "support.authorize": parameters("核对答复事实、政策与需转人工的问题；退款、补发和争议交人工，不由模型自动授权。", "已确认答复或转人工记录", ["reviewChecklist"]),
  "support.execute": adapter("接入原咨询渠道的消息发送动作，检查已确认回复与消息幂等键；当前未部署发送连接器，不执行退款或补发。", "消息提交回执（不等于送达）"),
  "support.wait": adapter("查询原消息的送达状态；未知结果不重复发送，等待或转人工核对。当前连接器待接入。", "消息送达结果或待核对记录"),
  "support.end": fixed("归档回复与消息证据，待人工问题保持开放；送达不等于客户问题已经解决。", "客服会话记录"),
  "extension.rule": fixed("追加检查，不能创造付款、授权或出库事实。", "检查后的原业务结果"),
  "extension.review": parameters("追加一次人工复核，不能代替必要的动作授权。", "复核意见", ["reviewChecklist"]),
  "extension.skill": skill("增加自己的分析或内容处理，不直接执行资金动作。", "补充建议或内容"),
  "flow.end": fixed("在这里交付本次结果，不自动继续发布或投放。", "本次业务结果"),
};
nodeOperatorPolicies['product.start'].editableParameters.push('demandQualifiedQuota');
nodeOperatorPolicies['product.start'].editableParameters.push('finalSelectionMode');
export function getNodeOperatorPolicy(id: string): NodeOperatorPolicy {
  const policy=nodeOperatorPolicies[id] ?? fixed("此步骤由系统管理，联系技术人员查看配置。", "系统处理结果");
  return id.endsWith(".authorize")||id==="extension.review"?{...policy,editableParameters:[...policy.editableParameters,"approvalEnabled"]}:policy;
}
export const editModeLabels: Record<NodeEditMode, string> = { fixed: "系统固定", parameters: "可调参数", skill: "可配置 Skill" };
export function canOperatorEditStructure(id: string): boolean {
  return getNodeOperatorPolicy(id).mode === "skill" && getNodeOperatorPolicy(id).structuralEditing !== false || !!nodeOperatorPolicies[id] && id.startsWith("extension.");
}
/** Local editor boundary only. Adapter setup is a separate technical design action. */
export function applyOperatorNodeSettings(current: NodeInstance, proposed: NodeInstance, adapterConfiguration = false): NodeInstance {
  const policy = getNodeOperatorPolicy(current.definitionId);
  if (policy.mode === "skill" || adapterConfiguration) return { ...proposed, id: current.id, definitionId: current.definitionId, title: policy.mode === "skill" ? proposed.title : current.title };
  return { ...current, binding: { ...current.binding, parameters: { ...current.binding.parameters,
    ...Object.fromEntries(policy.editableParameters.filter(key => key in proposed.binding.parameters).map(key => [key, proposed.binding.parameters[key]])) } } };
}

import { recommendedSelectionDefaults } from "./recommended-defaults";
import type { NodeKind, Workflow } from "@/components/commerce/workflow/model";
import { builtinChannels, defaultChannelId, resolveChannel, validateCustomChannels, type Channel, type Fulfillment, type SalesChannelDefinition } from "./channels";
import { getNodeOperatorPolicy } from "./operator-policy";
export type { Channel, Fulfillment, SalesChannelDefinition } from "./channels";

/** Frontend design contracts. No entrypoint in this module is executed. */
export type SkillRuntime = "script" | "connector" | "llm" | "media" | "composite" | "manual";
export type Effect = "read" | "artifact" | "remote_write" | "spend" | "message";
export type ParameterDefinition = { type: "string" | "number" | "boolean" | "array"; label: string; description?: string; required?: boolean; default?: string | number | boolean; enum?: (string | number | boolean)[]; minimum?: number; maximum?: number };
export type SkillManifest = {
  id: string; name: string; version: string; runtime: SkillRuntime; description: string;
  input: string; output: string; entrypointRef: string;
  parameterSchema: Record<string, ParameterDefinition>;
  capabilities: string[]; effects: Effect[]; channels: Channel[]; fulfillments?: Fulfillment[];
};
export type NodeDefinition = {
  id: string; title: string; description: string; kind: NodeKind; input: string; output: string;
  steps: string[]; requires: string[]; provides: string[]; allowedEffects: Effect[];
  passthrough?: boolean; event?: string;
};
export type SkillBinding = { skillId: string; skillVersion: string; mode: "default" | "custom"; parameters: Record<string, unknown>; connectionRef?: string; execution?: { timeoutSeconds: number; maxRetries: number; retryMode: "safe" | "never" } };
export type NodeInstance = { id: string; definitionId: string; title: string; binding: SkillBinding };
export type WorkflowEdge = { id: string; source: string; target: string; kind: "forward" | "feedback" | "collaboration"; label?: string; description?: string };
/** One store integration supplies multiple actions. Declarations are not live verification. */
export type StoreIntegration = { channel: string; name: string; version: string; actions: string[]; status: "draft"; apiMode?: "create-api" | "existing-api" };
export const storeActionIds = ["listing.validate", "listing.publish", "listing.wait", "order.start", "order.record", "insight.start", "insight.apply", "support.start", "support.context"];
export const isStoreAction = (id: string) => storeActionIds.includes(id);
export type ExecutionEnvironment = { channel: Channel; fulfillment: Fulfillment; capabilities: string[]; storeRef?: string; storeIntegration?: StoreIntegration };
export function resolveNodeConnection(node: NodeInstance, environment: ExecutionEnvironment) {
  if (node.binding.connectionRef) return { source: "override" as const, reference: node.binding.connectionRef };
  if (!isStoreAction(node.definitionId)) return { source: "service" as const, reference: undefined };
  const integration = environment.storeIntegration;
  return { source: "store" as const, reference: integration && validStoreIntegration(integration, environment.channel) && integration.actions.includes(node.definitionId) ? environment.storeRef : undefined };
}
export function validStoreIntegration(value: unknown, channel: string): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as StoreIntegration;
  return item.channel === channel && item.status === "draft" && (item.apiMode===undefined||["create-api","existing-api"].includes(item.apiMode)) && typeof item.name === "string" && item.name.length <= 80 && typeof item.version === "string" && item.version.length <= 40 && Array.isArray(item.actions) && item.actions.length <= storeActionIds.length && new Set(item.actions).size === item.actions.length && item.actions.every(id => isStoreAction(id));
}
export type WorkflowDocument = { schemaVersion: "2"; id: string; title: string; revision: number; templateId: string; environment: ExecutionEnvironment; nodes: NodeInstance[]; edges: WorkflowEdge[]; customSkills: SkillManifest[]; customChannels?: SalesChannelDefinition[]; selectionStrategy?:NodeInstance };
export function selectionStrategyNode(document:WorkflowDocument){return document.nodes.find(n=>n.definitionId==='product.decide')??document.selectionStrategy;}
/** Internal compatibility view, never a second canvas or a frozen-document mutation. */
export function withSelectionStages(document:WorkflowDocument):WorkflowDocument {
  if(!document.selectionStrategy||document.nodes.some(n=>n.definitionId==='product.decide'))return document;
  const index=document.nodes.findIndex(n=>n.definitionId==='product.verify');if(index<0)return document;
  const cost:NodeInstance={id:document.nodes[index].id+':cost',definitionId:'product.cost',title:'内部售价复核',binding:{skillId:'product.cost.core',skillVersion:'1.0.0',mode:'default',parameters:{}}};
  const nodes=[...document.nodes.slice(0,index+1),document.selectionStrategy,cost,...document.nodes.slice(index+1)];
  return {...document,nodes,edges:[...forwardEdges(nodes),...document.edges.filter(e=>e.kind!=='forward')]};
}
export function compactSelectionStages(document:WorkflowDocument):WorkflowDocument {
  if(document.templateId!=='launch'||!document.nodes.some(n=>n.definitionId==='product.verify'))return document;
  const strategy=selectionStrategyNode(document);if(!strategy)return document;
  const verify=document.nodes.find(n=>n.definitionId==='product.verify')!;
  const removed=new Set(document.nodes.filter(n=>['product.decide','product.cost'].includes(n.definitionId)).map(n=>n.id));
  const nodes=document.nodes.filter(n=>!removed.has(n.id)).map(n=>n.id===verify.id?{...n,title:'统一核验、定价并补选'}:n);
  const relations=document.edges.filter(e=>e.kind!=='forward').map(e=>({...e,source:removed.has(e.source)?verify.id:e.source,target:removed.has(e.target)?verify.id:e.target})).filter(e=>e.source!==e.target);
  return {...document,selectionStrategy:strategy,nodes,edges:[...forwardEdges(nodes),...relations]};
}
export type WorkflowTemplate = { id: string; title: string; description: string; trigger: string; cadence: Workflow["cadence"]; definitions: string[] };
export type PreviewIssue = { code: string; message: string; nodeId?: string; edgeId?: string };
export type PreviewValidationResult = { valid: boolean; engine: "frontend-preview"; source: "frontend-preview"; revision: number; errors: PreviewIssue[]; warnings: PreviewIssue[] };
export type BackendValidationResponse = { engine: "pydantic"; documentRevision: number; documentDigest: string; valid: boolean; issues: PreviewIssue[]; validationId?: string };
export type RunRequest = { documentId: string; revision: number; validationId: string; environmentRef: string; idempotencyKey: string };
export type RunEvent = { workflowId: string; documentRevision: number; runId: string; sequence: number; attempt: number; nodeId?: string; edgeId?: string; status: "running" | "transferring" | "collaborating" | "waiting_event" | "waiting_approval" | "completed" | "failed" | "stopped"; occurredAt: string; outputRef?: string; approvalRef?: string };
export type WorkflowRunEvent = RunEvent;
export { contractSchemas, contractExamples } from "./contract-schemas";

const builtinChannelIds: Channel[] = builtinChannels.filter(channel => channel.adapterStatus === "example").map(channel => channel.id);
const anyChannel: Channel[] = ["*"];
const d = (id: string, title: string, kind: NodeKind, input: string, output: string, description: string, extra: Partial<NodeDefinition> = {}): NodeDefinition => ({ id, title, kind, input, output, description, steps: [description, "按版本化契约校验输入与输出；实际执行由未来运行器负责"], requires: [], provides: [], allowedEffects: ["read"], ...extra });
export const nodeDefinitions: NodeDefinition[] = [
  d('market.intelligence','采集市场类目排行','action','MerchantRequest@1','MerchantRequest@1','可选：登录 CJ 网页读取销售与广告类目前十；按已确认的供货类目方案传给商品任务。'),
  d("flow.end", "交付当前结果", "end", "$context", "$context", "以当前已产出的契约结束，不强制继续发布、投放或资金动作。", { passthrough: true }),
  d("product.start", "定义商品任务", "trigger", "MerchantRequest@1", "ProductQuery@2", "集中设置搜索、需求、库存、配送和费用条件，后续统一继承。"),
  d("product.collect", "采集商品记录", "action", "ProductQuery@2", "ProductRecords@1", "固定 CJ 采集：默认先核验订单需求并排序，再确定候选数量；库存与配送由后续节点检查。"),
  d("product.verify", "统一核验并补选", "action", "ProductRecords@1", "DeliveryCandidates@1", "按第一步全部条件统一检查资料、规格库存、配送和成本；不合格补选，保留每款淘汰原因。", {provides:["selection.filtered","selection.delivery_checked"]}),
  d("product.normalize", "检查商品资料", "rule", "ProductRecords@1", "CJProductFacts@1", "固定映射商品、变体、原报价币种、库存及销量周期；继承任务币种，缺失不补造。"),
  d("product.filter", "筛除不符合条件的商品", "rule", "CJProductFacts@1", "EligibleCandidates@1", "确定性筛查库存、类目与供货条件，保留排除原因；资料不足单独待复核。", { provides: ["selection.filtered"] }),
  d("product.delivery", "核验配送与到货成本", "action", "EligibleCandidates@1", "DeliveryCandidates@1", "按变体、数量、发货地与目标国家核验 CJ 配送；保留线路、估算费用和时效，未知税费不视为零。", { requires: ["selection.filtered"], provides: ["selection.delivery_checked"] }),
  d("product.decide", "评估商品机会与建议售价", "ai", "DeliveryCandidates@1", "SelectionProposal@1", "比较供货、配送与市场证据，建议商品、规格与售价；缺少证据时输出待研究，不宣称最终利润。", { requires: ["selection.delivery_checked"] }),
  d("product.cost", "核算经营空间", "rule", "SelectionProposal@1", "SelectionAssessment@1", "按建议售价和确定性费用规则核算广告前贡献空间；缺运费、税费等输入时标记不可核算。", { provides: ["selection.cost_checked"] }),
  d("product.authorize", "确认商品、规格与售价", "approval", "SelectionAssessment@1", "ApprovedProductBrief@2", "人工确认商品、变体、售价、可配送市场与风险；待研究或核算不完整不可自动批准。", { requires: ["selection.cost_checked"], provides: ["listing.authorized"] }),
  d("content.make", "制作商品内容与素材", "ai", "ApprovedProductBrief@2", "ListingDraft@1", "组合文案、脚本和图片工具，产出实际素材引用；不改变商品功能、结构或配送承诺。", { allowedEffects: ["read", "artifact"] }),
  d("listing.validate", "检查内容与渠道要求", "rule", "ListingDraft@1", "ValidatedListing@1", "核对统一字段与目标渠道产品类型要求。", { provides: ["listing.validated"] }),
  d("listing.authorize", "审核最终上架草稿", "approval", "ValidatedListing@1", "ApprovedListing@1", "人工审核最终文案、真实图片、定价与配送承诺；选品确认不等于内容批准。", { requires: ["listing.authorized", "listing.validated"], provides: ["listing.draft_authorized"] }),
  d("listing.map", "准备渠道发布数据", "rule", "ApprovedListing@1", "PreparedChannelPublication@1", "执行已验收映射方案，检查必填字段与类型；保留批准内容摘要。缺少事实立即停止，不调用模型猜值，不发送发布请求。", { requires: ["listing.draft_authorized"], provides: ["listing.prepared"] }),
  d("listing.publish", "提交渠道发布", "action", "PreparedChannelPublication@1", "PublicationReceipt@1", "继承准备节点的店铺和适配包，发送已检查的请求并处理回执；响应未知先核对原操作，不盲目重复提交。回执不代表已经可售。", { requires: ["listing.authorized", "listing.validated", "listing.draft_authorized", "listing.prepared"], allowedEffects: ["read", "remote_write"] }),
  d("listing.wait", "等待真实可售结果", "wait", "PublicationReceipt@1", "PublishedProduct@1", "等待渠道处理、检查异常与可售状态。", { event: "渠道确认商品可售" }),
  d("listing.end", "交付可售商品", "end", "PublishedProduct@1", "PublishedProduct@1", "按需交接推广；不会强制启动广告。"),
  d("campaign.start", "定义推广任务", "trigger", "PublishedProduct@1", "CampaignBrief@1", "为可售商品选择目标、渠道和测试预算。"),
  d("campaign.creative", "制作推广素材", "ai", "CampaignBrief@1", "CreativePack@1", "通过任意兼容实现生成广告文案、图片和变体。", { allowedEffects: ["read", "artifact"] }),
  d("campaign.authorize", "确认素材与花费", "approval", "CreativePack@1", "ApprovedCampaign@1", "确认本轮素材版本、目标和花费上限。", { provides: ["campaign.authorized"] }),
  d("campaign.submit", "提交暂停广告", "action", "ApprovedCampaign@1", "CampaignSubmission@1", "创建或更新原广告草稿，等待渠道审核。", { requires: ["campaign.authorized"], allowedEffects: ["read", "remote_write"] }),
  d("campaign.wait", "等待广告审核", "wait", "CampaignSubmission@1", "ReviewedCampaign@1", "渠道未确认前保持暂停。", { event: "广告审核通过", provides: ["campaign.reviewed"] }),
  d("campaign.activate", "启动批准的广告", "action", "ReviewedCampaign@1", "CampaignResult@1", "在已批准范围内激活广告。", { requires: ["campaign.authorized", "campaign.reviewed"], allowedEffects: ["read", "remote_write", "spend"] }),
  d("campaign.end", "记录推广结果", "end", "CampaignResult@1", "CampaignResult@1", "后续复盘由独立调度触发。"),
  d("order.start", "接收订单事件", "trigger", "ChannelEvent@1", "OrderContext@1", "统一字段但保留付款、取消和履约责任原始语义。"),
  d("order.eligible", "核验履约条件", "rule", "OrderContext@1", "FulfillmentPlan@1", "检查订单状态、库存、责任方与地址，不把待付款映射成已付。", { provides: ["fulfillment.eligible"] }),
  d("order.authorize", "确认履约权限", "approval", "FulfillmentPlan@1", "AuthorizedFulfillment@1", "商家动作检查授权；平台履约只确认观察范围。", { provides: ["fulfillment.authorized"] }),
  d("order.dispatch", "执行对应履约方式", "action", "AuthorizedFulfillment@1", "FulfillmentReceipt@1", "代发交供应商、自有仓交仓库，平台负责履约时只读取平台状态。", { requires: ["fulfillment.eligible", "fulfillment.authorized"], allowedEffects: ["read", "remote_write", "spend"] }),
  d("order.wait", "等待真实出库", "wait", "FulfillmentReceipt@1", "ShipmentEvidence@1", "等待供应商、仓库或平台确认实际出库。", { event: "责任方确认出库与运单", provides: ["shipment.evidence"] }),
  d("order.record", "同步履约与通知", "action", "ShipmentEvidence@1", "ShipmentRecord@1", "渠道适配器确定回写与通知所有权，防止重复发送。", { requires: ["shipment.evidence"], allowedEffects: ["read", "remote_write", "message"] }),
  d("order.delivery", "等待交付结果", "wait", "ShipmentRecord@1", "DeliveryResult@1", "按包裹观察签收或异常，不把出库当作签收。", { event: "实际交付结果" }),
  d("order.end", "归档交付结果", "end", "DeliveryResult@1", "DeliveryResult@1", "异常交接售后；平台仓补货与消费订单交付是独立任务。"),
  d("insight.start", "采集经营快照", "trigger", "ScheduleTick@1", "CommerceSnapshot@1", "规范化库存、收入、退款与投放指标。"),
  d("insight.check", "核验样本和供应", "rule", "CommerceSnapshot@1", "AnalysisContext@1", "检查数据新鲜度、归因窗口、库存与冷却期。"),
  d("insight.propose", "提出经营建议", "ai", "AnalysisContext@1", "OptimizationProposal@1", "模型或脚本解释证据，提出调整而非直接改账户。"),
  d("insight.authorize", "确认调整边界", "approval", "OptimizationProposal@1", "AuthorizedOptimization@1", "核对目标计划、变化幅度与预算上限。", { provides: ["optimization.authorized"] }),
  d("insight.apply", "应用批准的调整", "action", "AuthorizedOptimization@1", "OptimizationResult@1", "通过适配器执行并记录实际结果。", { requires: ["optimization.authorized"], allowedEffects: ["read", "remote_write", "spend"] }),
  d("insight.end", "结束本轮复盘", "end", "OptimizationResult@1", "OptimizationResult@1", "结束当前任务，下一轮独立触发。"),
  d("support.start", "接收并合并问题", "trigger", "SupportEvent@1", "SupportQuery@1", "按订单和问题去重合并。"),
  d("support.context", "收集订单与政策证据", "action", "SupportQuery@1", "SupportContext@1", "读取物流、支付、历史处理和当前允许动作。"),
  d("support.propose", "形成处理方案", "ai", "SupportContext@1", "SupportProposal@1", "人工、规则脚本或模型均可提供答复与处理建议。"),
  d("support.authorize", "确认处理权限", "approval", "SupportProposal@1", "AuthorizedResolution@1", "校验当前允许的消息、退款或补发范围。", { provides: ["resolution.authorized"] }),
  d("support.execute", "执行批准的方案", "action", "AuthorizedResolution@1", "ResolutionReceipt@1", "使用平台允许的动作，资金与消息必须独立核验授权。", { requires: ["resolution.authorized"], allowedEffects: ["read", "remote_write", "spend", "message"] }),
  d("support.wait", "等待处理确认", "wait", "ResolutionReceipt@1", "ResolutionResult@1", "未确认退款或补发时保持工单开放。", { event: "处理动作确认成功" }),
  d("support.end", "记录问题解决", "end", "ResolutionResult@1", "ResolutionResult@1", "保留结果与证据，已发送答复不重复通知。"),
  d("extension.rule", "附加规则检查", "rule", "$context", "$context", "检查当前上下文，不创造付款、授权或出库事实。", { passthrough: true }),
  d("extension.review", "附加人工复核", "approval", "$context", "$context", "追加审阅意见，不替代动作专用授权。", { passthrough: true }),
  d("extension.skill", "附加 Skill 处理", "ai", "$context", "$context", "读取上下文并追加建议，业务事实保持不变。", { passthrough: true, allowedEffects: ["read", "artifact"] }),
];

export const workflowTemplates: WorkflowTemplate[] = [
  { id: "launch", title: "选品到上线", description: "集中配置条件，采集后统一核验补选；策略建议售价，系统复核，审核后发布。", trigger: "手动商品任务", cadence: "按需启动", definitions: ["product.start", "product.collect", "product.verify", "product.decide", "product.cost", "product.authorize", "content.make", "listing.validate", "listing.authorize", "listing.map", "listing.publish", "listing.wait", "listing.end"] },
  { id: "campaign", title: "推广与首次投放", description: "统一创意产物，按渠道审核与授权启动。", trigger: "手动推广任务", cadence: "按需启动", definitions: ["campaign.start", "campaign.creative", "campaign.authorize", "campaign.submit", "campaign.wait", "campaign.activate", "campaign.end"] },
  { id: "fulfillment", title: "订单到交付", description: "同一业务主线按责任方选择代发、仓库或平台观察实现。", trigger: "订单状态事件", cadence: "事件驱动", definitions: ["order.start", "order.eligible", "order.authorize", "order.dispatch", "order.wait", "order.record", "order.delivery", "order.end"] },
  { id: "optimize", title: "经营复盘与调整", description: "数据、分析、授权、执行分别具有清晰契约。", trigger: "定时经营检查", cadence: "定时运行", definitions: ["insight.start", "insight.check", "insight.propose", "insight.authorize", "insight.apply", "insight.end"] },
  { id: "support", title: "售后问题到解决", description: "复用证据和建议契约，平台决定允许的处理动作。", trigger: "客户问题或物流异常", cadence: "事件驱动", definitions: ["support.start", "support.context", "support.propose", "support.authorize", "support.execute", "support.wait", "support.end"] },
];

const parameters: Record<string, ParameterDefinition> = { market: { type: "string", label: "目标市场", default: "US" }, timeout: { type: "number", label: "工具请求超时（秒）", default: 60, minimum: 1, maximum: 600 } };
function parametersFor(definition: NodeDefinition, runtime: SkillRuntime): Record<string, ParameterDefinition> {
  const shared = structuredClone(parameters);
  if(definition.id==='product.start')shared.demandQualifiedQuota={type:'boolean',label:'订单数达标才占候选额度（低订单、未知、重复及已上架不计）',default:true};
  if(definition.id==='product.start')shared.finalSelectionMode={type:'string',label:'最终商品选取方式',default:'global',enum:['global','per_category']};
if (definition.id === "product.start") return { ...shared, candidateSource:{type:"string",label:"候选商品来源",default:"catalog",enum:["catalog","trending"]}, marketEvidenceSource:{type:"string",label:"市场证据来源",enum:["none","cj","external"]},minimumCJSales90d:{type:"number",label:"历史 v3 · CJ 近90天最低销量",minimum:1,maximum:100000000},scanBudget:{type:"number",label:"最多扫描商品数（独立预算，20–10000）",default:recommendedSelectionDefaults.scanBudget,minimum:20,maximum:10000},batchPublishing:{type:"boolean",label:"按合格商品目标补位并批量发布"},demandFirstCollection:{type:"boolean",label:"先核验需求再确定候选"},minimumCJOrderCount:{type:"number",label:"CJ 最低订单数（统计周期未声明）",default:1,minimum:1,maximum:100000000}, marketEvidenceRef:{type:"string",label:"市场证据版本"}, allowEstimatedSales:{type:"boolean",label:"允许估算销量"}, variantsPerProduct:{type:"number",label:"每件商品研究规格上限（1–20）",default:recommendedSelectionDefaults.variantsPerProduct,minimum:1,maximum:20}, categoryQueries: {type:"array",label:"CJ 多类目查询"}, category: { type: "string", label: "旧类目（需重新选择）" }, categoryId: { type: "string", label: "CJ 商品类目", default: "" }, keyword: { type: "string", label: "选品关键词（可选）", default: "" }, emptyResultPolicy: {type:"string",label:"没有商品时",default:"pause",enum:["pause","drop_keyword_once"]}, limit: { type: "number", label: "本次合格商品目标（最多 100 款）", default: recommendedSelectionDefaults.limit, minimum: 1, maximum: 100 }, requestedCurrency: { type: "string", label: "任务核算币种", default: "USD", enum: ["USD", "EUR", "GBP", "CNY"] } };
  if (definition.id === "product.collect") return {};
  if (definition.id === "product.normalize") return {};
  if (definition.id === "product.verify") return {};
  if (["listing.validate", "listing.publish", "listing.wait"].includes(definition.id)) return {};
  if (definition.id === "product.filter") return { allowFactorySupply:{type:"boolean",label:"允许工厂供货（报量不等于现货）",default:false},factoryProcessingDays:{type:"number",label:"工厂备货天数假设（启用工厂供货时填写）",default:recommendedSelectionDefaults.factoryProcessingDays,minimum:0,maximum:60},factorySaleLimit:{type:"number",label:"工厂单规格限售量（启用时填写）",default:recommendedSelectionDefaults.factorySaleLimit,minimum:1,maximum:1000}, minimumInventory: { type: "number", label: "最低可确认库存（件）", default: 5, minimum: 1, maximum: 100000 }, requireVerifiedInventory: { type: "boolean", label: "仅接受已验证库存", default: true } };
  if (definition.id === "product.delivery") return { maximumDeliveryDays: { type: "number", label: "最长预计运输时效（天）", default: recommendedSelectionDefaults.maximumDeliveryDays, minimum: 1, maximum: 90 }, allowCrossBorderShipping: { type: "boolean", label: "允许跨境直发", default: true } };
  if (definition.id === "product.cost") return { targetContributionRate:{type:"number",label:"目标贡献率假设（%，销量策略扣所填获客成本后）",default:30,minimum:1,maximum:50},taxReserveUsd:{type:"number",label:"税费及附加费预留 USD（启动假设，请按商品核实）",default:recommendedSelectionDefaults.taxReserveUsd,required:true,minimum:0,maximum:10000}, platformFeeRate: { type: "number", label: "销售平台费用率假设（%，按店铺核实）", default: 0, minimum: 0, maximum: 100 }, paymentFeeRate: { type: "number", label: "支付费用率假设（%）", default: 3, minimum: 0, maximum: 100 }, returnReserveRate: { type: "number", label: "退货成本预留（%）", default: 5, minimum: 0, maximum: 100 } };
  if (runtime === "manual") return { ...shared, ...(definition.kind==="approval"?{approvalEnabled:{type:"boolean" as const,label:"启用人工审核",default:true}}:{}), reviewChecklist: { type: "string", label: "人工检查清单", default: "核对证据、缺失信息及本次处理范围。" } };
  if (definition.id === "content.make" || definition.id === "campaign.creative") return { ...shared, prompt: { type: "string", label: "内容与图片制作指令", default: "依据已核实的商品事实生成本地化文案；图片工具返回实际素材引用。" }, imageProviderRef: { type: "string", label: "图片生成服务引用（不是已生成图片）", default: "" }, locale: { type: "string", label: "输出语言", default: "en-US" } };
  if (runtime === "script" && definition.id === "product.decide") return { ...shared, scoringWeights: { type: "string", label: "评分权重配置", default: "supply:0.4,evidence:0.4,differentiation:0.2" }, sampleCount: { type: "number", label: "抽样数量", default: 20, minimum: 1, maximum: 1000 } };
  if (runtime === "llm" || runtime === "composite") return { ...shared, instruction: { type: "string", label: "分析与处理指令", default: "依据可追溯证据输出契约结果；缺少信息应明确标记。" }, modelRef: { type: "string", label: "模型连接引用", default: "" } };
  if (runtime === "connector") return { ...shared, resourceRef: { type: "string", label: "业务资源引用（不填凭证）", default: "" } };
  return { ...shared, ruleNote: { type: "string", label: "规则参数说明", default: "遵循固定契约，保留缺失事实。" } };
}
const runtimeFor = (definition: NodeDefinition): SkillRuntime => definition.kind === "approval" || ["product.start", "campaign.start"].includes(definition.id) ? "manual" : definition.kind === "ai" ? "composite" : definition.kind === "rule" || definition.kind === "end" ? "script" : "connector";
function taskRuleParameters():Record<string,ParameterDefinition> {
  return Object.assign({},...['product.filter','product.delivery','product.cost'].map(id=>parametersFor(nodeDefinitions.find(n=>n.id===id)!,'script')));
}
const manifest = (definition: NodeDefinition, channel: Channel, mode?: Fulfillment): SkillManifest => {
  const platformObserve = mode === "platform" && definition.id.startsWith("order.");
  const effects: Effect[] = platformObserve ? ["read"] : definition.id === "order.dispatch" && mode === "merchant" ? ["read", "remote_write"] : definition.allowedEffects;
  return { id: `${definition.id}.${channel}${mode ? `.${mode}` : ""}`, name: `${channel === "amazon" ? "Amazon" : "独立站"} · ${definition.title}${mode ? ` · ${mode === "platform" ? "平台观察" : mode === "supplier" ? "供应商代发" : "仓库履约"}` : ""}`, version: "1.0.0", runtime: runtimeFor(definition), description: platformObserve ? "只观察平台状态，不执行商家采购、付款或出库。" : definition.description, input: definition.input, output: definition.output, entrypointRef: `registry://${definition.id}/${channel}${mode ? `/${mode}` : ""}@1`, parameterSchema: {...parametersFor(definition, runtimeFor(definition)),...(definition.id==='product.start'?taskRuleParameters():{})}, capabilities: [`${channel}.read`, ...effects.filter(effect => effect !== "read").map(effect => `${channel}.${effect}`)], effects, channels: [channel], fulfillments: mode ? [mode] : undefined };
};
const adapterIds = new Set(["listing.validate", "listing.publish", "listing.wait", "campaign.submit", "campaign.wait", "campaign.activate", "order.start", "order.dispatch", "order.wait", "order.record", "order.delivery", "insight.start", "insight.apply", "support.start", "support.context", "support.execute", "support.wait"]);
export const isChannelAdapter = (id: string) => adapterIds.has(id);
export const skillManifests: SkillManifest[] = nodeDefinitions.flatMap(definition => {
  if(definition.id==='market.intelligence')return [{...manifest(definition,'shopify'),id:'market.intelligence.core',name:'系统 · CJ 网页行情',channels:anyChannel,capabilities:[],parameterSchema:{enabled:{type:'boolean',label:'启用行情选方向',default:false},categoryPlanRef:{type:'string',label:'已确认的类目方案'},categoryQueries:{type:'array',label:'继承的 CJ 供货类目'}},entrypointRef:'registry://core/cj-intelligence@1'}];
  if (definition.id === 'product.decide') return [{...manifest(definition,'shopify'),id:'product.decide.core',name:'CJ 销量与供货选品（默认接入）',runtime:'script',description:'默认读取 CJ 近 90 天销量、供货、配送和到货成本进行确定性评估；保存时绑定审核过的算法，缺销量暂停。外部证据继承任务设置并绑定对应注册策略。',channels:anyChannel,capabilities:[],parameterSchema:{},entrypointRef:'registry://core/product.decide@1'}];
  if (definition.id === 'content.make') return [{...manifest(definition,'shopify'),id:'content.make.core',name:'原素材与商品文案整理（默认接入）',runtime:'script',description:'沿用已确认的商品图片与文案，不调用模型。保存时绑定后端已审核、可执行的注册版本；尚未绑定时不能真实运行。',channels:anyChannel,capabilities:[],parameterSchema:{},entrypointRef:'registry://core/content.make@1'}];
  if (definition.id === "listing.map") return [{ ...manifest(definition, "shopify"), id:"listing.map.core", name:"系统 · 准备渠道发布数据", runtime:"script", channels:anyChannel, capabilities:[], parameterSchema:{mappingMode:{type:"string",label:"接入方式",enum:["installed","analysis"]},mappingSessionRef:{type:"string",label:"映射草案记录"},mappingSessionRevision:{type:"number",label:"映射草案修订号",minimum:2},mappingPlanRef:{type:"string",label:"已安装映射方案"},mappingPlanVersion:{type:"string",label:"方案版本"},mappingStoreRef:{type:"string",label:"方案店铺"},mappingStoreVersion:{type:"number",label:"连接版本",minimum:1}}, entrypointRef:"registry://core/listing.map@1" }];
  // Internal execution descriptor only: CJ collection is not an operator-selectable Skill.
  if (definition.id === "product.collect") return [{ ...manifest(definition, "shopify"), id: "product.collect.core", name: "系统 · CJ 商品采集", channels: anyChannel, capabilities: [], parameterSchema: {}, entrypointRef: "registry://core/cj-product-collection@1" }];
  if (!adapterIds.has(definition.id)) return [{ ...manifest(definition, "shopify"), id: `${definition.id}.core`, name: `共用 · ${definition.title}`, channels: anyChannel, capabilities: definition.allowedEffects.includes("artifact") ? ["assets.generate"] : [], entrypointRef: `registry://core/${definition.id}@1` }];
  return builtinChannelIds.flatMap(channel => {
    if (["order.dispatch", "order.wait", "order.record"].includes(definition.id)) {
      return (["supplier", "merchant", "platform"] as Fulfillment[]).filter(mode => channel === "amazon" ? mode !== "supplier" : mode !== "platform").map(mode => {
        const skill = manifest(definition, channel, mode);
        return skill;
      });
    }
    const skill = manifest(definition, channel);
    return [skill];
  });
});
for (const runtime of ["script", "llm", "manual"] as SkillRuntime[]) {
  const definition = nodeDefinitions.find(item => item.id === "product.decide")!;
  skillManifests.push({ ...manifest(definition, "shopify"), id: `product.decision.${runtime}`, name: `${runtime === "script" ? "规则评分脚本" : runtime === "llm" ? "模型证据分析" : "人工选品决策"}`, runtime, parameterSchema: parametersFor(definition, runtime), channels: anyChannel, capabilities: [], entrypointRef: `registry://product-decision/${runtime}@1` });
}
skillManifests.push({ ...manifest(nodeDefinitions.find(item => item.id === "content.make")!, "shopify"), id: "content.media-pack", name: "宣传图与文案组合工具", runtime: "media", channels: anyChannel, capabilities: ["assets.generate"], entrypointRef: "registry://content/media-pack@1" });

skillManifests.push({...manifest(nodeDefinitions.find(item=>item.id==="product.decide")!,"test-store"),id:"product.decision.landed-cost",name:"到货成本与时效排序（真实运行）",version:"1.0.0",runtime:"script",channels:anyChannel,capabilities:[],parameterSchema:{},entrypointRef:"registry://core/landed-cost.v1",description:"确定性排序，选择最高排名的一件商品；沿用系统核算参数，不调用模型、不预测销量。"});
export const getDefinition = (id: string) => nodeDefinitions.find(item => item.id === id);
export const getSkill = (id: string, document?: WorkflowDocument) => skillManifests.find(item => item.id === id) ?? document?.customSkills.find(item => item.id === id);
export const skillSupportsChannel = (skill: SkillManifest, channel: Channel) => skill.channels.includes("*") || skill.channels.includes(channel);
export function defaultSkillFor(definitionId: string, channel: Channel, fulfillment: Fulfillment) {
  // Registry additions never inherit a similarly named built-in Skill or another platform's API.
  const adapter = builtinChannelIds.includes(channel)
    ? skillManifests.find(skill => skill.id === `${definitionId}.${channel}.${fulfillment}`) ?? skillManifests.find(skill => skill.id === `${definitionId}.${channel}`)
    : undefined;
  return adapter ?? skillManifests.find(skill => skill.id === `${definitionId}.core`);
}
export type CategoryQuery = {categoryId:string;keyword:string};
export function categoryQueriesFor(p:Record<string,unknown>):CategoryQuery[] {
  if(Array.isArray(p.categoryQueries))return p.categoryQueries.filter((q):q is CategoryQuery=>!!q&&typeof q==="object"&&typeof q.categoryId==="string"&&typeof q.keyword==="string");
  return p.categoryId?[{categoryId:String(p.categoryId),keyword:String(p.keyword??"")}]:[];
}
export function validCategoryQueries(p:Record<string,unknown>):boolean {
  const raw=p.categoryQueries;
  if(!Array.isArray(raw)||raw.length>10||p.categoryId)return false;
  if(raw.length&&p.keyword)return false;
  const groups=categoryQueriesFor(p);
  return groups.length===raw.length&&groups.every(q=>q.categoryId.trim().length>0&&q.categoryId.length<=200&&q.keyword.length<=200&&Object.keys(q).every(k=>["categoryId","keyword"].includes(k)))&&new Set(groups.map(q=>q.categoryId.trim())).size===groups.length&&Number(p.limit)>=groups.length;
}
export function defaultParameters(skill: SkillManifest): Record<string, unknown> { return Object.fromEntries(Object.entries(skill.parameterSchema).filter(([, value]) => value.default !== undefined).map(([key, value]) => [key, value.default])); }
export function marketTaskParameters(document:WorkflowDocument):Record<string,unknown>{
  return document.nodes.find(node=>node.definitionId==='product.start')?.binding.parameters??{};
}
export function effectiveNodeParameters(document:WorkflowDocument,node:NodeInstance):Record<string,unknown>{
  const task=marketTaskParameters(document);
  if(node.definitionId==='product.cost'&&document.nodes.some(n=>n.definitionId==='product.verify'))return task;
  return node.definitionId==='product.decide'&&node.binding.skillVersion==='2.0.0'&&task.marketEvidenceRef?
    {...node.binding.parameters,marketEvidenceRef:task.marketEvidenceRef,allowEstimatedSales:task.allowEstimatedSales??false}:node.binding.parameters;
}
/** Configuration preview, not executed ProductQuery data. Always read the current upstream task. */
export function productTaskParameters(document: WorkflowDocument, nodeId: string): Record<string, unknown> | null {
  const index = document.nodes.findIndex(node => node.id === nodeId);
  const upstream = document.nodes.slice(0, index).findLast(node => node.definitionId === "product.start");
  if (index < 0 || !upstream) return null;
  const p=intelligenceEnabled(document)?{...upstream.binding.parameters,categoryId:'',keyword:'',categoryQueries:document.nodes[0].binding.parameters.categoryQueries,emptyResultPolicy:'pause',candidateSource:'catalog'}:upstream.binding.parameters;
  return {market:p.market,categoryId:p.categoryId??"",keyword:p.keyword??"",...(p.categoryQueries!==undefined?{categoryQueries:p.categoryQueries}:{}),emptyResultPolicy:p.emptyResultPolicy??"pause",candidateSource:p.candidateSource??"catalog",limit:p.limit,requestedCurrency:p.requestedCurrency};
}
export function productCollectionTaskParameters(document: WorkflowDocument, collectionId: string): Record<string, unknown> | null {
  if (!document.nodes.some(node => node.id === collectionId && node.definitionId === "product.collect")) return null;
  return productTaskParameters(document, collectionId);
}
function environment(channel: Channel, fulfillment: Fulfillment, customChannels: SalesChannelDefinition[] = []): ExecutionEnvironment { return { channel, fulfillment, capabilities: [...(resolveChannel(channel, customChannels)?.capabilities ?? [])] }; }
export function forwardEdges(nodes: NodeInstance[]): WorkflowEdge[] { return nodes.slice(0, -1).map((node, index) => ({ id: `${node.id}:${nodes[index + 1].id}`, source: node.id, target: nodes[index + 1].id, kind: "forward" })); }
export function createWorkflow(templateId: string, channel: Channel = defaultChannelId, fulfillment?: Fulfillment, customChannels: SalesChannelDefinition[] = []): WorkflowDocument {
  const template = workflowTemplates.find(item => item.id === templateId);
  if (!template) throw new Error("未知业务模板");
  const responsibility = fulfillment ?? resolveChannel(channel, customChannels)?.defaultFulfillment ?? "merchant";
  const nodes = template.definitions.map((definitionId, index): NodeInstance => { const definition = getDefinition(definitionId)!; const skill = defaultSkillFor(definitionId, channel, responsibility); return { id: `step-${index + 1}`, definitionId, title: definition.title, binding: { skillId: skill?.id ?? "", skillVersion: skill?.version ?? "1.0.0", mode: "default", parameters: templateId==='launch'&&definitionId==='product.cost'?{}:skill ? defaultParameters(skill) : {} } }; });
  const relationPairs: Record<string, [string, string, WorkflowEdge["kind"]][]> = {
    launch: [["product.decide", "product.collect", "collaboration"], ["product.authorize", "product.decide", "feedback"], ["listing.authorize", "content.make", "feedback"]],
    campaign: [["campaign.creative", "campaign.start", "collaboration"], ["campaign.authorize", "campaign.creative", "feedback"]],
    optimize: [["insight.propose", "insight.check", "collaboration"], ["insight.authorize", "insight.propose", "feedback"]],
    support: [["support.propose", "support.context", "collaboration"], ["support.authorize", "support.propose", "feedback"]],
  };
  const relations = (relationPairs[templateId] ?? []).map(([from, to, kind]): WorkflowEdge => {
    const source = nodes.find(node => node.definitionId === from)!.id;
    const target = nodes.find(node => node.definitionId === to)!.id;
    return { id: `${kind}:${source}:${target}`, source, target, kind, label: kind === "feedback" ? "返回修订建议" : "协同核验证据", description: kind === "feedback" ? "携带修订原因返回；后续建议与审批重新确认。" : "向上游只读实现请求证据，不重新执行原节点。" };
  });
  return addIntelligenceNode(compactSelectionStages({ schemaVersion: "2", id: `workflow-${templateId}-${globalThis.crypto.randomUUID()}`, title: template.title, revision: 1, templateId, environment: environment(channel, responsibility, customChannels), nodes, edges: [...forwardEdges(nodes), ...relations], customSkills: [], customChannels: structuredClone(customChannels) }));
}
/** Explicit draft edit only; never called while restoring a saved document. */
export function addIntelligenceNode(document:WorkflowDocument):WorkflowDocument {
  if(document.templateId!=='launch'||document.nodes.some(n=>n.definitionId==='market.intelligence')||!document.selectionStrategy)return document;
  const node:NodeInstance={id:`market-${crypto.randomUUID()}`,definitionId:'market.intelligence',title:'采集市场类目排行',binding:{skillId:'market.intelligence.core',skillVersion:'1.0.0',mode:'default',parameters:{enabled:false}}};
  const nodes=[node,...document.nodes];
  return {...document,nodes,edges:[...forwardEdges(nodes),...document.edges.filter(e=>e.kind!=='forward')]};
}
export function intelligenceEnabled(document:WorkflowDocument){return document.nodes[0]?.definitionId==='market.intelligence'&&document.nodes[0].binding.parameters.enabled===true;}
/** Preserve graph and implementation choices; cross-channel account references require reselection. */
export function rebindChannel(document: WorkflowDocument, channel: Channel, fulfillment: Fulfillment): WorkflowDocument {
  const next=rebindChannelStages(withSelectionStages(document),channel,fulfillment);
  return document.selectionStrategy?compactSelectionStages(next):next;
}
function rebindChannelStages(document:WorkflowDocument,channel:Channel,fulfillment:Fulfillment):WorkflowDocument {
  const changed = document.environment.channel !== channel;
  return { ...document, revision: document.revision + 1, environment: { ...document.environment, ...environment(channel, fulfillment, document.customChannels), storeRef: changed ? undefined : document.environment.storeRef, storeIntegration: changed ? undefined : document.environment.storeIntegration }, nodes: document.nodes.map(node => {
    const binding = { ...node.binding };
    if (changed) {
      delete binding.connectionRef;
      if (node.definitionId === "listing.map") binding.parameters = {};
    }
    if (node.binding.mode === "custom") return { ...node, binding };
    const skill = defaultSkillFor(node.definitionId, channel, fulfillment);
    return { ...node, binding: { ...binding, skillId: skill?.id ?? "", skillVersion: skill?.version ?? "1.0.0" } };
  }) };
}

export function validateWorkflowPreview(document: WorkflowDocument): PreviewValidationResult {
  const original=document;
  document=withSelectionStages(document);
  const errors: PreviewIssue[] = []; const warnings: PreviewIssue[] = [];
  const fail = (code: string, message: string, nodeId?: string, edgeId?: string) => errors.push({ code, message, nodeId, edgeId });
  if(original.selectionStrategy&&!original.nodes.some(n=>n.definitionId==='product.decide')){
    const expected=forwardEdges(original.nodes),actual=original.edges.filter(e=>e.kind==='forward');
    if(actual.length!==expected.length||expected.some((e,i)=>actual[i]?.source!==e.source||actual[i]?.target!==e.target))fail('CONNECTIVITY','主路径存在断线，不能绕过统一核验。');
    if(new Set(original.edges.map(e=>e.id)).size!==original.edges.length)fail('DUPLICATE_EDGE','连线 ID 不可重复。');
    if(original.selectionStrategy.definitionId!=='product.decide'||original.nodes.some(n=>n.id===original.selectionStrategy!.id))fail('SELECTION_STRATEGY','任务策略标识无效。');
  }
  if (document.schemaVersion !== "2" || !Number.isInteger(document.revision) || document.revision < 1) fail("DOCUMENT_VERSION", "文档版本或修订号无效。");
  const { channel, fulfillment, capabilities } = document.environment;
  if (!validStoreIntegration(document.environment.storeIntegration, channel)) fail("STORE_INTEGRATION", "店铺接入声明无效，只允许当前渠道的草稿能力。 ");
  const channelErrors = validateCustomChannels(document.customChannels);
  channelErrors.forEach(message => fail("CHANNEL_REGISTRY", message));
  const customChannels = channelErrors.length ? [] : document.customChannels ?? [];
  const selectedChannel = resolveChannel(channel, customChannels);
  if (!selectedChannel || !selectedChannel.fulfillments.includes(fulfillment)) fail("ENVIRONMENT", "请选择已注册渠道及该渠道支持的履约责任。");
  if (capabilities.some(capability => !selectedChannel?.capabilities.includes(capability))) fail("ENVIRONMENT_CAPABILITY", "环境能力必须来自所选渠道的设计声明；不能通过修改文档取得真实权限。");
  if (selectedChannel?.adapterStatus === "draft") warnings.push({ code: "CHANNEL_DRAFT", message: "自定义渠道仅已登记设计范围；必须为渠道动作绑定兼容 Skill，登记不代表接口已接通。" });
  if (document.nodes.length < 2 || document.nodes.length > 40) fail("NODE_COUNT", "主路径需 2–40 个节点。");
  const ids = document.nodes.map(node => node.id);
  if (new Set(ids).size !== ids.length) fail("DUPLICATE_NODE", "节点 ID 不可重复。");
  if (new Set(document.edges.map(edge => edge.id)).size !== document.edges.length) fail("DUPLICATE_EDGE", "连线 ID 不可重复。");
  const customIds = document.customSkills.map(skill => skill.id);
  if (new Set(customIds).size !== customIds.length || customIds.some(id => skillManifests.some(skill => skill.id === id))) fail("SKILL_ID", "自建 Skill ID 不能重复或覆盖内置实现。");
  let context: string | undefined; const facts = new Set<string>();
  for (const [index, node] of document.nodes.entries()) {
    const definition = getDefinition(node.definitionId);
    if (!definition) { fail("DEFINITION", "未知节点职责。", node.id); continue; }
    const marketPrefix=document.nodes[0]?.definitionId==='market.intelligence';
    if (index === 0 && definition.kind !== "trigger" && definition.id!=='market.intelligence' || index === document.nodes.length - 1 && definition.kind !== "end" || index > 0 && definition.kind === "trigger" && !(marketPrefix&&index===1&&definition.id==='product.start') || index < document.nodes.length - 1 && definition.kind === "end") fail("BOUNDARY", "主路径只允许首个触发器（可前置行情）和末尾完成节点。", node.id);
    if (!definition.passthrough) { if (context && context !== definition.input) fail("CONTRACT", `上游 ${context} 与输入 ${definition.input} 不兼容。`, node.id); context = definition.output; }
    else if (!context) fail("CONTEXT", "附加节点需要已有上下文。", node.id);
    else if (definition.input !== "$context" && context !== definition.input) fail("CONTRACT", `透传步骤要求 ${definition.input}，当前为 ${context}。`, node.id);
    for (const fact of definition.requires) if (!facts.has(fact)) fail("PRECONDITION", `此动作缺少前置职责：${fact}。`, node.id);
    definition.provides.forEach(fact => facts.add(fact));
    const skill = getSkill(node.binding.skillId, document);
    if (node.definitionId === "listing.map") {
      const {mappingSessionRef: ref, mappingSessionRevision: revision} = node.binding.parameters;
      if ((ref !== undefined || revision !== undefined) && (typeof ref !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(ref) || !Number.isInteger(revision) || Number(revision) < 2)) fail("MAPPING_REFERENCE", "映射记录需为有效会话与已分析的修订号。", node.id);
      if(node.binding.parameters.mappingMode==='installed'){
        const p=node.binding.parameters,publish=document.nodes[index+1],env=document.environment;
        if(!p.mappingPlanRef||!p.mappingPlanVersion||!p.mappingStoreRef||!Number.isInteger(p.mappingStoreVersion)||Number(p.mappingStoreVersion)<1||p.mappingStoreRef!==env.storeRef||p.mappingPlanVersion!==env.storeIntegration?.version||env.storeIntegration?.channel!==env.channel)fail('MAPPING_PLAN','映射方案与店铺未配置或已变更，请重新保存准备节点。',node.id);
        const publishingManifest=document.customSkills.find(m=>m.id===`installed.${p.mappingPlanRef}.listing.publish`);
        if(publish?.definitionId==='listing.publish'&&(!publishingManifest||publishingManifest.entrypointRef!==`installed://${p.mappingPlanRef}/listing.publish@${publishingManifest.version}`||publish.binding.skillId!==publishingManifest.id||publish.binding.skillVersion!==publishingManifest.version||publish.binding.connectionRef&&publish.binding.connectionRef!==p.mappingStoreRef))fail('PUBLISH_INHERITANCE','发布必须继承准备节点的店铺与适配包中的节点实现版本，不能单独覆盖。',publish.id);
      }
      warnings.push({code:"MAPPING_DRAFT",message:"画布准备步骤仅为设计与状态模拟，不执行真实字段转换；分析草案未验收不能用于真实发布。",nodeId:node.id});
    }
    if (document.environment.storeIntegration && isStoreAction(node.definitionId) && !node.binding.connectionRef && !resolveNodeConnection(node, document.environment).reference) fail("STORE_ACTION", "店铺接入未声明此能力或尚未填写连接引用，请在店铺接入中补齐。", node.id);
    if (node.definitionId === "product.collect" && !productCollectionTaskParameters(document, node.id)) fail("COLLECTION_TASK", "CJ 采集需要上游定义商品任务，不接受独立设置采集条件。", node.id);
    if(node.definitionId==="product.start"){
      const p=node.binding.parameters;
      if(p.category)fail("LEGACY_CATEGORY","旧类目名称不能作为 CJ 类目 ID，请在任务设置中重新选择。",node.id);
      if(typeof p.keyword==="string"&&p.keyword.length>200)fail("SEARCH_QUERY","关键词最多 200 个字符。",node.id);
      if(p.categoryQueries!==undefined && !validCategoryQueries(p))fail("SEARCH_QUERY","类目最多十个、不可重复，关键词最多 200 字；总数量不能少于类目数，不能混用旧类目或全局关键词。",node.id);
      if(p.emptyResultPolicy==="drop_keyword_once"&&!String(p.keyword??"").trim()&&!categoryQueriesFor(p).some(q=>q.keyword.trim()))fail("SEARCH_QUERY","填写关键词后才能选择去掉关键词重试。",node.id);
      if(typeof p.limit==="number"&&!Number.isInteger(p.limit))fail("SEARCH_QUERY","候选商品数量必须是整数。",node.id);
      warnings.push({code:"CJ_CATEGORY_RUNTIME",message:"具体类目的有效性须在服务端依据 CJ 目录重新确认；前端预检不证明类目仍可用。",nodeId:node.id});
    }
    if(node.definitionId==='market.intelligence'){
      const p=node.binding.parameters;
      if(index!==0||document.templateId!=='launch')fail('INTELLIGENCE_POSITION','行情只能作为选品到上线的首节点。',node.id);
      if(p.enabled===true&&(!p.categoryPlanRef||!Array.isArray(p.categoryQueries)||!p.categoryQueries.length||!validCategoryQueries({categoryQueries:p.categoryQueries,limit:marketTaskParameters(document).limit})))fail('INTELLIGENCE_PLAN','请确认行情方向的供货类目方案；目标数量不能小于不同供货类目数。',node.id);
    }
    if (!skill) { fail("SKILL", "请选择已注册的兼容实现。", node.id); continue; }
    if (getNodeOperatorPolicy(definition.id).mode !== "skill" && !isChannelAdapter(definition.id) && skill.id !== `${definition.id}.core`) fail("FIXED_IMPLEMENTATION", "系统固定步骤不能替换为自建策略；仅允许调整开放的业务参数。", node.id);
    if (!skill.entrypointRef || !["script", "connector", "llm", "media", "composite", "manual"].includes(skill.runtime)) fail("MANIFEST", "Skill 必须声明运行方式和入口引用。", node.id);
    if (skill.version !== node.binding.skillVersion) fail("SKILL_VERSION", "绑定版本与 Skill 版本不一致。", node.id);
    if (skill.input !== definition.input || skill.output !== definition.output) fail("SKILL_CONTRACT", "Skill 输入输出版本必须匹配节点契约。", node.id);
    if (!skill.channels.length || skill.channels.some(id => id !== "*" && !resolveChannel(id, customChannels))) fail("MANIFEST_CHANNEL", "Skill 适用渠道需为已注册 ID，通用实现可使用 *。", node.id);
    if (!skillSupportsChannel(skill, channel) || skill.fulfillments && !skill.fulfillments.includes(fulfillment)) fail("SKILL_ENVIRONMENT", "此实现不支持当前渠道或履约模式；自选实现不会被静默替换。", node.id);
    if (skill.effects.some(effect => !definition.allowedEffects.includes(effect))) fail("EFFECT", "实现声明的副作用超出此节点允许范围。", node.id);
    if (skill.capabilities.some(capability => !capabilities.includes(capability))) fail("CAPABILITY", "环境未声明实现所需能力。", node.id);
    const policy = node.binding.execution;
    if (policy && (!Number.isFinite(policy.timeoutSeconds) || policy.timeoutSeconds < 1 || policy.timeoutSeconds > 600 || !Number.isInteger(policy.maxRetries) || policy.maxRetries < 0 || policy.maxRetries > 3 || !["safe", "never"].includes(policy.retryMode) || policy.retryMode === "never" && policy.maxRetries !== 0)) fail("EXECUTION_POLICY", "执行策略需使用 1–600 秒超时和 0–3 次重试；禁用重试时次数必须为 0。", node.id);
    if (fulfillment === "platform" && definition.id.startsWith("order.") && skill.effects.some(effect => effect !== "read")) fail("PLATFORM_FULFILLMENT", "平台负责履约的消费订单只能观察平台状态，不允许商家采购、出库或重复通知。", node.id);
    const effective=effectiveNodeParameters(document,node),task=marketTaskParameters(document);
    if(node.definitionId==='product.decide'&&task.marketEvidenceRef){
      if(node.binding.parameters.marketEvidenceRef&&node.binding.parameters.marketEvidenceRef!==task.marketEvidenceRef||node.binding.parameters.allowEstimatedSales!==undefined&&node.binding.parameters.allowEstimatedSales!==(task.allowEstimatedSales??false))fail('MARKET_CONFLICT','任务与评估节点的市场证据设置冲突，请重新选择策略继承任务。',node.id);
    }
    for (const [name, parameter] of Object.entries(skill.parameterSchema)) { const value = effective[name]; if (value === undefined) { if (parameter.required) fail("PARAMETER", `缺少参数 ${parameter.label}。`, node.id); continue; } if ((parameter.type === "array" ? !Array.isArray(value) : typeof value !== parameter.type) || parameter.enum && !parameter.enum.includes(value as never) || typeof value === "number" && (!Number.isFinite(value) || parameter.minimum !== undefined && value < parameter.minimum || parameter.maximum !== undefined && value > parameter.maximum)) fail("PARAMETER", `参数 ${parameter.label} 不符合声明。`, node.id); }
    for (const name of Object.keys(node.binding.parameters)) if (!skill.parameterSchema[name]) fail("UNKNOWN_PARAMETER", `实现未声明参数 ${name}。`, node.id);
    if (document.customSkills.some(item => item.id === skill.id)) warnings.push({ code: "CUSTOM_SKILL", message: skill.id.startsWith("registered.") ? "这是后端版本的设计快照；本地预检不证明当前审核状态或完整流程可执行，服务端运行时须重新核验。" : "自建清单仅供设计，尚未由后端审查、注册或执行。", nodeId: node.id });
  }
  const expected = forwardEdges(document.nodes);
  for (const edge of document.edges) {
    const source = document.nodes.find(node => node.id === edge.source); const target = document.nodes.find(node => node.id === edge.target);
    if (!source || !target || source.id === target.id) { fail("EDGE_TARGET", "连线目标缺失或连接自身。", undefined, edge.id); continue; }
    const a = getDefinition(source.definitionId); const b = getDefinition(target.definitionId);
    if (edge.kind === "forward") { if (!expected.some(item => item.source === edge.source && item.target === edge.target)) fail("FORWARD_PATH", "初版仅支持按节点顺序连接的单主路径。", undefined, edge.id); }
    else if (edge.kind === "collaboration") { const peer = getSkill(target.binding.skillId, document); if (!a || !b || !peer || peer.effects.some(effect => effect !== "read") || ids.indexOf(source.id) <= ids.indexOf(target.id)) fail("COLLABORATION", "协作参与方必须是上游只读证据实现。", undefined, edge.id); }
    else if (edge.kind === "feedback") { const start = ids.indexOf(target.id); const end = ids.indexOf(source.id); const segment = document.nodes.slice(start, end); if (!a || !["approval", "wait"].includes(a.kind) || start >= end || segment.some(item => getSkill(item.binding.skillId, document)?.effects.some(effect => ["remote_write", "spend", "message"].includes(effect)))) fail("FEEDBACK", "返工需从等待/确认节点回到上游，不能重放写入、付款或通知。", undefined, edge.id); }
    else fail("EDGE_KIND", "未知关系类型。", undefined, edge.id);
  }
  if (document.edges.filter(edge => edge.kind === "forward").length !== expected.length || expected.some(item => !document.edges.some(edge => edge.kind === "forward" && edge.source === item.source && edge.target === item.target))) fail("CONNECTIVITY", "主路径存在断线或重复连接。");
  warnings.push({ code: "PREVIEW_ONLY", message: "仅前端设计预检；不调用 Pydantic、不运行 Skill、不验证真实平台授权或业务事实。" });
  return { valid: errors.length === 0, engine: "frontend-preview", source: "frontend-preview", revision: document.revision, errors, warnings };
}

export function toWorkflowPreview(document: WorkflowDocument): Workflow {
  const template = workflowTemplates.find(item => item.id === document.templateId);
  let context = "TriggerContext@1";
  const finalNode = document.nodes.at(-1);
  const finalOutcome = getNodeOperatorPolicy((finalNode?.definitionId === "flow.end" ? document.nodes.at(-2) : finalNode)?.definitionId ?? "").result;
  return {
    id: document.id, number: "DESIGN", title: document.title,
    subtitle: `${resolveChannel(document.environment.channel, document.customChannels)?.name ?? document.environment.channel} · 运营业务流程`, trigger: template?.trigger ?? "自定义触发",
    cadence: template?.cadence ?? "按需启动", scope: "本地模拟，不执行真实业务", result: `${finalOutcome}（模拟）`,
    note: "系统步骤守住检查与授权边界；运营可调整开放参数和策略。发光仅演示处理状态，不执行真实业务。",
    nodes: document.nodes.map(node => {
      const definition = getDefinition(node.definitionId);
      if (!definition) throw new Error("请先修复未知节点");
      const input = definition.passthrough ? context : definition.input;
      const output = node.definitionId==='product.verify'&&document.selectionStrategy?'SelectionAssessment@1':definition.passthrough ? context : definition.output;
      context = output;
      const skill = getSkill(node.binding.skillId, document);
      return {
        id: node.id, title: document.environment.fulfillment === "platform" && node.title === definition.title ? ({ "order.dispatch": "观察平台履约", "order.record": "记录平台通知状态", "order.authorize": "确认观察范围", "order.wait": "等待平台出库状态" } as Record<string, string>)[definition.id] ?? node.title : node.title, kind: definition.kind,
        description: definition.id==='market.intelligence'?(node.binding.parameters.enabled===true?'已启用 · 两榜各前十 → 已确认的 CJ 供货类目':'未启用 · 跳过网页采集，沿用商品任务搜索词'):definition.id==='product.start'&&intelligenceEnabled(document)?'方向继承行情首节点；只配置数量、库存、配送、费用与选品策略。':definition.kind==="approval"&&node.binding.parameters.approvalEnabled===false?"跳过人工审核 · 系统检查仍保留":getNodeOperatorPolicy(definition.id).description, input, output,
        approvalEnabled: definition.kind==="approval"?node.binding.parameters.approvalEnabled!==false:undefined,
        operatorPolicy: getNodeOperatorPolicy(definition.id),
        steps: [...definition.steps, `实现：${skill?.name ?? "未绑定"}；入口只作引用，不会执行`],
        event: definition.event, passthrough: definition.passthrough, skill: skill?.id,
        implementation: skill ? { name: skill.name, runtime: skill.runtime, version: skill.version, entrypointRef: skill.entrypointRef } : undefined,
        implementationMissing: !skill,
        next: document.edges.find(edge => edge.kind === "forward" && edge.source === node.id)?.target,
      };
    }),
    relations: document.edges.filter(edge => edge.kind !== "forward").map(edge => ({ ...edge, kind: edge.kind as "feedback" | "collaboration", label: edge.label ?? (edge.kind === "feedback" ? "返回修订" : "证据协作"), description: edge.description ?? "设计关系，仅供前端模拟。" })),
  };
}

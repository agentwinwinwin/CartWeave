export type NodeKind = "trigger" | "action" | "rule" | "ai" | "wait" | "approval" | "end";
export type WorkflowNode = {
  id: string; title: string; description: string; kind: NodeKind;
  input: string; output: string; steps: string[];
  next?: string; alternate?: { label: string; result: string };
  skill?: string; event?: string; passthrough?: boolean;
  implementation?: { name: string; runtime: string; version: string; entrypointRef: string };
  implementationMissing?: boolean;
  approvalEnabled?: boolean;
  operatorPolicy?: import("@/lib/workflow/operator-policy").NodeOperatorPolicy;
};
export type Workflow = {
  id: string; number: string; title: string; subtitle: string; trigger: string;
  cadence: "按需启动" | "事件驱动" | "定时运行"; scope: string; result: string;
  note: string; handoff?: { workflow: string; label: string }; nodes: WorkflowNode[]; relations?: WorkflowRelation[];
  forwardEdges?: {id:string;source:string;target:string;kind:"forward"}[];
};
export type WorkflowRelation = {
  id: string; source: string; target: string; kind: "feedback" | "collaboration";
  label: string; description: string;
};
// Feedback carries revision context; it does not repeat irreversible downstream actions.
export const workflowRelations: Record<string, WorkflowRelation[]> = {
  launch: [
    {id:"research-evidence",source:"research",target:"catalog",kind:"collaboration",label:"选品 × 商品证据",description:"选品 Skill 与商品数据节点共同补充证据、校核供应信息；结果确认后才进入定价审批。"},
    {id:"revise-listing",source:"publish",target:"content",kind:"feedback",label:"返回修订商详",description:"仅在发布前审核发现商详或素材问题时返工；更新原商品草稿，重新审核。严重商品事实问题应暂停上市另开复核任务。"},
  ],
  campaign: [
    {id:"creative-strategy",source:"creative",target:"brief",kind:"collaboration",label:"创意 × 推广策略",description:"创意节点与策略节点协同校核受众、文案和素材需求，不启动广告或修改实际预算。"},
    {id:"revise-creative",source:"review",target:"creative",kind:"feedback",label:"素材拒审，返回修改",description:"仅素材拒审进入返工；修订既有暂停广告，保留计划和广告 ID，再次确认素材及预算后重新提交。账户故障仍进入人工修复。"},
  ],
  optimize: [
    {id:"analysis-evidence",source:"analysis",target:"sample",kind:"collaboration",label:"经营分析 × 数据核验",description:"分析节点向数据节点请求补充证据，双方共同核验归因窗口与样本，确认后输出调整建议。"},
    {id:"revise-proposal",source:"guard",target:"analysis",kind:"feedback",label:"返回修订建议",description:"授权范围不匹配时返回分析重新提出建议，不执行账户变更。"},
  ],
  support: [
    {id:"support-evidence",source:"resolve",target:"context",kind:"collaboration",label:"售后建议 × 订单证据",description:"售后 Skill 与订单证据节点共同核对物流与政策；此阶段仅整理建议，不执行退款。"},
    {id:"revise-resolution",source:"authorize",target:"resolve",kind:"feedback",label:"返回补充方案",description:"审批要求补充时返回方案节点，后续动作必须重新获得授权。"},
  ],
};
export type SkillDefinition = { id: string; name: string; version: string; input: string; output: string; tools: string; prompt: string };
export const skills: SkillDefinition[] = [
  {id:"product-research",name:"商品机会研究",version:"1.0",input:"CandidateBrief",output:"ProductDecision",tools:"商品目录 · 成本计算 · 市场证据（只读）",prompt:"基于可追溯的市场证据评估候选商品。区分事实与假设，输出机会、风险、理由和置信度。缺少证据时返回待复核，不编造销量。"},
  {id:"product-research-conservative",name:"商品机会研究 · 稳健策略",version:"1.0",input:"CandidateBrief",output:"ProductDecision",tools:"商品目录 · 成本计算（只读）",prompt:"优先考虑供应稳定、可验证毛利和低售后风险。证据不足或合规存疑时建议暂缓，保留人工决策。"},
  {id:"listing-content",name:"商品本地化内容",version:"1.0",input:"ApprovedProductBrief",output:"ListingContent",tools:"品牌资料 · 商品事实 · 图片服务",prompt:"仅基于已核实商品事实生成本地化标题、卖点、详情及图片制作需求。图片由图片工具生成，禁止捏造认证或功能。"},
  {id:"campaign-creative",name:"广告创意与素材",version:"1.0",input:"CampaignBrief",output:"CreativePack",tools:"品牌资料 · 图片服务 · 素材库",prompt:"按市场与投放目标生成广告角度、文案和宣传图制作指令；搜索渠道生成关键词建议，社交渠道生成创意变体。图片工具返回素材后再校验，不能把提示词当成图片。"},
  {id:"campaign-analysis",name:"投放复盘与建议",version:"1.0",input:"CampaignSnapshot",output:"OptimizationProposal",tools:"广告报表 · 利润报表（只读）",prompt:"考虑归因延迟、样本量、退货和履约成本，解释表现变化并提出维持、暂停或小幅调整建议。不得直接修改预算。"},
  {id:"support-resolution",name:"售后理解与处理建议",version:"1.0",input:"SupportContext",output:"SupportProposal",tools:"订单 · 物流 · 售后政策（只读）",prompt:"根据订单、物流证据和商家政策理解诉求，生成答复与处理建议。退款、补发或争议必须交给授权规则及人工复核。"},
];
const n=(id:string,title:string,kind:NodeKind,description:string,input:string,output:string,steps:string[],extra:Partial<WorkflowNode>={}):WorkflowNode=>({id,title,kind,description,input,output,steps,...extra});
const sequence=(nodes:WorkflowNode[])=>nodes.map((node,i)=>({...node,next:nodes[i+1]?.id}));
export const workflows: Workflow[] = [
  {id:"launch",number:"01",title:"新品从发现到上线",subtitle:"一次选品任务，交付一个真正可售的商品。",trigger:"手动创建选品任务",cadence:"按需启动",scope:"一批候选商品 → 单商品任务",result:"可售商品 + 推广交接事件",note:"没有新品需求时可以长期不运行。不会影响已有商品的广告、订单或售后。",handoff:{workflow:"campaign",label:"商品上线后，可选择启动推广"},nodes:sequence([
    n("brief","定义选品任务","trigger","设置市场、类目、利润目标和供应要求。","MerchantBrief","SearchPolicy",["选择目标国家、类目与商品数量","连接 CJ 商品源；凭证在连接器管理","配置毛利目标与物流时效"]),
    n("catalog","拉取商品与事实校验","action","CJ 数据映射为内部契约，先过滤不可售商品。","SearchPolicy","CandidateBrief",["拉取商品、变体、仓库库存与物流报价","Pydantic 校验并规范化供应商字段","按成本、运费、禁售与库存规则过滤"],{alternate:{label:"无合格候选",result:"记录原因并结束本次选品任务"}}),
    n("research","研究选品机会","ai","结合市场证据评估机会，输出可解释的建议。","CandidateBrief","ProductDecision",["读取已核实的商品与市场证据","分析差异化、竞争和售后风险","返回理由、置信度及待核实事项"],{skill:"product-research"}),
    n("approve","确认商品与定价","approval","确认供应样品、利润及风险，再决定是否上市。","ProductDecision","ApprovedProductBrief",["检查选品证据与样品验证结果","按规则计算售价、费用与预计贡献利润","确认品牌权利与目标市场可售性"],{alternate:{label:"暂缓 / 不通过",result:"归档候选，停止该商品上市，不生成投放任务"}}),
    n("content","制作商品内容","ai","产出本地化详情、卖点及经过核验的商品图片。","ApprovedProductBrief","ListingContent",["生成标题、详情、SEO 与本地化卖点","调用图片服务制作素材并审核事实一致性","按 ListingContent 契约校验输出"],{skill:"listing-content"}),
    n("draft","建立草稿与供应映射","action","写入 Shopify 草稿，绑定每个变体的 CJ SKU。","ListingContent","MappedProductDraft",["首次创建草稿；返工按原商品 ID 更新价格、变体与媒体","映射 Shopify variant 与 CJ VID/SKU","检查库存同步、运费模板、目的国与履约配置"],{alternate:{label:"映射 / 检查失败",result:"保留草稿并进入修复任务，禁止发布"}}),
    n("publish","审核并发布商品","approval","检查商详、素材和可售条件后发布销售渠道。","MappedProductDraft","PublishedProduct",["预览商品详情、价格与图片","再次核验库存、物流与店铺设置","确认后激活商品并发布指定渠道"],{alternate:{label:"拒绝发布",result:"保留草稿，记录修改意见"}}),
    n("handoff","交付上线结果","end","记录上市结果；按策略选择自然销售或新建推广任务。","PublishedProduct","ProductLaunched",["本次新品工作流结束","自然销售：无需开启广告","付费推广：显式交接商品与目标给推广工作流"]),
  ])},
  {id:"campaign",number:"02",title:"商品推广与首次投放",subtitle:"让已上线的商品，带着目标和预算进入市场。",trigger:"手动推广 / 上线后的推广策略",cadence:"按需启动",scope:"一个可售商品 × 一个推广计划",result:"已启动的广告计划",note:"上架不等于必须投广告。可独立选择已有商品推广；创意通过后才会创建并启动计划。",handoff:{workflow:"optimize",label:"启动成功的计划进入定时复盘"},nodes:sequence([
    n("target","选定商品与推广目标","trigger","选择在售商品、渠道、受众与本次试投目标。","PublishedProduct","PromotionRequest",["校验商品仍在售且可履约","选择搜索广告或社交广告渠道","设置目标市场、受众与转化目标"]),
    n("brief","制定预算与测试策略","rule","确认利润空间、素材需求和可承受试投成本。","PromotionRequest","CampaignBrief",["核验追踪、落地页与广告账户连接","设置本次总预算、日上限与停止条件","为不同渠道准备关键词或创意测试变量"],{alternate:{label:"条件不满足",result:"停止投放准备并列出缺失配置"}}),
    n("creative","生成文案与宣传素材","ai","按渠道制作广告文案、创意变体和宣传图。","CampaignBrief","CreativePack",["LLM 生成创意角度、文案或关键词","图片工具制作宣传图，绑定实际媒体文件","检查素材、商品事实与落地页一致性"],{skill:"campaign-creative"}),
    n("approval","确认素材与花费","approval","预览素材和预算，明确批准本次投放范围。","CreativePack","ApprovedCampaign",["核对品牌、素材权利与渠道要求","确认预算、渠道、受众和启动时间","保留批准人、版本与批准金额"],{alternate:{label:"不批准",result:"保留素材草稿，本次不启动广告"}}),
    n("review","创建草稿并等待审核","wait","提交暂停状态的计划，等待渠道返回审核结果。","ApprovedCampaign","ReviewedCampaign",["首次以幂等键创建暂停草稿；素材返工更新原计划和广告 ID，不重复建计划","等待广告平台审核事件 / 定时查询","拒审或超时进入人工修复，不自动激活"],{event:"广告审核通过",alternate:{label:"拒审 / 超时",result:"保持暂停，通知修改素材或账户配置"}}),
    n("activate","启动并登记复盘","action","审核通过后启用计划，交给独立的定时优化任务。","ReviewedCampaign","CampaignActivated",["激活计划并记录渠道 ID 与实际预算","将计划加入复盘监控范围","完成本次推广任务，不重新执行选品"]),
  ])},
  {id:"fulfillment",number:"03",title:"收款到交付",subtitle:"每一笔已支付订单，都有独立、可恢复的履约链。",trigger:"Shopify · 订单付款成功",cadence:"事件驱动",scope:"一笔订单 → 按供应商 / 包裹拆分",result:"履约记录与客户通知",note:"客户付给店铺、店铺付给 CJ 是两笔交易。CJ 扣款成功也不等于已发货，必须等待真实出库事件。",nodes:sequence([
    n("paid","接收付款成功订单","trigger","订单付清后开启履约，重复事件只处理一次。","orders/paid","PaidOrder",["验证 Webhook 签名并持久化事件","按店铺、订单和事件 ID 去重","更新订单；订单确认邮件由 Shopify 负责，不重复发送"]),
    n("check","风控与履约校验","rule","检查取消、风险、收件信息、SKU 与履约责任。","PaidOrder","FulfillmentPlan",["检查已付清、未取消且尚未履约","等待风险分析并核验地址与供应映射","按包裹 / 仓库生成履约计划"],{alternate:{label:"高风险 / 信息缺失",result:"挂起该订单，补全或人工复核后重新校验"}}),
    n("quote","核实库存与采购成本","action","重新查询库存和运费，记录当前履约报价。","FulfillmentPlan","FulfillmentQuote",["按 SKU / 仓库查询可用库存与物流线路；查询不代表预留库存","合计采购、运费、税费及成本偏差","记录报价时间，支付前重新校验；查询不代表锁价"],{alternate:{label:"缺货 / 无物流",result:"进入缺货处理，通知人工替代或取消，暂停采购"}}),
    n("purchase","授权采购并支付 CJ","approval","在商家批准的额度内采购；异常金额先人工确认。","FulfillmentQuote","SupplierOrder",["校验订单仍有效、报价有效和钱包余额","按商家授权策略执行采购及付款","使用业务唯一键；扣款超时先查询，禁止盲目重付"],{alternate:{label:"拒绝 / 余额不足",result:"保持待采购，不标记已发货，也不继续物流链"}}),
    n("dispatch","等待供应商出库","wait","保存进度，等待 CJ 真实发货与包裹信息。","SupplierOrder","ShipmentDispatched",["按 CJ 订单与包裹 ID 关联通知或查询结果","等待有效运单、承运商及出库状态","超时升级供应商异常工单"],{event:"CJ 已出库 + 有效运单",alternate:{label:"超时 / 取消",result:"建立异常工单，核对退款或补发，不重复采购"}}),
    n("notify","回写履约并通知客户","action","按实际包裹更新 Shopify，由唯一渠道发送发货邮件。","ShipmentDispatched","CustomerShipment",["按 fulfillment order 的实际商品数量回写","只通知本次包裹，兼容部分发货","使用通知去重键；由 Shopify 发送发货确认"]),
    n("delivery","等待签收或物流异常","wait","运输期间保留订单状态，异常立即转交售后。","CustomerShipment","DeliveryOutcome",["逐包裹处理物流更新，容忍乱序通知","未齐套不将整单标为交付完成","异常进入售后处理；签收后继续"],{event:"所有待交付包裹已签收",alternate:{label:"丢件 / 退回 / 超时",result:"保留未完成履约并创建售后工单"}}),
    n("close","记录交付结果","end","结束本次履约；交易关怀与营销订阅分开处理。","DeliveryOutcome","DeliveredOrder",["记录包裹签收与履约完成时间","按策略发送一次交易关怀通知","复购营销仅交给已获许可的独立营销任务"]),
  ])},
  {id:"optimize",number:"04",title:"在售商品与投放复盘",subtitle:"持续看利润与库存，每次只做一次有边界的调整。",trigger:"定时检查 / 库存价格变化",cadence:"定时运行",scope:"一个在售商品及其关联广告",result:"维持、暂停或受控调整",note:"供应风险先处理，不必等待 LLM。广告表现要考虑样本量和归因延迟，不因一次低 ROAS 就立即停投。",nodes:sequence([
    n("tick","读取经营快照","trigger","按策略读取商品、库存、履约成本及广告表现。","ScheduleTick","CommerceSnapshot",["只扫描在售商品和已启动的计划","按统一币种、时间窗口对齐快照","记录广告归因窗口及数据新鲜度"]),
    n("supply","检查供应与可售状态","rule","缺货或不可履约时，优先停止继续引流。","CommerceSnapshot","SellableSnapshot",["确认库存、价格、运费和目的国时效","风险触发立即暂停关联广告和可售状态更新","暂停后的恢复需重新核验，不自动清零异常"],{alternate:{label:"不可售",result:"暂停关联广告、更新可售状态并创建供应异常任务"}}),
    n("sample","检查样本与冷却期","rule","确认数据足够支持一次调整，防止高频反复改预算。","SellableSnapshot","CampaignSnapshot",["检查最低花费、观察时长和归因延迟","过滤近期已调整、仍在冷却期的计划","计算扣除履约与退款后的利润指标"],{alternate:{label:"样本不足",result:"维持现状，结束本次检查并等待下一周期"}}),
    n("analysis","分析表现与建议","ai","解释变化，建议维持、调整或新建素材测试。","CampaignSnapshot","OptimizationProposal",["区分素材疲劳、供应、价格与归因问题","输出证据与建议，不直接修改广告账户","新素材需求可交接推广流程"],{skill:"campaign-analysis"}),
    n("guard","确认策略边界","approval","小幅调整按授权规则，大幅变更需要人工确认。","OptimizationProposal","ApprovedOptimization",["检查商家额度、单次变化幅度与冷却期","预算提升和策略变化按权限审批","确认本轮受影响的具体计划 ID"],{alternate:{label:"不批准",result:"保留建议，维持当前计划"}}),
    n("apply","执行并写回复盘","action","幂等应用批准的变化，记录结果并结束本轮。","ApprovedOptimization","OptimizationResult",["更新或暂停指定广告，记录前后值","核对渠道返回状态；失败进入修复队列","下次由调度器重新触发，不在画布无限循环"]),
  ])},
  {id:"support",number:"05",title:"售后问题到解决",subtitle:"客户消息或物流异常，沿同一工单推进到解决。",trigger:"客户咨询 / 物流异常 / 退款申请",cadence:"事件驱动",scope:"一个工单及关联订单",result:"答复、退款或补发处理结果",note:"普通查询可以自动答复。退款、补发和争议按证据与权限处理，不让模型直接操作资金。",nodes:sequence([
    n("case","接收与合并工单","trigger","按订单聚合客户消息和物流异常，避免重复处理。","SupportEvent","SupportTicket",["识别客户身份与关联订单","合并同一问题的重复请求","取消订单事件同步挂起未完成采购"]),
    n("context","补全订单与物流证据","action","读取支付、包裹、历史沟通与售后政策。","SupportTicket","SupportContext",["按最小权限获取订单与物流","确认是否已退款、补发或进入争议","记录政策版本与时间线"]),
    n("resolve","理解诉求并拟定方案","ai","生成可解释的答复草稿及处理建议。","SupportContext","SupportProposal",["分类查询、退货、丢件、取消和争议","依据真实证据编写答复","缺少证据先追问，不能编造物流承诺"],{skill:"support-resolution"}),
    n("authorize","确认处理权限","approval","常规答复可按规则放行，资金动作由授权审批。","SupportProposal","ApprovedResolution",["区分信息答复、退款与补发权限","核对退款上限、退货状态与已退款金额","有争议或证据不足时升级人工"],{alternate:{label:"不批准",result:"转人工继续处理，工单保持打开"}}),
    n("execute","执行方案并等待结果","wait","执行批准动作，等待退款或补发的确切结果。","ApprovedResolution","ResolutionResult",["信息答复由指定渠道发送一次","退款通过支付渠道执行；补发复用受控履约","超时先查询状态，不能重复退款或下单"],{event:"处理动作已确认成功",alternate:{label:"失败 / 未确认",result:"保留工单，查询原操作并升级处理"}}),
    n("done","通知并关闭工单","end","退款或补发通知一次；已送达的信息答复仅归档。","ResolutionResult","ClosedTicket",["退款或补发发送一次确认结果，已送达的信息答复不重复发送","记录动作、操作人、原因与凭证","客户再次反馈时可重新打开工单"]),
  ])},
];
export const kindLabels: Record<NodeKind,string> = {trigger:"触发事件",action:"自动执行",rule:"规则判断",ai:"AI · Skill",wait:"等待事件",approval:"确认与授权",end:"完成与交接"};

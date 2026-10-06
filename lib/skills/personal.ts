/** Planning metadata only. Never executed or treated as an approved manifest. */
import type {SkillManifest} from "@/lib/workflow/universal";
export const skillKinds = {
  selection: {name:"选品策略",icon:"◇",description:"基于供货、配送和费用证据排序与建议售价；不将未知销量当成预测。"},
  development: {name:"开发接入",icon:"⌘",description:"首次接入或升级时生成接口与脚本，不参与每次商品发布。"},
  adapter: {name:"接口执行",icon:"↗",description:"复用已制作的脚本，一个能力包支持检查、发布和结果查询。"},
  content: {name:"内容制作",icon:"✦",description:"按需生成产品图和文案；无需生成时保留原素材。"},
} as const;
export type SkillKind=keyof typeof skillKinds;
export type SkillDraft={id:string;name:string;kind:SkillKind;purpose:string;actions:string;input:string;output:string;parameters:string;updatedAt:string};
export type RegisteredSkill={id:string;key:string;version:string;handler:string;artifact_hash:string;status:"pending"|"approved"|"revoked";review_note:string;reviewed_at:string|null;manifest?:SkillManifest|null;selectable?:boolean;unavailable_reason?:string;execution_scope?:string};
/** Public development rules, not approved runtime manifests. */
export const integrationRules = [
  {id:"commerceos-store-integration",title:"生成独立站 API",role:"接口开发规则",description:"交给站点的编程 AI，先检查已有接口，再增量补齐接入层。",configure:"development"},
  {id:"commerceos-publishing-adapter",title:"接口字段映射",role:"系统映射规则",description:"在工作流映射节点选择模型，分析实际 API 与系统固定字段。",configure:"mapping"},
] as const;
export function registeredSkillKind(skill:RegisteredSkill):SkillKind|null {
  if(["product.opportunity.v1","product.opportunity.v2","product.opportunity.v3","product.opportunity.v4","product.opportunity.v5"].includes(skill.handler))return "selection";
  if(skill.handler==="content.editorial.v1")return "content";
  const pair=`${skill.manifest?.input} → ${skill.manifest?.output}`;
  if(["ApprovedListing@1 → PublicationReceipt@1","PreparedChannelPublication@1 → PublicationReceipt@1","ListingDraft@1 → ValidatedListing@1","PublicationReceipt@1 → PublishedProduct@1"].includes(pair))return "adapter";
  return null; // Unknown handlers must not be advertised as content generators.
}
export const draftKey="commerceos.personal-skill-drafts.v1";
export function publishingDraft(kind:"development"|"adapter",channel:string,createApi:boolean,actions?:string[]):SkillDraft {
  return {id:crypto.randomUUID(),kind,name:`${channel} · ${kind==="development"?"生成独立站 API":"制作店铺适配包"}`.slice(0,80),
    purpose:kind==="development"?"先检查独立站已有接口与服务，按所选动作给出最小改动方案；与用户确认双向字段映射和缺口后，增量开发接入层及适配包，保留原业务。":`依据${createApi?"独立站实际 API":"已有官方或独立站 API"}与 CommerceOS 固定契约完成双向映射；缺失字段与语义差异先沟通。制作可复用的版本化多动作包，不按商品或节点反复生成代码。`,
    actions:actions?.join("、")??"listing.validate、listing.publish、listing.wait、publication.lookup、listing.unpublish、listing.status、orders.read、customers.read、finance.read",
    input:kind==="development"?"独立站工程、后端导出的 store-api-contracts.json、已有模型/服务/鉴权及脱敏接口样例。contracts.json 仅是设计草案。":"后端导出的 store-api-contracts.json、目标实际接口文档、脱敏响应与连接引用（不含密钥）；设计草案不代表运行协议。",
    output:kind==="development"?"API 实现、OpenAPI 或等价接口说明、测试结果、部署与验收说明。":"可复用的店铺运营脚本包、各 action 输入输出 Schema、参数 Schema、权限声明与测试；不把制作说明当成可执行 manifest。",
    parameters:"销售站点、语言、超时等非敏感参数；凭证由后端连接管理。",
    updatedAt:new Date().toISOString()};
}
export function isSkillDraft(value:unknown):value is SkillDraft {
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const v=value as Record<string,unknown>;
  return ["id","name","kind","purpose","actions","input","output","parameters","updatedAt"].every(k=>typeof v[k]==="string"&&(v[k] as string).length<=4000)
    && Object.prototype.hasOwnProperty.call(skillKinds,String(v.kind))
    && !!String(v.id)&&!!String(v.name).trim()&&String(v.name).length<=80
    && Number.isFinite(Date.parse(String(v.updatedAt)));
}
export function parseSkillDrafts(raw:string):SkillDraft[]{
  const values:unknown=JSON.parse(raw);
  if(!Array.isArray(values)||values.length>100||!values.every(isSkillDraft)||new Set(values.map(v=>v.id)).size!==values.length)
    throw Error("技能草稿格式异常。原存储未覆盖，请先备份后处理。");
  return values;
}
export function creationBrief(draft:SkillDraft){
  return {format:"commerceos.skill-creation-brief@1",status:"draft-not-executable",draft,
    requirements:["按 action 声明输入、输出和配置参数 Schema","逐项映射固定请求到目标请求及目标结果到固定回执；保留字段依据、转换和未决问题","先展示简短框架，业务缺口与有损转换交用户确认，不猜值、不改固定契约掩盖差异","渠道差异由适配包处理，不修改商品事实或跳过审批","凭证通过连接引用提供，禁止写入代码、提示词和日志","写入操作需幂等，超时后先核对结果","交付代码、测试、依赖与权限说明；测试确认并注册后才能执行"]};
}

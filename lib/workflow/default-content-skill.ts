import type {RegisteredSkill} from '../skills/personal';
import type {WorkflowDocument} from './universal';

// Only migrate the untouched design placeholder. Explicit selections, revoked
// registered versions and custom generation instructions must never fall back.
export function needsDefaultContentSkill(document:WorkflowDocument) {
  return document.nodes.some(node=>node.definitionId==='content.make'&&node.binding.mode==='default'&&node.binding.skillId==='content.make.core');
}
const legacyDefaults:Record<string,unknown>={market:'US',timeout:60,prompt:'依据已核实的商品事实生成本地化文案；图片工具返回实际素材引用。',imageProviderRef:'',locale:'en-US'};
export function bindDefaultContentSkill(document:WorkflowDocument,registry:RegisteredSkill[]):WorkflowDocument {
  if(!needsDefaultContentSkill(document))return document;
  const node=document.nodes.find(node=>node.definitionId==='content.make')!;
  if(Object.entries(node.binding.parameters).some(([key,value])=>legacyDefaults[key]!==value))
    throw Error('内容节点含自定义制作参数，不能用原素材整理忽略它们；请选择支持这些参数的已注册 Skill。');
  const entry=registry.filter(row=>row.handler==='content.editorial.v1'&&row.status==='approved'&&row.selectable===true&&row.manifest?.id===`registered.${row.id}`&&row.manifest.version===row.version&&row.manifest.input==='ApprovedProductBrief@2'&&row.manifest.output==='ListingDraft@1'&&Object.keys(row.manifest.parameterSchema).length===0&&row.manifest.channels.some(channel=>channel==='*'||channel===document.environment.channel))
    .sort((a,b)=>(b.reviewed_at??'').localeCompare(a.reviewed_at??'')||b.version.localeCompare(a.version,undefined,{numeric:true})||a.id.localeCompare(b.id))[0];
  if(!entry?.manifest)throw Error('后端没有已审核且可执行的原素材整理 Skill；请检查技能注册表，不会用演示 Skill 或未审核版本运行。');
  const manifest=entry.manifest;
  return {...document,customSkills:[...document.customSkills.filter(skill=>skill.id!==manifest.id),manifest],nodes:document.nodes.map(current=>current.id===node.id?{...current,binding:{...current.binding,skillId:manifest.id,skillVersion:manifest.version,mode:'default',parameters:{}}}:current)};
}

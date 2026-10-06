import type {RegisteredSkill} from '../skills/personal';
import type {WorkflowDocument,NodeInstance,SkillManifest} from './universal';
import {applyOperatorNodeSettings} from './operator-policy';
import {bindDefaultContentSkill,needsDefaultContentSkill} from './default-content-skill';
import {withSelectionStages,compactSelectionStages} from './universal';

/** Remove trending from editable drafts only. Frozen versions remain immutable. */
export function recommendCatalogCandidates(document:WorkflowDocument):WorkflowDocument {
  const task=document.nodes.find(node=>node.definitionId==='product.start');
  if(!task||task.binding.parameters.candidateSource==='catalog')return document;
  return {...document,nodes:document.nodes.map(node=>node.id===task.id?{...node,binding:{...node.binding,parameters:{...node.binding.parameters,candidateSource:'catalog'}}}:node)};
}

/** Requested migration of editable CJ v3 drafts, not frozen runs or other strategies. */
export function recommendCJOrderCount(document:WorkflowDocument):WorkflowDocument {
  const result=recommendCJOrderCountStages(withSelectionStages(document));
  return document.selectionStrategy?compactSelectionStages(result):result;
}
function recommendCJOrderCountStages(document:WorkflowDocument):WorkflowDocument {
  const task=document.nodes.find(n=>n.definitionId==='product.start');
  const decision=document.nodes.find(n=>n.definitionId==='product.decide');
  if(task&&decision&&task.binding.parameters.marketEvidenceSource==='cj'&&decision.binding.skillVersion==='4.0.0'&&(!task.binding.parameters.demandFirstCollection||!task.binding.parameters.batchPublishing||task.binding.parameters.scanBudget===undefined)){
    return {...document,nodes:document.nodes.map(n=>n.id===task.id?{...n,binding:{...n.binding,parameters:{...n.binding.parameters,demandFirstCollection:true,batchPublishing:true,scanBudget:task.binding.parameters.scanBudget??1000}}}:n)};
  }
  if(!task||!decision||task.binding.parameters.marketEvidenceSource!=='cj'||decision.binding.skillVersion!=='3.0.0'||!decision.binding.skillId.startsWith('registered.')||Object.keys(decision.binding.parameters).length)return document;
  const {minimumCJSales90d,...parameters}=task.binding.parameters;
  return {...document,nodes:document.nodes.map(n=>n.id===task.id?{...n,binding:{...n.binding,parameters:{...parameters,minimumCJOrderCount:parameters.minimumCJOrderCount??1,candidateSource:'catalog'}}}:n.id===decision.id?{...n,binding:{...n.binding,skillId:'product.decide.core',skillVersion:'1.0.0',mode:'default'}}:n)};
}

export const selectionBasisStrategies={cj:{handler:'product.opportunity.v5',version:'5.0.0',label:'CJ 订单与刊登关注度选品'},external:{handler:'product.opportunity.v2',version:'2.0.0',label:'销量趋势与竞争选品'},none:{handler:'product.opportunity.v1',version:'1.0.0',label:'供货、成本与时效评估'}} as const;
/** One explicit task edit updates source and strategy atomically, never frozen runs. */
export function applySelectionBasis(document:WorkflowDocument,task:NodeInstance,manifest:SkillManifest):WorkflowDocument {
  const result=applySelectionBasisStages(withSelectionStages(document),task,manifest);
  return document.selectionStrategy?compactSelectionStages(result):result;
}
function applySelectionBasisStages(document:WorkflowDocument,task:NodeInstance,manifest:SkillManifest):WorkflowDocument {
  const original=document.nodes.find(node=>node.id===task.id&&node.definitionId==='product.start');
  const decision=document.nodes.find(node=>node.definitionId==='product.decide');
  const source=task.binding.parameters.marketEvidenceSource as keyof typeof selectionBasisStrategies;
  const strategy=selectionBasisStrategies[source];
  if(!original||!decision||!strategy||!manifest.id.startsWith('registered.')||manifest.version!==strategy.version||manifest.input!=='DeliveryCandidates@1'||manifest.output!=='SelectionProposal@1'||!manifest.channels.some(channel=>channel==='*'||channel===document.environment.channel))throw Error('选品依据与已注册策略不兼容，配置未应用。');
  const configured=structuredClone(task);
  if(source==='external'){
    if(!configured.binding.parameters.marketEvidenceRef)throw Error('请先选择外部证据批次。');
  }else{
    delete configured.binding.parameters.marketEvidenceRef;
    delete configured.binding.parameters.allowEstimatedSales;
  }
  if(source==='cj'){
    configured.binding.parameters.demandFirstCollection=true;configured.binding.parameters.batchPublishing=true;configured.binding.parameters.scanBudget??=1000;
    configured.binding.parameters.demandQualifiedQuota??=true;
    configured.binding.parameters.minimumCJOrderCount??=1;
    delete configured.binding.parameters.minimumCJSales90d;
  }
  const allowed=applyOperatorNodeSettings(original,configured);
  if(source==='cj')delete allowed.binding.parameters.minimumCJSales90d;
  // Generic parameter edits preserve omitted fields. An explicit source switch
  // is the narrow exception: remove incompatible external-evidence references.
  if(source!=='external'){
    delete allowed.binding.parameters.marketEvidenceRef;
    delete allowed.binding.parameters.allowEstimatedSales;
  }
  if(source!=='cj'){delete allowed.binding.parameters.demandFirstCollection;delete allowed.binding.parameters.batchPublishing;delete allowed.binding.parameters.demandQualifiedQuota;}
  const updatedDecision=applyOperatorNodeSettings(decision,{...decision,binding:{...decision.binding,skillId:manifest.id,skillVersion:manifest.version,mode:'custom',parameters:{}}});
  return {...document,customSkills:[...document.customSkills.filter(skill=>skill.id!==manifest.id),manifest],nodes:document.nodes.map(node=>node.id===task.id?allowed:node.id===decision.id?updatedDecision:node)};
}

export function needsDefaultRuntimeSkills(document:WorkflowDocument) {
  document=withSelectionStages(document);
  return needsDefaultContentSkill(document)||document.nodes.some(node=>node.definitionId==='product.decide'&&node.binding.mode==='default'&&node.binding.skillId==='product.decide.core');
}
/** Resolve design placeholders before saving, not fallback inside execution. */
export function bindDefaultRuntimeSkills(document:WorkflowDocument,registry:RegisteredSkill[]):WorkflowDocument {
  const result=bindDefaultRuntimeStages(withSelectionStages(document),registry);
  return document.selectionStrategy?compactSelectionStages(result):result;
}
function bindDefaultRuntimeStages(document:WorkflowDocument,registry:RegisteredSkill[]):WorkflowDocument {
  const node=document.nodes.find(node=>node.definitionId==='product.decide');
  if(!node||node.binding.mode!=='default'||node.binding.skillId!=='product.decide.core')return bindDefaultContentSkill(document,registry);
  const task=document.nodes.find(node=>node.definitionId==='product.start');
  if(!task)throw Error('默认选品策略缺少商品任务，不能生成选品配置。');
  const parameters=task.binding.parameters;
  const source=parameters.marketEvidenceSource??(parameters.marketEvidenceRef?'external':'cj');
  if(source!=='cj'&&source!=='external')throw Error('你已指定不使用市场证据，默认销量策略不能忽略此选择；请明确选择证据来源或其他已注册策略。');
  if(source==='cj'&&(parameters.marketEvidenceRef||parameters.allowEstimatedSales))throw Error('CJ 自动证据与外部证据设置冲突，不能自动清除你的设置。');
  const defaults:Record<string,unknown>={market:'US',timeout:60,instruction:'依据可追溯证据输出契约结果；缺少信息应明确标记。',modelRef:''};
  for(const [key,value] of Object.entries(node.binding.parameters)){
    const inherited=source==='external'&&(key==='marketEvidenceRef'&&value===parameters.marketEvidenceRef||key==='allowEstimatedSales'&&value===(parameters.allowEstimatedSales??false));
    if(!inherited&&defaults[key]!==value)throw Error('选品节点含自定义策略参数，不能用默认算法忽略它们；请选择兼容的注册策略。');
  }
  const handler=source==='cj'?'product.opportunity.v5':'product.opportunity.v2';
  const version=source==='cj'?'5.0.0':'2.0.0';
  const row=registry.find(entry=>entry.handler===handler&&entry.version===version&&entry.status==='approved'&&entry.selectable===true&&entry.manifest?.id===`registered.${entry.id}`&&entry.manifest.version===version&&entry.manifest.input==='DeliveryCandidates@1'&&entry.manifest.output==='SelectionProposal@1'&&entry.manifest.channels.some(channel=>channel==='*'||channel===document.environment.channel));
  if(!row?.manifest)throw Error(`后端没有可执行的${source==='cj'?'CJ 订单与刊登关注度选品 v5':'销量趋势与竞争选品 v2'}，不会改用示例策略或忽略需求证据。`);
  const manifest=row.manifest;
  const taskParameters={...parameters};
  if(source==='cj'){taskParameters.demandFirstCollection=true;taskParameters.batchPublishing=true;taskParameters.scanBudget??=1000;}
  else delete taskParameters.demandQualifiedQuota;
  if(source==='cj')delete taskParameters.minimumCJSales90d;
  const updated:WorkflowDocument={...document,customSkills:[...document.customSkills.filter(skill=>skill.id!==manifest.id),manifest],nodes:document.nodes.map(current=>current.id===task.id?{...current,binding:{...current.binding,parameters:{...taskParameters,marketEvidenceSource:source,...(source==='cj'?{minimumCJOrderCount:parameters.minimumCJOrderCount??1}:{})}}}:current.id===node.id?{...current,binding:{...current.binding,skillId:manifest.id,skillVersion:manifest.version,parameters:{}}}:current)};
  return bindDefaultContentSkill(updated,registry);
}

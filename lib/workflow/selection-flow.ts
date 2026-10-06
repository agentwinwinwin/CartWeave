import {forwardEdges,compactSelectionStages,type WorkflowDocument} from './universal';

export const selectionRuleGroups = [
  {title:'库存与供货条件',keys:['minimumInventory','requireVerifiedInventory','allowFactorySupply','factoryProcessingDays','factorySaleLimit']},
  {title:'配送条件',keys:['maximumDeliveryDays','allowCrossBorderShipping']},
  {title:'费用与经营目标',keys:['platformFeeRate','paymentFeeRate','returnReserveRate','targetContributionRate','taxReserveUsd']},
];
export const selectionRuleKeys=new Set(selectionRuleGroups.flatMap(group=>group.keys));

/** Upgrade editable standard drafts only, preserving actual settings and IDs. */
export function unifySelectionDraft(document:WorkflowDocument):WorkflowDocument {
  const unified=['product.start','product.collect','product.verify','product.decide','product.cost','product.authorize','content.make','listing.validate','listing.authorize','listing.map','listing.publish','listing.wait','listing.end'];
  if(document.templateId==='launch'&&document.nodes.map(n=>n.definitionId).join('|')===unified.join('|')){
    const cost=document.nodes.find(n=>n.definitionId==='product.cost')!;
    if(cost.binding.skillId!=='product.cost.core'||cost.binding.skillVersion!=='1.0.0'||Object.keys(cost.binding.parameters).length||cost.binding.execution||cost.binding.connectionRef)return document;
    return compactSelectionStages(document);
  }
  const old=['product.start','product.collect','product.normalize','product.filter','product.delivery','product.decide','product.cost','product.authorize','content.make','listing.validate','listing.authorize','listing.map','listing.publish','listing.wait','listing.end'];
  if(document.templateId!=='launch'||document.nodes.map(n=>n.definitionId).join('|')!==old.join('|'))return document;
  const removed=document.nodes.slice(2,5);
  if(removed.some(n=>n.binding.skillId!==`${n.definitionId}.core`||n.binding.skillVersion!=='1.0.0'||Object.keys(n.binding.parameters).some(k=>!selectionRuleKeys.has(k))))return document;
  const cost=document.nodes[6];
  if(cost.binding.skillId!=='product.cost.core'||cost.binding.skillVersion!=='1.0.0')return document;
  if(Object.keys(cost.binding.parameters).some(k=>!selectionRuleKeys.has(k)))return document;
  const draft=structuredClone(document),task=draft.nodes[0];
  for(const n of [...draft.nodes.slice(2,5),draft.nodes[6]])Object.assign(task.binding.parameters,n.binding.parameters);
  const verify={...draft.nodes[2],definitionId:'product.verify',title:'统一核验并补选',binding:{skillId:'product.verify.core',skillVersion:'1.0.0',mode:'default' as const,parameters:{}}};
  const removedIds=new Set(removed.slice(1).map(n=>n.id));
  draft.nodes=[...draft.nodes.slice(0,2),verify,...draft.nodes.slice(5).map(n=>n.definitionId==='product.cost'?{...n,title:'复核建议售价',binding:{...n.binding,parameters:{}}}:n)];
  draft.edges=[...forwardEdges(draft.nodes),...draft.edges.filter(e=>e.kind!=='forward'&&!removedIds.has(e.source)&&!removedIds.has(e.target))];
  return compactSelectionStages(draft);
}

import {getDefinition,storeActionIds,type WorkflowDocument,type SkillManifest} from './universal';
export type PublishingStore={id:string;name:string;channel:string;adapter:string;configuration_version:number;verified:boolean;active:boolean;capabilities:string[]};
export type PublishingPackage={package:string;version:string;channel:string;status:string;design_manifests?:SkillManifest[]};

/** Store selection belongs to workspace integration, not an execution node. */
export function applyConnectedStore(document:WorkflowDocument,store:PublishingStore,pkg:PublishingPackage):WorkflowDocument {
 if(document.nodes.some(n=>n.definitionId==='listing.publish'))return applyInstalledStore(document,store,pkg);
 if(!store.active||!store.verified||!Number.isInteger(store.configuration_version)||store.configuration_version<1||store.channel!==document.environment.channel||pkg.channel!==store.channel||pkg.package!==store.adapter||pkg.status!=='implemented-local-test-only')throw Error('店铺连接或接口包未验收，不能复用。');
 return {...document,environment:{...document.environment,storeRef:store.id,storeIntegration:{channel:store.channel,name:store.name,version:pkg.version,actions:[...store.capabilities],status:'draft',apiMode:'existing-api'}}};
}

/** New drafts only. Copy one unambiguous saved connection, not old task parameters. */
export function reuseSavedStoreConnection(document:WorkflowDocument,sources:WorkflowDocument[]):WorkflowDocument {
 if(document.environment.storeRef||document.environment.storeIntegration||document.nodes.some(n=>storeActionIds.includes(n.definitionId)&&n.binding.connectionRef||n.definitionId==='listing.map'&&n.binding.parameters.mappingMode))return document;
 const compatible=sources.filter(source=>{try{const plan=inheritedPublishingPlan(source);return source.environment.channel===document.environment.channel&&!!plan.storeRef;}catch{return false;}});
 if(new Set(compatible.map(source=>source.environment.storeRef)).size!==1)return document;
 const source=compatible[0];
 const actions=['listing.validate','listing.publish','listing.wait','listing.map'];
 const nodes=document.nodes.map(node=>{if(node.binding.mode!=='default'||!actions.includes(node.definitionId))return node;const original=source.nodes.find(n=>n.definitionId===node.definitionId);return original?{...node,binding:structuredClone(original.binding)}:node;});
 const refs=new Set(nodes.map(n=>n.binding.skillId));
 return {...document,environment:{...document.environment,storeRef:source.environment.storeRef,storeIntegration:structuredClone(source.environment.storeIntegration)},nodes,customSkills:[...document.customSkills,...source.customSkills.filter(m=>refs.has(m.id)&&!document.customSkills.some(old=>old.id===m.id))]};
}
/** Explicit new-freeze action only. 1.4 adds reads; publication descriptors stay 1.3.
 * Never changes a store, operational parameter, custom binding, or old release. */
export function refreshCompatiblePublicationPackage(document:WorkflowDocument,store:PublishingStore,pkg:PublishingPackage):WorkflowDocument {
  const plan=inheritedPublishingPlan(document);
  if(plan.package!=='test-store.v1'||!['1.3.0','1.4.0'].includes(plan.version)||pkg.package!==plan.package||!['1.4.0','1.5.0'].includes(pkg.version))return document;
  if(store.id!==plan.storeRef||store.configuration_version!==plan.storeVersion)throw Error('店铺连接版本已变化，请在配置店铺接入重新确认；不会自动替换连接。');
  const verified=applyInstalledStore(document,store,pkg);
  for(const action of ['listing.validate','listing.publish','listing.wait']){
    const old=document.nodes.find(n=>n.definitionId===action),next=verified.nodes.find(n=>n.definitionId===action);
    if(!old||!next||old.binding.skillId!==next.binding.skillId||old.binding.skillVersion!==next.binding.skillVersion||Object.keys(old.binding.parameters).length||old.binding.execution)throw Error('发布绑定不是兼容的标准接口包，请在配置店铺接入明确确认后冻结。');
    const previous=document.customSkills.find(m=>m.id===old.binding.skillId),current=pkg.design_manifests?.find(m=>m.id===old.binding.skillId);
    if(!previous||!current||previous.version!==current.version||previous.entrypointRef!==current.entrypointRef||previous.input!==current.input||previous.output!==current.output)throw Error('发布契约已变化，不能自动刷新包引用。');
  }
  return {...document,environment:{...document.environment,storeIntegration:{...document.environment.storeIntegration!,version:pkg.version}},nodes:document.nodes.map(n=>n.definitionId==='listing.map'?{...n,binding:{...n.binding,parameters:{...n.binding.parameters,mappingPlanVersion:pkg.version}}}:n)};
}
export function applyInstalledStore(document:WorkflowDocument,store:PublishingStore,pkg:PublishingPackage):WorkflowDocument {
  const actions=['listing.validate','listing.publish','listing.wait'];
  if(!store.active||!store.verified||!Number.isInteger(store.configuration_version)||store.configuration_version<1||pkg.status!=='implemented-local-test-only'||store.channel!==document.environment.channel||pkg.channel!==store.channel||pkg.package!==store.adapter||!store.capabilities.every(a=>typeof a==='string')||!actions.every(a=>store.capabilities.includes(a)))throw Error('店铺与接口包未验收、渠道不一致或缺少发布能力。');
  const manifests=actions.map(action=>{
    const definition=getDefinition(action)!,manifest=pkg.design_manifests?.find(m=>m.id===`installed.${pkg.package}.${action}`);
    if(!manifest||!/^\d+\.\d+\.\d+$/.test(manifest.version)||manifest.entrypointRef!==`installed://${pkg.package}/${action}@${manifest.version}`||manifest.runtime!=='connector'||manifest.input!==definition.input||manifest.output!==definition.output||!manifest.channels.includes(store.channel)||manifest.effects.some(e=>!definition.allowedEffects.includes(e)))throw Error('后端未提供匹配的节点描述，不能伪造绑定。');
    return manifest;
  });
  return {...document,environment:{...document.environment,storeRef:store.id,storeIntegration:{channel:store.channel,name:store.name,version:pkg.version,actions:[...store.capabilities],status:'draft',apiMode:'existing-api'}},customSkills:[...document.customSkills.filter(s=>!manifests.some(m=>m.id===s.id)),...manifests],nodes:document.nodes.map(n=>{
    if(n.definitionId==='listing.map')return {...n,binding:{...n.binding,parameters:{mappingMode:'installed',mappingPlanRef:pkg.package,mappingPlanVersion:pkg.version,mappingStoreRef:store.id,mappingStoreVersion:store.configuration_version}}};
    const manifest=manifests.find(m=>m.input===getDefinition(n.definitionId)?.input&&m.output===getDefinition(n.definitionId)?.output&&actions.includes(n.definitionId));
    return manifest?{...n,binding:{skillId:manifest.id,skillVersion:manifest.version,mode:'custom',parameters:{}}}:n;
  })};
}

/** Design binding only: this does not claim a prepared request exists or authorize a send. */
export function inheritedPublishingPlan(document:WorkflowDocument){
 const publishIndex=document.nodes.findIndex(n=>n.definitionId==='listing.publish');
 const node=document.nodes[publishIndex-1];
 if(publishIndex<1||node?.definitionId!=='listing.map')throw Error('发布前必须连接准备渠道发布数据节点。');
 const p=node.binding.parameters,env=document.environment;
 if(p.mappingMode!=='installed'||!p.mappingPlanRef||!p.mappingPlanVersion||!p.mappingStoreRef||!Number.isInteger(p.mappingStoreVersion))throw Error('请先在配置店铺接入中保存已验收店铺与接口包；准备节点自动继承，分析草案不能用于发送。');
 if(p.mappingStoreRef!==env.storeRef||p.mappingPlanVersion!==env.storeIntegration?.version||env.storeIntegration.channel!==env.channel)throw Error('店铺或接口包已变更，请到配置店铺接入重新确认。');
 const publish=document.nodes[publishIndex];
 const manifest=document.customSkills.find(m=>m.id===`installed.${p.mappingPlanRef}.listing.publish`);
 const definition=getDefinition('listing.publish')!;
 if(!manifest||manifest.entrypointRef!==`installed://${p.mappingPlanRef}/listing.publish@${manifest.version}`||manifest.runtime!=='connector'||manifest.input!==definition.input||manifest.output!==definition.output||!manifest.channels.includes(env.channel)||manifest.effects.some(e=>!definition.allowedEffects.includes(e))||publish.binding.connectionRef&&publish.binding.connectionRef!==p.mappingStoreRef||publish.binding.skillId!==manifest.id||publish.binding.skillVersion!==manifest.version)throw Error('发布绑定与准备节点不一致，请到配置店铺接入确认方案，不能单独覆盖店铺或接口包。');
 return {storeRef:String(p.mappingStoreRef),storeVersion:Number(p.mappingStoreVersion),name:env.storeIntegration.name,package:String(p.mappingPlanRef),version:String(p.mappingPlanVersion)};
}

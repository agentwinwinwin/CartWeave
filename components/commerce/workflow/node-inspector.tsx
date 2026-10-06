"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {MarketEvidencePicker} from './market-evidence-picker';
import {fillUnsetParameters} from '@/lib/workflow/recommended-defaults';
import {selectionBasisStrategies} from '@/lib/workflow/default-runtime-skills';
import {selectionStrategyNode} from '@/lib/workflow/universal';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";
import {Switch} from "@/components/ui/switch";
import { kindLabels, type WorkflowNode } from "./model";
import { catalog } from "@/lib/workflow/catalog";
const skills=catalog.skills;
import styles from "./workflow.module.css";
import skillStyles from "./skill-inspector.module.css";
import { contractExamples, contractSchemas, getDefinition, getSkill, isChannelAdapter, skillManifests, skillSupportsChannel, type WorkflowDocument, type NodeInstance, type SkillManifest } from "@/lib/workflow/universal";
import { resolveChannel } from "@/lib/workflow/channels";
import { getNodeOperatorPolicy } from "@/lib/workflow/operator-policy";
import { NodeAccess } from "./node-access";
import {ProductTaskFields,FinalSelectionInfo,productSearchFields} from "./product-task-fields";
import {selectionRuleGroups,selectionRuleKeys} from '@/lib/workflow/selection-flow';
import {IntelligenceSettings} from './intelligence-settings';
import {intelligenceEnabled} from '@/lib/workflow/universal';
import {backendRequest} from "@/lib/workflow/backend-client";
import type {RegisteredSkill} from "@/lib/skills/personal";
import {PublishingSkillSetup} from "./publishing-skill-setup";
import { productCollectionTaskParameters, productTaskParameters, isStoreAction, resolveNodeConnection, validCategoryQueries, categoryQueriesFor, effectiveNodeParameters,marketTaskParameters } from "@/lib/workflow/universal";

export type NodeConfig = { skill: string; market: string; model: string; prompt: string; timeout: string; retries: string };
export function initialConfig(node:WorkflowNode):NodeConfig {
  return {skill:node.skill??"",market:"美国 · 英语",model:"默认模型连接",prompt:skills.find(skill=>skill.id===node.skill)?.prompt??"",timeout:"60",retries:"1"};
}
const runtimeNames:Record<string,string>={script:"脚本",connector:"连接器",llm:"语言模型",media:"图片 / 媒体",composite:"组合任务",manual:"人工处理"};
const runtimeIds=["script","connector","llm","media","composite","manual"];
function validParameterSchema(raw:unknown):boolean {
  if(!raw||typeof raw!=="object"||Array.isArray(raw))return false;
  const parameter=raw as Record<string,unknown>;
  if(!["string","number","boolean"].includes(String(parameter.type))||typeof parameter.label!=="string"||!parameter.label.trim())return false;
  if(parameter.description!==undefined&&typeof parameter.description!=="string")return false;
  if(parameter.required!==undefined&&typeof parameter.required!=="boolean")return false;
  for(const bound of ["minimum","maximum"])if(parameter[bound]!==undefined&&(typeof parameter[bound]!=="number"||!Number.isFinite(parameter[bound])))return false;
  if(parameter.type!=="number"&&(parameter.minimum!==undefined||parameter.maximum!==undefined))return false;
  if(typeof parameter.minimum==="number"&&typeof parameter.maximum==="number"&&parameter.minimum>parameter.maximum)return false;
  const accepts=(value:unknown)=>typeof value===parameter.type&&(typeof value!=="number"||(Number.isFinite(value)&&(parameter.minimum===undefined||value>=(parameter.minimum as number))&&(parameter.maximum===undefined||value<=(parameter.maximum as number))));
  if(parameter.enum!==undefined&&(!Array.isArray(parameter.enum)||parameter.enum.length===0||!parameter.enum.every(accepts)))return false;
  if(parameter.default!==undefined&&(!accepts(parameter.default)||(Array.isArray(parameter.enum)&&!parameter.enum.includes(parameter.default))))return false;
  return true;
}
type ParameterView={type:string;label?:string;description?:string;default?:unknown;required?:boolean;enum?:unknown[];minimum?:number;maximum?:number;min?:number;max?:number};
function parameterDefaults(skill:SkillManifest):Record<string,unknown>{return Object.fromEntries(Object.entries(skill.parameterSchema).filter(([,schema])=>schema.default!==undefined).map(([key,schema])=>[key,schema.default]));}
const operatorHiddenParameters = new Set(["timeout", "fieldMap", "modelRef", "imageProviderRef", "sourceRef", "resourceRef", "ruleNote", "scoringWeights"]);
const optionNames:Record<string,string> = { US:"美国", GB:"英国", DE:"德国", FR:"法国", CA:"加拿大", AU:"澳大利亚", JP:"日本", home:"家居用品", USD:"美元", EUR:"欧元", GBP:"英镑", CNY:"人民币", preserve_missing:"保留缺失信息", reject_record:"拒绝不完整记录", "en-US":"英语（美国）", "zh-CN":"简体中文", "de-DE":"德语", "fr-FR":"法语", "es-ES":"西班牙语" };
function ParameterFields({skill,instance,onChange,keys}:{skill:SkillManifest;instance:NodeInstance;onChange:(key:string,value:unknown)=>void;keys?:string[]}) {
  return <div className={skillStyles.parameters}>{Object.entries(skill.parameterSchema).filter(([key])=>!keys||keys.includes(key)).map(([key,raw])=>{
    const schema=raw as ParameterView,value=instance.binding.parameters[key]??"";
    const label=instance.definitionId==="product.start"&&key==="scanBudget"?(instance.binding.parameters.demandQualifiedQuota===true?"订单达标候选数量（20–10000）":"原始扫描预算（20–10000，旧计数方式）"):instance.definitionId==="product.start"&&key==="limit"&&["none","external"].includes(String(instance.binding.parameters.marketEvidenceSource))?"本次候选样本上限（最多 100 款）":schema.label??key;
    const options=schema.enum??(key==="market"?["US","GB","DE","FR","CA","AU","JP"]:key==="locale"?["en-US","zh-CN","de-DE","fr-FR","es-ES"]:undefined);
    const multiline=/prompt|instruction|checklist|note|map|weights/i.test(key);
    return <label key={key} className={multiline?skillStyles.wide:undefined}><span>{label}{schema.required&&<small> · 必填</small>}</span>
      {options?<SelectField aria-label={label} value={String(value)} onChange={event=>onChange(key,options.find(option=>String(option)===event.target.value)??event.target.value)}><option value="">请选择</option>{value!==""&&!options.some(option=>String(option)===String(value))&&<option value={String(value)}>{String(value)}</option>}{options.map(option=><option key={String(option)} value={String(option)}>{optionNames[String(option)]??String(option)}</option>)}</SelectField>
      :schema.type==="boolean"?<SelectField aria-label={label} value={String(value)} onChange={event=>onChange(key,event.target.value==="true")}><option value="">请选择</option><option value="true">开启</option><option value="false">关闭</option></SelectField>
      :schema.type==="number"||schema.type==="integer"?<Input aria-label={label} type="number" value={String(value)} min={schema.minimum??schema.min} max={schema.maximum??schema.max} step={schema.type==="integer"||key==="scanBudget"?1:"any"} onChange={event=>onChange(key,event.target.value===""?"":Number(event.target.value))}/>
      :multiline?<textarea aria-label={label} rows={/prompt|instruction/i.test(key)?4:2} value={typeof value==="string"?value:JSON.stringify(value)} onChange={event=>onChange(key,event.target.value)}/>:<Input aria-label={label} value={typeof value==="string"?value:JSON.stringify(value)} onChange={event=>onChange(key,event.target.value)}/>}
      {schema.description&&<small>{schema.description}</small>}
      {(typeof schema.default==='number'||typeof schema.default==='boolean')&&<small>推荐起步值：{typeof schema.default==='boolean'?(schema.default?'开启':'关闭'):schema.default} · 可自行调整</small>}
    </label>;
  })}</div>;
}
function downloadContractSchema(contract:string){
  const schema=contractSchemas[contract];if(!schema)return;
  const url=URL.createObjectURL(new Blob([JSON.stringify(schema,null,2)],{type:"application/schema+json"}));
  const anchor=document.createElement("a");anchor.href=url;anchor.download=`${contract.replace(/[^a-zA-Z0-9._-]/g,"-")}.schema.json`;anchor.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function SkillInspector({editor,onClose}:{editor:EditorProps;onClose:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const [tab,setTab]=useState("operation");
  const [instance,setInstance]=useState<NodeInstance>(()=>structuredClone(editor.instance));
  const [localSkills,setLocalSkills]=useState<SkillManifest[]>([]);
  const [manifestText,setManifestText]=useState("");
  const [message,setMessage]=useState("");
  const [technical,setTechnical]=useState(false);
  const [adapterAdvanced,setAdapterAdvanced]=useState(false);
  const [registered,setRegistered]=useState<RegisteredSkill[]>([]);
  const [registryLoading,setRegistryLoading]=useState(true);
  const [registryError,setRegistryError]=useState("");
  async function refreshRegistry(){
    setRegistryLoading(true);setRegistryError("");
    try{setRegistered(await backendRequest<RegisteredSkill[]>("skills"));}
    catch(e){setRegistered([]);setRegistryError(e instanceof Error?e.message:"无法读取后端注册表");}
    finally{setRegistryLoading(false);}
  }
  useEffect(()=>{void refreshRegistry();},[]);
  const definition=getDefinition(instance.definitionId);
  const operatorPolicy=getNodeOperatorPolicy(instance.definitionId);
  const canReplace=operatorPolicy.mode==="skill"||(technical&&isChannelAdapter(instance.definitionId));
  const allSkills=[...registered.flatMap(s=>s.manifest?[s.manifest]:[]),...skillManifests,...editor.document.customSkills,...localSkills];
  const available=allSkills.filter((skill,index,all)=>all.findIndex(item=>item.id===skill.id)===index&&skill.input===definition?.input&&skill.output===definition?.output);
  const selected=available.find(skill=>skill.id===instance.binding.skillId)??getSkill(instance.binding.skillId,editor.document);
  const defaultsSignature=JSON.stringify(selected?parameterDefaults(selected):{});
  useEffect(()=>{
    if(operatorPolicy.mode==='fixed')return;
    const defaults=JSON.parse(defaultsSignature) as Record<string,unknown>;
    setInstance(current=>{
      const parameters=fillUnsetParameters(current.binding.parameters,defaults);
      return parameters!==current.binding.parameters?{...current,binding:{...current.binding,parameters}}:current;
    });
  },[defaultsSignature,operatorPolicy.mode]);
  const evidenceSource=String(instance.binding.parameters.marketEvidenceSource??(instance.binding.parameters.marketEvidenceRef?'external':'cj'));
  const originalSource=String(editor.instance.binding.parameters.marketEvidenceSource??(editor.instance.binding.parameters.marketEvidenceRef?'external':'cj'));
  const basisStrategy=selectionBasisStrategies[evidenceSource as keyof typeof selectionBasisStrategies];
  const decision=selectionStrategyNode(editor.document);
  const [strategyChoice,setStrategyChoice]=useState(decision?.binding.skillId??'');
  const basisNeedsSync=instance.definitionId==='product.start'&&!!editor.onConfigureBasis&&(strategyChoice!==decision?.binding.skillId||evidenceSource!==originalSource||instance.binding.parameters.marketEvidenceSource!==editor.instance.binding.parameters.marketEvidenceSource||decision?.binding.skillId==='product.decide.core'&&decision.binding.mode==='default');
  const strategyRows=registered.filter(row=>row.handler===basisStrategy?.handler&&row.version===basisStrategy.version&&row.status==='approved'&&row.selectable&&row.manifest?.id===`registered.${row.id}`&&row.manifest.version===row.version&&row.manifest.input==='DeliveryCandidates@1'&&row.manifest.output==='SelectionProposal@1'&&skillSupportsChannel(row.manifest,editor.document.environment.channel));
  const basisRegistered=strategyRows.find(row=>row.manifest?.id===strategyChoice)??(evidenceSource!==originalSource||decision?.binding.skillId==='product.decide.core'?strategyRows[0]:undefined);
  const [basisAdvanced,setBasisAdvanced]=useState(()=>originalSource!=='cj');
  const environment=editor.document.environment;
  const storeAction=isStoreAction(instance.definitionId);
  const connection=resolveNodeConnection(instance,environment);
  const executionBinding=instance.binding as NodeInstance["binding"] & {connectionRef?:string;execution?:{timeoutSeconds:number;maxRetries:number;retryMode:"safe"|"never"}};
  const execution=executionBinding.execution??{timeoutSeconds:60,maxRetries:0,retryMode:"never" as const};
  const setExecution=(update:Partial<typeof execution>)=>setInstance(current=>({...current,binding:{...current.binding,execution:{...execution,...update}}}));
  const compatibility=(skill:SkillManifest):string[]=>{
    const issues:string[]=[];
    if(skill.id.startsWith("registered.")){
      const entry=registered.find(s=>s.manifest?.id===skill.id&&s.version===skill.version);
      if(registryLoading)issues.push("正在核对后端注册版本");
      else if(registryError||!entry)issues.push("未能从后端确认此版本，请刷新注册表");
      else if(!entry.selectable)issues.push(entry.unavailable_reason||"此版本尚不可选择");
    }
    if(!definition||skill.input!==definition.input||skill.output!==definition.output)issues.push("输入或输出契约与节点职责不兼容");
    if(definition&&skill.effects.some(effect=>!definition.allowedEffects.includes(effect)))issues.push("实现的动作影响超出本节点职责范围");
    if(environment.fulfillment==="platform"&&definition?.id.startsWith("order.")&&skill.effects.some(effect=>effect!=="read"))issues.push("平台履约订单只允许读取状态，不能重复发运或通知");
    if(!skillSupportsChannel(skill,environment.channel))issues.push("不支持当前销售渠道");
    if(skill.fulfillments&&!skill.fulfillments.includes(environment.fulfillment))issues.push("不支持当前履约方式");
    const missing=skill.capabilities.filter(capability=>!environment.capabilities.includes(capability));
    if(missing.length)issues.push(`当前环境未声明能力：${missing.join("、")}`);
    return issues;
  };
  const issues=selected?compatibility(selected):["请选择已注册的 Skill"];
  if(instance.definitionId==='product.start'){
    if(!basisStrategy)issues.push('请选择有效的选品依据');
    if(evidenceSource==='external'&&!instance.binding.parameters.marketEvidenceRef)issues.push('请在高级设置选择外部证据批次');
    if(basisNeedsSync&&(registryLoading||registryError||!basisRegistered))issues.push(registryLoading?'正在核验对应的选品策略':registryError||'对应的选品策略未审核或不可用，不能应用');
  }
  if(instance.definitionId==="product.start"&&instance.binding.parameters.categoryQueries!==undefined&&!validCategoryQueries(instance.binding.parameters))issues.push("请检查多类目配置，总候选数量不能少于类目数量");
  if(instance.definitionId==='product.start'&&instance.binding.parameters.scanBudget!==undefined&&!Number.isInteger(instance.binding.parameters.scanBudget))issues.push('扫描预算必须是整数');
  if(instance.definitionId==="product.start"&&!intelligenceEnabled(editor.document)&&(!String(instance.binding.parameters.keyword??'').trim()||instance.binding.parameters.categoryId||instance.binding.parameters.category||categoryQueriesFor(instance.binding.parameters).length||instance.binding.parameters.emptyResultPolicy==='drop_keyword_once'))issues.push('请填写一个商品搜索词，例如 cat 或 hat；新设置不叠加类目或自动删词');
  if(instance.definitionId==='market.intelligence'&&instance.binding.parameters.enabled===true&&(!instance.binding.parameters.categoryPlanRef||!Array.isArray(instance.binding.parameters.categoryQueries)||!instance.binding.parameters.categoryQueries.length))issues.push('请先确认榜单方向与 CJ 供货类目的对应方案');
  if(!Number.isInteger(execution.timeoutSeconds)||execution.timeoutSeconds<1||execution.timeoutSeconds>600)issues.push("执行超时须为 1–600 秒的整数");
  if(!Number.isInteger(execution.maxRetries)||execution.maxRetries<0||execution.maxRetries>3)issues.push("重试次数须为 0–3 的整数");
  if(!["safe","never"].includes(execution.retryMode)||(execution.retryMode==="never"&&execution.maxRetries!==0))issues.push("不自动重试时，重试次数必须为 0");
  if(selected)for(const [key,raw] of Object.entries(selected.parameterSchema)){
    const schema=raw as ParameterView,value=effectiveNodeParameters(editor.document,instance)[key];
    if(schema.required&&(value===undefined||value===null||value===""))issues.push(`请填写${schema.label??key}`);
    if(value!==undefined&&value!==""){
      if((schema.type==="string"&&typeof value!=="string")||(schema.type==="boolean"&&typeof value!=="boolean"))issues.push(`${schema.label??key}的类型不符合参数定义`);
      if((schema.type==="number"||schema.type==="integer")&&(typeof value!=="number"||!Number.isFinite(value)||(schema.type==="integer"&&!Number.isInteger(value))))issues.push(`${schema.label??key}需要有效数字`);
      const minimum=schema.minimum??schema.min,maximum=schema.maximum??schema.max;
      if(typeof value==="number"&&((minimum!==undefined&&value<minimum)||(maximum!==undefined&&value>maximum)))issues.push(`${schema.label??key}超出允许范围`);
      if(schema.enum&&!schema.enum.includes(value))issues.push(`${schema.label??key}不是有效选项`);
    }
  }
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;dialog.current?.showModal();return()=>previous?.focus();},[]);
  const changeParameter=(key:string,value:unknown)=>{setInstance(current=>({...current,binding:{...current.binding,parameters:{...current.binding.parameters,[key]:value}}}));setMessage("");};
  const choose=(skill:SkillManifest)=>{if(!canReplace)return;const defaults=parameterDefaults(skill);if(instance.definitionId==='product.decide'&&skill.version==='2.0.0'&&marketTaskParameters(editor.document).marketEvidenceRef){delete defaults.marketEvidenceRef;delete defaults.allowEstimatedSales;}setInstance(current=>({...current,binding:{...current.binding,skillId:skill.id,skillVersion:skill.version,mode:"custom",parameters:defaults}}));setMessage("");};
  const skillOptions=()=> <>
    <option value="">请选择兼容 Skill</option>
    {!available.some(s=>s.id===instance.binding.skillId)&&instance.binding.skillId&&<option value={instance.binding.skillId} disabled>当前绑定待核验 · {instance.binding.skillId}</option>}
    <optgroup label="后端已注册 Skill">
      {registered.map(row=>row.manifest?<option key={row.id} value={row.manifest.id} disabled={!!compatibility(row.manifest).length}>{row.manifest.name} · v{row.version}{compatibility(row.manifest).length?` · ${compatibility(row.manifest).join("；")}`:" · 已审核"}</option>:<option key={row.id} value={`unavailable.${row.id}`} disabled>{row.key} · v{row.version} · 缺少契约声明</option>)}
      {!registered.length&&<option disabled>{registryLoading?"正在读取…":registryError?"注册表暂不可用":"暂无已注册 Skill"}</option>}
    </optgroup>
    <optgroup label="内置真实运行策略">{available.filter(s=>s.id==='product.decision.landed-cost').map(skill=><option key={skill.id} value={skill.id}>{skill.name} · v{skill.version}</option>)}</optgroup>
    <optgroup label="设计器示例 / 本地清单（仅模拟）">{available.filter(s=>!s.id.startsWith("registered.")&&s.id!=='product.decision.landed-cost').map(skill=><option key={skill.id} value={skill.id} disabled={!!compatibility(skill).length}>{skill.name.replace(/^共用 · /,"")} · v{skill.version}{compatibility(skill).length?" · 不兼容":""}</option>)}</optgroup>
  </>;
  const cloneManifest=()=>{
    const source=selected??available[0];if(!source)return;
    const currentChannel=resolveChannel(environment.channel,editor.document.customChannels);
    const channelSpecific=!skillSupportsChannel(source,environment.channel);
    setManifestText(JSON.stringify({...source,id:`custom.${Date.now()}`,name:`${currentChannel?.name??environment.channel} · ${definition?.title??source.name}`,version:"1.0.0",channels:channelSpecific?[environment.channel]:source.channels,entrypointRef:channelSpecific?`registry://draft/${environment.channel}/${definition?.id??"implementation"}@1`:source.entrypointRef,capabilities:channelSpecific?source.capabilities.map(capability=>capability==="assets.generate"?capability:capability.replace(/^[a-z][a-z0-9-]*\./,`${environment.channel}.`)):source.capabilities},null,2));
    setMessage("这是实现清单草案；请修改入口和参数，不能把已有平台接口当作新渠道接口直接执行。");
  };
  const register=()=>{
    try {
      if(!canReplace)throw new Error("系统规则不允许替换为自建 Skill。");
      const value=JSON.parse(manifestText) as SkillManifest;
      if(!value||typeof value!=="object"||Array.isArray(value)||![value.id,value.name,value.version,value.input,value.output,value.entrypointRef].every(item=>typeof item==="string"&&item.trim())||typeof value.description!=="string"||!runtimeIds.includes(value.runtime)||!value.parameterSchema||typeof value.parameterSchema!=="object"||Array.isArray(value.parameterSchema)||![value.capabilities,value.effects,value.channels].every(Array.isArray))throw new Error("请保留完整 manifest 字段，description 必须为文本，runtime 必须为支持的运行方式。");
      if(allSkills.some(skill=>skill.id===value.id))throw new Error("Skill ID 已存在，请为自建实现使用独立 ID。");
      if(!value.capabilities.every(item=>typeof item==="string"&&item.trim())||!value.effects.every(item=>["read","artifact","remote_write","spend","message"].includes(item))||!value.channels.length||!value.channels.every(item=>item==="*"||!!resolveChannel(item,editor.document.customChannels))||(value.fulfillments!==undefined&&(!Array.isArray(value.fulfillments)||!value.fulfillments.length||!value.fulfillments.every(item=>["supplier","merchant","platform"].includes(item)))))throw new Error("能力须为非空字符串；渠道须填写已注册 ID 或通用标记 *，动作影响和履约方式须使用支持的枚举值。");
      if(!Object.values(value.parameterSchema).every(validParameterSchema))throw new Error("参数需声明有效类型和文本名称；描述须为文本，默认值、枚举值及数值上下限必须一致。");
      const problems=compatibility(value);if(problems.length)throw new Error(problems.join("；"));
      editor.onRegister(value);setLocalSkills(current=>[...current,value]);choose(value);setTab("implementation");setMessage("已加入当前草稿并选中；请应用到节点，再校验完整流程。");
    }catch(error){setMessage(error instanceof Error?error.message:"Manifest 格式无效。");}
  };
  return createPortal(<dialog ref={dialog} className={`${styles.dialog} ${skillStyles.dialog}`} onCancel={onClose} onClick={event=>{if(event.target===event.currentTarget)onClose();}} aria-labelledby="skill-inspector-title">
    <header className={styles.dialogHeader}><div><span className={styles.eyebrow}>运营流程 / 步骤设置</span><h2 id="skill-inspector-title">{instance.title}</h2><p>{operatorPolicy.description}</p></div><Button variant="ghost" onClick={onClose} aria-label="关闭节点配置">×</Button></header>
    <div className={skillStyles.summary}><NodeAccess mode={operatorPolicy.mode} label={operatorPolicy.implementationKind==="adapter"?"接口接入":undefined}/><strong>{operatorPolicy.implementationKind==="adapter"?"复用已配置接口，系统检查与授权不可绕过":operatorPolicy.mode==="fixed"?"执行规则由系统管理":operatorPolicy.mode==="parameters"?"只调整开放参数，执行规则保持不变":"可以更换策略，不能绕过系统检查"}</strong></div>
    <nav className={styles.tabs} aria-label="节点配置分区">
      <Button variant="ghost" aria-pressed={tab==="operation"} onClick={()=>setTab("operation")}>{operatorPolicy.mode==="fixed"?"步骤说明":"运营设置"}</Button>
      {technical&&[["implementation","实现与参数"],["contract","输入输出"],["execution","执行约定"],["custom","自建 Skill"]].filter(([id])=>!["implementation","custom"].includes(id)||canReplace).map(([id,label])=><Button key={id} variant="ghost" aria-pressed={tab===id} onClick={()=>{setTab(id);setMessage("");}}>{label}</Button>)}
      <Button className={skillStyles.technicalToggle} variant="ghost" aria-pressed={technical} onClick={()=>{setTechnical(!technical);setTab("operation");}}>{technical?"收起技术细节":"技术细节 ↗"}</Button>
    </nav>
    <div className={`${styles.dialogBody} ${skillStyles.body}`}>
      {tab==="operation"&&<>
        {definition?.kind==="approval"&&<div className={styles.infoBox}><Switch checked={instance.binding.parameters.approvalEnabled!==false} onCheckedChange={enabled=>changeParameter("approvalEnabled",enabled)}>启用人工审核</Switch><p>{instance.binding.parameters.approvalEnabled===false?"已关闭：该节点不等待人工确认，按配置继续。系统校验、接口权限和 Skill 审核仍保留。":"已开启：流程到此暂停，等待你确认后继续。"}</p><small>本机桌面版按冻结开关执行，市场证据和工厂供货不额外强制审核；团队部署仍需审核。采购、付款和广告投放不因此获得权限。</small></div>}
        <div className={skillStyles.outcome}><small>这一步完成后</small><strong>{operatorPolicy.result}</strong></div>
        {instance.definitionId==="listing.publish"&&<div className={styles.infoBox}><strong>只提交已审核的商品，不重新生成接口或内容</strong><p>继承任务市场：{String(productTaskParameters(editor.document,instance.id)?.market??"未设置")} · 核算币种：{String(productTaskParameters(editor.document,instance.id)?.requestedCurrency??"未设置")}。映射草案不是执行 Skill；下一步查询真实可售结果。</p><small>接口异常或超时表示结果未知：先用原幂等键核查回执，不直接重复创建商品。</small></div>}
        {["product.verify","product.normalize","product.filter","product.delivery","product.decide","product.cost"].includes(instance.definitionId)&&<div className={styles.infoBox}><strong>继承第一步的任务条件 · 只读</strong><p>目标市场：{String(productTaskParameters(editor.document,instance.id)?.market??"未设置")} · 核算币种：{String(productTaskParameters(editor.document,instance.id)?.requestedCurrency??"未设置")}</p><small>修改任务条件请返回「定义商品任务」。这里展示配置，不是实际输入校验或采集结果。</small></div>}
        {instance.definitionId==='product.verify'&&<div className={styles.infoBox}><h3>统一核验清单</h3><ol><li>资料与规格：标识一致，价格、SKU、原图和必要字段完整。</li><li>供货与库存：按第一步最低库存和工厂供货条件核验。</li><li>配送与成本：真实线路、运费、备货时间、最长总时效及价格契约。</li><li>合格目标：每款至少一个规格全部通过；不合格记录原因并补选，不自动减量。</li></ol>{selectionRuleGroups.map(group=><details key={group.title}><summary>{group.title} · 继承配置</summary>{group.keys.map(key=><p key={key}>{getSkill('product.start.core',editor.document)?.parameterSchema[key]?.label??key}：{String(marketTaskParameters(editor.document)[key]??'未设置')}</p>)}</details>)}</div>}
        {instance.definitionId==="product.collect"&&<>
          <div className={styles.infoBox}><strong>商品来源固定为 CJ</strong><p>独立站、亚马逊及其他销售渠道共用此采集步骤。不选择 Skill，不重复配置任务条件；实际采集方式、字段映射及请求逻辑以后由后端实现。</p></div>
          {instance.binding.skillId!=="product.collect.core"&&<div className={skillStyles.errors} role="alert"><p>这是旧版采集绑定，当前不可用于预览。请先导出保留旧草稿，再从当前「选品到上线」模板重新建立流程；不会自动覆盖原设置。</p></div>}
          <div className={styles.infoBox}><strong>来自第一步「定义商品任务」的参数</strong>{productCollectionTaskParameters(editor.document,instance.id)?<dl className={skillStyles.detailGrid}>{Object.entries(productCollectionTaskParameters(editor.document,instance.id)!).map(([key,value])=><div key={key}><dt>{{candidateSource:"候选商品来源",market:"销售目标国家",categoryId:"旧单类目 ID",categoryQueries:"CJ 多类目（取并集）",keyword:"选品关键词",emptyResultPolicy:"无结果处理",limit:"候选商品上限",requestedCurrency:"任务核算币种"}[key]??key}</dt><dd>{key==="categoryQueries"&&Array.isArray(value)?(value.length?value.map(q=>`${q.categoryId}${q.keyword?` · 关键词 ${q.keyword}`:" · 不限关键词"}`).join("；"):"不限类目"):key==="candidateSource"?(value==="trending"?"CJ 热门候选（不是销量排行榜）":"CJ 全目录匹配"):key==="emptyResultPolicy"?(value==="drop_keyword_once"?"去掉关键词重试一次":"暂停，等待调整"):String(value===""?(key==="categoryId"?"未指定（多选时见多类目）":"未填写"):value??"未设置")}{key==="limit"?" 条":""}</dd></div>)}</dl>:<p>未找到上游商品任务，请检查主流程。</p>}<p>要修改条件，请返回第一步。销售国家不作为 CJ 仓库国家筛选；零结果、类目失效与连接错误分开处理。</p></div>
          <div className={styles.infoBox}><strong>只读试搜与完整 CJ 主线</strong><p>试搜仅预览；点击运行流程后，后端按冻结参数独立采集、核验、核算，并将真实证据传给后续节点。</p><Link className="ui-button ui-button--secondary" href="/connections/cj" target="_blank" rel="noopener noreferrer">配置 CJ 供应源 ↗</Link></div>
        </>}
        {operatorPolicy.mode==="fixed"?<div className={skillStyles.lockedPanel}><NodeAccess mode="fixed"/><h3>规则可查看，不可由运营改写</h3><p>不能替换执行逻辑、删除此步骤或跳过必要检查。渠道连接由技术人员配置，实际执行权限由后端管理。</p><ol><li>{operatorPolicy.description}</li><li>未获得真实结果时，不继续下一个业务动作。</li><li>策略建议不能代替系统授权或真实业务状态。</li></ol></div>:<>
{operatorPolicy.implementationKind==="adapter"&&<div className={styles.infoBox}><strong>{storeAction?"共用店铺连接 · 按动作调用接口包":"独立服务接口 · 不继承店铺权限"}</strong><p>{storeAction?`调用能力：${instance.definitionId} · ${connection.source==="override"?"使用单节点覆盖": "继承统一店铺接入"}`:definition?.description}</p><p>{connection.reference?`连接引用：${connection.reference}（设计声明，尚未真实验收）`:storeAction?"尚未声明此能力或连接引用，请先配置店铺接入。":"需要独立的服务适配与授权；广告、仓库和供应商不能借用店铺连接。"}</p>{storeAction&&<Button onClick={editor.onConfigureStore}>配置店铺接入 ↗</Button>}<Button variant="ghost" aria-expanded={adapterAdvanced} onClick={()=>setAdapterAdvanced(!adapterAdvanced)}>{adapterAdvanced?"收起单节点高级配置":instance.definitionId==="listing.publish"?"高级：连接与接口清单":"高级：覆盖此节点接口"}</Button>{storeAction&&instance.binding.connectionRef&&<Button variant="ghost" onClick={()=>setInstance(current=>({...current,binding:{...current.binding,connectionRef:undefined}}))}>恢复继承店铺连接</Button>}<p>系统仍负责契约、审批与幂等，不通过 Skill 获得执行授权。</p></div>}
{operatorPolicy.mode==="skill"&&(operatorPolicy.implementationKind!=="adapter"||adapterAdvanced||instance.definitionId==="listing.publish")&&<div className={skillStyles.strategyPicker}><label>{operatorPolicy.implementationKind==="adapter"&&instance.definitionId!=="listing.publish"?"覆盖接口实现（高级）":"使用哪个策略 / Skill"}<SelectField aria-label={operatorPolicy.implementationKind==="adapter"?"接口 Skill":"运营策略"} value={instance.binding.skillId} onChange={event=>{const skill=available.find(item=>item.id===event.target.value);if(skill)choose(skill);}}>{skillOptions()}</SelectField></label><div><Button compact disabled={registryLoading} onClick={refreshRegistry}>{registryLoading?"读取注册版本…":"刷新已注册 Skill"}</Button> <Link href="/skills" target="_blank" rel="noopener noreferrer">管理我的技能 ↗</Link></div>{registryError&&<p role="alert">{registryError}；本地草稿不作为已注册技能。</p>}<p>已注册版本按契约匹配；此设计器仍为模拟，真实执行范围以服务端为准。</p><p>{operatorPolicy.implementationKind==="adapter"?(instance.definitionId==="listing.publish"?"选择已制作并注册的上架执行 Skill；接口生成规则不在运行时执行。":"仅特殊适配需求使用；这是运行接口描述，不是一次性接入生成 Skill。"):"可选脚本、AI 或人工策略；输出仍需经过后续系统检查。"}</p></div>}
          {operatorPolicy.implementationKind==="adapter"&&adapterAdvanced&&<div className={styles.infoBox}><label className={styles.field}>单节点连接覆盖<Input aria-label="接口连接引用" value={instance.binding.connectionRef??""} placeholder={storeAction?"留空继承店铺连接":"填写独立服务连接引用（非密钥）"} onChange={event=>setInstance(current=>({...current,binding:{...current.binding,connectionRef:event.target.value}}))}/></label><Button onClick={()=>{setTechnical(true);setTab("custom");}}>配置自建接口 Skill</Button></div>}
          {selected&&Object.keys(selected.parameterSchema).some(key=>!operatorHiddenParameters.has(key)&&key!=="approvalEnabled")&&<h3>{operatorPolicy.implementationKind==="adapter"?"本次动作参数":operatorPolicy.mode==="parameters"?"你可以调整的参数":"本次策略设置"}</h3>}
          {operatorPolicy.mode==='parameters'&&<p className={styles.muted}>未设置的参数已补入推荐起步值；你已有的设置不覆盖。点击“应用到节点”并保存流程后生效，不改变正在运行的版本。</p>}
          {instance.definitionId==='product.cost'&&<div className={styles.infoBox}><strong>费用是启动预算假设，不是已核实账单</strong><p>独立站起步按平台费 0%、支付费 3%、退货预留 5%、税费及附加费每件 $2、目标贡献率 30% 填入。请按店铺费率和商品核实；不含固定交易费及未提供的获客成本，不代表净利润或税费结论。已有自定义数值优先。</p></div>}
          {instance.definitionId==='product.filter'&&<p className={styles.muted}>工厂供货默认关闭。开启时备货 3 天、限售 5 件仅是起步假设，须向供应商确认；不代表库存或发货承诺。桌面版人工审核由节点开关决定。</p>}
          {instance.definitionId==="listing.publish"&&selected&&!Object.keys(selected.parameterSchema).length&&<p className={styles.muted}>此实现没有额外业务参数；商品字段来自已审核草稿，认证与店铺参数来自连接，不在此重新填写。</p>}
          {instance.definitionId==="listing.publish"&&<details className={styles.infoBox}><summary>首次接入 / 接口变更 · 开发指南</summary><PublishingSkillSetup channel={environment.channel} mode={environment.storeIntegration?.apiMode??"existing-api"} onModeChange={()=>{}} readOnlyMode actions={environment.storeIntegration?.actions} showFlow={false}/></details>}
{instance.definitionId==='product.start'&&<div className={`${styles.infoBox} ${styles.selectionBasis}`}><h3>选品依据</h3><strong>{evidenceSource==='cj'?'CJ 订单与供货数据 · 默认':evidenceSource==='external'?'目标市场证据 + CJ 供货数据':'供货、成本与时效 · 不参考销量'}</strong>
  <p>{evidenceSource==='cj'?'读取 CJ 商品订单数并结合库存、配送和成本评估。订单数统计周期和国家未声明，不是近90天卖出件数；刊登数不参与需求评分。':evidenceSource==='external'?'使用你导入的目标市场证据，结合 CJ 供货、配送和成本评估；当前不自动采集第三方市场数据。':'只评估供货、成本、时效与库存，不判断市场需求或好不好卖。后续上架仍须经过原流程的检查与审核。'}</p>
  {evidenceSource==='cj'&&<small>订单数由 CJ 自动读取，无需填写。需求权重最高（45%）；缺订单数时标记待研究，不填 0，不冒充90天销量。</small>}
  <details open={basisAdvanced} onToggle={event=>setBasisAdvanced(event.currentTarget.open)}><summary>其他选品依据 · 高级设置</summary><label>选择选品依据<SelectField aria-label="选品依据" value={evidenceSource} onChange={event=>changeParameter('marketEvidenceSource',event.target.value)}><option value="cj">CJ 订单与供货数据（默认）</option><option value="external">导入目标市场证据</option><option value="none">供货评估（不参考销量）</option></SelectField></label>
  {evidenceSource==='cj'&&selected&&<><p>以下是最低订单数门槛，默认 1，不是手填实际订单数。默认保留当前值；低于门槛的商品会记录淘汰原因，无需为了运行而调整。</p><ParameterFields skill={selected} instance={instance} onChange={changeParameter} keys={['minimumCJOrderCount']}/></>}
  {evidenceSource==='external'&&<MarketEvidencePicker value={String(instance.binding.parameters.marketEvidenceRef??'')} onChange={value=>changeParameter('marketEvidenceRef',value)}/>}</details>
  <small>{basisNeedsSync?`应用后同步绑定：${basisStrategy?.label??'请选择依据'} ${basisStrategy?.version??''}；来源切换会替换评估策略，其他参数与已有运行不变。`:'已配置的评估策略保持不变；不需要额外点击绑定按钮。'}</small>
</div>}
          {instance.definitionId==='product.decide'&&selected?.version==='3.0.0'&&<div className={styles.infoBox}><strong>CJ 自动证据 · 继承定义商品任务</strong><p>使用采集阶段的 CJ 平台近 90 天销量及真实履约成本评分。无需上传证据、选择模型或重复填写凭证；缺少销量时停在资料核验，不自动上架。</p></div>}
          {instance.definitionId==='market.intelligence'&&<IntelligenceSettings parameters={instance.binding.parameters} onChange={patch=>setInstance(current=>({...current,binding:{...current.binding,parameters:{...current.binding.parameters,...patch}}}))}/>}
          {instance.definitionId==="product.start"&&(intelligenceEnabled(editor.document)?<div className={styles.infoBox}><h3>商品方向 · 继承行情首节点</h3><p>按首节点已确认的 CJ 供货类目查询，不重复填写类目或搜索词。原搜索词保留，关闭行情首节点后恢复使用。</p><p>需要修改搜索方向，请返回「采集市场类目排行」。这里继续配置合格目标、候选额度、库存、配送、费用与策略。</p><FinalSelectionInfo parameters={instance.binding.parameters} onChange={patch=>setInstance(current=>({...current,binding:{...current.binding,parameters:{...current.binding.parameters,...patch}}}))}/></div>:<ProductTaskFields parameters={instance.binding.parameters} onChange={patch=>setInstance(current=>({...current,binding:{...current.binding,parameters:{...current.binding.parameters,...patch}}}))}/>)}
          {instance.definitionId==='product.decide'&&selected?.version==='2.0.0'&&selected.id.startsWith('registered.')&&<div className={styles.infoBox}><strong>继承定义商品任务 · 不重复搜索或配置数据源</strong><p>市场证据：{String(effectiveNodeParameters(editor.document,instance).marketEvidenceRef||'尚未选择，请返回第一步配置')}。这里结合前面查到的 CJ 库存、运费与成本执行评分、建议售价；不是再次采集销量。</p>{!marketTaskParameters(editor.document).marketEvidenceRef&&!!instance.binding.parameters.marketEvidenceRef&&<p>旧草稿仍使用原节点证据；如要前置试搜，请在第一步选择同一证据。系统不会自动改写旧配置。</p>}</div>}
{selected&&instance.definitionId!=='market.intelligence'&&<ParameterFields skill={selected} instance={instance} onChange={changeParameter} keys={(operatorPolicy.mode==="parameters"?operatorPolicy.editableParameters:Object.keys(selected.parameterSchema).filter(key=>!operatorHiddenParameters.has(key))).filter(key=>key!=="approvalEnabled"&&key!=='marketEvidenceRef'&&key!=='marketEvidenceSource').filter(key=>instance.definitionId!=='product.decide'||selected.version!=='2.0.0'||key!=='allowEstimatedSales').filter(key=>instance.definitionId!=="product.start"||!selectionRuleKeys.has(key)&&!productSearchFields.has(key)&&!(key==="allowEstimatedSales"&&evidenceSource!=="external")&&key!=="minimumCJSales90d"&&key!=="minimumCJOrderCount"&&key!=="demandFirstCollection"&&key!=="batchPublishing")}/>}
{instance.definitionId==='product.start'&&selected&&selectionRuleGroups.map(group=><section className={styles.infoBox} key={group.title}><h3>{group.title}</h3><ParameterFields skill={selected} instance={instance} onChange={changeParameter} keys={group.keys}/>{group.title==='费用与经营目标'&&<small>费用均为运营假设，不是实际账单；税费须明确，广告前贡献不等于净利润。</small>}{group.title==='库存与供货条件'&&<small>工厂供货默认关闭；启用须确认备货天数和限售量，报量不当作已核实现货。本机桌面版按审核开关执行，团队部署仍需人工确认。</small>}</section>)}
{instance.definitionId==='product.start'&&<section className={styles.infoBox}><h3>选品与定价策略</h3><label className={styles.field}>使用哪个策略 / Skill<SelectField aria-label="选品与定价策略" value={basisRegistered?.manifest?.id??strategyChoice} onChange={event=>setStrategyChoice(event.target.value)}>{!strategyRows.some(row=>row.manifest?.id===strategyChoice)&&<option value={strategyChoice} disabled>{registryLoading?'正在核对注册策略…':'当前策略待核验'}</option>}{strategyRows.map(row=><option key={row.id} value={row.manifest!.id}>{row.manifest!.name} · v{row.version}</option>)}</SelectField></label><p>统一核验内部执行策略，整理合格商品与建议售价；系统按这里的费用条件独立复核后，再交给你确认。不会增加第二轮搜索或替你批准发布。</p>{registryError&&<p role="alert">{registryError}</p>}<Button compact onClick={()=>void refreshRegistry()} disabled={registryLoading}>刷新已注册策略</Button></section>}
          {operatorPolicy.mode==="parameters"&&<p className={styles.muted}>仅这些参数可以修改。数据检查、计算方法与授权条件不随参数编辑而改变。</p>}
          {operatorPolicy.mode==="skill"&&editor.onEndHere&&<div className={skillStyles.nodeActions}><Button onClick={()=>{editor.onEndHere?.();onClose();}}>本次任务到这里结束</Button><small>仅保留到此步骤的结果，不继续上架、投放或履约。</small></div>}
        </>}
        {!selected&&<div className={styles.infoBox}><strong>此渠道尚未配置这一步</strong><p>{operatorPolicy.mode==="skill"?"请选择兼容策略，或由技术人员添加实现。":"需要技术人员接入渠道实现；不能借用其他平台的接口。"}</p></div>}
      </>}
      {tab==="implementation"&&canReplace&&<><div className={styles.formRow}><label>节点名称<Input aria-label="节点名称" readOnly={operatorPolicy.mode!=="skill"} value={instance.title} maxLength={80} onChange={event=>setInstance(current=>({...current,title:event.target.value}))}/></label><label>执行实现<SelectField aria-label="执行实现" value={instance.binding.skillId} onChange={event=>{const skill=available.find(item=>item.id===event.target.value);if(skill)choose(skill);}}>{skillOptions()}</SelectField></label></div>{!selected&&<div className={styles.infoBox}><strong>该渠道尚无默认实现</strong><p>只能配置兼容的渠道适配器，不允许改写这个步骤的职责或绕过授权。</p></div>}<p className={styles.muted}>{selected?.description}</p>{selected&&<ParameterFields skill={selected} instance={instance} onChange={changeParameter}/>}</>}
      {tab==="contract"&&<><div className={styles.contract}><div><small>节点要求的输入</small><code>{definition?.input}</code></div><span>→</span><div><small>必须交付的输出</small><code>{definition?.output}</code></div></div><div className={styles.infoBox}><strong>执行实现的契约</strong><p><code>{selected?.input} → {selected?.output}</code></p><small>{operatorPolicy.mode==="skill"?"兼容契约的策略可以更换。":"此节点受系统执行规则约束，同契约不代表允许替换实现。"}输出字段通过校验，不代表商品事实、库存或平台状态已经确认。</small></div><div className={styles.infoBox}><strong>{instance.definitionId==="product.collect"?"上游任务参数预览（非运行结果）":"参数预览"}</strong><pre className={skillStyles.code}>{JSON.stringify(instance.definitionId==="product.collect"?productCollectionTaskParameters(editor.document,instance.id):instance.binding.parameters,null,2)}</pre></div></>}
      {tab==="contract"&&definition&&[definition.input,definition.output].map((contract,index)=><div key={`${contract}-${index}`} className={styles.infoBox}><strong>{index===0?"输入":"输出"}结构示例 · {contract}</strong><pre className={skillStyles.code}>{contract==="$context"?"透传前序输出：保留上游结果的契约与数据，不改变业务结构。":contractExamples[contract]?JSON.stringify(contractExamples[contract],null,2):"暂无示例。此处仅声明契约版本，未连接运行时业务数据。"}</pre>{contractSchemas[contract]&&<details><summary>查看 {contract} 的 Schema 草案</summary><p>仅为字段结构草案；此处未运行 Pydantic，也未验证实际业务数据。</p><pre className={skillStyles.code}>{JSON.stringify(contractSchemas[contract],null,2)}</pre><Button compact aria-label={`下载${index===0?"输入":"输出"} ${contract} Schema 草案`} onClick={()=>downloadContractSchema(contract)}>下载 Schema 草案</Button></details>}</div>)}
      {tab==="execution"&&<><div className={skillStyles.detailGrid}><div><small>运行方式</small><strong>{selected?runtimeNames[selected.runtime]:"—"}</strong></div><div><small>适用渠道</small><strong>{selected?.channels.join(" · ")}</strong></div></div><label className={styles.field}>执行入口引用<code className={skillStyles.entry}>{selected?.entrypointRef||"未指定"}</code></label><div className={styles.infoBox}><strong>所需能力</strong><p>{selected?.capabilities.join(" · ")||"无额外能力"}</p><strong>声明的动作影响</strong><pre className={skillStyles.code}>{JSON.stringify(selected?.effects??[],null,2)}</pre></div><p className={styles.muted}>执行入口仅声明未来后端 worker 的映射。本页不会执行脚本、调用模型或生成图片；流程定义校验也不等于运行时数据校验。</p></>}
      {tab==="execution"&&<><label className={styles.field}>账户连接引用<Input disabled={!canReplace} aria-label="账户连接引用" value={executionBinding.connectionRef??""} placeholder="例如 shop.primary；请勿填入密钥" onChange={event=>setInstance(current=>({...current,binding:{...current.binding,connectionRef:event.target.value}}))}/></label><div className={skillStyles.parameters}><label>超时（秒）<Input disabled={operatorPolicy.mode!=="skill"} aria-label="执行超时秒数" type="number" min={1} max={600} value={execution.timeoutSeconds} onChange={event=>setExecution({timeoutSeconds:Number(event.target.value)})}/></label><label>最多重试次数<Input aria-label="最多重试次数" type="number" min={0} max={3} disabled={operatorPolicy.mode!=="skill"||execution.retryMode==="never"} value={execution.maxRetries} onChange={event=>setExecution({maxRetries:Number(event.target.value)})}/></label><label>重试约定<SelectField disabled={operatorPolicy.mode!=="skill"} aria-label="重试约定" value={execution.retryMode} onChange={event=>setExecution({retryMode:event.target.value as "safe"|"never",maxRetries:event.target.value==="never"?0:execution.maxRetries})}><option value="never">不自动重试</option><option value="safe">仅在可安全重试时</option></SelectField></label></div><div className={skillStyles.nodeActions}>{editor.onMove&&<><Button disabled={editor.document.nodes[0]?.id===instance.id} onClick={()=>{editor.onMove?.(-1);onClose();}}>上移节点</Button><Button disabled={editor.document.nodes.at(-1)?.id===instance.id} onClick={()=>{editor.onMove?.(1);onClose();}}>下移节点</Button></>}{editor.onRemove&&<Button onClick={()=>{editor.onRemove?.();onClose();}}>删除节点</Button>}{editor.onEndHere&&<><Button onClick={()=>{editor.onEndHere?.();onClose();}}>在此交付结果</Button><small>保留当前及之前节点，移除后续步骤并追加结果终点。</small></>}<small>调整位置或删除只修改流程结构，本窗口未应用的参数不会保存。</small></div></>}
      {tab==="custom"&&<><div className={skillStyles.customHead}><div><h3>创建兼容的 Skill 清单</h3><p>保留输入输出契约，声明当前渠道、运行方式和实际实现入口。</p></div><Button onClick={cloneManifest} disabled={!selected&&!available.length}>{selected?"复制为自建 Skill":"生成 Skill 清单草案"}</Button></div><label>Skill manifest<textarea className={skillStyles.manifest} spellCheck={false} value={manifestText} onChange={event=>setManifestText(event.target.value)} rows={15} placeholder="点击上方按钮生成可编辑的 manifest"/></label><p className={styles.muted}>渠道使用注册 ID，通用实现使用 *。注册仅加入当前流程草稿；脚本、模型和媒体工具仍需在后端部署，清单不能自行获得权限。</p><Button disabled={!manifestText.trim()} onClick={register}>注册到草稿并选用</Button></>}
      {issues.length>0&&(operatorPolicy.mode!=="fixed"||technical)&&<div className={skillStyles.errors} role="alert">{issues.map((issue,index)=><p key={`${issue}-${index}`}>{issue}</p>)}</div>}
    </div><footer className={styles.dialogFooter}><span role="status">{message||issues[0]||(operatorPolicy.mode==="fixed"&&!technical?"此步骤只读，关闭不会更改规则。":technical?"技术视图只是本地设计，不授予执行权限。":"保存设置后，需重新检查流程。")}</span><Button onClick={onClose}>{operatorPolicy.mode==="fixed"&&!technical?"关闭":"取消"}</Button>{(operatorPolicy.mode!=="fixed"||technical&&isChannelAdapter(instance.definitionId))&&<Button variant="primary" disabled={issues.length>0||!instance.title.trim()} onClick={()=>{if(basisNeedsSync&&basisRegistered?.manifest)editor.onConfigureBasis?.({...instance,binding:{...instance.binding,parameters:{...instance.binding.parameters,marketEvidenceSource:evidenceSource}}},basisRegistered.manifest);else editor.onApply(instance,selected?.id.startsWith("registered.")?selected:undefined);onClose();}}>应用到节点</Button>}</footer>
  </dialog>,document.body);
}
type EditorProps = {document:WorkflowDocument;instance:NodeInstance;onApply:(instance:NodeInstance,registeredManifest?:SkillManifest)=>void;onConfigureBasis?:(instance:NodeInstance,manifest:SkillManifest)=>void;onRegister:(skill:SkillManifest)=>void;onConfigureStore?:()=>void;onRemove?:()=>void;onMove?:(direction:-1|1)=>void;onEndHere?:()=>void};
type InspectorProps = {onClose:()=>void;readOnly?:boolean} & ({editor:EditorProps;node?:never;config?:never;onSave?:never}|{editor?:undefined;node:WorkflowNode;config:NodeConfig;onSave:(config:NodeConfig)=>void});
export function NodeInspector(props:InspectorProps) {
  if(props.editor) return <SkillInspector key={props.editor.instance.id} editor={props.editor} onClose={props.onClose}/>;
  return <LegacyNodeInspector {...props}/>;
}
function LegacyNodeInspector({node,config,onSave,onClose,readOnly=false}:{node:WorkflowNode;config:NodeConfig;onSave:(config:NodeConfig)=>void;onClose:()=>void;readOnly?:boolean}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const [tab,setTab]=useState("skill");
  const [draft,setDraft]=useState(config);
  const [message,setMessage]=useState("");
  const ai=node.kind==="ai";
  const selectedSkill=skills.find(skill=>skill.id===draft.skill);
  const compatible=!!selectedSkill&&((selectedSkill.input===node.input&&selectedSkill.output===node.output)||(node.passthrough===true&&selectedSkill.input==="$context"&&selectedSkill.output==="$context"));
  const valid=compatible&&draft.prompt.trim().length>0&&Number(draft.timeout)>0&&Number(draft.timeout)<=600&&Number.isInteger(Number(draft.retries))&&Number(draft.retries)>=0&&Number(draft.retries)<=3;
  useEffect(()=>{dialog.current?.showModal();},[]);
  const field=(key:keyof NodeConfig,value:string)=>{setDraft(current=>({...current,[key]:value}));setMessage("")};
  return createPortal(<dialog ref={dialog} className={styles.dialog} onCancel={onClose} onClick={event=>{if(event.target===event.currentTarget)onClose()}} aria-labelledby="workflow-inspector-title">
    <header className={styles.dialogHeader}><div><span className={styles.eyebrow}>{ai?"AI STUDIO / 可插拔能力":kindLabels[node.kind]}</span><h2 id="workflow-inspector-title">{node.title}</h2><p>{node.description}</p></div><Button variant="ghost" onClick={onClose} aria-label="关闭配置窗口">×</Button></header>
    {ai&&<div className={styles.studioPipeline}><span>01 输入校验</span><i>→</i><strong>02 Skill 推理 / 工具</strong><i>→</i><span>03 输出校验</span></div>}
    {ai&&<nav className={styles.tabs} aria-label="AI 配置分区">{[["skill","Skill 与参数"],["contract","输入与输出"],["runtime","运行策略"]].map(([id,label])=><Button key={id} variant="ghost" aria-pressed={tab===id} onClick={()=>setTab(id)}>{label}</Button>)}</nav>}
    <fieldset disabled={readOnly} className={styles.dialogBody} style={{border:0,margin:0,minWidth:0}}>
      {ai&&tab==="skill"&&<><div className={styles.formRow}><label>绑定 Skill<SelectField value={draft.skill} onChange={event=>{const skill=skills.find(item=>item.id===event.target.value);setDraft(current=>({...current,skill:event.target.value,prompt:skill?.prompt??""}));setMessage("")}}>{skills.map(skill=><option key={skill.id} value={skill.id}>{skill.name} · v{skill.version}</option>)}</SelectField></label><label>目标市场<Input value={draft.market} onChange={event=>field("market",event.target.value)}/></label></div><p className={compatible?styles.successText:styles.errorText}>{compatible?"✓ 当前 Skill 与节点的输入输出契约兼容":"此 Skill 的输入输出不兼容，无法应用到当前节点。"}</p><label className={styles.field}>任务指令<textarea value={draft.prompt} onChange={event=>field("prompt",event.target.value)} rows={5}/></label><div className={styles.infoBox}><strong>可调用工具</strong><p>{selectedSkill?.tools}</p><small>当前仅配置预览。Skill 负责建议或内容，业务节点负责发布、付款及发送。</small></div></>}
      {(!ai||tab==="contract")&&<><div className={styles.contract}><div><small>固定输入</small><code>{node.input}</code></div><span>→</span><div><small>结构化输出</small><code>{node.output}</code></div></div><p className={styles.muted}>固定的是字段契约与版本，不是每次运行的数据。Pydantic 负责结构校验，不能证明商品事实或替代业务决策。</p><h3>这个节点实际做什么</h3><ol className={styles.steps}>{node.steps.map(step=><li key={step}>{step}</li>)}</ol>{node.event&&<div className={styles.infoBox}><strong>等待：{node.event}</strong><p>事件按业务 ID 关联后恢复；等待期间不执行下游，超时进入异常处理。</p></div>}{node.alternate&&<div className={styles.infoBox}><strong>{node.alternate.label}</strong><p>{node.alternate.result}</p></div>}</>}
      {ai&&tab==="runtime"&&<><label className={styles.field}>模型连接<SelectField value={draft.model} onChange={event=>field("model",event.target.value)}><option>默认模型连接</option><option>高质量模型连接</option><option>低成本模型连接</option></SelectField></label><div className={styles.formRow}><label>超时（秒）<Input type="number" min="1" max="600" value={draft.timeout} onChange={event=>field("timeout",event.target.value)}/></label><label>输出校验重试次数<Input type="number" min="0" max="3" value={draft.retries} onChange={event=>field("retries",event.target.value)}/></label></div><div className={styles.infoBox}><strong>输出必须通过契约校验</strong><p>超时、工具失败或输出无效时停止本节点，超过重试次数转人工。禁止将模型响应直接当作付款或发布授权。</p><small>这些连接和策略是前端草案，尚未接入模型服务。</small></div></>}
    </fieldset>
    <footer className={styles.dialogFooter}><span role="status">{readOnly?"已校验版本只读。请返回流程设计器修改并重新校验。":message||"配置仅保存在当前页面会话"}</span>{ai&&!readOnly?<><Button disabled={!valid} onClick={()=>setMessage("配置校验通过；未调用模型或工具。")}>校验配置</Button><Button variant="primary" disabled={!valid} onClick={()=>{onSave(draft);setMessage("已应用到当前节点（前端会话）")}}>应用配置</Button></>:<Button variant="primary" onClick={onClose}>返回流程</Button>}</footer>
  </dialog>,document.body);
}

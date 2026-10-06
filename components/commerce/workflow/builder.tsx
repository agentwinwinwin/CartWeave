"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Icon, type IconName } from "@/components/ui/icon";
import { SelectField } from "@/components/ui/select-field";
import { PageHeader } from "@/components/app/page-header";
import { WorkflowCanvas, WorkflowWorkspace } from "./workspace";
import { WorkflowCard } from "./workflow-card";
import { NodeInspector } from "./node-inspector";
import { ChannelManager } from "./channel-manager";
import { StoreConnection } from "./store-connection";
import {MappingNodeWindow} from "./mapping-node-window";
import {ModelConnectionsWindow} from './model-connections-window';
import {PublishingNodeWindow} from './publishing-node-window';
import {CustomerSupportWindow} from './customer-support-window';
import {LiveWorkflow} from './live-workflow';
import {addIntelligenceNode,updateCustomerSupportDraft} from '@/lib/workflow/universal';
import {BackendRequestError,backendRequest} from '@/lib/workflow/backend-client';
import {bindDefaultRuntimeSkills,needsDefaultRuntimeSkills,applySelectionBasis} from '@/lib/workflow/default-runtime-skills';
import type {RegisteredSkill} from '@/lib/skills/personal';
import { NodeAccess } from "./node-access";
import { applyOperatorNodeSettings, canOperatorEditStructure, getNodeOperatorPolicy } from "@/lib/workflow/operator-policy";
import { createWorkflow, defaultParameters, defaultSkillFor, forwardEdges, getDefinition, isChannelAdapter, nodeDefinitions, rebindChannel, toWorkflowPreview, workflowTemplates, type Channel, type Fulfillment, type NodeInstance, type PreviewValidationResult, type SkillManifest, type WorkflowDocument } from "@/lib/workflow/universal";
import { parseWorkflowDocument, salesChannelDesignClient, workflowDesignClient } from "@/lib/workflow/client";
import {savedDesigns,saveDesign,freezeDesign,type SavedDesign,type FrozenDesign} from '@/lib/workflow/saved-config';
import {refreshCompatiblePublicationPackage,reuseSavedStoreConnection,type PublishingStore,type PublishingPackage} from '@/lib/workflow/store-publishing';
import { builtinChannels, defaultChannelId, getChannels, resolveChannel, validateSalesChannel, type SalesChannelDefinition } from "@/lib/workflow/channels";
import shared from "./workflow.module.css";
import styles from "./builder.module.css";

const runtimes = [
  ["script", "⌘", "脚本", "稳定的采集、转换、评分与核算。"],
  ["connector", "↗", "API / 连接器", "读取平台数据，提交批准的操作。"],
  ["llm", "✧", "模型", "理解证据、研究机会、生成内容。"],
  ["media", "◈", "素材工具", "返回素材引用和生成记录。"],
  ["composite", "⋈", "组合任务", "组合脚本、模型与工具完成任务。"],
  ["manual", "◎", "人工", "在流程中确认、选择或复核。"],
];
const fulfillmentNames: Record<Fulfillment, string> = { supplier: "供应商代发", merchant: "自有仓 / 3PL", platform: "平台履约观察" };
const workflowIcons:Record<string,IconName>={launch:'box','product-images':'sparkles',campaign:'arrow',fulfillment:'orders',optimize:'workflow',support:'chat'};

/** A document's channel metadata wins over the local directory for this draft. */
function combineChannelDirectory(documentChannels: SalesChannelDefinition[], localChannels: SalesChannelDefinition[]) {
  const merged = [...documentChannels];
  for (const channel of localChannels) if (!merged.some(item => item.id === channel.id || item.name.toLocaleLowerCase() === channel.name.toLocaleLowerCase())) merged.push(channel);
  return merged;
}

export function WorkflowBuilder({ library = false }: { library?: boolean }) {
  const router = useRouter();
  const [document, setDocument] = useState<WorkflowDocument | null>(() => library ? null : createWorkflow("launch"));
  const [selected, setSelected] = useState<string | null>(null);
  const [mappingOpen,setMappingOpen]=useState(false);
  const [modelConnectionsOpen,setModelConnectionsOpen]=useState(false);
  const [mappingNodeId,setMappingNodeId]=useState<string|null>(null);
  const [publishAdvanced,setPublishAdvanced]=useState(false);
  const [supportAdvanced,setSupportAdvanced]=useState(false);
  useEffect(()=>{
    const url=new URL(window.location.href);
    if(url.searchParams.get('configure')!=='mapping')return;
    // A Skill deep link is a one-time click intent, not persistent page state.
    url.searchParams.delete('configure');
    window.history.replaceState(window.history.state,'',`${url.pathname}${url.search}${url.hash}`);
    const navigation=performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming|undefined;
    if(navigation?.type!=='reload')setMappingOpen(true);
  },[]);
  const [preview, setPreview] = useState(false);
  const [result, setResult] = useState<PreviewValidationResult | null>(null);
  const [message, setMessage] = useState("");
  const [blockedNode,setBlockedNode]=useState<string|null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("flows");
  const [flowQuery,setFlowQuery]=useState("");
  const [technicalView, setTechnicalView] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [addDefinition, setAddDefinition] = useState("extension.review");
  const [insertAfter, setInsertAfter] = useState("");
  const [relationsOpen, setRelationsOpen] = useState(false);
  const [edgeSource, setEdgeSource] = useState("");
  const [edgeTarget, setEdgeTarget] = useState("");
  const [edgeKind, setEdgeKind] = useState<"feedback" | "collaboration">("collaboration");
  const [channelManagerOpen, setChannelManagerOpen] = useState<"existing" | "add" | null>(null);
  const [channelDirectory, setChannelDirectory] = useState<SalesChannelDefinition[]>([]);
  const [storeConnectionOpen, setStoreConnectionOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const serial = useRef(0);
  const savedRows=useRef<Record<string,SavedDesign>>({});
  const [configLoading,setConfigLoading]=useState(true);
  const [frozenConfig,setFrozenConfig]=useState<FrozenDesign|null>(null);
  const [runningConfig,setRunningConfig]=useState<FrozenDesign|null>(null);
  useEffect(()=>{
    if(!document||!needsDefaultRuntimeSkills(document))return;
    let active=true;
    void backendRequest<RegisteredSkill[]>('skills').then(registry=>{
      if(active)setDocument(current=>{
        if(!current)return current;
        try{return bindDefaultRuntimeSkills(current,registry);}catch{return current;}
      });
    }).catch(()=>{/* Saving retries and reports a truthful blocking error. */});
    return()=>{active=false;};
  },[document?.id]);
  const [runtimeVisible,setRuntimeVisible]=useState(false);
  const [runtimeRunId,setRuntimeRunId]=useState<string|null>(null);
  const [runtimeSession,setRuntimeSession]=useState(0);
  const rememberRun=useCallback((id:string)=>{
    setRuntimeRunId(id);
    if(!runningConfig)return;
    try{localStorage.setItem(`commerceos.current-workflow-run.v1:${runningConfig.document.id}`,JSON.stringify({runId:id,releaseId:runningConfig.id}));}
    catch{setMessage('运行已保存到后端；浏览器无法保存返回入口，可从真实运行记录查看。');}
  },[runningConfig]);
  useEffect(()=>{
    if(configLoading||!document||runningConfig)return;
    let active=true;const designId=document.id;
    void (async()=>{
      let runId:string|undefined,releaseId:string|undefined;
      try{
        const raw=localStorage.getItem(`commerceos.current-workflow-run.v1:${designId}`);
        if(raw){const value=JSON.parse(raw);if(typeof value.runId==='string'&&typeof value.releaseId==='string'&&value.runId.length<=100&&value.releaseId.length<=100){runId=value.runId;releaseId=value.releaseId;}}
      }catch{/* Browser references are optional; recover from the authorized backend. */}
      if(!runId){
        const runs=await backendRequest<Array<{id:string;release_id?:string;document:{id?:string};status:string}>>('runs');
        const latest=runs.find(r=>r.document.id===designId&&r.release_id);
        if(!latest)return;runId=latest.id;releaseId=latest.release_id;
      }
      const [release,run]=await Promise.all([backendRequest<FrozenDesign>(`workflow-releases/${encodeURIComponent(releaseId!)}`),backendRequest<{id:string;workflow_version_id:string}>(`runs/${encodeURIComponent(runId!)}`)]);
      if(release.document.id!==designId||run.workflow_version_id!==release.version_id)throw Error('当前运行与冻结配置不匹配');
      if(active){setRuntimeRunId(run.id);setRunningConfig(release);setRuntimeVisible(false);try{localStorage.setItem(`commerceos.current-workflow-run.v1:${designId}`,JSON.stringify({runId:run.id,releaseId:release.id}));}catch{/* Restored backend run remains available without browser storage. */}}
    })().catch(e=>{if(active)setMessage(`无法恢复当前运行入口：${e instanceof Error?e.message:'后端不可用'}。不会自动创建新运行。`);});
    return()=>{active=false;};
  },[configLoading,document?.id,runningConfig]);
  const runtimePanel=useRef<HTMLElement>(null);
  useEffect(()=>{if(runningConfig&&runtimeVisible)runtimePanel.current?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});},[runningConfig?.id,runtimeVisible]);
  useEffect(()=>{
    let active=true;
    savedDesigns().then(async rows=>{
      if(!active)return;
      savedRows.current=Object.fromEntries(rows.map(row=>[row.document.id,row]));
      // The catalog loads references, never implicitly opens the latest design.
      if(library)return;
      const requested=new URLSearchParams(window.location.search).get('template');
      const row=requested?rows.find(r=>r.document.templateId===requested):rows[0];
      if(row){
        // Reload exactly what was saved; upgrades are explicit editing actions.
        setDocument(row.document);
        setMessage(`已恢复后端保存配置 · 保存版本 ${row.revision}。`);
      }else if(requested&&workflowTemplates.some(t=>t.id===requested)){
        const fresh=createWorkflow(requested);
        setDocument(reuseSavedStoreConnection(fresh,rows.map(row=>row.document)));
      }else if(!library&&!requested){
        const legacy=await workflowDesignClient.load();
        if(active&&legacy){setDocument(legacy);setMessage('已恢复浏览器旧草稿；请保存配置后运行。');}
      }
    }).catch(e=>{if(active)setMessage(`无法读取保存配置：${e.message}。不会用默认配置代替已保存配置运行。`);}).finally(()=>{if(active)setConfigLoading(false);});
    return()=>{active=false;};
  },[library]);
  useEffect(() => {
    if(library)return;
    const template = new URLSearchParams(window.location.search).get("template");
    if (template && workflowTemplates.some(t => t.id === template)) setDocument(createWorkflow(template));
  }, [library]);
  useEffect(() => {
    let active = true;
    salesChannelDesignClient.load().then(channels => {
      if (!active) return;
      setChannelDirectory(channels);
      setDocument(current => current ? { ...current, customChannels: combineChannelDirectory(current.customChannels ?? [], channels).slice(0, 50) } : current);
    }).catch(() => { if (active) setMessage("本地渠道目录无法读取，现有流程仍可编辑；可重新添加或导入渠道定义。"); });
    return () => { active = false; };
  }, []);

  const commit = (next: WorkflowDocument, text = "修改已保留，预览前请重新检查。") => {
    setBlockedNode(null);
    setFrozenConfig(null);
    serial.current++; setDocument({ ...next, revision: Math.max(document?.id === next.id ? document.revision + 1 : next.revision, next.revision) });
    setResult(null); setBusy(false); setPreview(false); setMessage(text);
  };
  const openTemplate = (id: string) => {
    if(library){router.push(`/workflow/builder?template=${encodeURIComponent(id)}`);return;}
    setFrozenConfig(null);
    const saved=Object.values(savedRows.current).find(row=>row.document.templateId===id);
    const next=saved?.document??reuseSavedStoreConnection(createWorkflow(id, document?.environment.channel ?? defaultChannelId, document?.environment.fulfillment ?? "supplier", document?.customChannels ?? channelDirectory),Object.values(savedRows.current).map(row=>row.document));
    if(next.id!==document?.id){setRunningConfig(null);setRuntimeRunId(null);setRuntimeVisible(false);}
    serial.current++; setDocument(next);
    setSelected(null); setResult(null); setPreview(false); setMessage(saved?`已打开保存配置 · 保存版本 ${saved.revision}。`:""); setCatalogOpen(false); setRelationsOpen(false);
  };
  const save = async (source=document) => {
    if (!source) return;
    setBusy(true);const currentSerial=serial.current;
    try { const snapshot=needsDefaultRuntimeSkills(source)?bindDefaultRuntimeSkills(source,await backendRequest<RegisteredSkill[]>('skills')):source;if(currentSerial!==serial.current)throw Error('读取默认 Skill 时草稿已变化，请重新保存。');if(snapshot!==source){setDocument(snapshot);setFrozenConfig(null);}const row=await saveDesign(snapshot,savedRows.current[snapshot.id]?.revision??0);savedRows.current[snapshot.id]=row;setMessage(`配置已保存到后端 · 保存版本 ${row.revision}。冻结前不会执行。`);try{await workflowDesignClient.save(snapshot);}catch{/* Backend is authoritative; browser cache is optional. */}return row; }
    catch(e) { setMessage(`配置未保存：${e instanceof Error?e.message:'后端不可用'}。请保留或导出当前编辑，不能按未保存配置运行。`); }
    finally{setBusy(false);}
  };
  const freezeSaved=async()=>{
    if(!document||busy)return;setBlockedNode(null);setBusy(true);const current=serial.current;
    let saved=false;
    try{
      let snapshot=document;
      const plan=document.nodes.find(n=>n.definitionId==='listing.map')?.binding.parameters;
      if(plan?.mappingMode==='installed'&&plan.mappingPlanRef==='test-store.v1'&&plan.mappingPlanVersion==='1.3.0'){
        const [stores,catalog]=await Promise.all([backendRequest<PublishingStore[]>('stores'),backendRequest<{packages:PublishingPackage[]}>('integration-packages')]);
        if(current!==serial.current)throw Error('读取接口包时配置已变化，请重新冻结。');
        const store=stores.find(s=>s.id===plan.mappingStoreRef),pkg=catalog.packages.find(p=>p.package===plan.mappingPlanRef);
        if(!store||!pkg)throw Error('原店铺或接口包不可用，请在配置店铺接入确认。');
        snapshot=refreshCompatiblePublicationPackage(document,store,pkg);
      }
      const row=await save(snapshot);if(!row)return;saved=true;setBusy(true);
      if(snapshot!==document){setDocument(snapshot);setFrozenConfig(null);}
      const release=await freezeDesign(row);
      if(current!==serial.current){setMessage('已冻结刚才保存的版本；当前编辑已变化，请重新保存冻结。');return;}
      setFrozenConfig(release);setMessage(`服务端校验通过，已冻结保存版本 ${release.revision}${snapshot!==document?'（接口包引用已更新为 1.4）':''}；之后修改不会改变该版本或已有运行。`);return release;
    }catch(e){if(e instanceof BackendRequestError)setBlockedNode(e.nodeId??null);setMessage(`${saved?'配置已保存，但冻结运行未通过':'未生成冻结版本'}：${e instanceof Error?e.message:'校验失败'}`);}finally{setBusy(false);}
  };
  const restore = async () => {
    try { const rows=await savedDesigns();const row=rows.find(r=>r.document.id===document?.id)??rows[0];if(!row){setMessage('后端还没有保存的配置；浏览器旧草稿可通过导出文件导入。');return;}savedRows.current[row.document.id]=row;if(library){router.push(`/workflow/builder?template=${encodeURIComponent(row.document.templateId)}`);return;}commit(row.document,`已恢复后端保存版本 ${row.revision}。`);setSelected(null); }
    catch (error) { setMessage(error instanceof Error ? error.message : "草稿无法恢复。"); }
  };
  const exportDocument = () => {
    if (!document) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(document, null, 2)], { type: "application/json" }));
    const link = window.document.createElement("a"); link.href = url; link.download = `${document.templateId}-v2-r${document.revision}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); setMessage("已导出流程、Skill 清单、参数和连接引用。");
  };
  const validate = async () => {
    if (!document) return;
    const current = ++serial.current; setBusy(true);
    try { const next = await workflowDesignClient.validate(document); if (current !== serial.current) return; setResult(next); setMessage(next.valid ? "配置预检通过，可以演示这条流程。" : "请修复标出的配置问题，草稿仍可保存。"); }
    catch { setMessage("文档无法完成检查，请查看节点与 Skill 配置。"); }
    finally { if (current === serial.current) setBusy(false); }
  };
  const instance = document?.nodes.find(n => n.id === selected);
  const structurallyEditable = (node: NodeInstance) => canOperatorEditStructure(node.definitionId);
  const applyNode = (next: NodeInstance, registeredManifest?: SkillManifest) => {
    const current=document?.nodes.find(n=>n.id===next.id);
    if (!document || !current) return;
    // Never accept a disabled field's value as permission to alter system logic.
    const allowed = applyOperatorNodeSettings(current, next, isChannelAdapter(current.definitionId));
    const customSkills=registeredManifest&&registeredManifest.id===allowed.binding.skillId&&registeredManifest.version===allowed.binding.skillVersion
      ?[...document.customSkills.filter(s=>s.id!==registeredManifest.id),registeredManifest]:document.customSkills;
    commit({ ...document, customSkills, nodes: document.nodes.map(node => node.id === current.id ? allowed : node) }, "设置已应用到当前编辑；请点击“保存配置”写入后端，再校验冻结。");
    setSelected(null);
  };
  const configureSelectionBasis=(task:NodeInstance,manifest:SkillManifest)=>{
    if(!document)return;
    commit(applySelectionBasis(document,task,manifest),'选品依据与评估策略已同步应用；其他任务参数保留。请保存配置后再运行。');
    setSelected(null);
  };
  const registeredCustomChannels = combineChannelDirectory(document?.customChannels ?? [], channelDirectory);
  const channels = getChannels(registeredCustomChannels);
  const changeChannel = (channel: Channel, fulfillment?: Fulfillment) => {
    if (!document) return;
    const definition = resolveChannel(channel, registeredCustomChannels);
    if (!definition) { setMessage("请先添加这个销售渠道。"); return; }
    const mode = fulfillment ?? (channel === document.environment.channel ? document.environment.fulfillment : definition.defaultFulfillment);
    let customChannels = document.customChannels ?? [];
    if (!builtinChannels.some(item => item.id === channel) && !customChannels.some(item => item.id === channel)) {
      const issues = validateSalesChannel(definition, customChannels);
      if (issues.length || customChannels.length >= 50) { setMessage(issues[0] ?? "每份流程文档最多保存 50 个自定义渠道。"); return; }
      customChannels = [...customChannels, definition];
    }
    commit(rebindChannel({ ...document, customChannels }, channel, mode), channel !== document.environment.channel ? "已切换销售渠道，节点和自选 Skill 保留；请重新选择连接并配置兼容的渠道实现。" : "已更换默认履约实现，节点、连线和自选 Skill 已保留。");
    setSelected(null); setChannelManagerOpen(null);
  };
  const addChannel = async (definition: SalesChannelDefinition) => {
    if (!document) return;
    const issues = validateSalesChannel(definition, registeredCustomChannels);
    if (issues.length || registeredCustomChannels.length >= 50) { setMessage(issues[0] ?? "本地目录最多添加 50 个自定义渠道。"); setChannelManagerOpen(null); return; }
    const directory = [...registeredCustomChannels, definition];
    setChannelDirectory(directory);
    commit(rebindChannel({ ...document, customChannels: directory }, definition.id, definition.defaultFulfillment), `已添加 ${definition.name} 并保留原业务图；渠道接口待适配，请为未绑定节点选择 Skill。`);
    setSelected(null); setChannelManagerOpen(null);
    try { await salesChannelDesignClient.save(directory); }
    catch { setMessage("渠道已加入当前设计，但浏览器目录保存失败；请导出流程 JSON 保留配置。"); }
  };
  const reconnect = (nodes: NodeInstance[]) => {
    if (!document) return;
    commit({ ...document, nodes, edges: [...forwardEdges(nodes), ...document.edges.filter(e => e.kind !== "forward" && nodes.some(n => n.id === e.source) && nodes.some(n => n.id === e.target))] });
  };
  const insert = () => {
    if (!document || document.nodes.length >= 40) return;
    const definition = getDefinition(addDefinition)!;
    const skill = defaultSkillFor(definition.id, document.environment.channel, document.environment.fulfillment);
    const next: NodeInstance = { id: `step-${crypto.randomUUID()}`, definitionId: definition.id, title: definition.title, binding: { skillId: skill?.id ?? "", skillVersion: skill?.version ?? "1.0.0", mode: "default", parameters: skill ? defaultParameters(skill) : {} } };
    const index = document.nodes.findIndex(n => n.id === insertAfter);
    const nodes = [...document.nodes]; nodes.splice(index >= 0 ? index + 1 : Math.max(1, nodes.length - 1), 0, next);
    reconnect(nodes); setCatalogOpen(false); setSelected(next.id);
  };
  const move = (direction: -1 | 1) => {
    if (!document || !instance || !structurallyEditable(instance)) return;
    const index = document.nodes.findIndex(n => n.id === instance.id), target = index + direction;
    if (target < 0 || target >= document.nodes.length) return;
    const nodes = [...document.nodes]; [nodes[index], nodes[target]] = [nodes[target], nodes[index]]; reconnect(nodes);
  };
  const register = (skill: SkillManifest) => {
    if (!document || !instance || getNodeOperatorPolicy(instance.definitionId).mode !== "skill" && !isChannelAdapter(instance.definitionId)) return;
    commit({ ...document, customSkills: [...document.customSkills, skill], nodes: document.nodes.map(n => n.id === instance.id ? { ...n, binding: { ...n.binding, skillId: skill.id, skillVersion: skill.version, mode: "custom", parameters: defaultParameters(skill) } } : n) }, "自建 Skill 清单已加入草稿，当前为前端设计版本。");
  };
  const endHere = () => {
    if (!document || !instance) return;
    const skill = defaultSkillFor("flow.end", document.environment.channel, document.environment.fulfillment);
    const end: NodeInstance = { id: `result-${crypto.randomUUID()}`, definitionId: "flow.end", title: "交付本次结果", binding: { skillId: skill?.id ?? "", skillVersion: skill?.version ?? "1.0.0", mode: "default", parameters: skill ? defaultParameters(skill) : {} } };
    reconnect([...document.nodes.slice(0, document.nodes.findIndex(n => n.id === instance.id) + 1), end]); setSelected(null);
  };
  const editor = instance && document ? instance.definitionId==='support.propose'&&!supportAdvanced?<CustomerSupportWindow onClose={()=>setSelected(null)} onConfigure={()=>setSupportAdvanced(true)}/>:instance.definitionId==='listing.publish'&&!publishAdvanced?<PublishingNodeWindow document={document} onConfigure={()=>{setSelected(null);setMappingNodeId(document.nodes.find(n=>n.definitionId==='listing.map')?.id??null);setMappingOpen(true);}} onClose={()=>setSelected(null)}/>:<NodeInspector key={instance.id} editor={{ document, instance, onApply: applyNode, onConfigureBasis:configureSelectionBasis,onRegister: register, onConfigureStore: () => { setSelected(null); setStoreConnectionOpen(true); },
    onMove: structurallyEditable(instance) ? move : undefined,
    onEndHere: getNodeOperatorPolicy(instance.definitionId).mode === "skill" && structurallyEditable(instance) ? endHere : undefined,
    onRemove: document.nodes.length > 2 && structurallyEditable(instance) ? () => { reconnect(document.nodes.filter(n => n.id !== instance.id)); setSelected(null); } : undefined }} onClose={() => setSelected(null)} /> : null;

  if(configLoading)return <Card><p role="status">正在读取后端保存配置…</p></Card>;
  if (!document) return <div className={`${shared.workspace} ${styles.catalogPage}`}>
    <PageHeader title="工作流" description="从业务目标出发，配置并运行你的流程。" actions={<><Button onClick={()=>setModelConnectionsOpen(true)}>添加大模型 API</Button><Button variant="primary" disabled={!Object.keys(savedRows.current).length} onClick={restore}>继续最近编辑 ↗</Button></>} />
    <div className={styles.catalogToolbar}><nav className={shared.tabs} aria-label="工作流目录"><Button variant="ghost" aria-pressed={tab === "flows"} onClick={() => setTab("flows")}>业务流程</Button><Button variant="ghost" aria-pressed={tab === "skills"} onClick={() => setTab("skills")}>策略与工具</Button></nav>{tab==='flows'&&<label className={styles.catalogSearch}><Icon name="search" size={16}/><Input aria-label="搜索业务流程" placeholder="搜索流程" value={flowQuery} onChange={e=>setFlowQuery(e.target.value)}/></label>}</div>
    {tab === "flows" ? <><div className={shared.library}>{workflowTemplates.filter(t=>`${t.title} ${t.description}`.includes(flowQuery.trim())).map(t=>{const saved=Object.values(savedRows.current).find(row=>row.document.templateId===t.id);return <WorkflowCard key={t.id} variant="catalog" icon={workflowIcons[t.id]??'workflow'} eyebrow={t.cadence} title={saved?.document.title??t.title} description={t.description} detail={t.trigger} label={saved?'已保存草稿':'未配置'} meta={`${saved?.document.nodes.length??createWorkflow(t.id).nodes.length} 个步骤 · ${saved?'继续编辑':'打开流程'}`} onClick={() => openTemplate(t.id)} />;})}</div>{!workflowTemplates.some(t=>`${t.title} ${t.description}`.includes(flowQuery.trim()))&&<p className={styles.catalogEmpty}>没有匹配的业务流程。<Button variant="ghost" onClick={()=>setFlowQuery('')}>清除搜索</Button></p>}</> : <div className={styles.runtimeGrid}>{runtimes.map(([runtime, symbol, name, description]) => <Card key={runtime}><span>{symbol}</span><h3>{name}</h3><p>{description}</p><Badge>{runtime}</Badge></Card>)}</div>}
    {message&&<p className={styles.status} role="status">{message}</p>}
    {modelConnectionsOpen&&<ModelConnectionsWindow onClose={()=>setModelConnectionsOpen(false)}/>}
  </div>;

  const flow = toWorkflowPreview(document);
  const template = workflowTemplates.find(t => t.id === document.templateId);
  const valid = result?.valid && result.revision === document.revision;
  const channel = document.environment.channel;
  const activeChannel = resolveChannel(channel, document.customChannels);
  const relationEdges = document.edges.filter(e => e.kind !== "forward");
  const mappingNode=document.nodes.find(n=>n.id===mappingNodeId&&n.definitionId==='listing.map')??document.nodes.find(n=>n.definitionId==='listing.map');
  const inspectNode = (id:string) => {setPreview(false);setPublishAdvanced(false);setSupportAdvanced(false);if(document.nodes.find(n=>n.id===id)?.definitionId==='listing.map'){setSelected(null);setMappingNodeId(id);setMappingOpen(true);}else setSelected(id);};
  if (preview && valid) return <div className={shared.workspace}><div className={styles.previewToolbar}><Button onClick={() => setPreview(false)}>← 返回设计</Button><span>配置预检通过 · r{document.revision}</span><Badge tone="warning">本地模拟</Badge></div><WorkflowWorkspace customFlow={flow} onInspect={node => inspectNode(node.id)} /></div>;

  return <div className={`${shared.workspace} ${styles.executionWorkspace}`} data-technical={technicalView} data-executing={!!runningConfig&&runtimeVisible}>
    <div className={styles.designBreadcrumb}>{library ? <Button variant="ghost" onClick={() => { setDocument(null); setSelected(null); }}>工作流</Button> : <Link href="/workflow">工作流</Link>}<span>/</span><span>{template?.title ?? "我的流程"}</span><Badge>设计草稿</Badge><span>在当前画布运行</span></div>
    <PageHeader title={document.title} description="调整经营参数与策略；保存并冻结后运行，已有任务沿用原配置。" actions={<><Button onClick={()=>setModelConnectionsOpen(true)}>添加大模型 API</Button><Link className="ui-button ui-button--secondary" href="/test-store" target="_blank" rel="noopener noreferrer">打开测试独立站 ↗</Link><Button disabled={busy||configLoading} onClick={()=>void save()}>保存配置</Button><Button disabled={busy||configLoading} onClick={()=>void freezeSaved()}>校验并冻结</Button><Link className="ui-button ui-button--secondary" href="/schedules">定时运行 ↗</Link><Link className="ui-button ui-button--secondary" href="/workflow/releases">冻结版本 ↗</Link><Button onClick={exportDocument}>导出流程 ↗</Button></>} />
    {document.templateId==='support'&&<Card className={styles.channelNotice}><div><strong>智能客服 · 模型回复已可执行</strong><p>点击“智能客服生成回复”选择模型并提供客户问题与已确认资料。当前保存客服回复草稿，不自动取订单、发送消息、退款或补发；完整七步调度尚未接入，不支持冻结定时执行。</p></div><Button onClick={()=>{const node=document.nodes.find(n=>n.definitionId==='support.propose');setSupportAdvanced(false);if(node)setSelected(node.id);}}>执行客服 Skill</Button>{JSON.stringify(updateCustomerSupportDraft(document))!==JSON.stringify(document)&&<Button onClick={()=>commit(updateCustomerSupportDraft(document),'已更新为智能客服展示；节点配置、连线与引用保留，请保存配置。')}>更新为智能客服流程</Button>}</Card>}
    {document.templateId==='launch'&&document.selectionStrategy&&!document.nodes.some(n=>n.definitionId==='market.intelligence')&&<Card className={styles.channelNotice}><div><strong>新增可选首节点 · CJ 市场类目排行</strong><p>采集销售与广告类目前十，确认供货类目后传给商品任务。默认关闭，保留全部现有参数，保存冻结后才影响新运行。</p></div><Button onClick={()=>commit(addIntelligenceNode(document),'行情首节点已加入，默认关闭；现有参数和已冻结运行不变。')}>添加行情首节点</Button></Card>}
    <Card className={styles.environmentBar}>
      <div><small>销售渠道</small><div className={styles.channelControl}><SelectField aria-label="销售渠道" value={channel} onChange={e => changeChannel(e.target.value)}>{channels.map(item => <option key={item.id} value={item.id}>{item.name}{item.adapterStatus === "draft" ? " · 待适配" : " · 示例"}</option>)}</SelectField><Button onClick={() => setChannelManagerOpen("add")}>＋ 添加渠道</Button></div></div>
      <label>履约责任<SelectField aria-label="履约责任" value={document.environment.fulfillment} onChange={e => changeChannel(channel, e.target.value as Fulfillment)}>{(activeChannel?.fulfillments ?? [document.environment.fulfillment]).map(mode => <option key={mode} value={mode}>{channel === "amazon" && mode === "platform" ? "平台履约观察 · FBA" : fulfillmentNames[mode]}</option>)}</SelectField></label>
      <div className={styles.contextCopy}><div className={styles.connectionTitle}><strong>{document.environment.storeIntegration?.name ?? "尚未配置店铺接入"}</strong></div><small>{document.environment.storeIntegration ? "已绑定接口包引用 · 执行时核验" : "一次接入，多流程复用"}</small><Button compact className={styles.connectionButton} onClick={() => setStoreConnectionOpen(true)}>配置店铺接入 ↗</Button></div>
      <Badge tone={valid ? "success" : "neutral"}>{valid ? "配置预检通过" : "待检查"} · r{document.revision}</Badge>
    </Card>
    {activeChannel?.adapterStatus === "draft" && !document.environment.storeIntegration && <Card className={styles.channelNotice}><Badge tone="warning">渠道待适配</Badge><div><strong>{activeChannel.name} 已加入设计目录</strong><p>先完成店铺接入与接口验收，再执行渠道动作；当前声明不代表已获平台授权。</p></div><Button onClick={() => setChannelManagerOpen("existing")}>管理渠道 ↗</Button></Card>}
    {document.templateId === "fulfillment" && <div className={styles.fulfillmentBranch} aria-label="当前履约分支"><span>订单接入 → 事实校验 → 责任判断</span><div><Badge tone={document.environment.fulfillment === "platform" ? "neutral" : "success"}>商家 / 供应商发运{document.environment.fulfillment === "platform" ? " · 不执行" : " · 当前路径"}</Badge><Badge tone={document.environment.fulfillment === "platform" ? "info" : "neutral"}>平台履约观察{document.environment.fulfillment === "platform" ? " · 当前路径" : " · 不执行"}</Badge></div></div>}
    <div className={styles.controlsGuide} aria-label="步骤编辑权限说明">
      <div><NodeAccess mode="fixed"/><span>查看规则，不可改执行逻辑</span></div>
      <div><NodeAccess mode="parameters"/><span>只开放指定业务参数</span></div>
      <div><NodeAccess mode="skill"/><span>可选 Skill，调整运营策略</span></div>
      <Button variant="ghost" aria-pressed={technicalView} onClick={()=>{setTechnicalView(!technicalView);setRelationsOpen(false);setCatalogOpen(false);setAddDefinition("extension.review");}}>{technicalView?"返回运营视图":"技术视图 ↗"}</Button>
    </div>
    {technicalView&&<p className={styles.status}>技术视图仅用于设计渠道实现和查看对接数据，不是权限提升；系统检查与授权逻辑仍不可替换。</p>}
    {document.templateId==='launch'&&<details className={styles.documentDetails}><summary>真实运行准备 · 在现有节点内配置，不另建流程</summary><div><p>先集中设置条件，采集完整数据后统一核验并补选。达到合格目标后才评估、审批和逐款发布；旧十五步运行仍兼容。</p>{[
      ['product.start','商品任务：搜索词、合格目标、扫描预算、库存、配送和费用一次配置'],
      ['product.start','市场证据：未指定来源时默认 CJ 自动证据，保存时同时绑定已审核的选品算法；第三方证据作为扩展选项'],
      ['product.start','选品与定价策略：在第一步选择已注册的 Skill；统一核验内部执行建议与独立售价复核，不另设评估节点'],
      ['product.verify','统一核验：继承第一步条件，查看资料、库存、配送和成本检查规则，不重复配置'],
      ['content.make','内容制作：默认绑定后端已审核的“原素材与商品文案整理”，保留原图与文案，不需手选'],
      ['listing.map','准备发布：选择已验收测试站店铺与安装接口包'],
    ].map(([definition,label])=>{const node=document.nodes.find(n=>n.definitionId===definition);return <div key={definition}><p>{label}</p><Button compact disabled={!node} onClick={()=>{if(node)inspectNode(node.id);}}>配置该节点</Button></div>;})}<p>模型选品、生图和其他销售渠道尚未部署执行器时，会明确阻止冻结。不会跳过检查、使用虚构数据或自动采购付款。</p></div></details>}
    <section className={shared.board} aria-label="通用工作流设计画布">
      {runningConfig&&runtimeVisible?<header className={styles.canvasToolbar}><div><Badge tone="info">真实运行</Badge><span>保存版本 {runningConfig.revision} · 不受草稿编辑影响</span></div><Button onClick={()=>setRuntimeVisible(false)}>返回编辑（不停止任务）</Button></header>:<header className={styles.canvasToolbar}><div><Button onClick={() => { setCatalogOpen(!catalogOpen); if (!insertAfter) setInsertAfter(document.nodes.at(-2)?.id ?? ""); }}>＋ 添加节点</Button>{technicalView&&<Button variant="ghost" aria-pressed={relationsOpen} onClick={() => setRelationsOpen(!relationsOpen)}>↔ 节点关系</Button>}</div><div><span>适应画布</span><Button disabled={busy} onClick={validate}>{busy ? "检查中…" : "检查配置"}</Button><Button disabled={!valid || busy} onClick={() => setPreview(true)}>演示流程</Button>{runningConfig&&<Button variant="primary" onClick={()=>setRuntimeVisible(true)}>返回当前运行</Button>}<Button variant={runningConfig?"secondary":"primary"} disabled={busy||configLoading} onClick={()=>void (async()=>{const release=frozenConfig??await freezeSaved();if(release){setRuntimeRunId(null);setRuntimeSession(value=>value+1);setRunningConfig(release);setRuntimeVisible(true);}})()}>{runningConfig?"▶ 启动新运行":"▶ 运行流程"}</Button></div></header>}
      {catalogOpen && <div className={styles.insertPanel}><label>增加哪个步骤<SelectField aria-label="添加节点职责" value={addDefinition} onChange={e => setAddDefinition(e.target.value)}>{nodeDefinitions.filter(d=>technicalView||["extension.review","extension.skill"].includes(d.id)).map(d => <option key={d.id} value={d.id}>{d.title}{technicalView?` · ${d.id}`:""}</option>)}</SelectField></label><label>插入位置<SelectField aria-label="插入位置" value={insertAfter} onChange={e => setInsertAfter(e.target.value)}>{document.nodes.slice(0, -1).map(n => <option key={n.id} value={n.id}>{n.title}之后</option>)}</SelectField></label><Button onClick={insert} disabled={document.nodes.length >= 40}>插入并配置</Button><Button variant="ghost" onClick={() => setCatalogOpen(false)}>收起</Button></div>}
      {!runtimeVisible&&<WorkflowCanvas flow={flow} run={null} onSelect={node => inspectNode(node.id)} configs={{}} selectedId={selected ?? undefined} />}
      {runningConfig&&!runtimeVisible&&<p className={styles.status}>草稿修改只用于新运行；返回当前运行仍查看保存版本 {runningConfig.revision}，不会重新启动或改变原任务。</p>}
      {runningConfig&&<section ref={runtimePanel} hidden={!runtimeVisible} aria-label="当前流程真实运行"><LiveWorkflow key={`${runningConfig.id}:${runtimeSession}`} embedded autoStart initialReleaseId={runningConfig.id} initialRunId={runtimeRunId??undefined} onRunIdChange={rememberRun} onExit={()=>setRuntimeVisible(false)} renderCanvas={(view,selectedId,onSelect)=><WorkflowCanvas executionMode flow={toWorkflowPreview(runningConfig.document)} run={view} configs={{}} selectedId={selectedId} onSelect={node=>onSelect(node.id)}/>}/></section>}
      <footer className={styles.canvasFooter}><span>系统步骤不可由策略绕过</span><span>发光区分模拟与服务端运行，不表示可编辑</span><span>点击步骤，查看规则或调整设置 ↗</span></footer>
    </section>
    <p className={styles.status} role="status">{message || "草稿可自由编辑 · 配置窗口不会占用画布空间"}</p>
    {blockedNode&&document.nodes.some(n=>n.id===blockedNode)&&<Button onClick={()=>inspectNode(blockedNode)}>配置报错节点 ↗</Button>}

    {relationsOpen && <Card className={styles.relationsPanel}><h3>协作与返工</h3><p>协作保留当前上下文；返工回到前序节点，并重新确认后续结果。</p><div className={styles.relationInputs}><SelectField aria-label="关系类型" value={edgeKind} onChange={e => setEdgeKind(e.target.value as typeof edgeKind)}><option value="collaboration">双向证据协作</option><option value="feedback">返回修订</option></SelectField><SelectField aria-label="源节点" value={edgeSource} onChange={e => setEdgeSource(e.target.value)}><option value="">选择源节点</option>{document.nodes.map(n => <option key={n.id} value={n.id}>{n.title}</option>)}</SelectField><SelectField aria-label="目标节点" value={edgeTarget} onChange={e => setEdgeTarget(e.target.value)}><option value="">选择目标节点</option>{document.nodes.map(n => <option key={n.id} value={n.id}>{n.title}</option>)}</SelectField><Button disabled={!edgeSource || !edgeTarget} onClick={() => commit({ ...document, edges: [...document.edges, { id: `relation-${crypto.randomUUID()}`, source: edgeSource, target: edgeTarget, kind: edgeKind, label: edgeKind === "feedback" ? "返回修订" : "证据协作", description: "协作完成后再传递；返工重新确认后续结果。" }] })}>添加关系</Button></div>{relationEdges.map(edge => <div className={styles.relationRow} key={edge.id}><span>{edge.kind === "feedback" ? "↶" : "↔"} {document.nodes.find(n => n.id === edge.source)?.title} → {document.nodes.find(n => n.id === edge.target)?.title}</span><Button variant="ghost" onClick={() => commit({ ...document, edges: document.edges.filter(e => e.id !== edge.id) })}>移除</Button></div>)}</Card>}
    {result && <Card className={styles.validationPanel}><div><h3>{result.valid ? "✓ 连接与配置预检通过" : "需要调整的配置"}</h3><Badge tone={result.valid ? "success" : "danger"}>{result.errors.length} 个问题</Badge></div>{result.errors.map((error, index) => <div className={styles.validationIssue} key={index}><code>{error.code}</code><span>{error.message}</span>{error.nodeId && <Button variant="ghost" onClick={() => setSelected(error.nodeId!)}>查看节点 ↗</Button>}</div>)}<p>当前检查在浏览器中完成；后端接入后可替换为实际数据与权限校验。</p></Card>}
    <details className={styles.documentDetails}><summary>流程文档与后端对接</summary><div><label>流程名称<Input aria-label="流程名称" value={document.title} onChange={e => commit({ ...document, title: e.target.value })} /></label><label>店铺连接引用<Input aria-label="店铺连接引用" placeholder="已验收后端店铺 UUID（不填写密钥）" value={document.environment.storeRef ?? ""} onChange={e => commit({ ...document, environment: { ...document.environment, storeRef: e.target.value } })} /></label><p>导出文档包含版本、自定义销售渠道、节点职责、Skill 绑定、参数、连接引用与连线。保存配置会写入后端；渠道目录仍为设计声明，真实运行依赖服务端受信注册表和已验收连接。</p><div><Button disabled={busy} onClick={restore}>载入后端配置</Button><Button onClick={() => fileInput.current?.click()}>导入流程 JSON</Button></div><pre>{JSON.stringify({ schemaVersion: document.schemaVersion, revision: document.revision, environment: document.environment, customChannels: document.customChannels ?? [], node: document.nodes[1] }, null, 2)}</pre></div></details>
    <input ref={fileInput} type="file" accept="application/json,.json" hidden aria-label="导入流程文件" onChange={async e => { const file = e.target.files?.[0]; if (!file) return; try { if (file.size > 262144) throw new Error("流程文件不能超过 256KB。"); commit(parseWorkflowDocument(await file.text()), "流程文件已导入，请检查实现绑定。"); setSelected(null); } catch (error) { setMessage(error instanceof Error ? error.message : "文件无法读取。"); } finally { e.target.value = ""; } }} />
    {editor}
    {modelConnectionsOpen&&<ModelConnectionsWindow onClose={()=>setModelConnectionsOpen(false)}/>}
    {mappingOpen&&<MappingNodeWindow channel={channel} document={document} onConfigureStore={()=>{setMappingOpen(false);setStoreConnectionOpen(true);}} sessionRef={mappingNode?.binding.parameters.mappingSessionRef as string|undefined} onApplyDraft={session=>{
      const node=mappingNode;
      if(!node){setMessage('当前草稿没有映射节点，请使用当前模板；未修改旧流程。');return;}
      applyNode({...node,binding:{...node.binding,parameters:{mappingMode:'analysis',mappingSessionRef:session.id,mappingSessionRevision:session.revision}}});setMappingOpen(false);
    }} onClose={()=>setMappingOpen(false)}/>}
    {storeConnectionOpen && <StoreConnection environment={document.environment} document={document} onSaveInstalled={async next=>{const snapshot={...next,revision:document.revision+1};commit(snapshot);const row=await save(snapshot);if(!row)throw Error('店铺与接口包配置未保存，请检查页头错误；不会自动使用未保存配置。');setStoreConnectionOpen(false);}} onConfigureMapping={()=>{setStoreConnectionOpen(false);setMappingNodeId(document.nodes.find(n=>n.definitionId==='listing.map')?.id??null);setMappingOpen(true);}} onApply={environment => commit({ ...document, environment }, "开发声明已应用到当前编辑，不代表真实店铺接入；请保存配置。")} onClose={() => setStoreConnectionOpen(false)} />}
    {channelManagerOpen && <ChannelManager channels={channels} selectedId={channel} initialTab={channelManagerOpen} onSelect={id => changeChannel(id)} onAdd={addChannel} onClose={() => setChannelManagerOpen(null)} />}
  </div>;
}

"use client";
import { useEffect, useId, useRef, useState } from "react";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import { WorkflowCard } from "./workflow-card";
import { NodeInspector, initialConfig, type NodeConfig } from "./node-inspector";
import { kindLabels, workflows, type Workflow, type WorkflowNode } from "./model";
import { catalog } from "@/lib/workflow/catalog";
const skills=catalog.skills;
import styles from "./workflow.module.css";
import { edgesFor, position, transmissionDuration, type GraphEdge } from "./graph";
import { WorkflowConnection } from "./workflow-connection";

type Run = {nodeId:string;phase:"queued"|"running"|"edge"|"collaborating"|"waiting"|"approval"|"decision"|"done"|"stopped";completed:string[];message?:string;edgeId?:string;targetId?:string;relationId?:string;collaborationDone?:boolean;revision?:number};
const aliases:Record<string,string>={sourcing:"launch",listing:"launch",growth:"campaign",customer:"support",feedback:"optimize"};

export function WorkflowCanvas({flow,run,onSelect,configs,selectedId,executionMode=false}:{flow:Workflow;run:Run|null;onSelect:(node:WorkflowNode)=>void;configs:Record<string,NodeConfig>;selectedId?:string;executionMode?:boolean}) {
  const host=useRef<HTMLDivElement>(null);
  const markerId=`workflow-arrow-${useId().replace(/:/g,"")}`;
  const [width,setWidth]=useState(1000);
  useEffect(()=>{const observer=new ResizeObserver(entries=>setWidth(entries[0].contentRect.width));if(host.current)observer.observe(host.current);return()=>observer.disconnect()},[]);
  const height=Math.ceil(flow.nodes.length/3)*240;
  const scale=Math.min(1,width/1000);
  useEffect(()=>{
    if(!executionMode||!run||selectedId&&selectedId!==run.nodeId)return;
    const viewport=host.current?.closest<HTMLElement>('[data-run-canvas]');
    const index=flow.nodes.findIndex(node=>node.id===run.nodeId);
    if(!viewport||index<0)return;
    const top=position(index).y*scale+50,bottom=top+168*scale;
    if(top<viewport.scrollTop||bottom>viewport.scrollTop+viewport.clientHeight)viewport.scrollTo({top:Math.max(0,top-(viewport.clientHeight-168*scale)/2),behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  },[executionMode,run?.nodeId,selectedId,scale]);
  const edges=edgesFor(flow);
  const collaboration=run?.phase==="collaborating"?edges.find(edge=>edge.id===run.relationId):undefined;
  const activeEdge=run?.phase==="edge"?(run.edgeId??`${run.nodeId}:${flow.nodes.find(node=>node.id===run.nodeId)?.next}`):null;
  return <div ref={host} className={styles.canvasViewport} data-execution-mode={executionMode}>
    <div className={styles.canvasFit} style={{height:height*scale}}><div className={styles.canvas} style={{height,transform:`scale(${scale})`}}>
      <svg className={styles.connections} viewBox={`0 0 1000 ${height}`} width="1000" height={height} aria-hidden="true"><defs><marker id={markerId} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto-start-reverse"><path d="M0 0 L7 3.5 L0 7" fill="none" stroke="currentColor"/></marker></defs>
        {edges.map(edge=>{
          const joint=collaboration?.id===edge.id;
          const active=activeEdge===edge.id;
          if(edge.kind==="forward"&&collaboration&&[collaboration.source,collaboration.target].includes(edge.source)&&[collaboration.source,collaboration.target].includes(edge.target))return null;
          return <WorkflowConnection key={`${edge.id}:${active?run?.revision??0:"idle"}`} flow={flow} edge={edge} active={active} joint={joint} completed={!!run?.completed.includes(edge.source)&&!!run?.completed.includes(edge.target)} markerId={markerId}/>;
        })}
      </svg>
      {flow.nodes.map((node,index)=>{
        const p=position(index);
        const active=run?.nodeId===node.id;
        const joint=collaboration&&[collaboration.source,collaboration.target].includes(node.id);
        const state=joint?"collaborating":active?run.phase:run?.completed.includes(node.id)?"completed":"";
        const label=state==="queued"?"等待执行":state==="collaborating"?"协同核验中":state==="running"?"正在执行":state==="waiting"?"等待外部事件":state==="approval"?"等待确认":state==="decision"?"选择规则结果":state==="completed"||state==="edge"?"已完成":state==="done"?"已完成":state==="stopped"?"已停止":node.implementationMissing?"待配置实现":"待触发";
        const configured=skills.find(skill=>skill.id===(configs[`${flow.id}:${node.id}`]?.skill??node.skill));
        const access=node.operatorPolicy;
        const detail=joint?"协同核验中 · 等待双方确认":node.implementationMissing?(access?.mode==="skill"?"待配置商品来源或策略":"渠道尚未接入 · 需技术人员配置"):access?`产出：${access.result}`:node.implementation?`${node.implementation.runtime.toUpperCase()} · ${node.implementation.name}`:node.kind==="ai"?`${configured?.name} · v${configured?.version}`:node.event?`等待 · ${node.event}`:`${node.input} → ${node.output}`;
        return <WorkflowCard key={node.id} order={index} selected={selectedId===node.id} position={{left:p.x,top:p.y}}
          eyebrow={access?`步骤 ${String(index+1).padStart(2,"0")}`:`${String(index+1).padStart(2,"0")} / ${kindLabels[node.kind]}`}
          editMode={access?.mode} accessLabel={access?.implementationKind==="adapter"?"接口接入":undefined} title={node.title} description={node.description} detail={active&&run.message?run.message:detail} label={label}
          icon={node.kind==="ai"?"sparkles":node.kind==="approval"?"check":node.kind==="wait"?"clock":node.kind==="end"?"check":access?.implementationKind==="adapter"?"connect":node.kind==="trigger"?"workflow":node.kind==="rule"?"info":"box"}
          meta={executionMode?"查看运行记录":node.kind==="approval"&&node.approvalEnabled===false?"人工审核已关闭":access?.implementationKind==="adapter"?"查看接口动作":access?.mode==="fixed"?"查看规则":access?.mode==="parameters"?"调整参数":access?.mode==="skill"?"配置 Skill":"查看步骤"}
          accent={access?undefined:node.kind==="ai"?"violet":undefined} state={state} onClick={()=>onSelect(node)}/>;
      })}
    </div></div>
  </div>;
}

export function WorkflowWorkspace({customFlow,initialConfigs,onInspect}:{customFlow?:Workflow;initialConfigs?:Record<string,NodeConfig>;onInspect?:(node:WorkflowNode)=>void}={}) {
  const [flowId,setFlowId]=useState<string|null>(null);
  const [selected,setSelected]=useState<WorkflowNode|null>(null);
  const [filter,setFilter]=useState("全部流程");
  const [run,setRun]=useState<Run|null>(null);
  const [configs,setConfigs]=useState<Record<string,NodeConfig>>(initialConfigs??{});
  const [feedbackReason,setFeedbackReason]=useState("");
  const flow=customFlow??workflows.find(item=>item.id===flowId);
  const node=flow?.nodes.find(item=>item.id===run?.nodeId);
  const relations=flow?edgesFor(flow).filter(edge=>edge.kind!=="forward"):[];
  const collaboration=run?.phase==="collaborating"?relations.find(edge=>edge.id===run.relationId):undefined;
  const feedback=relations.filter(edge=>edge.kind==="feedback"&&edge.source===node?.id&&run&&["approval","waiting"].includes(run.phase));
  useEffect(()=>setFeedbackReason(""),[flowId,run?.nodeId]);
  const navigate=(id:string|null)=>{window.history.pushState(null,"",id?`#${id}`:window.location.pathname);setFlowId(id);setSelected(null);setRun(null)};
  useEffect(()=>{const sync=()=>{const hash=window.location.hash.slice(1);const id=aliases[hash]??hash;setFlowId(workflows.some(item=>item.id===id)?id:null);setRun(null);setSelected(null)};sync();window.addEventListener("popstate",sync);window.addEventListener("hashchange",sync);return()=>{window.removeEventListener("popstate",sync);window.removeEventListener("hashchange",sync)}},[]);
  useEffect(()=>{
    if(!run||!node||!flow||!["running","edge"].includes(run.phase))return;
    const timer=window.setTimeout(()=>{
      if(run.phase==="edge"){const target=run.targetId??node.next;if(target)setRun({...run,nodeId:target,phase:"running",edgeId:undefined,targetId:undefined,relationId:undefined,collaborationDone:false});return}
      const joint=edgesFor(flow).find(edge=>edge.kind==="collaboration"&&edge.source===node.id);
      if(joint&&!run.collaborationDone){setRun({...run,phase:"collaborating",relationId:joint.id});return}
      if(node.kind==="wait"){setRun({...run,phase:"waiting"});return}
      if(node.kind==="approval"&&node.approvalEnabled!==false){setRun({...run,phase:"approval"});return}
      if(node.alternate){setRun({...run,phase:"decision"});return}
      setRun({...run,phase:node.next?"edge":"done",completed:[...run.completed,node.id]});
    },run.phase==="edge"?transmissionDuration(flow,edgesFor(flow).find(edge=>edge.id===(run.edgeId??`${node.id}:${node.next}`))):node.kind==="ai"?2300:950);
    return()=>clearTimeout(timer);
  },[run,node,flow]);
  const resume=()=>{if(run&&node)setRun({...run,phase:node.next?"edge":"done",completed:[...run.completed,node.id]})};
  const stopBranch=()=>{if(run&&node)setRun({...run,phase:"stopped",message:node.alternate?.result??"本次任务已停止，后续节点未执行。"})};
  const returnForRevision=(edge:GraphEdge)=>{
    if(!run||!flow||!feedbackReason.trim()||!feedback.some(item=>item.id===edge.id)||(run.revision??0)>=3)return;
    const targetIndex=flow.nodes.findIndex(item=>item.id===edge.target);
    setRun({...run,phase:"edge",edgeId:edge.id,targetId:edge.target,relationId:undefined,collaborationDone:false,revision:(run.revision??0)+1,completed:run.completed.filter(id=>flow.nodes.findIndex(item=>item.id===id)<targetIndex),message:`第 ${(run.revision??0)+1} 次修订：${feedbackReason.trim()}。后续结果和审批重新确认；修订原草稿，不重复创建。`});
  };
  const running=!!run&&!["done","stopped"].includes(run.phase);
  const countAi=flow?.nodes.filter(item=>item.kind==="ai").length??0;
  const countSkills=flow?.nodes.filter(item=>item.implementation).length??0;
  return <div className={styles.workspace}>
    {!customFlow&&<div className={styles.builderLink}><Link href="/workflow/builder">跨境电商通用流程设计器 →</Link><span>添加销售渠道，配置兼容实现并完成前端预检</span></div>}
    <PageHeader title={flow?flow.title:"让业务顺着流程发生"} description={flow?flow.subtitle:"从一次上新，到每一笔订单。每条自动化都有自己的起点和终点。"} actions={<><span className={styles.previewLabel}><i/>前端设计演示</span>{flow&&<Button variant="primary" disabled={running} onClick={()=>setRun({nodeId:flow.nodes[0].id,phase:"running",completed:[]})}>{run?"重新演示":"▶ 演示这条流程"}</Button>}</>}/>
    {!customFlow&&<nav className={styles.breadcrumb} aria-label="流程导航"><Button variant="ghost" onClick={()=>navigate(null)}>工作流</Button>{flow&&<><span>/</span><strong>{flow.title}</strong></>}</nav>}
    {!flow?<>
      <Card className={styles.overviewIntro}><div><span className={styles.eyebrow}>AUTOMATION, WITH A PURPOSE</span><h2>不选新品，生意也能继续运转。</h2><p>新品任务按需启动；订单、投放复盘和售后由各自的事件触发，互不依赖一次选品是否运行。</p></div><div className={styles.introStats}><span><b>05</b>端到端工作流</span><span><b>03</b>独立触发方式</span></div></Card>
      <div className={styles.sectionHead}><nav className={styles.tabs} aria-label="工作流筛选">{["全部流程","按需启动","事件驱动","定时运行"].map(label=><Button key={label} variant="ghost" aria-pressed={filter===label} onClick={()=>setFilter(label)}>{label}</Button>)}</nav><span>按业务结果组织 · 独立启动</span></div>
      <div className={styles.library}>{workflows.filter(item=>filter==="全部流程"||item.cadence===filter).map(item=><WorkflowCard key={item.id} eyebrow={`${item.number} / ${item.cadence}`} title={item.title} description={item.subtitle} detail={item.trigger} label={item.result} meta={`${item.nodes.length} 个步骤`} accent={item.id==="fulfillment"?"green":item.id==="campaign"?"violet":undefined} onClick={()=>navigate(item.id)}/>)}</div>
      <Card className={styles.skillIntro}><span className={styles.aiMark}>✧</span><div><h3>AI 是流程中的能力，Skill 是可以替换的配置。</h3><p>选品研究、商品内容、广告创意与售后建议使用 AI。付款、库存、发货与邮件由接口和规则处理。</p></div><Button onClick={()=>{navigate("launch");setSelected(workflows[0].nodes.find(item=>item.kind==="ai")!)}}>预览 AI 配置 ↗</Button></Card>
      <p className={styles.disclaimer}>当前展示流程设计与模拟执行。未连接 CJ、Shopify、广告账户或 LLM，不会真实采购、付款、投放或发送邮件。</p>
    </>:<>
      <div className={styles.flowSummary}><span><small>触发方式</small><strong>{flow.trigger}</strong></span><span><small>一次处理</small><strong>{flow.scope}</strong></span><span><small>本次产出</small><strong>{flow.result}</strong></span></div>
      <section className={styles.board} aria-label={`${flow.title}流程画布`}><header className={styles.boardHeader}><div><span className={styles.eyebrow}>WORKFLOW / {flow.number}</span><strong>{flow.nodes.length} 个步骤 <span>· {customFlow?`${countSkills} 个 Skill 绑定`:`${countAi} 个 AI 节点`}</span></strong></div><div className={styles.legend}><span><i/>脚本 / API</span><span><i/>模型 / 组合</span><span><i/>等待 / 确认</span><span>↔ 协作 · ↶ 修订</span></div></header>
        <WorkflowCanvas flow={flow} run={run} onSelect={onInspect??setSelected} configs={configs}/>
        {relations.length>0&&<div className={styles.relations} aria-label="节点关系">{relations.map(edge=><span key={edge.id} title={edge.description}>{edge.kind==="collaboration"?"↔":"↶"} {flow.nodes.find(item=>item.id===edge.source)?.title} {edge.kind==="collaboration"?"与":"→"} {flow.nodes.find(item=>item.id===edge.target)?.title}</span>)}</div>}
        <div className={styles.runBar} aria-live="polite">
          <div><strong>{!run?"从触发事件开始，沿业务结果推进":run.phase==="collaborating"?"协作中："+collaboration?.label:run.phase==="done"?"本次演示已完成":run.phase==="stopped"?"本次演示已停止":run.phase==="waiting"?"等待："+node?.event:run.phase==="approval"?"待确认："+node?.title:run.phase==="decision"?"规则分支："+node?.title:run.phase==="edge"?(run.edgeId?"沿反馈线返回修订…":"完成当前步骤，传递数据…"):"执行中："+node?.title}</strong>
          <p>{collaboration?.description??run?.message??(run?.phase==="waiting"?"等待期间停止向下游传光；模拟收到事件后才恢复。":flow.note)}</p></div>
          <div className={styles.runActions}>
            {run?.phase==="collaborating"&&<Button variant="primary" onClick={()=>setRun({...run,phase:"running",relationId:undefined,collaborationDone:true})}>模拟双方协作完成</Button>}
            {run&&["waiting","approval","decision"].includes(run.phase)&&<><Button variant="primary" onClick={resume}>{run.phase==="waiting"?"模拟收到成功事件":run.phase==="approval"?"模拟确认通过":"模拟条件通过"}</Button>{node?.alternate&&<Button onClick={stopBranch}>{node.alternate.label}</Button>}</>}
            {running&&<Button variant="ghost" onClick={()=>setRun({...run!,phase:"stopped",relationId:undefined,edgeId:undefined,targetId:undefined,message:"已手动停止本次模拟执行。"})}>停止演示</Button>}
          </div>
        </div>
        {feedback.length>0&&<div className={styles.feedbackControls}><label>修订原因<Input value={feedbackReason} onChange={event=>setFeedbackReason(event.target.value)} placeholder="例如：素材中的功能描述需按商品事实修正"/></label>{feedback.map(edge=><Button key={edge.id} disabled={!feedbackReason.trim()||(run?.revision??0)>=3} onClick={()=>returnForRevision(edge)}>↶ {edge.label}</Button>)}<small>{(run?.revision??0)>=3?"本次已修订 3 次，请停止演示并转人工复核。":"修订会重新确认后续结果与审批；不代表撤销已执行动作。"}{feedback.map(edge=><span key={edge.id}>{edge.description}</span>)}</small></div>}
      </section>
      {flow.handoff&&<Card className={styles.handoff}><div><span className={styles.eyebrow}>下一项独立任务</span><strong>{flow.handoff.label}</strong><p>由策略或人工创建新任务，不会强制串行执行。</p></div><Button onClick={()=>navigate(flow.handoff!.workflow)}>查看交接流程 →</Button></Card>}
      <p className={styles.disclaimer}>演示数据 · 等待与审批需手动模拟 · AI 配置仅保存在当前页面会话</p>
    </>}
    {selected&&flow&&<NodeInspector readOnly={!!customFlow} key={`${flow.id}:${selected.id}`} node={selected} config={configs[`${flow.id}:${selected.id}`]??initialConfig(selected)} onClose={()=>setSelected(null)} onSave={config=>setConfigs(current=>({...current,[`${flow.id}:${selected.id}`]:config}))}/>}
  </div>;
}

"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import {PageHeader} from "@/components/app/page-header";
import {Card} from "@/components/ui/card";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {SelectField} from "@/components/ui/select-field";
import {Badge} from "@/components/ui/badge";
import {backendRequest} from "@/lib/workflow/backend-client";
import {NodeAccess} from "./node-access";
import {integrationRules} from "@/lib/skills/personal";
import {ModelConnectionForm} from './model-connection-form';
import type {ModelConnection} from '@/lib/workflow/model-connections';
import styles from "./interface-mapping.module.css";

type Model=ModelConnection;
type Row={action?:string;direction:string;fixed_path:string;external_path:string;meaning:string;conversion:string;evidence:string;status:string};
type Answer={summary?:string;mappings?:Row[];questions?:string[];limitations?:string[]};
export type MappingSession={id:string;channel:string;action:string;revision:number;busy:boolean;contract:unknown;messages:{role:string;content:string;model?:string;provider?:string;connection_id?:string}[];result:Answer};
type Session=MappingSession;
const actions=[['store.package','完整店铺接口包'],['listing.publish','上架商品'],['listing.validate','检查商品'],['listing.wait','查询可售结果'],['publication.lookup','查询发布回执'],['listing.unpublish','下架商品'],['listing.status','查询商品状态'],['orders.read','读取订单'],['customers.read','读取客户'],['finance.read','读取账目']];
const labels:Record<string,string>={direct:'直接对应',convert:'需要转换',question:'待你确认',unsupported:'暂不支持'};
const mappingRule=integrationRules.find(rule=>rule.configure==='mapping')!;

export function InterfaceMapping({embedded=false,initialChannel,initialSessionRef,onApplyDraft}:{embedded?:boolean;initialChannel?:string;initialSessionRef?:string;onApplyDraft?:(session:MappingSession)=>void}={}){
  const [models,setModels]=useState<Model[]>([]),[modelId,setModelId]=useState('');
  const [sessions,setSessions]=useState<Session[]>([]),[session,setSession]=useState<Session|null>(null);
  const [channel,setChannel]=useState(''),[action,setAction]=useState('store.package'),[message,setMessage]=useState('');
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[showModels,setShowModels]=useState(false);
  const [editingModel,setEditingModel]=useState<Model|undefined>();
  useEffect(()=>{
    let active=true;
    const params=new URLSearchParams(location.search),scope=initialChannel||params.get('channel')||'我的店铺';
    setChannel(scope);
    Promise.all([backendRequest<Model[]>('model-connections'),backendRequest<Session[]>('mappings'),initialSessionRef?backendRequest<Session>(`mappings/${initialSessionRef}`):Promise.resolve(null)]).then(([m,s,linked])=>{
      if(!active)return;
      const previousModel=linked?.messages.at(-1)?.connection_id;
      setModels(m);setModelId(m.some(item=>item.id===previousModel)?previousModel!:m[0]?.id??'');setSessions(s);if(!m.length)setShowModels(true);
      if(linked){if(linked.channel===scope&&['store.package','listing.publish'].includes(linked.action)){setSession(linked);setAction(linked.action);setSessions(rows=>rows.some(r=>r.id===linked.id)?rows:[linked,...rows]);}else setNotice('关联记录不属于当前渠道的接入分析，请重新选择。');}
    }).catch(e=>{if(active)setNotice(e.message);});
    return()=>{active=false;};
  },[initialChannel,initialSessionRef]);
  async function act(fn:()=>Promise<void>){setBusy(true);setNotice('');try{await fn();}catch(e){setNotice(e instanceof Error?e.message:'操作失败');}finally{setBusy(false);}}
  function edit(model?:Model){setEditingModel(model);setShowModels(true);}
  function saveModel(saved:Model){setModels(rows=>[saved,...rows.filter(m=>m.id!==saved.id)]);setModelId(saved.id);setEditingModel(undefined);setShowModels(false);setNotice('模型配置已保存，密钥由后端加密保管；尚未调用模型或完成映射。');}
  async function send(){
    let current=session;
    if(!current){current=await backendRequest<Session>('mappings','POST',{channel,action});setSession(current);setSessions(rows=>[current!,...rows]);}
    const updated=await backendRequest<Session>(`mappings/${current.id}`,'POST',{connection_id:modelId,expected_revision:current.revision,message});
    setSession(updated);setSessions(rows=>rows.map(s=>s.id===updated.id?updated:s));setMessage('');
  }
  async function openSession(id:string){const s=await backendRequest<Session>(`mappings/${id}`);if(embedded&&(s.channel!==initialChannel||!['store.package','listing.publish'].includes(s.action)))throw new Error('此节点只使用当前渠道的接口包分析记录。');setSession(s);setChannel(s.channel);setAction(s.action);const previous=s.messages.at(-1);if(previous?.connection_id&&models.some(m=>m.id===previous.connection_id))setModelId(previous.connection_id);}
  function exportMapping(){if(!session)return;const url=URL.createObjectURL(new Blob([JSON.stringify({format:'commerceos.mapping-draft@1',...session},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`mapping-${session.id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  return <>{!embedded&&<PageHeader title="接口字段映射" description="独立接入步骤：选模型、读取接口、确认映射。" actions={<Link className="ui-button" href="/workflow/builder">返回工作流 ↗</Link>}/>}
    <div className={styles.layout}><main className={styles.main}>
      <Card className={styles.panel}><div className={styles.heading}><h2>接口映射</h2><NodeAccess mode="parameters"/></div>
        <p className={styles.muted}>首次接入或接口变更时分析；验收并注册适配代码后，日常发布复用代码。这里不会改商品、部署代码或调用发布接口。</p>
        <div className={styles.notice}>{embedded?<p>当前渠道：{channel} · 系统确定接入范围，无需选择动作。</p>:<label className={styles.composer}>销售渠道<Input aria-label="映射销售渠道" value={channel} onChange={e=>setChannel(e.target.value)} disabled={busy||!!session}/></label>}<p>新建分析覆盖完整接口包：商品检查、上架、回执查询、可售确认、下架、状态查询，以及订单、客户、账目读取。</p><p className={styles.muted}>测试站接口包 1.4.0 共九项实际 HTTP 契约。账目映射收款、退款与成本，不直接映射模型计算的利润；付款、采购、发货、消息和广告执行仍未支持。</p>{session&&<p>当前记录沿用创建时的契约快照；旧记录不会自动新增字段。需要九项新版范围，请点击“新建映射”。</p>}{session&&session.action!=='store.package'&&<p>这是历史单动作记录，不能代表完整接口包。新建分析将使用系统完整范围。</p>}</div>
        <div className={styles.fields}><label>使用的大模型<SelectField aria-label="映射大模型" value={modelId} onChange={e=>setModelId(e.target.value)} disabled={busy}><option value="">请选择或添加模型</option>{models.map(m=><option key={m.id} value={m.id}>{m.name} · {m.model_id}</option>)}</SelectField></label><div className={styles.actions}><Button onClick={()=>edit()} disabled={busy}>＋ 添加模型</Button>{modelId&&<Button onClick={()=>edit(models.find(m=>m.id===modelId))} disabled={busy}>编辑模型</Button>}</div></div>
        <p className={styles.muted}>可在对话中切换模型，沿用同一份接口资料与映射记录。</p>
        {showModels&&<ModelConnectionForm key={editingModel?.id??'new'} model={editingModel} onSaved={saveModel} onCancel={()=>{setShowModels(false);setEditingModel(undefined);}}/>}
      </Card>
      <Card className={styles.panel}><h2>与模型确认接口</h2><p className={styles.muted}>粘贴 API 文档、参数说明和脱敏响应；资料会发给你选择的模型服务。后续直接回答模型的问题即可。</p>
        {session?.messages.map((m,i)=><article key={i} className={styles.message}><strong>{m.role==='user'?'你':`${m.provider} · ${m.model}`}</strong>{m.role==='user'?<p>{m.content}</p>:<p>{(()=>{try{return (JSON.parse(m.content) as Answer).summary;}catch{return m.content;}})()}</p>}</article>)}
        <label className={styles.composer}>接口资料 / 补充说明<textarea className="ui-input" aria-label="接口资料 / 补充说明" rows={7} maxLength={30000} value={message} onChange={e=>setMessage(e.target.value)} placeholder="例如：这是商品创建 API，price 单位是美分，库存字段表示可售数量……" disabled={busy}/></label>
        <div className={styles.actions}><Button variant="primary" disabled={busy||showModels||!modelId||!message.trim()||!channel.trim()} onClick={()=>void act(send)}>{busy?'模型处理中…':session?'继续确认映射':'开始映射'}</Button>{session&&<Button disabled={busy} onClick={()=>{setSession(null);setAction('store.package');setMessage('');}}>新建映射</Button>}</div>
        {onApplyDraft&&<div className={styles.notice}><p>关联到当前节点仅保存记录引用和修订号，不是“映射已通过”，也不会自动绑定发布 Skill。模型配置与对话单独保存在后端。</p><Button disabled={busy||!!session?.busy||!session?.result.summary||session.revision<2||session.channel!==initialChannel||!['store.package','listing.publish'].includes(session.action)} onClick={()=>{if(session)onApplyDraft(session);}}>关联映射草案到节点</Button></div>}
        {notice&&<p role="status" className={styles.notice}>{notice}</p>}
      </Card>
      {session?.result.summary&&<Card className={styles.panel}><div className={styles.heading}><h2>映射结果</h2><Badge tone="warning">草案 · 待验收</Badge></div><p>{session.result.summary}</p><div className={styles.tableWrap}><table><thead><tr><th>动作</th><th>方向</th><th>系统固定字段</th><th>店铺字段</th><th>含义 / 转换 / 依据</th><th>状态</th></tr></thead><tbody>{session.result.mappings?.map((r,i)=><tr key={i}><td>{actions.find(a=>a[0]===(r.action??session.action))?.[1]??r.action}</td><td>{r.direction==='request'?'发送请求':'接收结果'}</td><td>{r.fixed_path}</td><td>{r.external_path||'待补充'}</td><td>{r.meaning}<br/>{r.conversion}<br/><small>{r.evidence}</small></td><td>{labels[r.status]}</td></tr>)}</tbody></table></div>{!!session.result.questions?.length&&<><h3>需要你确认</h3><ul>{session.result.questions.map((q,i)=><li key={i}>{q}</li>)}</ul></>}{!!session.result.limitations?.length&&<><h3>接口缺口</h3><ul>{session.result.limitations.map((q,i)=><li key={i}>{q}</li>)}</ul></>}<Button onClick={exportMapping}>导出映射草案</Button></Card>}
    </main><aside className={styles.main}>
      <Card className={styles.panel}><h3>映射规则 Skill</h3><label className={styles.composer}>当前使用的规则<SelectField aria-label="映射规则 Skill" value={mappingRule.id} disabled><option value={mappingRule.id}>{mappingRule.title} · 系统内置</option></SelectField></label><Badge tone="info">已使用 · 系统规则</Badge><p className={styles.muted}>后端已读取此规则，不需要再次安装。可选择大模型；规则与固定契约由系统维护，不是上架执行 Skill。</p><div className={styles.actions}><a className="ui-button" href={`/integration-skills/${mappingRule.id}/SKILL.md`} target="_blank" rel="noopener noreferrer">查看 Skill</a><a className="ui-button" href={`/integration-skills/${mappingRule.id}/SKILL.md`} download>下载 Skill</a><Link className="ui-button" href="/skills">查看我的技能</Link></div></Card>
      <Card className={styles.panel}><h3>系统固定契约</h3><p className={styles.muted}>准备节点设计为 ApprovedListing@1 → PreparedChannelPublication@1，不改已审核商品；真实 CJ 主线按已安装测试站适配代码准备并检查请求，不在日常发布时调用模型猜值。本次模型分析参照后端实际的 test-store.v1 HTTP 契约，与画布设计契约不是同一协议。其他渠道可以分析差异，但缺口未补齐不能发布。</p>{session&&<details><summary>查看本次固定输入输出</summary><pre className={styles.json}>{JSON.stringify(session.contract,null,2)}</pre></details>}</Card>
      <Card className={styles.panel}><h3>{embedded?'本渠道接入分析记录':'映射记录'}</h3>{sessions.filter(s=>!embedded||s.channel===initialChannel&&['store.package','listing.publish'].includes(s.action)).map(s=><Button key={s.id} disabled={busy} aria-pressed={s.id===session?.id} onClick={()=>void act(()=>openSession(s.id))}>{s.channel} · {actions.find(a=>a[0]===s.action)?.[1]} · 第 {s.revision-1} 轮</Button>)}{!sessions.some(s=>!embedded||s.channel===initialChannel&&['store.package','listing.publish'].includes(s.action))&&<p className={styles.muted}>尚无匹配记录</p>}</Card>
    </aside></div></>;
}

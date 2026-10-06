'use client';
import {useEffect,useState,type FormEvent} from 'react';
import Link from 'next/link';
import {PageHeader} from '@/components/app/page-header';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {Input} from '@/components/ui/input';
import {SelectField} from '@/components/ui/select-field';
import {Icon} from '@/components/ui/icon';
import {backendRequest} from '@/lib/workflow/backend-client';
import type {ModelConnection} from '@/lib/workflow/model-connections';
import {agentMessageText,agentPurposeNames,type AgentPurpose,type AgentSession} from '@/lib/agents';
import {ModelConnectionsWindow} from '@/components/commerce/workflow/model-connections-window';
import styles from './agents.module.css';

export function AgentConversation({fixedPurpose,embedded=false}:{fixedPurpose?:AgentPurpose;embedded?:boolean}={}){
 const [models,setModels]=useState<ModelConnection[]>([]),[model,setModel]=useState(''),[sessions,setSessions]=useState<AgentSession[]>([]);
 const [session,setSession]=useState<AgentSession|null>(null),[purpose,setPurpose]=useState<AgentPurpose>(fixedPurpose??'assistant');
 const [input,setInput]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[modelOpen,setModelOpen]=useState(false);
 useEffect(()=>{let alive=true;void Promise.all([backendRequest<ModelConnection[]>('model-connections'),backendRequest<AgentSession[]>('agent-sessions')]).then(([connections,history])=>{
  if(!alive)return;const rows=fixedPurpose?history.filter(s=>s.purpose===fixedPurpose):history;setModels(connections);setSessions(rows);if(rows[0]){setSession(rows[0]);setPurpose(rows[0].purpose);const used=rows[0].messages.at(-1)?.connection_id;setModel(connections.some(m=>m.id===used)?used!:'');}
 }).catch(e=>{if(alive)setError(e instanceof Error?e.message:'无法读取模型与会话');}).finally(()=>{if(alive)setLoading(false);});return()=>{alive=false;};},[fixedPurpose]);
 useEffect(()=>{if(!session?.busy||busy)return;let alive=true;const id=session.id;const timer=setInterval(()=>{void backendRequest<AgentSession>(`agent-sessions/${id}`).then(value=>{if(alive)setSession(value);}).catch(()=>{if(alive)setNotice('本轮状态暂时无法读取，请手动刷新会话。');});},2000);return()=>{alive=false;clearInterval(timer);};},[session?.id,session?.busy,busy]);
 const pending=busy||session?.busy;
 async function send(event:FormEvent){event.preventDefault();if(!input.trim()||!model||pending)return;setBusy(true);setError('');setNotice('Pi harness 正在调用所选模型，尚未完成…');
  try{const active=session??await backendRequest<AgentSession>('agent-sessions','POST',{purpose});if(!session)setSession(active);
   const value=await backendRequest<AgentSession>(`agent-sessions/${active.id}`,'POST',{connection_id:model,expected_revision:active.revision,message:input.trim()});
   setSession(value);setSessions(rows=>[value,...rows.filter(s=>s.id!==value.id)]);setInput('');setNotice('本轮已完成并保存。仅返回建议，没有执行业务写入。');
  }catch(e){setError(e instanceof Error?e.message:'调用失败');setNotice('没有模型成功结果，不会回退演示回复。');}finally{setBusy(false);}
 }
 async function refresh(){if(!session)return;try{setSession(await backendRequest<AgentSession>(`agent-sessions/${session.id}`));setNotice('已读取服务端会话。');}catch(e){setError(e instanceof Error?e.message:'读取失败');}}
 function fresh(next=purpose){if(pending)return;setSession(null);setPurpose(next);setInput('');setError('');setNotice('新对话尚未调用模型。');}
 const extras=session?.result;
 const extraNames:Record<string,string>={facts_used:'依据资料',questions:'需补充的问题',preserve:'需保留的特征',forbidden_changes:'禁止改动'};
 return <><PageHeader title={embedded?'客服 Skill 执行':'运营助手'} description={embedded?'输入客户问题与已确认资料；生成草稿，不调用渠道发送接口。':'真实模型会话 · Pi harness 运行 · 业务操作仍由工作流授权'} actions={<><Button disabled={!!pending} onClick={()=>setModelOpen(true)}>添加大模型 API</Button><Button disabled={!!pending} onClick={()=>fresh()}>新建对话</Button></>}/>
 <div className="assistant-layout"><Card className="conversation">
  <div className={styles.controls}><label>运行时 Skill<SelectField aria-label="运行时模型 Skill" disabled={!!fixedPurpose||!!session||!!pending||loading} value={purpose} onChange={e=>fresh(e.target.value as AgentPurpose)}>{Object.entries(agentPurposeNames).filter(([id])=>!fixedPurpose||id===fixedPurpose).map(([id,name])=><option key={id} value={id}>{name}</option>)}</SelectField></label>
  <label>使用的模型<SelectField aria-label="对话使用的模型" disabled={!!pending||loading} value={model} onChange={e=>setModel(e.target.value)}><option value="">请选择已配置模型</option>{models.map(m=><option key={m.id} value={m.id}>{m.name} · {m.model_id}</option>)}</SelectField></label></div>
  <div className="conversation-scroll">
  {loading?<p role="status">读取后端会话…</p>:!session?.messages.length?<div className="assistant-welcome"><span className="assistant-symbol"><Icon name="sparkles" size={28}/></span><Badge tone="neutral">Pi Agent · {agentPurposeNames[purpose]}</Badge><h2>从一个真实问题开始。</h2><p>{purpose==='customer_support'?'提供客户问题及已确认的订单、物流或政策资料。输出回复草稿，不发送消息。':purpose==='product_image_plan'?'提供商品事实、原图描述和视觉要求。当前生成方案，不生成图片文件。':'选择已配置模型后发送问题。不会自动读取经营数据或执行操作。'}</p></div>:session.messages.map((message,index)=><div key={index} className={message.role==='user'?'user-message':'full-assistant-message'}>{message.role==='assistant'&&<span><Icon name="sparkles" size={18}/></span>}<div><p className={styles.text}>{agentMessageText(message)}</p>{message.role==='assistant'&&<small className={styles.meta}>{message.model} · {message.usage?.harness?`Pi ${message.usage.harness.version} · 本轮真实调用已完成`:'历史会话记录'}</small>}</div>{message.role==='user'&&<span>你</span>}</div>)}
  {extras&&Object.entries(extras).filter(([key,value])=>key in extraNames&&Array.isArray(value)&&value.length).map(([key,value])=><div key={key} className={styles.evidence}><b>{extraNames[key]}</b><ul>{(value as string[]).map((item,i)=><li key={i}>{item}</li>)}</ul></div>)}
  {extras?.handoff_required===true&&<Badge tone="warning">需转人工确认</Badge>}
  </div><form className="full-composer" onSubmit={send}><Input aria-label="发送给模型的问题" disabled={!!pending||loading} value={input} maxLength={12000} onChange={e=>setInput(e.target.value)} placeholder="提供必要事实，勿粘贴密钥或支付资料…"/><Button type="submit" variant="primary" disabled={!input.trim()||!model||!!pending||loading}>{pending?'模型执行中…':'发送'}</Button></form>
  {error&&<div className={styles.feedback} role="alert">{error} {session&&<Button compact disabled={busy} onClick={()=>void refresh()}>刷新会话</Button>}</div>}<div className="composer-caption" role="status">{notice||'会话由后端保存，刷新不会重新发送。最多 20 轮；不会自动切换模型或重试付费调用。'}</div></Card>
 <Card className="assistant-context"><span className="section-eyebrow">CONTROLLED AGENT</span><h2>建议与执行分开</h2><p>运行时模型 Skill 只管理对话策略，不是开发接口的规则，也不是选品算法或发布适配包。</p><div className="assistant-boundary"><Icon name="info" size={17}/><p>目前没有发送消息、退款、发布、采购、修改流程或 Shell 工具。客服输出需人工确认；商品图方案还需接图像服务。</p></div>
 <h3 className={styles.historyTitle}>已保存对话</h3><div className={styles.history}>{sessions.map(s=><Button key={s.id} variant="ghost" disabled={!!pending} aria-pressed={s.id===session?.id} onClick={()=>{setSession(s);setPurpose(s.purpose);setInput('');setError('');setNotice('已打开历史会话；没有调用模型。');}}>{agentPurposeNames[s.purpose]} · {s.messages.length/2} 轮</Button>)}</div><Link className="assistant-context-link" href="/workflow/builder">返回工作流配置 <Icon name="arrow" size={16}/></Link></Card>
 </div>{modelOpen&&<ModelConnectionsWindow onClose={()=>{setModelOpen(false);void backendRequest<ModelConnection[]>('model-connections').then(setModels).catch(e=>setError(e instanceof Error?e.message:'读取模型失败'));}}/>}</>;
}

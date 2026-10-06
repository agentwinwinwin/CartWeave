"use client";
import {useState,type FormEvent} from 'react';
import Link from 'next/link';
import {PageHeader} from '@/components/app/page-header';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {Input} from '@/components/ui/input';
import {Icon,type IconName} from '@/components/ui/icon';
const prompts=['梳理我的选品条件','设计商品内容策略','了解店铺接口接入'];
const links=[['/workflow/builder','workflow','选品与发布','配置任务、查看运行与审核'],['/products','box','商品管理','查看发布状态与渠道回执'],['/workflow/mapping','connect','接口语义映射','配置模型、分析店铺接口']];
export function AssistantPage(){
 const [input,setInput]=useState(''),[messages,setMessages]=useState<string[]>([]),[notice,setNotice]=useState('');
 function send(event:FormEvent){event.preventDefault();if(!input.trim())return;setMessages(rows=>[...rows,input.trim()]);setInput('');setNotice('已添加到本页草稿。对话执行器尚未接入，没有发送给模型或执行业务操作。');}
 return <><PageHeader title="运营助手" description="围绕商品、店铺与工作流组织你的问题和运营思路。" actions={<Button onClick={()=>{setInput('');setMessages([]);setNotice('已清空本页对话草稿。');}}>新建草稿</Button>}/>
 <div className="assistant-layout"><Card className="conversation"><div className="conversation-scroll">
 {!messages.length?<div className="assistant-welcome"><span className="assistant-symbol"><Icon name="sparkles" size={28}/></span><Badge tone="neutral">对话界面预览</Badge><h2>让下一步，更清晰。</h2><p>把你的经营目标、选品思路或接口问题写在这里。<br/>当前只保存本页草稿，不调用模型、不执行操作。</p><div className="ai-suggestions">{prompts.map(p=><Button key={p} onClick={()=>setInput(p)}>{p}<Icon name="arrow" size={16}/></Button>)}</div></div>:messages.map((m,index)=><div className="user-message" key={index}><p>{m}</p><span>你</span></div>)}
 </div><form className="full-composer" onSubmit={send}><Input aria-label="运营问题草稿" value={input} maxLength={4000} onChange={e=>setInput(e.target.value)} placeholder="描述你的目标，先从一个问题开始…"/><Button type="submit" variant="primary" disabled={!input.trim()}>添加草稿</Button></form><div className="composer-caption" role="status">{notice||'草稿仅保留在当前页面；刷新后清空。'}</div></Card>
 <Card className="assistant-context"><span className="section-eyebrow">CONNECTED WORKSPACE</span><h2>从工作区开始</h2><p>以下入口已接入实际配置与后端记录，不使用虚构的运营提醒。</p>{links.map(([href,icon,title,description])=><Link key={href} href={href} className="assistant-context-link"><Icon name={icon as IconName}/><span><b>{title}</b><small>{description}</small></span><Icon name="arrow" size={16}/></Link>)}<div className="assistant-boundary"><Icon name="info" size={17}/><p>审批在运行流程内完成。这里不会批准商品、付款或启动广告。</p></div></Card>
 </div></>;
}

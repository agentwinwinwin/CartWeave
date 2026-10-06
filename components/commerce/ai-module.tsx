"use client";
import { useState } from "react";
import { DashboardPanel } from "@/components/layout/dashboard-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionHeading } from "./section-heading";

const prompts=["查看待审核商品","分析转化下降原因","打开异常订单","查看客户复购情况"];
export function AiModule({notify}:{notify:(message:string)=>void}){const [message,setMessage]=useState("");return <DashboardPanel index={6} label="对话 AI / 审批中心" active="技能"><div className="chat-layout"><div className="chat-main"><SectionHeading title="对话 AI" description="你的电商运营 AI 助手，随时为你提供数据洞察与执行建议。"/><div className="assistant-message"><span>✦</span><p>你好！我是 CommerceOS AI 助手。<br/>今天有 3 个商品排名上架审核、2 个物流异常、1 个退款申请待处理。<br/>此外，昨日店铺销售额较前一日下降 12%，主要来自美国市场的转化率下降。需要我帮你查看具体数据或执行某项操作吗？</p></div><div className="prompt-list">{prompts.map(prompt=><Button variant="pill" key={prompt} onClick={()=>setMessage(prompt)}>{prompt}</Button>)}</div><form className="composer" onSubmit={event=>{event.preventDefault();if(message.trim()){notify("消息已发送给 AI 助手");setMessage("")}}}><Input value={message} onChange={event=>setMessage(event.target.value)} placeholder="输入你的问题，或选择一个快捷操作..."/><Button type="submit" variant="primary" compact aria-label="发送">➤</Button></form></div><aside className="detail-card approval-card"><h3>▣ 审批中心　⌄</h3><div className="approval-tabs"><b>待处理 (6)</b><span>已处理</span></div>{[["商品上架审核","夏季新品计划包含 3 个商品待审核","3"],["退款审核","订单 #1003283 申请退款","1"],["物流异常处理","2 个订单出现物流异常","2"]].map(([name,detail,count])=><div className="approval-item" key={name}><b>{count}</b><strong>{name}</strong><small>{detail}</small></div>)}</aside></div></DashboardPanel>}

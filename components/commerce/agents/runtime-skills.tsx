'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {backendRequest} from '@/lib/workflow/backend-client';
import type {AgentSkill} from '@/lib/agents';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import styles from '../skills/personal-skills.module.css';
export function RuntimeSkills(){
 const [skills,setSkills]=useState<AgentSkill[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 async function load(){setLoading(true);setError('');try{setSkills(await backendRequest<AgentSkill[]>('agent-skills'));}catch(e){setError(e instanceof Error?e.message:'读取失败');}finally{setLoading(false);}}
 useEffect(()=>{void load();},[]);
 return <section><div className={styles.heading}><h2>运行时模型 Skill</h2><Button disabled={loading} compact onClick={()=>void load()}>刷新</Button></div><p className={styles.muted}>通过 Pi harness 调用大模型。与接口开发规则、确定性选品算法、店铺适配代码分开，不混入发布执行器的下拉框。当前是受控建议策略，没有业务写入工具。</p>
 {error?<p role="alert" className={styles.note}>{error}</p>:loading?<p role="status">读取模型策略…</p>:<div className={styles.grid}>{skills.map(skill=><Card key={skill.id} className={styles.card}><Badge tone="info">模型策略 · Pi harness</Badge><h3>{skill.title}</h3><p>v{skill.version} · {skill.output??'文本建议'}</p><p>{skill.id==='customer_support'?'依据用户提供的必要事实生成客服回复草稿，不发送、不退款。':skill.id==='product_image_plan'?'生成商品图提示词与约束方案；尚未接图片文件生成。':'真实运营对话，未知经营数据不编造，不修改业务配置。'}</p><div className={styles.actions}><Link className="ui-button" href="/assistant">在运营助手使用</Link></div></Card>)}</div>}</section>;
}

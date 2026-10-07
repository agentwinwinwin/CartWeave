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
 async function load(){setLoading(true);setError('');try{setSkills((await backendRequest<AgentSkill[]>('agent-skills')).filter(s=>s.id!=='assistant'));}catch(e){setError(e instanceof Error?e.message:'读取失败');}finally{setLoading(false);}}
 useEffect(()=>{void load();},[]);
 return <section><div className={styles.heading}><h2>运行时模型 Skill</h2><Button disabled={loading} compact onClick={()=>void load()}>刷新</Button></div><p className={styles.muted}>通过 Pi harness 调用大模型。与接口开发规则、确定性选品算法、店铺适配代码分开，不混入发布执行器的下拉框。当前是受控建议策略，没有业务写入工具。</p>
 {error?<p role="alert" className={styles.note}>{error}</p>:loading?<p role="status">读取模型策略…</p>:<div className={styles.grid}>{skills.map(skill=><Card key={skill.id} className={styles.card}><Badge tone="info">模型策略 · Pi harness</Badge><h3>{skill.title}</h3><p>v{skill.version} · {skill.output??'文本建议'}</p><p>{skill.id==='customer_support_rag'?'检索开源测试政策并引用证据；在客服测试台选择模型，确认后仅模拟渠道收发。':skill.id==='customer_support'?'历史客服回复草稿策略，已保存会话保留，不冒充知识库检索。':skill.id==='product_image_photography'?'GitHub CC0 商品摄影模板，白背景、特写与场景方案；在原六步商品图流程可选。':skill.id==='product_image_batch'?'原逐张方案 v2，保留旧批次与独立 Sunburst 执行器。':'历史单提示词方案，不自动升级为逐张任务。'}</p><div className={styles.actions}><Link className="ui-button" href={skill.id.startsWith('product_image')?'/workflow/builder?template=product-images':'/support'}>{skill.id.startsWith('product_image')?'在商品图流程使用':'查看客服记录与测试'}</Link></div></Card>)}</div>}</section>;
}

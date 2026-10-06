"use client";
import {useState} from "react";
import {WorkflowCard} from "./workflow-card";
import {Card} from "@/components/ui/card";
import Link from "next/link";
import styles from "./integration-flow.module.css";

const steps = [
  {id:"read",title:"读取店铺接口",description:"读取实际 API 文档、字段与响应样例。",input:"店铺接口资料＋系统固定契约",output:"接口能力与字段证据",detail:"已有 API 直接读取；独立站缺少 API 时，先按接入规则增量开发。只处理所选动作，不改你的固定输入输出。"},
  {id:"map",title:"大模型语义映射",description:"理解参数含义，对齐节点固定输入输出。",input:"接口字段证据＋系统固定契约",output:"双向映射草案＋待确认问题",detail:"系统组织模型分析，而不是运营可替换的 Skill。逐项核对规格、ID、币种、库存口径与状态；遇到缺字段或有损转换，与你确认后再继续，不能猜值或修改固定契约。"},
  {id:"check",title:"校验映射与样例",description:"固定契约校验，并测试真实业务含义。",input:"已确认映射＋脱敏接口样例",output:"验证结果或明确缺口",detail:"服务端用 Pydantic 检查结构，样例测试检查语义。平台已接收不等于商品可售。未通过则带具体差异返回映射节点；缺少证据时等待补充，不自动放行。"},
  {id:"register",title:"审核并注册适配包",description:"固化映射代码，供后续节点统一复用。",input:"验证通过的映射代码与测试证据",output:"受信适配包版本与连接引用",detail:"经代码审查和接口联调后才注册；未通过保持草稿。注册不自动发布商品，也不授予采购、付款权限。接口变化时重新映射和验收。"},
] as const;

/** Design-only onboarding: separate from the executable per-product workflow. */
export function IntegrationFlow({channel}:{channel?:string}){
  const [selected,setSelected]=useState<string>("map");
  const step=steps.find(s=>s.id===selected)!;
  return <section className={styles.flow} aria-label="店铺接入流程图">
    <header><h3>首次接入 · 系统固定流程</h3><p>大模型只在接入或接口升级时参与映射，不在每次上架时重新猜字段。</p><small>打开映射步骤可选模型并调用；生成的映射草案仍需验收后制作、注册适配代码。</small></header>
    <ol className={styles.nodes}>{steps.map((s,i)=><li key={s.id}>
      <WorkflowCard eyebrow={`0${i+1} / ${s.id==="map"?"LLM 语义分析":"系统接入"}`} title={s.title} description={s.description} label="接入设计" meta="查看说明" editMode="fixed" selected={selected===s.id} onClick={()=>setSelected(s.id)}/>
      {i<steps.length-1&&<span className={styles.arrow} aria-hidden="true">→</span>}
    </li>)}</ol>
    <Card className={styles.detail}><strong>{step.title}</strong><p>{step.detail}</p>{selected==='map'&&<Link className="ui-button" href="/workflow/builder?configure=mapping">配置模型与映射 Skill ↗</Link>}<dl><div><dt>输入</dt><dd>{step.input}</dd></div><div><dt>输出</dt><dd>{step.output}</dd></div></dl></Card>
    <p className={styles.return}>↶ 校验不通过：回到语义映射补充；业务含义不明确：等待你的确认。</p>
    <footer><strong>日常运行 · 不再调用模型做映射</strong><p>节点固定输入 → 已注册适配代码 → 店铺 API → 适配代码归一化 → 节点固定输出 → 下一个节点</p></footer>
  </section>;
}

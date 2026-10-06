import Link from "next/link";
import {Card} from "@/components/ui/card";
import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
import {integrationRules} from "@/lib/skills/personal";
import styles from "./personal-skills.module.css";

/** Shared entry points; configuration opens the existing persistent draft editor. */
export function IntegrationSkillEntries({channel="我的店铺",actions,query:search="",onCreate,onConfigureMapping}:{channel?:string;actions?:string[];query?:string;onCreate?:()=>void;onConfigureMapping?:()=>void}){
  const query=new URLSearchParams({channel});
  if(actions)query.set("actions",actions.join(","));
  const entries=integrationRules.filter(e=>`${e.title} ${e.role} ${e.description}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <section aria-label="店铺接入 Skill 配置"><p className={styles.muted}>这两个规则已随项目提供，不需要安装。开发与映射使用规则；日常发布使用已审核的执行适配包。</p><div className={styles.ruleGrid}>{entries.map(e=><Card key={e.id} className={styles.card}>
    <div className={styles.ruleHeader}><Badge tone="info">{e.role}</Badge><Badge tone="neutral">项目内置 · 可使用</Badge></div><h3>{e.title}</h3><p>{e.description}</p>
    <div className={styles.ruleActions}>{e.configure==='mapping'&&onConfigureMapping?<Button type="button" onClick={onConfigureMapping}>选择并配置映射规则</Button>:e.configure==='development'&&onCreate?<Button type="button" onClick={onCreate}>选择并配置 API 生成规则</Button>:<Link className="ui-button ui-button--secondary" href={e.configure==='mapping'?`/workflow/builder?configure=mapping`:`/skills?create=development&${query.toString()}`}>{e.configure==='mapping'?'选择并配置映射规则':'选择并配置 API 生成规则'}</Link>}<a className="ui-button ui-button--ghost" href={`/integration-skills/${e.id}/SKILL.md`} target="_blank" rel="noopener noreferrer">查看规则</a><a className="ui-button ui-button--ghost" href={`/integration-skills/${e.id}/SKILL.md`} download={`${e.id}-SKILL.md`}>下载 Skill</a></div>
  </Card>)}</div>{!entries.length&&<div className={styles.empty}>没有匹配的接入规则。</div>}</section>;
}

"use client";
import Link from "next/link";
import {DashboardPanel} from "@/components/layout/dashboard-panel";
import {Card} from "@/components/ui/card";
import {SectionHeading} from "./section-heading";
import {skillKinds} from "@/lib/skills/personal";

export function SkillModule(_props:{notify:(message:string)=>void}){
  return <DashboardPanel index={5} label="我的技能" active="技能">
    <SectionHeading title="我的技能" description="一次制作，反复使用；后端版本与制作草稿分开管理。" actions={<Link className="ui-button ui-button--secondary" href="/skills">打开我的技能</Link>}/>
    <div className="skill-grid">{Object.entries(skillKinds).map(([id,item])=><Card className="skill-card" key={id}><h3><span>{item.icon}</span>{item.name}</h3><p>{item.description}</p><small>职责说明 · 不表示已经安装或可执行</small></Card>)}</div>
    <p>默认保留原素材。生成产品图、广告词等能力按需制作。</p>
  </DashboardPanel>;
}

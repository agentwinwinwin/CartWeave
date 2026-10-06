"use client";
import { DashboardPanel } from "@/components/layout/dashboard-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionHeading } from "./section-heading";

const nodes = [
  {id:"trigger",icon:"◷",title:"定时触发器",lines:[["频率","每 6 小时"],["上次运行","08:00"],["耗时","0.1秒"]]},
  {id:"discover",icon:"🔗",title:"CJ 商品发现",lines:[["接口","CJ API"],["搜索词","热门商品"],["最大结果","50"]]},
  {id:"score",icon:"✦",title:"AI 商品评估",lines:[["模型","GPT-4o"],["评估维度","需求·利润"],["输出","分数"]]},
  {id:"condition",icon:"⌘",title:"条件判断",lines:[["条件","分数 ≥ 70"],["为真","上架"],["为假","跳过"]]},
  {id:"copy",icon:"▣",title:"生成商品文案",lines:[["模板","电商 v1"],["包含","标题·卖点"],["耗时","1.6秒"]]},
  {id:"notice",icon:"✉",title:"商家通知",lines:[["发送对象","店铺负责人"],["模板","任务提醒"],["渠道","邮件"]]},
  {id:"publish",icon:"☁",title:"发布商品",lines:[["平台","Shopify"],["状态","已启用"],["商品集合","自动分配"]]},
];

export function WorkflowModule({ notify }: { notify: (message:string)=>void }) {
  return <DashboardPanel index={1} label="工作流编辑器" active="工作流"><SectionHeading title={<>←&nbsp; 自动选品与上架 <Badge>草稿</Badge></>} description="从 CJ 发现潜力商品，用 AI 评估后发布到你的店铺。" actions={<><Button onClick={()=>notify("工作流已开始运行")}>▶ 运行</Button><Button variant="primary" onClick={()=>notify("工作流已发布")}>发布</Button><Button compact>···</Button></>}/><div className="workflow-canvas"><div className="workflow-path workflow-path--main"/><div className="workflow-path workflow-path--up"/><div className="workflow-path workflow-path--down"/>{nodes.map(node=><div className={`workflow-node workflow-node--${node.id}`} key={node.id}><h3><span>{node.icon}</span>{node.title}</h3>{node.lines.map(([label,value])=><p key={label}><span>{label}</span><b>{value}</b></p>)}</div>)}<div className="zoom-control"><button>−</button><span>100%</span><button>＋</button><button>⛶</button></div></div></DashboardPanel>;
}

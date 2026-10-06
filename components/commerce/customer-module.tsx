import { DashboardPanel } from "@/components/layout/dashboard-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, TableColumn } from "@/components/ui/data-table";
import { FilterBar } from "./filter-bar";
import { SectionHeading } from "./section-heading";

type Customer={id:string;name:string;email:string;market:string;orders:number;spent:string;tag:string;active:string};
const rows:Customer[]=[
  {id:"1",name:"Emily Zhang",email:"emily.z@example.com",market:"美国",orders:12,spent:"329.80",tag:"高价值",active:"3 天前"},
  {id:"2",name:"Michael Chen",email:"michael.c@example.com",market:"加拿大",orders:8,spent:"198.50",tag:"复购客户",active:"7 天前"},
  {id:"3",name:"Sarah Wilson",email:"sarah.w@example.com",market:"英国",orders:3,spent:"89.90",tag:"新客户",active:"1 天前"},
  {id:"4",name:"David Kim",email:"david.k@example.com",market:"澳大利亚",orders:15,spent:"420.00",tag:"高价值",active:"2 天前"},
  {id:"5",name:"Jessica Liu",email:"jessica.l@example.com",market:"美国",orders:6,spent:"156.70",tag:"潜在客户",active:"5 天前"},
  {id:"6",name:"Robert Taylor",email:"robert.t@example.com",market:"德国",orders:4,spent:"99.60",tag:"低频客户",active:"6 天前"},
];
const cols:TableColumn<Customer>[]=[{key:"name",label:"客户姓名",render:r=><b>{r.name}</b>},{key:"email",label:"邮箱",width:"24%"},{key:"market",label:"市场"},{key:"orders",label:"订单数"},{key:"spent",label:"累计消费"},{key:"tag",label:"标签",render:r=><Badge tone={r.tag==="高价值"?"success":r.tag==="复购客户"?"info":"neutral"}>{r.tag}</Badge>},{key:"active",label:"最近活跃"}];

export function CustomerModule(){return <DashboardPanel index={4} label="客户管理" active="客户"><SectionHeading title="客户管理" description="沉淀客户资产，洞察用户价值，支持精细化运营。"/><div className="split-layout split-layout--profile"><div><FilterBar placeholder="搜索客户姓名 / 邮箱..." filters={["全部市场","全部标签","全部状态"]}/><DataTable columns={cols} rows={rows}/></div><aside className="detail-card profile-card"><div className="profile-card__head"><span className="profile-avatar">E</span><div><h3>Emily Zhang</h3><small>emily.z@example.com</small><small>⌖ 美国 · 会员 1 年</small></div></div><div className="profile-kpi"><span><b>12</b><small>订单数</small></span><span><b>329.80</b><small>累计消费 (USD)</small></span></div><div className="tag-list"><Badge tone="danger">复购客户</Badge><Badge tone="danger">高价值</Badge><Badge tone="info">售后跟进</Badge><Badge tone="success">VIP</Badge></div><div className="profile-note"><b>客户备注</b><br/>喜欢户外运动类产品，通常在促销期间下单。</div><div className="profile-actions"><Button variant="primary">发送消息</Button><Button>查看订单</Button><Button>添加标签</Button></div></aside></div></DashboardPanel>}

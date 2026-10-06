import { DashboardPanel } from "@/components/layout/dashboard-panel";
import { Badge, BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, TableColumn } from "@/components/ui/data-table";
import { StatCard } from "@/components/ui/stat-card";
import { FilterBar } from "./filter-bar";
import { SectionHeading } from "./section-heading";

type Order={id:string;customer:string;product:string;amount:string;status:string;tone:BadgeTone;logistics:string;date:string};
const rows:Order[]=[
  {id:"#1003287",customer:"Emily Zhang",product:"无线蓝牙耳机",amount:"29.99",status:"待发货",tone:"warning",logistics:"-",date:"2025-07-08 10:24"},
  {id:"#1003286",customer:"Michael Chen",product:"运动水壶",amount:"19.99",status:"运输中",tone:"info",logistics:"YT123456789",date:"2025-07-08 09:15"},
  {id:"#1003285",customer:"Sarah Wilson",product:"时尚双肩包",amount:"39.99",status:"异常",tone:"danger",logistics:"物流异常",date:"2025-07-07 22:31"},
  {id:"#1003284",customer:"David Kim",product:"便携榨汁杯",amount:"24.90",status:"已完成",tone:"success",logistics:"1Z999AA123",date:"2025-07-07 18:20"},
];
const cols:TableColumn<Order>[]=[{key:"id",label:"订单号"},{key:"customer",label:"客户"},{key:"product",label:"商品"},{key:"amount",label:"金额"},{key:"status",label:"状态",render:o=><Badge tone={o.tone}>{o.status}</Badge>},{key:"logistics",label:"物流"},{key:"date",label:"下单时间"}];

export function OrderModule(){return <DashboardPanel index={3} label="订单与发货" active="订单"><SectionHeading title="订单与发货" description="管理订单处理与物流发货，实时跟踪包裹状态。"/><div className="split-layout split-layout--timeline"><div><div className="stat-grid"><StatCard label="待发货" value="28" change="↑12%" tone="blue"/><StatCard label="运输中" value="142" change="↑6%" tone="blue"/><StatCard label="异常订单" value="8" change="↑100%" tone="red"/><StatCard label="退款申请" value="12" change="↑20%" tone="red"/></div><FilterBar placeholder="搜索订单号 / 客户..." filters={["全部状态","全部物流","选择日期"]}/><DataTable columns={cols} rows={rows}/></div><aside className="detail-card timeline-card"><h3>履约进程</h3><small>订单号　#1003286</small>{["已下单　7月8日 09:15","准备发货　7月8日 10:20","已发货　7月8日 14:30","运输中　7月9日 08:12","预计送达　7月12日"].map((item,index)=><p key={item} className={index===4?"is-muted":""}>{item}</p>)}<div className="tracking">物流单号 <b>YT123456789</b></div><Button>在新窗口查看物流</Button></aside></div></DashboardPanel>}

import { DashboardPanel } from "@/components/layout/dashboard-panel";
import { Badge, BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, TableColumn } from "@/components/ui/data-table";
import { StatCard } from "@/components/ui/stat-card";
import { FilterBar } from "./filter-bar";
import { SectionHeading } from "./section-heading";

type Product = { id:string; icon:string; name:string; sku:string; category:string; status:string; tone:BadgeTone; stock:number; price:string; channel:string };
const products: Product[] = [
  {id:"1",icon:"🎒",name:"简约时尚双肩包",sku:"BPK-001",category:"箱包",status:"在售",tone:"success",stock:156,price:"39.99",channel:"Shopify"},
  {id:"2",icon:"🎧",name:"无线蓝牙耳机",sku:"EPH-002",category:"3C",status:"审核中",tone:"info",stock:23,price:"29.99",channel:"Shopify"},
  {id:"3",icon:"🥤",name:"便携式榨汁杯",sku:"CUP-003",category:"家居",status:"草稿",tone:"neutral",stock:0,price:"24.90",channel:"TikTok Shop"},
  {id:"4",icon:"🧴",name:"户外运动水壶",sku:"BOT-004",category:"运动",status:"在售",tone:"success",stock:89,price:"19.99",channel:"Shopify"},
  {id:"5",icon:"🕶",name:"太阳镜偏光墨镜",sku:"SUN-005",category:"服饰",status:"下架",tone:"danger",stock:0,price:"15.99",channel:"Temu"},
];
const columns: TableColumn<Product>[] = [
  {key:"name",label:"商品",width:"24%",render:p=><span className="product-cell"><i>{p.icon}</i>{p.name}</span>},
  {key:"sku",label:"SKU"},{key:"category",label:"分类"},{key:"status",label:"状态",render:p=><Badge tone={p.tone}>{p.status}</Badge>},{key:"stock",label:"库存"},{key:"price",label:"价格 (USD)"},{key:"channel",label:"渠道"},{key:"id",label:"操作",render:()=>"···"},
];

export function ProductModule() {
  return <DashboardPanel index={2} label="商品管理" active="商品"><SectionHeading title="商品管理" description="管理全店商品，支持批量操作与多渠道发布。" actions={<><Button>⇩ 导出</Button><Button>批量下架</Button><Button>批量上架</Button><Button variant="primary">＋ 添加商品</Button></>}/><div className="stat-grid"><StatCard label="在售商品" value="1,328" change="↑12%"/><StatCard label="待审核" value="56" change="↑8%" tone="blue"/><StatCard label="已下架" value="320" change="↓5%" tone="slate"/><StatCard label="库存预警" value="28" change="↑40%" tone="red"/></div><FilterBar placeholder="搜索商品名称 / SKU..." filters={["全部分类","全部状态","全部渠道"]}/><DataTable columns={columns} rows={products}/></DashboardPanel>;
}

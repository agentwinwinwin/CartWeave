import type { BadgeTone } from "@/components/ui/badge";

export type Product={id:string;icon:string;name:string;sku:string;category:string;status:string;tone:BadgeTone;stock:number;price:string;channel:string};
export const products:Product[]=[
  {id:"1",icon:"🎒",name:"简约时尚双肩包",sku:"BPK-001",category:"箱包",status:"在售",tone:"success",stock:156,price:"39.99",channel:"Shopify"},
  {id:"2",icon:"🎧",name:"无线蓝牙耳机",sku:"EPH-002",category:"3C",status:"审核中",tone:"info",stock:23,price:"29.99",channel:"Shopify"},
  {id:"3",icon:"🥤",name:"便携式榨汁杯",sku:"CUP-003",category:"家居",status:"草稿",tone:"neutral",stock:0,price:"24.90",channel:"TikTok Shop"},
  {id:"4",icon:"🧴",name:"户外运动水壶",sku:"BOT-004",category:"运动",status:"在售",tone:"success",stock:89,price:"19.99",channel:"Shopify"},
  {id:"5",icon:"🕶",name:"太阳镜偏光墨镜",sku:"SUN-005",category:"服饰",status:"下架",tone:"danger",stock:0,price:"15.99",channel:"Temu"},
  {id:"6",icon:"⌨️",name:"超薄蓝牙键盘",sku:"KEY-006",category:"3C",status:"在售",tone:"success",stock:72,price:"45.90",channel:"Amazon"},
  {id:"7",icon:"💡",name:"桌面氛围灯",sku:"LMP-007",category:"家居",status:"审核中",tone:"info",stock:44,price:"32.00",channel:"Shopify"},
];

export type Order={id:string;customer:string;product:string;amount:string;status:string;tone:BadgeTone;logistics:string;date:string};
export const orders:Order[]=[
  {id:"#1003287",customer:"Emily Zhang",product:"无线蓝牙耳机",amount:"29.99",status:"待发货",tone:"warning",logistics:"-",date:"2025-07-08 10:24"},
  {id:"#1003286",customer:"Michael Chen",product:"运动水壶",amount:"19.99",status:"运输中",tone:"info",logistics:"YT123456789",date:"2025-07-08 09:15"},
  {id:"#1003285",customer:"Sarah Wilson",product:"时尚双肩包",amount:"39.99",status:"异常",tone:"danger",logistics:"物流异常",date:"2025-07-07 22:31"},
  {id:"#1003284",customer:"David Kim",product:"便携榨汁杯",amount:"24.90",status:"已完成",tone:"success",logistics:"1Z999AA123",date:"2025-07-07 18:20"},
  {id:"#1003283",customer:"Jessica Liu",product:"太阳镜",amount:"15.99",status:"退款中",tone:"danger",logistics:"-",date:"2025-07-07 16:05"},
];

export type Customer={id:string;name:string;email:string;market:string;orders:number;spent:string;tag:string;active:string};
export const customers:Customer[]=[
  {id:"1",name:"Emily Zhang",email:"emily.z@example.com",market:"美国",orders:12,spent:"329.80",tag:"高价值",active:"3 天前"},
  {id:"2",name:"Michael Chen",email:"michael.c@example.com",market:"加拿大",orders:8,spent:"198.50",tag:"复购客户",active:"7 天前"},
  {id:"3",name:"Sarah Wilson",email:"sarah.w@example.com",market:"英国",orders:3,spent:"89.90",tag:"新客户",active:"1 天前"},
  {id:"4",name:"David Kim",email:"david.k@example.com",market:"澳大利亚",orders:15,spent:"420.00",tag:"高价值",active:"2 天前"},
  {id:"5",name:"Jessica Liu",email:"jessica.l@example.com",market:"美国",orders:6,spent:"156.70",tag:"潜在客户",active:"5 天前"},
  {id:"6",name:"Robert Taylor",email:"robert.t@example.com",market:"德国",orders:4,spent:"99.60",tag:"低频客户",active:"6 天前"},
];

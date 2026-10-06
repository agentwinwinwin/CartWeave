/** Local, in-memory test fixture. Never submit money, mail or supplier orders. */
export type StoreProduct = { id: string; title: string; description: string; priceCents: number; stock: number; published: boolean; art: "lamp" | "cup" | "bag" };
export const testProducts: StoreProduct[] = [
  {id:"demo-lamp",title:"Halo 桌面灯",description:"柔和的光，让日常慢下来。",priceCents:4900,stock:12,published:true,art:"lamp"},
  {id:"demo-cup",title:"Everyday 陶瓷杯",description:"留一点时间给今天的第一杯。",priceCents:2400,stock:20,published:false,art:"cup"},
  {id:"demo-bag",title:"Carry 日常托特包",description:"轻装出门，装下日常所需。",priceCents:3200,stock:8,published:false,art:"bag"},
];
export type TestOrderStatus = "pending" | "paid" | "authorized" | "dispatch_requested" | "shipped" | "notified" | "delivered" | "cancelled";
export type TestOrder = {id:string;status:TestOrderStatus;currency:"USD";items:{productId:string;title:string;quantity:number;unitPriceCents:number}[];totalCents:number;events:{type:string;occurredAt:string}[]};
export type TestOrderAction = "pay" | "authorize" | "dispatch" | "ship" | "notify" | "deliver" | "cancel";
export function createTestOrder(products:StoreProduct[], cart:Record<string,number>):TestOrder {
  const items=Object.entries(cart).map(([id,quantity])=>{
    const product=products.find(p=>p.id===id);
    if(!product?.published||!Number.isInteger(quantity)||quantity<1||quantity>product.stock)throw new Error("商品未上架或数量超过测试库存。");
    return {productId:id,title:product.title,quantity,unitPriceCents:product.priceCents};
  });
  if(!items.length)throw new Error("购物车为空。");
  return {id:`TEST-${crypto.randomUUID().slice(0,8).toUpperCase()}`,status:"pending",currency:"USD",items,totalCents:items.reduce((sum,item)=>sum+item.quantity*item.unitPriceCents,0),events:[{type:"test.order.created",occurredAt:new Date().toISOString()}]};
}
const transitions:Record<TestOrderAction,{from:TestOrderStatus;to:TestOrderStatus;event:string}>={
  pay:{from:"pending",to:"paid",event:"test.order.paid"},
  authorize:{from:"paid",to:"authorized",event:"test.fulfillment.authorized"},
  dispatch:{from:"authorized",to:"dispatch_requested",event:"test.supplier.dispatch_requested"},
  ship:{from:"dispatch_requested",to:"shipped",event:"test.shipment.confirmed"},
  notify:{from:"shipped",to:"notified",event:"test.email.recorded"},
  deliver:{from:"notified",to:"delivered",event:"test.delivery.confirmed"},
  cancel:{from:"pending",to:"cancelled",event:"test.order.cancelled"},
};
export function advanceTestOrder(order:TestOrder,action:TestOrderAction):TestOrder {
  const transition=transitions[action];
  if(order.status!==transition.from)throw new Error("当前状态不允许这个操作，重复事件不会继续推进。");
  return {...order,status:transition.to,events:[...order.events,{type:transition.event,occurredAt:new Date().toISOString()}]};
}

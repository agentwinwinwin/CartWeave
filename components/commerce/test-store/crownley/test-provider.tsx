'use client';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { products as initialProducts, type Product } from './catalog';
import { createTestOrder, advanceTestOrder, type TestOrder, type TestOrderAction, type StoreProduct } from '@/lib/test-store';
export type CartLine=Product&{quantity:number;size:string;lineId:string};
type Context={products:Product[];items:CartLine[];count:number;total:number;addItem:(product:Product,quantity?:number,size?:string)=>void;updateQuantity:(id:string,quantity:number)=>void;order:TestOrder|null;placeOrder:()=>void;advance:(action:TestOrderAction)=>void;publish:(id:string)=>void;notice:string;backendStatus:string};
const CartContext=createContext<Context|null>(null);
export function CrownleyTestProvider({children}:{children:ReactNode}){
 const [products,setProducts]=useState<Product[]>(()=>structuredClone(initialProducts));
 const [items,setItems]=useState<CartLine[]>([]);const [order,setOrder]=useState<TestOrder|null>(null);const [notice,setNotice]=useState('');
 const [backendStatus,setBackendStatus]=useState('正在读取后端已发布商品…');
 const remoteIds=useRef(new Set<string>());
 useEffect(()=>{
  let active=true,busy=false;const controller=new AbortController();
  async function refresh(){
   if(busy||document.visibilityState!=='visible')return;busy=true;
   try{
    const response=await fetch(`/backend/test-store/v1/catalog${process.env.NEXT_PUBLIC_TEST_STOREFRONT_ID?`/${process.env.NEXT_PUBLIC_TEST_STOREFRONT_ID}`:''}`,{cache:'no-store',signal:controller.signal});
    if(!response.ok)throw Error();const data=await response.json() as {products:Product[]};if(!Array.isArray(data.products))throw Error();
    if(!active)return;const previous=remoteIds.current,next=new Set(data.products.map(p=>p.id));const removed=new Set([...previous].filter(id=>!next.has(id)));remoteIds.current=next;
    setProducts(current=>[...current.filter(p=>!previous.has(p.id)&&!next.has(p.id)),...data.products.map(p=>{const local=current.find(item=>item.id===p.id);return local&&previous.has(p.id)?{...p,stock:Math.min(local.stock,p.stock)}:p;})]);
    setItems(current=>current.filter(item=>!removed.has(item.id)));
    if(removed.size)setNotice('A product is no longer available and has been removed from the test cart.');
    setBackendStatus(`Django 已连接 · ${data.products.length} 件已发布商品；上下架同步，购物和订单仍为本地模拟。`);
   }catch{if(active)setBackendStatus('Django 商品目录不可用，无法确认远端商品最新状态；本地购物仍是模拟。');}finally{busy=false;}
  }
  void refresh();const timer=setInterval(()=>void refresh(),30000),onFocus=()=>void refresh();window.addEventListener('focus',onFocus);document.addEventListener('visibilitychange',onFocus);
  return()=>{active=false;controller.abort();clearInterval(timer);window.removeEventListener('focus',onFocus);document.removeEventListener('visibilitychange',onFocus);};
 },[]);
 const addItem=(product:Product,quantity=1,size='M')=>{const current=products.find(p=>p.id===product.id);if(!current||current.status!=='Active'||!Number.isInteger(quantity)||quantity<1)return;setItems(lines=>{const total=lines.filter(i=>i.id===product.id).reduce((sum,i)=>sum+i.quantity,0);if(total+quantity>current.stock){setNotice('Test inventory limit reached.');return lines;}const id=`${product.id}:${size}`;return lines.some(i=>i.lineId===id)?lines.map(i=>i.lineId===id?{...i,quantity:i.quantity+quantity}:i):[...lines,{...current,quantity,size,lineId:id}];});};
 const updateQuantity=(id:string,quantity:number)=>{if(!Number.isInteger(quantity)||quantity<0)return;setItems(lines=>{const item=lines.find(i=>i.lineId===id);if(!item)return lines;const stock=products.find(p=>p.id===item.id)?.stock??0;const other=lines.filter(i=>i.id===item.id&&i.lineId!==id).reduce((sum,i)=>sum+i.quantity,0);if(quantity+other>stock)return lines;return lines.map(i=>i.lineId===id?{...i,quantity}:i).filter(i=>i.quantity>0);});};
 const placeOrder=()=>{try{if(order&&!['delivered','cancelled'].includes(order.status))throw Error('Complete or cancel the current test order first.');const cart:Record<string,number>={};items.forEach(i=>cart[i.id]=(cart[i.id]??0)+i.quantity);const fixtures:StoreProduct[]=products.map(p=>({id:p.id,title:p.name,description:p.description??'',priceCents:Math.round(p.price*100),stock:p.stock,published:p.status==='Active',art:'bag'}));const next=createTestOrder(fixtures,cart);setOrder(next);setProducts(ps=>ps.map(p=>({...p,stock:p.stock-(cart[p.id]??0)})));setItems([]);setNotice('Test order created. No payment has been taken.');}catch(e){setNotice(e instanceof Error?e.message:'Unable to create order.');}};
 const advance=(action:TestOrderAction)=>{if(!order)return;try{const next=advanceTestOrder(order,action);setOrder(next);if(action==='cancel')setProducts(ps=>ps.map(p=>({...p,stock:p.stock+(order.items.find(i=>i.productId===p.id)?.quantity??0)})));setNotice('Simulated event recorded. No external action performed.');}catch(e){setNotice(e instanceof Error?e.message:'Unable to advance.');}};
 const publish=(id:string)=>setProducts(ps=>ps.map(p=>p.id===id?{...p,status:'Active'}:p));
 return <CartContext.Provider value={{products,items,count:items.reduce((s,i)=>s+i.quantity,0),total:items.reduce((s,i)=>s+Math.round(i.price*100)*i.quantity,0)/100,addItem,updateQuantity,order,placeOrder,advance,publish,notice,backendStatus}}>{children}</CartContext.Provider>;
}
export function useCart(){const value=useContext(CartContext);if(!value)throw Error('Crownley test provider missing');return value;}

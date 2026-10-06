"use client";
import {useEffect,useRef,useState} from "react";
import {createPortal} from "react-dom";
import Link from "next/link";
import {PageHeader} from "@/components/app/page-header";
import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
import {Card} from "@/components/ui/card";
import {Input} from "@/components/ui/input";
import {SelectField} from "@/components/ui/select-field";
import {StatCard} from "@/components/ui/stat-card";
import {Icon} from '@/components/ui/icon';
import {DataTable,type TableColumn} from "@/components/ui/data-table";
import styles from "./products-page.module.css";
import {backendRequest} from "@/lib/workflow/backend-client";
import {productStates,productSources,type WorkflowProduct,type ProductPage} from "@/lib/products";

function ProductIdentity({product}:{product:WorkflowProduct}){
 const image=product.images[0], [failedImage,setFailedImage]=useState<string|null>(null);
 return <div className={styles.productIdentity}><div className={styles.thumbnail}>{image&&failedImage!==image?<img src={image} alt={`${product.title}主图`} width={56} height={56} loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailedImage(image)}/>:<span>{image?'图片加载失败':'暂无图片'}</span>}</div><div className={styles.productCopy}><strong>{product.title}</strong><div>{product.product_id}</div></div></div>;
}
const columns:TableColumn<WorkflowProduct>[]=[
 {key:'title',label:'商品',render:p=><ProductIdentity product={p}/>},
 {key:'variants',label:'规格 / SKU',render:p=><details><summary>{p.variants.length} 个规格</summary>{p.variants.map(v=><div key={v.sku}>{v.sku} · {v.size} · {v.price} {p.currency} · 限售 {v.quantity}</div>)}</details>},
 {key:'status',label:'发布状态',render:p=><Badge tone={productStates[p.status]?.tone??'neutral'}>{productStates[p.status]?.label??'未知状态'}</Badge>},
 {key:'source_kind',label:'商品来源',render:p=>productSources[p.source_kind]??'未知来源'},
 {key:'currency',label:'售价',render:p=>{const prices=p.variants.map(v=>Number(v.price));return prices.length?`${Math.min(...prices).toFixed(2)}${Math.max(...prices)!==Math.min(...prices)?'–'+Math.max(...prices).toFixed(2):''} ${p.currency}`:'—';}},
 {key:'market',label:'市场'},
 {key:'store',label:'店铺 / 渠道',render:p=><div>{p.store.name}<div>{p.store.channel}</div></div>},
 {key:'confirmed_at',label:'可售确认时间',render:p=>p.confirmed_at?new Date(p.confirmed_at).toLocaleString():'未确认'},
 {key:'id',label:'查看',render:p=>p.status==='published'&&p.store.channel==='test-store'&&/^[a-zA-Z0-9_-]+$/.test(p.product_id)?<Link href={`/test-store/products/${encodeURIComponent(p.product_id)}`} target="_blank" rel="noopener noreferrer">测试站商品 ↗</Link>:<span>任务 {p.id.slice(0,8)}</span>},
];
function UnpublishDialog({product,onClose,onDone}:{product:WorkflowProduct;onClose:()=>void;onDone:(message:string)=>void}){
 const ref=useRef<HTMLDialogElement>(null),submitting=useRef(false),[reason,setReason]=useState('运营手动下架'),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;ref.current?.showModal();return()=>previous?.focus();},[]);
 async function submit(){if(submitting.current||!reason.trim())return;submitting.current=true;setBusy(true);setError('');try{const result=await backendRequest<{status:string}>(`products/${product.id}/unpublish`,'POST',{expected_digest:product.publication_digest,store_version:product.store_version,reason});if(!['succeeded','unknown'].includes(result.status))throw Error('渠道尚未返回可确认的下架结果，请刷新商品并核对，不会标记成功。');onDone(result.status==='succeeded'?'渠道已确认下架，商品状态已同步。':'渠道响应未知：未标记成功，请使用“核对下架结果”，系统会先查询再决定是否重试。');}catch(e){setError(e instanceof Error?e.message:'下架未确认');}finally{submitting.current=false;setBusy(false);}}
 return createPortal(<dialog ref={ref} className={styles.dialog} aria-label="确认渠道下架" onCancel={e=>{if(busy)e.preventDefault();else onClose();}}><Badge tone="warning">实际店铺操作</Badge><h2>{product.status==='unpublish_pending'?'核对下架结果':'下架这件商品？'}</h2><Card className={styles.confirmProduct}><ProductIdentity product={product}/><dl><div><dt>店铺</dt><dd>{product.store.name}</dd></div><div><dt>渠道 / 连接版本</dt><dd>{product.store.channel} · v{product.store_version}</dd></div><div><dt>接口包</dt><dd>{product.store.adapter}</dd></div></dl></Card><p>调用已接入店铺的下架接口，渠道确认后停止销售并同步商品状态。保留商品和上架历史，不取消既有订单，不退款，不触发 CJ 采购或付款。</p>{product.status==='unpublish_pending'&&<p>先查询原操作结果，再决定是否重试；不会重复生成下架操作。</p>}<label>下架原因（已填默认值，可修改）<textarea className="ui-input" aria-label="下架原因" value={reason} maxLength={1000} rows={2} disabled={busy} onChange={e=>setReason(e.target.value)}/></label>{error&&<p role="alert">{error}</p>}<div className={styles.dialogActions}><Button disabled={busy} onClick={onClose}>取消</Button><Button className={styles.dangerAction} disabled={busy||!reason.trim()} onClick={()=>void submit()}>{busy?'渠道处理中…':product.status==='unpublish_pending'?'查询并核对结果':'确认下架'}</Button></div></dialog>,document.body);
}
export function ProductsPage({archived=false}:{archived?:boolean}){
 const [query,setQuery]=useState(''),[search,setSearch]=useState(''),[status,setStatus]=useState(''),[channel,setChannel]=useState(''),[page,setPage]=useState(1),[tick,setTick]=useState(0);
 const [data,setData]=useState<ProductPage|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[synced,setSynced]=useState('');
 const [target,setTarget]=useState<WorkflowProduct|null>(null),[notice,setNotice]=useState(''),[verifying,setVerifying]=useState('');
 const serial=useRef(0);
 useEffect(()=>{const timer=setTimeout(()=>{setSearch(query);setPage(1);},250);return()=>clearTimeout(timer);},[query]);
 useEffect(()=>{
  const id=++serial.current;setLoading(true);setError('');
  const params=new URLSearchParams({page:String(page),q:search,status:archived?'inactive':status,channel,view:archived?'archived':'active'});
  backendRequest<ProductPage>(`products?${params}`).then(result=>{if(id!==serial.current)return;setData(result);setSynced(new Date().toLocaleTimeString());}).catch(e=>{if(id===serial.current){setError(e instanceof Error?e.message:'商品同步失败');setData(null);}}).finally(()=>{if(id===serial.current)setLoading(false);});
  return()=>{serial.current++;};
 },[page,search,status,channel,tick,archived]);
 useEffect(()=>{
  const refresh=()=>{if(document.visibilityState==='visible')setTick(v=>v+1);};
  const timer=setInterval(refresh,30000);window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
  return()=>{clearInterval(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
 },[]);
 const stats=data?.stats;
 const productColumns:TableColumn<WorkflowProduct>[]=[...columns.slice(0,-1),{key:'id',label:'渠道操作',render:p=><div className={styles.rowActions}>{p.status==='published'&&p.store.channel==='test-store'&&<Link href={`/test-store/products/${encodeURIComponent(p.product_id)}`} target="_blank" rel="noopener noreferrer">测试站商品 ↗</Link>}{['published','unpublish_pending'].includes(p.status)&&p.can_unpublish?<Button compact className={p.status==='published'?styles.dangerAction:undefined} disabled={!!verifying} onClick={()=>setTarget(p)}>{p.status==='unpublish_pending'?'核对下架结果':'一键下架'}</Button>:p.status==='published'&&data?.can_verify_stores?<Button compact disabled={!!verifying} onClick={()=>{setVerifying(p.store.id);setNotice('');void backendRequest(`stores/${p.store.id}/verify`,'POST',{}).then(()=>{setNotice('店铺能力已重新验收；下架仍需单独确认。');setTick(v=>v+1);}).catch(e=>setNotice(e.message)).finally(()=>setVerifying(''));}}>{verifying===p.store.id?'验收中…':'验收下架能力'}</Button>:null}{p.status==='inactive'&&<span>渠道已确认下架</span>}</div>}];
 return <><PageHeader title={archived?"已下架商品":"商品管理"} description={archived?"仅展示渠道已确认下架的商品；保留历史资料，不再出现在主商品列表。":"与真实选品上架任务同步；已确认下架的商品自动移入单独页面。"} actions={<><Button disabled={loading} onClick={()=>setTick(v=>v+1)}>{loading?'同步中…':'刷新商品'}</Button><Link className="ui-button" href={archived?"/products":"/products/archived"}>{archived?"返回商品管理":"已下架商品"}{!archived&&stats?`（${stats.inactive??0}）`:""}</Link>{!archived&&<Link className="ui-button ui-button--primary" href="/workflow/live">选品与真实上架 ↗</Link>}</>}/>
 {!archived?<div className="page-stat-grid"><StatCard label="当前商品任务" value={stats?String((stats.total??0)-(stats.inactive??0)):'—'}/><StatCard label="待审核" value={stats?String(stats.review??0):'—'} tone="blue"/><StatCard label="提交 / 确认中" value={stats?String((stats.publishing??0)+(stats.submitted??0)):'—'} tone="slate"/><StatCard label="已确认可售" value={stats?String(stats.published??0):'—'}/></div>:<div className="page-stat-grid"><StatCard label="渠道已确认下架" value={stats?String(stats.inactive??0):'—'}/></div>}
<Card className="content-card"><div className="full-filters"><div className="large-search"><Icon name="search" size={17}/><Input aria-label="搜索真实商品" value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索商品名称 / 商品 ID…" maxLength={200}/></div>{!archived&&<SelectField aria-label="商品发布状态" value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="">全部状态</option>{Object.entries(productStates).filter(([id])=>id!=='inactive').map(([id,s])=><option key={id} value={id}>{s.label}</option>)}</SelectField>}<SelectField aria-label="商品销售渠道" value={channel} onChange={e=>{setChannel(e.target.value);setPage(1);}}><option value="">全部渠道</option>{data?.channels.map(c=><option key={c} value={c}>{c}</option>)}</SelectField></div>
 <details className={styles.note}><summary>商品同步与渠道操作说明</summary><p>同一商品在不同店铺的发布任务分别记录；规格数量为发布快照，不是实时库存。下架复用已验收接口并须人工确认。渠道确认下架后移入“已下架商品”；结果未知仍留在主列表等待核对。取消任务不等于下架，当前不支持改价或批量操作。</p></details>{notice&&<p role="status" className={styles.note}>{notice}</p>}
 {error?<div role="alert" className="empty-state">{error}<p>未回退到演示商品。</p><Button onClick={()=>setTick(v=>v+1)}>重新同步</Button></div>:<div aria-busy={loading}><DataTable className={styles.table} columns={productColumns} rows={data?.results??[]} emptyText={loading?"正在同步商品任务…":archived?"暂无已确认下架的商品。结果待确认的商品仍留在商品管理中。":"暂无匹配的商品任务。完成选品并创建发布任务后，商品会同步到这里。"}/></div>}
 <footer className="table-footer"><span>{loading?'正在读取后端…':`显示 ${data?.results.length??0} 条，筛选后共 ${data?.count??0} 条 · 已下架 ${stats?.inactive??0} · ${synced?'同步于 '+synced:''}`}</span><div><Button compact disabled={loading||page===1} onClick={()=>setPage(v=>v-1)}>上一页</Button><span>第 {page} 页</span><Button compact disabled={loading||!data||page*data.page_size>=data.count} onClick={()=>setPage(v=>v+1)}>下一页</Button></div></footer></Card>{target&&<UnpublishDialog product={target} onClose={()=>setTarget(null)} onDone={message=>{setTarget(null);setNotice(message);setTick(v=>v+1);}}/>}</>;
}

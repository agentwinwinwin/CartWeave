'use client';
import {useEffect,useState} from 'react';
import {PageHeader} from '@/components/app/page-header';
import {FeatureNotice} from '@/components/app/feature-notice';
import {Card} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Badge} from '@/components/ui/badge';
import {DataTable,type TableColumn} from '@/components/ui/data-table';
import {backendRequest} from '@/lib/workflow/backend-client';
import {paymentLabels,fulfillmentLabels,shipmentLabels,type BusinessRow,type BusinessReport} from '@/lib/business';
import {BusinessSyncBar} from './business-sync-bar';

export function BusinessRecordsPage({kind}:{kind:'orders'|'customers'}){
 const [data,setData]=useState<BusinessReport|null>(null),[selected,setSelected]=useState<BusinessRow|null>(null);
 const [store,setStore]=useState(''),[query,setQuery]=useState(''),[page,setPage]=useState(1),[tick,setTick]=useState(0);
 const [loading,setLoading]=useState(true),[error,setError]=useState('');
 useEffect(()=>{let active=true;setLoading(true);setError('');setSelected(null);
  backendRequest<BusinessReport>(`business/${kind}?${new URLSearchParams({store,q:query,page:String(page)})}`).then(r=>{if(active)setData(r);}).catch(e=>{if(active){setData(null);setError(e instanceof Error?e.message:'读取失败');}}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[kind,store,query,page,tick]);
 const refresh=()=>setTick(n=>n+1);
 const columns:TableColumn<BusinessRow>[]=kind==='orders'?[
  {key:'external_id',label:'订单 / 店铺',render:r=><div><b>{r.external_id}</b><small>{r.store_name}</small></div>},
  {key:'customer_name',label:'客户',render:r=>r.customer_name??'未提供'},
  {key:'item_summary',label:'商品'},
  {key:'total',label:'订单金额',render:r=>`${r.total} ${r.currency}`},
  {key:'payment_status',label:'支付',render:r=><Badge tone="neutral">{paymentLabels[r.payment_status??'unknown']}</Badge>},
  {key:'fulfillment_status',label:'履约',render:r=><Badge tone="info">{fulfillmentLabels[r.fulfillment_status??'unknown']}</Badge>},
  {key:'tracking_number',label:'物流',render:r=>r.shipments?.length?<div>{r.shipments.map(s=><div key={s.external_id}><Badge tone={s.status==='delivered'?'success':s.status==='exception'?'danger':'neutral'}>{shipmentLabels[s.status]??s.status}</Badge><small>{s.carrier} · {s.tracking_number}</small></div>)}</div>:r.tracking_number??'尚无物流信息'},
  {key:'ordered_at',label:'下单时间',render:r=>r.ordered_at?new Date(r.ordered_at).toLocaleString('zh-CN'):'未提供'},
 ]:[{key:'name',label:'客户',render:r=><b>{r.name??'未提供姓名'}</b>},{key:'email',label:'邮箱',render:r=>r.email??'平台未提供'},
  {key:'country',label:'国家',render:r=>r.country??'未提供'},{key:'store_name',label:'店铺'},
  {key:'observed_at',label:'资料更新时间',render:r=>new Date(r.observed_at).toLocaleString('zh-CN')}];
 return <><PageHeader title={kind==='orders'?'订单与履约':'客户'} description={kind==='orders'?'读取店铺真实订单状态，支付与履约分别展示。':'共用店铺接口包同步客户档案，不推测平台未提供的资料。'} actions={<BusinessSyncBar refreshAction={<Button compact disabled={loading} onClick={refresh}>刷新记录</Button>} kind={kind} stores={data?.stores??[]} store={store} onStoreChange={value=>{setStore(value);setPage(1);}} onUpdated={refresh}/>}/>
 <FeatureNotice title="店铺接口包 · 订单与物流">订单与包裹分别保留来源、版本和轨迹。点击同步读取各自一页；测试站联调购买与物流会持久化，但不代表真实收款、CJ 采购或实体发货。</FeatureNotice>
 {error&&<p role="alert">{error} <Button compact onClick={refresh}>重新读取</Button></p>}
 <div className={`${kind==='orders'?'orders-layout':'customers-layout'} ${!selected?'no-detail':''}`}><Card className="content-card"><div className="full-filters"><Input aria-label="搜索业务记录" value={query} placeholder={kind==='orders'?'搜索订单号、客户或商品':'搜索客户姓名、邮箱或编号'} onChange={e=>{setQuery(e.target.value);setPage(1);}}/></div><DataTable columns={columns} rows={loading?[]:data?.results??[]} onSelect={setSelected} selectedId={selected?.id} className="operating-table" emptyText={loading?'正在读取…':'暂无已同步记录。接入店铺后，点击页头的同步数据。'}/><footer className="table-footer"><span>共 {data?.count??0} 条已同步记录</span><div><Button compact disabled={loading||page===1} onClick={()=>setPage(p=>p-1)}>上一页</Button><span>第 {page} 页</span><Button compact disabled={loading||!data||page*50>=data.count} onClick={()=>setPage(p=>p+1)}>下一页</Button></div></footer></Card>
 {selected&&<Card className={kind==='orders'?'order-detail':'customer-detail'}><div className="detail-title"><h2>来源详情</h2><Button compact variant="ghost" onClick={()=>setSelected(null)}>关闭</Button></div><h3>{selected.external_id}</h3><p>{selected.store_name}</p>{kind==='orders'&&<><p>支付：{paymentLabels[selected.payment_status??'unknown']}</p><p>履约：{fulfillmentLabels[selected.fulfillment_status??'unknown']}</p>{selected.shipments?.length?selected.shipments.map(s=><section key={s.external_id}><h3>包裹 · {shipmentLabels[s.status]??s.status}</h3>{s.simulated&&<Badge tone="warning">测试物流 · 非实体配送</Badge>}<div className="tracking-box"><span>{s.carrier}</span><b style={{overflowWrap:'anywhere'}}>{s.tracking_number}</b></div>{s.events.map((e,i)=><p key={i}><b>{e.description}</b><br/><small>{new Date(e.occurred_at).toLocaleString('zh-CN')}</small></p>)}{!s.events.length&&<p>尚未收到出库事件，不能视为已发货。</p>}<p className="detail-caption">物流版本 {s.revision} · {s.source_ref}</p></section>):<div className="tracking-box"><span>物流单号</span><b>{selected.tracking_number??'未提供'}</b></div>}</>}<p>资料版本：{selected.revision}</p><p>观测时间：{new Date(selected.observed_at).toLocaleString('zh-CN')}</p><p className="detail-caption">依据：{selected.source_ref}</p></Card>}</div></>;
}

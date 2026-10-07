'use client';
import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {backendRequest,startBackendRun,type BackendRun,type BackendEvent} from '@/lib/workflow/backend-client';
import type {FrozenDesign} from '@/lib/workflow/saved-config';
import type {ImageBatch} from '@/lib/product-images';
import {RunExecutionView} from './run-execution-view';
import type {WorkflowCanvas} from './workspace';
import styles from './product-images-window.module.css';
import {transmissionDuration} from './graph';
import {toWorkflowPreview} from '@/lib/workflow/universal';
import {shipmentLabels,type Shipment} from '@/lib/business';
type Business={kind:string;reply?:{customer_message:string;reply:{reply:string;citations:string[];questions:string[];handoff_required:boolean};status:string};receipt?:Record<string,unknown>;batch?:ImageBatch;pack?:Record<string,unknown>};
type Run=BackendRun&{context:BackendRun['context']&{business:Business;stop_requested?:boolean}};
type CanvasRun=Parameters<typeof WorkflowCanvas>[0]['run'];
export function BusinessRun({release,initialRunId,onRunIdChange,onExit,renderCanvas}:{release:FrozenDesign;initialRunId?:string;onRunIdChange:(id:string)=>void;onExit:()=>void;renderCanvas:(view:CanvasRun,id:string,onSelect:(id:string)=>void)=>React.ReactNode}){
 const [run,setRun]=useState<Run|null>(null),[events,setEvents]=useState<BackendEvent[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[confirmed,setConfirmed]=useState(false),[accepted,setAccepted]=useState<string[]>([]);
 const intent=useRef(crypto.randomUUID()),started=useRef(false);
 const [visual,setVisual]=useState<BackendEvent|null>(null);
 const playback=useRef<{id:string;seen:number;queue:BackendEvent[];timer:ReturnType<typeof setTimeout>|null}>({id:'',seen:0,queue:[],timer:null});
 async function load(id:string){const [r,e]=await Promise.all([backendRequest<Run>(`runs/${id}`),backendRequest<{events:BackendEvent[]}>(`runs/${id}/events`)]);if(r.workflow_version_id!==release.version_id)throw Error('运行版本不匹配，未恢复。');setRun(r);setEvents(e.events);}
 useEffect(()=>{if(started.current)return;started.current=true;setBusy(true);void (async()=>{if(initialRunId){await load(initialRunId);return;}const r=await startBackendRun({version_id:release.version_id,store_id:release.store_id,idempotency_key:intent.current});onRunIdChange(r.id);await load(r.id);})().catch(e=>setError(e instanceof Error?e.message:'启动失败')).finally(()=>setBusy(false));},[release.id]);
 useEffect(()=>{if(!run)return;let alive=true;const timer=setInterval(()=>{if(alive)void load(run.id).catch(e=>setError(e instanceof Error?e.message:'读取失败；不会重复启动。'));},2000);return()=>{alive=false;clearInterval(timer);};},[run?.id]);
 useEffect(()=>{
  if(!run)return;const p=playback.current;
  if(p.id!==run.id){if(p.timer)clearTimeout(p.timer);p.id=run.id;p.seen=run.sequence;p.queue=[];p.timer=null;setVisual(null);}
  const incoming=events.filter(e=>e.sequence>p.seen);
  if(incoming.length){p.seen=incoming.at(-1)!.sequence;p.queue.push(...incoming);if(p.queue.length>6){if(p.timer)clearTimeout(p.timer);p.timer=null;p.queue=p.queue.slice(-2);}}
  function next(){const e=p.queue.shift();if(!e){p.timer=null;setVisual(null);return;}setVisual(e);const flow=toWorkflowPreview(release.document);p.timer=setTimeout(next,e.status==='transferring'?transmissionDuration(flow,flow.forwardEdges?.find(edge=>edge.id===e.edgeId)):e.status==='running'?350:120);}
  if(!p.timer&&p.queue.length)next();
 },[events,run?.id]);
 useEffect(()=>()=>{if(playback.current.timer)clearTimeout(playback.current.timer);},[]);
 async function act(path:string,data:Record<string,unknown>){if(!run)return;setBusy(true);setError('');try{setRun(await backendRequest<Run>(`runs/${run.id}/${path}`,'POST',{expected_revision:run.revision,...data}));setConfirmed(false);}catch(e){setError(e instanceof Error?e.message:'操作失败');}finally{setBusy(false);}}
 if(!run)return <Card><p role="status">{busy?'正在创建或恢复持久化运行…':error||'尚未创建运行'}</p>{!busy&&<Button onClick={()=>{setBusy(true);void (initialRunId?load(initialRunId):startBackendRun({version_id:release.version_id,store_id:release.store_id,idempotency_key:intent.current}).then(r=>{onRunIdChange(r.id);return load(r.id);})).catch(e=>setError(String(e))).finally(()=>setBusy(false));}}>{initialRunId?'重新读取原运行':'重试原启动请求'}</Button>}<Button onClick={onExit}>返回编辑</Button></Card>;
 const b=run.context.business,image=b.kind==='product-images',fulfillment=b.kind==='fulfillment',batch=b.batch;
 const shipment=(b as Business&{shipment?:Shipment}).shipment;
 const orderDetail=(b as Business&{order_detail?:{order:{external_id:string;item_summary:string;payment_status:string;revision:number};lines:{sku:string;quantity:number}[]}}).order_detail;
 const view:CanvasRun=visual?{nodeId:visual.nodeId,phase:visual.status==='transferring'?'edge':visual.status==='running'?'running':visual.status==='waiting_approval'?'approval':visual.status==='waiting_event'?'running':visual.status==='completed'?'done':'stopped',edgeId:visual.edgeId,completed:run.document.nodes.slice(0,Math.max(0,run.document.nodes.findIndex(n=>n.id===visual.nodeId))).map(n=>n.id),revision:visual.sequence}:{nodeId:run.node_id,phase:run.status==='succeeded'?'done':run.status==='waiting_approval'?'approval':['running','waiting_event'].includes(run.status)?'running':run.status==='queued'?'queued':'stopped',completed:run.document.nodes.slice(0,run.cursor).map(n=>n.id),revision:run.sequence};
 const active=['queued','running','waiting_event','waiting_approval','needs_attention'].includes(run.status);
 return <RunExecutionView run={run} events={events} progress={null} notice={error||run.error} renderCanvas={(id,onSelect)=>renderCanvas(view,id,onSelect)} actions={<div className={styles.toolbar}>{active&&<Button disabled={busy||run.context.stop_requested} onClick={()=>{if(window.confirm('停止当前运行？在途结果与已产生费用会保留，不撤回已发送消息。'))void act('cancel',{});}}>停止当前运行</Button>}<Button onClick={onExit}>退出当前运行</Button></div>}>
 {!image&&b.reply&&<Card><h3>本轮回复 · {run.status==='waiting_approval'?'待人工确认':b.receipt?'已发送并核对':'执行记录'}</h3><p>{b.reply.customer_message}</p><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{b.reply.reply.reply}</pre><p>引用：{b.reply.reply.citations.join('、')}</p>{b.reply.reply.handoff_required&&<p>此咨询需要人工处理，不能发送。</p>}</Card>}
 {fulfillment&&<Card><h3>本轮订单履约 · 测试站</h3>{orderDetail&&<><p>{orderDetail.order.item_summary}</p><p style={{overflowWrap:'anywhere'}}>订单 {orderDetail.order.external_id} · 资料版本 {orderDetail.order.revision} · {orderDetail.order.payment_status}</p>{orderDetail.lines.map((line,i)=><p key={i}>SKU {line.sku} · 数量 {line.quantity}</p>)}</>}<p>不采购、不收款、不发邮件。出库与签收由测试站的独立事件确认，不随动画自动推进。</p>{shipment&&<><p>{shipmentLabels[shipment.status]} · {shipment.carrier}</p><p style={{overflowWrap:'anywhere'}}>{shipment.tracking_number}</p>{shipment.events.map((e,i)=><p key={i}>{e.description} · {new Date(e.occurred_at).toLocaleString('zh-CN')}</p>)}</>}<a href="/test-store-lab">推进测试物流 ↗</a></Card>}
 {batch&&<>
 <p>{batch.products.length} 件商品 · 已处理 {batch.cursor} 项 · {batch.status}。方案模型与生图连接来自冻结版本。</p>
 {batch.plans.map((p,i)=><details key={i} open={run.cursor===1}><summary>{batch.products[i]?.title} · 制作方案</summary>{p.plan.shots.map((s,j)=><pre key={j} style={{whiteSpace:'pre-wrap'}}>{s.prompt}</pre>)}</details>)}
 <div className={styles.assets}>{batch.assets.map(a=><Card key={a.id} className={styles.asset}><img src={a.url} alt="本次生成的商品图"/>{run.status==='waiting_approval'&&run.cursor===4&&<label><input type="checkbox" checked={accepted.includes(a.id)} onChange={e=>setAccepted(ids=>e.target.checked?[...ids,a.id]:ids.filter(id=>id!==a.id))}/>采用此图</label>}<a href={`${a.url}?download=1`}>下载图片</a></Card>)}</div>
 </>}
 {run.status==='waiting_approval'&&<><label className={styles.review}><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>{image?run.cursor===1?'我已核对逐张方案，允许发送原图并调用付费生图服务。':'我已核对所选图片的外观、事实、使用权与用途。':fulfillment?'我已核对订单、规格与数量，允许创建测试发货单（无采购付款）。':'我已核对消息、政策引用和答复，允许发送到测试站收件箱（不发送邮件）。'}</label><Button variant="primary" disabled={busy||!confirmed||(image&&run.cursor===4&&!accepted.length)} onClick={()=>void act('business-command',{confirmed:true,asset_ids:image&&run.cursor===4?accepted:[]})}>{image?run.cursor===1?'确认方案并开始生图':'确认图片并交付素材包':fulfillment?'确认测试履约并继续':'批准答复并继续发送'}</Button></>}
 {run.status==='needs_attention'&&run.cursor!==3&&<Button disabled={busy} onClick={()=>void act('resume',{})}>继续运行（不重放未知模型请求）</Button>}
 {b.receipt&&<details><summary>真实测试站回执</summary><pre>{JSON.stringify(b.receipt,null,2)}</pre></details>}
 {b.pack&&<details open><summary>已确认的素材包</summary><pre style={{overflowWrap:'anywhere',whiteSpace:'pre-wrap'}}>{JSON.stringify(b.pack,null,2)}</pre></details>}
 </RunExecutionView>;
}

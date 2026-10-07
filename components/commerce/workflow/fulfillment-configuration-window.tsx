'use client';
import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Button} from '@/components/ui/button';
import {SelectField} from '@/components/ui/select-field';
import {backendRequest} from '@/lib/workflow/backend-client';
import type {WorkflowDocument} from '@/lib/workflow/universal';
import shared from './workflow.module.css';
import styles from './product-images-window.module.css';
export function FulfillmentConfigurationWindow({document,onClose,onApply}:{document:WorkflowDocument;onClose:()=>void;onApply:(config:Record<string,unknown>)=>void}){
 const dialog=useRef<HTMLDialogElement>(null),initial=(document.nodes[0].binding.parameters.runtime??{}) as Record<string,unknown>;
 const [order,setOrder]=useState(String(initial.order_id??'')),[confirmed,setConfirmed]=useState(initial.test_execution_confirmed===true),[orders,setOrders]=useState<{id:string;title:string;status:string}[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(true);
 useEffect(()=>{dialog.current?.showModal();let alive=true;backendRequest<{records:{kind:string;id:string;payload:{order?:{item_summary:string;fulfillment_status:string;payment_status:string}}}[]}>(`stores/${document.environment.storeRef}/test-lab`).then(data=>{if(alive)setOrders(data.records.filter(r=>r.kind==='order'&&r.payload.order?.payment_status==='paid').map(r=>({id:r.id,title:r.payload.order!.item_summary,status:r.payload.order!.fulfillment_status})));}).catch(e=>{if(alive)setError(e instanceof Error?e.message:'读取订单失败');}).finally(()=>{if(alive)setBusy(false);});return()=>{alive=false;};},[document.environment.storeRef]);
 return createPortal(<dialog ref={dialog} className={shared.dialog} aria-label="配置订单到交付流程" onCancel={onClose}><header className={shared.dialogHeader}><div><h2>订单到交付 · 测试履约</h2><p>复用已验收的店铺接口包，不重新接店铺。此版本只模拟仓库履约，不调用 CJ 采购、付款或发邮件。</p></div><Button onClick={onClose}>关闭</Button></header><div className={`${shared.dialogBody} ${styles.body}`}><label>本次订单<SelectField value={order} onChange={e=>setOrder(e.target.value)}><option value="">选择测试站已付款订单</option>{orders.map(o=><option key={o.id} value={o.id} disabled={o.status!=='unfulfilled'}>{o.title} · {o.id.slice(0,8)}{o.status!=='unfulfilled'?' · 已履约':''}</option>)}</SelectField></label><label className={styles.review}><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>确认使用测试物流执行器：生成测试运单，无真实物流费用或实体发货。</label><p>保存冻结后，先核验订单并人工确认，再创建测试发货单。请在联调中心分别推进出库、运输与签收；等待节点读取真实 HTTP 记录，不会按时间自动成功。</p><a href="/test-store-lab">创建测试订单 / 推进测试物流 ↗</a>{busy&&<p role="status">正在读取订单…</p>}{error&&<p role="alert">{error}</p>}<Button variant="primary" disabled={busy||!confirmed||!orders.some(o=>o.id===order&&o.status==='unfulfilled')} onClick={()=>onApply({order_id:order,test_execution_confirmed:true})}>应用测试履约配置</Button></div></dialog>,window.document.body);
}

"use client";
import {useEffect,useState} from 'react';
import {Card} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {SelectField} from '@/components/ui/select-field';
import {Badge} from '@/components/ui/badge';
import {backendRequest} from '@/lib/workflow/backend-client';
import {applyInstalledStore,type PublishingStore,type PublishingPackage} from '@/lib/workflow/store-publishing';
import type {WorkflowDocument} from '@/lib/workflow/universal';
import styles from './interface-mapping.module.css';
export function StorePublishingSetup({document,onApply,onTest}:{document:WorkflowDocument;onApply:(next:WorkflowDocument)=>void;onTest?:(storeId:string)=>void}){
 const [stores,setStores]=useState<PublishingStore[]>([]),[packages,setPackages]=useState<PublishingPackage[]>([]),[storeId,setStoreId]=useState(document.environment.storeRef??''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 useEffect(()=>{let active=true;Promise.all([backendRequest<PublishingStore[]>('stores'),backendRequest<{packages:PublishingPackage[]}>('integration-packages')]).then(([s,p])=>{if(!active)return;const rows=s.filter(r=>r.channel===document.environment.channel&&r.active);setStores(rows);setPackages(p.packages);setStoreId(id=>rows.some(s=>s.id===id)?id:rows[0]?.id??'');}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[document.environment.channel]);
 const store=stores.find(s=>s.id===storeId),pkg=packages.find(p=>p.channel===store?.channel&&p.package===store?.adapter);
 let ready=false,readinessError='';try{if(store&&pkg){applyInstalledStore(document,store,pkg);ready=true;}}catch(e){readinessError=e instanceof Error?e.message:'映射方案尚未就绪';}
 async function verify(){if(!store)return;setBusy(true);setError('');try{await backendRequest(`stores/${store.id}/verify`,'POST',{});setStores((await backendRequest<PublishingStore[]>('stores')).filter(s=>s.channel===document.environment.channel&&s.active));}catch(e){setError(e instanceof Error?e.message:'验收失败');}finally{setBusy(false);}}
 return <Card className={styles.panel}><div className={styles.heading}><h2>选择店铺与映射方案</h2><Badge tone={ready?'success':'warning'}>{ready?'已有安装方案':'尚未就绪'}</Badge></div><p className={styles.muted}>在这里选一次店铺及其已安装接口包。发布节点继承，不再选择店铺或重复配置 Skill。</p>
 <label className={styles.composer}>发布到哪家店铺<SelectField aria-label="真实发布店铺" disabled={loading||busy} value={storeId} onChange={e=>setStoreId(e.target.value)}><option value="">{loading?'读取后端店铺…':'请选择已接入店铺'}</option>{stores.map(s=><option key={s.id} value={s.id}>{s.name} · {s.verified?'已验收':'待验收'}</option>)}</SelectField></label>
 {pkg&&<p>映射方案：{pkg.package} · v{pkg.version}（接口包内置方案）。日常运行应使用已安装代码，不调用大模型重新映射；当前画布尚未执行字段转换。</p>}
 {readinessError&&<p role="alert">{readinessError}</p>}
 {!loading&&!stores.length&&<p role="status">当前渠道还没有真实店铺连接与执行适配器。请先完成接口开发、审核安装和店铺接入；选择示例 Skill 不能替代真实接入。</p>}
 {store&&!pkg&&<p role="alert">这家店铺的接口包尚未安装，不能测试真实发布。</p>}
 {error&&<p role="alert" className={styles.notice}>{error}</p>}
 <div className={styles.actions}>{store&&<Button type="button" disabled={busy} onClick={()=>void verify()}>{store.verified?'重新验收接口包能力':'验收店铺接口'}</Button>}<Button type="button" variant="primary" disabled={!ready||busy} onClick={()=>{if(store&&pkg)onApply(applyInstalledStore(document,store,pkg));}}>保存店铺与接口包配置</Button>{onTest&&<Button type="button" disabled={!ready||busy||store?.channel!=='test-store'} onClick={()=>{if(store)onTest(store.id);}}>打开真实发布联调</Button>}</div><p className={styles.muted}>新增订单、客户、收益读取能力在这里统一重新验收，三个模块共用连接。验收不自动同步数据或改写已冻结运行；保存仅更新设计草稿。</p></Card>;
}

"use client";
import {useEffect,useState} from 'react';
import {Card} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {SelectField} from '@/components/ui/select-field';
import {Badge} from '@/components/ui/badge';
import {backendRequest} from '@/lib/workflow/backend-client';
import {applyConnectedStore,inheritedPublishingPlan,type PublishingStore,type PublishingPackage} from '@/lib/workflow/store-publishing';
import type {WorkflowDocument} from '@/lib/workflow/universal';
import styles from './interface-mapping.module.css';
export function StorePublishingSetup({document,onApply,onTest,readOnly=false,onConfigureStore}:{document:WorkflowDocument;onApply?:(next:WorkflowDocument)=>void|Promise<void>;onTest?:(storeId:string)=>void;readOnly?:boolean;onConfigureStore?:()=>void}){
 const [stores,setStores]=useState<PublishingStore[]>([]),[packages,setPackages]=useState<PublishingPackage[]>([]),[storeId,setStoreId]=useState(document.environment.storeRef??''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 useEffect(()=>{let active=true;Promise.all([backendRequest<PublishingStore[]>('stores'),backendRequest<{packages:PublishingPackage[]}>('integration-packages')]).then(([s,p])=>{if(!active)return;const rows=s.filter(r=>r.channel===document.environment.channel&&r.active);setStores(rows);setPackages(p.packages);setStoreId(id=>id||(rows.length===1?rows[0].id:''));}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[document.environment.channel]);
 const store=stores.find(s=>s.id===storeId),pkg=packages.find(p=>p.channel===store?.channel&&p.package===store?.adapter);
 let ready=false,readinessError='';try{if(store&&pkg){applyConnectedStore(document,store,pkg);ready=true;}}catch(e){readinessError=e instanceof Error?e.message:'映射方案尚未就绪';}
 async function verify(){if(!store)return;setBusy(true);setError('');try{await backendRequest(`stores/${store.id}/verify`,'POST',{});setStores((await backendRequest<PublishingStore[]>('stores')).filter(s=>s.channel===document.environment.channel&&s.active));}catch(e){setError(e instanceof Error?e.message:'验收失败');}finally{setBusy(false);}}
 async function save(){if(!store||!pkg||!onApply)return;setBusy(true);setError('');try{await onApply(applyConnectedStore(document,store,pkg));}catch(e){setError(e instanceof Error?e.message:'保存失败');}finally{setBusy(false);}}
 if(readOnly){let plan:ReturnType<typeof inheritedPublishingPlan>|undefined,problem='';try{plan=inheritedPublishingPlan(document);if(!loading&&!error&&(!store||!ready||store.configuration_version!==plan.storeVersion||pkg?.version!==plan.version))problem='连接或接口包版本发生变化，请在配置店铺接入中明确确认，不自动替换。';}catch(e){problem=e instanceof Error?e.message:'尚未配置店铺接入';}return <Card className={styles.panel}><div className={styles.heading}><h2>继承店铺接入 · 只读</h2><Badge>{loading?'正在核对':plan&&!problem&&!error?'已绑定方案':'需要配置'}</Badge></div><p>店铺与接口包统一在“配置店铺接入”保存。这个节点运行时使用该方案转换字段并检查必填项，不重复接店铺，也不猜缺失值。</p>{plan&&<dl className={styles.facts}><div><dt>店铺</dt><dd>{plan.name}</dd></div><div><dt>接口包</dt><dd>{plan.package} · v{plan.version}</dd></div><div><dt>连接版本</dt><dd>{plan.storeVersion}</dd></div></dl>}{(problem||error)&&<p role="alert">{error||problem}</p>}<Button onClick={onConfigureStore}>配置店铺接入</Button></Card>;}
 return <Card className={styles.panel}><div className={styles.heading}><h2>复用已接入店铺</h2><Badge tone={ready?'success':'warning'}>{ready?'已验收接口包':'尚未就绪'}</Badge></div><p className={styles.muted}>后端店铺连接全工作区共享。在此选择并保存，准备发布与后续流程继承，不需要重新创建店铺或配重复 Skill。</p>
 <label className={styles.composer}>使用哪家店铺<SelectField aria-label="真实发布店铺" disabled={loading||busy} value={storeId} onChange={e=>setStoreId(e.target.value)}><option value="">{loading?'读取后端店铺…':'请选择已接入店铺'}</option>{storeId&&!stores.some(s=>s.id===storeId)&&<option value={storeId}>原店铺不可用 · 请明确重新选择</option>}{stores.map(s=><option key={s.id} value={s.id}>{s.name} · {s.verified?'已验收':'待验收'}</option>)}</SelectField></label>
 {pkg&&<p>映射方案：{pkg.package} · v{pkg.version}（接口包内置方案）。日常运行应使用已安装代码，不调用大模型重新映射；当前画布尚未执行字段转换。</p>}
 {readinessError&&<p role="alert">{readinessError}</p>}
 {!loading&&!stores.length&&<p role="status">当前渠道还没有真实店铺连接与执行适配器。请先完成接口开发、审核安装和店铺接入；选择示例 Skill 不能替代真实接入。</p>}
 {store&&!pkg&&<p role="alert">这家店铺的接口包尚未安装，不能测试真实发布。</p>}
 {error&&<p role="alert" className={styles.notice}>{error}</p>}
 <div className={styles.actions}>{store&&<Button type="button" disabled={busy} onClick={()=>void verify()}>{store.verified?'重新验收接口包能力':'验收店铺接口'}</Button>}<Button type="button" variant="primary" disabled={!ready||busy} onClick={()=>void save()}>{busy?'正在保存…':'保存店铺与接口包配置'}</Button>{onTest&&<Button type="button" disabled={!ready||busy||store?.channel!=='test-store'} onClick={()=>{if(store)onTest(store.id);}}>打开真实发布联调</Button>}</div><p className={styles.muted}>保存当前流程配置，不改已冻结运行；其他新流程可复用同一接入，只有接口包已实现且已验收的动作才能执行。</p></Card>;
}

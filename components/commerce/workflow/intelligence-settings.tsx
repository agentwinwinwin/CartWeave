"use client";
import {useCallback,useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {SelectField} from '@/components/ui/select-field';
import {CJIntelligence,type IntelligenceSnapshot} from '../connections/cj-intelligence';
import {backendRequest} from '@/lib/workflow/backend-client';
import styles from './workflow.module.css';

type Plan={id:string;source:'sales'|'advertising';mappings:{source_category_id:string;category_id:string;source_name:string;category_path:string}[]};
type Category={id:string;name:string;path:string};
function CategoryChoice({categories,value,onChange}:{categories:Category[];value:string;onChange:(id:string)=>void}){
 const [filter,setFilter]=useState('');
 const matches=categories.filter(r=>r.id!==value&&r.path.toLowerCase().includes(filter.toLowerCase()));
 const choices=[...categories.filter(r=>r.id===value),...matches.slice(0,80)];
 return <div><Input aria-label="筛选 CJ 供货类目" value={filter} placeholder="筛选供货目录，例如 beauty" onChange={e=>setFilter(e.target.value)}/><SelectField aria-label="对应 CJ 供货类目" value={value} onChange={e=>onChange(e.target.value)}><option value="">暂不用于选品</option>{choices.map(r=><option key={r.id} value={r.id}>{r.path}</option>)}</SelectField>{matches.length>80&&<small>匹配 {matches.length} 个类目，先展示 80 个；输入更具体的目录名称缩小范围。</small>}</div>;
}
export function IntelligenceSettings({parameters,onChange}:{parameters:Record<string,unknown>;onChange:(patch:Record<string,unknown>)=>void}){
 const [session,setSession]=useState<{mode?:string;user?:{role:string}}|null>(null),[snapshot,setSnapshot]=useState<IntelligenceSnapshot|null>(null);
 const [source,setSource]=useState<'sales'|'advertising'>('advertising'),[mapping,setMapping]=useState<Record<string,string>>({}),[categories,setCategories]=useState<Category[]>([]);
 const [plan,setPlan]=useState<Plan|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[dirty,setDirty]=useState(false);
 const receive=useCallback((value:IntelligenceSnapshot)=>setSnapshot(value),[]);
 useEffect(()=>{void backendRequest<typeof session>('auth/session').then(setSession).catch(e=>setNotice(e.message));},[]);
 useEffect(()=>{let active=true;if(parameters.categoryPlanRef)void backendRequest<Plan>(`connections/cj/intelligence/plans/${parameters.categoryPlanRef}`).then(p=>{if(active){setPlan(p);setSource(p.source);setMapping(Object.fromEntries(p.mappings.map(r=>[r.source_category_id,r.category_id])));}}).catch(e=>{if(active)setNotice(e.message);});return()=>{active=false;};},[parameters.categoryPlanRef]);
 async function directory(){setBusy(true);setNotice('');try{const response=await backendRequest<{categories:Category[]}>('connections/cj/categories');setCategories(response.categories);}catch(e){setNotice(e instanceof Error?e.message:'供货目录加载失败');}finally{setBusy(false);}}
 async function confirm(){setBusy(true);setNotice('');try{const rows=snapshot?.[source].rows??[];const p=await backendRequest<Plan>('connections/cj/intelligence/plans','POST',{source,mappings:rows.filter(r=>mapping[r.source_category_id]).map(r=>({source_category_id:r.source_category_id,category_id:mapping[r.source_category_id]}))});setPlan(p);setDirty(false);onChange({categoryPlanRef:p.id,categoryQueries:[...new Set(p.mappings.map(r=>r.category_id))].map(categoryId=>({categoryId,keyword:''}))});setNotice('方案已确认。应用到节点、保存并冻结后生效。');}catch(e){setNotice(e instanceof Error?e.message:'方案确认失败');}finally{setBusy(false);}}
 return <>
  <section className={styles.infoBox}><h3>先看行情，再确定商品方向</h3><label className={styles.field}>行情首节点<SelectField aria-label="启用行情首节点" value={parameters.enabled===true?'on':'off'} onChange={e=>onChange({enabled:e.target.value==='on'})}><option value="off">关闭 · 沿用商品任务搜索词</option><option value="on">开启 · 从已确认的榜单方向选品</option></SelectField></label><p>关闭不采集网页、不要求网页授权，也不清除原搜索词。开启后每次运行先采集两榜各前十；下一个商品任务只设置数量、库存、配送、费用和策略，不再填类目。</p></section>
  {parameters.enabled===true&&<>
   <CJIntelligence enabled={session?.mode==='desktop'} canManage={session?.user?.role==='admin'} onSnapshot={receive}/>
   <section className={styles.infoBox}><h3>榜单方向 → CJ 供货目录</h3><p>两组都会采集，但不是同一套分类。选择一个榜单作为搜索方向，勾选需要研究的方向并确认对应的真实供货类目；另一榜保留作行情参考。不把榜单销量或广告数计入单品销量分。</p>
    <label className={styles.field}>用于选品的方向<SelectField aria-label="选品方向榜单" value={source} onChange={e=>{setSource(e.target.value as typeof source);setMapping({});setDirty(true);onChange({categoryPlanRef:'',categoryQueries:[]});}}><option value="advertising">广告类目前十</option><option value="sales">销售类目前十 · Amazon 市场</option></SelectField></label>
    {plan&&!dirty&&<div><strong>已确认 {plan.mappings.length} 个方向 · 多节点自动继承</strong>{plan.mappings.map(r=><p key={r.source_category_id}>{r.source_name} → {r.category_path}</p>)}</div>}
    <Button disabled={busy} onClick={()=>void directory()}>{busy?'处理中…':'读取 CJ 供货目录 / 调整对应关系'}</Button>
    {categories.length>0&&snapshot?.[source].rows.map(r=><div className={styles.infoBox} key={r.source_category_id}><strong>{r.rank}. {r.category_name}</strong><CategoryChoice categories={categories} value={mapping[r.source_category_id]??''} onChange={id=>{setMapping(m=>({...m,[r.source_category_id]:id}));setDirty(true);onChange({categoryPlanRef:'',categoryQueries:[]});}}/></div>)}
    {categories.length>0&&<Button variant="primary" disabled={busy||!snapshot||!Object.values(mapping).some(Boolean)} onClick={()=>void confirm()}>确认类目对应方案</Button>}
    <p>可研究前十中的一个或多个方向；未选择的方向不进入商品采集。合并重复供货类目，按原额度均分，不扩大到全目录。所选方向离开前十或目录失效时暂停，需重新确认后新建运行。</p>
   </section>
  </>}
  {notice&&<p role="status">{notice}</p>}
 </>;
}

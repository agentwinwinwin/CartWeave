'use client';
import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {Card} from '@/components/ui/card';
import {Input} from '@/components/ui/input';
import {SelectField} from '@/components/ui/select-field';
import {backendRequest} from '@/lib/workflow/backend-client';
import type {ModelConnection} from '@/lib/workflow/model-connections';
import {imageBusy,imageStage,imageStatusNames,type ImageBatch,type ImageProduct} from '@/lib/product-images';
import {ModelConnectionForm} from './model-connection-form';
import shared from './workflow.module.css';
import styles from './product-images-window.module.css';

const steps=['已上架商品','逐张方案','Sunburst 生图','文件检查','人工确认','交付素材包'];
export function ProductImagesWindow({designId,nodeId,onClose,onBatch,onSaveDesign}:{designId:string;nodeId:string;onClose:()=>void;onBatch:(batch:ImageBatch)=>void;onSaveDesign:()=>Promise<void>}){
 const dialog=useRef<HTMLDialogElement>(null),key=useRef<string>('');
 const [products,setProducts]=useState<ImageProduct[]>([]),[total,setTotal]=useState(0),[selected,setSelected]=useState<string[]>([]),[query,setQuery]=useState('');
 const [models,setModels]=useState<ModelConnection[]>([]),[planner,setPlanner]=useState(''),[generator,setGenerator]=useState(''),[addModel,setAddModel]=useState<'planner'|'generator'|null>(null);
 const [count,setCount]=useState(1),[usage,setUsage]=useState('main'),[size,setSize]=useState('1024x1024'),[quality,setQuality]=useState('medium'),[requirements,setRequirements]=useState('');
 const [plannerSkill,setPlannerSkill]=useState('product_image_photography');
 const [batch,setBatch]=useState<ImageBatch|null>(null),[history,setHistory]=useState<ImageBatch[]>([]),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[accepted,setAccepted]=useState<string[]>([]),[confirmed,setConfirmed]=useState(false);
 const nextIntent=()=>{key.current='';};
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;dialog.current?.showModal();return()=>previous?.focus();},[]);
 function update(value:ImageBatch){setBatch(value);onBatch(value);setHistory(rows=>[value,...rows.filter(b=>b.id!==value.id)]);}
 useEffect(()=>{let alive=true;void Promise.all([backendRequest<{results:ImageProduct[];count:number}>('product-image-products'),backendRequest<ModelConnection[]>('model-connections'),backendRequest<ImageBatch[]>(`product-image-batches?design_id=${encodeURIComponent(designId)}`)]).then(([catalog,connections,batches])=>{
  if(!alive)return;setProducts(catalog.results);setTotal(catalog.count);setModels(connections);setHistory(batches);if(batches[0]){setBatch(batches[0]);onBatch(batches[0]);}
 }).catch(e=>{if(alive)setError(e instanceof Error?e.message:'无法读取商品图任务');}).finally(()=>{if(alive)setLoading(false);});return()=>{alive=false;};},[designId]); // Only reads: refresh never starts generation.
 useEffect(()=>{if(!batch||!imageBusy(batch.status))return;let alive=true;const timer=setInterval(()=>{void backendRequest<ImageBatch>(`product-image-batches/${batch.id}`).then(value=>{if(alive)update(value);}).catch(()=>{if(alive)setNotice('暂时无法读取进度，请手动刷新；不会重新发送生图请求。');});},2000);return()=>{alive=false;clearInterval(timer);};},[batch?.id,batch?.status]);
 async function refresh(){setBusy(true);try{if(batch)update(await backendRequest<ImageBatch>(`product-image-batches/${batch.id}`));else{const data=await backendRequest<{results:ImageProduct[];count:number}>('product-image-products');setProducts(data.results);setTotal(data.count);}}catch(e){setError(e instanceof Error?e.message:'刷新失败');}finally{setBusy(false);}}
 async function start(){setBusy(true);setError('');if(!key.current)key.current=crypto.randomUUID();try{await onSaveDesign();update(await backendRequest<ImageBatch>('product-image-batches','POST',{design_id:designId,product_ids:selected,planner_id:planner,planner_skill:plannerSkill,generator_id:generator,images_per_product:count,usage,size,quality,requirements,idempotency_key:key.current}));setNotice('已保存流程、商品及配置快照，Worker 将通过 Pi 执行所选逐张方案 Skill；尚未调用生图服务。');}catch(e){setError(e instanceof Error?e.message:'任务创建失败');}finally{setBusy(false);}}
 async function action(action:'generate'|'deliver'|'cancel'){if(!batch)return;setBusy(true);setError('');try{update(await backendRequest<ImageBatch>(`product-image-batches/${batch.id}`,'POST',{expected_revision:batch.revision,action,asset_ids:action==='deliver'?accepted:[],confirmed:action==='cancel'||confirmed}));setConfirmed(false);setNotice(action==='generate'?'已开始真实生图任务，可能产生费用；离开窗口不会停止执行。':action==='deliver'?'确认的图片已交付成版本化素材包，线上商品未修改。':'已请求安全停止；在途结果仍会保留。');}catch(e){setError(e instanceof Error?e.message:'操作失败');}finally{setBusy(false);}}
 const filtered=products.filter(p=>`${p.title} ${p.store_name}`.toLowerCase().includes(query.toLowerCase()));
 const stage=batch?imageStage(batch.status):0;
 const active=!!batch&&!['failed','unknown','cancelled','delivered'].includes(batch.status);
 function fresh(){setBatch(null);setSelected([]);setAccepted([]);setConfirmed(false);nextIntent();setError('');setNotice('新批次尚未创建；历史任务仍可查看。');}
 return createPortal(<dialog ref={dialog} className={shared.dialog} style={{width:'min(1180px, calc(100vw - 32px))'}} aria-label="商品图流程执行" onCancel={onClose}>
  <header className={shared.dialogHeader}><div><h2>{steps[['image.start','image.brief','image.generate','image.check','image.authorize','image.end'].indexOf(nodeId)]??'商品图生成'}</h2><p>已上架商品 → Pi + Skill → Sunburst → 检查确认 → 素材包</p></div><Button onClick={onClose}>关闭</Button></header>
  <div className={`${shared.dialogBody} ${styles.body}`}>
   <div className={styles.stage}>{steps.map((name,i)=><span key={name} aria-current={i===stage?'step':undefined}>{String(i+1).padStart(2,'0')} · {name}</span>)}</div>
   <div className={styles.summary}><Badge tone={batch?.status==='delivered'?'success':'neutral'}>{batch?imageStatusNames[batch.status]??batch.status:'选择已上架商品'}</Badge><div className={styles.toolbar}><Button compact disabled={busy||loading} onClick={()=>void refresh()}>刷新状态</Button>{batch&&!active&&<Button compact onClick={fresh}>新建批次</Button>}{active&&<Button compact disabled={busy||batch?.status==='stopping'} onClick={()=>{if(window.confirm('停止本批次？在途模型调用的结果和已产生费用不会撤销，已生成图片保留。'))void action('cancel');}}>停止本批次</Button>}</div></div>
   {loading&&<p role="status">读取真实商品、模型与历史批次…</p>}
   {!loading&&!batch&&<>
    <div className={styles.toolbar}><Input aria-label="搜索已上架商品" value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索商品或店铺…"/><Button compact disabled={!products.length||total>500} onClick={()=>{setSelected(products.map(p=>p.id));nextIntent();}}>全选全部 {total} 件</Button><Button compact onClick={()=>{setSelected([]);nextIntent();}}>清空选择</Button><span>已选 {selected.length} 件</span></div>
    {total>500&&<p className={styles.note}>共 {total} 件，当前安全展示前 500 件，不支持把部分结果冒充全选；请单选或多选分批制作。</p>}
    {!products.length&&<Card><p>暂无已确认上架且有原图的商品。请先完成选品到上线；未确认发布、下架中及已下架商品不进入此列表。</p></Card>}
    <div className={styles.products}>{filtered.map(p=><label key={p.id} className={styles.product}><input type="checkbox" checked={selected.includes(p.id)} onChange={e=>{setSelected(ids=>e.target.checked?[...ids,p.id]:ids.filter(id=>id!==p.id));nextIntent();}}/><img src={p.images[0]} alt="商品原图"/><div><strong>{p.title}</strong><small>{p.store_name}</small></div></label>)}</div>
    <div className={styles.fields}>
     <label>逐张方案 Skill<SelectField value={plannerSkill} onChange={e=>{setPlannerSkill(e.target.value);nextIntent();}}><option value="product_image_photography">商品摄影 v3 · GitHub CC0 模板</option><option value="product_image_batch">原逐张制作方案 v2</option></SelectField></label>
     <label>方案模型 · 经 Pi harness<SelectField value={planner} onChange={e=>{setPlanner(e.target.value);nextIntent();}}><option value="">选择已配置对话模型</option>{models.filter(m=>!m.model_id.startsWith('gpt-image-')).map(m=><option key={m.id} value={m.id}>{m.name} · {m.model_id}</option>)}</SelectField><Button compact onClick={()=>setAddModel('planner')}>添加方案模型</Button></label>
     <label>生图连接 · Sunburst<SelectField value={generator} onChange={e=>{setGenerator(e.target.value);nextIntent();}}><option value="">选择 Sunburst 连接</option>{models.filter(m=>['gpt-image-2.5-sunburst','gpt-image-2.5-sunburst-2026-09-08'].includes(m.model_id)).map(m=><option key={m.id} value={m.id}>{m.name} · {m.model_id}</option>)}</SelectField><Button compact onClick={()=>setAddModel('generator')}>添加 Sunburst API</Button></label>
     <label>每件制作张数<Input type="number" min={1} max={5} value={count} onChange={e=>{setCount(Number(e.target.value));nextIntent();}}/></label>
     <label>图片用途<SelectField value={usage} onChange={e=>{setUsage(e.target.value);nextIntent();}}><option value="main">商品主图</option><option value="detail">商品详情图</option><option value="scene">场景图</option></SelectField></label>
     <label>输出尺寸<SelectField value={size} onChange={e=>{setSize(e.target.value);nextIntent();}}><option value="1024x1024">正方形 · 1024 × 1024</option><option value="1024x1536">竖版 · 1024 × 1536</option><option value="1536x1024">横版 · 1536 × 1024</option></SelectField></label>
     <label>图片质量<SelectField value={quality} onChange={e=>{setQuality(e.target.value);nextIntent();}}><option value="low">低 · 试样</option><option value="medium">中 · 默认</option><option value="high">高</option></SelectField></label>
     <label className={styles.wide}>制作要求<textarea className={styles.textarea} value={requirements} maxLength={2000} onChange={e=>{setRequirements(e.target.value);nextIntent();}} placeholder="默认保留商品外观，仅调整背景、布光与构图；不填商品未经核实的功效。"/></label>
    </div>
    <p className={styles.note}>所选 Skill 与摘要保存在本次批次；旧批次不升级。每件商品使用第一张已上架原图。共 {selected.length*count} 张；先调用方案模型（可能收费），确认方案后才调用生图。开源模板来源：<a href="https://github.com/JeremyGDM/awesome-ai-product-photography-prompts" target="_blank" rel="noreferrer">商品摄影提示词 ↗</a>。保存连接不等于服务可用。</p>
    <Button variant="primary" disabled={busy||!selected.length||!planner||!generator||count<1||count>5} onClick={()=>void start()}>{busy?'创建中…':'保存批次并制定逐张方案'}</Button>
   </>}
   {batch&&<>
    <p className={styles.note}>{batch.products.length} 件商品 · 每件 {batch.configuration.images_per_product} 张 · {batch.configuration.size} · {batch.configuration.quality}。{imageBusy(batch.status)?`已完成 ${batch.cursor} / ${batch.status==='generating'?batch.products.length*batch.configuration.images_per_product:batch.products.length} 项，按服务端记录更新。`:''} 关闭窗口不会取消任务；刷新后自动读取原批次。</p>
    {batch.plans.length>0&&<details open={batch.status==='plan_ready'||batch.status==='needs_info'}><summary>逐张制作方案 · {batch.plans.length} / {batch.products.length} 件</summary><div className={styles.plans}>{batch.plans.map((p,i)=><Card key={i} className={styles.plan}><h3>{batch.products[i]?.title}</h3><small>Pi {p.usage.harness?.version??'调用记录未提供'} · 系统逐张制作 Skill v2</small>{p.plan.shots.map((shot,j)=><details key={j} open={batch.products.length===1}><summary>第 {j+1} 张方案</summary><pre>{shot.prompt}</pre><p className={styles.note}>保留：{shot.preserve.join('、')}<br/>禁止：{shot.forbidden_changes.join('、')}</p></details>)}{p.plan.questions.length>0&&<p role="alert">需补充：{p.plan.questions.join('；')}。请停止并补充制作要求后新建批次，不猜值继续。</p>}</Card>)}</div></details>}
    {batch.status==='plan_ready'&&<><label className={styles.review}><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>我已确认逐张方案，允许发送商品原图至 OpenAI，并开始 {batch.products.length*batch.configuration.images_per_product} 次付费生图请求。</label><Button variant="primary" disabled={busy||!confirmed} onClick={()=>void action('generate')}>确认方案并开始 Sunburst 生图</Button></>}
    {batch.assets.length>0&&<><p className={styles.note}>文件解码与尺寸已通过检查；商品外观、文字事实和使用权仍需人工核对，不能自动宣称一致。</p><div className={styles.assets}>{batch.assets.map(a=><Card key={a.id} className={styles.asset}><img src={a.url} alt={`${batch.products[a.product_index]?.title} · 第${a.shot_index+1}张`}/><strong>{batch.products[a.product_index]?.title}</strong><small>第 {a.shot_index+1} 张 · {a.width} × {a.height}</small>{batch.status==='review'&&<label><input type="checkbox" checked={accepted.includes(a.id)} onChange={e=>setAccepted(ids=>e.target.checked?[...ids,a.id]:ids.filter(id=>id!==a.id))}/>采用此图</label>}<a href={`${a.url}?download=1`} download>下载图片</a></Card>)}</div></>}
    {batch.status==='review'&&<><div className={styles.toolbar}><Button compact onClick={()=>setAccepted(batch.assets.map(a=>a.id))}>全选生成图片</Button><span>采用 {accepted.length} / {batch.assets.length} 张</span></div><label className={styles.review}><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>已核对所选图片的商品外观、规格、文字事实、使用权及用途。</label><Button variant="primary" disabled={busy||!confirmed||!accepted.length} onClick={()=>void action('deliver')}>确认并交付素材包</Button></>}
    {batch.status==='delivered'&&<Card><h3>商品图素材包 · v1</h3><p>已确认图片与商品、发布记录、用途和文件摘要关联。不会自动替换线上商品图或启动广告。</p><Button compact onClick={()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(batch.pack,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=`image-pack-${batch.id}.json`;link.click();URL.revokeObjectURL(url);}}>下载素材包清单</Button><Button disabled={busy} onClick={async()=>{if(!window.confirm('仅归档素材到测试站，不替换原商品图片，继续？'))return;setBusy(true);setError('');try{await backendRequest(`product-image-batches/${batch.id}/export-test-store`,'POST',{confirmed:true});setNotice('图片已通过真实 HTTP 归档到测试站；原刊登图片未改变。');}catch(e){setError(e instanceof Error?e.message:'归档失败');}finally{setBusy(false);}}}>归档到测试站</Button></Card>}
    {batch.error&&<p role="alert" className={styles.error}>{batch.error} 已成功生成的图片仍保留，不自动重新调用。</p>}
   </>}
   {addModel&&<Card><ModelConnectionForm initial={addModel==='generator'?{name:'商品图 · Sunburst',model_id:'gpt-image-2.5-sunburst',protocol:'openai-responses',base_url:'https://api.openai.com/v1'}:undefined} onSaved={m=>{setModels(rows=>[...rows.filter(x=>x.id!==m.id),m]);if(addModel==='generator')setGenerator(m.id);else setPlanner(m.id);setAddModel(null);nextIntent();}} onCancel={()=>setAddModel(null)}/></Card>}
   {error&&<p role="alert" className={styles.error}>{error}</p>}{notice&&<p role="status" className={styles.note}>{notice}</p>}
   {!!history.length&&<details><summary>此流程的已保存批次</summary><div className={styles.history}>{history.map(b=><Button compact key={b.id} disabled={busy} onClick={()=>{update(b);setAccepted([]);setConfirmed(false);void backendRequest<ImageBatch>(`product-image-batches/${b.id}`).then(update).catch(e=>setError(String(e)));}}>{imageStatusNames[b.status]} · {b.products.length} 件</Button>)}</div></details>}
  </div></dialog>,document.body);
}

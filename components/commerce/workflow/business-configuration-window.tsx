'use client';
import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Button} from '@/components/ui/button';
import {SelectField} from '@/components/ui/select-field';
import {Input} from '@/components/ui/input';
import {Card} from '@/components/ui/card';
import {backendRequest} from '@/lib/workflow/backend-client';
import type {ModelConnection} from '@/lib/workflow/model-connections';
import type {WorkflowDocument} from '@/lib/workflow/universal';
import type {ImageProduct} from '@/lib/product-images';
import shared from './workflow.module.css';
import styles from './product-images-window.module.css';
type Config=Record<string,unknown>;
export function BusinessConfigurationWindow({document,onClose,onApply}:{document:WorkflowDocument;onClose:()=>void;onApply:(config:Config)=>void}){
 const support=document.templateId==='support',dialog=useRef<HTMLDialogElement>(null);
 const initial=(document.nodes[0].binding.parameters.runtime??{}) as Config;
 const [config,setConfig]=useState<Config>(support?{mode:'fixture',connection_id:null,message_id:'',sample_knowledge_confirmed:false,...initial}:{product_ids:[],planner_id:'',generator_id:'',planner_skill:'product_image_photography',images_per_product:1,usage:'main',size:'1024x1024',quality:'medium',requirements:'',...initial});
 const [models,setModels]=useState<ModelConnection[]>([]),[products,setProducts]=useState<ImageProduct[]>([]),[messages,setMessages]=useState<{id:string;message:string;answered?:boolean}[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(true),[partial,setPartial]=useState(false);
 useEffect(()=>{dialog.current?.showModal();let alive=true;void Promise.all([backendRequest<ModelConnection[]>('model-connections'),support?backendRequest<{messages:{id:string;message:string}[];records:{kind:string;payload:{message_id?:string}}[]}>(`stores/${document.environment.storeRef}/test-lab`):backendRequest<{results:ImageProduct[];count:number}>('product-image-products')]).then(([m,data])=>{if(!alive)return;setModels(m);if('messages' in data)setMessages(data.messages.map(m=>({...m,answered:data.records.some(r=>r.kind==='reply'&&r.payload.message_id===m.id)})));if('results' in data){setPartial(data.count>data.results.length);setProducts(data.results.filter(p=>(p as ImageProduct&{store_id?:string}).store_id===document.environment.storeRef));}}).catch(e=>{if(alive)setError(e instanceof Error?e.message:'读取配置失败');}).finally(()=>{if(alive)setBusy(false);});return()=>{alive=false;};},[document.id]);
 const set=(key:string,value:unknown)=>setConfig(p=>({...p,[key]:value}));
 const field=(key:string)=>String(config[key]??'');
 const selected=(config.product_ids??[]) as string[];
 const valid=support?(config.input_mode==='inbox'||messages.some(m=>m.id===config.message_id&&!m.answered))&&config.sample_knowledge_confirmed===true&&(config.mode==='fixture'||!!config.connection_id):selected.length>0&&!!config.planner_id&&!!config.generator_id&&Number(config.images_per_product)>=1&&Number(config.images_per_product)<=5;
 const modelSelect=(key:string,title:string,image=false)=><label>{title}<SelectField value={field(key)} onChange={e=>set(key,e.target.value||null)}><option value="">请选择已登记连接</option>{models.filter(m=>image?m.model_id.startsWith('gpt-image-2.5-sunburst'):!m.model_id.startsWith('gpt-image-')).map(m=><option key={m.id} value={m.id}>{m.name} · {m.model_id}</option>)}</SelectField></label>;
 return createPortal(<dialog ref={dialog} className={shared.dialog} style={{width:'min(1000px,calc(100vw - 32px))'}} aria-label={support?'配置智能客服流程':'配置商品图流程'} onCancel={onClose}>
 <header className={shared.dialogHeader}><div><h2>{support?'智能客服运行配置':'商品图运行配置'}</h2><p>应用到草稿后保存并冻结。模型与执行策略锁定到该版本；监听模式每条新消息独立运行。这里不调用模型、不发送消息或生图。</p></div><Button onClick={onClose}>关闭</Button></header>
 <div className={`${shared.dialogBody} ${styles.body}`}>
 {!document.environment.storeRef&&<p role="alert">请先在配置店铺接入保存店铺连接。</p>}
 {support?<>
 <label>消息来源<SelectField value={field('input_mode')||'message'} onChange={e=>setConfig(p=>({...p,input_mode:e.target.value,message_id:e.target.value==='inbox'?null:'',reply_policy:'manual'}))}><option value="message">单次执行 · 选择一条消息</option><option value="inbox">持续接收新消息 · 用于定时器一直执行</option></SelectField></label>
 {config.input_mode!=='inbox'&&<>
 <label>本次客户消息<SelectField value={field('message_id')} onChange={e=>set('message_id',e.target.value)}><option value="">选择已连接测试站的收件</option>{messages.map(m=><option key={m.id} value={m.id} disabled={m.answered}>{m.message}{m.answered?' · 已答复':''}</option>)}</SelectField></label>
 <p>已有答复的消息不能再次执行；可在测试站联调页创建新的咨询。</p>
 </>}
 {config.input_mode==='inbox'&&<><label>回复方式<SelectField value={field('reply_policy')||'manual'} onChange={e=>set('reply_policy',e.target.value)}><option value="manual">生成草稿 · 人工确认后发送</option><option value="automatic">普通政策咨询自动回复 · 异常转人工</option></SelectField></label><p>冻结后在定时器选择“一直执行”。按先后处理未答复消息，每条只执行一次；模型失败或发送结果未知不会自动重试。</p></>}
 <label>回复执行器<SelectField value={field('mode')} onChange={e=>setConfig(p=>({...p,mode:e.target.value,connection_id:e.target.value==='fixture'?null:p.connection_id}))}><option value="fixture">确定性政策测试 · 不调用模型</option><option value="pi">Pi + 客服 Skill · 调用大模型</option></SelectField></label>
 {config.mode==='pi'&&modelSelect('connection_id','回复模型')}
 <label className={styles.review}><input type="checkbox" checked={config.sample_knowledge_confirmed===true} onChange={e=>set('sample_knowledge_confirmed',e.target.checked)}/>确认使用 Northwind 开源测试政策，不代表真实商户政策。</label>
 <p>{config.reply_policy==='automatic'?'开启后，资料与引用检查通过的普通咨询按冻结授权自动答复。':'流程会在“检查回复与转人工”暂停；确认后才发送。'}仅测试站收件箱，不发送邮件。退款、取消或补发问题转人工，不授权资金动作。</p>
 </>:<>
 <div className={styles.toolbar}><Button disabled={!products.length||partial} onClick={()=>set('product_ids',products.map(p=>p.id))}>全选本店已上架商品</Button><Button onClick={()=>set('product_ids',[])}>清空</Button><span>已选 {selected.length} 件</span></div>
 {partial&&<p>目录仅展示前 500 件，不能当作完整全选；请从已显示商品中明确选择。</p>}
 <div className={styles.products}>{products.map(p=><label className={styles.product} key={p.id}><input type="checkbox" checked={selected.includes(p.id)} onChange={e=>set('product_ids',e.target.checked?[...selected,p.id]:selected.filter(id=>id!==p.id))}/><img src={p.images[0]} alt="商品原图"/><span>{p.title}</span></label>)}</div>
 <div className={styles.fields}>
 {modelSelect('planner_id','方案模型 · Pi harness')}{modelSelect('generator_id','生图连接 · Sunburst',true)}
 <label>逐张方案 Skill<SelectField value={field('planner_skill')} onChange={e=>set('planner_skill',e.target.value)}><option value="product_image_photography">商品摄影 v3</option><option value="product_image_batch">逐张方案 v2</option></SelectField></label>
 <label>每件张数<Input type="number" min={1} max={5} value={field('images_per_product')} onChange={e=>set('images_per_product',Number(e.target.value))}/></label>
 <label>用途<SelectField value={field('usage')} onChange={e=>set('usage',e.target.value)}>{[['main','商品主图'],['detail','详情图'],['scene','场景图']].map(([v,l])=><option key={v} value={v}>{l}</option>)}</SelectField></label>
 <label>尺寸<SelectField value={field('size')} onChange={e=>set('size',e.target.value)}>{['1024x1024','1024x1536','1536x1024'].map(v=><option key={v}>{v}</option>)}</SelectField></label>
 <label>质量<SelectField value={field('quality')} onChange={e=>set('quality',e.target.value)}>{['low','medium','high'].map(v=><option key={v}>{v}</option>)}</SelectField></label>
 <label>制作要求<textarea maxLength={2000} value={field('requirements')} onChange={e=>set('requirements',e.target.value)}/></label>
 </div><Card><p>运行先制定方案，确认方案与费用后才发送原图生图；图片外观再次人工确认后交付。不会自动替换线上图片。</p></Card>
 </>}
 {busy&&<p role="status">读取已接入的商品、消息与模型…</p>}{error&&<p role="alert">{error}</p>}
 <Button variant="primary" disabled={busy||!valid||!document.environment.storeRef} onClick={()=>onApply(config)}>应用运行配置</Button>
 </div></dialog>,window.document.body);
}

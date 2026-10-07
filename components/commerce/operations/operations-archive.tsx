'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {PageHeader} from '@/components/app/page-header';
import {Card} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {SelectField} from '@/components/ui/select-field';
import {backendRequest,type BackendStore} from '@/lib/workflow/backend-client';
import type {ModelConnection} from '@/lib/workflow/model-connections';
import styles from './operations-archive.module.css';

type Result={id:string;kind:string;created_at:string;payload:{status:string;mode?:string;channel_mode?:string;revision?:number;customer_message?:string;reply?:{reply:string;questions:string[];citations:string[];handoff_required:boolean};evidence?:{id:string;text:string;source:string}[];events?:{step:number;label:string}[];currency?:string;period_start?:string;period_end?:string;summary?:{orders:number;net_sales:string|null;operating_profit:string|null;pending_cost_orders:number};recommendations?:string[];error?:string}};
type Archive={results:Result[];count:number;page:number;legacy_drafts?:{id:string;created_at:string;reply:string;status:string}[]};
const statusNames:Record<string,string>={processing:'执行中',archived:'已归档',awaiting_review:'待检查确认',handoff:'需转人工',failed:'执行失败'};
export function OperationsArchive({kind,embedded=false}:{kind:'support'|'reviews';embedded?:boolean}){
 const support=kind==='support';
 const [data,setData]=useState<Archive>({results:[],count:0,page:1}),[selected,setSelected]=useState<Result|null>(null),[page,setPage]=useState(1),[models,setModels]=useState<ModelConnection[]>([]),[connection,setConnection]=useState(''),[mode,setMode]=useState('fixture'),[message,setMessage]=useState('标准配送需要多久？'),[currency,setCurrency]=useState('USD'),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const [stores,setStores]=useState<BackendStore[]>([]),[store,setStore]=useState(''),[messages,setMessages]=useState<{id:string;message:string}[]>([]),[messageId,setMessageId]=useState('');
 const key=useRef('');
 useEffect(()=>{if(support)void backendRequest<BackendStore[]>('stores').then(setStores).catch(e=>setError(String(e)));},[support]);
 async function inbox(){setBusy(true);setError('');try{const value=await backendRequest<{messages:{id:string;message:string}[]}>(`stores/${store}/test-lab`);setMessages(value.messages);setMessageId('');}catch(e){setError(e instanceof Error?e.message:'读取失败');}finally{setBusy(false);}}
 async function load(){setLoading(true);try{const result=await backendRequest<Archive>(`operation-reports/${kind}?page=${page}`);setData(result);setSelected(current=>result.results.find(r=>r.id===current?.id)??result.results[0]??null);}catch(e){setError(e instanceof Error?e.message:'读取失败');}finally{setLoading(false);}}
 useEffect(()=>{void load();},[kind,page]);
 useEffect(()=>{let alive=true;if(support)void backendRequest<ModelConnection[]>('model-connections').then(rows=>{if(alive)setModels(rows);}).catch(e=>{if(alive)setError(e instanceof Error?e.message:'读取模型失败');});return()=>{alive=false};},[support]);
 function changed(){key.current='';}
 async function create(){setBusy(true);setError('');if(!key.current)key.current=crypto.randomUUID();try{const result=await backendRequest<Result>(`operation-reports/${kind}`,'POST',support?{request_key:key.current,message:store?'':message,store_id:store||null,message_id:store?messageId:null,mode,connection_id:mode==='pi'?connection:null,sample_knowledge_confirmed:consent}:{request_key:key.current,currency});key.current='';setPage(1);await load();setSelected(result);}catch(e){setError(e instanceof Error?e.message:'执行失败');}finally{setBusy(false);}}
 async function confirm(){if(!selected)return;setBusy(true);setError('');try{const result=await backendRequest<Result>(`operation-report/${selected.id}`,'POST',{confirmed:true,expected_revision:selected.payload.revision});await load();setSelected(result);}catch(e){setError(e instanceof Error?e.message:'确认失败');}finally{setBusy(false);}}
 const p=selected?.payload;
 return <div className={styles.workspace}>
 {!embedded&&<PageHeader title={support?'客服':'经营复盘'} description={support?'连接测试站收件箱，保留知识引用与 HTTP 回复回执；不会退款、补发或发送邮件。':'保留经营数据快照、缺失项与调整建议；测试付款与真实经营事实请按来源区分。'} actions={<><Link className="ui-button" href="/test-store-lab">测试站联调 ↗</Link><Link className="ui-button" href={`/workflow/builder?template=${support?'support':'optimize'}`}>打开业务流程 ↗</Link><Button disabled={loading} onClick={()=>void load()}>刷新记录</Button></>}/>}
 <div className={styles.layout}><Card className={styles.panel}><h2>{support?'客服测试台':'生成本次复盘'}</h2>
 <div className={styles.form}>{support?<>
 <label>消息来源<SelectField value={store} onChange={e=>{setStore(e.target.value);setMessages([]);setMessageId('');changed();}}><option value="">离线模拟消息</option>{stores.filter(s=>s.active&&s.verified).map(s=><option key={s.id} value={s.id}>{s.name} · HTTP 收件箱</option>)}</SelectField></label>
 {store&&<><Button disabled={busy} onClick={()=>void inbox()}>读取测试站收件箱</Button><SelectField value={messageId} onChange={e=>{setMessageId(e.target.value);changed();}}><option value="">选择客户消息</option>{messages.map(m=><option key={m.id} value={m.id}>{m.message}</option>)}</SelectField><Link href="/test-store-lab">先创建测试购买 / 客户消息 ↗</Link></>}
 <label>回复执行器<SelectField value={mode} onChange={e=>{setMode(e.target.value);changed();}}><option value="fixture">确定性测试 · 不调用模型</option><option value="pi">Pi + 客服 Skill · 调用模型</option></SelectField></label>
 {mode==='pi'&&<label>已配置模型<SelectField value={connection} onChange={e=>{setConnection(e.target.value);changed();}}><option value="">请选择</option>{models.filter(m=>!m.model_id.startsWith('gpt-image-')).map(m=><option key={m.id} value={m.id}>{m.name} · {m.model_id}</option>)}</SelectField><Link href="/workflow">在工作流页添加大模型 API ↗</Link></label>}
 {!store&&<label>模拟客户消息<textarea maxLength={4000} value={message} onChange={e=>{setMessage(e.target.value);changed();}}/></label>}
 <label className={styles.checkbox}><input type="checkbox" checked={consent} onChange={e=>{setConsent(e.target.checked);changed();}}/><span>我确认使用 Northwind 开源测试政策，不代表我的店铺政策。</span></label>
 <p>先读取资料与政策，生成回复，再检查或转人工。连接店铺后，确认操作会真实写入测试站收件箱；不发送邮件。</p>
 </>:<><label>核算币种<SelectField value={currency} onChange={e=>{setCurrency(e.target.value);changed();}}>{['USD','EUR','GBP','CNY'].map(c=><option key={c}>{c}</option>)}</SelectField></label><p>最近 7 天已同步的财务事实。缺失成本显示未知，不用选品报价充当实际利润。当前为只读复盘，不代表整个调整流程已经执行。</p></>}
 <Button variant="primary" disabled={busy||(support&&(!(store?messageId:message.trim())||!consent||(mode==='pi'&&!connection)))} onClick={()=>void create()}>{busy?'执行中…':support?'检索知识并生成回复':'核算并归档复盘'}</Button>
 {error&&<div className={styles.error} role="alert">{error}</div>}
 </div><h2>历史记录 <small>({data.count})</small></h2>
 <div className={styles.list}>{data.results.map(r=><button key={r.id} className={styles.item} aria-pressed={selected?.id===r.id} onClick={()=>setSelected(r)}><strong>{support?r.payload.customer_message??'客服执行记录':`${r.payload.currency??''} · 经营复盘`}</strong><small>{new Date(r.created_at).toLocaleString()} · {statusNames[r.payload.status]??r.payload.status}</small></button>)}{!data.results.length&&<p className={styles.empty}>{loading?'读取中…':'还没有归档记录'}</p>}</div>
 <div className={styles.pagination}><Button compact disabled={page<=1||loading} onClick={()=>setPage(n=>n-1)}>上一页</Button><span>{page}</span><Button compact disabled={page*20>=data.count||loading} onClick={()=>setPage(n=>n+1)}>下一页</Button></div>
 </Card><Card className={styles.panel}>{p?<><div className={styles.actions}><Badge tone={p.status==='failed'?'danger':'info'}>{statusNames[p.status]??p.status}</Badge>{support&&<Badge>{p.channel_mode==='test_store_http'?'测试站 HTTP':'渠道模拟'} · {p.mode==='pi'?'Pi 模型':'未调用模型'}</Badge>}</div>
 {p.error&&<p role="alert">{p.error}</p>}
 {support?<><h2>回复与证据</h2><div className={styles.steps}>{p.events?.map(e=><span key={e.step} className={styles.step}>{String(e.step).padStart(2,'0')} · {e.label}</span>)}</div><div className={styles.reply}>{p.reply?.reply??'尚无回复结果'}</div>{p.reply?.questions.map((q,i)=><p key={i}>{q}</p>)}
 {p.evidence?.map(e=><details key={e.id} className={styles.evidence}><summary>引用 · {e.id}</summary><p>{e.text}</p><a href={e.source} target="_blank" rel="noreferrer">查看开源来源 ↗</a></details>)}
 {(p.status==='awaiting_review'||p.status==='send_unknown')&&<><p>{p.channel_mode==='test_store_http'?'确认后保存到测试站并回查回执；不发送邮件。':'下方仅模拟收发，不访问店铺。'}</p><Button variant="primary" disabled={busy} onClick={()=>void confirm()}>{p.status==='send_unknown'?'仅核对发送结果，不重发':p.channel_mode==='test_store_http'?'确认回复并发送到测试站':'确认回复并完成模拟链路'}</Button></>}
 {p.status==='handoff'&&<p>缺少订单事实或涉及具体权益，已转人工；不会继续模拟发送。</p>}
 </>:<><h2>经营事实快照</h2><p>{p.period_start&&new Date(p.period_start).toLocaleDateString()} — {p.period_end&&new Date(p.period_end).toLocaleDateString()} · {p.currency}</p><div className={styles.metrics}><div className={styles.metric}><span>付款订单</span><strong>{p.summary?.orders??'未知'}</strong></div><div className={styles.metric}><span>净销售额</span><strong>{p.summary?.net_sales??'未知'}</strong></div><div className={styles.metric}><span>经营利润</span><strong>{p.summary?.operating_profit??'未知'}</strong></div></div><p>待补成本订单：{p.summary?.pending_cost_orders??'未知'}</p><h2>调整建议 · 待人工执行</h2>{p.recommendations?.map((r,i)=><p key={i}>{r}</p>)}<Badge>未自动调整业务配置</Badge></>}
 </>:<div className={styles.empty}><h2>{support?'每次回复都留有依据':'复盘从真实数据开始'}</h2><p>{support?'左侧开始一次测试，记录会保存在后端，刷新不丢失。':'生成报告后，在这里核对经营数据与缺失成本。'}</p></div>}
 {support&&!!data.legacy_drafts?.length&&<details className={styles.evidence}><summary>历史客服回复草稿 · {data.legacy_drafts.length} 条</summary>{data.legacy_drafts.map(d=><div key={d.id}><p>{new Date(d.created_at).toLocaleString()} · 仅草稿、未发送</p><div className={styles.reply}>{d.reply||'尚无结构化回复'}</div></div>)}</details>}
 </Card></div></div>;
}

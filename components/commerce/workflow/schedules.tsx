'use client';
import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import Link from 'next/link';
import {PageHeader} from '@/components/app/page-header';
import {FeatureNotice} from '@/components/app/feature-notice';
import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {Badge} from '@/components/ui/badge';
import {Input} from '@/components/ui/input';
import {SelectField} from '@/components/ui/select-field';
import {Switch} from '@/components/ui/switch';
import {Icon} from '@/components/ui/icon';
import {scheduleClient,type TimerConfig,type TimerOverview,type WorkflowTimer} from '@/lib/workflow/schedules';
import {continuousScheduleAvailable,continuousScheduleHint} from '@/lib/workflow/schedule-options';
import styles from './schedules.module.css';
import shared from './workflow.module.css';
const weekdays=['周一','周二','周三','周四','周五','周六','周日'];
const runLabels:Record<string,string>={queued:'等待执行',running:'执行中',waiting_approval:'等待审批',waiting_event:'等待回执',needs_attention:'需要处理',succeeded:'已完成',cancelled:'已取消'};
const triggerLabels:Record<string,string>={started:'已启动',skipped:'已跳过',missed:'错过时段',blocked:'启动受阻'};
function when(value:string|null,zone:string){if(!value)return '—';try{return new Intl.DateTimeFormat('zh-CN',{timeZone:zone,month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));}catch{return '时间不可用';}}
function cadence(row:TimerConfig){return row.frequency==='continuous'?'一直执行 · 新消息触发':row.frequency==='interval'?`每 ${row.interval_hours} 小时`:row.frequency==='daily'?`每天 ${row.clock}`:`${row.weekdays.map(day=>weekdays[day]).join('、')} ${row.clock}`;}
function blank():TimerConfig{return {name:'定时选品到上线',release_id:'',frequency:'daily',timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'Asia/Shanghai',clock:'09:00',weekdays:[0,1,2,3,4],interval_hours:24,enabled:false};}
export function WorkflowSchedules(){
 const dialog=useRef<HTMLDialogElement>(null);
 const [overview,setOverview]=useState<TimerOverview|null>(null),[form,setForm]=useState<TimerConfig>(blank),[editing,setEditing]=useState<WorkflowTimer|null>(null),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[loadError,setLoadError]=useState('');
 useEffect(()=>{let active=true;const read=()=>scheduleClient.list().then(data=>{if(active){setOverview(data);setLoadError('');}}).catch(e=>{if(active)setLoadError(e.message);});void read();const timer=setInterval(()=>void read(),10000);return()=>{active=false;clearInterval(timer);};},[]);
 useEffect(()=>{if(!open)return;const element=dialog.current,overflow=document.body.style.overflow;element?.showModal();document.body.style.overflow='hidden';return()=>{element?.close();document.body.style.overflow=overflow;};},[open]);
 async function act(fn:()=>Promise<void>){if(busy)return;setBusy(true);setError('');setMessage('');try{await fn();try{setOverview(await scheduleClient.list());setLoadError('');}catch(e){setLoadError(e instanceof Error?e.message:'列表读取失败，请刷新。');}}catch(e){setError(e instanceof Error?e.message:'操作失败，请重试。');}finally{setBusy(false);}}
 function edit(row?:WorkflowTimer){const first=overview?.releases[0];setEditing(row??null);setForm(row?{name:row.name,release_id:row.release_id,frequency:row.frequency,timezone:row.timezone,clock:row.clock,weekdays:[...row.weekdays],interval_hours:row.interval_hours,enabled:row.enabled}:{...blank(),release_id:first?.id??'',frequency:first?.scope==='support'&&first.input_mode==='inbox'?'continuous':'daily'});setOpen(true);setMessage('');setError('');}
 const selectedRelease=overview?.releases.find(r=>r.id===form.release_id),inbox=continuousScheduleAvailable(selectedRelease);
 const valid=!!overview&&!!form.name.trim()&&!!form.release_id&&!!form.timezone.trim()&&(inbox?form.frequency==='continuous':form.frequency!=='continuous')&&(form.frequency!=='weekly'||form.weekdays.length>0)&&(form.frequency!=='interval'||Number.isInteger(form.interval_hours)&&form.interval_hours>=1&&form.interval_hours<=720);
 return <div className={styles.workspace}>
  <PageHeader title="定时器" description="定时启动完整业务流程，或持续监听客服新消息。每一轮都使用选定的冻结配置。" actions={<><Link className="ui-button ui-button--secondary" href="/workflow/releases">管理冻结版本 ↗</Link><Button disabled={busy} onClick={()=>void act(async()=>{setOverview(await scheduleClient.list());})}>刷新</Button><Button variant="primary" disabled={busy} onClick={()=>edit()}>＋ 新建定时器</Button></>}/>
  <Card className={styles.statusBar}><div className={styles.service}><Icon name="clock"/><div><strong>工作流调度服务</strong><span>最后心跳 {when(overview?.dispatcher.last_seen_at??null,Intl.DateTimeFormat().resolvedOptions().timeZone)}</span></div><Badge tone={overview?.dispatcher.online?'success':'warning'}>{overview?.dispatcher.online?'服务在线':'未确认在线'}</Badge></div><p>关闭浏览器仍可运行；电脑关机或后端停止时不会执行，恢复后不补跑错过的时段。</p></Card>
  {loadError&&<p className={styles.notice} role="alert">定时配置读取失败：{loadError}。可点击“刷新”重试。</p>}
  {((error&&!open)||message)&&<p className={styles.notice} role={error?'alert':'status'}>{error||message}</p>}
  <div className={styles.layout}>
   <section className={styles.list} aria-label="已保存定时器">
    {!overview&&!loadError&&<Card className={styles.empty}>正在读取定时配置…</Card>}
    {overview&&!overview.schedules.length&&<Card className={styles.empty}><Icon name="clock" size={32}/><h2>把重复业务交给计划</h2><p>先在工作流中保存并校验冻结，再选择该版本创建定时器。</p><Link href="/workflow/builder">打开工作流配置 ↗</Link></Card>}
    {overview?.schedules.map(row=><Card key={row.id} className={styles.timer}>
     <header><div><Badge tone={row.enabled?'success':'neutral'}>{row.enabled?'已启用':'已暂停'}</Badge><h2>{row.name}</h2><p>{row.workflow_title} · 冻结版本 r{row.release_revision}</p></div><Button compact disabled={busy} onClick={()=>edit(row)}>编辑</Button></header>
     <div className={styles.facts}><div><small>执行计划</small><strong>{cadence(row)}</strong><span>{row.timezone}</span></div><div><small>下次触发</small><strong>{row.enabled?(row.frequency==='continuous'?'持续监听中':when(row.next_due_at,row.timezone)):'暂停中'}</strong><span>{row.frequency==='continuous'?'待处理 '+row.pending_messages+' · 已完成 '+row.completed_messages+' · 待人工 '+row.attention_messages:'上轮未结束自动跳过'}</span></div></div>
     {row.frequency==='continuous'&&<p>最近检查 {when(row.last_polled_at,row.timezone)} · 每条消息只执行一次；失败与转人工不会自动重跑。</p>}
     {row.last_error&&<p role="alert" className={styles.notice}>{row.last_error}</p>}
     <footer><Switch disabled={busy} checked={row.enabled} onCheckedChange={enabled=>void act(async()=>{await scheduleClient.update(row.id,row.revision,{enabled});setMessage(enabled?'定时器已启用；监听模式将在下一次服务轮询检查消息，定时模式按下个计划时间启动。':'定时器已暂停；已经启动的流程不会被取消。');})}>{row.enabled?'暂停定时执行':'启用定时执行'}</Switch>{row.last_run_id&&<Link href={`/workflow/live?run=${row.last_run_id}`}>查看最近运行 ↗</Link>}</footer>
     <details className={styles.history}><summary>触发记录{row.history.length?` · 最近 ${row.history.length} 次`:''}</summary>{!row.history.length?<p>尚未触发，不会为展示生成运行记录。</p>:row.history.map(item=><div className={styles.historyRow} key={item.id}><span>{when(item.scheduled_at,row.timezone)}</span><div><strong>{triggerLabels[item.status]??item.status}{item.run_status?` · ${runLabels[item.run_status]??item.run_status}`:''}</strong>{item.reason&&<p>{item.reason}</p>}<small>冻结版本 r{item.release_revision}</small></div>{item.run_id&&<Link href={`/workflow/live?run=${item.run_id}`}>查看运行 ↗</Link>}</div>)}</details>
    </Card>)}
   </section>
  </div>
   {open&&createPortal(<dialog ref={dialog} className={`${shared.dialog} ${styles.editor}`} aria-labelledby="schedule-editor-title" onCancel={e=>{e.preventDefault();if(!busy)setOpen(false);}}><header className={shared.dialogHeader}><div><small>计划配置</small><h2 id="schedule-editor-title">{editing?'编辑定时器':'新建定时器'}</h2></div><Button compact variant="ghost" disabled={busy} onClick={()=>setOpen(false)}>关闭</Button></header>
    <form onSubmit={e=>{e.preventDefault();if(!valid)return;void act(async()=>{if(editing)await scheduleClient.update(editing.id,editing.revision,form);else await scheduleClient.create(form);setOpen(false);setMessage(form.enabled?(form.frequency==='continuous'?'定时器已保存并启用，将持续检查新消息。':'定时器已保存并启用，将在下一个计划时间运行。'):'定时器已保存，当前暂停；启用后才会按计划运行。');});}}>
     <label>名称<Input required maxLength={120} disabled={busy} value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
     <label>业务流程 · 已冻结版本<SelectField required aria-label="业务流程 · 已冻结版本" disabled={busy} value={form.release_id} onChange={e=>{const r=overview?.releases.find(r=>r.id===e.target.value);setForm({...form,release_id:e.target.value,frequency:r?.scope==='support'&&r.input_mode==='inbox'?'continuous':'daily'});}}><option value="">请选择已冻结流程</option>{overview?.releases.map(row=><option key={row.id} value={row.id}>{row.title} · r{row.revision} · {row.store_name}</option>)}</SelectField></label>
     {!overview?.releases.length&&<p>暂无可运行版本。<Link href="/workflow/builder">先保存并校验冻结流程 ↗</Link></p>}
     <p className={styles.help}>固定使用选中的配置快照，不跟随草稿变化。支持选品、智能客服和商品图。固定消息/商品清单只启动一次，后续时段跳过，不重复收费；新任务需重新配置冻结。</p>
     {!inbox&&<p className={styles.help}>{continuousScheduleHint(selectedRelease)} <Link href="/workflow/builder?template=support">配置客服持续收件并冻结 ↗</Link></p>}
     <div className={styles.fields}><label>执行频率<SelectField aria-label="执行频率" disabled={busy} value={form.frequency} onChange={e=>setForm({...form,frequency:e.target.value as TimerConfig['frequency']})}><option value="daily" disabled={inbox}>每天</option><option value="weekly" disabled={inbox}>每周</option><option value="interval" disabled={inbox}>间隔执行</option><option value="continuous" disabled={!inbox}>一直执行 · 新消息触发{inbox?'':'（需客服监听版本）'}</option></SelectField></label>{form.frequency==='continuous'?<p className={styles.help}>关闭网页不停止监听；需保持后端和 worker 运行。暂停定时器只停止领取新消息，不取消已启动的流程。</p>:form.frequency==='interval'?<label>间隔小时<Input required aria-label="间隔小时" type="number" min={1} max={720} step={1} disabled={busy} value={form.interval_hours} onChange={e=>setForm({...form,interval_hours:Number(e.target.value)})}/></label>:<label>执行时间<Input required aria-label="执行时间" type="time" disabled={busy} value={form.clock} onChange={e=>setForm({...form,clock:e.target.value})}/></label>}</div>
     {form.frequency==='weekly'&&<fieldset className={styles.days}><legend>执行日期</legend>{weekdays.map((day,i)=><label key={day}><input type="checkbox" disabled={busy} checked={form.weekdays.includes(i)} onChange={e=>setForm({...form,weekdays:e.target.checked?[...form.weekdays,i].sort():form.weekdays.filter(d=>d!==i)})}/>{day}</label>)}</fieldset>}
     <label>时区<Input required aria-label="时区" maxLength={100} disabled={busy} value={form.timezone} placeholder="Asia/Shanghai" onChange={e=>setForm({...form,timezone:e.target.value})}/></label>
     <Switch checked={form.enabled} disabled={busy} onCheckedChange={enabled=>setForm({...form,enabled})}>保存后启用定时执行</Switch>
     {inbox&&<p className={styles.help}>{selectedRelease?.reply_policy==='automatic'?'此冻结版本已授权普通政策问题自动答复；缺事实、退款与补发转人工。':'此冻结版本生成草稿后等待人工确认。要自动答复，请在客服首节点修改回复方式并重新冻结。'}仅已接入的本地测试收件箱，不发送邮件；首次启用也会领取现有未答复消息。</p>}
     <FeatureNotice title="只负责触发，不越过业务检查">定时业务上轮未结束时跳过。客服监听的异常消息单独转人工，其他消息可继续。商品图仍需确认费用与外观，计划不会代你批准。连接失效或启动校验失败会暂停定时器，修复后可重新启用。</FeatureNotice>
     {error&&<p role="alert" className={styles.notice}>保存未成功：{error} 配置仍保留在表单中，可修正后重试。</p>}
     <div className={styles.actions}><Button disabled={busy} onClick={()=>setOpen(false)} type="button">取消</Button><Button variant="primary" disabled={busy||!valid} type="submit">{busy?'正在保存…':'保存定时器'}</Button></div>
    </form>
   </dialog>,document.body)}
 </div>;
}

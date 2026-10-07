'use client';
import {useEffect,useState,type ReactNode} from 'react';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {Card} from '@/components/ui/card';
import {Icon} from '@/components/ui/icon';
import type {BackendRun,BackendEvent} from '@/lib/workflow/backend-client';
import {durationLabel,runProgress,candidateCounts} from '@/lib/workflow/run-progress';
import styles from './run-execution-view.module.css';
import {IntelligenceResults,type IntelligenceSnapshot} from '../connections/cj-intelligence';

export const runStatusLabels:Record<string,string>={queued:'等待执行',running:'正在执行',waiting_approval:'等待人工确认',waiting_event:'等待渠道结果',succeeded:'已确认可售',needs_attention:'已暂停 · 需要处理',cancelled:'已取消'};
const eventLabels:Record<string,string>={running:'开始执行',completed:'步骤完成',transferring:'传递结果',waiting_approval:'等待人工确认',waiting_event:'等待外部结果',failed:'执行异常',needs_attention:'需要处理',queued:'已进入队列'};
type Props={run:BackendRun;events:BackendEvent[];progress:ReturnType<typeof runProgress>;notice:string;renderCanvas:(selected:string,onSelect:(id:string)=>void)=>ReactNode;children:ReactNode;actions?:ReactNode};

/** Read-only projection. Commands remain in LiveWorkflow and require server authorization. */
export function RunExecutionView({run,events,progress,notice,renderCanvas,children,actions}:Props){
 const [inspected,setInspected]=useState<string|null>(null);
 const [tab,setTab]=useState<'overview'|'results'|'events'>('overview');
 const [clock,setClock]=useState(()=>Date.now());
 useEffect(()=>{if(!['running','waiting_event','queued'].includes(run.status))return;const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer);},[run.id,run.status]);
 const currentAttempts=(run.attempts??[]).filter(a=>a.node_id===run.node_id&&a.generation===run.generation);
 const firstTime=currentAttempts[0]?.created_at,lastTime=currentAttempts.at(-1)?.completed_at;
 const stageElapsed=firstTime?Math.max(0,((['running','waiting_event','queued'].includes(run.status)?clock:Date.parse(lastTime??firstTime))-Date.parse(firstTime))/1000):null;
 const selected=run.document.nodes.find(n=>n.id===inspected)??run.document.nodes.find(n=>n.id===run.node_id);
 const selectedId=selected?.id??run.node_id;
 const current=selectedId===run.node_id;
 const attempts=(run.attempts??[]).filter(a=>a.node_id===selectedId&&a.generation===run.generation);
 const last=attempts.at(-1);
 const proposal=run.context.selection_proposal;
 const selection=run.context.selection;
 const counts=candidateCounts(run);
 const exclusions=new Map<string,number>();
 for(const row of proposal?.rejected??[])for(const reason of Array.isArray(row.reasons)?row.reasons:[])exclusions.set(reason,(exclusions.get(reason)??0)+1);
 const payload=run.context.listing??run.context.brief;
 const intelligence=(run.context as typeof run.context&{market_intelligence?:{status:string;reason?:string;snapshot?:IntelligenceSnapshot;mappings?:{source_name:string;category_path:string}[]}}).market_intelligence;
 const business=(run.context as typeof run.context&{business?:{kind:string}}).business;
 const status=business&&run.status==='succeeded'?(business.kind==='support'?'回复已归档':'素材包已交付'):runStatusLabels[run.status]??run.status;
 const tone=run.status==='succeeded'?'success':run.status==='needs_attention'?'danger':['waiting_approval','waiting_event'].includes(run.status)?'warning':'info';
 return <section className={styles.execution} aria-label="运行工作台">
  <header className={styles.summary}>
   <div><span className={styles.eyebrow}>本次执行 · 冻结配置</span><div className={styles.summaryTitle}><h2>{run.document.nodes.find(n=>n.id===run.node_id)?.title??'工作流运行'}</h2><Badge tone={tone}>{status}</Badge></div><p>运行 {run.id.slice(0,8)} · revision {run.revision} · 第 {run.generation} 轮</p></div>
   <div className={styles.metrics}>{counts&&<><div><small>{counts.quotaMode?'订单达标候选':'需求达标候选'}</small><strong>{counts.qualified??'—'}{counts.quotaMode&&counts.limit!=null&&<span> / {counts.limit} 款</span>}</strong></div><div><small>实际读取商品</small><strong>{counts.scanned??'—'}<span> 款</span></strong></div></>}<div><small>流程位置</small><strong>{Math.min(run.cursor+1,run.document.nodes.length)}<span> / {run.document.nodes.length} 步</span></strong></div><div><small>当前阶段耗时</small><strong>{(progress?.elapsed??stageElapsed)!=null?durationLabel((progress?.elapsed??stageElapsed)!):'尚无记录'}</strong></div></div>
   {actions}
  </header>
  {run.error&&<div className={styles.problem} role="alert"><Icon name="warning"/><div><strong>运行问题 · 请先查看原因</strong><p>{run.error}</p></div></div>}
  {notice&&<p role="status" className={styles.notice}>{notice}</p>}
  <div className={styles.layout}>
   <div className={styles.canvas} data-run-canvas><div className={styles.canvasHeader}><span><Icon name="workflow" size={16}/>执行画布</span><small>只读冻结版本 · 点击节点查看本轮记录</small></div>{renderCanvas(selectedId,id=>setInspected(id===run.node_id?null:id))}<footer>连线回放服务端事件；等待与审批不会自动放行。</footer></div>
   <aside className={styles.inspector} aria-label="节点运行详情">
    <div className={styles.inspectorHeading}><small>{current?'当前执行步骤':'查看步骤 · 不改变执行位置'}</small><h3>{selected?.title??'节点详情'}</h3>{!current&&<Button compact variant="ghost" onClick={()=>setInspected(null)}>回到当前步骤</Button>}</div>
    <div className={styles.operations}>{children}</div>
    <div className={styles.tabs} role="tablist" aria-label="运行详情分类">{([['overview','进度'],['results','结果'],['events','事件']] as const).map(([id,label])=><Button key={id} role="tab" aria-selected={tab===id} aria-controls={`run-${run.id}-${id}`} id={`tab-${run.id}-${id}`} onClick={()=>setTab(id)}>{label}</Button>)}</div>
    <div className={styles.tabBody} role="tabpanel" id={`run-${run.id}-${tab}`} aria-labelledby={`tab-${run.id}-${tab}`}>
     {selected?.definitionId==='market.intelligence'&&intelligence&&<section><h4>本轮行情结果</h4><p>{intelligence.status==='skipped'?intelligence.reason:intelligence.status==='ready'?'两组榜单已读取，供货类目对应已核对':'方向发生变化，需要重新确认方案'}</p>{intelligence.mappings?.map(row=><p key={row.source_name}>{row.source_name} → {row.category_path}</p>)}{intelligence.snapshot&&<details open={tab==='results'}><summary>销售与广告两组前十</summary><IntelligenceResults snapshot={intelligence.snapshot}/></details>}</section>}
     {tab==='results'&&proposal?.algorithm==='product.opportunity.v5'&&!!proposal.ranked?.length&&<details open><summary>订单与刊登关注度 · 综合排名</summary><p className={styles.help}>订单45% · 刊登25% · 成本15% · 时效10% · 库存5%。刊登是关注度代理，不是销量或竞争商家数。</p><ul className={styles.rejections}>{proposal.ranked.map((row,index)=><li key={row.vid}><strong>#{index+1} · {row.pid??row.vid}</strong><small>规格 {row.vid}</small><p>综合分 {row.score} · 订单数 {row.order_count??'未知'} · 刊登次数 {row.listing_count??'未知'} · 刊登分 {row.listing_score??'未知'}</p></li>)}</ul></details>}
     {tab==='results'&&!!selection?.product_exclusions?.length&&<details open><summary>补位研究 · 未入选商品（{selection.product_exclusions.length} 款）</summary><ul className={styles.rejections}>{selection.product_exclusions.map(row=><li key={row.pid}><strong>{row.pid}</strong><p>{row.reason}</p>{row.specs?.map((spec,i)=><small key={spec.vid??i}>{spec.vid} · {spec.reason??'未通过'}</small>)}</li>)}</ul></details>}
     {tab==='results'&&Array.isArray(selection?.sales_ranking)&&<details open><summary>{selection.demand_metric==='order_count'?'本批商品 · CJ 订单数降序':'本批商品 · 近 90 天销量降序'}</summary><p className={styles.help}>CJ 平台需求指标，非目标国家销量。订单数的统计周期未声明，不是90天卖出件数；后续评分还考虑成本、时效和库存。</p><ul className={styles.rejections}>{selection.sales_ranking.map(row=><li key={row.pid}><strong>{row.pid}</strong><p>{selection.demand_metric==='order_count'?'CJ 订单数（周期未声明）':'近90天销量'}：{(selection.demand_metric==='order_count'?row.order_count:row.sales_90d)??'未知（CJ 未返回）'}{row.reason?` · ${row.reason}`:''}</p></li>)}</ul></details>}
     {tab==='overview'&&<>
      {current&&progress?<section className={styles.progress} aria-label="当前节点进度"><div className={styles.counter}><strong>{progress.completed}<span> / {progress.total||'待确认'}</span></strong><small>{progress.unit}</small></div><p role="status">{progress.summary}</p>{progress.total>0&&<progress aria-label={progress.title+'完成进度'} max={progress.total} value={progress.completed}/>}<p>{progress.activity}</p>{progress.current&&<p className={styles.current}>当前商品：{progress.current}</p>}<small>{progress.lastProgress?`最近完成：${new Date(progress.lastProgress).toLocaleTimeString('zh-CN')}`:'尚无本阶段完成记录'} · 每 2 秒同步</small></section>:<p className={styles.empty}>{current?status:last?`最近记录：${eventLabels[last.status]??last.status}`:'本轮尚无执行记录。'}{last&&<small>记录时间 {new Date(last.completed_at??last.created_at).toLocaleTimeString('zh-CN')}</small>}</p>}
      {selection&&<><h4>选品研究范围</h4><div className={styles.resultCount}><span>已采集商品<strong>{selection.records?.length??selection.collection?.products?.length??'—'}</strong></span><span>本轮研究规格<strong>{selection.specs?.length??'—'}</strong></span></div><p className={styles.help}>商品与规格分开计数；研究规格不等于可发布数量。</p></>}
      <h4>本轮步骤</h4><ol className={styles.steps}>{run.document.nodes.map((node,i)=>{const entry=(run.attempts??[]).filter(a=>a.node_id===node.id&&a.generation===run.generation).at(-1);const done=entry?.status==='completed';const active=node.id===run.node_id;return <li key={node.id}><Button variant="ghost" aria-pressed={selectedId===node.id} onClick={()=>setInspected(node.id)}><span className={styles.stepMark} data-state={active?'active':done?'done':'pending'}>{done?<Icon name="check" size={12}/>:String(i+1).padStart(2,'0')}</span><span>{node.title}<small>{active?status:done?'已完成':entry?eventLabels[entry.status]??entry.status:'尚无本轮记录'}</small></span></Button></li>;})}</ol>
     </>}
     {tab==='results'&&!business&&<><h4>本次运行结果</h4><p className={styles.help}>以下是运行级资料；不表示所选节点产出了全部结果。</p>{proposal?<><p>{proposal.phase==='research'||!proposal.basis?'当前是资料检查结果，尚未形成完整选品评分。':proposal.basis}</p>{proposal.warning&&<p>{proposal.warning}</p>}{Array.isArray(proposal.unknowns)&&<p>未知项：{proposal.unknowns.join('、')}</p>}<div className={styles.resultCount}><span>有评分的规格<strong>{proposal.ranked?.length??0}</strong></span><span>待研究 / 未通过<strong>{proposal.rejected?.length??0}</strong></span></div><dl className={styles.reasonSummary}>{[...exclusions].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([reason,count])=><div key={reason}><dt>{reason}</dt><dd>{count} 个规格</dd></div>)}</dl>{exclusions.size>0&&<p className={styles.help}>一个规格可能有多个原因，以上数量不能相加。</p>}<details open><summary>查看资料检查与待研究原因</summary><ul className={styles.rejections}>{proposal.rejected?.map((row,i)=><li key={`${row.pid}:${row.vid??i}`}><strong>待研究 / 未通过：{row.pid}</strong>{row.vid&&<small>规格 {row.vid}</small>}<p>{Array.isArray(row.reasons)?row.reasons.join('；'):'资料不足，请查看原始检查结果'}</p></li>)}</ul></details><details><summary>选品评分与原始结果</summary><pre>{JSON.stringify(proposal,null,2)}</pre></details></>:<p className={styles.empty}>尚无选品评估结果；未完成的研究不会显示为合格。</p>}{payload&&<Card className={styles.product}>{payload.images?.[0]&&<img src={payload.images[0]} alt={payload.title}/>}<div><strong>{payload.title}</strong><small>{payload.variants?.length??0} 个规格 · {payload.market} / {payload.currency}</small></div></Card>}<details><summary>查看已生成的业务资料</summary><pre>{JSON.stringify({brief:run.context.brief,listing:run.context.listing,published:run.context.published},null,2)}</pre></details></>}
     {tab==='results'&&business&&<><h4>本次业务执行结果</h4><p>回复、回执或素材包来自本轮持久化记录，不表示商品可售或真实邮件送达。</p><pre>{JSON.stringify(business,null,2)}</pre></>}
     {tab==='events'&&<><h4>所选节点的服务端事件</h4><ol className={styles.events}>{events.filter(e=>e.nodeId===selectedId).slice().reverse().map(e=><li key={e.sequence}><strong>{eventLabels[e.status]??e.status}</strong><time>{new Date(e.occurredAt).toLocaleTimeString('zh-CN')}</time><small>事件 #{e.sequence}</small></li>)}</ol>{!events.some(e=>e.nodeId===selectedId)&&<p className={styles.empty}>该节点尚无返回的事件记录。</p>}<p className={styles.help}>保留后端事件原始状态，不推测接口成功或预计剩余时间。</p></>}
    </div>
   </aside>
  </div>
 </section>;
}

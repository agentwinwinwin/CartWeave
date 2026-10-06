import type {BackendRun} from './backend-client';

export function durationLabel(seconds:number){
 const value=Math.max(0,Math.floor(seconds));
 return value<60?`${value} 秒`:`${Math.floor(value/60)} 分 ${value%60} 秒`;
}

/** Read persisted counters only. A ticking clock never advances business progress. */
export function runProgress(run:BackendRun|null,now:number){
 if(!run)return null;
 const node=run.document.nodes[run.cursor];
 const state=node?.definitionId==='product.collect'?run.context.selection:run.context.selection?.current_research??run.context.selection;
 if(!node||!state)return null;
 let completed=0,total=0,unit='款',verb='',current='';
 const records=Array.isArray(state.records)?state.records:[];
 const specs=Array.isArray(state.specs)?state.specs:[];
 const candidates=Array.isArray(state.candidates)?state.candidates:[];
 if(node.definitionId==='product.verify'){
  const verification=(run.context as {verification?:{phase:string;label?:string}}).verification;
  const research=run.context.selection as {records?:unknown[];research_index?:number}|undefined;
  total=research?.records?.length??records.length;
  completed=research?.research_index??0;verb=`统一核验${verification?.label?` · ${verification.label}`:''}`;
  current=records[0]?.nameEn||records[0]?.id||'';
 }else if(node.definitionId==='product.normalize'){
  total=records.length;completed=Array.isArray(state.facts)?state.facts.length:0;verb='已检查';
  current=records[completed]?.nameEn||records[completed]?.id||'';
 }else if(node.definitionId==='product.filter'){
  total=specs.length;completed=state.filter_index??0;unit='个规格';verb='已筛查';
  const row=specs[completed];current=row?`${row.product.title||row.product.pid} · ${row.variant.vid||'规格待核验'}`:'';
 }else if(node.definitionId==='product.delivery'){
  total=candidates.length;completed=state.delivery_index??0;unit='个规格';verb='已核验配送';
  const row=candidates[completed];current=row?`${row.title||row.pid} · ${row.vid}`:'';
 }else if(node.definitionId==='product.collect'){
  const demand=state.collection as {quota_limit?:number;demand_qualified?:number;scanned?:number;pending?:{id:string}[];pending_index?:number}|undefined;
  if(demand?.quota_limit){
   completed=demand.demand_qualified??0;total=demand.quota_limit;verb=`订单达标候选（已读取 ${demand.scanned??0} 款）`;
   current=demand.pending?.[demand.pending_index??0]?.id??'';
  }else if(state.collection?.scan_limit){
   completed=state.collection.scanned??0;total=state.collection.scan_limit;verb='已核验需求';
   current=state.collection.pending?.[state.collection.pending_index??0]?.id??'';
  }else{
  completed=state.collection?.products.length??records.length;
  const limit=run.document.nodes.find(n=>n.definitionId==='product.start')?.binding?.parameters?.limit;
  total=typeof limit==='number'?limit:0;verb='已采集';
  }
 }else if(run.context.batch_mode==='parent'&&['content.make','listing.validate','listing.publish','listing.wait'].includes(node.definitionId)){
  total=run.context.batch_meta?.target??0;
  completed=node.definitionId==='content.make'?run.context.batch_listings?.length??0:node.definitionId==='listing.validate'?run.context.batch_validations?.length??0:run.context.batch_meta?.published??0;
  verb=node.definitionId==='content.make'?'已整理内容':node.definitionId==='listing.validate'?'已检查渠道字段':'已确认可售';
 }else return null;
 completed=Math.max(0,Math.min(completed,total||completed));
 const attempts=(run.attempts??[]).filter(a=>a.node_id===node.id&&a.generation===run.generation);
 const first=attempts[0],latest=attempts.at(-1);
 const active=['running','queued'].includes(run.status);
 const end=active?now:Date.parse(latest?.completed_at||latest?.created_at||'');
 const start=Date.parse(first?.created_at||'');
 const elapsed=Number.isFinite(start)&&Number.isFinite(end)?Math.max(0,(end-start)/1000):null;
 const confirmed=attempts.filter(a=>a.completed_at&&['progress','completed'].includes(a.status)).at(-1);
 const lastProgress=confirmed?.completed_at;
 const idle=active&&lastProgress?Math.max(0,(now-Date.parse(lastProgress))/1000):null;
 return {title:node.title,completed,total,unit,current:active?current:'',active,elapsed,lastProgress,
  summary:`${run.context.batch_meta?`已合格 ${run.context.batch_meta.qualified} 款 · 最终选取 ${run.context.batch_meta.target} 款 · `:""}${verb} ${completed} / ${total||'待确认'} ${unit}${node.definitionId==='product.collect'&&state.collection?.excluded_existing?.length?`；已跳过同店铺已上架/提交中 ${state.collection.excluded_existing.length} 款`:''}`,
  activity:run.status==='needs_attention'?'已暂停，请查看原因':run.status==='cancelled'?'已取消':run.status==='queued'?'等待下一批执行':active?(idle!==null&&idle>30?'超过 30 秒没有新的完成记录，可能在等待接口；尚未确认故障':'正在读取并检查 CJ 资料（含请求间隔等待）'):'当前阶段已停止执行'};
}

/** Batch-wide source counters must not be read from the current SKU research. */
export function candidateCounts(run:BackendRun){
 const selection=run.context.selection;
 const source=selection?.collection??selection?.search;
 if(!source)return null;
 const limit=source.quota_limit??source.scan_limit;
 const qualified=source.demand_qualified;
 const scanned=source.scanned;
 if(limit==null&&qualified==null&&scanned==null)return null;
 return {qualified:qualified??null,scanned:scanned??null,limit:limit??null,quotaMode:source.quota_limit!=null};
}

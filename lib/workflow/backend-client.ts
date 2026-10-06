/** Real DRF client. Never falls back to browser simulation on API errors. */
export type BackendVariant={sku:string;size:string;cj_pid:string;cj_vid:string;price:string;inventory:number};
export type ProductBrief={schema_version:'ProductBrief@1';product_id:string;title:string;description:string;selling_points:string[];images:string[];currency:'USD';market:'US';variants:BackendVariant[];source_kind:'test_fixture'|'manual_evidence'|'cj_selection';evidence_ref:string;source_note:string};
export type ListingPayload={schema_version:'ListingDraft@1';product_id:string;title:string;description:string;bullets:string[];images:string[];currency:'USD';market:'US';variants:BackendVariant[]};
export type BackendApproval={id:string;stage:'brief'|'listing';status:string;run_revision:number;digest:string;snapshot:{payload:ProductBrief|ListingPayload;batch_items?:(ProductBrief|ListingPayload)[]};expires_at:string};
/** Research pauses and historical runs may have no completed scoring metadata. */
export type BackendSelectionProposal={phase?:'research';algorithm?:string;rejected?:{pid:string;vid?:string;reasons:string[]}[];basis?:string;warning?:string;unknowns?:string[];ranked:{pid?:string;vid:string;score:string;order_count?:number;listing_count?:number;listing_score?:string;suggested_price:string;contribution_before_ads:string}[]};
export type BackendCandidateCounters={scanned?:number|null;scan_limit?:number|null;quota_limit?:number|null;demand_qualified?:number|null};
export type BackendSelectionState={demand_metric?:'sales_90d'|'order_count';sales_ranking?:{pid:string;sales_90d?:number|null;order_count?:number|null;eligible:boolean;reason?:string|null}[];product_exclusions?:{pid:string;reason:string;specs?:{vid?:string;reason?:string}[]}[];current_research?:BackendSelectionState;records?:{id:string;nameEn?:string}[];facts?:unknown[];specs?:{product:{pid:string;title?:string};variant:{vid?:string}}[];filter_index?:number;delivery_index?:number;candidates?:{pid:string;vid:string;title?:string;status?:string}[];search?:BackendCandidateCounters;collection?:BackendCandidateCounters&{products:{id:string}[];pending?:{id:string}[];pending_index?:number;excluded_existing?:{pid:string;reason:string}[]}};
export type BackendAttempt={node_id:string;generation:number;status:string;created_at:string;completed_at:string|null};
export type BackendRun={id:string;workflow_version_id:string;status:string;cursor:number;node_id:string;revision:number;generation:number;sequence:number;document:{nodes:{id:string;definitionId:string;title:string;binding?:{parameters?:{approvalEnabled?:boolean;limit?:number}}}[];edges:{id:string;source:string;target:string;kind:'forward'}[]};created_at?:string;attempts?:BackendAttempt[];context:{batch_mode?:'parent';batch_meta?:{target:number;qualified:number;researched?:number;published?:number;failed?:number;shortfall?:boolean};batch_briefs?:ProductBrief[];batch_listings?:ListingPayload[];batch_validations?:{valid:boolean}[];batch_items?:{run_id:string;product_id:string;title:string;status:string;error:string;external_id?:string|null}[];archived_research?:{archived_at:string;checked:number;total:number;reason:string};selection?:BackendSelectionState;selection_proposal?:BackendSelectionProposal;brief?:ProductBrief;listing?:ListingPayload;published?:{external_id:string;product_id:string}};error:string;approvals:BackendApproval[]};
export type BackendNode={id:string;title:string;mode:string;input:string;output:string};
export type BackendStore={id:string;name:string;verified:boolean;active:boolean};
export type BackendSession={mode?:"desktop"|"team";authenticated:boolean;csrf_token:string;user:{username:string;role:string;team_id:string}|null};
export type BackendTemplate={document:Record<string,unknown>;skill_id:string;brief:ProductBrief};
export type BackendEvent={sequence:number;nodeId:string;status:string;edgeId?:string;occurredAt:string};
let csrfToken='';
export class BackendRequestError extends Error{
 nodeId?:string;
 constructor(public status:number,public payload:unknown){super(formatBackendError(payload));this.name='BackendRequestError';const detail=errorDetail(payload);if(detail&&typeof detail==='object'&&'node_id' in detail&&typeof detail.node_id==='string')this.nodeId=detail.node_id;}
}
function errorDetail(payload:unknown):unknown{let detail=payload;for(let i=0;i<4&&detail&&typeof detail==='object'&&'detail' in detail;i++)detail=(detail as {detail:unknown}).detail;return detail;}
function formatBackendError(payload:unknown):string{
 const detail=errorDetail(payload);
 if(typeof detail==='string')return detail;
 if(Array.isArray(detail))return detail.map(item=>item&&typeof item==='object'&&'message' in item?`${'field' in item?String(item.field)+'：':''}${String(item.message)}`:String(item)).join('；');
 if(detail&&typeof detail==='object'&&'message' in detail)return `${String(detail.message)}${'hint' in detail?' '+String(detail.hint):''}`;
 return `后端未通过检查：${JSON.stringify(detail)}`;
}
export async function backendRequest<T>(path:string,method='GET',body?:unknown):Promise<T>{
  if(method!=='GET'&&!csrfToken)await getBackendSession();
  let response:Response;
  try{response=await fetch(`/backend/v1/${path}`,{method,credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json',...(method!=='GET'?{'X-CSRFToken':csrfToken}:{})},body:body===undefined?undefined:JSON.stringify(body)});}catch{throw Error('后端无法连接，请启动 Django API 与 Worker。');}
  let data:unknown;try{data=await response.json();}catch{throw Error('后端响应异常，请检查 Django 服务。');}
  if(!response.ok)throw new BackendRequestError(response.status,data);
  return data as T;
}
export async function getBackendSession(){const session=await backendRequest<BackendSession>('auth/session');csrfToken=session.csrf_token;return session;}
/** Reuse one idempotency key while the old worker finishes its in-flight request. */
export async function startBackendRun(body:{version_id:string;store_id:string;idempotency_key:string;brief?:ProductBrief},onWaiting?:()=>void){
 for(let attempt=0;;attempt++){
  try{return await backendRequest<BackendRun>('runs','POST',body);}
  catch(error){
   if(!(error instanceof BackendRequestError)||error.status!==409||!error.message.includes('上一次运行正在停止')||attempt>=30)throw error;
   onWaiting?.();
   await new Promise(resolve=>setTimeout(resolve,2000));
  }
 }
}
export async function loginBackend(username:string,password:string){const result=await backendRequest<{csrf_token:string}>('auth/login','POST',{username,password});csrfToken=result.csrf_token;return getBackendSession();}

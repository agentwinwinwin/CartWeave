export type ImageProduct={id:string;product_id:string;title:string;description:string;images:string[];store_name:string;publication_id:string};
export type ImageAsset={id:string;product_index:number;shot_index:number;url:string;digest:string;width:number;height:number};
export type ImagePlan={plan:{schema_version:'ProductImagePlan@2';shots:{prompt:string;preserve:string[];forbidden_changes:string[]}[];questions:string[]};usage:{harness?:{version:string}}};
export type ImageBatch={id:string;design_id:string;revision:number;status:string;error:string;cursor:number;products:ImageProduct[];plans:ImagePlan[];assets:ImageAsset[];pack:Record<string,unknown>;configuration:{images_per_product:number;usage:string;size:string;quality:string;requirements:string;planner_id:string;generator_id:string;design_snapshot:WorkflowDocument}};
export const imageStatusNames:Record<string,string>={planning_queued:'等待制作方案',planning:'Pi 正在制定方案',plan_ready:'方案待确认',needs_info:'方案需要补充资料',generating:'Sunburst 正在生图',review:'图片待检查确认',delivered:'素材包已交付',failed:'执行失败',unknown:'结果需核对',stopping:'正在安全停止',cancelled:'已停止'};
export const imageBusy=(status:string)=>['planning_queued','planning','generating','stopping'].includes(status);
export function imageStage(status:string){return ['planning_queued','planning','plan_ready','needs_info'].includes(status)?1:status==='generating'?2:status==='review'?3:status==='delivered'?5:0;}
import type {WorkflowDocument} from '@/lib/workflow/universal';

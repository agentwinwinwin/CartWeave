import {backendRequest} from './backend-client';
export type TimerFrequency='daily'|'weekly'|'interval'|'continuous';
export type TimerConfig={name:string;release_id:string;frequency:TimerFrequency;timezone:string;clock:string;weekdays:number[];interval_hours:number;enabled:boolean};
export type TimerHistory={id:string;scheduled_at:string;status:string;reason:string;run_id:string|null;run_status:string|null;release_revision:number};
export type WorkflowTimer=TimerConfig & {id:string;revision:number;workflow_title:string;release_revision:number;next_due_at:string|null;last_error:string;last_run_id:string|null;last_polled_at:string|null;pending_messages:number;attention_messages:number;completed_messages:number;history:TimerHistory[]};
export type TimerOverview={schedules:WorkflowTimer[];releases:{id:string;title:string;revision:number;store_name:string;scope:string;input_mode:string|null;reply_policy:string|null}[];dispatcher:{last_seen_at:string|null;online:boolean}};
export const scheduleClient={list:()=>backendRequest<TimerOverview>('schedules'),create:(config:TimerConfig)=>backendRequest<WorkflowTimer>('schedules','POST',config),update:(id:string,revision:number,patch:Partial<TimerConfig>)=>backendRequest<WorkflowTimer>(`schedules/${id}`,'PATCH',{...patch,expected_revision:revision})};

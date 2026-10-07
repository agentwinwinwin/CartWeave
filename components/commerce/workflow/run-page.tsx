'use client';
import {useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';
import {backendRequest,type BackendRun} from '@/lib/workflow/backend-client';
import type {FrozenDesign} from '@/lib/workflow/saved-config';
import {Card} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {LiveWorkflow} from './live-workflow';
import {BusinessRun} from './business-run';
import {WorkflowCanvas} from './workspace';
import {toWorkflowPreview} from '@/lib/workflow/universal';

/** Timer history must restore its exact business run, never create a new one. */
export function WorkflowRunPage(){
 const router=useRouter();
 const [result,setResult]=useState<{id:string;release:FrozenDesign}|null>(null),[loaded,setLoaded]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let alive=true;const id=new URLSearchParams(window.location.search).get('run');
  if(!id){setLoaded(true);return;}
  void (async()=>{const run=await backendRequest<BackendRun&{release_id:string|null;document:BackendRun['document']&{templateId:string}}>(`runs/${encodeURIComponent(id)}`);
   if(['support','product-images','fulfillment'].includes(run.document.templateId)){
    if(!run.release_id)throw Error('缺少原冻结版本引用，不能恢复。');
    const release=await backendRequest<FrozenDesign>(`workflow-releases/${run.release_id}`);
    if(release.version_id!==run.workflow_version_id)throw Error('冻结版本不匹配，未启动其他任务。');
    if(alive)setResult({id,release});
   }
  })().catch(e=>{if(alive)setError(e instanceof Error?e.message:'读取运行失败');}).finally(()=>{if(alive)setLoaded(true);});
  return()=>{alive=false;};
 },[]);
 if(error)return <Card><p role="alert">{error}</p><Button onClick={()=>router.push('/schedules')}>返回定时器</Button></Card>;
 if(!loaded)return <Card>正在读取原运行…</Card>;
 if(!result)return <LiveWorkflow/>;
 return <BusinessRun release={result.release} initialRunId={result.id} onRunIdChange={()=>{}} onExit={()=>router.push('/schedules')}
  renderCanvas={(view,id,onSelect)=><WorkflowCanvas executionMode flow={toWorkflowPreview(result.release.document)} run={view} configs={{}} selectedId={id} onSelect={node=>onSelect(node.id)}/>}/>;
}

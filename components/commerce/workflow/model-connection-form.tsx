'use client';
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {SelectField} from '@/components/ui/select-field';
import {backendRequest} from '@/lib/workflow/backend-client';
import {modelProtocols,type ModelConnection} from '@/lib/workflow/model-connections';
import styles from './interface-mapping.module.css';

/** Shared by workflow-level configuration and first-time interface analysis. */
export function ModelConnectionForm({model,initial,onSaved,onCancel}:{model?:ModelConnection;initial?:Partial<ModelConnection>;onSaved:(model:ModelConnection)=>void;onCancel:()=>void}){
  const [form,setForm]=useState(()=>({name:model?.name??initial?.name??'',protocol:model?.protocol??initial?.protocol??modelProtocols[0].id,base_url:model?.base_url??initial?.base_url??modelProtocols[0].baseUrl,model_id:model?.model_id??initial?.model_id??'',api_key:''}));
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function save(){
    setBusy(true);setError('');
    try{
      const saved=await backendRequest<ModelConnection>(model?`model-connections/${model.id}`:'model-connections',model?'PUT':'POST',{...form,name:form.name.trim(),model_id:form.model_id.trim(),base_url:form.base_url.trim()});
      setForm(current=>({...current,api_key:''}));onSaved(saved);
    }catch(e){setError(e instanceof Error?e.message:'模型配置未保存');}
    finally{setBusy(false);}
  }
  return <form className={styles.modelForm} onSubmit={e=>{e.preventDefault();void save();}} aria-label={model?'编辑大模型 API':'添加大模型 API'}>
    <h3>{model?'编辑大模型 API':'添加大模型 API'}</h3>
    <div className={styles.fields}>
      <label>显示名称<Input aria-label="模型显示名称" required maxLength={80} disabled={busy} value={form.name} onChange={e=>setForm(v=>({...v,name:e.target.value}))}/></label>
      <label>调用协议<SelectField aria-label="调用协议" disabled={busy} value={form.protocol} onChange={e=>setForm(v=>({...v,protocol:e.target.value,base_url:modelProtocols.find(p=>p.id===e.target.value)!.baseUrl}))}>{modelProtocols.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</SelectField></label>
      <label>API 基础地址<Input aria-label="API 基础地址" required type="url" maxLength={300} disabled={busy} value={form.base_url} onChange={e=>setForm(v=>({...v,base_url:e.target.value}))}/></label>
      <label>模型 ID<Input aria-label="模型 ID" required maxLength={120} disabled={busy} placeholder="填写服务商实际提供的模型 ID" value={form.model_id} onChange={e=>setForm(v=>({...v,model_id:e.target.value}))}/></label>
      <label>API Key<Input aria-label="模型 API Key" type="password" autoComplete="new-password" maxLength={1000} disabled={busy} placeholder={model?'留空保留原密钥':'本地无鉴权兼容服务可留空'} value={form.api_key} onChange={e=>setForm(v=>({...v,api_key:e.target.value}))}/></label>
    </div>
    <p className={styles.muted}>{modelProtocols.find(p=>p.id===form.protocol)?.examples}。支持协议不代表所有模型 ID 都可用，具体以服务商权限为准。</p>
    <p className={styles.muted}>只填写基础地址，不附带密钥或查询参数。本机桌面模式可使用 localhost 的兼容服务。密钥由后端加密保管，不存入浏览器缓存、流程参数或导出文件。</p>
    <p className={styles.muted}>保存仅登记连接，不调用模型、不测试额度、不代表映射完成；发送接口资料时才会调用所选模型服务。</p>
    <div className={styles.actions}><Button variant="primary" type="submit" disabled={busy}>{busy?'保存中…':'保存模型'}</Button><Button type="button" disabled={busy} onClick={onCancel}>取消</Button></div>
    {error&&<p role="alert" className={styles.notice}>{error}</p>}
  </form>;
}

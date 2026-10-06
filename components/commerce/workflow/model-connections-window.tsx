'use client';
import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {Badge} from '@/components/ui/badge';
import {backendRequest} from '@/lib/workflow/backend-client';
import {modelProtocolLabel,type ModelConnection} from '@/lib/workflow/model-connections';
import {ModelConnectionForm} from './model-connection-form';
import shared from './workflow.module.css';
import fields from './interface-mapping.module.css';
import dialog from './channel-manager.module.css';

export function ModelConnectionsWindow({onClose}:{onClose:()=>void}){
  const ref=useRef<HTMLDialogElement>(null);
  const [models,setModels]=useState<ModelConnection[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [editing,setEditing]=useState<ModelConnection|undefined>(),[showForm,setShowForm]=useState(false);
  const requestSerial=useRef(0);
  async function load(){const serial=++requestSerial.current;setLoading(true);setError('');try{const rows=await backendRequest<ModelConnection[]>('model-connections');if(serial===requestSerial.current){setModels(rows);if(!rows.length)setShowForm(true);}}catch(e){if(serial===requestSerial.current)setError(e instanceof Error?e.message:'读取失败');}finally{if(serial===requestSerial.current)setLoading(false);}}
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;ref.current?.showModal();void load();return()=>{requestSerial.current++;previous?.focus();};},[]);
  return createPortal(<dialog ref={ref} className={`${shared.dialog} ${dialog.dialog}`} style={{width:'min(860px, calc(100vw - 32px))'}} aria-label="大模型 API 配置" onCancel={onClose}>
    <header className={shared.dialogHeader}><div><h2>大模型 API</h2><p>工作区共用连接 · 不写入商品任务或冻结流程</p></div><Button onClick={onClose} aria-label="关闭大模型配置">关闭</Button></header>
    <div className={shared.dialogBody} style={{overflowY:'auto',minHeight:0}}>
      <p className={fields.muted}>这里管理工作区共用模型连接。在运营助手或“准备渠道发布数据 → 首次分析接口”中明确发送，才会通过 Pi harness 调用模型。已配置连接不代表映射已完成，日常测试站发布仍使用固定适配代码。</p>
      <div className={fields.actions}><Button onClick={()=>{setEditing(undefined);setShowForm(true);setNotice('');}}>＋ 添加模型</Button><Button disabled={loading||showForm} onClick={()=>void load()}>刷新列表</Button></div>
      {loading&&<p role="status">正在读取已保存模型…</p>}
      {error&&<p role="alert" className={fields.notice}>{error} <Button disabled={loading||showForm} onClick={()=>void load()}>重新读取</Button></p>}
      {!loading&&!error&&!models.length&&<p className={fields.muted}>尚未配置模型。添加后可在首次接口分析中选择。</p>}
      <div className={fields.main} style={{marginTop:16}}>{models.map(model=><Card key={model.id} className={fields.panel}><div className={fields.heading}><h3>{model.name}</h3><Button disabled={showForm} onClick={()=>{setEditing(model);setShowForm(true);setNotice('');}}>编辑</Button></div><p>{model.model_id} · {modelProtocolLabel(model.protocol)}</p><p className={fields.muted} style={{overflowWrap:'anywhere'}}>{model.base_url}</p><Badge>{model.has_key?'密钥已保存':'未保存密钥'}</Badge></Card>)}</div>
      {showForm&&<ModelConnectionForm key={editing?.id??'new'} model={editing} onCancel={()=>{setShowForm(false);setEditing(undefined);}} onSaved={saved=>{setModels(rows=>[saved,...rows.filter(m=>m.id!==saved.id)]);setEditing(undefined);setShowForm(false);setNotice('模型已保存到后端，可在首次接口分析中选择；尚未调用模型或完成映射。');}}/>}
      {notice&&<p role="status" className={fields.notice}>{notice}</p>}
    </div>
  </dialog>,document.body);
}

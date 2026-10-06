'use client';
import {useState,type ReactNode} from 'react';
import Link from 'next/link';
import {Button} from '@/components/ui/button';
import {SelectField} from '@/components/ui/select-field';
import {backendRequest} from '@/lib/workflow/backend-client';
import {resolveSyncStore,type BusinessStore} from '@/lib/business';
import styles from './business-sync-bar.module.css';

export function BusinessSyncBar({kind,stores,store,onStoreChange,onUpdated,refreshAction}:{kind:'orders'|'customers'|'finance';stores:BusinessStore[];store:string;onStoreChange:(value:string)=>void;onUpdated:()=>void;refreshAction?:ReactNode}){
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const selected=resolveSyncStore(stores,store);
 async function act(){
  if(!selected||busy)return;setBusy(true);setNotice('');
  try{
   const r=await backendRequest<{received:number;has_more:boolean}>(`stores/${selected.id}/sync/${kind}`,'POST',{});setNotice(`已同步 ${r.received} 条。${r.has_more?'还有后续记录，请继续同步。':'已读到当前来源末尾。'}`);
   onUpdated();
  }catch(e){setNotice(e instanceof Error?e.message:'接口同步失败，未回退示例数据。');}
  finally{setBusy(false);}
 }
 return <div className={styles.sync}><div className={styles.controls}>{refreshAction}{stores.length>1&&<SelectField aria-label="同步店铺" value={store} disabled={busy} onChange={e=>{onStoreChange(e.target.value);setNotice('');}}><option value="">全部店铺 · 请选择同步对象</option>{stores.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</SelectField>}<Button compact disabled={!selected||busy||!selected.readable} onClick={()=>void act()}>{busy?'同步中…':selected?.has_more?'同步下一页':'同步数据'}</Button>{(!stores.length||selected&&!selected.readable)&&<Link href="/workflow/builder" className={styles.connection}>店铺接入 ↗</Link>}</div><small className={styles.meta}>{selected?.synced_at?`最近同步 ${new Date(selected.synced_at).toLocaleString('zh-CN')}`:selected&&!selected.readable?'读取能力待验收':selected?'尚未同步':stores.length>1?'选择一家店铺同步':'尚未接入店铺'}</small>{notice&&<span role="status" className={styles.notice}>{notice}</span>}</div>;
}

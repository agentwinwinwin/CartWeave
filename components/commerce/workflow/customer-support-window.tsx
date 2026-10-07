'use client';
import {useEffect,useRef} from 'react';
import {createPortal} from 'react-dom';
import {Button} from '@/components/ui/button';
import {OperationsArchive} from '@/components/commerce/operations/operations-archive';
import shared from './workflow.module.css';

/** Real model execution, not a WorkflowRun or a channel-send authorization. */
export function CustomerSupportWindow({onClose,onConfigure}:{onClose:()=>void;onConfigure:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;dialog.current?.showModal();return()=>previous?.focus();},[]);
 return createPortal(<dialog ref={dialog} className={shared.dialog} style={{width:'min(1180px, calc(100vw - 32px))'}} aria-label="智能客服节点执行" onCancel={onClose}>
  <header className={shared.dialogHeader}><div><h2>智能客服 · 知识检索与回复</h2><p>复用店铺收件箱、政策与订单资料；确认后真实写入测试站并回查。不发送邮件或执行退款。</p></div><Button onClick={onClose}>关闭</Button></header>
  <div className={shared.dialogBody}><Button compact onClick={onConfigure}>查看流程节点配置</Button><OperationsArchive kind="support" embedded/></div>
 </dialog>,document.body);
}

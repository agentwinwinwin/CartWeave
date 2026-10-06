'use client';
import {useEffect,useRef} from 'react';
import {createPortal} from 'react-dom';
import {Button} from '@/components/ui/button';
import {AgentConversation} from '@/components/commerce/agents/agent-conversation';
import shared from './workflow.module.css';

/** Real model execution, not a WorkflowRun or a channel-send authorization. */
export function CustomerSupportWindow({onClose,onConfigure}:{onClose:()=>void;onConfigure:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;dialog.current?.showModal();return()=>previous?.focus();},[]);
 return createPortal(<dialog ref={dialog} className={shared.dialog} style={{width:'min(1180px, calc(100vw - 32px))'}} aria-label="智能客服节点执行" onCancel={onClose}>
  <header className={shared.dialogHeader}><div><h2>智能客服生成回复</h2><p>系统客服 Skill · 可选择已配置模型 · 回复按 SupportReply@1 校验并保存在客服会话中，不自动写入流程或发送。</p></div><Button onClick={onClose}>关闭</Button></header>
  <div className={shared.dialogBody}><Button compact onClick={onConfigure}>查看流程节点配置</Button><AgentConversation fixedPurpose="customer_support" embedded/></div>
 </dialog>,document.body);
}

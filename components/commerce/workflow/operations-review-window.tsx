'use client';
import {useEffect,useRef} from 'react';
import {createPortal} from 'react-dom';
import {Button} from '@/components/ui/button';
import {OperationsArchive} from '@/components/commerce/operations/operations-archive';
import shared from './workflow.module.css';
export function OperationsReviewWindow({onClose,onConfigure}:{onClose:()=>void;onConfigure:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;dialog.current?.showModal();return()=>previous?.focus();},[]);
 return createPortal(<dialog ref={dialog} className={shared.dialog} style={{width:'min(1180px, calc(100vw - 32px))'}} aria-label="经营复盘节点" onCancel={onClose}><header className={shared.dialogHeader}><div><h2>经营复盘与调整建议</h2><p>核算真实已同步数据并归档。当前只读，不执行自动调整或整个复盘 DAG。</p></div><Button onClick={onClose}>关闭</Button></header><div className={shared.dialogBody}><Button compact onClick={onConfigure}>查看原节点配置</Button><OperationsArchive kind="reviews" embedded/></div></dialog>,document.body);
}

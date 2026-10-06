"use client";
import {useEffect,useRef,useState} from "react";
import {createPortal} from "react-dom";
import {Button} from "@/components/ui/button";
import {InterfaceMapping,type MappingSession} from "./interface-mapping";
import {StorePublishingSetup} from './store-publishing-setup';
import type {WorkflowDocument} from '@/lib/workflow/universal';
import styles from "./workflow.module.css";
import fields from "./channel-manager.module.css";

export function MappingNodeWindow({channel,sessionRef,document,onConfigureStore,onApplyDraft,onClose}:{channel:string;sessionRef?:string;document:WorkflowDocument;onConfigureStore:()=>void;onApplyDraft:(session:MappingSession)=>void;onClose:()=>void}){
  const ref=useRef<HTMLDialogElement>(null);
  const [mode,setMode]=useState(sessionRef?'analysis':'installed');
  useEffect(()=>{const previous=window.document.activeElement as HTMLElement|null;ref.current?.showModal();return()=>previous?.focus();},[]);
  return createPortal(<dialog ref={ref} className={`${styles.dialog} ${fields.dialog} ${fields.storeDialog}`} style={{width:'min(1280px, calc(100vw - 32px))'}} aria-label="接口字段映射节点" onCancel={onClose}>
    <header className={styles.dialogHeader}><div><h2>准备渠道发布数据</h2><p>可调参数 · 执行映射、检查必填字段 · 不发送发布请求</p></div><Button onClick={onClose} aria-label="关闭映射节点">关闭</Button></header>
    <div className={styles.dialogBody} style={{overflowY:'auto',minHeight:0}}><nav className={styles.tabs} aria-label="接口接入方式"><Button aria-pressed={mode==='installed'} onClick={()=>setMode('installed')}>继承接入方案</Button><Button aria-pressed={mode==='analysis'} onClick={()=>setMode('analysis')}>首次分析接口</Button></nav>{mode==='installed'?<StorePublishingSetup document={document} readOnly onConfigureStore={onConfigureStore}/>:<><p>这是一次性接口开发分析，不是运行方案。完成开发与安装后，到“配置店铺接入”验收并保存，准备节点自动继承。</p><InterfaceMapping embedded initialChannel={channel} initialSessionRef={sessionRef} onApplyDraft={onApplyDraft}/></>}</div>
  </dialog>,window.document.body);
}

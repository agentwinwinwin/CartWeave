"use client";
import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Button} from '@/components/ui/button';
import type {WorkflowDocument} from '@/lib/workflow/universal';
import {Card} from '@/components/ui/card';
import {inheritedPublishingPlan} from '@/lib/workflow/store-publishing';
import {LiveWorkflow} from './live-workflow';
import styles from './workflow.module.css';
import layoutStyles from './interface-mapping.module.css';
import fields from './channel-manager.module.css';
export function PublishingNodeWindow({document,onConfigure,onClose}:{document:WorkflowDocument;onConfigure:()=>void;onClose:()=>void}){
 const ref=useRef<HTMLDialogElement>(null),[testStore,setTestStore]=useState('');
 let plan:ReturnType<typeof inheritedPublishingPlan>|undefined,error='';
 try{plan=inheritedPublishingPlan(document);}catch(e){error=e instanceof Error?e.message:'准备方案未配置';}
 useEffect(()=>{const previous=window.document.activeElement as HTMLElement|null;ref.current?.showModal();return()=>previous?.focus();},[]);
 return createPortal(<dialog ref={ref} className={`${styles.dialog} ${fields.dialog} ${fields.storeDialog}`} style={{width:'min(1280px, calc(100vw - 32px))'}} aria-label="提交渠道发布节点" onCancel={onClose}>
  <header className={styles.dialogHeader}><div><h2>提交渠道发布</h2><p>发送准备好的请求，处理提交回执。店铺、适配包和商品数据全部继承上游，不重复配置。</p></div><Button aria-label="关闭发布节点" onClick={onClose}>关闭</Button></header>
  <div className={`${styles.dialogBody} ${layoutStyles.main}`} style={{overflowY:'auto',minHeight:0}}><Card className={layoutStyles.panel}><h3>继承准备节点 · 只读</h3>{plan?<dl className={layoutStyles.facts}><div><dt>发布店铺</dt><dd>{plan.name}</dd></div><div><dt>映射 / 适配包</dt><dd>{plan.package} · v{plan.version}</dd></div><div><dt>店铺连接版本</dt><dd>{plan.storeVersion}</dd></div></dl>:<p role="alert">{error}</p>}<Button onClick={onConfigure}>前往准备节点配置</Button></Card><Card className={layoutStyles.panel}><h3>提交规则</h3><p>只有完整、通过检查且绑定批准摘要的请求才能发送。缺少字段返回准备节点补充事实；不会调用模型猜值。</p><p>结果未知先使用原操作标识查询，避免重复上架。已接受 / 处理中不等于可售，交给下一节点确认。</p><p>当前画布仅为设计与模拟，尚未执行 PreparedChannelPublication 契约。</p></Card><details><summary>旧七步测试站主线联调（不是本图运行）</summary><p>复用后端既有测试链路，不用于证明准备节点已执行映射。</p><Button disabled={!plan||document.environment.channel!=='test-store'} onClick={()=>{if(plan)setTestStore(plan.storeRef);}}>打开真实发布联调</Button>{testStore&&<section aria-label="真实发布联调"><h3>真实发布联调 · 测试商品</h3><p>后端合成商品与两轮审批；会新增本地测试商品，不涉及采购、付款或发货。</p><LiveWorkflow key={testStore} embedded initialStoreId={testStore} testFixtureOnly/></section>}</details></div>
 </dialog>,window.document.body);
}

"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { getDefinition, storeActionIds, type ExecutionEnvironment,type WorkflowDocument } from "@/lib/workflow/universal";
import {StorePublishingSetup} from './store-publishing-setup';
import styles from "./workflow.module.css";
import fields from "./channel-manager.module.css";
import {PublishingSkillSetup,type ApiMode} from "./publishing-skill-setup";
import {IntegrationFlow} from "./integration-flow";
import {IntegrationSkillEntries} from "../skills/integration-skill-entries";

export function StoreConnection({ environment, document,onSaveInstalled,onApply, onClose,onConfigureMapping }: { environment: ExecutionEnvironment; document:WorkflowDocument;onSaveInstalled:(next:WorkflowDocument)=>Promise<void>;onApply: (value: ExecutionEnvironment) => void; onClose: () => void;onConfigureMapping?:()=>void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [mounted, setMounted] = useState(false);
  const [name, setName] = useState(environment.storeIntegration?.name ?? "我的店铺");
  const [reference, setReference] = useState(environment.storeRef ?? "");
  const [version, setVersion] = useState(environment.storeIntegration?.version ?? "0.1.0");
  const [actions, setActions] = useState(environment.storeIntegration?.actions ?? [...storeActionIds]);
  const [apiMode,setApiMode]=useState<ApiMode>(environment.storeIntegration?.apiMode??"existing-api");
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => { if (!mounted) return; const previous = window.document.activeElement as HTMLElement | null; dialog.current?.showModal(); return () => previous?.focus(); }, [mounted]);
  if (!mounted) return null;
  return createPortal(<dialog ref={dialog} className={`${styles.dialog} ${fields.dialog} ${fields.storeDialog}`} aria-labelledby="store-connection-title" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <header className={styles.dialogHeader}><div><span className={styles.eyebrow}>ONE CONNECTION / MULTIPLE ACTIONS</span><h2 id="store-connection-title">店铺接入</h2><p>接口只接入一次，上架、订单与复盘按能力复用。</p></div><Button variant="ghost" aria-label="关闭店铺接入" onClick={onClose}>×</Button></header>
    <form className={fields.storeForm} onSubmit={event => { event.preventDefault(); onApply({ ...environment, storeRef: reference.trim(), storeIntegration: { channel: environment.channel, name: name.trim(), version: version.trim(), actions, status: "draft",apiMode } }); onClose(); }}>
      <div className={`${styles.dialogBody} ${fields.body}`}>
        <StorePublishingSetup document={document} onApply={onSaveInstalled}/>
        <div className={fields.storeStatus}><Badge>一次接入 · 跨流程复用</Badge><span>真实连接由后端保存，流程只存引用，不存密钥。</span></div>
        <IntegrationSkillEntries channel={environment.channel} actions={actions} onConfigureMapping={onConfigureMapping}/>
        <details><summary>查看接入流程</summary><IntegrationFlow channel={environment.channel}/></details>
        <details><summary>高级：接口开发声明（不代替真实接入）</summary>
        <section aria-labelledby="store-basics-title"><h3 id="store-basics-title">连接信息</h3><div className={`${fields.fields} ${fields.storeFields}`}><label>店铺名称<Input required maxLength={80} aria-label="接入店铺名称" value={name} onChange={event => setName(event.target.value)} /></label><label>接口包版本<Input required maxLength={40} aria-label="接口包版本" value={version} onChange={event => setVersion(event.target.value)} /></label><label className={fields.connectionField}>连接引用<Input required maxLength={120} pattern="[a-zA-Z0-9._:/-]+" aria-label="统一店铺连接引用" value={reference} placeholder="例如 store/my-shop" onChange={event => setReference(event.target.value)} /><small>填写后端连接记录的标识，不是网站地址、API Key 或密码。</small></label></div></section>
        <fieldset className={fields.group}><legend>店铺能力 <span className={fields.capabilityCount}>已选 {actions.length} / {storeActionIds.length}</span></legend><p>勾选要对接的动作，后续流程共用接口包与连接；勾选不代表已经实现。</p><div className={`${fields.capabilities} ${fields.storeCapabilities}`}>{storeActionIds.map(id => <label key={id} className={fields.checkboxLabel}><Input className={fields.checkbox} type="checkbox" checked={actions.includes(id)} onChange={() => setActions(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])} /><span>{getDefinition(id)?.title}<small>{id}</small></span></label>)}</div></fieldset>
        <Button type="submit" disabled={!name.trim()||!reference.trim()||!version.trim()||!actions.length}>应用开发声明（不接通）</Button></details>
        <details className={fields.setupGuide}><summary><span>还没有接口包？查看制作与接入指南<small>选择接口类型，下载规则 Skill 和所选能力的契约。</small></span></summary><PublishingSkillSetup showFlow={false} channel={environment.channel} mode={apiMode} onModeChange={setApiMode} actions={actions}/><p className={styles.muted}>生成代码不等于接通。接口部署后，仍需后端验收身份、权限、字段、幂等和事件回调。</p></details>
        <p className={styles.muted}>CJ、广告平台、采购付款、仓库履约及售后执行可能依赖不同服务，不会自动继承店铺连接。写广告词 / 素材与生成广告词 / 素材也是不同能力；内容生成策略仍在对应节点配置。</p>
      </div><footer className={styles.dialogFooter}><span>在上方保存店铺与接口包，准备节点自动继承；不修改旧运行。</span><Button type="button" onClick={onClose}>关闭</Button></footer>
    </form>
  </dialog>, window.document.body);
}

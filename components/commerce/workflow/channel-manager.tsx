"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";
import { builtinChannels, validateSalesChannel, type SalesChannelDefinition } from "@/lib/workflow/channels";
import workflowStyles from "./workflow.module.css";
import styles from "./channel-manager.module.css";

type Fulfillment = SalesChannelDefinition["fulfillments"][number];
type ChannelKind = SalesChannelDefinition["kind"];

const kindNames: Record<ChannelKind, string> = {
  storefront: "独立站 / 自有店铺",
  marketplace: "电商平台",
  social: "社交电商",
  custom: "其他 / 自定义",
};
const fulfillments: { id: Fulfillment; name: string; detail: string }[] = [
  { id: "supplier", name: "供应商代发", detail: "由供应商负责订单发运" },
  { id: "merchant", name: "商家 / 仓库发货", detail: "自有仓库或第三方仓履约" },
  { id: "platform", name: "平台负责履约", detail: "本流程只观察平台履约状态" },
];
const capabilities = [
  { id: "read", name: "读取业务数据" },
  { id: "artifact", name: "产出文档与素材" },
  { id: "remote_write", name: "发布 / 更新平台数据" },
  { id: "spend", name: "采购 / 预算支出" },
  { id: "message", name: "发送消息" },
] as const;
const presets: { id: string; name: string; kind: ChannelKind }[] = [
  { id: "ebay", name: "eBay", kind: "marketplace" },
  { id: "tiktok-shop", name: "TikTok Shop", kind: "social" },
  { id: "woocommerce", name: "WooCommerce", kind: "storefront" },
  { id: "walmart", name: "Walmart", kind: "marketplace" },
];

export type ChannelManagerProps = {
  channels: SalesChannelDefinition[];
  selectedId: string;
  initialTab?: "existing" | "add";
  onSelect: (id: string) => void;
  onAdd: (definition: SalesChannelDefinition) => void;
  onClose: () => void;
};

export function ChannelManager({ channels, selectedId, initialTab = "existing", onSelect, onAdd, onClose }: ChannelManagerProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [mounted, setMounted] = useState(false);
  const [tab, setTab] = useState<"existing" | "add">(initialTab);
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [kind, setKind] = useState<ChannelKind>("custom");
  const [supported, setSupported] = useState<Fulfillment[]>(["merchant"]);
  const [defaultFulfillment, setDefaultFulfillment] = useState<Fulfillment>("merchant");
  const [selectedCapabilities, setSelectedCapabilities] = useState<string[]>(["read"]);
  const [generateAssets, setGenerateAssets] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (!mounted) return;
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => { previous?.focus(); };
  }, [mounted]);

  const toggleFulfillment = (value: Fulfillment) => {
    const next = supported.includes(value) ? supported.filter(item => item !== value) : [...supported, value];
    setSupported(next);
    if (!next.includes(defaultFulfillment)) setDefaultFulfillment(next[0] ?? "merchant");
    setErrors([]);
  };
  const toggleCapability = (value: string) => {
    setSelectedCapabilities(current => current.includes(value) ? current.filter(item => item !== value) : [...current, value]);
    setErrors([]);
  };
  const add = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const channelId = id.trim();
    const channel: SalesChannelDefinition = {
      id: channelId,
      name: name.trim(),
      kind,
      fulfillments: supported,
      defaultFulfillment,
      capabilities: [...selectedCapabilities.map(capability => `${channelId}.${capability}`), ...(generateAssets ? ["assets.generate"] : [])],
      adapterStatus: "draft",
    };
    const existingCustomChannels = channels.filter(item => !builtinChannels.some(builtin => builtin.id === item.id));
    const issues = validateSalesChannel(channel, existingCustomChannels);
    if (existingCustomChannels.length >= 50) issues.push("当前草稿最多保存 50 个自定义渠道，请先整理已有定义。");
    if (issues.length) { setErrors(issues); return; }
    onAdd(channel);
  };

  if (!mounted) return null;
  return createPortal(
    <dialog
      ref={dialog}
      className={`${workflowStyles.dialog} ${styles.dialog}`}
      aria-labelledby="channel-manager-title"
      onCancel={event => { event.preventDefault(); onClose(); }}
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    >
      <header className={workflowStyles.dialogHeader}>
        <div>
          <span className={workflowStyles.eyebrow}>SALES CHANNELS / 通用业务环境</span>
          <h2 id="channel-manager-title">销售渠道</h2>
          <p>渠道决定实现的适用范围，不重新创建业务流程。</p>
        </div>
        <Button variant="ghost" aria-label="关闭销售渠道窗口" onClick={onClose}>×</Button>
      </header>
      <nav className={workflowStyles.tabs} aria-label="销售渠道管理分区">
        <Button variant="ghost" aria-pressed={tab === "existing"} onClick={() => setTab("existing")}>已有渠道 · {channels.length}</Button>
        <Button variant="ghost" aria-pressed={tab === "add"} onClick={() => setTab("add")}>＋ 添加销售渠道</Button>
      </nav>
      <form onSubmit={add}>
        <div className={`${workflowStyles.dialogBody} ${styles.body}`}>
          {tab === "existing" ? <>
            <div className={styles.channels}>
              {channels.map(channel => <Button
                key={channel.id}
                className={styles.channelCard}
                aria-pressed={selectedId === channel.id}
                aria-label={`选择销售渠道 ${channel.name}`}
                onClick={() => onSelect(channel.id)}
                type="button"
              >
                <span className={styles.cardHeader}><strong>{channel.name}</strong><Badge tone={channel.adapterStatus === "example" ? "neutral" : "warning"}>{channel.adapterStatus === "example" ? "示例适配" : "待接入"}</Badge></span>
                <span className={styles.cardKind}>{kindNames[channel.kind]}</span>
                <span className={styles.cardMeta}>{channel.fulfillments.map(value => fulfillments.find(item => item.id === value)?.name).join(" · ")}</span>
                <span className={styles.cardFooter}><code>{channel.id}</code><span>{selectedId === channel.id ? "当前渠道 ✓" : "选择 →"}</span></span>
              </Button>)}
            </div>
            <div className={styles.notice}><strong>渠道定义不等于账号连接</strong><p>示例适配和待接入渠道均未连接外部账户。切换后保留节点与连线，清空店铺接入及连接引用；店铺能力统一接入，不必逐节点重复配置生成 Skill。新渠道仍需兼容的实际适配实现。</p></div>
          </> : <>
            <div className={styles.presets}>
              <small>快速填写名称</small>
              {presets.map(preset => <Button key={preset.id} compact type="button" onClick={() => { setName(preset.name); setId(preset.id); setKind(preset.kind); setErrors([]); }}>{preset.name}</Button>)}
              <span>只填名称与类型，不声明平台能力。</span>
            </div>
            <div className={styles.fields}>
              <label>渠道名称<Input aria-label="渠道名称" value={name} maxLength={80} placeholder="例如自己的商城，或任意销售平台" onChange={event => { setName(event.target.value); setErrors([]); }} /></label>
              <label>渠道 ID<Input aria-label="渠道 ID" value={id} maxLength={48} placeholder="my-channel" spellCheck={false} autoCapitalize="none" onChange={event => { setId(event.target.value); setErrors([]); }} /><small>2–48 位小写字母、数字、连字符；作为可导出的稳定标识。</small></label>
              <label>渠道类型<SelectField aria-label="渠道类型" value={kind} onChange={event => setKind(event.target.value as ChannelKind)}>{Object.entries(kindNames).map(([value, title]) => <option key={value} value={value}>{title}</option>)}</SelectField></label>
            </div>
            <fieldset className={styles.group}>
              <legend>支持的履约方式</legend>
              <div className={styles.fulfillmentOptions}>{fulfillments.map(option => <label key={option.id} className={styles.checkboxLabel}><Input className={styles.checkbox} type="checkbox" checked={supported.includes(option.id)} onChange={() => toggleFulfillment(option.id)} /><span><strong>{option.name}</strong><small>{option.detail}</small></span></label>)}</div>
              <label className={styles.defaultField}>默认履约方式<SelectField aria-label="默认履约方式" value={supported.length ? defaultFulfillment : ""} disabled={!supported.length} onChange={event => setDefaultFulfillment(event.target.value as Fulfillment)}>{!supported.length && <option value="">请先选择支持的履约方式</option>}{fulfillments.filter(option => supported.includes(option.id)).map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</SelectField></label>
            </fieldset>
            <fieldset className={styles.group}>
              <legend>设计器能力声明</legend>
              <p>仅用于匹配 Skill 和静态预检，不代表平台支持这些动作，也不授予真实执行权限。</p>
              <div className={styles.capabilities}>{capabilities.map(option => <label key={option.id} className={styles.checkboxLabel}><Input className={styles.checkbox} type="checkbox" checked={selectedCapabilities.includes(option.id)} onChange={() => toggleCapability(option.id)} /><span>{option.name}</span></label>)}<label className={styles.checkboxLabel}><Input className={styles.checkbox} type="checkbox" checked={generateAssets} onChange={event => { setGenerateAssets(event.target.checked); setErrors([]); }} /><span>使用素材生成工具</span></label></div>
            </fieldset>
            <div className={styles.notice}><strong>新增后为“待接入”状态</strong><p>这里仅添加渠道元数据，不接入 API，不运行脚本，也不保存密钥。渠道定义随本地草稿保存及流程 JSON 导出；真实连接、适配 Skill 和权限需要后续配置。</p></div>
            {errors.length > 0 && <div className={styles.errors} role="alert">{errors.map((error, index) => <p key={`${error}-${index}`}>{error}</p>)}</div>}
          </>}
        </div>
        <footer className={workflowStyles.dialogFooter}>
          <span>{tab === "existing" ? "点击渠道卡片切换，流程结构保持不变。" : "可添加任意销售渠道，无需限定平台名单。"}</span>
          <Button type="button" onClick={onClose}>{tab === "existing" ? "关闭" : "取消"}</Button>
          {tab === "add" && <Button variant="primary" type="submit">添加并选用</Button>}
        </footer>
      </form>
    </dialog>,
    document.body,
  );
}

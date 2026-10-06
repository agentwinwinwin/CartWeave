"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/app/page-header";
import styles from "./cj-setup.module.css";
import { backendRequest, getBackendSession, loginBackend, type BackendSession } from "@/lib/workflow/backend-client";
import {CJIntelligence} from "./cj-intelligence";

type CJProduct = {id: string; nameEn: string | null; sku: string | null; sellPrice: string | number | null; listedNum: number | null; warehouseInventoryNum: number | null; totalVerifiedInventory: number | null};
type CJConnection = {configured: boolean; status: string; configuration_version: number; verified_at?: string | null; last_error?: string; sample_products: CJProduct[]};

const steps = [
  { title: "准备 CJ 账户", note: "确认数据来源与接入范围" },
  { title: "获取 API Key", note: "在 CJ 后台创建专用密钥" },
  { title: "安全配置", note: "交给服务端，不放进工作流" },
  { title: "验证与下一步", note: "读取商品样本，再进入选品" },
];
const acknowledgements = ["我已准备好可以登录的 CJ 账户", "我已了解如何复制完整 API Key，而不是用户编号", "我已了解密钥只能由服务端安全保存"];
const docs = "https://developers.cjdropshipping.com/en/api/api2/api/auth.html";

export function CJSetup() {
  const [step, setStep] = useState(2);
  const [checked, setChecked] = useState<boolean[]>([false, false, false]);
  const [notice, setNotice] = useState("");
  const [session, setSession] = useState<BackendSession | null>(null);
  const [connection, setConnection] = useState<CJConnection | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [checking, setChecking] = useState(true);
  const [loginBusy, setLoginBusy] = useState(false);
  const canManage = session?.user?.role === "admin";
  const desktop = session?.mode === "desktop";
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    let active = true;
    getBackendSession().then(async value => {
      if (!active) return;
      setSession(value);
      if (value.authenticated) {
        const saved = await backendRequest<CJConnection>("connections/cj");
        if (!active) return;
        setConnection(saved);
        if (saved.configured) { setChecked([true, true, true]); setStep(3); }
      }
    }).catch(() => { if (active) setNotice("连接服务暂时不可用，请确认 Django 后端已启动。"); })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, []);
  const go = (next: number) => { setStep(next); setNotice(""); requestAnimationFrame(() => heading.current?.focus()); };
  const refreshSession = async () => {
    setChecking(true); setNotice("");
    try {
      const current = await getBackendSession();
      setSession(current);
      setConnection(current.authenticated ? await backendRequest<CJConnection>("connections/cj") : null);
      if (!current.authenticated) setNotice("尚未登录工作台。请在此页登录后保存密钥。");
    } catch { setNotice("无法连接工作台后端，请确认服务已启动后重试。"); }
    finally { setChecking(false); }
  };
  const login = async () => {
    setLoginBusy(true); setNotice("");
    try {
      const current = await loginBackend(username, password);
      setSession(current);
      setConnection(await backendRequest<CJConnection>("connections/cj"));
      setNotice(current.user?.role === "admin" ? "登录成功，可以安全保存 CJ 密钥。" : "登录成功，但此账号不是管理员，不能保存或更换密钥。");
    } catch (error) { setNotice(error instanceof Error ? error.message : "登录失败，请重试。"); }
    finally { setPassword(""); setLoginBusy(false); }
  };
  const save = async () => {
    if (!canManage || checking || busy || loginBusy) return;
    setBusy(true); setNotice("");
    try {
      const saved = await backendRequest<CJConnection>("connections/cj", "PUT", {api_key: apiKey, expected_version: connection?.configuration_version ?? 0});
      setConnection(saved); setChecked([true, true, true]); setStep(3);
      setNotice("密钥已加密保存。点击验证连接，读取 CJ 商品样本。");
    } catch (error) { setNotice(error instanceof Error ? error.message : "保存失败，请重试。"); }
    finally { setApiKey(""); setBusy(false); }
  };
  const verify = async () => {
    setBusy(true); setNotice("正在验证 CJ 身份并读取少量商品，请稍候…");
    try {
      const result = await backendRequest<CJConnection>("connections/cj/verify", "POST", {});
      setConnection(result); setNotice(result.sample_products.length ? "CJ 连接验证成功，已读取真实商品样本。" : "CJ 身份与查询接口验证成功，本次查询没有返回商品。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "验证失败，请重试。");
      try { setConnection(await backendRequest<CJConnection>("connections/cj")); } catch { /* Preserve visible error when offline. */ }
    } finally { setBusy(false); }
  };
  return <div className={styles.page}>
    <PageHeader title="连接 CJ 商品源" description={desktop ? "本机模式 · CJ API Key 由服务端加密保存，不进入浏览器存储或工作流配置。" : "先接好供应数据，再开始选品。一步步完成账户准备、密钥获取和安全配置。"} actions={<Link className="ui-button ui-button--secondary" href="/workflow/builder">返回工作流 ↗</Link>} />
    <div className={styles.status} data-status={connection?.status??'unknown'}><span className={styles.dot} /><strong>{connection?.status === "verified" ? "CJ 已验证" : connection?.status === "error" ? "CJ 验证未通过" : connection?.status === "verifying" ? "CJ 正在验证" : connection?.configured ? "密钥已保存 · 待验证" : connection ? "尚未配置密钥" : "登录后查看连接状态"}</strong><span>{connection?.last_error || (connection?.verified_at ? `最近验证：${new Date(connection.verified_at).toLocaleString()}` : "在下方填写完整 API Key，由后端加密保存并验证。")}</span></div>
    {!session?.authenticated && <p className={styles.notice}>{checking ? "正在检查工作台登录状态…" : "可以先填写 CJ 密钥，再在下方登录工作台管理员账号后保存；不是登录 CJ 账号。"}<Button compact disabled={checking || busy || loginBusy} onClick={refreshSession}>重新检查登录状态</Button></p>}
    {session?.authenticated && !canManage && <p className={styles.notice}>当前为只读查看，保存或更换供应源密钥需要团队管理员权限。</p>}
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <span className={styles.eyebrow}>CONNECTION GUIDE</span>
        <h2>从供应数据开始。</h2>
        <p>CJ 是商品与履约供应源，不是你的销售渠道。店铺连接需要单独配置。</p>
        <nav aria-label="CJ 接入步骤" className={styles.steps}>{steps.map((item, index) => <button key={item.title} disabled={busy || loginBusy} aria-current={index === step ? "step" : undefined} onClick={() => go(index)}><span className={styles.number}>{checked[index] ? "✓" : String(index + 1).padStart(2, "0")}</span><span><b>{item.title}</b><small>{item.note}</small></span></button>)}</nav>
        <a className={styles.docLink} href={docs} target="_blank" rel="noopener noreferrer">CJ 官方接入文档 ↗</a>
      </aside>
      <Card className={styles.content}>
        <div className={styles.contentHead}><span className={styles.eyebrow}>STEP {String(step + 1).padStart(2, "0")} / 04</span><h2 ref={heading} tabIndex={-1}>{steps[step].title}</h2></div>
        {step === 0 && <section className={styles.section}>
          <p className={styles.lead}>你需要一个 CJ 账户，以及这个账户下专门创建的 API Key。</p>
          <div className={styles.tiles}><div><small>账户编号</small><b>CJ 开头的用户编号</b><p>只用于识别账户，不能代替 API Key。</p></div><div><small>接入凭证</small><b>完整的 API Key</b><p>用于服务端换取访问令牌。不要发到聊天或填写在 Skill 提示词中。</p></div></div>
          <h3>首次连接只读取数据</h3><p>验证阶段只换取令牌、读取少量商品，不创建订单、不付款、不发货。采购、发布和履约权限将在后续业务流程中单独控制。</p>
          <a className="ui-button ui-button--secondary" href="https://www.cjdropshipping.com/my.html" target="_blank" rel="noopener noreferrer">打开 CJ 账户后台 ↗</a>
        </section>}
        {step === 1 && <section className={styles.section}>
          <p className={styles.lead}>在 CJ 后台安装 API 应用，然后创建一把用于 CommerceOS 的专用密钥。</p>
          <ol className={styles.instructions}>
            <li><b>进入 Apps → Install App</b><p>在应用商店的 Others 分类中找到 API 应用并安装；已安装则跳过。</p></li>
            <li><b>个人中心 → API → Add API</b><p>填写 API Key Name（建议 CommerceOS）和 API Store Name，Type 选择 API Key，再点击 Confirm。</p></li>
            <li><b>确认 Type 与 Status</b><p>找到 Type 为 API Key、Status 为 Activated 的记录。</p></li>
            <li><b>复制完整密钥</b><p>在 API Key &amp; MCP Token 列点击复制图标。不要复制被遮罩的显示值，也不要把 MCP Token 当成 API Key。</p></li>
          </ol>
          <div className={styles.callout}><b>怎么区分？</b><p>官方示例结构是 <code>CJ用户编号@api@…</code>。只有 CJ 用户编号或星号遮罩值不够；格式看起来正确也不代表认证有效。</p></div>
          <a className={styles.docLink} href={docs} target="_blank" rel="noopener noreferrer">打开官方图文操作说明 ↗</a>
        </section>}
        {step === 2 && <section className={styles.section}>
          <p className={styles.lead}>密钥应进入服务端的凭证存储，工作流只保存连接引用。</p>
          <div className={styles.callout}><b>{connection?.configured ? "更新 CJ 密钥" : "仅在这里提交密钥"}</b><p>提交后输入框会清空，页面不会回显密钥。工作流只引用供应源连接；更新密钥后需重新验证。</p></div>
          <label className={styles.field}>CJ API Key<Input type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} disabled={busy} placeholder="粘贴完整 CJ API Key" maxLength={200} autoComplete="off" spellCheck={false} /></label>
          {!checking && !session?.authenticated && <form className={styles.callout} onSubmit={event => {event.preventDefault(); void login();}}>
            <b>登录工作台后安全保存</b><p>使用团队管理员账号，不是 CJ 账号。登录不会提交上面的 API Key。</p>
            <label className={styles.field}>工作台用户名<Input autoComplete="username" value={username} disabled={loginBusy} onChange={event=>setUsername(event.target.value)} required /></label>
            <label className={styles.field}>工作台密码<Input type="password" autoComplete="current-password" value={password} disabled={loginBusy} onChange={event=>setPassword(event.target.value)} required /></label>
            <Button type="submit" disabled={loginBusy || !username.trim() || !password}>{loginBusy ? "正在登录…" : "登录工作台"}</Button>
            <p>本地开发账号由部署时创建；当前项目的账号信息位于 backend/.local/development-access.json，请在本机查看，不要发送到聊天。</p>
          </form>}
          <Button variant="primary" disabled={!canManage || checking || loginBusy || busy || !apiKey.trim()} onClick={save}>{busy ? "正在保存…" : checking ? "正在检查登录状态…" : !session?.authenticated ? "请先登录后保存" : !canManage ? "仅管理员可保存" : "安全保存密钥"}</Button>
          {session?.authenticated && !canManage && <Button compact disabled={busy || checking} onClick={refreshSession}>已更新权限？重新检查</Button>}
          <details className={styles.details}><summary>密钥保存在哪里？</summary><p>{desktop ? "密钥加密保存在本机工作区数据库中，离开页面无需重新登录。" : "密钥由 Django 加密保存在当前团队的供应源连接中。"}不保存到浏览器 localStorage、工作流 JSON 或 Skill 提示词。保存不等于验证成功，下一步会向 CJ 发起只读验证。</p></details>
        </section>}
        {step === 3 && <section className={styles.section}>
          <div className={styles.result}><span>{connection?.status === "verified" ? "✓" : "→"}</span><div><h3>{connection?.status === "verified" ? "CJ 商品源已连接" : "验证你的 CJ 连接"}</h3><p>{connection?.status === "verified" ? "已通过身份认证和只读商品查询。" : "保存密钥后，验证身份并读取最多 3 件真实商品。"}</p></div></div>
          <ol className={styles.instructions}><li><b>服务端验证身份</b><p>使用 API Key 换取访问令牌；令牌及刷新凭证仅由服务端管理。</p></li><li><b>只读查询商品样本</b><p>携带访问令牌查询少量 CJ 商品，检查接口错误与实际返回字段。</p></li><li><b>标准化后再交给选品流程</b><p>保留商品 ID、变体、供货价格、库存和素材来源。目标市场运费需要另行询价；CJ 的上架次数不能当作真实销量。</p></li></ol>
          <Button variant="primary" disabled={!canManage || busy || !connection?.configured} onClick={verify}>{busy ? "正在验证…" : "验证连接并读取商品"}</Button>
          <Button disabled={busy} onClick={() => go(2)}>返回配置密钥</Button>
          {!!connection?.sample_products.length && <div className={styles.samples}><h3>真实商品样本</h3><p>以下为 CJ 查询快照。供货价单位 USD，库存仍需按变体与仓库核验；上架次数不等于销量。</p>{connection.sample_products.map(product => <Card key={product.id} className={styles.sample}><strong>{product.nameEn || product.id}</strong><dl><dt>商品 ID</dt><dd>{product.id}</dd><dt>SKU</dt><dd>{product.sku ?? "未返回"}</dd><dt>供货价 USD</dt><dd>{product.sellPrice ?? "未返回"}</dd><dt>上架次数</dt><dd>{product.listedNum ?? "未返回"}</dd><dt>库存 / 已核验库存</dt><dd>{product.warehouseInventoryNum ?? "未知"} / {product.totalVerifiedInventory ?? "未知"}</dd></dl></Card>)}</div>}
          <details className={styles.details}><summary>连接失败时检查什么？</summary><ul><li>账户编号不能换取令牌：重新复制完整 API Key。</li><li>密钥无效：检查 API 应用、Activated 状态及密钥是否被撤销。</li><li>access token cannot be empty：商品请求缺少 CJ-Access-Token，请检查服务端令牌交换。</li><li>网络或频率限制：以实际接口错误为准，服务端有限重试；不要反复创建密钥。</li></ul></details>
          <div className={styles.callout}><b>下一步：接入固定采集节点</b><p>本页完成团队级 CJ 供应源接入。连接成功不代表完成选品、配送核验或采购；原设计器的采集节点仍为模拟，后续由系统采集逻辑使用此连接。</p></div>
        </section>}
        <footer className={styles.footer}>
          {step < 3 && <label className={styles.check}><input type="checkbox" checked={checked[step]} onChange={event => setChecked(values => values.map((value, index) => index === step ? event.target.checked : value))} />{acknowledgements[step]}</label>}
          <div className={styles.actions}><Button disabled={step === 0} onClick={() => go(step - 1)}>上一步</Button>{step < 3 ? <Button variant="primary" disabled={!checked[step]} onClick={() => go(step + 1)}>下一步 →</Button> : <Link className="ui-button ui-button--primary" href="/workflow/builder">返回选品流程 →</Link>}</div>
          <p className={styles.notice} role="status">{notice || "勾选仅表示你已阅读，不会保存密钥或改变连接状态。"}</p>
        </footer>
      </Card>
    </div>
    <CJIntelligence enabled={desktop===true} canManage={canManage}/>
  </div>;
}

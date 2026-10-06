"use client";
import {useEffect,useState} from "react";
import {Card} from "@/components/ui/card";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {DataTable} from "@/components/ui/data-table";
import {backendRequest} from "@/lib/workflow/backend-client";
import styles from "./cj-setup.module.css";

type Row={rank:number;category_name:string;source_category_id:string;source_url:string;metrics:Record<string,string>};
type Group={updated_on:string;rows:Row[]};
export type IntelligenceSnapshot={captured_at:string;sales:Group;advertising:Group};
type Snapshot=IntelligenceSnapshot;
type State={session_saved:boolean;extension:{paired:boolean;online:boolean};login:{status:string;message:string};snapshot:Snapshot|null};

export function CJIntelligence({enabled,canManage,onSnapshot}:{enabled:boolean;canManage:boolean;onSnapshot?:(snapshot:Snapshot)=>void}){
 const [state,setState]=useState<State|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState("");
 const [code,setCode]=useState("");
 async function refresh(){try{setState(await backendRequest<State>('connections/cj/intelligence'));}catch(e){setNotice(e instanceof Error?e.message:'无法读取网页采集状态。');}}
 useEffect(()=>{if(enabled)void refresh();},[enabled]);
 useEffect(()=>{if(!enabled)return;const timer=setInterval(()=>void refresh(),5000);return()=>clearInterval(timer);},[enabled]);
 useEffect(()=>{if(!code)return;const timer=setTimeout(()=>setCode(''),300000);return()=>clearTimeout(timer);},[code]);
 async function pair(){setBusy(true);setNotice('');try{const result=await backendRequest<{code:string}>('connections/cj/intelligence/chrome-pairing','POST',{});setCode(result.code);setNotice('在 Chrome 扩展窗口粘贴配对码，5 分钟内有效，仅可使用一次。');}catch(e){setNotice(e instanceof Error?e.message:'无法生成配对码。');}finally{setBusy(false);}}
 async function revoke(){setBusy(true);try{await backendRequest('connections/cj/intelligence/chrome-pairing','DELETE',{});setCode('');await refresh();}catch(e){setNotice(e instanceof Error?e.message:'撤销失败。');}finally{setBusy(false);}}
 async function collect(){setBusy(true);setNotice('正在读取 CJ 两组前十，请勿重复点击…');try{const snapshot=await backendRequest<Snapshot>('connections/cj/intelligence/collect','POST',{});setState(s=>s?{...s,snapshot}:null);setNotice('两组前十采集成功，结果已保存。');}catch(e){setNotice(e instanceof Error?e.message:'采集失败；下方旧快照未更新。');}finally{setBusy(false);}}
 const snapshot=state?.snapshot;
 useEffect(()=>{if(snapshot)onSnapshot?.(snapshot);},[snapshot,onSnapshot]);
 return <Card className={styles.intelligence}>
  <h2>CJ 市场行情 · 网页采集</h2>
  <p>用你平时的 Chrome 正常登录 CJ，通过项目扩展读取销售、广告类目各前十。不用 Codex、不用大模型，与 API Key 连接独立。</p>
  <p>自动采集可能触发 CJ 风控，不能保证账号不受限。请先确认 CJ 允许你的使用方式；由手动采集或显式启用的工作流调用，不同时重复请求，失败不自动重试。不绕过验证码或访问限制。</p>
  {!enabled?<p>当前网页采集仅开放本机桌面模式。</p>:<>
   <details open={!state?.extension?.paired}><summary>首次连接普通 Chrome · 三步安装</summary><ol>
    <li><a href="/downloads/commerceos-cj-reader.zip" download>下载项目扩展</a>并解压。</li>
    <li>在 Chrome 打开 <code>chrome://extensions</code>，开启开发者模式，点击“加载已解压的扩展程序”，选择解压后的文件夹。</li>
    <li>点击下方“生成配对码”，在 Chrome 扩展图标打开“CommerceOS · CJ 行情读取”，粘贴配对码连接。通过扩展里的链接打开 CJ，正常登录。</li>
   </ol><p>扩展源码包含在项目 browser-extension/cj-reader。只允许 CJ 页面和本机 8010 端口；不读取 Cookie、密码或浏览历史，不保存 CJ 登录态。连接凭证仅用于两榜读取，可随时撤销。</p></details>
   <div className={styles.intelligenceActions}><Button disabled={!canManage||busy} onClick={pair}>{state?.extension?.paired?'重新生成配对码':'生成配对码'}</Button><Button variant="primary" disabled={!state?.extension?.online||busy} onClick={collect}>{busy?'处理中…':'采集两组前十'}</Button><Button disabled={busy} onClick={()=>void refresh()}>刷新状态</Button>{state?.extension?.paired&&<Button disabled={!canManage||busy} onClick={revoke}>撤销 Chrome 连接</Button>}</div>
   {code&&<div className={styles.intelligenceActions}><Input aria-label="一次性扩展配对码" value={code} readOnly/><Button onClick={async()=>{try{await navigator.clipboard.writeText(code);setNotice('配对码已复制，请粘贴到 Chrome 扩展。');}catch{setNotice('无法自动复制，请手动复制上方配对码。');}}}>复制配对码</Button></div>}
   <p>保持普通 Chrome 打开，后台约每 30 秒领取任务；扩展弹窗可立即检查。采集只读取两个固定榜单，不修改你正在浏览的页面。登录或安全验证由你处理，遇到验证即停止。</p>
   <p role="status">{notice||state?.login.message||'尚未配对 Chrome 扩展。'}</p>
   {snapshot&&<IntelligenceResults snapshot={snapshot}/>}
  </>}
 </Card>;
}

export function IntelligenceResults({snapshot}:{snapshot:Snapshot}){
 return <>
    <p>保存的采集快照：{new Date(snapshot.captured_at).toLocaleString()}。来源更新时间见各榜单；刷新状态不代表重新采集。</p>
    <h3>销售类目前十 · Amazon 市场 · All Sites</h3><p>来源更新：{snapshot.sales.updated_on}。不是 CJ 供货商品销量，不直接套到相似商品。</p>
    <DataTable rows={snapshot.sales.rows.map(r=>({...r,id:r.source_category_id}))} columns={[{key:'rank',label:'排名'},{key:'category_name',label:'类目'},{key:'metrics',label:'销售额',render:r=>r.metrics.sales_display},{key:'source_url',label:'销量',render:r=>r.metrics.sales_volume_display},{key:'source_category_id',label:'排名变化率',render:r=>r.metrics.ranking_change_rate_display}]}/>
    <h3>广告类目前十 · TikTok + Facebook · 全地区</h3><p>来源更新：{snapshot.advertising.updated_on}。广告数量不代表销量或广告回报。</p>
    <DataTable rows={snapshot.advertising.rows.map(r=>({...r,id:r.source_category_id}))} columns={[{key:'rank',label:'排名'},{key:'category_name',label:'类目'},{key:'metrics',label:'TikTok 广告数',render:r=>r.metrics.tiktok_ad_count_display},{key:'source_url',label:'Facebook 广告数',render:r=>r.metrics.facebook_ad_count_display}]}/>
    <p>数值保留 CJ 网页的 K/M 舍入显示。两榜类目体系不同；只有首节点确认的供货类目方案才会传给商品任务，榜单数据不当作单品销量。</p>
 </>;
}

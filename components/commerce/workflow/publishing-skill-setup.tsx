"use client";
import Link from "next/link";
import {useEffect,useState} from "react";
import {backendRequest} from "@/lib/workflow/backend-client";
import {Button} from "@/components/ui/button";
import {SelectField} from "@/components/ui/select-field";
import {contractSchemas,getDefinition,storeActionIds} from "@/lib/workflow/universal";
import styles from "./workflow.module.css";
import {IntegrationFlow} from "./integration-flow";
import {IntegrationSkillEntries} from "../skills/integration-skill-entries";

export type ApiMode="create-api"|"existing-api";
type InstalledPackage={package:string;version:string;channel:string;scope:string;actions:{action:string}[];extensions?:{package:string;version:string;scope:string;actions:{action:string}[]}[];unsupported:string[]};
export function PublishingSkillSetup({channel,mode,onModeChange,actions=storeActionIds,showFlow=true,readOnlyMode=false}:{channel:string;mode:ApiMode;onModeChange:(value:ApiMode)=>void;actions?:string[];showFlow?:boolean;readOnlyMode?:boolean}){
  const create=mode==="create-api";
  const [installed,setInstalled]=useState<InstalledPackage[]>([]);
  const [packageError,setPackageError]=useState("");
  useEffect(()=>{let active=true;backendRequest<{packages:InstalledPackage[]}>("integration-packages").then(data=>{if(active)setInstalled(data.packages);}).catch(()=>{if(active)setPackageError("未能读取后端接入包，请检查后端连接；下方设计草稿不代表可执行能力。");});return()=>{active=false;};},[]);
  const current=installed.find(item=>item.channel===channel);
  function download(value:unknown,name:string){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:"application/json"}));const a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  const briefLink=(kind:string)=>`/skills?create=${kind}&channel=${encodeURIComponent(channel)}&apiMode=${mode}&actions=${encodeURIComponent(actions.join(","))}`;
  function downloadContracts(){
    if(current){download(current,'store-api-contracts.json');return;}
    const data={version:"0.1.0-draft",channel,status:"design-only",apiMode:mode,actions:actions.map(id=>{const d=getDefinition(id);return {action:id,description:d?.description??'必须读取已安装包的 HTTP 契约',input:d?.input??null,output:d?.output??null,effects:d?.allowedEffects??[],inputSchema:d?contractSchemas[d.input]??null:null,outputSchema:d?contractSchemas[d.output]??null:null};}),schemas:contractSchemas};
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:"application/json"}));
    const a=document.createElement("a");a.href=url;a.download="contracts.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <div className={styles.infoBox}>
    {showFlow&&<IntegrationSkillEntries channel={channel} actions={actions}/>}
    <details><summary>接口资料与接入说明</summary>
    <strong>制作店铺运营接口包 · 不只服务于上架</strong>
    {showFlow&&<IntegrationFlow channel={channel}/>}
    <p>当前渠道标识：<code>{channel}</code>。契约和制作说明使用此标识；如不正确，请先在工作流顶部切换销售渠道。</p>
    <p>AI 首次制作接口与适配脚本 → 测试审查并安装 → 店铺绑定一次 → 后端按动作复用。日常运行不重新生成代码，也不需要给每个接口节点重复制作 Skill。</p>
    {packageError&&<p role="status">{packageError}</p>}
    {current&&<section><h3>后端已安装接入包：{current.package} · {current.version}</h3><p>核心动作：{current.actions.map(item=>item.action).join("、")}。</p>{current.extensions?.map(ext=><details key={ext.package}><summary>{ext.package} · {ext.version} · 单独确认的测试扩展</summary><p>{ext.actions.map(a=>a.action).join('、')}</p></details>)}<p>一个下载包包含商品发布、订单/物流/客户/财务、客服收件与答复、素材归档及测试数据入口的实际 HTTP Schema。扩展仍需测试站联调验收；共用包不等于获准付款或消息写入。</p><p>尚不支持：{current.unsupported.join("、")}。</p><Button type="button" compact onClick={()=>download(current,"store-api-contracts.json")}>下载完整接口契约（含扩展）</Button>{" "}<Link href="/test-store-lab">测试业务联调 ↗</Link></section>}
    <label className={styles.field}>店铺接口情况<SelectField aria-label="店铺接口情况" disabled={readOnlyMode} value={mode} onChange={e=>onModeChange(e.target.value as ApiMode)}>
      <option value="existing-api">已有可用 API · 亚马逊等平台 / 已接好接口的独立站</option>
      <option value="create-api">自建独立站尚无 API · 先生成接口</option>
    </SelectField></label>
    {readOnlyMode&&<p>此处继承店铺接入设置；修改请使用上方“配置店铺接入”，不在每个发布节点重复配置。</p>}
    {create&&<section><h3>① 用规则 Skill 增量接入独立站</h3><p>把规则、实际契约和站点工程交给编程 AI：先检查已有接口，展示最小改动与双向字段映射，缺口与你确认后再开发。优先复用原业务；必须修改已有路由、配置或数据库时先确认。接口和适配包可以同次交付。</p>
      <a className="ui-button ui-button--secondary" href="/integration-skills/commerceos-store-integration/SKILL.md" download="SKILL.md">下载接口生成规则 Skill</a>{" "}
      <Link className="ui-button ui-button--ghost" href={briefLink("development")} target="_blank" rel="noopener noreferrer">编写接口开发说明 ↗</Link>
    </section>}
    <section><h3>{create?"②":"①"} AI 制作多动作适配包</h3><p>{create?"依据已生成并验收的接口文档、字段和测试响应制作调用脚本；可与接口在同一次开发中交付。":"依据平台现有官方 API 或独立站接口文档制作调用脚本，不重新创建平台 API。"}同一包按动作提供商品检查与发布、订单读取、履约回写、经营数据和售后资料；每个动作有自己的输入输出。后续节点复用同一包与连接，不重复生成代码。</p>
      <a className="ui-button ui-button--secondary" href="/integration-skills/commerceos-publishing-adapter/SKILL.md" download="SKILL.md">下载 AI 适配包制作规则</a>{" "}
      <Link className="ui-button ui-button--ghost" href={briefLink("adapter")} target="_blank" rel="noopener noreferrer">编写适配包制作说明 ↗</Link>
    </section>
    <section><h3>{create?"③":"②"} 验证并安装接入包，店铺绑定一次</h3><p>AI 交付的是代码，不能自行授予执行权限。接入包完成测试和代码审查、安装到后端后，店铺连接按动作复用它；内容制作等可变策略仍单独选择 Skill。当前不支持直接上传任意脚本执行。</p></section>
    <Button compact onClick={downloadContracts} type="button">下载工作流设计契约（草案）</Button>
    <details><summary>本次包含 {actions.length} 个店铺动作 · 查看后续流程范围</summary><ul>{actions.map(id=><li key={id}>{getDefinition(id)?.title} · {id}</li>)}</ul><p>需要调整范围，请在“配置店铺接入”中勾选能力；缺少 Schema 的动作只列为待补齐，不宣称已实现。广告平台、CJ 采购和仓库动作不包含在店铺连接权限里。</p></details>
    <small>上方实际接口契约仅代表已安装包，不是所有渠道的通用协议；下方设计契约是草案。AI 需检查两端必填字段、业务语义及返回状态，不能强套测试站格式。这里不自动生成、部署或执行代码。</small>
    </details>
  </div>;
}

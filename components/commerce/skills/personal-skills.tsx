"use client";
import {useEffect,useRef,useState,type ReactNode} from "react";
import Link from "next/link";
import {PageHeader} from "@/components/app/page-header";
import {Button} from "@/components/ui/button";
import {Card} from "@/components/ui/card";
import {Badge} from "@/components/ui/badge";
import {Input} from "@/components/ui/input";
import {SelectField} from "@/components/ui/select-field";
import {backendRequest} from "@/lib/workflow/backend-client";
import {storeActionIds} from "@/lib/workflow/universal";
import {creationBrief,draftKey,isSkillDraft,parseSkillDrafts,publishingDraft,registeredSkillKind,skillKinds,type RegisteredSkill,type SkillDraft,type SkillKind} from "@/lib/skills/personal";
import styles from "./personal-skills.module.css";
import {IntegrationSkillEntries} from "./integration-skill-entries";
import {RuntimeSkills} from "../agents/runtime-skills";

const statusNames={approved:"已审核版本",pending:"待审核",revoked:"已停用"};
function Dialog({title,children,onClose}:{title:string;children:ReactNode;onClose:()=>void}){
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;ref.current?.showModal();return()=>previous?.focus();},[]);
  return <dialog ref={ref} className={styles.dialog} aria-label={title} onCancel={onClose}><div className={styles.heading}><h2>{title}</h2><Button compact onClick={onClose} aria-label="关闭技能窗口">关闭</Button></div>{children}</dialog>;
}
function DraftEditor({initial,onClose,onSave}:{initial:SkillDraft;onClose:()=>void;onSave:(value:SkillDraft)=>string|null}){
  const [value,setValue]=useState(initial),[error,setError]=useState("");
  const field=(key:keyof SkillDraft,text:string)=>setValue(v=>({...v,[key]:text}));
  return <Dialog title={initial.name?"编辑制作草稿":"新建技能草稿"} onClose={onClose}>
    <p className={styles.muted}>先描述你要制作的能力。这里只保存制作说明，不生成代码、不授予权限，也不会加入可执行工作流。不要填写密钥。</p>
    <form onSubmit={event=>{event.preventDefault();const message=onSave({...value,name:value.name.trim(),updatedAt:new Date().toISOString()});if(message)setError(message);}}>
      <div className={styles.form}>
        <label>技能名称<Input required maxLength={80} value={value.name} onChange={e=>field("name",e.target.value)} placeholder="例如：亚马逊商品管理"/></label>
        <label>技能职责<SelectField value={value.kind} onChange={e=>field("kind",e.target.value)}>{Object.entries(skillKinds).map(([id,kind])=><option key={id} value={id}>{kind.name}</option>)}</SelectField></label>
        <label>要完成什么<textarea className="ui-input" required maxLength={4000} value={value.purpose} onChange={e=>field("purpose",e.target.value)} placeholder="描述使用场景和业务结果"/></label>
        <label>支持的动作<Input maxLength={4000} value={value.actions} onChange={e=>field("actions",e.target.value)} placeholder="例如：资料检查、提交发布、查询可售状态"/></label>
        <label>需要哪些输入<textarea className="ui-input" maxLength={4000} value={value.input} onChange={e=>field("input",e.target.value)} placeholder="商品事实、原图、目标市场、渠道要求……"/></label>
        <label>应交付什么<textarea className="ui-input" maxLength={4000} value={value.output} onChange={e=>field("output",e.target.value)} placeholder="例如：商品草稿、主图、广告词；或发布回执与状态"/></label>
        <label>希望可调整的参数<Input maxLength={4000} value={value.parameters} onChange={e=>field("parameters",e.target.value)} placeholder="语言、图片风格、图片数量……不填写账号密钥"/></label>
      </div>
      {error&&<p role="alert" className={styles.note}>{error}</p>}
      <div className={styles.actions}><Button type="submit" variant="primary">保存制作草稿</Button><Button type="button" onClick={onClose}>取消</Button></div>
    </form>
  </Dialog>;
}
export function PersonalSkills(){
  const [registered,setRegistered]=useState<RegisteredSkill[]>([]);
  const [loading,setLoading]=useState(true),[error,setError]=useState("");
  const [drafts,setDrafts]=useState<SkillDraft[]>([]),[storageReady,setStorageReady]=useState(false),[storageError,setStorageError]=useState("");
  const [query,setQuery]=useState(""),[kind,setKind]=useState("all");
  const [tab,setTab]=useState("rules");
  const [editing,setEditing]=useState<SkillDraft|null>(null),[detail,setDetail]=useState<RegisteredSkill|null>(null),[notice,setNotice]=useState("");
  async function refresh(){
    setLoading(true);setError("");
    try{setRegistered(await backendRequest<RegisteredSkill[]>("skills"));}
    catch(e){setRegistered([]);setError(e instanceof Error?e.message:"无法读取后端版本");}
    finally{setLoading(false);}
  }
  useEffect(()=>{void refresh();try{setDrafts(parseSkillDrafts(localStorage.getItem(draftKey)??"[]"));setStorageReady(true);}catch(e){setStorageError(e instanceof Error?e.message:"无法读取本地草稿");}},[]);
  useEffect(()=>{const params=new URLSearchParams(window.location.search);const kind=params.get("create");const selected=params.has("actions")?storeActionIds.filter(id=>(params.get("actions")??"").split(",").includes(id)):undefined;if(kind==="development"||kind==="adapter")setEditing(publishingDraft(kind,(params.get("channel")||"我的店铺").slice(0,48),params.get("apiMode")==="create-api",selected));},[]);
  function create(){
    setEditing({id:crypto.randomUUID(),name:"",kind:kind==="all"?"adapter":kind as SkillKind,purpose:"",actions:"",input:"",output:"",parameters:"",updatedAt:new Date().toISOString()});
  }
  function save(value:SkillDraft){
    if(!storageReady)return "本地存储不可用，未保存。";
    if(!isSkillDraft(value)||!value.purpose.trim())return "请填写技能名称与用途，并检查字段长度。";
    const exists=drafts.some(d=>d.id===value.id);
    if(!exists&&drafts.length>=100)return "当前最多保存 100 份制作草稿。";
    const next=exists?drafts.map(d=>d.id===value.id?value:d):[value,...drafts];
    try{localStorage.setItem(draftKey,JSON.stringify(next));setDrafts(next);setEditing(null);setTab("drafts");setQuery("");setKind("all");setNotice("制作草稿已保存在当前浏览器，尚未注册为可执行 Skill。");return null;}
    catch{return "本地保存失败，请检查浏览器存储空间。";}
  }
  function download(draft:SkillDraft){
    const url=URL.createObjectURL(new Blob([JSON.stringify(creationBrief(draft),null,2)],{type:"application/json"}));
    const a=document.createElement("a");a.href=url;a.download=`skill-creation-${draft.id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    setNotice("已导出制作说明，可交给编程 AI。它不是已完成的脚本或可导入执行清单。");
  }
  const match=(...values:string[])=>values.join(" ").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const shownDrafts=drafts.filter(d=>(kind==="all"||kind===d.kind)&&match(d.name,d.purpose,d.actions));
  const shownRegistered=registered.filter(s=>(kind==="all"||kind===registeredSkillKind(s))&&match(s.key,s.version,s.manifest?.name??"",s.manifest?.description??"",s.handler==="content.editorial.v1"?"原素材与商品文案整理 内容制作":""));
  return <>
    <PageHeader title="技能工作区" description="接入规则、执行版本与制作草稿，在同一处管理。" actions={<><Link className="ui-button" href="/workflow/builder">返回工作流</Link><Button variant="primary" onClick={create} disabled={!storageReady}>＋ 新建制作草稿</Button></>}/>
    <nav className={styles.tabs} aria-label="技能管理分区">{[["rules","接入规则 · 2"],["registered",`已注册版本${!loading&&!error?` · ${registered.length}`:""}`],["runtime","运行时模型 Skill"],["drafts",`制作草稿 · ${drafts.length}`]].map(([id,title])=><Button key={id} variant="ghost" aria-pressed={tab===id} onClick={()=>setTab(id)}>{title}</Button>)}</nav>
    {tab!=="runtime"&&<div className={styles.toolbar}><Input aria-label="搜索我的技能" value={query} onChange={e=>setQuery(e.target.value)} placeholder={tab==="rules"?"搜索 API 生成、接口字段映射…":"搜索名称、用途或版本…"}/>{tab!=="rules"&&<SelectField aria-label="技能分类" value={kind} onChange={e=>setKind(e.target.value)}><option value="all">全部职责</option>{Object.entries(skillKinds).map(([id,item])=><option key={id} value={id}>{item.name}</option>)}</SelectField>}</div>}
    {notice&&<p className={styles.note} role="status">{notice}</p>}
    {tab==="rules"&&<IntegrationSkillEntries query={query} onCreate={()=>setEditing(publishingDraft("development","我的店铺",true))}/>}
    {tab==="runtime"&&<RuntimeSkills/>}
    <section hidden={tab!=="registered"} aria-labelledby="registered-skills"><div className={styles.heading}><h2 id="registered-skills">后端已登记版本 {!loading&&!error&&`· ${registered.length}`}</h2><Button compact disabled={loading} onClick={refresh}>{loading?"读取中…":"刷新版本"}</Button></div>
      <p className={styles.muted}>版本来自当前工作区后端。已审核不等于正在运行；是否能执行仍由后端检查代码摘要、版本和工作流绑定。</p>
      {error?<div className={styles.note} role="alert">后端版本暂不可用，不展示虚构的已安装技能。{error}</div>:loading?<p role="status">正在读取登记版本…</p>:!shownRegistered.length?<div className={styles.empty}>没有符合当前筛选的登记版本。</div>:<div className={styles.grid}>{shownRegistered.map(s=><Card key={s.id} className={styles.card}>
        <div className={styles.actions}><Badge tone="neutral">{registeredSkillKind(s)?skillKinds[registeredSkillKind(s)!].name:"已登记实现"}</Badge><Badge tone={s.status==="approved"?"success":s.status==="revoked"?"danger":"warning"}>{statusNames[s.status]}</Badge></div>
        <h3>{s.handler==="content.editorial.v1"?"原素材与商品文案整理":s.manifest?.name??s.key}</h3><p>v{s.version} · {s.key}</p><p>{s.handler==="content.editorial.v1"?"沿用原图与商品文案，输出上架草稿。不调用模型或生成新图片。":s.manifest?.description??"尚无运行描述，请查看版本与后端支持范围。"}</p>
        {s.unavailable_reason&&<p>{s.unavailable_reason}</p>}
        <div className={styles.actions}><Button compact onClick={()=>setDetail(s)}>查看版本</Button><Link className="ui-button ui-button--ghost" href="/workflow/builder">到节点选择</Link></div>
      </Card>)}</div>}
    </section>
    <section hidden={tab!=="drafts"} aria-labelledby="draft-skills"><div className={styles.heading}><h2 id="draft-skills">制作中的草稿 · {drafts.length}</h2><Badge tone="neutral">尚不可执行</Badge></div>
      <p className={styles.muted}>保存在当前浏览器，可导出交给编程 AI 制作。草稿与后端登记版本分开，不自动绑定节点，也不会执行脚本。</p>
      {storageError&&<p role="alert" className={styles.note}>{storageError}</p>}
      {!shownDrafts.length?<div className={styles.empty}>{drafts.length?"没有符合当前筛选的草稿。":"还没有制作草稿。可以从“亚马逊商品管理”或“产品图与广告词”开始。"}<br/>制作完成后仍需测试与登记；通用脚本和模型执行器尚未接入。</div>:<div className={styles.grid}>{shownDrafts.map(d=><Card key={d.id} className={styles.card}><Badge tone="info">{skillKinds[d.kind].name} · 草稿</Badge><h3>{d.name}</h3><p>{d.purpose}</p><p>动作：{d.actions||"待定义"}</p><small className={styles.muted}>更新于 {new Date(d.updatedAt).toLocaleDateString()}</small><div className={styles.actions}><Button compact onClick={()=>setEditing(d)}>编辑说明</Button><Button compact variant="ghost" onClick={()=>download(d)}>导出制作说明</Button></div></Card>)}</div>}
    </section>
    {editing&&<DraftEditor initial={editing} onSave={save} onClose={()=>setEditing(null)}/>}
    {detail&&<Dialog title="后端版本详情" onClose={()=>setDetail(null)}><Badge tone={detail.status==="approved"?"success":"neutral"}>{statusNames[detail.status]}</Badge><dl className={styles.details}>
      <dt>能力标识</dt><dd>{detail.key}</dd><dt>固定版本</dt><dd>{detail.version}</dd><dt>执行入口</dt><dd>{detail.handler}</dd><dt>代码摘要</dt><dd>{detail.artifact_hash}</dd><dt>审核记录</dt><dd>{detail.review_note||"尚无审核说明"}</dd><dt>审核时间</dt><dd>{detail.reviewed_at?new Date(detail.reviewed_at).toLocaleString():"尚未审核"}</dd>
</dl>{detail.handler==="product.opportunity.v4"&&<section><h3>算法依据 · CJ 商品订单数</h3><p>订单需求45%、到货成本35%、时效15%、库存5%；工厂扣10分。orderCount 是该商品订单数，周期和国家未声明，不是90天销量或卖出件数。刊登次数不参与需求评分。</p><p>默认至少1笔订单；0与缺失分别记录，不合格不进入库存与运费研究。仅本批候选比较，建议价仍为广告前核算价，强制两轮确认。</p></section>}{detail.handler==="product.opportunity.v3"&&<section><h3>算法依据 · CJ 自动证据</h3><p>CJ 平台近 90 天销量 45%、到货成本 35%、总时效 15%、库存缓冲 5%，工厂供货扣 10 分。来源自动读取，不需要 JSON 或大模型。</p><p>仅本批候选比较。CJ 刊登数不是销量，90 天销量不是目标国家的 30 天销量；搜索趋势、竞争售价与获客成本未知。缺销量或低于任务门槛暂停，建议价仍为广告前核算价，强制两轮人工确认。</p><Link className="ui-button" href="/workflow/builder">在定义商品任务配置 CJ 自动证据</Link></section>}{detail.handler==="product.opportunity.v2"&&<section><h3>算法依据 · v2</h3><p>需求 30%、销量/搜索趋势 20%、竞争 15%、含广告经营空间 20%、履约 15%；工厂供货扣 10 分。读取两个相邻 30 天窗口；上一窗口为零时趋势计中性 50，不推断无限增长。</p><p>需求分是本批销量与搜索量的相对评分（70/30）；竞争分 = 100 ÷ (1 + 竞品数 ÷ 20)。经营空间按竞品中位价扣费用、到货成本与获客成本计算；履约综合总时效和库存缓冲。权重与参考量是版本化规则，不是已验证预测模型。</p><p>建议售价 = (到货成本 + 获客成本) ÷ (1 − 费用率 − 目标贡献率)。缺字段、无需求、估算未允许、建议价超过竞品中位价时停在评估。导入需真实来源、CJ 对应关系、市场、币种、时间；七天过期，两轮审核强制开启。</p><Link className="ui-button" href="/workflow/builder">先到任务节点配置市场证据，再选择评估策略</Link></section>}{detail.handler==="product.opportunity.v1"&&<section><h3>算法依据 · v1</h3><p>本批最低到货成本 ÷ 当前成本 × 100，得到成本分；本批最短总时效 ÷ 当前总时效 × 100，得到时效分（不足一天按一天计）。库存分为 min(库存 ÷ 50, 1) × 100。</p><p>综合分 = 成本分 × 60% + 时效分 × 25% + 库存分 × 15% − 工厂供货扣分 10。库存 50 件是规则参考值，不是销量预测；工厂数量仅是运营限售量，仍需强制人工核验。</p><p>建议售价 = 到货成本 ÷ (1 − 费用率 − 目标贡献率)，向上取整到美分。到货成本含供货价、运费及明确税费预留；系统核算节点再次独立核对。</p><p>同分依次按成本、时效和规格 ID 排序。只选择一件，其他候选保留。需求、销量、竞争售价与广告成本未知；评分仅比较本批供货可行性，不保证商品好卖。</p><Link className="ui-button" href="/workflow/builder">到“评估商品机会与建议售价”节点选择</Link></section>}<p className={styles.note}>当前支持受信选品算法与内容整理函数。生成代码、上传脚本或填写提示词，不会直接获得执行权限。已登记版本不可覆盖，修改代码后需要新版本及重新确认。</p></Dialog>}
  </>;
}

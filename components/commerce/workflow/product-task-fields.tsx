"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import {Input} from "@/components/ui/input";
import {Button} from "@/components/ui/button";
import {backendRequest} from "@/lib/workflow/backend-client";
import {categoryQueriesFor} from "@/lib/workflow/universal";
import styles from "./workflow.module.css";

type Product={id:string;nameEn:string|null;sellPrice:string|null};
type SearchResult={outcome:string;products:Product[];message:string;market_evidence?:{searched_count:number;matched_count:number;unmatched_ids:string[]};cj_evidence?:{pid:string;sales_90d:number|null;order_count?:number|null;listing_count:number|null}[];cj_evidence_unread?:number};
export const productSearchFields=new Set(["category","categoryId","categoryQueries","keyword","emptyResultPolicy","candidateSource","finalSelectionMode"]);

export function singleKeywordPatch(keyword:string){
  return {keyword,category:"",categoryId:"",categoryQueries:[],emptyResultPolicy:"pause",candidateSource:"catalog"};
}

export function FinalSelectionInfo({parameters,onChange}:{parameters:Record<string,unknown>;onChange:(patch:Record<string,unknown>)=>void}){
  return parameters.finalSelectionMode==='global'?<p>最终选取：所选类目合并评分，按商品最佳合格规格选前 {String(parameters.limit??10)} 款，不限制每个类目的最终数量。各类目的搜索额度仍独立，不扩大搜索范围。</p>:<div><p>当前保存的是旧版按类目分配最终名额。可切换为合并候选池统一选优，保存冻结后生效，旧运行不变。</p><Button onClick={()=>onChange({finalSelectionMode:'global'})}>改为所有类目统一选优</Button></div>;
}

export function ProductTaskFields({parameters,onChange}:{parameters:Record<string,unknown>;onChange:(patch:Record<string,unknown>)=>void}){
  const [notice,setNotice]=useState("");
  const [searching,setSearching]=useState(false);
  const [result,setResult]=useState<SearchResult|null>(null);
  const keyword=String(parameters.keyword??"");
  const oldCategory=!!parameters.category||!!parameters.categoryId||categoryQueriesFor(parameters).length>0||parameters.emptyResultPolicy==='drop_keyword_once';
  const signature=JSON.stringify(parameters);
  useEffect(()=>{setResult(null);},[signature]);
  async function preview(){
    if(!keyword.trim()||oldCategory)return;
    setSearching(true);setNotice("");setResult(null);
    try{setResult(await backendRequest<SearchResult>("connections/cj/search-preview","POST",{
      categoryQueries:[],categoryId:"",keyword:keyword.trim(),emptyResultPolicy:"pause",candidateSource:"catalog",
      market:parameters.market,requestedCurrency:parameters.requestedCurrency,limit:parameters.limit,
      ...(parameters.marketEvidenceRef&&(!parameters.marketEvidenceSource||parameters.marketEvidenceSource==='external')?{marketEvidenceRef:parameters.marketEvidenceRef}:{}),
      ...(parameters.marketEvidenceSource?{marketEvidenceSource:parameters.marketEvidenceSource}:{})}));}
    catch(error){setNotice(error instanceof Error?error.message:"查询失败，请检查连接后重试。");}
    finally{setSearching(false);}
  }
  return <div className={styles.infoBox}>
    <strong>找什么商品 · 一次一个关键词</strong>
    <label className={styles.field}>商品搜索词<Input aria-label="商品搜索词" value={keyword} maxLength={200} disabled={searching} placeholder="例如 cat 或 hat" onChange={e=>onChange(singleKeywordPatch(e.target.value))}/></label>
    <p>输入一个商品方向，例如 cat（猫用品）或 hat（帽子）。系统原样查询 CJ 商品目录，不自动翻译、不叠加隐藏类目。这是关键词匹配，不是 CJ 官方类目或销量榜。</p>
    {oldCategory&&<p role="alert">当前草稿仍保存旧类目或删词重试条件。输入搜索词后会清除旧条件；应用到节点才提交，取消不改变原配置。已冻结运行不变。</p>}
    <p>未搜到商品时暂停并保留搜索词，不自动删词扩大到全目录。</p>
    <p>先排除当前店铺已上架或提交待确认的商品，再检查订单需求。需求达标后核验资料、库存、配送和成本；研究完本次扫描范围后统一评分，选出排名最高的目标数量，不凑够就停。</p>
    <FinalSelectionInfo parameters={parameters} onChange={onChange}/>
    <p>最终选取数量与候选额度分开设置。开启“订单数达标才占候选额度”后，1000 表示订单数达标的候选；低订单、未知、重复和已上架商品不占名额，继续翻页直到额度达到或目录结束。实际请求可能远超1000件，库存与配送仍须核验。CJ 订单数的统计周期未声明，不冒充近90天销量。</p>
    {parameters.demandQualifiedQuota!==true&&<Button onClick={()=>onChange({demandQualifiedQuota:true})}>改为按订单达标候选计数</Button>}
    <Button disabled={searching||!keyword.trim()||oldCategory} onClick={preview}>{searching?"正在查询 CJ…":"试搜商品（只读）"}</Button> <Link href="/connections/cj" target="_blank" rel="noopener noreferrer">配置 CJ 连接 ↗</Link>
    {notice&&<p role="alert">{notice}</p>}
    {result&&<div role="status"><strong>{result.outcome==='market_evidence_missing'?'商品已搜到 · 没有对应市场证据':result.outcome==='no_results'?'查询成功 · 没有匹配商品':result.outcome==='error'?'查询失败':'已读取 CJ 商品样本'}</strong><p>{result.message}</p>
      {result.market_evidence&&<p>原始搜索 {result.market_evidence.searched_count} 件 · 市场证据对应 {result.market_evidence.matched_count} 件 · 未对应 {result.market_evidence.unmatched_ids.length} 件。</p>}
      {result.cj_evidence?.map(row=><p key={row.pid}>商品 {row.pid} · CJ 订单数（周期未声明）：{row.order_count??'未知'} · 近90天销量（参考）：{row.sales_90d??'未知'} · 刊登次数：{row.listing_count??'未知'}（不是销量）</p>)}
      {result.cj_evidence&&<p>试搜仅额外核验前三件订单证据，未读取 {result.cj_evidence_unread??0} 件；不代表最终合格商品。</p>}
      <p>预览商品：{result.products.length} 件</p>{result.products.map(p=><p key={p.id}>{p.nameEn||p.id} · CJ 供货价 USD {p.sellPrice??"未知"}</p>)}
      <small>只读试搜最多 20 件，不启动发布，不将预览样本当成最终商品。</small></div>}
  </div>;
}

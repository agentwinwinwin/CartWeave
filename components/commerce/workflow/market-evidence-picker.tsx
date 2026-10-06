'use client';
import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {SelectField} from '@/components/ui/select-field';
import {Switch} from '@/components/ui/switch';
import {backendRequest} from '@/lib/workflow/backend-client';
type Evidence={id:string;name:string;digest:string;document:{market:string;currency:string;channel:string;source_name:string;period_end:string;rows:unknown[]}};
export function MarketEvidencePicker({value,onChange}:{value:string;onChange:(reference:string)=>void}){
 const [rows,setRows]=useState<Evidence[]>([]),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[confirmed,setConfirmed]=useState(false);
 const file=useRef<HTMLInputElement>(null);
 async function load(){setBusy(true);try{setRows(await backendRequest<Evidence[]>('market-evidence'));}catch(e){setNotice(e instanceof Error?e.message:'读取失败');}finally{setBusy(false);}}
 useEffect(()=>{void load();},[]);
 function template(){const date=new Date().toISOString().slice(0,10);const data={schema_version:'MarketEvidence@1',name:'我的市场证据',market:'US',currency:'USD',channel:'填写数据来源渠道',source_name:'填写真实数据来源',source_url:'https://your-source.example/report',observed_on:date,period_end:date,rows:[{cj_pid:'填写对应的 CJ 商品 PID',match_note:'填写实际商品对应依据，不是类目平均数据',sales_kind:'observed',sales_30d:null,previous_sales_30d:null,searches_30d:null,previous_searches_30d:null,competitor_count:null,competitor_median_price:null,acquisition_cost:null}]};const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='market-evidence-template.json';a.click();URL.revokeObjectURL(url);}
 const selected=rows.find(row=>row.id===value);
 return <section><h3>销量、趋势与竞争证据</h3><p>在试搜前确定证据。两个相邻 30 天窗口，按 CJ 商品 PID 对应目标市场；试搜和正式采集仅让本次搜索中有对应证据的商品继续研究，不扩大类目或把库存当销量。应用到节点时同步绑定已审核的 v2 策略，评估节点继承这里的证据，不需再次手选。</p><p>未接入自动销量采集，先导入有来源的资料，不下载或抓取来源链接。这里仅核对商品对应；完整评分必须等 CJ 库存、运费和成本核验后执行，缺少销量等字段仍会停在评估。核算节点的目标贡献率在 v2 表示扣除所填获客成本后的目标。</p><label>选择市场证据版本<SelectField aria-label="市场证据版本" value={value} disabled={busy} onChange={e=>onChange(e.target.value)}><option value="">请选择已导入的证据批次</option>{value&&!selected&&<option value={value}>当前引用待核验</option>}{rows.map(row=><option key={row.id} value={row.id}>{row.name} · {row.document.market}/{row.document.currency} · 截至 {row.document.period_end}</option>)}</SelectField></label>
 {selected&&<p>来源：{selected.document.source_name} · 渠道：{selected.document.channel} · {selected.document.rows.length} 件商品 · 摘要 {selected.digest.slice(0,12)}。人工导入，未独立核实；本机桌面版按审核开关执行，团队部署仍需两轮审核。结束窗口或采集时间超过七天须新证据和新冻结版本。</p>}
 <div><Button compact onClick={template}>下载证据模板</Button> <Button compact disabled={busy} onClick={load}>刷新证据</Button></div>
 <Switch checked={confirmed} onCheckedChange={setConfirmed}>我已核对来源、观察/估算标记、窗口和商品对应关系；导入不是系统核实销量</Switch>
 <Button compact disabled={busy||!confirmed} onClick={()=>file.current?.click()}>导入证据 JSON 并选择</Button>
 <input ref={file} type="file" accept="application/json,.json" hidden aria-label="导入市场证据文件" onChange={e=>{const input=e.currentTarget;const chosen=input.files?.[0];if(!chosen)return;void(async()=>{setBusy(true);try{if(chosen.size>100000)throw Error('证据文件不能超过 100KB。');const document=JSON.parse(await chosen.text());const row=await backendRequest<Evidence>('market-evidence','POST',{document,confirmed_source:confirmed});setRows(list=>[row,...list]);onChange(row.id);setNotice('证据已保存为不可变版本并选中；请应用到节点，保存并冻结流程。');setConfirmed(false);}catch(error){setNotice(error instanceof Error?error.message:'导入失败');}finally{setBusy(false);input.value='';}})();}}/>
 {notice&&<p role="status">{notice}</p>}
 </section>;
}

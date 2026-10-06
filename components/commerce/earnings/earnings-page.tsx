'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {PageHeader} from '@/components/app/page-header';
import {FeatureNotice} from '@/components/app/feature-notice';
import {Card} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {Input} from '@/components/ui/input';
import {SelectField} from '@/components/ui/select-field';
import {StatCard} from '@/components/ui/stat-card';
import {DataTable,type TableColumn} from '@/components/ui/data-table';
import {backendRequest} from '@/lib/workflow/backend-client';
import {money,calendarToday,shiftDay,costLabels,type EarningsReport,type EarningsRow} from '@/lib/earnings';
import styles from './earnings.module.css';
import {BusinessSyncBar} from '@/components/commerce/business/business-sync-bar';

function Trend({data}:{data:EarningsReport}){
 const points=data.daily,values=points.flatMap(p=>[p.net_sales,p.operating_profit]).filter((v):v is string=>v!==null).map(Number);
 if(!values.length)return <div className={styles.emptyChart}><strong>{data.status==='no_data'?'当前范围没有收益记录':'等待真实收益数据'}</strong><p>有真实订单与费用后显示趋势，不使用演示曲线。</p></div>;
 const min=Math.min(0,...values),max=Math.max(1,...values),x=(i:number)=>52+i*648/Math.max(1,points.length-1),y=(v:number)=>185-(v-min)/(max-min)*155;
 const line=(key:'net_sales'|'operating_profit')=>{let gap=true;return points.map((p,i)=>{if(p[key]===null){gap=true;return '';}const cmd=gap?'M':'L';gap=false;return `${cmd}${x(i)},${y(Number(p[key]))}`;}).join(' ');};
 return <><svg className={styles.chart} viewBox="0 0 740 225" role="img" aria-label="每日净销售额与运营利润趋势"><line x1="52" y1={y(0)} x2="700" y2={y(0)} className={styles.grid}/><text x="8" y="30">{max.toFixed(0)}</text><text x="8" y="185">{min.toFixed(0)}</text><path d={line('net_sales')} className={styles.sales}/><path d={line('operating_profit')} className={styles.profit}/>{points.map((p,i)=><g key={p.date}>{p.net_sales!==null&&<circle cx={x(i)} cy={y(Number(p.net_sales))} r="3" className={styles.salesDot}><title>{p.date} · 净销售额 {money(p.net_sales,data.currency)}</title></circle>}{p.operating_profit!==null&&<circle cx={x(i)} cy={y(Number(p.operating_profit))} r="3" className={styles.profitDot}><title>{p.date} · 运营利润 {money(p.operating_profit,data.currency)}</title></circle>}</g>)}<text x="52" y="215">{data.start}</text><text x="700" y="215" textAnchor="end">{data.end}</text></svg><p className={styles.help}>无订单或成本不齐的日期留空，不连成零利润。</p></>;
}

export function EarningsPage(){
 const [tz,setTz]=useState('Asia/Shanghai'),[currency,setCurrency]=useState('USD'),[store,setStore]=useState('');
 const [start,setStart]=useState(()=>shiftDay(calendarToday('Asia/Shanghai'),-6)),[end,setEnd]=useState(()=>calendarToday('Asia/Shanghai'));
 const [page,setPage]=useState(1),[tick,setTick]=useState(0),[data,setData]=useState<EarningsReport|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
 useEffect(()=>{let active=true;setData(null);setError('');setLoading(true);if(!start||!end||start>end){setError('请选择有效日期范围，开始日期不能晚于结束日期。');setLoading(false);return;}
  const params=new URLSearchParams({start,end,currency,timezone:tz,store,page:String(page)});
  backendRequest<EarningsReport>(`earnings?${params}`).then(r=>{if(active)setData(r);}).catch(e=>{if(active)setError(e instanceof Error?e.message:'收益读取失败');}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};
 },[start,end,currency,tz,store,page,tick]);
 const refresh=()=>setTick(v=>v+1);
 const preset=(days:number,yesterday=false)=>{const last=shiftDay(calendarToday(tz),yesterday?-1:0);setEnd(last);setStart(shiftDay(last,-days+1));setPage(1);};
 const summary=data?.summary,noData=data?.status!=='ready';
 const metric=(v:string|null|undefined)=>loading?'—':v==null?(data?.status==='no_data'?'无账目':noData?'待接入':'待核算'):money(v,currency);
 const cols:TableColumn<EarningsRow>[]=[
  {key:'order_id',label:'订单 / 店铺',render:r=><div><strong>{r.order_id}</strong><small>{r.store_name}</small></div>},
  {key:'paid_at',label:'付款日期',render:r=>new Date(r.paid_at).toLocaleDateString('zh-CN',{timeZone:tz})},
  {key:'net_sales',label:'净销售额',render:r=>money(r.net_sales,currency)},
  {key:'costs',label:'费用明细',render:r=><details><summary>查看成本</summary><dl>{Object.entries(costLabels).map(([key,label])=><div key={key}><dt>{label}</dt><dd>{money(r.costs[key as keyof typeof costLabels],currency)}</dd></div>)}<div><dt>代收税款 / 已退税</dt><dd>{money(r.tax_collected,currency)} / {money(r.tax_refunded,currency)}</dd></div></dl></details>},
  {key:'operating_profit',label:'运营利润',render:r=><div><strong>{money(r.operating_profit,currency)}</strong>{r.operating_profit===null&&r.profit_before_ads!==null&&<small>广告前 {money(r.profit_before_ads,currency)}</small>}</div>},
  {key:'missing_costs',label:'核算状态',render:r=><div><Badge tone={r.missing_costs.length?'warning':'success'}>{r.missing_costs.length?'待补成本':'成本齐全'}</Badge>{r.missing_costs.length>0&&<small>缺少：{r.missing_costs.map(k=>costLabels[k]).join('、')}</small>}</div>},
  {key:'source_ref',label:'账目依据',render:r=><details><summary>来源 · v{r.revision}</summary><p>{r.source_ref}</p><small>观测于 {new Date(r.observed_at).toLocaleString('zh-CN',{timeZone:tz})}</small></details>},
 ];
 return <><PageHeader title="收益" description="看清每天赚了多少，也看清哪些成本还没有算齐。" actions={<BusinessSyncBar refreshAction={<Button compact disabled={loading} onClick={refresh}>{loading?'读取中…':'刷新账目'}</Button>} kind="finance" stores={data?.stores??[]} store={store} onStoreChange={value=>{setStore(value);setPage(1);}} onUpdated={refresh}/>}/>
 <Card className={styles.filters}><div className={styles.presets}>{[['今天',1],['昨天',1],['近 7 天',7],['近 30 天',30]].map(([label,days])=><Button key={label} compact onClick={()=>preset(Number(days),label==='昨天')}>{label}</Button>)}</div><div className={styles.fields}><label>开始日期<Input type="date" aria-label="收益开始日期" value={start} onChange={e=>{setStart(e.target.value);setPage(1);}}/></label><label>结束日期<Input type="date" aria-label="收益结束日期" value={end} onChange={e=>{setEnd(e.target.value);setPage(1);}}/></label><label>币种<SelectField aria-label="收益币种" value={currency} onChange={e=>{setCurrency(e.target.value);setPage(1);}}>{['USD','EUR','GBP','CNY'].map(c=><option key={c}>{c}</option>)}</SelectField></label><label>统计时区<SelectField aria-label="收益时区" value={tz} onChange={e=>{setTz(e.target.value);setPage(1);}}>{[['Asia/Shanghai','北京时间'],['UTC','UTC'],['America/New_York','纽约时间'],['Europe/London','伦敦时间']].map(([id,label])=><option key={id} value={id}>{label}</option>)}</SelectField></label></div></Card>
 {error?<div role="alert" className="empty-state">{error}<p>没有回退到演示账目。</p><Button onClick={refresh}>重新读取</Button></div>:<>
 {data?.status==='awaiting_connection'&&<FeatureNotice title="真实账目 · 等待接口资料">在店铺接入中验收读取能力后，点击页头的同步数据。只有实际收款、退款和成本事实才进入账目；模拟结账、CJ 销量和建议售价不充当收入。<Link href="/workflow/builder">查看店铺接入 ↗</Link></FeatureNotice>}
 {data?.status==='no_data'&&<FeatureNotice title="当前范围没有账目">请检查日期、店铺和币种；没有账目不等于已经确认零收入。</FeatureNotice>}
 <div className={`page-stat-grid ${styles.metrics}`}><StatCard label="净销售额" value={metric(summary?.net_sales)} change="不含代收税款 · 已扣净退款" tone="blue"/><StatCard label="已核实运营利润" value={metric(summary?.operating_profit)} change={summary?.pending_cost_orders?`${summary.pending_cost_orders} 单成本未齐，暂不合计利润`:'已扣实际采购、配送、手续费、广告及其他费用'} tone="green"/><StatCard label="待补成本订单" value={summary?String(summary.pending_cost_orders):'—'} change={summary?`已完整核算 ${summary.complete_orders} / ${summary.orders} 单`:'等待真实订单'} tone="slate"/><StatCard label="退款金额" value={metric(summary?.refunds)} change="不含退还的代收税款" tone="red"/></div>
 {summary&&summary.operating_profit===null&&summary.profit_before_ads!==null&&<FeatureNotice title="广告费用尚未齐全">当前可核算广告前利润：{money(summary.profit_before_ads,currency)}。它不是净利润，也不是实际到账金额。</FeatureNotice>}
 <Card className={styles.trend}><div className={styles.heading}><div><h2>每日收益趋势</h2><p>按付款日期归属 · {currency} · {tz}</p></div><div className={styles.legend}><span>净销售额</span><span>运营利润</span></div></div>{data?<Trend data={data}/>:<div className={styles.emptyChart}>正在读取账目…</div>}</Card>
 <Card className={styles.records}><div className={styles.heading}><div><h2>订单收益明细</h2><p>退款与成本补齐后更新原付款日；不是当天银行到账流水。</p></div><Badge tone="neutral">确定性核算 · 不使用 LLM</Badge></div><DataTable className={styles.table} columns={cols} rows={data?.results??[]} emptyText={loading?'正在读取订单账目…':'暂无真实订单账目。接入数据后，订单和费用将显示在这里。'}/><footer className="table-footer"><span>共 {data?.count??0} 笔 · {data?.latest_observed_at?`最新资料 ${new Date(data.latest_observed_at).toLocaleString('zh-CN',{timeZone:tz})}`:'尚无来源记录'}</span><div><Button compact disabled={loading||page===1} onClick={()=>setPage(v=>v-1)}>上一页</Button><span>第 {page} 页</span><Button compact disabled={loading||!data||page*data.page_size>=data.count} onClick={()=>setPage(v=>v+1)}>下一页</Button></div></footer></Card>
 <details className={styles.rules}><summary>收益怎么算？</summary><p>运营利润 = 收款 − 代收税款 − 净退款 − 采购成本 − 配送成本 − 平台 / 支付手续费 − 广告费 − 其他费用。所有费用均须有实际依据；明确为零的费用与未知费用不同。</p><p>这是订单级运营核算，不包含尚未登记的固定开支或所得税，不是会计净利润。币种分别统计，不自动换汇；未完整核算的订单不会被当作零成本混入利润合计。</p><p>账目通过店铺接口包的 finance.read 同步，由后端验证来源、幂等事件及版本。测试站尚未接入真实付款和广告服务；前端模拟付款与选品报价不能写入实际收益。</p></details>
 </>}
 </>;
}

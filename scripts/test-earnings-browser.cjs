// All financial fixtures are intercepted. Real verification is GET-only, never seeded.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const { chromium } = require("./browser-runtime.cjs");
(async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}});let mode='empty';const errors=[],queries=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/backend/v1/**',async route=>{
   const req=route.request(),url=new URL(req.url());assert.equal(req.method(),'GET');
   if(url.pathname==='/backend/v1/auth/session')return route.fulfill({json:{authenticated:true,mode:'desktop',csrf_token:'mock',user:{username:'mock',role:'admin'}}});
   assert.equal(url.pathname,'/backend/v1/earnings');queries.push(url.searchParams);
   if(mode==='error')return route.fulfill({status:503,json:{detail:'Mock finance offline'}});
   const exists=mode!=='empty'&&url.searchParams.get('currency')==='USD',pending=mode==='pending',end=url.searchParams.get('end');
   const totals={orders:exists?1:0,pending_cost_orders:exists&&pending?1:0,complete_orders:exists&&!pending?1:0,net_sales:exists?'80.00':null,refunds:exists?'20.00':null,operating_profit:exists&&!pending?'42.00':null,profit_before_ads:exists?'47.00':null};
   const row={id:'mock-financial-fact',order_id:'MOCK-ORDER',store_name:'模拟店铺',currency:'USD',paid_at:end+'T00:00:00Z',observed_at:end+'T12:00:00Z',revision:1,source_ref:'Browser fixture only',paid_total:'110.00',tax_collected:'10.00',refund_total:'22.00',tax_refunded:'2.00',costs:{procurement:'20.00',shipping:'10.00',platform_payment:'3.00',advertising:pending?null:'5.00',other:'0.00'},missing_costs:pending?['advertising']:[],net_sales:'80.00',refunds:'20.00',operating_profit:pending?null:'42.00',profit_before_ads:'47.00'};
   return route.fulfill({json:{status:exists?'ready':mode==='empty'?'awaiting_connection':'no_data',summary:totals,daily:[{date:end,...totals}],results:exists?[row]:[],count:exists?1:0,page:1,page_size:50,currency:url.searchParams.get('currency'),timezone:url.searchParams.get('timezone'),start:url.searchParams.get('start'),end,stores:[{id:'mock-store',name:'模拟店铺'}],latest_observed_at:exists?row.observed_at:null,basis:'paid_date_latest_facts',connectors:{orders:'not_implemented',actual_costs:'not_implemented',advertising:'not_implemented'}}});
  });
  await page.goto('http://localhost:3000/earnings');
  await page.getByText('真实账目 · 待接入',{exact:true}).waitFor();
  await page.getByText('等待真实收益数据',{exact:true}).waitFor();
  assert.equal(await page.locator('svg[aria-label="每日净销售额与运营利润趋势"]').count(),0);
  fs.mkdirSync('/private/tmp/oceanflow-earnings',{recursive:true});
  await page.screenshot({path:'/private/tmp/oceanflow-earnings/empty.png',fullPage:true});
  mode='ready';await page.getByRole('button',{name:'刷新账目',exact:true}).click();
  await page.getByText('MOCK-ORDER',{exact:true}).waitFor();
  const chart=page.getByRole('img',{name:'每日净销售额与运营利润趋势'});await chart.waitFor();
  await page.getByText('查看成本',{exact:true}).click();
  await page.getByText('采购成本',{exact:true}).waitFor();
  for(const width of [1440,1100,760,390]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'overflow '+width);await page.screenshot({path:`/private/tmp/oceanflow-earnings/${width}.png`,fullPage:true});}
  mode='pending';await page.getByRole('button',{name:'刷新账目',exact:true}).click();
  await page.getByText('广告费用尚未齐全',{exact:true}).waitFor();
  await page.getByText('缺少：广告费',{exact:true}).waitFor();
  await page.getByLabel('收益币种').selectOption('EUR');
  await page.getByText('当前范围没有账目',{exact:true}).waitFor();
  assert.equal(queries.at(-1).get('currency'),'EUR');
  await page.getByLabel('收益时区').selectOption('America/New_York');
  await page.getByRole('button',{name:'今天',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[aria-label="收益开始日期"]').value===document.querySelector('[aria-label="收益结束日期"]').value);
  mode='error';await page.getByRole('button',{name:'刷新账目',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Mock finance offline'}).waitFor();
  assert.equal(await page.getByText('MOCK-ORDER',{exact:true}).count(),0);assert.deepEqual(errors,[]);
  const real=await browser.newPage();const response=await real.request.get('http://localhost:3000/backend/v1/earnings');assert.equal(response.status(),200);
  const report=await response.json();assert(['awaiting_connection','no_data','ready'].includes(report.status));
  await real.goto('http://localhost:3000/earnings');await real.getByRole('heading',{name:'收益',exact:true}).waitFor();
  console.log('Earnings empty, actual-fact fixtures, missing advertising, filters, responsive states and read-only backend passed. No financial records created.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

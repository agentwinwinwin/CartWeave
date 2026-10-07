// Intercepted transports. No real customers, models, finance writes or image charges.
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require(process.env.CODEX_NODE_MODULES?path.join(process.env.CODEX_NODE_MODULES,'playwright'):'playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));let records=[],posts=0;
  await page.route('**/backend/v1/**',async route=>{
   const req=route.request(),url=new URL(req.url()).pathname;
   if(url.endsWith('/auth/session'))return route.fulfill({json:{authenticated:true,csrf_token:'fixture',mode:'desktop'}});
   if(url.endsWith('/model-connections'))return route.fulfill({json:[]});
   if(url.includes('/operation-reports/')){
    const kind=url.split('/').pop();
    if(req.method()==='POST'){posts++;const body=req.postDataJSON();assert(body.request_key);const support=kind==='support';if(support)assert.equal(body.sample_knowledge_confirmed,true);
     const row={id:'fixture-'+kind,kind,created_at:new Date().toISOString(),payload:support?{status:'awaiting_review',mode:'fixture',revision:1,customer_message:body.message,reply:{reply:'模拟政策：标准配送 3–7 个工作日。',questions:[],citations:['Shipping'],handoff_required:false},events:[{step:1,label:'模拟接收消息'}],evidence:[]}:{status:'archived',currency:'USD',summary:{orders:0,net_sales:null,operating_profit:null,pending_cost_orders:0},recommendations:['先同步真实订单及财务事实。']}};records=[row,...records.filter(r=>r.kind!==kind)];return route.fulfill({json:row,status:201});}
    return route.fulfill({json:{results:records.filter(r=>r.kind===kind),count:records.filter(r=>r.kind===kind).length,page:1,legacy_drafts:[]}});
   }
   if(url.endsWith('/operation-report/fixture-support')){posts++;const row=records.find(r=>r.kind==='support');row.payload.status='archived';row.payload.revision=2;row.payload.events.push({step:7,label:'归档模拟客服记录'});return route.fulfill({json:row});}
   if(url.endsWith('/workflow-designs')||url.endsWith('/skills')||url.endsWith('/stores')||url.endsWith('/runs')||url.endsWith('/market-evidence'))return route.fulfill({json:[]});
   if(url.endsWith('/node-definitions'))return route.fulfill({json:{nodes:[]}});
   throw Error('Unexpected request '+url);
  });
  await page.goto('http://localhost:3000/assistant');await page.getByRole('heading',{name:'客服',exact:true}).waitFor();assert(page.url().endsWith('/support'));assert.equal(posts,0);
  assert.equal(await page.getByRole('link',{name:'对话 AI',exact:true}).count(),0);
  await page.getByLabel(/我确认使用 Northwind/).check();await page.getByRole('button',{name:'检索知识并生成回复',exact:true}).click();
  await page.getByText('模拟政策：标准配送 3–7 个工作日。',{exact:true}).waitFor();
  await page.getByRole('button',{name:'确认回复并完成模拟链路'}).click();await page.getByText('归档模拟客服记录',{exact:false}).waitFor();
  await page.reload();await page.getByText('模拟政策：标准配送 3–7 个工作日。',{exact:true}).waitFor();assert.equal(posts,2);
  await page.goto('http://localhost:3000/reviews');await page.getByRole('button',{name:'核算并归档复盘'}).click();await page.getByText('经营事实快照',{exact:true}).waitFor();assert.equal(await page.getByText('未知',{exact:true}).count(),2);
  for(const width of [1100,760,390]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'page overflow');}
  await page.setViewportSize({width:1440,height:1000});await page.goto('http://localhost:3000/workflow/builder?template=support');
  await page.getByRole('button',{name:'执行客服 Skill',exact:true}).click();await page.getByRole('dialog',{name:'智能客服节点执行'}).waitFor();await page.getByRole('heading',{name:'客服测试台',exact:true}).waitFor();await page.keyboard.press('Escape');
  await page.goto('http://localhost:3000/workflow/builder?template=optimize');await page.getByRole('button',{name:'生成复盘报告',exact:true}).click();await page.getByRole('dialog',{name:'经营复盘节点'}).waitFor();
  assert.deepEqual(errors,[]);console.log('Passed module navigation, explicit support simulation, persistence, unknown profit, same-canvas windows and responsive layouts; mock transports only.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

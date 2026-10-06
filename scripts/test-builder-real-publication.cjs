// Creates ONE real local test-store product via the node's existing seven-step runner.
// Explicitly approves synthetic test evidence twice. No purchasing/payment/shipping.
const assert=require('node:assert/strict'),path=require('node:path');
const { chromium } = require("./browser-runtime.cjs");
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://localhost:3000/workflow/builder');
  await page.getByRole('button',{name:/准备渠道发布数据/}).first().click();
  const mapping=page.getByRole('dialog',{name:'接口字段映射节点'});
  await mapping.getByRole('button',{name:'保存店铺与接口包配置',exact:true}).waitFor();
  await page.waitForFunction(()=>{const b=[...document.querySelectorAll('dialog button')].find(b=>b.textContent==='保存店铺与接口包配置');return b&&!b.disabled;});
  assert.equal(await mapping.getByLabel('模型 ID',{exact:true}).count(),0,'Installed adapter requires no model');
  const storeId=await mapping.getByLabel('真实发布店铺').inputValue();assert(storeId);
  await mapping.getByRole('button',{name:'保存店铺与接口包配置',exact:true}).click();
  await page.getByRole('button',{name:'检查配置',exact:true}).click();
  await page.waitForFunction(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent==='▶ 演示流程');return b&&!b.disabled;});
  await page.getByRole('button',{name:/提交渠道发布/}).first().click();
  const publisher=page.getByRole('dialog',{name:'提交渠道发布节点'});
  await publisher.getByText('旧七步测试站主线联调（不是本图运行）',{exact:true}).click();
  await publisher.getByRole('button',{name:'打开真实发布联调',exact:true}).click();
  const test=publisher.getByRole('region',{name:'真实发布联调'});
  await test.getByRole('button',{name:'创建真实发布任务',exact:true}).waitFor();
  assert.equal(await test.getByRole('checkbox').count(),0,'Test must keep both reviews on');
  assert.equal(await test.getByLabel('商品标题',{exact:true}).isVisible(),false,'Do not force duplicate editing');
  await page.screenshot({path:'/tmp/commerceos-publishing-ready.png'});
  let run;
  if(process.env.EXISTING_RUN_ID){
   const rows=await (await page.request.get('http://localhost:3000/backend/v1/runs')).json();
   const index=rows.findIndex(r=>r.id===process.env.EXISTING_RUN_ID);assert(index>=0);
   run=rows[index];assert.equal(run.status,'waiting_approval');assert.equal(run.cursor,0);
   // Recovery after a interrupted assertion; select existing history without another POST.
   await test.locator('aside button').nth(index).evaluate(el=>el.click());
  }else{
   const created=page.waitForResponse(r=>r.url().endsWith('/backend/v1/runs')&&r.request().method()==='POST');
   await test.getByRole('button',{name:'创建真实发布任务',exact:true}).click();
   const response=await created;assert.equal(response.status(),202);run=await response.json();
  }
  assert.equal(run.context.brief.source_kind,'test_fixture');assert(run.context.brief.product_id.startsWith('integration-'));
  for(const title of ['第一轮：确认商品与售价','第二轮：审核最终上架草稿']){
   await test.getByRole('heading',{name:title,exact:true}).waitFor({timeout:60000});
   await test.getByLabel('审批原因',{exact:true}).fill('授权的节点接入联调：合成测试商品，已核对测试素材、价格与规格；无采购付款。');
   await test.getByRole('button',{name:'批准当前版本',exact:true}).click();
  }
  await test.getByRole('heading',{name:'已确认可售',exact:true}).waitFor({timeout:60000});
  const final=await (await page.request.get(`http://localhost:3000/backend/v1/runs/${run.id}`)).json();
  assert.equal(final.status,'succeeded');assert.equal(final.approvals.filter(a=>a.status==='approved').length,2);
  assert.equal(final.context.published.product_id,run.context.brief.product_id);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({runId:run.id,productId:final.context.published.product_id,storeId,status:final.status,scope:'real seven-step test-store publication; not v2 DAG or CJ selection'}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

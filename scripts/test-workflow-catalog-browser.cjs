// Isolated UI checks: no credentials, model calls or business writes.
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require(process.env.CODEX_NODE_MODULES?path.join(process.env.CODEX_NODE_MODULES,'playwright'):'playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/backend/v1/**',route=>{assert.equal(route.request().method(),'GET');return route.fulfill({json:[]});});
  await page.goto('http://localhost:3000/workflow');
  await page.getByRole('button',{name:'打开选品到上线',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:/^打开(选品到上线|商品图生成|推广与首次投放|订单到交付|经营复盘与调整|智能客服)$/}).count(),6);
  assert.equal(await page.getByText('接口与策略可以换，系统检查不能跳过。',{exact:true}).count(),0);
  assert.equal(await page.getByText('本地设计预览 · 尚未连接执行服务',{exact:true}).count(),0);
  assert(await page.getByRole('button',{name:'继续最近编辑 ↗',exact:true}).isDisabled());
  for(const width of [1440,1100,760,390]){
   await page.setViewportSize({width,height:1000});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:'/private/tmp/workflow-catalog-ui.png',fullPage:true});
  await page.getByRole('textbox',{name:'搜索业务流程'}).fill('客服');
  assert.equal(await page.getByRole('button',{name:'打开选品到上线',exact:true}).count(),0);
  await page.getByRole('button',{name:'打开智能客服',exact:true}).waitFor();
  await page.getByRole('textbox',{name:'搜索业务流程'}).fill('no-match-fixture');
  await page.getByText('没有匹配的业务流程。',{exact:false}).waitFor();
  await page.getByRole('button',{name:'清除搜索',exact:true}).click();
  await page.getByRole('button',{name:'策略与工具',exact:true}).click();
  await page.getByRole('heading',{name:'脚本',exact:true}).waitFor();
  await page.getByRole('button',{name:'业务流程',exact:true}).click();
  await page.getByRole('button',{name:'打开智能客服',exact:true}).click();
  await page.waitForURL('**/workflow/builder?template=support');
  await page.getByRole('heading',{name:'智能客服',exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('Workflow catalog: clean cards, search, tabs, navigation and 1440/1100/760/390 layouts passed (mock only).');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

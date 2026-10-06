// All writes are intercepted. No real design, selection or publication is created.
const assert=require('node:assert/strict');
const { chromium } = require("./browser-runtime.cjs");
(async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{
  const page=await browser.newPage();let saved=null,revision=0,writes=0,acceptFreeze=false,runRequests=0;const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/backend/v1/**',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.pathname.endsWith('/auth/session'))return route.fulfill({json:{authenticated:true,csrf_token:'mock',mode:'desktop',user:{username:'mock',role:'admin',team_id:'mock'}}});
   if(url.pathname.endsWith('/workflow-designs')){
    if(request.method()==='GET')return route.fulfill({json:saved?[saved]:[]});
    const body=request.postDataJSON();assert.equal(body.expected_revision,revision);writes++;revision++;saved={id:'mock-design',revision,document:body.document,digest:'a'.repeat(64)};return route.fulfill({json:saved});
   }
   if(url.pathname.endsWith('/freeze'))return acceptFreeze?route.fulfill({json:{id:'mock-release',revision,digest:'a'.repeat(64),document:saved.document,version_id:'mock-version',store_id:'mock-store',store_version:1,scope:'phase-one-publication'}}):route.fulfill({status:422,json:{code:'business_rule',detail:{node_id:saved.document.nodes.find(n=>n.definitionId==='product.decide').id,message:'请选择已注册的商品机会与售价建议',hint:'应用到节点后重新保存冻结。'}}});
   if(url.pathname.endsWith('/workflow-releases/mock-release'))return route.fulfill({json:{id:'mock-release',revision,digest:'a'.repeat(64),document:saved.document,version_id:'mock-version',store_id:'mock-store',store_version:1,scope:'phase-one-publication'}});
   if(url.pathname.endsWith('/stores'))return route.fulfill({json:[{id:'mock-store',name:'Frozen mock store',verified:true,active:true}]});
   if(url.pathname.endsWith('/node-definitions'))return route.fulfill({json:{nodes:[]}});
   if(url.pathname.endsWith('/runs')){if(request.method()==='GET')return route.fulfill({json:[]});runRequests++;assert.equal(request.postDataJSON().version_id,'mock-version');assert.equal(request.postDataJSON().store_id,'mock-store');return route.fulfill({status:422,json:{detail:'Mock run inspected, not executed'}});}
   if(url.pathname.endsWith('/templates'))return route.fulfill({json:{document:{nodes:[]},skill_id:'ignored',brief:{product_id:'mock-product',title:'Mock input',description:'Mock description',variants:[{price:'20'}],source_kind:'test_fixture'}}});
   if(url.pathname.endsWith('/skills'))return route.fulfill({json:[]});
   return route.fulfill({status:503,json:{detail:'Mock unavailable'}});
  });
  await page.goto('http://localhost:3000/workflow/builder');
  await page.getByRole('button',{name:'保存配置',exact:true}).click();
  await page.getByText(/配置已保存到后端/).waitFor();
  assert.equal(writes,1);
  saved.document.title='后端保存的流程标题';
  await page.reload();
  await page.getByRole('heading',{name:'后端保存的流程标题',exact:true}).waitFor();
  assert.equal(await page.locator('dialog[open]').count(),0);
  await page.getByRole('button',{name:'校验并冻结',exact:true}).click();
  await page.getByText(/配置已保存，但冻结运行未通过/).waitFor();
  assert.equal(writes,2);
  assert(await page.getByText(/请选择已注册的商品机会与售价建议/).isVisible());
  await page.getByRole('button',{name:'配置报错节点 ↗',exact:true}).click();
  await page.getByRole('heading',{name:'评估商品机会与建议售价',exact:true}).waitFor();
  await page.getByRole('button',{name:'关闭节点配置',exact:true}).click();
  assert.equal(await page.getByRole('link',{name:'运行冻结版本 ↗'}).count(),0);
  // Server acceptance is mocked here; supported seven-step release is tested by Django.
  acceptFreeze=true;
  await page.getByRole('button',{name:'▶ 运行流程',exact:true}).click();
  await page.getByRole('region',{name:'当前流程真实运行'}).waitFor();
  await page.getByText(/使用后端冻结配置/).waitFor();
  assert.equal(new URL(page.url()).pathname,'/workflow/builder');
  assert.equal(await page.getByRole('switch',{name:'商品与售价人工审核'}).count(),0);
  assert(await page.getByRole('combobox').filter({has:page.locator('option[value="mock-store"]')}).isDisabled());
  await page.getByRole('button',{name:'创建真实发布任务',exact:true}).click();
  await page.getByText(/Mock run inspected/).waitFor();assert.equal(runRequests,1);
  assert.deepEqual(errors,[]);
  console.log('Backend configuration save, reload restoration and unsupported-graph blocking passed (mock writes only).');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

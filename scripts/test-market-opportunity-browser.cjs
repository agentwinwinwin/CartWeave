// Reads actual registry. Evidence import and configuration save are intercepted; no user records are created.
const assert=require('node:assert/strict');
const { chromium } = require("./browser-runtime.cjs");
(async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{
  const page=await browser.newPage();let imported=null,saved=null;const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/backend/v1/**',async route=>{
   const request=route.request(),path=new URL(request.url()).pathname;
   if(path.endsWith('/connections/cj/categories'))return route.fulfill({json:{categories:[]}});
   if(path.endsWith('/connections/cj/search-preview')){
    assert.equal(request.postDataJSON().marketEvidenceRef,imported.id);
    return route.fulfill({json:{outcome:'results',message:'Synthetic evidence join',products:[],groups:[],market_evidence:{searched_count:2,matched_count:1,unmatched_ids:['not-matched']}}});
   }
   if(path.endsWith('/market-evidence')){
    if(request.method()==='GET')return route.fulfill({json:[]});
    const body=request.postDataJSON();assert.equal(body.confirmed_source,true);imported={id:'11111111-1111-4111-8111-111111111111',name:body.document.name,document:body.document,digest:'a'.repeat(64)};return route.fulfill({json:imported,status:201});
   }
   if(path.endsWith('/workflow-designs')&&request.method()==='POST'){saved=request.postDataJSON().document;return route.fulfill({json:{id:'mock-save',document:saved,revision:1,digest:'b'.repeat(64)}});}
   if(request.method()!=='GET')throw Error('Unexpected real backend mutation');
   await route.continue();
  });
  await page.goto('http://localhost:3000/skills');
  await page.getByRole('button',{name:/已注册版本/}).click();
  await page.getByLabel('技能分类').selectOption('selection');
  const card=page.locator('.ui-card').filter({has:page.getByRole('heading',{name:'销量趋势与竞争选品',exact:true})});
  await card.getByRole('button',{name:'查看版本',exact:true}).click();
  await page.getByRole('heading',{name:'算法依据 · v2',exact:true}).waitFor();
  await page.getByRole('button',{name:'关闭技能窗口',exact:true}).click();
  await page.goto('http://localhost:3000/workflow/builder');
  await page.getByRole('button',{name:'打开定义商品任务',exact:true}).click();
  await page.getByLabel('市场证据来源',{exact:true}).selectOption('external');
  await page.getByRole('heading',{name:'销量、趋势与竞争证据',exact:true}).waitFor();
  await page.getByRole('switch',{name:/我已核对来源/}).click();
  const today=new Date().toISOString().slice(0,10);
  const document={schema_version:'MarketEvidence@1',name:'Synthetic UI fixture',market:'US',currency:'USD',channel:'fixture',source_name:'Synthetic fixture',source_url:'https://example.org/synthetic-fixture',observed_on:today,period_end:today,rows:[{cj_pid:'pid-1',match_note:'Synthetic fixture mapping',sales_kind:'observed',sales_30d:30,previous_sales_30d:20,searches_30d:100,previous_searches_30d:80,competitor_count:3,competitor_median_price:'40',acquisition_cost:'5'}]};
  await page.getByLabel('导入市场证据文件',{exact:true}).setInputFiles({name:'synthetic.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(document))});
  await page.getByText(/证据已保存为不可变版本并选中/).waitFor();
  await page.getByRole('button',{name:'试搜商品（只读）',exact:true}).click();
  await page.getByText(/原始搜索 2 件 · 市场证据对应 1 件/).waitFor();
  for(const width of [1100,760,390]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>window.document.documentElement.scrollWidth<=innerWidth),'Evidence dialog overflow '+width);}
  await page.setViewportSize({width:1280,height:900});
  await page.waitForFunction(()=>[...window.document.querySelectorAll('button')].some(b=>b.textContent==='应用到节点'&&!b.disabled));
  await page.getByRole('button',{name:'应用到节点',exact:true}).click();
  await page.getByRole('button',{name:'打开评估商品机会与建议售价',exact:true}).click();
  const select=page.getByLabel('运营策略',{exact:true});
  const option=select.locator('option').filter({hasText:'销量趋势与竞争选品'});await option.waitFor({state:'attached'});
  await select.selectOption(await option.getAttribute('value'));
  await page.getByText('继承定义商品任务 · 不重复搜索或配置数据源',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('市场证据版本',{exact:true}).count(),0);
  await page.getByRole('button',{name:'应用到节点',exact:true}).click();
  await page.getByRole('button',{name:'保存配置',exact:true}).click();
  await page.getByText(/配置已保存到后端/).waitFor();
  const binding=saved.nodes.find(n=>n.definitionId==='product.decide').binding;
  assert.equal(binding.skillVersion,'2.0.0');assert.deepEqual(binding.parameters,{});
  assert.equal(saved.nodes.find(n=>n.definitionId==='product.start').binding.parameters.marketEvidenceRef,imported.id);
  assert.deepEqual(errors,[]);
  for(const width of [1100,760,390]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>window.document.documentElement.scrollWidth<=innerWidth));}
  console.log('V2 actual registry, task-first evidence import/search, downstream inheritance and frozen-reference configuration passed; writes mocked.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

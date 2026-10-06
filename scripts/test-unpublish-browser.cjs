// Fully intercepted APIs: confirmation and UI sync only; never touch real products.
const assert=require('node:assert/strict');
const { chromium } = require("./browser-runtime.cjs");
(async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});let state='published',writes=0,unknown=false;
  const row={id:'11111111-1111-1111-1111-111111111111',product_id:'mock-unpublish',title:'模拟下架商品',status:state,run_status:'succeeded',source_kind:'test_fixture',store:{id:'mock-store',name:'模拟店铺',channel:'test-store',adapter:'test-store.v1'},currency:'USD',market:'US',variants:[{sku:'MOCK',size:'M',price:'19.00',quantity:1}],images:[],created_at:'2026-10-03T00:00:00Z',confirmed_at:'2026-10-03T01:00:00Z',publication_digest:'a'.repeat(64),store_version:1,can_unpublish:true};
  await page.route('**/backend/v1/**',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.pathname.endsWith('/auth/session'))return route.fulfill({json:{authenticated:true,mode:'desktop',csrf_token:'mock-only',user:{role:'admin',username:'mock'}}});
   if(req.method()==='POST'){
    assert.equal(url.pathname,`/backend/v1/products/${row.id}/unpublish`);
    const body=req.postDataJSON();assert.equal(body.expected_digest,row.publication_digest);assert.equal(body.store_version,1);assert(body.reason);
    writes++;state=unknown?'unpublish_pending':'inactive';return route.fulfill({status:unknown?202:200,json:{status:unknown?'unknown':'succeeded'}});
   }
   assert.equal(url.pathname,'/backend/v1/products');
   const view=url.searchParams.get('view');
   const matches=view==='archived'?state==='inactive':view==='active'?state!=='inactive':true;
   return route.fulfill({json:{results:matches?[{...row,status:state}]:[],count:matches?1:0,page:1,page_size:50,stats:{total:1,[state]:1},channels:['test-store'],can_verify_stores:true,scope:'publication-tasks',inventory_mode:'publication-snapshot'}});
  });
  await page.goto('http://localhost:3000/products');await page.getByRole('button',{name:'一键下架',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'确认渠道下架'});
  assert.equal(await dialog.getByLabel('下架原因').inputValue(),'运营手动下架');
  assert.equal(await dialog.getByRole('button',{name:'确认下架'}).isDisabled(),false);
  await dialog.getByLabel('下架原因').fill('   ');
  assert(await dialog.getByRole('button',{name:'确认下架'}).isDisabled());
  await dialog.getByRole('button',{name:'取消',exact:true}).click();assert.equal(writes,0);
  await page.getByRole('button',{name:'一键下架',exact:true}).click();await dialog.getByLabel('下架原因').fill('模拟下架，不涉及真实商品');
  for(const width of [760,483,390]){await page.setViewportSize({width,height:692});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  await dialog.screenshot({path:'/private/tmp/commerceos-unpublish-dialog.png'});
  await dialog.getByRole('button',{name:'确认下架'}).click();await page.getByRole('status').filter({hasText:'渠道已确认下架'}).waitFor();
  assert.equal(writes,1);assert.equal(await page.getByRole('link',{name:'测试站商品 ↗',exact:true}).count(),0);
  await page.getByText(/暂无匹配的商品任务/).waitFor();
  await page.getByRole('link',{name:/^已下架商品/}).click();
  await page.getByRole('heading',{name:'已下架商品',exact:true}).waitFor();
  await page.getByText('模拟下架商品',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'一键下架',exact:true}).count(),0);
  for(const width of [1100,760,390]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  state='published';unknown=true;await page.getByRole('link',{name:'返回商品管理',exact:true}).click();
  await page.getByRole('button',{name:'一键下架',exact:true}).click();
  await dialog.getByRole('button',{name:'确认下架'}).evaluate(el=>{el.click();el.click();});
  await page.getByRole('button',{name:'核对下架结果',exact:true}).waitFor();
  assert.equal(writes,2,'double click sends only one operation');
  assert.equal(await page.getByText('渠道已确认下架',{exact:true}).count(),0);
  await page.getByRole('button',{name:'核对下架结果',exact:true}).click();
  unknown=false;await dialog.getByRole('button',{name:'查询并核对结果',exact:true}).click();
  await page.getByRole('status').filter({hasText:'渠道已确认下架'}).waitFor();
  assert.equal(writes,3);
  const snapshot=require('../components/commerce/test-store/crownley/snapshot.json').featured[0].product;
  let visible=true;
  const shop=await browser.newPage();await shop.route('**/backend/test-store/v1/catalog**',route=>route.fulfill({json:{products:visible?[{...snapshot,id:'mock-downstream',name:'Synced temporary product',status:'Active'}]:[]}}));
  await shop.clock.install();await shop.goto('http://localhost:3000/test-store/products/mock-downstream');
  await shop.getByRole('heading',{name:'Synced temporary product',exact:true}).waitFor();
  visible=false;await shop.clock.runFor(30000);
  await shop.getByRole('heading',{name:'Product unavailable',exact:true}).waitFor();
  console.log('Unpublish confirmation and backend-driven status sync passed (mock only, no real product deactivated).');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

// Mock state transitions, then read-only verification of existing real publications.
const assert=require('node:assert/strict');
const { chromium } = require("./browser-runtime.cjs");
(async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{
  const context=await browser.newContext(),page=await context.newPage();let state='review',failed=false,images=['/test-store/crownley/products/demo.svg'];const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/backend/v1/**',async route=>{
   assert.equal(route.request().method(),'GET');
   const url=new URL(route.request().url());
   if(url.pathname==='/backend/v1/auth/session')return route.fulfill({json:{authenticated:true,mode:'desktop',csrf_token:'mock-only',user:{role:'admin',username:'mock'}}});
   assert.equal(url.pathname,'/backend/v1/products');
   if(failed)return route.fulfill({status:503,json:{detail:'Mock offline'}});
   const row={id:'mock-run',product_id:'mock-product',title:'同步商品测试',status:state,run_status:state==='published'?'succeeded':'waiting_approval',source_kind:'test_fixture',store:{id:'mock-store',name:'Mock test store',channel:'test-store'},currency:'USD',market:'US',variants:[{sku:'MOCK-001',size:'M',price:'19.00',quantity:2}],images:[],created_at:'2026-10-03T00:00:00Z',confirmed_at:state==='published'?'2026-10-03T01:00:00Z':null};
   row.images=images;
   const match=!url.searchParams.get('q')||row.title.includes(url.searchParams.get('q'));
   return route.fulfill({json:{results:match?[row]:[],count:match?1:0,page:1,page_size:50,stats:{total:1,[state]:1},channels:['test-store'],scope:'publication-tasks',inventory_mode:'publication-snapshot'}});
  });
  await page.goto('http://localhost:3000/products');
  await page.getByText('同步商品测试',{exact:true}).waitFor();
  await page.waitForFunction(()=>{const img=document.querySelector('img[alt="同步商品测试主图"]');return img&&img.complete&&img.naturalWidth>0;});
  images=[];await page.getByRole('button',{name:'刷新商品',exact:true}).click();
  await page.getByText('暂无图片',{exact:true}).waitFor();
  images=['/missing-product-image.jpg'];await page.getByRole('button',{name:'刷新商品',exact:true}).click();
  await page.getByText('图片加载失败',{exact:true}).waitFor();
  images=['/test-store/crownley/products/demo.svg'];await page.getByRole('button',{name:'刷新商品',exact:true}).click();
  await page.waitForFunction(()=>{const img=document.querySelector('img[alt="同步商品测试主图"]');return img&&img.complete&&img.naturalWidth>0;});
  assert.equal(await page.getByRole('link',{name:'测试站商品 ↗',exact:true}).count(),0);
  state='published';await page.getByRole('button',{name:'刷新商品',exact:true}).click();
  await page.getByRole('link',{name:'测试站商品 ↗',exact:true}).waitFor();
  assert(await page.getByText('已确认可售',{exact:true}).last().isVisible());
  for(const width of [1440,1100,760,390]){
   await page.setViewportSize({width,height:900});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Product page overflow at ${width}`);
  }
  await page.getByLabel('搜索真实商品').fill('no-match');
  await page.getByText(/暂无匹配的商品任务/).waitFor();
  failed=true;await page.getByRole('button',{name:'刷新商品',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Mock offline'}).waitFor();
  assert.equal(await page.getByText('同步商品测试',{exact:true}).count(),0);
  assert(await page.getByText('未回退到演示商品。',{exact:true}).isVisible());
  assert.deepEqual(errors,[]);await context.close();
  const real=await browser.newContext({viewport:{width:1440,height:1000}}),live=await real.newPage();
  const response=await live.request.get('http://localhost:3000/backend/v1/products?view=active');assert.equal(response.status(),200);
  const data=await response.json();assert.equal(data.scope,'publication-tasks');
  await live.goto('http://localhost:3000/products');
  for(const row of data.results.slice(0,5))await live.getByText(row.title,{exact:true}).first().waitFor();
  await live.screenshot({path:'/tmp/commerceos-real-products.png'});
  console.log(JSON.stringify({mockTransitions:'passed',realTaskCount:data.stats.total,verifiedPublications:data.stats.published??0,scope:'read-only existing data; no new publication'}));
  await real.close();
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

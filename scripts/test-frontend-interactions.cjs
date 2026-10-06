// UI-only checks. All backend mutations are forbidden, including credentials.
const assert=require('node:assert/strict');
const {chromium,launchOptions,baseURL,artifactDirectory}=require('./frontend-browser.cjs');
const fs=require('node:fs');
(async()=>{
 fs.mkdirSync(artifactDirectory,{recursive:true});
 const browser=await chromium.launch(launchOptions);
 const page=await browser.newPage({viewport:{width:1440,height:960},reducedMotion:'reduce'});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/backend/**',route=>['GET','HEAD'].includes(route.request().method())?route.continue():route.abort());
 try{
  await page.goto(baseURL+'/orders',{waitUntil:'networkidle'});
  await page.getByLabel('订单状态',{exact:true}).selectOption('待发货');
  assert.equal(await page.locator('tbody tr').count(),1);
  await page.locator('tbody tr').focus();await page.keyboard.press('Enter');
  await page.getByRole('heading',{name:'#1003287'}).waitFor();
  await page.getByRole('button',{name:'关闭订单详情'}).click();
  assert.equal(await page.getByRole('heading',{name:'订单详情'}).count(),0);
  await page.getByLabel('搜索订单',{exact:true}).fill('not-a-real-order');
  await page.getByText('没有符合条件的记录。',{exact:true}).waitFor();
  await page.goto(baseURL+'/customers',{waitUntil:'networkidle'});
  await page.getByLabel('客户市场',{exact:true}).selectOption('英国');
  assert.equal(await page.locator('tbody tr').count(),1);
  await page.locator('tbody tr').click();await page.getByRole('heading',{name:'Sarah Wilson'}).waitFor();
  await page.goto(baseURL+'/assistant',{waitUntil:'networkidle'});
  await page.getByRole('button',{name:/梳理我的选品条件/}).click();
  assert.equal(await page.getByLabel('运营问题草稿').inputValue(),'梳理我的选品条件');
  await page.getByRole('button',{name:'添加草稿',exact:true}).click();
  await page.getByText(/没有发送给模型/).waitFor();
  await page.getByRole('button',{name:'新建草稿',exact:true}).click();
  await page.getByRole('heading',{name:'让下一步，更清晰。'}).waitFor();
  await page.goto(baseURL+'/workflow/builder',{waitUntil:'networkidle'});
  const titles=await page.locator('[class*="cardTitle"]').evaluateAll(rows=>rows.map(e=>({text:e.textContent,height:e.getBoundingClientRect().height})));
  assert(titles.length>=15);for(const title of titles)assert(title.height>=16,'clipped workflow title: '+title.text);
  await page.getByRole('button',{name:'打开定义商品任务',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.waitFor();
  await page.screenshot({path:artifactDirectory+'/task-dialog.png',animations:'disabled'});
  await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
  assert.equal(await page.getByRole('button',{name:'打开定义商品任务',exact:true}).evaluate(el=>el===document.activeElement),true,'dialog restores node focus');
  await page.getByRole('button',{name:'打开核算经营空间',exact:true}).click();await dialog.waitFor();
  await page.screenshot({path:artifactDirectory+'/cost-dialog.png',animations:'disabled'});
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'配置店铺接入 ↗',exact:true}).click();await dialog.waitFor();
  await page.screenshot({path:artifactDirectory+'/store-dialog.png',animations:'disabled'});
  for(const width of [1100,760,390]){
   await page.setViewportSize({width,height:900});
   const bounds=await dialog.boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=width,'dialog viewport overflow');
  }
  await page.screenshot({path:artifactDirectory+'/store-dialog-mobile.png',animations:'disabled'});
  await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
  assert.deepEqual(errors,[]);
  console.log('Passed filters, empty states, keyboard row selection, draft reset, 15 node titles, modal focus/escape and responsive store setup. No backend writes.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error.message);process.exit(1)});

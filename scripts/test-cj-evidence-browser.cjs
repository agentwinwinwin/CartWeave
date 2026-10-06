// Real registry reads only. Saves, category/search requests are intercepted; no user data changes.
const assert=require('node:assert/strict');
const { chromium } = require("./browser-runtime.cjs");
(async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{
  const page=await browser.newPage();let saved=null;const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/backend/v1/**',async route=>{
   const r=route.request(),path=new URL(r.url()).pathname;
   if(path.endsWith('/connections/cj/categories'))return route.fulfill({json:{categories:[]}});
   if(path.endsWith('/connections/cj/search-preview')){
    assert.equal(r.postDataJSON().marketEvidenceSource,'cj');assert.equal(r.postDataJSON().marketEvidenceRef,undefined);
    return route.fulfill({json:{outcome:'results',message:'Synthetic CJ fixture',products:[{id:'pid-1',nameEn:'Fixture',sellPrice:'5.00'}],groups:[],cj_evidence:[{pid:'pid-1',sales_90d:null,listing_count:13}],cj_evidence_unread:0}});
   }
   if(path.endsWith('/workflow-designs')&&r.method()==='POST'){saved=r.postDataJSON().document;return route.fulfill({json:{id:'mock-save',document:saved,revision:1,digest:'a'.repeat(64)}});}
   if(r.method()!=='GET')throw Error('Unexpected backend mutation');
   await route.continue();
  });
  await page.goto('http://localhost:3000/workflow/builder');
  await page.getByRole('button',{name:'打开定义商品任务',exact:true}).click();
  const productLimit=page.getByLabel('本次候选商品上限（真实运行最多 100）',{exact:true});
  const variantLimit=page.getByLabel('每件商品研究规格上限（1–20）',{exact:true});
  assert.equal(await productLimit.getAttribute('max'),'100');
  assert.equal(await variantLimit.getAttribute('max'),'20');
  await productLimit.fill('100');
  await variantLimit.fill('20');
  await page.getByRole('button',{name:'配置 CJ 自动证据并绑定选品算法',exact:true}).click();
  await page.getByText(/CJ 自动市场证据已配置/).waitFor();
  await page.getByRole('button',{name:'打开定义商品任务',exact:true}).click();
  assert.equal(await page.getByLabel('市场证据来源',{exact:true}).inputValue(),'cj');
  assert.equal(await page.getByLabel('导入市场证据文件',{exact:true}).count(),0);
  await page.getByRole('button',{name:'试搜商品（只读）',exact:true}).click();
  await page.getByText(/CJ 近 90 天销量：接口未返回，待研究/).waitFor();
  for(const width of [1100,760,390]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'overflow '+width);}
  await page.getByRole('button',{name:'取消',exact:true}).click();
  await page.getByRole('button',{name:'打开评估商品机会与建议售价',exact:true}).click();
  await page.getByText('CJ 自动证据 · 继承定义商品任务',{exact:true}).waitFor();
  await page.getByRole('button',{name:'取消',exact:true}).click();
  await page.getByRole('button',{name:'保存配置',exact:true}).click();
  await page.getByText(/配置已保存到后端/).waitFor();
  assert.equal(saved.nodes.find(n=>n.definitionId==='product.start').binding.parameters.marketEvidenceSource,'cj');
  assert.equal(saved.nodes.find(n=>n.definitionId==='product.start').binding.parameters.limit,100);
  assert.equal(saved.nodes.find(n=>n.definitionId==='product.start').binding.parameters.variantsPerProduct,20);
  const decision=saved.nodes.find(n=>n.definitionId==='product.decide');assert.equal(decision.binding.skillVersion,'3.0.0');assert.deepEqual(decision.binding.parameters,{});
  assert.deepEqual(errors,[]);console.log('CJ automatic-source configuration, honest missing-sales preview, v3 inheritance and responsive UI passed; writes mocked.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

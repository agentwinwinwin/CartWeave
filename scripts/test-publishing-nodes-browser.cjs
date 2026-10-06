// Isolated intercepted backend: no LLM calls, publication or database writes.
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require(process.env.CODEX_NODE_MODULES?path.join(process.env.CODEX_NODE_MODULES,'playwright'):'playwright');
const store={id:'11111111-1111-1111-1111-111111111111',name:'Mock verified store',channel:'test-store',adapter:'test-store.v1',configuration_version:3,active:true,verified:true,capabilities:['listing.validate','listing.publish','listing.wait']};
const pkg={package:'test-store.v1',version:'1.2.0',channel:'test-store',status:'implemented-local-test-only',design_manifests:[['listing.validate','ListingDraft@1','ValidatedListing@1'],['listing.publish','PreparedChannelPublication@1','PublicationReceipt@1'],['listing.wait','PublicationReceipt@1','PublishedProduct@1']].map(([action,input,output])=>({id:`installed.test-store.v1.${action}`,name:action,version:'1.2.0',runtime:'connector',description:'Mock design metadata',input,output,entrypointRef:`installed://test-store.v1/${action}@1.2.0`,parameterSchema:{},capabilities:[],effects:action==='listing.publish'?['read','remote_write']:['read'],channels:['test-store']}))};
Object.assign(pkg,{actions:store.capabilities.map(action=>({action})),unsupported:[]});
(async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{
  for(const channel of ['test-store','amazon']){
   const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/backend/v1/**',async route=>{
    if(route.request().method()==='POST'&&route.request().url().endsWith('/workflow-designs'))return route.fulfill({json:{id:'fixture',revision:1,document:route.request().postDataJSON().document}});
    assert.equal(route.request().method(),'GET','No real store or publication writes allowed');
    const url=new URL(route.request().url()).pathname;
    if(url.endsWith('/stores'))return route.fulfill({json:[store]});
    if(url.endsWith('/integration-packages'))return route.fulfill({json:{packages:[pkg]}});
    if(url.endsWith('/skills'))return route.fulfill({json:['selection','content'].map((kind)=>({id:kind,key:kind==='selection'?'product.opportunity':'content.editorial',version:kind==='selection'?'5.0.0':'1.0.1',handler:kind==='selection'?'product.opportunity.v5':'content.editorial.v1',status:'approved',selectable:true,manifest:{id:`registered.${kind}`,name:kind,version:kind==='selection'?'5.0.0':'1.0.1',runtime:'script',input:kind==='selection'?'DeliveryCandidates@1':'ApprovedProductBrief@2',output:kind==='selection'?'SelectionProposal@1':'ListingDraft@1',entrypointRef:`registered://${kind}`,parameterSchema:{},capabilities:[],effects:['read'],channels:['*']}}))});
    if(url.endsWith('/auth/session'))return route.fulfill({json:{authenticated:true,csrf_token:'fixture',mode:'desktop',user:{role:'admin'}}});
    if(url.endsWith('/workflow-designs')||url.endsWith('/runs'))return route.fulfill({json:[]});
    return route.abort();
   });
   await page.goto('http://localhost:3000/workflow/builder');
   await page.getByLabel('销售渠道',{exact:true}).selectOption(channel);
   await page.setViewportSize({width:843,height:692});
   const connect=page.getByRole('button',{name:'配置店铺接入 ↗',exact:true});
   assert((await connect.boundingBox()).width>100,'Connection action must not collapse into the dot column');
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.screenshot({path:`/tmp/commerceos-store-setup-${channel}.png`});
   await page.setViewportSize({width:1440,height:1000});
   await connect.click();
   const connection=page.getByRole('dialog',{name:'店铺接入',exact:true});
   const dialog=page.getByRole('dialog',{name:'接口字段映射节点'});
   if(channel==='test-store'){
    await page.waitForFunction(()=>[...document.querySelectorAll('dialog button')].some(b=>b.textContent==='保存店铺与接口包配置'&&!b.disabled));
    assert.equal(await connection.getByLabel('模型 ID',{exact:true}).count(),0);
    await connection.getByRole('button',{name:'保存店铺与接口包配置',exact:true}).click();
    await connection.waitFor({state:'detached'});
   }else{
    await connection.getByText(/当前渠道还没有真实店铺连接/).waitFor();
    assert(await connection.getByRole('button',{name:'保存店铺与接口包配置',exact:true}).isDisabled());
    await connection.getByRole('button',{name:'关闭店铺接入'}).click();
   }
   await page.getByRole('button',{name:/提交渠道发布/}).first().click();
   const publisher=page.getByRole('dialog',{name:'提交渠道发布节点'});
   assert.equal(await publisher.getByRole('combobox').count(),0,'No duplicate store or Skill selectors');
   assert.equal(await publisher.getByRole('textbox').count(),0,'No duplicate fields');
   if(channel==='test-store')await publisher.getByText('test-store.v1 · v1.2.0',{exact:true}).waitFor();
   else await publisher.getByRole('alert').waitFor();
   for(const width of [1100,760,390]){
    await page.setViewportSize({width,height:1000});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert(await publisher.evaluate(el=>el.getBoundingClientRect().right<=innerWidth));
   }
   await page.setViewportSize({width:1440,height:1000});
   await page.screenshot({path:`/tmp/commerceos-publisher-inheritance-${channel}.png`});
   await publisher.getByRole('button',{name:'前往准备节点配置',exact:true}).click();
   await dialog.waitFor();
   await dialog.getByRole('button',{name:'首次分析接口',exact:true}).click();
   assert.equal(await dialog.getByLabel('映射哪个动作').count(),0);
   assert(await dialog.getByText('新建分析覆盖完整接口包：商品检查、上架、回执查询、可售确认、下架、状态查询，以及订单、客户、账目读取。',{exact:true}).isVisible());
   await dialog.getByRole('button',{name:'关闭映射节点'}).click();
   if(channel==='test-store'){
    await page.getByRole('button',{name:'检查配置',exact:true}).click();
    assert(await page.getByRole('button',{name:'演示流程',exact:true}).isEnabled());
   }
   assert.deepEqual(errors,[]);
   console.log(`${channel}: single preparation setup, read-only publishing inheritance and responsive dialogs passed (mock only)`);
   await context.close();
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

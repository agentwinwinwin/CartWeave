// Mock transport only: no store provisioning, verification or real publication.
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require(process.env.CODEX_NODE_MODULES?path.join(process.env.CODEX_NODE_MODULES,'playwright'):'playwright');
const store={id:'11111111-1111-1111-1111-111111111111',name:'Shared fixture store',channel:'test-store',adapter:'test-store.v1',configuration_version:3,active:true,verified:true,capabilities:['listing.validate','listing.publish','listing.wait']};
const pkg={package:'test-store.v1',version:'1.4.0',channel:'test-store',status:'implemented-local-test-only',design_manifests:[['listing.validate','ListingDraft@1','ValidatedListing@1'],['listing.publish','PreparedChannelPublication@1','PublicationReceipt@1'],['listing.wait','PublicationReceipt@1','PublishedProduct@1']].map(([action,input,output])=>({id:`installed.test-store.v1.${action}`,name:action,version:'1.3.0',runtime:'connector',description:'Fixture',input,output,entrypointRef:`installed://test-store.v1/${action}@1.3.0`,parameterSchema:{},capabilities:[],effects:action==='listing.publish'?['read','remote_write']:['read'],channels:['test-store']}))};
Object.assign(pkg,{actions:store.capabilities.map(action=>({action})),unsupported:[]});
const skill=(id,key,version,handler,input,output)=>({id,key,version,handler,status:'approved',selectable:true,manifest:{id:`registered.${id}`,name:key,version,runtime:'script',description:'Fixture',input,output,entrypointRef:`registered://${id}`,parameterSchema:{},capabilities:[],effects:['read'],channels:['*']}});
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{
  const page=await browser.newPage();const errors=[];let saved=null,posts=0,fail=true;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/backend/v1/**',async route=>{
   const req=route.request(),url=new URL(req.url()).pathname;
   if(url.endsWith('/auth/session'))return route.fulfill({json:{authenticated:true,csrf_token:'fixture',mode:'desktop',user:{role:'admin',team_id:'fixture'}}});
   if(url.endsWith('/workflow-designs')){
    if(req.method()==='GET')return route.fulfill({json:saved?[saved]:[]});
    posts++;if(fail)return route.fulfill({status:422,json:{detail:'Fixture save rejected'}});
    const document=req.postDataJSON().document;assert.equal(document.environment.storeRef,store.id);assert.equal(document.nodes.find(n=>n.definitionId==='listing.map').binding.parameters.mappingStoreRef,store.id);
    saved={id:'design',revision:1,document};return route.fulfill({json:saved});
   }
   assert.equal(req.method(),'GET','No store mutation, verification or model call');
   if(url.endsWith('/stores'))return route.fulfill({json:[store]});
   if(url.endsWith('/integration-packages'))return route.fulfill({json:{packages:[pkg]}});
   if(url.endsWith('/skills'))return route.fulfill({json:[skill('selection','product.opportunity','5.0.0','product.opportunity.v5','DeliveryCandidates@1','SelectionProposal@1'),skill('content','content.editorial','1.0.1','content.editorial.v1','ApprovedProductBrief@2','ListingDraft@1')]});
   if(url.endsWith('/node-definitions'))return route.fulfill({json:{nodes:[]}});
   return route.fulfill({json:[]});
  });
  await page.goto('http://localhost:3000/workflow/builder?template=launch');
  await page.waitForTimeout(1000);
  await page.getByRole('button',{name:'配置店铺接入 ↗',exact:true}).click();
  const connection=page.getByRole('dialog',{name:'店铺接入',exact:true});
  const save=connection.getByRole('button',{name:'保存店铺与接口包配置',exact:true});
  await save.waitFor();await page.waitForFunction(()=>[...document.querySelectorAll('dialog button, [role="dialog"] button')].some(b=>b.textContent==='保存店铺与接口包配置'&&!b.disabled));
  await save.click();await connection.getByRole('alert').filter({hasText:'店铺与接口包配置未保存'}).waitFor();
  fail=false;await save.click();await connection.waitFor({state:'detached'});assert.equal(posts,2);
  await page.reload();await page.getByText(store.name,{exact:true}).waitFor();
  await page.getByRole('button',{name:'打开准备渠道发布数据',exact:true}).click();
  const preparation=page.getByRole('dialog',{name:'接口字段映射节点',exact:true});
  await preparation.getByText('继承店铺接入 · 只读',{exact:true}).waitFor();
  assert.equal(await preparation.getByRole('combobox').count(),0);
  assert.equal(await preparation.getByRole('button',{name:'保存店铺与接口包配置',exact:true}).count(),0);
  await preparation.getByText('test-store.v1 · v1.4.0',{exact:true}).waitFor();
  await preparation.getByRole('button',{name:'关闭映射节点',exact:true}).click();
  await page.goto('http://localhost:3000/workflow/builder?template=support');
  await page.getByRole('heading',{name:'智能客服',exact:true}).waitFor();await page.getByText(store.name,{exact:true}).waitFor();
  assert.equal(posts,2,'new workflow inherits without a provisioning or save POST');
  for(const width of [1100,760]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  assert.deepEqual(errors,[]);console.log('Store setup owns persistence; preparation is read-only; refresh and new customer workflow reuse the same store (mock only).');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

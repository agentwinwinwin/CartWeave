// Intercepted transport only: no real model, messages or customer data.
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require(process.env.CODEX_NODE_MODULES?path.join(process.env.CODEX_NODE_MODULES,'playwright'):'playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{
  const page=await browser.newPage();const errors=[];let posts=0;
  let session={id:'support-session',purpose:'customer_support',revision:1,messages:[],result:{},busy:false};
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/backend/v1/**',async route=>{
   const req=route.request(),url=new URL(req.url()).pathname;
   if(url.endsWith('/auth/session'))return route.fulfill({json:{authenticated:true,csrf_token:'fixture',mode:'desktop',user:{role:'admin',team_id:'fixture'}}});
   if(url.endsWith('/model-connections'))return route.fulfill({json:[{id:'model',name:'Fixture model',model_id:'mock',protocol:'openai-completions',has_key:true,base_url:'https://models.example/v1'}]});
   if(url.endsWith('/agent-sessions')&&req.method()==='GET')return route.fulfill({json:[{...session,id:'unrelated',purpose:'assistant',messages:[{role:'assistant',content:'Unrelated assistant history'}]}]});
   if(url.endsWith('/agent-sessions')){posts++;assert.equal(req.postDataJSON().purpose,'customer_support');return route.fulfill({json:session,status:201});}
   if(url.endsWith('/agent-sessions/support-session')){posts++;const input=req.postDataJSON();assert.equal(input.connection_id,'model');assert.equal(input.expected_revision,1);session={...session,revision:2,result:{schema_version:'SupportReply@1',reply:'请补充订单编号。',facts_used:[],questions:['订单编号？'],handoff_required:true},messages:[{role:'user',content:input.message},{role:'assistant',content:'请补充订单编号。',model:'mock'}]};return route.fulfill({json:session});}
   if(url.endsWith('/workflow-designs')||url.endsWith('/skills')||url.endsWith('/stores')||url.endsWith('/runs')||url.endsWith('/market-evidence'))return route.fulfill({json:[]});
   if(url.endsWith('/node-definitions'))return route.fulfill({json:{nodes:[]}});
   throw Error('Unexpected request '+url);
  });
  await page.goto('http://localhost:3000/workflow/builder?template=support');
  await page.getByRole('heading',{name:'智能客服',exact:true}).waitFor();
  await page.getByRole('button',{name:'打开智能客服生成回复',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'智能客服节点执行',exact:true});
  await dialog.getByRole('heading',{name:'客服 Skill 执行',exact:true}).waitFor();
  assert.equal(await dialog.getByText('Unrelated assistant history',{exact:true}).count(),0);
  assert.equal(await dialog.getByLabel('运行时模型 Skill').inputValue(),'customer_support');
  assert.equal(posts,0,'opening the node must not call a model');
  await dialog.getByLabel('对话使用的模型').selectOption('model');
  await dialog.getByLabel('发送给模型的问题').fill('客户询问包裹进度，尚无订单资料。');
  await dialog.getByRole('button',{name:'发送',exact:true}).click();
  await dialog.getByText('请补充订单编号。',{exact:true}).waitFor();assert.equal(posts,2);
  await dialog.getByText('需转人工确认',{exact:true}).waitFor();
  for(const width of [1100,760]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  await dialog.getByRole('button',{name:'关闭',exact:true}).click();
  await page.getByRole('heading',{name:'智能客服',exact:true}).waitFor();
  assert.deepEqual(errors,[]);console.log('Customer service node opens on the same canvas and explicitly executes its fixed profile (mock only).');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

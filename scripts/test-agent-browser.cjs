// Fully intercepted backend: does not call a paid model or write user records.
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require(process.env.CODEX_NODE_MODULES?path.join(process.env.CODEX_NODE_MODULES,'playwright'):'playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{
  const page=await browser.newPage();const errors=[];let sessions=[],posts=0,fail=false;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/backend/v1/**',async route=>{
   const req=route.request(),url=new URL(req.url()).pathname;
   if(url.endsWith('/auth/session'))return route.fulfill({json:{authenticated:true,csrf_token:'fixture',user:{role:'admin',team_id:'fixture'}}});
   if(url.endsWith('/model-connections'))return route.fulfill({json:[{id:'fixture-model',name:'Fixture',model_id:'mock',protocol:'openai-completions',has_key:true,base_url:'https://models.example/v1'}]});
   if(url.endsWith('/agent-sessions')&&req.method()==='GET')return route.fulfill({json:sessions});
   if(url.endsWith('/agent-sessions')&&req.method()==='POST'){posts++;const input=req.postDataJSON();const session={id:`session-${posts}`,purpose:input.purpose,revision:1,messages:[],result:{},busy:false};sessions=[session,...sessions];return route.fulfill({status:201,json:session});}
   if(/\/agent-sessions\/session-/.test(url)){
    const id=url.split('/').at(-1),s=sessions.find(s=>s.id===id);if(req.method()==='GET')return route.fulfill({json:s});
    posts++;if(fail)return route.fulfill({status:422,json:{detail:'Fixture model error; no fallback'}});
    const input=req.postDataJSON();assert.equal(input.connection_id,'fixture-model');assert.equal(input.expected_revision,s.revision);
    const result=s.purpose==='customer_support'?{schema_version:'SupportReply@1',reply:'请提供订单编号，暂未确认发货。',facts_used:[],questions:['订单编号是什么？'],handoff_required:true}:{};
    s.result=result;s.messages.push({role:'user',content:input.message},{role:'assistant',content:s.purpose==='customer_support'?JSON.stringify(result):'Fixture answer',model:'mock',connection_id:'fixture-model',usage:{harness:{runtime:'pi-agent-core',version:'1.0.4',events:['agent_start','agent_end']}}});s.revision++;
    return route.fulfill({json:s});
   }
   if(url.endsWith('/skills'))return route.fulfill({json:[]});
   if(url.endsWith('/agent-skills'))return route.fulfill({json:[{id:'customer_support',title:'智能客服 · 回复建议',version:'1.0.0',digest:'fixture',kind:'runtime-model-policy',output:'SupportReply@1',tools:[],scope:'draft-only'}]});
   throw Error('Unexpected request: '+url);
  });
  await page.goto('http://localhost:3000/assistant');
  await page.getByLabel('对话使用的模型').selectOption('fixture-model');
  assert.equal(posts,0);
  await page.getByLabel('发送给模型的问题').fill('Help with selection');
  await page.getByRole('button',{name:'发送',exact:true}).click();
  await page.getByText('Fixture answer',{exact:true}).waitFor();assert.equal(posts,2);
  await page.reload();await page.getByText('Fixture answer',{exact:true}).waitFor();assert.equal(posts,2);
  fail=true;await page.getByLabel('发送给模型的问题').fill('retry input');await page.getByRole('button',{name:'发送',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Fixture model error'}).waitFor();assert.equal(await page.getByLabel('发送给模型的问题').inputValue(),'retry input');
  fail=false;await page.getByRole('button',{name:'新建对话',exact:true}).click();await page.getByLabel('运行时模型 Skill').selectOption('customer_support');
  await page.getByLabel('发送给模型的问题').fill('客户询问到货时间，没有订单资料');await page.getByRole('button',{name:'发送',exact:true}).click();
  await page.getByText('请提供订单编号，暂未确认发货。',{exact:true}).waitFor();await page.getByText('需转人工确认',{exact:true}).waitFor();
  await page.setViewportSize({width:760,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.goto('http://localhost:3000/skills');await page.getByRole('button',{name:'运行时模型 Skill',exact:true}).click();await page.getByRole('heading',{name:'智能客服 · 回复建议',exact:true}).waitFor();
  assert.deepEqual(errors,[]);console.log('Agent chat restore, explicit send, failure, support contract and runtime Skill partition passed (mock only).');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

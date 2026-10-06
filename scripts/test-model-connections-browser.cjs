// Intercepted API only: no provider request, real credentials or configuration writes.
const assert=require('node:assert/strict');
const {chromium}=require(process.env.CODEX_NODE_MODULES?require('node:path').join(process.env.CODEX_NODE_MODULES,'playwright'):'playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{
  const page=await browser.newPage();let models=[],writes=0,failSave=true;const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/backend/v1/**',async route=>{
   const req=route.request(),url=new URL(req.url()).pathname;
   if(url.endsWith('/auth/session'))return route.fulfill({json:{authenticated:true,csrf_token:'mock',mode:'desktop',user:{role:'admin',team_id:'fixture'}}});
   if(url.endsWith('/workflow-designs')||url.endsWith('/skills')||url.endsWith('/runs')||url.endsWith('/mappings'))return route.fulfill({json:[]});
   if(url.endsWith('/model-connections')&&req.method()==='GET')return route.fulfill({json:models});
   if(url.endsWith('/model-connections')&&req.method()==='POST'){
    writes++;if(failSave)return route.fulfill({status:422,json:{detail:'Fixture invalid configuration'}});
    const input=req.postDataJSON();assert.equal(input.api_key,'fixture-key-not-a-secret');
    const {api_key,...publicFields}=input;models=[{...publicFields,id:'fixture-model',has_key:true}];return route.fulfill({json:models[0],status:201});
   }
   if(url.endsWith('/model-connections/fixture-model')&&req.method()==='PUT'){
    writes++;const input=req.postDataJSON();assert.equal(input.api_key,'');const {api_key,...publicFields}=input;models=[{...publicFields,id:'fixture-model',has_key:true}];return route.fulfill({json:models[0]});
   }
   throw Error('Unexpected transport: '+url);
  });
  await page.goto('http://localhost:3000/workflow');
  await page.getByRole('button',{name:'添加大模型 API',exact:true}).click();
  let dialog=page.getByRole('dialog',{name:'大模型 API 配置'});
  await dialog.getByRole('form',{name:'添加大模型 API'}).waitFor();
  assert.equal(await dialog.getByLabel('调用协议').locator('option').count(),4);
  await dialog.getByLabel('模型显示名称').fill('Fixture model');
  await dialog.getByLabel('模型 ID',{exact:true}).fill('fixture-model-id');
  await dialog.getByLabel('模型 API Key').fill('fixture-key-not-a-secret');
  await dialog.getByRole('button',{name:'保存模型',exact:true}).click();
  await dialog.getByRole('alert').filter({hasText:'Fixture invalid configuration'}).waitFor();
  assert.equal(await dialog.getByLabel('模型 ID',{exact:true}).inputValue(),'fixture-model-id');
  failSave=false;
  await dialog.getByRole('button',{name:'保存模型',exact:true}).click();
  await dialog.getByText('模型已保存到后端，可在首次接口分析中选择；尚未调用模型或完成映射。',{exact:true}).waitFor();
  assert.equal(await dialog.locator('input[type=password]').count(),0);
  await dialog.getByRole('button',{name:'关闭大模型配置'}).click();
  assert.equal(await page.getByRole('heading',{name:'工作流',exact:true}).count(),1);
  await page.reload();await page.getByRole('heading',{name:'工作流',exact:true}).waitFor();
  assert.equal(await page.locator('dialog[open]').count(),0);
  await page.getByRole('button',{name:'添加大模型 API',exact:true}).click();
  await dialog.getByRole('heading',{name:'Fixture model',exact:true}).waitFor();
  await dialog.getByRole('button',{name:'编辑',exact:true}).click();
  assert.equal(await dialog.getByLabel('模型 API Key').inputValue(),'');
  await dialog.getByRole('button',{name:'保存模型',exact:true}).click();
  await dialog.getByText('模型已保存到后端，可在首次接口分析中选择；尚未调用模型或完成映射。',{exact:true}).waitFor();
  await dialog.getByRole('button',{name:'关闭大模型配置'}).click();
  await page.goto('http://localhost:3000/workflow/builder?template=campaign');
  await page.getByRole('button',{name:'添加大模型 API',exact:true}).click();
  await dialog.getByRole('heading',{name:'Fixture model',exact:true}).waitFor();
  await dialog.getByRole('button',{name:'关闭大模型配置'}).click();
  await page.goto('http://localhost:3000/workflow/mapping');
  await page.getByLabel('映射大模型').waitFor();
  assert.equal(await page.getByLabel('映射大模型').inputValue(),'fixture-model');
  assert.equal(writes,3);assert.deepEqual(errors,[]);
  assert.equal(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}).includes('fixture-key-not-a-secret')),false);
  console.log('Workflow-level model API creation, persistent save errors, reload, edit and shared mapping selection passed (mock only).');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

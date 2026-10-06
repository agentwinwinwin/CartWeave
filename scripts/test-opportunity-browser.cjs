// Read-only backend inspection; configuration save is intercepted, never sent to the backend.
const assert=require('node:assert/strict');
const { chromium } = require("./browser-runtime.cjs");
(async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{
  const page=await browser.newPage();const errors=[];let saved=null;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/backend/v1/**',async route=>{
   if(route.request().method()==='POST'&&new URL(route.request().url()).pathname.endsWith('/workflow-designs')){
    saved=route.request().postDataJSON().document;
    return route.fulfill({json:{id:'mock-only',revision:1,digest:'a'.repeat(64),document:saved}});
   }
   if(route.request().method()!=='GET')throw Error('Browser verification must not write backend data.');
   await route.continue();
  });
  await page.goto('http://localhost:3000/skills');
  await page.getByRole('button',{name:/已注册版本/}).click();
  await page.getByLabel('技能分类').selectOption('selection');
  const card=page.locator('.ui-card').filter({has:page.getByRole('heading',{name:'商品机会与售价建议',exact:true})});
  await card.getByRole('button',{name:'查看版本',exact:true}).click();
  await page.getByRole('heading',{name:'算法依据 · v1',exact:true}).waitFor();
  assert(await page.getByText(/综合分 = 成本分/).isVisible());
  await page.getByRole('button',{name:'关闭技能窗口',exact:true}).click();
  await page.goto('http://localhost:3000/workflow/builder');
  await page.getByRole('button',{name:'打开评估商品机会与建议售价',exact:true}).click();
  const select=page.getByLabel('运营策略',{exact:true});
  const option=select.locator('option').filter({hasText:'商品机会与售价建议'});
  await option.waitFor({state:'attached'});
  assert.equal(await option.count(),1);
  assert.equal(await option.isDisabled(),false);
  await select.selectOption(await option.getAttribute('value'));
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='应用到节点'&&!b.disabled),null,{timeout:5000}).catch(async e=>{console.error(await page.getByRole('dialog').getByRole('alert').allTextContents());throw e;});
  const chosen=await select.inputValue();
  await page.getByRole('button',{name:'应用到节点',exact:true}).click();
  await page.getByRole('button',{name:'保存配置',exact:true}).click();
  await page.getByText(/配置已保存到后端/).waitFor();
  const binding=saved.nodes.find(n=>n.definitionId==='product.decide').binding;
  assert.equal(binding.skillId,chosen);
  assert.deepEqual(binding.parameters,{},'Switching to the registered algorithm must clear legacy model parameters.');
  assert.deepEqual(errors,[]);
  console.log('Actual registered opportunity Skill is visible in My Skills, formula details and compatible node selector; no backend writes.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

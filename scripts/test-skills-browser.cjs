// Isolated UI verification. All backend requests are read-only mocked responses.
const assert=require('node:assert/strict'),path=require('node:path');
const { chromium } = require("./browser-runtime.cjs");
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/backend/v1/**',async route=>{
      assert.equal(route.request().method(),'GET');
      const endpoint=new URL(route.request().url()).pathname.split('/').at(-1);
      await route.fulfill({json:endpoint==='skills'?[{id:'mock',key:'demo.publisher',version:'1',handler:'unknown',status:'approved',manifest:{name:'Mock publisher',description:'Publish only',input:'ApprovedListing@1',output:'PublicationReceipt@1'}}]:endpoint==='integration-packages'?{packages:[]}:[]});
    });
    await page.goto('http://localhost:3000/skills');
    await page.getByRole('heading',{name:'生成独立站 API',exact:true}).waitFor();
    assert(await page.getByRole('heading',{name:'接口字段映射',exact:true}).isVisible());
    await page.screenshot({path:'/tmp/commerceos-my-skills.png'});
    await page.getByLabel('搜索我的技能').fill('映射');
    assert.equal(await page.getByRole('heading',{name:'生成独立站 API',exact:true}).count(),0);
    await page.getByLabel('搜索我的技能').fill('');
    await page.getByRole('button',{name:'选择并配置 API 生成规则',exact:true}).click();
    assert(await page.getByRole('dialog').isVisible());
    assert((await page.getByLabel('技能名称').inputValue()).includes('生成独立站 API'));
    await page.getByRole('button',{name:'保存制作草稿',exact:true}).click();
    assert(await page.getByRole('heading',{name:/制作中的草稿 · 1/}).isVisible());
    await page.getByRole('button',{name:/已注册版本/}).click();
    await page.getByLabel('技能分类').selectOption('adapter');
    assert(await page.getByRole('heading',{name:'Mock publisher',exact:true}).isVisible());
    assert.equal(await page.getByText('内容制作 · 系统整理',{exact:true}).count(),0);
    await page.getByLabel('技能分类').selectOption('content');
    assert.equal(await page.getByRole('heading',{name:'Mock publisher',exact:true}).count(),0);
    await page.getByRole('button',{name:'接入规则 · 2',exact:true}).click();
    for(const width of [1100,760,390]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Overflow at ${width}`);}
    await page.setViewportSize({width:1440,height:1000});
    await page.goto('http://localhost:3000/workflow/builder');
    await page.getByLabel('销售渠道',{exact:true}).selectOption('amazon');
    await page.getByRole('button',{name:'配置店铺接入 ↗',exact:true}).click();
    for(const width of [1440,1100,760,483,390]){
      await page.setViewportSize({width,height:692});
      const rules=page.getByRole('dialog').locator('section[aria-label="店铺接入 Skill 配置"] .ui-card');
      assert.equal(await rules.count(),2);
      for(let i=0;i<2;i++){
        const configure=rules.nth(i).locator('button,a').first(),view=rules.nth(i).getByRole('link',{name:'查看规则',exact:true}),download=rules.nth(i).getByRole('link',{name:'下载 Skill',exact:true});
        const boxes=await Promise.all([configure.boundingBox(),view.boundingBox(),download.boundingBox()]);
        assert(Math.abs(boxes[1].y-boxes[2].y)<1,'Secondary links must share a row');
        assert(boxes[1].y>=boxes[0].y+boxes[0].height,'Primary configuration must have its own row');
        assert(Math.abs(boxes[1].width-boxes[2].width)<1,'Secondary links must have equal width');
      }
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      if(width===483)await page.screenshot({path:'/tmp/commerceos-integration-rules-aligned.png'});
    }
    await page.setViewportSize({width:1440,height:1000});
    await page.getByRole('button',{name:'选择并配置映射规则',exact:true}).click();
    await page.getByRole('dialog',{name:'接口字段映射节点'}).waitFor();
    await page.getByRole('button',{name:'首次分析接口',exact:true}).click();
    assert(await page.getByText('当前渠道：amazon · 系统确定接入范围，无需选择动作。',{exact:true}).isVisible());
    assert.equal(await page.getByLabel('映射哪个动作').count(),0);
    assert.equal(await page.getByLabel('映射规则 Skill').inputValue(),'commerceos-publishing-adapter');
    await page.goto('http://localhost:3000/workflow/builder?configure=mapping&template=launch#keep');
    await page.getByRole('dialog',{name:'接口字段映射节点'}).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('configure'),null);
    assert.equal(new URL(page.url()).searchParams.get('template'),'launch');
    assert.equal(new URL(page.url()).hash,'#keep');
    await page.reload();
    await page.getByRole('heading',{name:'选品到上线',exact:true}).waitFor();
    assert.equal(await page.locator('dialog[open]').count(),0,'Refreshing must not reopen settings');
    await page.evaluate(()=>history.replaceState(history.state,'','?configure=mapping&template=launch'));
    await page.reload();
    await page.getByRole('heading',{name:'选品到上线',exact:true}).waitFor();
    await page.waitForFunction(()=>!new URL(location.href).searchParams.has('configure'));
    assert.equal(await page.locator('dialog[open]').count(),0,'Even a stale deep link must not open on reload');
    assert.deepEqual(errors,[]);
    console.log('Skills UI passed: both rules, search, draft creation, real-kind filtering, responsive layout and in-canvas mapping entry.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

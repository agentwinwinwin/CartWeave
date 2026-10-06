// Browser transport is fully mocked: never creates a real enabled schedule.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const { chromium } = require("./browser-runtime.cjs");
(async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  let timers=[],creates=0,updates=0;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/backend/v1/**',async route=>{
   const request=route.request(),path=new URL(request.url()).pathname;
   if(path.endsWith('/auth/session'))return route.fulfill({json:{mode:'desktop',authenticated:true,csrf_token:'mock',user:{username:'mock',role:'admin',team_id:'team'}}});
   if(path.endsWith('/schedules')&&request.method()==='GET')return route.fulfill({json:{schedules:timers,releases:[{id:'release',title:'选品到上线',revision:3,store_name:'本地测试站'}],dispatcher:{last_seen_at:new Date().toISOString(),online:true}}});
   if(path.endsWith('/schedules')&&request.method()==='POST'){
    creates++;const payload=request.postDataJSON();assert.equal(payload.release_id,'release');assert.equal(payload.enabled,false);assert.equal(payload.frequency,'weekly');assert.deepEqual(payload.weekdays,[0,1,2,3,4]);
    const row={...payload,id:'timer',revision:1,release_revision:3,workflow_title:'选品到上线',next_due_at:null,last_error:'',last_run_id:null,history:[]};timers.push(row);return route.fulfill({status:201,json:row});
   }
   if(path.endsWith('/schedules/timer')&&request.method()==='PATCH'){
    updates++;const payload=request.postDataJSON();assert.equal(payload.expected_revision,timers[0].revision);
    const {expected_revision,...fields}=payload;
    timers[0]={...timers[0],...fields,revision:expected_revision+1,next_due_at:fields.enabled?'2026-10-05T01:00:00Z':null};return route.fulfill({json:timers[0]});
   }
   throw Error(`Unmocked backend request: ${request.method()} ${path}`);
  });
  await page.goto('http://127.0.0.1:3000/schedules');
  await page.getByText('服务在线',{exact:true}).waitFor();
  await page.getByRole('button',{name:'＋ 新建定时器',exact:true}).click();
  await page.getByLabel('执行频率',{exact:true}).selectOption('weekly');
  await page.getByLabel('时区',{exact:true}).fill('Asia/Shanghai');
  await page.getByRole('button',{name:'保存定时器',exact:true}).click();
  await page.getByRole('switch',{name:'启用定时执行',exact:true}).waitFor();
  assert.equal(creates,1);
  await page.reload();
  await page.getByRole('switch',{name:'启用定时执行',exact:true}).click();
  await page.getByRole('switch',{name:'暂停定时执行',exact:true}).waitFor();
  assert.equal(updates,1);
  await page.getByRole('switch',{name:'暂停定时执行',exact:true}).click();
  await page.getByRole('switch',{name:'启用定时执行',exact:true}).waitFor();
  assert.equal(updates,2);
  await page.getByRole('button',{name:'编辑',exact:true}).click();
  await page.getByLabel('执行频率',{exact:true}).selectOption('interval');
  await page.getByLabel('间隔小时',{exact:true}).fill('6');
  fs.mkdirSync('/private/tmp/oceanflow-schedules-ui',{recursive:true});
  for(const width of [1440,1100,760,390]){
   await page.setViewportSize({width,height:1100});
   await page.screenshot({path:`/private/tmp/oceanflow-schedules-ui/${width}.png`,fullPage:true});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),`page overflow at ${width}`);
  }
  await page.getByRole('button',{name:'保存定时器',exact:true}).click();
  await page.getByText('每 6 小时',{exact:true}).waitFor();
  assert.equal(timers[0].interval_hours,6);assert.equal(creates,1);assert.equal(updates,3);
  assert.deepEqual(errors,[]);
  console.log('Timer create, persisted reload, enable/pause/edit and 1440/1100/760/390 layouts passed (mock only).');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});

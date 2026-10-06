// Full UI lifecycle using intercepted transport; Django tests exercise the actual 15-node executor.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const { chromium } = require("./browser-runtime.cjs");
(async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{
  const page=await browser.newPage();let saved=null,run=null,runRequests=0,approvalRequests=0,stopRequests=0,events=[];const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const brief={schema_version:'ProductBrief@1',product_id:'mock-cj',title:'Mock CJ selected product',description:'Mock verified source',selling_points:['Black'],images:['/test-store/crownley/products/demo.svg'],currency:'USD',market:'US',variants:[{sku:'MOCK',size:'Black',price:'16.42',inventory:5,cj_pid:'pid',cj_vid:'vid'}],source_kind:'cj_selection',evidence_ref:'mock-only',source_note:'Synthetic fixture'};
  const selectionSkill={id:'mock-selection',key:'product.opportunity',version:'5.0.0',handler:'product.opportunity.v5',status:'approved',selectable:true,manifest:{id:'registered.mock-selection',name:'CJ 订单与刊登关注度选品',version:'5.0.0',runtime:'script',description:'Fixture',input:'DeliveryCandidates@1',output:'SelectionProposal@1',entrypointRef:'registered://mock-selection',parameterSchema:{},capabilities:[],effects:['read'],channels:['*']}};
  const supplySkill={...selectionSkill,id:'mock-supply',version:'1.0.0',handler:'product.opportunity.v1',manifest:{...selectionSkill.manifest,id:'registered.mock-supply',version:'1.0.0',name:'商品机会与售价建议'}};
  const frozen=()=>({id:'release',document:saved.document,revision:1,digest:'a'.repeat(64),version_id:'version',store_id:'store',store_version:1,scope:'cj-launch'});
  const indexOf=id=>saved.document.nodes.findIndex(n=>n.definitionId===id);
  const approve=stage=>({id:stage,stage,status:'pending',run_revision:1,digest:'b'.repeat(64),snapshot:{payload:brief},expires_at:'2099-01-01T00:00:00Z'});
  await page.route('**/backend/v1/**',async route=>{
   const req=route.request(),url=new URL(req.url()).pathname;
   if(url.endsWith('/auth/session'))return route.fulfill({json:{authenticated:true,csrf_token:'mock',mode:'desktop',user:{username:'mock',role:'admin',team_id:'team'}}});
   if(url.endsWith('/workflow-designs')){if(req.method()==='GET')return route.fulfill({json:saved?[saved]:[]});saved={id:'design',document:req.postDataJSON().document,revision:1};return route.fulfill({json:saved});}
   if(url.endsWith('/freeze')||url.endsWith('/workflow-releases/release'))return route.fulfill({json:frozen()});
   if(url.endsWith('/stores'))return route.fulfill({json:[{id:'store',name:'Frozen store',verified:true,active:true}]});
   if(url.endsWith('/node-definitions'))return route.fulfill({json:{nodes:[]}});
   if(url.endsWith('/runs')){if(req.method()==='GET')return route.fulfill({json:run?[run]:[]});runRequests++;assert.equal(req.postDataJSON().version_id,'version');assert.equal(req.postDataJSON().store_id,'store');assert.equal(req.postDataJSON().brief,undefined);run={id:'run',workflow_version_id:'version',document:saved.document,context:{},status:'queued',cursor:0,node_id:saved.document.nodes[0].id,revision:1,generation:1,sequence:0,error:'',approvals:[]};return route.fulfill({json:run,status:202});}
   if(url.endsWith('/runs/run/events'))return route.fulfill({json:{events}});
   if(url.endsWith('/runs/run/cancel')){stopRequests++;assert.equal(req.postDataJSON().expected_revision,run.revision);run={...run,status:'running',revision:run.revision+1,context:{...run.context,stop_requested:true}};return route.fulfill({json:run});}
   if(url.endsWith('/runs/run/resume')){
    assert.equal(req.postDataJSON().expected_revision,run.revision);
    run={...run,status:'queued',revision:run.revision+1,error:''};
    return route.fulfill({json:run});
   }
   if(url.endsWith('/runs/run'))return route.fulfill({json:run});
   if(url.includes('/approvals/')&&req.method()==='POST'){approvalRequests++;assert.equal(req.postDataJSON().decision,'approve');const cursor=indexOf(approvalRequests===1?'listing.authorize':'listing.end');if(approvalRequests===1){run={...run,context:{brief,listing:brief},cursor,node_id:saved.document.nodes[cursor].id,approvals:[approve('listing')]};}else{run={...run,status:'succeeded',cursor,node_id:saved.document.nodes[cursor].id,context:{...run.context,published:{product_id:'mock-cj'}},approvals:[]};}return route.fulfill({json:run});}
   if(url.endsWith('/market-evidence'))return route.fulfill({json:[]});
   if(url.endsWith('/connections/cj/search-preview')){
    const p=req.postDataJSON();assert.equal(p.keyword,'cat');assert.equal(p.categoryId,'');assert.deepEqual(p.categoryQueries,[]);assert.equal(p.emptyResultPolicy,'pause');
    return route.fulfill({json:{outcome:'no_results',products:[],message:'Mock keyword preview'}});
   }
   if(url.endsWith('/connections/cj/categories'))return route.fulfill({json:{categories:[]}});
   if(url.endsWith('/skills'))return route.fulfill({json:[selectionSkill,supplySkill,{id:'mock-content',key:'content.editorial',version:'1.0.1',handler:'content.editorial.v1',status:'approved',selectable:true,reviewed_at:'2026-10-03T00:00:00Z',manifest:{id:'registered.mock-content',name:'原素材与商品文案整理',version:'1.0.1',runtime:'script',description:'Fixture',input:'ApprovedProductBrief@2',output:'ListingDraft@1',entrypointRef:'registered://mock-content',parameterSchema:{},capabilities:[],effects:['read','artifact'],channels:['*']}}]});
   throw Error('Unexpected transport '+url);
  });
  await page.goto('http://localhost:3000/workflow/builder');
  await page.getByRole('button',{name:'打开定义商品任务',exact:true}).click();
  const taskDialog=page.getByRole('dialog');
  await taskDialog.getByText('CJ 订单与供货数据 · 默认',{exact:true}).waitFor();
  assert.equal(await taskDialog.getByRole('checkbox',{name:/类目/}).count(),0,'single keyword replaces the category directory');
  await taskDialog.getByLabel('商品搜索词',{exact:true}).fill('cat');
  await taskDialog.getByLabel('订单达标候选数量（20–10000）',{exact:true}).fill('200');
  await taskDialog.getByLabel('最低可确认库存（件）',{exact:true}).fill('7');
  await taskDialog.getByLabel('最长预计运输时效（天）',{exact:true}).fill('18');
  await taskDialog.getByLabel('税费及附加费预留 USD（启动假设，请按商品核实）',{exact:true}).fill('3');
  await taskDialog.getByRole('button',{name:'试搜商品（只读）',exact:true}).click();
  await taskDialog.getByText('Mock keyword preview',{exact:true}).waitFor();
  assert.equal(await taskDialog.getByLabel('CJ 最低订单数（统计周期未声明）',{exact:true}).isVisible(),false,'sales threshold is advanced, not actual sales entry');
  fs.mkdirSync('/private/tmp/oceanflow-run-ui',{recursive:true});
  await taskDialog.screenshot({path:'/private/tmp/oceanflow-run-ui/selection-basis.png'});
  assert.equal(await taskDialog.getByRole('button',{name:'配置 CJ 自动证据并绑定选品算法'}).count(),0);
  await taskDialog.getByText('其他选品依据 · 高级设置',{exact:true}).click();
  assert.equal(await taskDialog.getByLabel('CJ 最低订单数（统计周期未声明）',{exact:true}).isVisible(),true);
  await taskDialog.getByLabel('选品依据',{exact:true}).selectOption('none');
  await taskDialog.getByRole('button',{name:'应用到节点',exact:true}).click();
  await page.getByRole('button',{name:'打开定义商品任务',exact:true}).click();
  assert.equal(await taskDialog.getByLabel('选品依据',{exact:true}).inputValue(),'none');
  await taskDialog.getByLabel('选品依据',{exact:true}).selectOption('external');
  assert.equal(await taskDialog.getByRole('button',{name:'应用到节点',exact:true}).isDisabled(),true);
  await taskDialog.getByRole('button',{name:'取消',exact:true}).click();
  await page.getByRole('button',{name:'打开定义商品任务',exact:true}).click();
  assert.equal(await taskDialog.getByLabel('选品依据',{exact:true}).inputValue(),'none','cancelled source edits do not change the task');
  await taskDialog.getByLabel('选品依据',{exact:true}).selectOption('cj');
  await taskDialog.getByRole('button',{name:'应用到节点',exact:true}).click();
  await page.getByRole('button',{name:'▶ 运行流程',exact:true}).click();
  await page.getByRole('region',{name:'运行工作台',exact:true}).waitFor();
  await page.waitForFunction(()=>document.body.textContent.includes('完整运行已持久化'));
  assert.equal(runRequests,1);assert.equal(new URL(page.url()).pathname,'/workflow/builder');
  assert.equal(await page.locator('[class*="canvasViewport"]').count(),1,'one canvas during execution');
  await page.getByRole('button',{name:'打开定义商品任务',exact:true}).click();
  assert.equal(await page.getByRole('dialog').count(),0,'runtime node opens details, not configuration');
  assert.equal(saved.document.nodes.find(n=>n.definitionId==='product.start').binding.parameters.limit,10);
  assert.equal(saved.document.nodes.find(n=>n.definitionId==='product.start').binding.parameters.variantsPerProduct,3);
  assert.equal(saved.document.nodes.find(n=>n.definitionId==='product.start').binding.parameters.taxReserveUsd,3);
  assert.equal(saved.document.nodes.find(n=>n.definitionId==='product.start').binding.parameters.minimumInventory,7);
  assert.equal(saved.document.nodes.find(n=>n.definitionId==='product.start').binding.parameters.maximumDeliveryDays,18);
  assert(!saved.document.nodes.some(n=>['product.cost','product.decide'].includes(n.definitionId)));
  assert.equal(saved.document.nodes[2].definitionId,'product.verify');
  assert.equal(saved.document.nodes.length,11);
  assert.equal(saved.document.nodes.find(n=>n.definitionId==='product.start').binding.parameters.marketEvidenceSource,'cj');
  assert.equal(saved.document.nodes.find(n=>n.definitionId==='product.start').binding.parameters.minimumCJOrderCount,1);
  assert.equal(saved.document.nodes.find(n=>n.definitionId==='product.start').binding.parameters.demandFirstCollection,true);
  assert.equal(saved.document.nodes.find(n=>n.definitionId==='product.start').binding.parameters.keyword,'cat');
  assert.equal(saved.document.nodes.find(n=>n.definitionId==='product.start').binding.parameters.scanBudget,200);
  assert.deepEqual(saved.document.nodes.find(n=>n.definitionId==='product.start').binding.parameters.categoryQueries,[]);
  assert.equal(saved.document.nodes.find(n=>n.definitionId==='product.start').binding.parameters.categoryId,'');
  assert.equal(saved.document.nodes.find(n=>n.definitionId==='product.start').binding.parameters.emptyResultPolicy,'pause');
  assert.equal(saved.document.nodes.find(n=>n.definitionId==='product.start').binding.parameters.minimumCJSales90d,undefined);
  assert.equal(saved.document.selectionStrategy.binding.skillVersion,'5.0.0');
  assert.equal(saved.document.nodes.find(n=>n.definitionId==='product.start').binding.parameters.candidateSource,'catalog');
  assert.equal(saved.document.selectionStrategy.binding.skillId,'registered.mock-selection');
  assert.equal(saved.document.nodes.find(n=>n.definitionId==='content.make').binding.skillId,'registered.mock-content');
  assert.deepEqual(saved.document.nodes.find(n=>n.definitionId==='content.make').binding.parameters,{});
  assert.equal(await page.getByRole('button',{name:'配置真实选品任务'}).count(),0);
  assert.equal(await page.getByRole('switch',{name:'商品与售价人工审核'}).count(),0);
  // Editing must retain the existing run and its frozen graph, without a second POST.
  const originalTitle=run.document.title;
  await page.getByRole('button',{name:'退出当前运行',exact:true}).click();
  await page.getByRole('button',{name:'返回当前运行',exact:true}).waitFor();
  assert.equal(await page.getByRole('region',{name:'运行工作台',exact:true}).count(),0);
  await page.getByRole('button',{name:'技术视图 ↗',exact:true}).click();
  await page.getByText('流程文档与后端对接',{exact:true}).click();
  await page.getByLabel('流程名称',{exact:true}).fill('Edited draft, not the current run');
  await page.getByRole('button',{name:'保存配置',exact:true}).click();
  await page.waitForFunction(()=>document.body.textContent.includes('配置已保存到后端'));
  assert.equal(saved.document.title,'Edited draft, not the current run');
  assert.equal(run.document.title,originalTitle);
  await page.goto('http://localhost:3000/customers');
  await page.goto('http://localhost:3000/workflow/builder');
  await page.getByRole('button',{name:'返回当前运行',exact:true}).waitFor();
  await page.reload();
  await page.getByRole('button',{name:'返回当前运行',exact:true}).waitFor();
  // The primary /workflow route must restore the same saved design, not a new UUID.
  await page.goto('http://localhost:3000/workflow');
  await page.getByRole('button',{name:'返回当前运行',exact:true}).waitFor();
  assert.equal(await page.getByRole('heading',{name:'Edited draft, not the current run',exact:true}).count(),1);
  await page.reload();
  await page.getByRole('button',{name:'返回当前运行',exact:true}).waitFor();
  assert.equal(await page.getByRole('heading',{name:'Edited draft, not the current run',exact:true}).count(),1);
  assert.equal(stopRequests,0,'exit and navigation never cancel the task');
  await page.getByRole('button',{name:'返回当前运行',exact:true}).click();
  await page.getByRole('region',{name:'运行工作台',exact:true}).waitFor();
  assert.equal(runRequests,1,'returning to the existing task never creates a new run');
  assert.equal(run.id,'run');
  const started=new Date(Date.now()-200000).toISOString(),completedAt=new Date().toISOString();
  run={...run,status:'running',cursor:2,node_id:saved.document.nodes[2].id,
   context:{batch_meta:{target:100,qualified:50},selection:{research_index:50,records:Array.from({length:100},(_,i)=>({id:`pid-${i}`,nameEn:`Fixture product ${i}`})),facts:Array.from({length:50},()=>({})),current_research:{records:[{id:'pid-50',nameEn:'Fixture product 50'}]}}},
   attempts:[{node_id:saved.document.nodes[2].id,generation:1,status:'progress',created_at:started,completed_at:completedAt}]};
  const progress=page.getByRole('region',{name:'当前节点进度'});
  await progress.getByText('已合格 50 款 · 最终选取 100 款 · 统一核验 50 / 100 款',{exact:true}).waitFor();
  await progress.getByText('当前商品：Fixture product 50',{exact:true}).waitFor();
  assert.equal(await progress.getByRole('progressbar').getAttribute('value'),'50');
  // Processing highlights only the current node; it must not emit outgoing packets.
  const runningCard=page.locator('[data-run-state="running"]');
  assert.equal(await runningCard.count(),1);
  const trace=runningCard.locator('rect[class*="frameTrace"]');
  assert.notEqual(await trace.evaluate(el=>getComputedStyle(el).animationName),'none');
  assert.equal(await page.locator('[data-edge-id][data-active="true"]').count(),0);
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await trace.evaluate(el=>getComputedStyle(el).animationName),'none');
  assert.equal(await runningCard.locator('svg[class*="executionFrame"]').evaluate(el=>getComputedStyle(el).display),'none');
  await page.emulateMedia({reducedMotion:'no-preference'});
  // Replay a persisted arrival, not a synthetic timer-based business completion.
  await page.locator('[data-run-canvas]').scrollIntoViewIfNeeded();
  const incoming=saved.document.edges.find(e=>e.target===run.node_id&&e.kind==='forward');
  assert(incoming);
  events=[{sequence:1,nodeId:incoming.source,status:'transferring',edgeId:incoming.id,occurredAt:completedAt}];
  run={...run,sequence:1};
  const activeEdge=page.locator('[data-edge-id][data-active="true"]');
  await activeEdge.waitFor();
  assert.equal(await activeEdge.getAttribute('data-edge-id'),incoming.id);
  const beam=activeEdge.locator('path[class*="beam_"]').first();
  const offset=await beam.evaluate(el=>getComputedStyle(el).strokeDashoffset);
  await page.waitForFunction(({initial})=>{
    const path=document.querySelector('[data-edge-id][data-active="true"] path[class*="beam_"]');
    return path&&getComputedStyle(path).strokeDashoffset!==initial;
  },{initial:offset},{timeout:800});
  assert.equal(await activeEdge.locator('animateMotion').count(),1);
  await activeEdge.waitFor({state:'detached'});
  await runningCard.waitFor();
  fs.mkdirSync('/private/tmp/oceanflow-run-ui',{recursive:true});
  await page.screenshot({path:'/private/tmp/oceanflow-run-ui/running.png',fullPage:true,animations:'disabled'});
  await page.locator('[data-run-canvas]').screenshot({path:'/private/tmp/oceanflow-run-ui/motion-canvas.png'});
  run={...run,context:{batch_meta:{target:100,qualified:51},selection:{...run.context.selection,research_index:51,facts:Array.from({length:51},()=>({}))}}};
  await progress.getByText('已合格 51 款 · 最终选取 100 款 · 统一核验 51 / 100 款',{exact:true}).waitFor();
  assert.equal(await progress.getByRole('progressbar').getAttribute('value'),'51');
  // Historical CJ research pauses did not have basis/warning/unknowns or a variant ID.
  // They must render without pretending a complete score exists, and keep the canvas alive.
  run={...run,status:'needs_attention',cursor:2,node_id:saved.document.nodes[2].id,
   context:{batch_meta:run.context.batch_meta,selection:run.context.selection,selection_proposal:{algorithm:'product.opportunity.v3',recommended_vid:null,ranked:[],rejected:[{pid:'missing-sales-product',reasons:['CJ 近 90 天销量未返回']}]}},error:'Fixture research pause'};
  await progress.getByText('已暂停，请查看原因',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-run-state="running"]').count(),0);
  assert.equal(await page.locator('[data-edge-id][data-active="true"]').count(),0);
  assert.equal(await progress.getByText(/当前商品：/).count(),0);
  await page.getByRole('tab',{name:'结果',exact:true}).click();
  await page.getByText(/待研究 \/ 未通过：missing-sales-product/).waitFor();
  await page.getByText('当前是资料检查结果，尚未形成完整选品评分。',{exact:true}).waitFor();
  await page.screenshot({path:'/private/tmp/oceanflow-run-ui/paused.png',fullPage:true,animations:'disabled'});
  assert.equal(await page.getByText(/Application error/).count(),0);
  run={...run,context:{...run.context,selection_proposal:{...run.context.selection_proposal,phase:'research',basis:'Fixture source check',warning:'No publication',unknowns:['CJ 近 90 天销量']}}};
  await page.getByText('未知项：CJ 近 90 天销量',{exact:true}).waitFor();
  const resume=page.getByRole('button',{name:'继续运行（从断点恢复）',exact:true});
  await resume.waitFor();await resume.click();
  await page.waitForFunction(()=>document.body.textContent.includes('revision 2'));
  assert.equal(run.cursor,2);assert.equal(run.context.selection.facts.length,51);
  run={...run,status:'waiting_approval',cursor:indexOf('product.authorize'),node_id:saved.document.nodes[indexOf('product.authorize')].id,context:{brief},approvals:[approve('brief')]};
  await page.getByRole('heading',{name:'第一轮：确认商品与售价',exact:true}).waitFor();
  await page.getByLabel('审批原因',{exact:true}).fill('Mock first review');await page.getByRole('button',{name:'批准当前版本',exact:true}).click();
  await page.getByRole('heading',{name:'第二轮：审核最终上架草稿',exact:true}).waitFor();
  await page.getByLabel('审批原因',{exact:true}).fill('Mock final review');await page.getByRole('button',{name:'批准当前版本',exact:true}).click();
  await page.getByRole('link',{name:'打开已发布商品 ↗',exact:true}).waitFor();
  assert.equal(approvalRequests,2);assert.deepEqual(errors,[]);
  const other={...brief,product_id:'mock-second',title:'Second batch item'};
  run={...run,status:'waiting_approval',cursor:indexOf('product.authorize'),node_id:saved.document.nodes[indexOf('product.authorize')].id,
   context:{brief,batch_mode:'parent',batch_meta:{target:2,qualified:2}},
   approvals:[{...approve('brief'),snapshot:{payload:brief,batch_items:[brief,other]}}]};
  await page.getByText('请核对本批次全部 2 款商品，批准绑定整个清单。',{exact:true}).waitFor();
  await page.getByRole('heading',{name:'Second batch item',exact:true}).waitFor();
  await page.screenshot({path:'/private/tmp/oceanflow-run-ui/batch-approval.png',fullPage:true,animations:'disabled'});
  assert.equal(await page.getByText('修订草稿并重新提交',{exact:true}).count(),0);
  run={...run,status:'succeeded',cursor:indexOf('listing.end'),node_id:saved.document.nodes[indexOf('listing.end')].id,approvals:[],context:{...run.context,batch_meta:{target:2,qualified:2,published:2,failed:0},batch_items:[{run_id:'child',product_id:other.product_id,title:other.title,status:'succeeded',error:'',external_id:'external'}]}};
  await page.getByRole('link',{name:'查看本批次已发布商品 ↗',exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  for(const width of [1100,760,390]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'overflow '+width);}
  run={...run,status:'running'};
  const stop=page.getByRole('button',{name:'停止当前运行',exact:true});await stop.waitFor();
  page.once('dialog',dialog=>dialog.accept());await stop.click();
  await page.getByRole('button',{name:'正在停止…',exact:true}).waitFor();
  assert.equal(stopRequests,1);assert.equal(runRequests,1);
  run={...run,status:'cancelled'};
  await page.getByText('已取消',{exact:true}).first().waitFor();
  console.log('Same-canvas full launch start, inherited settings, two reviews and publication result passed (mock only).');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

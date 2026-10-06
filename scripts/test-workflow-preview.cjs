const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");

// Compile only these local, side-effect-free design modules in memory. Skill
// entrypointRef values are data: this loader never imports or executes them.
const root = path.resolve(__dirname, "..");
const allowed = new Set(["universal", "contract-schemas", "channels", "client", "operator-policy", "store-publishing", "recommended-defaults", "default-content-skill", "default-runtime-skills", "run-progress", "selection-flow"].map(name => path.join(root, "lib/workflow", `${name}.ts`)));
for (const name of ["graph", "model"]) allowed.add(path.join(root, "components/commerce/workflow", `${name}.ts`));
const cache = new Map();
function load(filename) {
  assert.ok(allowed.has(filename), `Unexpected module import: ${filename}`);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} };
  cache.set(filename, module);
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  });
  const localRequire = specifier => {
    assert.ok(specifier.startsWith("."), `Non-local import rejected: ${specifier}`);
    return load(path.resolve(path.dirname(filename), `${specifier}.ts`));
  };
  new Function("exports", "require", "module", outputText)(module.exports, localRequire, module);
  return module.exports;
}
const model = load(path.join(root, "lib/workflow/universal.ts"));
const createCompactWorkflow=model.createWorkflow;
// Existing graph-edit regressions exercise the historical thirteen-step graph.
// The current eleven-step template has explicit coverage below and in the browser test.
function withoutIntelligence(doc){const nodes=doc.nodes.filter(n=>n.definitionId!=='market.intelligence');return {...doc,nodes,edges:[...model.forwardEdges(nodes),...doc.edges.filter(e=>e.kind!=='forward')]};}
model.createWorkflow=(...args)=>{const doc=model.withSelectionStages(withoutIntelligence(createCompactWorkflow(...args)));delete doc.selectionStrategy;return doc;};
test('current launch embeds its strategy and pricing inside one verification node',()=>{
 const doc=createCompactWorkflow('launch');
 assert.equal(doc.nodes.length,12);
 assert.deepEqual(doc.nodes.slice(0,5).map(n=>n.definitionId),['market.intelligence','product.start','product.collect','product.verify','product.authorize']);
 assert.equal(doc.nodes[0].binding.parameters.enabled,false);
 assert.equal(doc.selectionStrategy.definitionId,'product.decide');
 assert.deepEqual(client.parseWorkflowDocument(JSON.stringify(doc)),doc);
 const expanded=model.withSelectionStages(doc);
 assert.equal(expanded.nodes.length,14);
 assert.deepEqual(model.compactSelectionStages(expanded),doc);
 assert(!model.validateWorkflowPreview(doc).errors.some(e=>['CONTRACT','PRECONDITION'].includes(e.code)));
 const broken=structuredClone(doc);broken.edges=broken.edges.filter(e=>e.kind!=='forward'||e.source!==broken.nodes[2].id);
 assert(model.validateWorkflowPreview(broken).errors.some(e=>e.code==='CONNECTIVITY'));
 const malformed=structuredClone(doc);malformed.selectionStrategy.binding=null;
 assert.throws(()=>client.parseWorkflowDocument(JSON.stringify(malformed)),/策略配置无效/);
});
test('batch progress uses current product evidence, not the whole unresearched pool',()=>{
 const {runProgress}=load(path.join(root,'lib/workflow/run-progress.ts'));
 const document=model.createWorkflow('launch');document.nodes[2].definitionId='product.filter';
 const run={document,cursor:2,status:'running',generation:1,attempts:[],context:{batch_mode:'parent',batch_meta:{target:20,qualified:8},selection:{records:Array.from({length:50},(_,i)=>({id:String(i)})),current_research:{specs:[{product:{pid:'current',title:'Current'},variant:{vid:'sku-a'}},{product:{pid:'current'},variant:{vid:'sku-b'}}],filter_index:1}}}};
 const progress=runProgress(run,Date.now());
  assert.equal(progress.completed,1);assert.equal(progress.total,2);assert.match(progress.summary,/已合格 8 款 · 最终选取 20 款/);
 assert.equal(progress.current,'current · sku-b');
});
test('demand-qualified quota displays qualified slots separately from reads',()=>{
 const {runProgress}=load(path.join(root,'lib/workflow/run-progress.ts'));
 const run={document:{nodes:[{id:'collect',definitionId:'product.collect',title:'采集商品记录'}]},cursor:0,generation:1,status:'running',attempts:[],context:{selection:{collection:{quota_limit:1000,demand_qualified:77,scanned:981,pending:[],pending_index:0}}}};
 const progress=runProgress(run,Date.now());
 assert.equal(progress.completed,77);assert.equal(progress.total,1000);
 assert.match(progress.summary,/已读取 981 款/);
 assert.equal(runProgress(run,Date.now()+5000).completed,77);
 run.context.selection.current_research={records:[{id:'previous'}]};
 assert.equal(runProgress(run,Date.now()).completed,77);
 assert.equal(runProgress(run,Date.now()).total,1000);
 const {candidateCounts}=load(path.join(root,'lib/workflow/run-progress.ts'));
 assert.deepEqual(candidateCounts(run),{qualified:77,scanned:981,limit:1000,quotaMode:true});
 run.context.selection.search=run.context.selection.collection;delete run.context.selection.collection;
 run.document.nodes[0].definitionId='product.verify';
 assert.equal(candidateCounts(run).qualified,77);
 assert.equal(candidateCounts({context:{selection:{}}}),null);
});
test('demand collection progress uses persisted evidence count rather than candidate quota',()=>{
 const {runProgress}=load(path.join(root,'lib/workflow/run-progress.ts'));
 const document=model.createWorkflow('launch');
 const run={document,cursor:1,status:'running',generation:1,attempts:[],context:{selection:{records:[],collection:{products:[],scanned:7,scan_limit:50,pending:[{id:'next'}],pending_index:0}}}};
 const progress=runProgress(run,Date.now());
 assert.equal(progress.summary,'已核验需求 7 / 50 款');assert.equal(progress.current,'next');
 assert.equal(runProgress(run,Date.now()+10000).completed,7);
 run.context.selection.collection.excluded_existing=[{pid:'already',reason:'published'}];
 assert.match(runProgress(run,Date.now()).summary,/已跳过同店铺已上架\/提交中 1 款/);
 run.status='needs_attention';assert.equal(runProgress(run,Date.now()).current,'');
});
test('catalog replaces trending in editable drafts only',()=>{
 const {recommendCatalogCandidates}=load(path.join(root,'lib/workflow/default-runtime-skills.ts'));
 const doc=model.createWorkflow('launch');
 const params=d=>d.nodes.find(n=>n.definitionId==='product.start').binding.parameters;
 assert.equal(params(doc).candidateSource,'catalog');
 const old=structuredClone(doc);delete params(old).candidateSource;
 const before=structuredClone(old),draft=recommendCatalogCandidates(old);
 assert.equal(params(draft).candidateSource,'catalog');assert.deepEqual(old,before);
 const trending=structuredClone(doc);params(trending).candidateSource='trending';
 assert.equal(params(recommendCatalogCandidates(trending)).candidateSource,'catalog');
 assert.equal(params(trending).candidateSource,'trending');
 const explicit=structuredClone(doc);params(explicit).candidateSource='catalog';
 assert.equal(recommendCatalogCandidates(explicit),explicit);
 const policy=load(path.join(root,'lib/workflow/operator-policy.ts'));
 const task=doc.nodes.find(n=>n.definitionId==='product.start'),edited=structuredClone(task);
 edited.binding.parameters.candidateSource='catalog';
 assert.equal(policy.applyOperatorNodeSettings(task,edited).binding.parameters.candidateSource,'catalog');
});
test('editable CJ v3 migrates to order-count v4 without rewriting the original document',()=>{
 const {recommendCJOrderCount,bindDefaultRuntimeSkills}=load(path.join(root,'lib/workflow/default-runtime-skills.ts'));
 const doc=model.createWorkflow('launch');
 doc.nodes.find(n=>n.definitionId==='content.make').binding.mode='custom';
 const task=d=>d.nodes.find(n=>n.definitionId==='product.start').binding.parameters;
 const decision=d=>d.nodes.find(n=>n.definitionId==='product.decide').binding;
 task(doc).marketEvidenceSource='cj';task(doc).minimumCJSales90d=30;
 Object.assign(decision(doc),{skillId:'registered.legacy',skillVersion:'3.0.0',mode:'custom',parameters:{}});
 const before=structuredClone(doc),draft=recommendCJOrderCount(doc);
 assert.deepEqual(doc,before);assert.equal(task(draft).minimumCJSales90d,undefined);assert.equal(task(draft).minimumCJOrderCount,1);
 assert.throws(()=>bindDefaultRuntimeSkills(draft,[]));
 const row={id:'order-count',handler:'product.opportunity.v5',version:'5.0.0',status:'approved',selectable:true,manifest:{...model.getSkill('product.decide.core'),id:'registered.order-count',version:'5.0.0'}};
 const bound=bindDefaultRuntimeSkills(draft,[row]);
 assert.equal(decision(bound).skillVersion,'5.0.0');assert.equal(recommendCJOrderCount(bound),bound);
});
test('explicit evidence source edits atomically update the task and approved strategy',()=>{
 const {applySelectionBasis}=load(path.join(root,'lib/workflow/default-runtime-skills.ts'));
 const doc=model.createWorkflow('launch');
 const task=doc.nodes.find(n=>n.definitionId==='product.start');task.binding.parameters.marketEvidenceRef='evidence';task.binding.parameters.allowEstimatedSales=true;
 const before=structuredClone(doc);
 const make=(version)=>({...model.getSkill('product.decide.core'),id:`registered.fixture-${version}`,version});
 for(const [source,version] of [['cj','5.0.0'],['none','1.0.0'],['external','2.0.0']]){
  const edited=structuredClone(task);edited.binding.parameters.marketEvidenceSource=source;
  const result=applySelectionBasis(doc,edited,make(version));
  const p=result.nodes.find(n=>n.definitionId==='product.start').binding.parameters;
  const binding=result.nodes.find(n=>n.definitionId==='product.decide').binding;
  assert.equal(p.marketEvidenceSource,source);assert.equal(binding.skillVersion,version);assert.deepEqual(binding.parameters,{});
  assert.equal(p.demandFirstCollection,source==='cj'?true:undefined);
  assert.equal(p.limit,task.binding.parameters.limit);assert.equal(p.market,task.binding.parameters.market);
  assert.equal(p.marketEvidenceRef,source==='external'?'evidence':undefined);
  assert.equal(p.allowEstimatedSales,source==='external'?true:undefined);
 }
 assert.deepEqual(doc,before);
 const empty=structuredClone(task);empty.binding.parameters.marketEvidenceSource='external';delete empty.binding.parameters.marketEvidenceRef;
 assert.throws(()=>applySelectionBasis(doc,empty,make('2.0.0')),/批次/);
 const wrong=structuredClone(task);wrong.binding.parameters.marketEvidenceSource='cj';assert.throws(()=>applySelectionBasis(doc,wrong,make('1.0.0')),/不兼容/);
});
test('default selection binds CJ facts and approved v5 together without changing explicit choices',()=>{
 const {bindDefaultRuntimeSkills}=load(path.join(root,'lib/workflow/default-runtime-skills.ts'));
 const doc=model.createWorkflow('launch');doc.nodes.find(n=>n.definitionId==='content.make').binding.mode='custom';
 const fixture=(handler,version)=>({id:handler,handler,version,status:'approved',selectable:true,manifest:{...model.getSkill('product.decide.core'),id:`registered.${handler}`,version,entrypointRef:`registered://${handler}`}});
 const v3=fixture('product.opportunity.v5','5.0.0'),v2=fixture('product.opportunity.v2','2.0.0');
 const result=bindDefaultRuntimeSkills(doc,[v3]);
 const task=d=>d.nodes.find(n=>n.definitionId==='product.start').binding.parameters;
 const decision=d=>d.nodes.find(n=>n.definitionId==='product.decide').binding;
 assert.equal(task(result).marketEvidenceSource,'cj');assert.equal(task(result).minimumCJOrderCount,1);
 assert.equal(decision(result).skillId,v3.manifest.id);assert.deepEqual(decision(result).parameters,{});
 assert.equal(decision(doc).skillId,'product.decide.core');
 assert.equal(bindDefaultRuntimeSkills(result,[]),result);
 assert.throws(()=>bindDefaultRuntimeSkills(doc,[]));
 assert.throws(()=>bindDefaultRuntimeSkills(doc,[{...v3,status:'revoked'}]));
 const external=structuredClone(doc);task(external).marketEvidenceRef='evidence';task(external).allowEstimatedSales=false;
 const ext=bindDefaultRuntimeSkills(external,[v2]);assert.equal(task(ext).marketEvidenceSource,'external');assert.equal(task(ext).marketEvidenceRef,'evidence');assert.equal(decision(ext).skillId,v2.manifest.id);
 const custom=structuredClone(doc);decision(custom).mode='custom';assert.equal(bindDefaultRuntimeSkills(custom,[v3]),custom);
 const noEvidence=structuredClone(doc);task(noEvidence).marketEvidenceSource='none';assert.throws(()=>bindDefaultRuntimeSkills(noEvidence,[v3]));
 const instruction=structuredClone(doc);decision(instruction).parameters.instruction='custom';assert.throws(()=>bindDefaultRuntimeSkills(instruction,[v3]));
});
test('default content resolves only to an executable approved registry version',()=>{
 const {bindDefaultContentSkill}=load(path.join(root,'lib/workflow/default-content-skill.ts'));
 const doc=model.createWorkflow('launch');
 const row={id:'content-test',handler:'content.editorial.v1',status:'approved',selectable:true,version:'1.0.1',reviewed_at:'2026-10-03',manifest:{...model.getSkill('content.make.core'),id:'registered.content-test',version:'1.0.1',entrypointRef:'registered://content-test'}};
 const bound=bindDefaultContentSkill(doc,[row]);
 assert.equal(bound.nodes.find(n=>n.definitionId==='content.make').binding.skillId,row.manifest.id);
 assert.equal(doc.nodes.find(n=>n.definitionId==='content.make').binding.skillId,'content.make.core');
 assert.deepEqual(bound.nodes.find(n=>n.definitionId==='content.make').binding.parameters,{});
 assert.equal(bindDefaultContentSkill(bound,[]),bound,'locked selections never fall back');
 for(const invalid of [{...row,status:'revoked'},{...row,selectable:false},{...row,handler:'unknown'},{...row,manifest:{...row.manifest,input:'wrong'}}])assert.throws(()=>bindDefaultContentSkill(doc,[invalid]));
 const legacy=structuredClone(doc);legacy.nodes.find(n=>n.definitionId==='content.make').binding.parameters={market:'US',timeout:60,prompt:'依据已核实的商品事实生成本地化文案；图片工具返回实际素材引用。',imageProviderRef:'',locale:'en-US'};
 assert.deepEqual(bindDefaultContentSkill(legacy,[row]).nodes.find(n=>n.definitionId==='content.make').binding.parameters,{});
 legacy.nodes.find(n=>n.definitionId==='content.make').binding.parameters.prompt='Generate a new image';
 assert.throws(()=>bindDefaultContentSkill(legacy,[row]),/自定义/);
 const custom=structuredClone(doc);custom.nodes.find(n=>n.definitionId==='content.make').binding.mode='custom';
 assert.equal(bindDefaultContentSkill(custom,[row]),custom);
});
// Explicit finance assumptions for configured test fixtures; production defaults never assume zero tax.
function fixtureWorkflow(...args){return model.createWorkflow(...args);}
test('new draft gets explicit starting assumptions; deleted tax still blocks',()=>{
 const doc=model.createWorkflow('launch');
 const params=id=>doc.nodes.find(n=>n.definitionId===id).binding.parameters;
 assert.equal(params('product.start').limit,10);assert.equal(params('product.start').variantsPerProduct,3);
 assert.equal(params('product.start').finalSelectionMode,'global');
 assert.equal(params('product.start').minimumInventory,5);assert.equal(params('product.start').allowFactorySupply,false);
 assert.equal(params('product.start').maximumDeliveryDays,20);assert.equal(params('product.start').taxReserveUsd,2);
 assert.deepEqual(params('product.verify'),{});assert.deepEqual(params('product.cost'),{});
 delete params('product.start').taxReserveUsd;assert(validateWorkflowPreviewForTax(doc));
});
test('legacy selection draft moves actual rules forward without changing the original or replacing strategy',()=>{
 const {unifySelectionDraft,selectionRuleKeys}=load(path.join(root,'lib/workflow/selection-flow.ts'));
 const legacy=model.createWorkflow('launch');
 const task=legacy.nodes[0];for(const key of selectionRuleKeys)delete task.binding.parameters[key];
 const oldChecks=['product.normalize','product.filter','product.delivery'].map((id,i)=>{
  const skill=model.getSkill(id+'.core');return {id:'old-check-'+i,definitionId:id,title:model.getDefinition(id).title,binding:{skillId:skill.id,skillVersion:skill.version,mode:'default',parameters:model.defaultParameters(skill)}};
 });
 legacy.nodes=[...legacy.nodes.slice(0,2),...oldChecks,...legacy.nodes.slice(3)];
 legacy.nodes.find(n=>n.definitionId==='product.filter').binding.parameters.minimumInventory=17;
 legacy.nodes.find(n=>n.definitionId==='product.delivery').binding.parameters.maximumDeliveryDays=18;
 legacy.nodes.find(n=>n.definitionId==='product.cost').binding.parameters={taxReserveUsd:0,paymentFeeRate:4};
 legacy.edges=model.forwardEdges(legacy.nodes);const before=structuredClone(legacy);
 const next=unifySelectionDraft(legacy);
 assert.deepEqual(legacy,before);assert.equal(next.nodes.length,11);assert.equal(next.nodes[2].definitionId,'product.verify');
 assert.equal(next.nodes[0].binding.parameters.minimumInventory,17);assert.equal(next.nodes[0].binding.parameters.maximumDeliveryDays,18);
 assert.equal(next.nodes[0].binding.parameters.taxReserveUsd,0);assert.equal(next.nodes[0].binding.parameters.paymentFeeRate,4);
 assert(!next.nodes.some(n=>['product.cost','product.decide'].includes(n.definitionId)));
 assert.deepEqual(next.selectionStrategy,legacy.nodes.find(n=>n.definitionId==='product.decide'));
 assert.equal(unifySelectionDraft(next),next);
});
test('filling defaults never overrides saved values, false, zero or deliberately cleared fields',()=>{
 const {fillUnsetParameters}=load(path.join(root,'lib/workflow/recommended-defaults.ts'));
 const old={limit:30,approvalEnabled:false,taxReserveUsd:0,keyword:'',factorySaleLimit:null};
 const before=structuredClone(old);
 const filled=fillUnsetParameters(old,{limit:10,approvalEnabled:true,taxReserveUsd:2,keyword:'hat',factorySaleLimit:5,maximumDeliveryDays:20});
 assert.deepEqual(old,before);assert.deepEqual(filled,{...before,maximumDeliveryDays:20});
 assert.equal(fillUnsetParameters(old,{limit:10}),old);
});
function validateWorkflowPreviewForTax(doc){return model.validateWorkflowPreview(doc).errors.some(e=>e.code==='PARAMETER'&&e.message.includes('税费'));}
const contracts = load(path.join(root, "lib/workflow/contract-schemas.ts"));
const client = load(path.join(root, "lib/workflow/client.ts"));
const graph = load(path.join(root, "components/commerce/workflow/graph.ts"));
const {mockInterface}=require('./fixtures/publication-interfaces.cjs');
const {applyInstalledStore,inheritedPublishingPlan,refreshCompatiblePublicationPackage}=load(path.join(root,'lib/workflow/store-publishing.ts'));
test('explicit new freeze refreshes compatible package metadata without changing operational configuration',()=>{
 const actions=['listing.validate','listing.publish','listing.wait'];
 const store={id:'11111111-1111-1111-1111-111111111111',name:'Local store',adapter:'test-store.v1',channel:'test-store',verified:true,active:true,configuration_version:1,capabilities:actions};
 const pkg={package:'test-store.v1',version:'1.3.0',channel:'test-store',status:'implemented-local-test-only',design_manifests:actions.map(action=>{const d=model.getDefinition(action);return {id:`installed.test-store.v1.${action}`,name:d.title,version:'1.3.0',runtime:'connector',description:'UI descriptor only',input:d.input,output:d.output,entrypointRef:`installed://test-store.v1/${action}@1.3.0`,parameterSchema:{},capabilities:[],effects:d.allowedEffects,channels:['test-store']};})};
 const old=applyInstalledStore(fixtureWorkflow('launch'),store,pkg),before=structuredClone(old);
 const next=refreshCompatiblePublicationPackage(old,store,{...pkg,version:'1.4.0'});
 assert.deepEqual(old,before);
 assert.equal(inheritedPublishingPlan(next).version,'1.4.0');
 assert.deepEqual(next.nodes.filter(n=>n.definitionId!=='listing.map'),old.nodes.filter(n=>n.definitionId!=='listing.map'));
 assert.deepEqual(next.customSkills,old.customSkills);
 assert.equal(next.environment.storeRef,old.environment.storeRef);
 assert.throws(()=>refreshCompatiblePublicationPackage(old,{...store,configuration_version:2},{...pkg,version:'1.4.0'}));
 const custom=structuredClone(old);custom.nodes.find(n=>n.definitionId==='listing.validate').binding.parameters={custom:'keep'};
 assert.throws(()=>refreshCompatiblePublicationPackage(custom,store,{...pkg,version:'1.4.0'}));
 assert.equal(refreshCompatiblePublicationPackage(old,store,{...pkg,version:'2.0.0'}),old);
});
test('one verified installed store configures all three publication actions without credentials or extra parameters',()=>{
  const doc=fixtureWorkflow('launch'),actions=['listing.validate','listing.publish','listing.wait'];
  const store={id:'11111111-1111-1111-1111-111111111111',name:'Local store',adapter:'test-store.v1',channel:'test-store',verified:true,active:true,configuration_version:1,capabilities:actions};
  const pkg={package:'test-store.v1',version:'1.2.0',channel:'test-store',status:'implemented-local-test-only',design_manifests:actions.map(action=>{const d=model.getDefinition(action);return {id:`installed.test-store.v1.${action}`,name:d.title,version:'1.2.0',runtime:'connector',description:'UI descriptor only',input:d.input,output:d.output,entrypointRef:`installed://test-store.v1/${action}@1.2.0`,parameterSchema:{},capabilities:[],effects:d.allowedEffects,channels:['test-store']};})};
  const next=applyInstalledStore(doc,store,pkg);
  assert.equal(inheritedPublishingPlan(next).storeRef,store.id);
  assert.equal(model.getDefinition('listing.map').output,model.getDefinition('listing.publish').input);
  assert.equal(Boolean(model.getDefinition('listing.map').passthrough),false);
  for(const change of [d=>d.environment.storeRef='different',d=>d.environment.storeIntegration.version='2',d=>d.nodes.find(n=>n.definitionId==='listing.publish').binding.connectionRef='different',d=>d.nodes.find(n=>n.definitionId==='listing.map').binding.parameters.mappingMode='analysis']){
    const invalid=structuredClone(next);change(invalid);assert.throws(()=>inheritedPublishingPlan(invalid));
  }
  const invalid=structuredClone(next);invalid.nodes.find(n=>n.definitionId==='listing.publish').binding.skillVersion='wrong';
  assert.ok(model.validateWorkflowPreview(invalid).errors.some(e=>e.code==='PUBLISH_INHERITANCE'));
  assert.equal(model.validateWorkflowPreview(next).valid,true);
  assert.equal(next.environment.storeRef,store.id);assert.equal(next.environment.storeIntegration.status,'draft');
  assert.equal(next.nodes.find(n=>n.definitionId==='listing.map').binding.parameters.mappingMode,'installed');
  for(const node of next.nodes.filter(n=>actions.includes(n.definitionId))){assert.deepEqual(node.binding.parameters,{});assert.equal(model.resolveNodeConnection(node,next.environment).reference,store.id);}
  for(const bad of [{...store,verified:false},{...store,active:false},{...store,channel:'amazon'},{...store,capabilities:['listing.publish']}])assert.throws(()=>applyInstalledStore(doc,bad,pkg));
  assert.throws(()=>applyInstalledStore(doc,store,{...pkg,design_manifests:[]}));
  assert.equal(doc.environment.storeRef,undefined);
  const extended=applyInstalledStore(doc,store,{...pkg,version:'1.4.0'});
  assert.equal(extended.nodes.find(n=>n.definitionId==='listing.publish').binding.skillVersion,'1.2.0');
  assert.equal(inheritedPublishingPlan(extended).version,'1.4.0');
  assert.equal(model.validateWorkflowPreview(extended).valid,true);
  const malformed=structuredClone(pkg);malformed.design_manifests[1].entrypointRef='installed://other/listing.publish@1.2.0';
  assert.throws(()=>applyInstalledStore(doc,store,malformed));
  const missing=structuredClone(extended);missing.customSkills=missing.customSkills.filter(m=>m.id!=='installed.test-store.v1.listing.publish');
  assert.throws(()=>inheritedPublishingPlan(missing));
});

test('mapping stays between final approval and publishing without generic publishing parameters',()=>{
  for(const channel of ['amazon','shopify','test-store']){
    const doc=fixtureWorkflow('launch',channel),ids=doc.nodes.map(n=>n.definitionId);
    const index=ids.indexOf('listing.map');
    assert.equal(ids[index-1],'listing.authorize');assert.equal(ids[index+1],'listing.publish');
    assert.equal(model.getDefinition('listing.map').input,'ApprovedListing@1');
    for(const id of ['listing.validate','listing.publish','listing.wait']){
      const node=doc.nodes.find(n=>n.definitionId===id),skill=model.getSkill(node.binding.skillId,doc);
      if(skill)assert.deepEqual(skill.parameterSchema,{});
    }
  }
});
test('mapping references survive export, reject malformed pairs, and clear on channel changes',()=>{
  const doc=fixtureWorkflow('launch','amazon'),node=doc.nodes.find(n=>n.definitionId==='listing.map');
  node.binding.parameters={mappingSessionRef:'12345678-1234-1234-1234-123456789abc',mappingSessionRevision:2};
  assert.equal(model.validateWorkflowPreview(doc).valid,true);
  assert.deepEqual(client.parseWorkflowDocument(JSON.stringify(doc)).nodes.find(n=>n.id===node.id).binding.parameters,node.binding.parameters);
  assert.deepEqual(model.rebindChannel(doc,'shopify','merchant').nodes.find(n=>n.id===node.id).binding.parameters,{});
  node.binding.parameters.mappingSessionRevision=1;
  assert.ok(model.validateWorkflowPreview(doc).errors.some(e=>e.code==='MAPPING_REFERENCE'));
});
test('publication preparation cannot run on a later publication receipt',()=>{
  const doc=fixtureWorkflow('launch','amazon'),map=doc.nodes.find(n=>n.definitionId==='listing.map');
  doc.nodes=doc.nodes.filter(n=>n!==map);doc.nodes.splice(doc.nodes.findIndex(n=>n.definitionId==='listing.wait'),0,map);
  doc.edges=model.forwardEdges(doc.nodes);
  assert.ok(model.validateWorkflowPreview(doc).errors.some(e=>e.code==='CONTRACT'&&e.nodeId===map.id));
});
for(const channel of ['amazon','test-store'])test(`${channel}: mock interface maps approved input, submits once, waits for evidence`,()=>{
  const doc=fixtureWorkflow('launch',channel);
  // Explicit test-only manifests; never register these as executable Skills.
  for(const node of doc.nodes.filter(n=>model.isChannelAdapter(n.definitionId)&&!n.binding.skillId)){
    const d=model.getDefinition(node.definitionId),id=`mock.${channel}.${d.id}`;
    doc.customSkills.push({id,name:'Test-only interface',version:'1',runtime:'connector',description:'In-memory test fixture',input:d.input,output:d.output,entrypointRef:`mock://${id}`,parameterSchema:{},capabilities:[],effects:d.allowedEffects,channels:[channel]});
    node.binding={skillId:id,skillVersion:'1',mode:'custom',parameters:{}};
  }
  assert.equal(model.validateWorkflowPreview(doc).valid,true);
  const flow=model.toWorkflowPreview(doc),trace=[];
  let current=flow.nodes[0];
  while(current){trace.push(current.id);current=flow.nodes.find(n=>n.id===current.next);}
  assert.deepEqual(trace,doc.nodes.map(n=>n.id));
  const adapter=mockInterface(channel),approved=structuredClone(contracts.contractExamples['ApprovedListing@1']),before=structuredClone(approved);
  const payload=adapter.map(approved,{sellerId:'MOCK-SELLER',marketplaceId:'MOCK-US',productType:'MOCK-HAT'});
  assert.deepEqual(approved,before,'Mapping must not change the approved product');
  if(channel==='amazon')assert.equal(payload.body.attributes.purchasable_offer[0].our_price[0].schedule[0].value_with_tax,23);
  else assert.equal(payload.price_minor,2300);
  const receipt=adapter.receipt(adapter.submit('mock-key',payload),'mock-key');
  assert.ok(contracts.contractSchemas['PublicationReceipt@1'].properties.status.enum.includes(receipt.status));
  assert.equal(adapter.evidence(adapter.query('mock-key'),receipt),null,'Accepted is not buyable');
  adapter.confirm('mock-key');
  const evidence=adapter.evidence(adapter.query('mock-key'),receipt);
  assert.equal(evidence.sellable,true);assert.equal(evidence.channel,channel);
  adapter.submit('mock-key',payload);assert.equal(adapter.writes,1);
  assert.throws(()=>adapter.submit('mock-key',{...payload,changed:true}),/Idempotency/);
  assert.throws(()=>adapter.receipt(adapter.submit('rejected',payload,{reject:true}),'rejected'),/rejected/);
  assert.equal(adapter.writes,1);
  assert.throws(()=>adapter.submit('unknown',payload,{timeoutAfterWrite:true}),/Unknown result/);
  assert.ok(adapter.lookup('unknown'));assert.equal(adapter.writes,2);
  adapter.submit('unknown',payload);assert.equal(adapter.writes,2,'Recovery must not create another product');
  if(channel==='amazon')assert.throws(()=>adapter.map(approved,{}),/Missing Amazon/);
});
test("new workflows use self-built test store without inheriting Shopify adapters",()=>{
  const doc=fixtureWorkflow("launch");
  assert.equal(doc.environment.channel,"test-store");
  assert.equal(doc.nodes.find(n=>n.definitionId==="listing.publish").binding.skillId,"");
  assert.ok(!doc.nodes.some(n=>n.binding.skillId.includes("shopify")));
  assert.equal(client.parseWorkflowDocument(JSON.stringify(doc)).environment.channel,"test-store");
  const old=fixtureWorkflow("launch","shopify");
  assert.equal(client.parseWorkflowDocument(JSON.stringify(old)).environment.channel,"shopify");
  const switched=model.rebindChannel(old,"test-store","supplier");
  assert.equal(switched.nodes.find(n=>n.definitionId==="listing.publish").binding.skillId,"");
});

test("rounded routes retain card ports and share length-based transmission timing", () => {
  const flow = model.toWorkflowPreview(fixtureWorkflow("launch", "shopify"));
  for (const edge of graph.edgesFor(flow)) {
    const route = graph.edgeGeometry(flow, edge);
    assert.ok(route.length > 0 && Number.isFinite(route.length));
    assert.ok(!route.d.includes("NaN"));
    assert.ok(route.start.every(Number.isFinite) && route.end.every(Number.isFinite));
    assert.ok(graph.transmissionDuration(flow, edge) >= 1050 && graph.transmissionDuration(flow, edge) <= 2400);
    if (edge.kind === "feedback" || edge.kind === "collaboration" && route.start[1] !== route.end[1]) assert.ok(route.d.includes("Q"));
  }
  const edges = graph.edgesFor(flow);
  const short = edges.find(edge => edge.kind === "forward");
  const long = edges.find(edge => edge.kind === "feedback");
  assert.ok(graph.transmissionDuration(flow, long) > graph.transmissionDuration(flow, short));
});

test("store connection inherits across actions but not across providers or channels", () => {
  const doc = fixtureWorkflow("launch", "shopify");
  doc.environment.storeRef = "store/demo";
  doc.environment.storeIntegration = { channel: doc.environment.channel, name: "Demo", version: "0.1.0", actions: [...model.storeActionIds], status: "draft" };
  for (const id of ["listing.validate", "listing.publish", "listing.wait"]) {
    const node = doc.nodes.find(node => node.definitionId === id);
    assert.equal(node.binding.connectionRef, undefined);
    assert.deepEqual(model.resolveNodeConnection(node, doc.environment), { source: "store", reference: "store/demo" });
  }
  assert.equal(model.validateWorkflowPreview(doc).valid, true);
  assert.deepEqual(client.parseWorkflowDocument(JSON.stringify(doc)).environment.storeIntegration, doc.environment.storeIntegration);
  doc.environment.storeIntegration.actions = ["listing.validate"];
  assert.equal(model.validateWorkflowPreview(doc).valid, false);
  const publish = doc.nodes.find(node => node.definitionId === "listing.publish");
  publish.binding.connectionRef = "store/override";
  assert.deepEqual(model.resolveNodeConnection(publish, doc.environment), { source: "override", reference: "store/override" });
  assert.equal(model.resolveNodeConnection({ ...publish, definitionId: "campaign.submit", binding: { ...publish.binding, connectionRef: undefined } }, doc.environment).reference, undefined);
  const changed = model.rebindChannel(doc, "amazon", "supplier");
  assert.equal(changed.environment.storeRef, undefined);
  assert.equal(changed.environment.storeIntegration, undefined);
  assert.equal(changed.nodes.find(node => node.definitionId === "listing.publish").binding.connectionRef, undefined);
});

test("store declarations cannot impersonate verification or other services", () => {
  const doc = fixtureWorkflow("launch", "shopify");
  for (const update of [{ status: "verified" }, { channel: "other" }, { actions: ["campaign.submit"] }, { actions: ["listing.publish", "listing.publish"] }]) {
    doc.environment.storeIntegration = { channel: doc.environment.channel, name: "Demo", version: "1", actions: ["listing.publish"], status: "draft", ...update };
    assert.throws(() => client.parseWorkflowDocument(JSON.stringify(doc)));
  }
});
const channels = load(path.join(root, "lib/workflow/channels.ts"));
const operator = load(path.join(root, "lib/workflow/operator-policy.ts"));
const environments = [["shopify", "supplier"], ["shopify", "merchant"], ["amazon", "merchant"], ["amazon", "platform"]];
test("CJ task rejects legacy category names and invalid fallback without changing saved scope", () => {
  const document=fixtureWorkflow("launch", "shopify");
  const p=document.nodes[0].binding.parameters;
  assert.equal(p.categoryId, "");
  assert.equal(p.emptyResultPolicy,"pause");
  p.category="home";
  assert.ok(model.validateWorkflowPreview(document).errors.some(e=>e.code==="LEGACY_CATEGORY"));
  assert.equal(p.category,"home");
  p.category="";
  p.emptyResultPolicy="drop_keyword_once";
  assert.ok(model.validateWorkflowPreview(document).errors.some(e=>e.code==="SEARCH_QUERY"));
  p.keyword="travel bag";
  assert.equal(model.validateWorkflowPreview(document).errors.some(e=>e.code==="SEARCH_QUERY"),false);
});
test("CJ multi-category parameters preserve scope through save and downstream inheritance", () => {
  const doc=fixtureWorkflow("launch", "shopify"),p=doc.nodes[0].binding.parameters;
  p.categoryId="legacy-id";p.keyword="legacy keyword";
  assert.deepEqual(model.categoryQueriesFor(p),[{categoryId:"legacy-id",keyword:"legacy keyword"}]);
  Object.assign(p,{categoryId:"",keyword:"",categoryQueries:[{categoryId:"hats",keyword:"summer"},{categoryId:"clothes",keyword:"cotton"}]});
  assert.equal(model.validCategoryQueries(p),true);
  const restored=client.parseWorkflowDocument(JSON.stringify(doc));
  const collect=restored.nodes.find(n=>n.definitionId==="product.collect");
  assert.deepEqual(model.productCollectionTaskParameters(restored,collect.id).categoryQueries,p.categoryQueries);
  assert.equal(model.validateWorkflowPreview(restored).errors.length,0);
  for(const groups of [[{categoryId:"",keyword:""}],[{categoryId:"same",keyword:""},{categoryId:"same",keyword:""}],[null],Array(11).fill({categoryId:"many",keyword:""})]){
    p.categoryQueries=groups;assert.equal(model.validCategoryQueries(p),false);
  }
  p.categoryQueries=[{categoryId:"hats",keyword:""},{categoryId:"clothes",keyword:""}];p.limit=1;
  assert.equal(model.validCategoryQueries(p),false);
});
test("review toggle defaults on, persists only on review nodes and maps to preview",()=>{
  const doc=fixtureWorkflow("launch", "shopify");
  const node=doc.nodes.find(n=>n.definitionId==="listing.authorize");
  assert.equal(node.binding.parameters.approvalEnabled,true);
  const proposed=structuredClone(node);proposed.binding.parameters.approvalEnabled=false;
  const changed=operator.applyOperatorNodeSettings(node,proposed);
  doc.nodes=doc.nodes.map(n=>n.id===node.id?changed:n);
  assert.equal(model.toWorkflowPreview(doc).nodes.find(n=>n.id===node.id).approvalEnabled,false);
  assert.equal(model.validateWorkflowPreview(doc).valid,true);
  assert.equal(client.parseWorkflowDocument(JSON.stringify(doc)).nodes.find(n=>n.id===node.id).binding.parameters.approvalEnabled,false);
  const fixed=doc.nodes.find(n=>n.definitionId==="product.collect");
  const forged=structuredClone(fixed);forged.binding.parameters.approvalEnabled=false;
  assert.equal(operator.applyOperatorNodeSettings(fixed,forged).binding.parameters.approvalEnabled,undefined);
});
test("CJ collection is fixed and shares one system implementation across sales channels", () => {
  for (const [channel, mode] of environments) {
    const document = fixtureWorkflow("launch", channel, mode);
    const collect = document.nodes.find(node => node.definitionId === "product.collect");
    assert.equal(collect.binding.skillId, "product.collect.core");
    assert.deepEqual(collect.binding.parameters, {});
    assert.equal(operator.getNodeOperatorPolicy("product.collect").mode, "fixed");
    assert.equal(operator.canOperatorEditStructure("product.collect"), false);
    assert.equal(model.isChannelAdapter("product.collect"), false);
  }
  assert.equal(model.skillManifests.filter(skill => skill.input === "ProductQuery@2").length, 1);
});
test("CJ task preview always derives current upstream fields without copying them into collection settings", () => {
  const document = fixtureWorkflow("launch", "shopify");
  const collect = document.nodes.find(node => node.definitionId === "product.collect");
  Object.assign(document.nodes[0].binding.parameters, {market:"DE",categoryId:"cj-category-id",keyword:"pet travel",emptyResultPolicy:"pause",limit:35,requestedCurrency:"EUR"});
  assert.deepEqual(model.productCollectionTaskParameters(document, collect.id), {candidateSource:"catalog",market:"DE",categoryId:"cj-category-id",keyword:"pet travel",emptyResultPolicy:"pause",limit:35,requestedCurrency:"EUR"});
  document.nodes[0].binding.parameters.limit = 12;
  assert.equal(model.productCollectionTaskParameters(document, collect.id).limit, 12);
  assert.deepEqual(collect.binding.parameters, {});
  collect.binding.parameters.market = "US";
  assert.ok(model.validateWorkflowPreview(document).errors.some(issue => issue.code === "UNKNOWN_PARAMETER"));
  document.nodes.shift();
  assert.equal(model.productCollectionTaskParameters(document, collect.id), null);
  assert.ok(model.validateWorkflowPreview(document).errors.some(issue => issue.code === "COLLECTION_TASK"));
});
test("every registered step has an explicit operator edit policy and a business outcome", () => {
  for (const definition of model.nodeDefinitions) {
    assert.ok(operator.nodeOperatorPolicies[definition.id], definition.id);
    assert.ok(operator.getNodeOperatorPolicy(definition.id).result);
    assert.ok(model.toWorkflowPreview(fixtureWorkflow("launch", "shopify")).nodes.every(node => node.operatorPolicy));
  }
  assert.equal(operator.getNodeOperatorPolicy("unknown.step").mode, "fixed");
  assert.equal(operator.canOperatorEditStructure("unknown.step"), false);
});
test("system calculations and approvals cannot be replaced by an equally shaped custom Skill", () => {
  for (const definitionId of ["product.collect", "product.verify", "product.cost", "product.authorize", "listing.authorize"]) {
    const document = fixtureWorkflow("launch", "shopify");
    const node = document.nodes.find(n => n.definitionId === definitionId);
    const replacement = { ...structuredClone(model.getSkill(node.binding.skillId)), id: `custom.${definitionId}` };
    document.customSkills.push(replacement); node.binding.skillId = replacement.id;
    assert.ok(model.validateWorkflowPreview(document).errors.some(issue => issue.code === "FIXED_IMPLEMENTATION"));
  }
});
test("launch uses evidence, delivery, price proposal, calculation and two separate approvals in order",()=>{
  const document=fixtureWorkflow("launch", "shopify");
  const ids=document.nodes.map(n=>n.definitionId);
  assert.deepEqual(ids.slice(0,6),["product.start","product.collect","product.verify","product.decide","product.cost","product.authorize"]);
  assert.ok(ids.indexOf("listing.authorize")>ids.indexOf("listing.validate"));
  assert.ok(ids.indexOf("listing.authorize")<ids.indexOf("listing.publish"));
  assert.equal(operator.getNodeOperatorPolicy("product.normalize").mode,"fixed");
  assert.deepEqual(model.getSkill("product.normalize.core").parameterSchema,{});
  for(const id of ["product.verify","product.cost","listing.authorize"]){
    const altered=structuredClone(document);
    altered.nodes=altered.nodes.filter(n=>n.definitionId!==id);reconnect(altered);
    assert.equal(check(altered).valid,false,`must reject skipping ${id}`);
    assert.ok(codes(altered).includes("PRECONDITION")||codes(altered).includes("CONTRACT"));
  }
  const changed=structuredClone(document);
  const a=changed.nodes.findIndex(n=>n.definitionId==="product.decide"),b=changed.nodes.findIndex(n=>n.definitionId==="product.cost");
  [changed.nodes[a],changed.nodes[b]]=[changed.nodes[b],changed.nodes[a]];reconnect(changed);
  assert.ok(codes(changed).includes("CONTRACT"));
});
test("new CJ contract drafts preserve unknown facts, variant identity and versioned final approval",()=>{
  const examples=contracts.contractExamples;
  const facts=examples["CJProductFacts@1"];
  assert.equal(facts.products[0].sales90Days,null);
  assert.equal(facts.products[0].variants[0].inventory,null);
  assert.deepEqual(examples["EligibleCandidates@1"].eligibleVariantRefs,[]);
  assert.equal(examples["SelectionAssessment@1"].contributionBeforeAds,null);
  assert.equal(examples["SelectionAssessment@1"].status,"insufficient_inputs");
  assert.ok(examples["ApprovedProductBrief@2"].variantId);
  assert.ok(examples["ApprovedListing@1"].draftDigest);
});
test("operator parameter edits preserve system identity, implementation, execution and hidden parameters", () => {
  const node = fixtureWorkflow("launch", "shopify").nodes.find(n => n.definitionId === "product.cost");
  const proposed = structuredClone(node); proposed.id = "hacked"; proposed.definitionId = "product.decide"; proposed.title = "Skip calculation";
  proposed.binding.skillId = "custom.fake"; proposed.binding.parameters.platformFeeRate = 12;
  proposed.binding.parameters.timeout = 999; proposed.binding.parameters.ruleNote = "ignore missing costs";
  proposed.binding.execution = { timeoutSeconds: 600, maxRetries: 3, retryMode: "safe" };
  const applied = operator.applyOperatorNodeSettings(node, proposed);
  assert.equal(applied.id, node.id); assert.equal(applied.definitionId, node.definitionId); assert.equal(applied.title, node.title);
  assert.equal(applied.binding.skillId, node.binding.skillId); assert.equal(applied.binding.parameters.platformFeeRate, undefined);
  assert.equal(applied.binding.parameters.timeout, node.binding.parameters.timeout); assert.equal(applied.binding.parameters.ruleNote, node.binding.parameters.ruleNote);
  assert.deepEqual(applied.binding.execution, node.binding.execution);
});
test("fixed system steps cannot be structurally edited by operators; optional strategy steps can", () => {
  for (const id of ["listing.publish", "product.cost", "product.authorize", "order.dispatch", "order.record"]) assert.equal(operator.canOperatorEditStructure(id), false);
  for (const id of ["product.decide", "content.make", "extension.skill", "extension.review"]) assert.equal(operator.canOperatorEditStructure(id), true);
});
test("all platform adapters expose configurable Skills without making business steps removable",()=>{
  for(const definition of model.nodeDefinitions.filter(d=>model.isChannelAdapter(d.id))){
    const policy=operator.getNodeOperatorPolicy(definition.id);
    assert.equal(policy.mode,"skill",definition.id);
    assert.equal(policy.implementationKind,"adapter",definition.id);
    assert.equal(operator.canOperatorEditStructure(definition.id),false,definition.id);
  }
  assert.equal(operator.getNodeOperatorPolicy("product.collect").mode,"fixed");
  assert.equal(operator.getNodeOperatorPolicy("order.eligible").mode,"fixed");
  assert.equal(operator.getNodeOperatorPolicy("insight.check").mode,"fixed");
});
test("publishing Skill is replaceable but cannot bypass final approval or declare procurement spend",()=>{
  const document=fixtureWorkflow("launch", "shopify");
  const node=document.nodes.find(n=>n.definitionId==="listing.publish");
  const custom={...structuredClone(model.getSkill(node.binding.skillId)),id:"custom.my-publisher",name:"我的店铺上架连接器"};
  document.customSkills.push(custom);node.binding={...node.binding,skillId:custom.id,mode:"custom"};
  assert.equal(check(document).valid,true);
  custom.effects.push("spend");assert.ok(codes(document).includes("EFFECT"));custom.effects.pop();
  document.nodes=document.nodes.filter(n=>n.definitionId!=="listing.authorize");reconnect(document);
  assert.ok(codes(document).includes("PRECONDITION"));
});
test("adapter operator settings preserve the role while accepting a compatible implementation and connection",()=>{
  const current=fixtureWorkflow("launch", "shopify").nodes.find(n=>n.definitionId==="listing.publish");
  const proposed=structuredClone(current);proposed.id="other";proposed.definitionId="flow.end";
  proposed.binding.skillId="custom.publisher";proposed.binding.connectionRef="store.my-test";
  const applied=operator.applyOperatorNodeSettings(current,proposed);
  assert.equal(applied.id,current.id);assert.equal(applied.definitionId,current.definitionId);
  assert.equal(applied.binding.skillId,"custom.publisher");assert.equal(applied.binding.connectionRef,"store.my-test");
});
const check = document => model.validateWorkflowPreview(document);
const codes = document => check(document).errors.map(issue => issue.code);
const reconnect = document => { document.edges = model.forwardEdges(document.nodes); return document; };
const customChannel = (id = "etsy", extra = {}) => ({
  id, name: id === "etsy" ? "Etsy 设计渠道" : `${id} 设计渠道`, kind: "marketplace",
  fulfillments: ["merchant"], defaultFulfillment: "merchant",
  capabilities: channels.allowedChannelCapabilities(id), adapterStatus: "draft", ...extra,
});
// Design manifests only. No referenced adapter is imported or executed by this test.
function bindMissingAdapters(document) {
  for (const node of document.nodes) {
    if (node.binding.skillId) continue;
    const definition = model.getDefinition(node.definitionId);
    const skill = {
      id: `test-adapter-${node.definitionId}`, name: `测试设计 · ${definition.title}`, version: "1.0.0",
      description: "仅测试兼容的设计声明，不是已接通的适配器。", runtime: "connector",
      input: definition.input, output: definition.output, entrypointRef: `example://adapters/${definition.id}`,
      parameterSchema: {}, capabilities: [`${document.environment.channel}.read`],
      effects: document.environment.fulfillment === "platform" && definition.id.startsWith("order.") ? ["read"] : [...definition.allowedEffects],
      channels: [document.environment.channel], fulfillments: [document.environment.fulfillment],
    };
    document.customSkills.push(skill);
    node.binding = { skillId: skill.id, skillVersion: skill.version, mode: "custom", parameters: {} };
  }
  return document;
}

test("separate drafts have stable distinct document identities", () => {
  const first = fixtureWorkflow("launch", "shopify");
  const second = fixtureWorkflow("launch", "shopify");
  assert.notEqual(first.id, second.id);
  assert.equal(model.rebindChannel(first, "amazon", "merchant").id, first.id);
});

for (const template of model.workflowTemplates) {
  for (const [channel, fulfillment] of environments) {
    test(`default ${template.id}: ${channel}/${fulfillment}`, () => {
      const document = fixtureWorkflow(template.id, channel, fulfillment);
      const result = check(document);
      assert.equal(result.valid, true, JSON.stringify(result.errors));
      assert.equal(result.engine, "frontend-preview");
      assert.deepEqual(client.parseWorkflowDocument(JSON.stringify(document)), document);
    });
  }
}

test("removing action-specific approval cannot authorize publication", () => {
  const document = fixtureWorkflow("launch", "shopify");
  document.nodes = document.nodes.filter(node => node.definitionId !== "product.authorize");
  reconnect(document);
  assert.ok(codes(document).includes("PRECONDITION"));
  assert.equal(check(document).valid, false);
});

for (const effect of ["spend", "message"]) {
  test(`analysis Skill cannot declare ${effect}`, () => {
    const document = fixtureWorkflow("launch", "shopify");
    const node = document.nodes.find(item => item.definitionId === "product.decide");
    const skill = structuredClone(model.getSkill(node.binding.skillId));
    skill.id = `test-analysis-${effect}`;
    skill.effects = [effect];
    document.customSkills.push(skill);
    node.binding.skillId = skill.id;
    assert.ok(codes(document).includes("EFFECT"));
  });
}

test("FBA is observation-only, including custom Skill bindings", () => {
  const document = fixtureWorkflow("fulfillment", "amazon", "platform");
  for (const node of document.nodes) {
    assert.ok(model.getSkill(node.binding.skillId).effects.every(effect => effect === "read"));
  }
  const preview = model.toWorkflowPreview(document);
  assert.ok(preview.nodes.some(node => node.title === "观察平台履约"));
  assert.ok(preview.nodes.some(node => node.title === "记录平台通知状态"));
  const node = document.nodes.find(item => item.definitionId === "order.dispatch");
  const skill = structuredClone(model.getSkill(node.binding.skillId));
  skill.id = "test-fba-purchase";
  skill.effects = ["read", "spend"];
  document.customSkills.push(skill);
  node.binding.skillId = skill.id;
  assert.ok(codes(document).includes("PLATFORM_FULFILLMENT"));
});

test("selection-only flow ends with a decision, not a published product", () => {
  const document = fixtureWorkflow("launch", "shopify");
  const index = document.nodes.findIndex(node => node.definitionId === "product.decide");
  document.nodes = document.nodes.slice(0, index + 1);
  const skill = model.getSkill("flow.end.core");
  document.nodes.push({ id: "selection-result", definitionId: "flow.end", title: "交付选品建议", binding: {
    skillId: skill.id, skillVersion: skill.version, mode: "default", parameters: model.defaultParameters(skill),
  } });
  reconnect(document);
  assert.equal(check(document).valid, true);
  assert.equal(model.toWorkflowPreview(document).nodes.at(-1).output, "SelectionProposal@1");
});

test("channel switch preserves edited graph, titles, custom implementation and parameters", () => {
  const document = fixtureWorkflow("launch", "shopify");
  document.nodes[0].id = "my-trigger";
  document.nodes[0].title = "我的选品任务";
  const node = document.nodes.find(item => item.definitionId === "product.decide");
  const skill = model.getSkill("product.decision.script");
  node.binding = { skillId: skill.id, skillVersion: skill.version, mode: "custom", parameters: model.defaultParameters(skill) };
  reconnect(document);
  const switched = model.rebindChannel(document, "amazon", "merchant");
  assert.deepEqual(switched.nodes.map(item => [item.id, item.title]), document.nodes.map(item => [item.id, item.title]));
  assert.deepEqual(switched.edges, document.edges);
  assert.deepEqual(switched.nodes.find(item => item.id === node.id).binding, node.binding);
  assert.equal(switched.revision, document.revision + 1);
  assert.equal(check(switched).valid, true);
});

for (const mode of ["default", "custom"]) {
  test(`channel switch clears ${mode} connection reference and store reference`, () => {
    const document = fixtureWorkflow("launch", "shopify");
    document.environment.storeRef = "old-shopify-store";
    const node = document.nodes.find(item => item.definitionId === "product.decide");
    if (mode === "custom") {
      const skill = model.getSkill("product.decision.script");
      node.binding = { skillId: skill.id, skillVersion: skill.version, mode, parameters: model.defaultParameters(skill) };
    }
    node.binding.connectionRef = "old-shopify-connection";
    const switched = model.rebindChannel(document, "amazon", "merchant");
    assert.equal(switched.environment.storeRef, undefined);
    assert.equal(switched.nodes.find(item => item.id === node.id).binding.connectionRef, undefined);
    assert.deepEqual(switched.nodes.find(item => item.id === node.id).binding.parameters, node.binding.parameters);
  });
}

test("contract drafts and examples are JSON-serializable data, not runtime validators", () => {
  for (const [name, schema] of Object.entries(contracts.contractSchemas)) {
    assert.deepEqual(JSON.parse(JSON.stringify(schema)), schema, name);
    assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema", name);
  }
  assert.ok(Object.keys(contracts.contractExamples).length > 0);
  for (const [name, example] of Object.entries(contracts.contractExamples)) {
    assert.deepEqual(JSON.parse(JSON.stringify(example)), example, name);
    assert.ok(contracts.contractSchemas[name], `Missing schema for ${name}`);
  }
});

test("batch candidates survive normalization and cost calculations", () => {
  const examples = contracts.contractExamples;
  assert.equal(examples["ProductRecords@1"].records.length, 2);
  assert.equal(examples["ProductFacts@1"].products.length, 2);
  assert.equal(examples["SelectionContext@1"].items.length, 2);
  assert.deepEqual(examples["SelectionContext@1"].items.map(item => item.product.productId), examples["ProductFacts@1"].products.map(item => item.productId));
  assert.equal(examples["SelectionContext@1"].items[0].calculation.status, "insufficient_inputs");
});

test("malformed imports are rejected before preview", () => {
  for (const raw of ["{", "null", "[]", "{}", JSON.stringify({ schemaVersion: "1" })]) {
    assert.throws(() => client.parseWorkflowDocument(raw));
  }
  const corruptions = [
    document => { document.nodes[0].binding.parameters = []; },
    document => { document.nodes[0].definitionId = "unknown-role"; },
    document => { document.nodes[0].binding.connectionRef = 42; },
    document => { document.edges[0].kind = "execute-shell"; },
    document => { document.environment.capabilities = "all"; },
    document => { document.customSkills = [{ id: "incomplete" }]; },
  ];
  for (const corrupt of corruptions) {
    const document = fixtureWorkflow("launch", "shopify");
    corrupt(document);
    assert.throws(() => client.parseWorkflowDocument(JSON.stringify(document)));
  }
});

test("old v2 documents without a custom-channel registry remain importable", () => {
  const document = fixtureWorkflow("launch", "shopify");
  delete document.customChannels;
  assert.deepEqual(client.parseWorkflowDocument(JSON.stringify(document)), document);
  assert.equal(check(document).valid, true);
});

test("custom channel metadata is serializable and not converted into a built-in channel", () => {
  const channel = customChannel("woocommerce", { kind: "storefront", fulfillments: ["supplier", "merchant"], defaultFulfillment: "supplier" });
  const document = fixtureWorkflow("launch", channel.id, undefined, [channel]);
  assert.equal(document.environment.channel, channel.id);
  assert.equal(document.environment.fulfillment, "supplier");
  assert.deepEqual(document.environment.capabilities, channel.capabilities);
  assert.deepEqual(client.parseWorkflowDocument(JSON.stringify(document)), document);
  assert.equal(check(document).warnings.some(issue => issue.code === "CHANNEL_DRAFT"), true);
});

test("channel registrations reject reserved and duplicate IDs and names", () => {
  const entry = customChannel();
  assert.deepEqual(channels.validateSalesChannel(entry), []);
  assert.ok(channels.validateSalesChannel(customChannel("amazon")).length);
  assert.ok(channels.validateSalesChannel(customChannel("another", { name: "AMAZON" })).length);
  assert.ok(channels.validateSalesChannel(entry, [entry]).length);
  assert.ok(channels.validateSalesChannel(customChannel("other", { name: "ETSY 设计渠道" }), [entry]).length);
  assert.ok(channels.validateCustomChannels([entry, entry]).length);
  const document = fixtureWorkflow("launch", "shopify");
  document.customChannels = [entry, entry];
  assert.ok(codes(document).includes("CHANNEL_REGISTRY"));
  assert.throws(() => client.parseWorkflowDocument(JSON.stringify(document)));
});

test("invalid channel IDs, capabilities, statuses and responsibility declarations are rejected", () => {
  for (const extra of [
    { id: "Bad Channel" }, { id: "a" }, { id: "*" }, { id: "foreign_channel" },
    { name: { text: "malformed" } }, { kind: "backend" }, { adapterStatus: "example" },
    { capabilities: ["shopify.read"] }, { capabilities: ["etsy.admin"] }, { capabilities: ["etsy.read", "etsy.read"] },
    { fulfillments: [] }, { fulfillments: ["warehouse"] }, { fulfillments: ["merchant", "merchant"] },
    { defaultFulfillment: "platform" },
  ]) assert.ok(channels.validateSalesChannel(customChannel("etsy", extra)).length, JSON.stringify(extra));
});

test("an unregistered active channel fails import and preview", () => {
  const document = fixtureWorkflow("launch", "shopify");
  document.environment.channel = "unregistered-shop";
  assert.ok(codes(document).includes("ENVIRONMENT"));
  assert.throws(() => client.parseWorkflowDocument(JSON.stringify(document)));
});

test("unsupported fulfillment and invented environment capability fail preview", () => {
  const entry = customChannel();
  const document = fixtureWorkflow("launch", entry.id, "platform", [entry]);
  assert.ok(codes(document).includes("ENVIRONMENT"));
  document.environment.fulfillment = "merchant";
  document.environment.capabilities.push("shopify.spend");
  assert.ok(codes(document).includes("ENVIRONMENT_CAPABILITY"));
});

test("unknown channels never inherit a platform adapter, even when their ID resembles a Skill suffix", () => {
  for (const id of ["etsy", "erp", "custom-script"]) {
    assert.equal(model.defaultSkillFor("listing.publish", id, "merchant"), undefined);
    assert.equal(model.defaultSkillFor("product.collect", id, "merchant").id, "product.collect.core");
    assert.equal(model.defaultSkillFor("product.normalize", id, "merchant").id, "product.normalize.core");
  }
});

test("a custom-channel draft stays editable and importable while missing adapters block preview", () => {
  const entry = customChannel();
  const document = fixtureWorkflow("launch", entry.id, "merchant", [entry]);
  const adapters = document.nodes.filter(node => !node.binding.skillId);
  assert.ok(adapters.some(node => node.definitionId === "listing.publish"));
  assert.equal(check(document).valid, false);
  assert.ok(codes(document).includes("SKILL"));
  assert.deepEqual(client.parseWorkflowDocument(JSON.stringify(document)), document);
});

test("compatible custom adapters can complete the same generic business graph", () => {
  const entry = customChannel();
  const document = bindMissingAdapters(fixtureWorkflow("launch", entry.id, "merchant", [entry]));
  assert.equal(check(document).valid, true, JSON.stringify(check(document).errors));
  assert.deepEqual(document.nodes.map(node => node.definitionId), fixtureWorkflow("launch", "shopify").nodes.map(node => node.definitionId));
  assert.deepEqual(client.parseWorkflowDocument(JSON.stringify(document)), document);
  assert.match(model.toWorkflowPreview(document).subtitle, /Etsy/);
});

test("wildcard generic implementations support registered custom channels", () => {
  const entry = customChannel();
  const document = bindMissingAdapters(fixtureWorkflow("launch", entry.id, "merchant", [entry]));
  for (const id of ["product.normalize.core", "product.decision.script", "product.collect.core", "content.media-pack"]) {
    const skill = model.getSkill(id);
    assert.deepEqual(skill.channels, ["*"]);
    assert.equal(model.skillSupportsChannel(skill, entry.id), true);
  }
  const node = document.nodes.find(item => item.definitionId === "product.decide");
  const skill = model.getSkill("product.decision.script");
  node.binding = { skillId: skill.id, skillVersion: skill.version, mode: "custom", parameters: model.defaultParameters(skill) };
  assert.equal(check(document).valid, true, JSON.stringify(check(document).errors));
});

test("platform-specific implementations do not become compatible after adding a new channel", () => {
  const entry = customChannel();
  const document = bindMissingAdapters(fixtureWorkflow("launch", entry.id, "merchant", [entry]));
  const node = document.nodes.find(item => item.definitionId === "listing.publish");
  const skill = model.getSkill("listing.publish.shopify");
  node.binding = { skillId: skill.id, skillVersion: skill.version, mode: "custom", parameters: model.defaultParameters(skill) };
  assert.equal(model.skillSupportsChannel(skill, entry.id), false);
  assert.ok(codes(document).includes("SKILL_ENVIRONMENT"));
  assert.equal(check(document).valid, false);
});

test("custom manifest channel IDs must be registered, or explicitly use the wildcard", () => {
  const document = fixtureWorkflow("launch", "shopify");
  const node = document.nodes.find(item => item.definitionId === "product.decide");
  const skill = structuredClone(model.getSkill("product.decision.script"));
  skill.id = "test-unknown-channel-decision";
  skill.channels = ["unregistered-shop"];
  document.customSkills.push(skill);
  node.binding = { skillId: skill.id, skillVersion: skill.version, mode: "custom", parameters: model.defaultParameters(skill) };
  assert.ok(codes(document).includes("MANIFEST_CHANNEL"));
  assert.throws(() => client.parseWorkflowDocument(JSON.stringify(document)));
  skill.channels = ["*"];
  assert.equal(check(document).valid, true);
  assert.deepEqual(client.parseWorkflowDocument(JSON.stringify(document)), JSON.parse(JSON.stringify(document)));
});

test("switching to an added channel preserves graph and generic choices while clearing all account references", () => {
  const entry = customChannel();
  const document = fixtureWorkflow("launch", "shopify");
  document.customChannels = [entry];
  document.environment.storeRef = "old-shop";
  document.nodes[0].title = "我的跨境任务";
  for (const node of document.nodes) node.binding.connectionRef = `old-connection-${node.id}`;
  const source = document.nodes.find(node => node.definitionId === "product.decide");
  const skill = model.getSkill("product.decision.script");
  source.binding = { skillId: skill.id, skillVersion: skill.version, mode: "custom", parameters: { ...model.defaultParameters(skill), sourceRef: "catalog://my-erp" }, connectionRef: "old-erp-account" };
  const switched = model.rebindChannel(document, entry.id, "merchant");
  assert.deepEqual(switched.nodes.map(node => [node.id, node.title, node.definitionId]), document.nodes.map(node => [node.id, node.title, node.definitionId]));
  assert.deepEqual(switched.edges, document.edges);
  assert.deepEqual(switched.customChannels, document.customChannels);
  assert.equal(switched.environment.storeRef, undefined);
  assert.ok(switched.nodes.every(node => node.binding.connectionRef === undefined));
  const preserved = switched.nodes.find(node => node.id === source.id);
  assert.equal(preserved.binding.skillId, source.binding.skillId);
  assert.deepEqual(preserved.binding.parameters, source.binding.parameters);
  assert.ok(switched.nodes.some(node => node.definitionId === "listing.publish" && node.binding.skillId === ""));
});

test("platform-owned fulfillment remains read-only for added channels, not only Amazon FBA", () => {
  const entry = customChannel("market-platform", { fulfillments: ["platform"], defaultFulfillment: "platform" });
  const document = bindMissingAdapters(fixtureWorkflow("fulfillment", entry.id, undefined, [entry]));
  assert.equal(check(document).valid, true, JSON.stringify(check(document).errors));
  assert.ok(model.toWorkflowPreview(document).nodes.some(node => node.title === "观察平台履约"));
  const node = document.nodes.find(item => item.definitionId === "order.dispatch");
  const skill = model.getSkill(node.binding.skillId, document);
  skill.effects = ["read", "spend"];
  assert.ok(codes(document).includes("PLATFORM_FULFILLMENT"));
});

test("JSON Schema channel fields are registry IDs rather than a two-platform enum", () => {
  const field = contracts.contractSchemas["ListingDraft@1"].properties.channel;
  assert.equal(field.type, "string");
  assert.equal(field.enum, undefined);
  assert.equal(new RegExp(field.pattern).test("woocommerce"), true);
});

test("browser channel catalog loads, saves and refuses invalid writes without overwriting the prior directory", async () => {
  const previous = globalThis.localStorage;
  const memory = new Map();
  globalThis.localStorage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) };
  try {
    const port = client.salesChannelDesignClient;
    assert.equal(port.source, "browser-preview");
    assert.deepEqual(await port.load(), []);
    const entry = customChannel();
    await port.save([entry]);
    assert.deepEqual(await port.load(), [entry]);
    assert.equal(memory.has("commerceos.workflow-document.v2"), false);
    const saved = memory.get("commerceos.sales-channels.v1");
    await assert.rejects(port.save([entry, entry]));
    assert.equal(memory.get("commerceos.sales-channels.v1"), saved);
    await assert.rejects(port.save([customChannel("etsy", { capabilities: ["shopify.spend"] })]));
    assert.equal(memory.get("commerceos.sales-channels.v1"), saved);
    memory.set("commerceos.sales-channels.v1", JSON.stringify([{ id: "incomplete" }]));
    await assert.rejects(port.load());
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
});

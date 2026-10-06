const assert=require("node:assert/strict");
const {test}=require("node:test");
const fs=require("node:fs");
const path=require("node:path");
const ts=require("typescript");
const source=fs.readFileSync(path.join(__dirname,"../lib/skills/personal.ts"),"utf8");
const moduleValue={exports:{}};
new Function("exports","module",ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(moduleValue.exports,moduleValue);
const {parseSkillDrafts,isSkillDraft,creationBrief,publishingDraft,integrationRules,registeredSkillKind}=moduleValue.exports;
test("both built-in integration rules are visible but never runtime manifests",()=>{
  assert.deepEqual(integrationRules.map(r=>r.title),["生成独立站 API","接口字段映射"]);
  for(const r of integrationRules){assert.ok(fs.existsSync(path.join(__dirname,'../public/integration-skills',r.id,'SKILL.md')));assert.equal('approved' in r,false);assert.equal('entrypointRef' in r,false);}
  assert.ok(publishingDraft("adapter","demo",false).name.includes("制作店铺适配包"));
});
test("registered versions are classified by actual handler or declared contracts, not all as content",()=>{
  assert.equal(registeredSkillKind({handler:"content.editorial.v1"}),"content");
  assert.equal(registeredSkillKind({handler:"product.opportunity.v1"}),"selection");
  assert.equal(registeredSkillKind({handler:"other",manifest:{input:"ApprovedListing@1",output:"PublicationReceipt@1"}}),"adapter");
  assert.equal(registeredSkillKind({handler:"unknown"}),null);
});
test("store package spans downstream actions and preserves selected scope",()=>{
  const full=publishingDraft("adapter","custom",true);
  assert.equal(isSkillDraft(full),true);
  for(const action of ["listing.validate","listing.publish","listing.wait","publication.lookup","listing.unpublish","listing.status","orders.read","customers.read","finance.read"])assert.ok(full.actions.includes(action));
  assert.equal(publishingDraft("development","custom",true,["listing.publish","order.start"]).actions,"listing.publish、order.start");
  assert.equal(publishingDraft("adapter","custom",false,[]).actions,"");
  assert.equal(creationBrief(full).status,"draft-not-executable");
});
const draft={id:"draft-1",name:"测试适配包",kind:"adapter",purpose:"商品管理",actions:"检查、发布、查询",input:"商品资料",output:"发布结果",parameters:"",updatedAt:"2026-10-02T00:00:00Z"};
test("personal drafts roundtrip without becoming executable",()=>{
  assert.deepEqual(parseSkillDrafts(JSON.stringify([draft])),[draft]);
  assert.equal(creationBrief(draft).status,"draft-not-executable");
  assert.equal(creationBrief(draft).format,"commerceos.skill-creation-brief@1");
  assert.equal("approved" in creationBrief(draft),false);
});
test("invalid storage and duplicate identifiers are rejected",()=>{
  for(const value of ["{}", "[null]",JSON.stringify([draft,draft]),JSON.stringify([{...draft,kind:"constructor"}]),JSON.stringify([{...draft,updatedAt:"invalid"}])])assert.throws(()=>parseSkillDrafts(value));
});
test("all three responsibilities and field boundaries",()=>{
  for(const kind of ["development","adapter","content"])assert.equal(isSkillDraft({...draft,kind}),true);
  assert.equal(isSkillDraft({...draft,name:" "}),false);
  assert.equal(isSkillDraft({...draft,purpose:"a".repeat(4001)}),false);
  assert.equal(isSkillDraft({...draft,name:"a".repeat(81)}),false);
});

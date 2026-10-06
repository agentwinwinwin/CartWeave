const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs');
const ts=require('typescript');
const moduleValue={exports:{}};
new Function('exports',ts.transpileModule(fs.readFileSync('lib/business.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(moduleValue.exports);
const {resolveSyncStore}=moduleValue.exports;
const store={id:'one',name:'Store',readable:true,synced_at:null,has_more:false};
test('one store is the implicit sync target; multiple stores require explicit choice',()=>{
 assert.equal(resolveSyncStore([store],''),store);
 assert.equal(resolveSyncStore([store,{...store,id:'two'}],''),undefined);
 assert.equal(resolveSyncStore([store,{...store,id:'two'}],'one'),store);
});
test('missing or stale references never silently switch the sync target',()=>{
 assert.equal(resolveSyncStore([],''),undefined);
 assert.equal(resolveSyncStore([store],'removed'),undefined);
 assert.equal(resolveSyncStore([{...store,readable:false}], '').readable,false);
});
test('compact sync control performs no verification or automatic remote sync',()=>{
 const code=fs.readFileSync('components/commerce/business/business-sync-bar.tsx','utf8');
 assert.ok(!code.includes('<Card'));
 assert.ok(!code.includes('/verify'));
 assert.ok(!code.includes('useEffect'));
 assert.ok(code.includes('stores.length>1'));
 assert.ok(code.includes('最近同步'));
 assert.ok(code.includes('<div className={styles.controls}>{refreshAction}'));
 for(const file of ['components/commerce/business/business-records-page.tsx','components/commerce/earnings/earnings-page.tsx']){
  const page=fs.readFileSync(file,'utf8');
  assert.ok(page.includes('actions={<BusinessSyncBar refreshAction='));
 }
});

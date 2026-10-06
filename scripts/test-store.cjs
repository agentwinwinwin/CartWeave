const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const {test}=require('node:test');
const mod={exports:{}};
new Function('exports','module',ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname,'../lib/test-store.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(mod.exports,mod);
const {testProducts,createTestOrder,advanceTestOrder}=mod.exports;
test('checkout rejects empty carts, drafts, unknown products and invalid quantities',()=>{
  for(const cart of [{},{'demo-cup':1},{unknown:1},{'demo-lamp':13},{'demo-lamp':0},{'demo-lamp':1.5}])assert.throws(()=>createTestOrder(testProducts,cart));
});
test('test order uses integer cents and cannot skip or replay effects',()=>{
  let order=createTestOrder(testProducts,{'demo-lamp':2});
  assert.equal(order.totalCents,9800);
  assert.throws(()=>advanceTestOrder(order,'dispatch'));
  for(const action of ['pay','authorize','dispatch','ship','notify','deliver']){
    order=advanceTestOrder(order,action);
    assert.throws(()=>advanceTestOrder(order,action));
  }
  assert.equal(order.status,'delivered');
  assert.equal(order.events.length,7);
  assert.ok(order.events.every(e=>e.type.startsWith('test.')));
});
test('only unpaid orders can be cancelled',()=>{
  const order=createTestOrder(testProducts,{'demo-lamp':1});
  assert.equal(advanceTestOrder(order,'cancel').status,'cancelled');
  assert.throws(()=>advanceTestOrder(advanceTestOrder(order,'pay'),'cancel'));
});

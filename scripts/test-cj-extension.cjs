const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'../browser-extension/cj-reader');
const code=fs.readFileSync(path.join(root,'background.js'),'utf8');
const pages={sales:'https://www.cjdropshipping.com/intelligence/sales-trends',advertising:'https://www.cjdropshipping.com/intelligence/ad-trends'};

function harness({challenge=false,existing=false,jobPages=pages}={}) {
 const state={token:'scoped-test-token'},calls=[],created=[],removed=[];
 const chrome={storage:{local:{get:async()=>({...state}),set:async v=>Object.assign(state,v),setAccessLevel:async()=>{},remove:async key=>delete state[key]}},
  tabs:{query:async({url})=>existing?[{id:url.includes('sales')?1:2,url:url.slice(0,-1)}]:[],create:async({url,active})=>{assert.equal(active,false);const tab={id:created.length+10,url};created.push(tab);return tab},get:async()=>({status:'complete'}),remove:async id=>removed.push(id)},
  scripting:{executeScript:async({args})=>[{result:challenge?{error:'challenge'}:{kind:args[0],table:'fixture'}}]},
  runtime:{id:'own-extension',onInstalled:{addListener(){}},onStartup:{addListener(){}},onMessage:{addListener(){}}},alarms:{create:async()=>{},onAlarm:{addListener(){}}}};
 const sandbox={chrome,AbortSignal,setTimeout,Date,console,fetch:async(url,options)=>{assert.ok(url.startsWith('http://127.0.0.1:8010/api/v1/cj-browser/'));assert.equal(options.credentials,'omit');assert.equal(options.headers.Authorization,'Bearer scoped-test-token');const body=JSON.parse(options.body);calls.push({url,body});return{ok:true,json:async()=>url.endsWith('/poll')?{job:{id:'one-job',pages:jobPages}}:{status:challenge?'failed':'done'}}}};
 vm.createContext(sandbox);vm.runInContext(code,sandbox);
 return{state,calls,created,removed,poll:()=>vm.runInContext('poll()',sandbox)};
}

test('extension permissions exclude cookies/history/debugger and arbitrary sites',()=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json')));
 assert.deepEqual(manifest.permissions,['storage','scripting','alarms']);
 assert.deepEqual(manifest.host_permissions,['https://www.cjdropshipping.com/*','http://127.0.0.1:8010/*']);
 assert.equal(manifest.externally_connectable,undefined);
});
test('both fixed tables are returned, own temporary tabs closed',async()=>{
 const h=harness();await h.poll();assert.equal(h.created.length,2);assert.equal(h.removed.length,2);
 assert.deepEqual(Object.keys(h.calls[1].body.pages),['sales','advertising']);
 assert.equal(h.calls[1].body.id,'one-job');assert.equal(h.state.notice,'两组前十已传回工作台。');
});
test('existing exact dashboards are reused without navigation or closure',async()=>{
 const h=harness({existing:true});await h.poll();assert.equal(h.created.length,0);assert.equal(h.removed.length,0);
});
test('challenge stops immediately without clicking or reading second page',async()=>{
 const h=harness({challenge:true});await h.poll();assert.equal(h.created.length,1);
 assert.equal(h.calls[1].body.error,'sales.challenge');assert.equal(h.calls[1].body.pages,undefined);
});
test('arbitrary page commands are rejected without browser access',async()=>{
 const h=harness({jobPages:{...pages,sales:'https://evil.example/'}});await h.poll();assert.equal(h.created.length,0);assert.equal(h.calls.length,1);
 assert.match(h.state.notice,/固定读取规则/);
});

async function extraction(kind, chinese, {withoutHeading=false,withoutScope=false,duplicateDate=false}={}) {
 const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/cj-intelligence.json')))[kind];
 const headers=kind==='sales'?(chinese?['排名 / 类目','销售额 / 销量','排名增长率','操作']:['Rank / Categories','Sales / Sales Volume','Ranking Change Rate','Action']):
  (chinese?['排名','类目名称','TikTok 广告数','Facebook 广告数','操作']:['Rank','Category Name','TikTok Ad Count','Facebook Ad Count','Action']);
 const rows=fixture.rows.map(([rank,name,id,...metrics])=>{
  const cells=kind==='sales'?[rank+'\n'+name,metrics[0]+' / '+metrics[1],metrics[2],'进入分析']:[String(rank),name,...metrics,'进入分析'];
  return{querySelectorAll:()=>cells.map(innerText=>({innerText})),querySelector:()=>({href:pages[kind]+'/'+id})};
 });
 const table={innerText:headers.join('\n'),querySelectorAll:selector=>selector==='thead th'?headers.map(innerText=>({innerText})):rows};
 const heading=kind==='sales'?(chinese?'销售仪表板':'Sales Dashboard'):(chinese?'广告仪表板':'Advertising Trends Dashboard');
 const context=chinese?'数据来源：Amazon 平台商品销售数据\n数据更新: Sep. 08, 2026\n站点\nAll Sites\n平台\nAll\n地区\nAll':'Amazon platform product sales data\nData Updated: Sep. 08, 2026\nSite\nAll Sites\nPlatform\nAll\nRegion\nAll';
 // Separate read-only DOM sandbox tests the injected extraction itself, not
 // just the mocked Chrome bridge. No live account or webpage is accessed.
 const metadata = withoutScope ? context.replace(/(?:Platform|平台)\nAll\n(?:Region|地区)\nAll/,'') : context;
 const sandbox={document:{body:{innerText:'Private sidebar must not be returned\n'+(withoutHeading?'Other dashboard title':heading)+'\n'+metadata+(duplicateDate?'\nData Updated: Oct. 01, 2026':'')+'\n'+table.innerText},querySelectorAll:()=>[table]},location:{pathname:new URL(pages[kind]).pathname,href:pages[kind]},Date,setTimeout};
 vm.createContext(sandbox);vm.runInContext(code.split('chrome.runtime.onInstalled')[0],sandbox);
 return vm.runInContext(`extract('${kind}')`,sandbox);
}

for(const kind of ['sales','advertising'])for(const chinese of [false,true])test(`extract actual table shape: ${kind}, ${chinese?'Chinese':'English'}`,async()=>{
 const raw=await extraction(kind,chinese);
 assert.equal(raw.error,undefined);assert.equal(raw.rows.length,10);assert.equal(raw.url,pages[kind]);
 assert.ok(raw.context.includes(chinese?'数据更新':'Data Updated'));
 assert.ok(!raw.context.includes('Private sidebar'));
});

for(const chinese of [false,true])test(`advertising metadata does not depend on decorative title: ${chinese}`,async()=>{
 const raw=await extraction('advertising',chinese,{withoutHeading:true});
 assert.equal(raw.error,undefined);assert.equal(raw.rows.length,10);
 assert.ok(raw.context.includes(chinese?'数据更新':'Data Updated'));
 assert.ok(!raw.context.includes('Private sidebar'));
 assert.ok(!raw.context.includes('Other dashboard title'));
});
test('title-independent extraction rejects missing scope or ambiguous dates',async()=>{
 for(const options of [{withoutScope:true},{duplicateDate:true}]) {
  const raw=await extraction('advertising',false,{withoutHeading:true,...options});
  assert.equal(raw.error,'heading');assert.equal(raw.rows,undefined);
 }
});

test('popup displays message-channel errors and preserves pairing code on failure',async()=>{
 const elements=Object.fromEntries(['notice','code','pair','refresh','disconnect'].map(id=>[id,{value:id==='code'?'test-code':'',textContent:'',addEventListener(type,fn){this[type]=fn}}]));
 const buttons=[{disabled:false}];let fail=false;
 const chrome={storage:{local:{get:async()=>({notice:'尚未配对'})},onChanged:{addListener(){}}},runtime:{sendMessage:async()=>{if(fail)throw Error('Could not establish connection');return{ok:true}}}};
 const sandbox={document:{getElementById:id=>elements[id],querySelectorAll:()=>buttons},chrome};
 vm.createContext(sandbox);vm.runInContext(fs.readFileSync(path.join(root,'popup.js'),'utf8'),sandbox);
 await new Promise(resolve=>setImmediate(resolve));fail=true;
 await elements.pair.submit({preventDefault(){}});
 assert.match(elements.notice.textContent,/Could not establish connection/);assert.equal(elements.code.value,'test-code');assert.equal(buttons[0].disabled,false);
});

const API = 'http://127.0.0.1:8010/api/v1/cj-browser';
const PAGES = {sales: 'https://www.cjdropshipping.com/intelligence/sales-trends', advertising: 'https://www.cjdropshipping.com/intelligence/ad-trends'};
let working = false;
const remember = message => chrome.storage.local.set({notice: message});

async function request(action, body, token) {
  let response;
  try {
    response = await fetch(`${API}/${action}`, {method:'POST', credentials:'omit', redirect:'error',
      headers:{'Content-Type':'application/json', ...(token ? {Authorization:`Bearer ${token}`} : {})},
      body:JSON.stringify(body), signal:AbortSignal.timeout(10000)});
  } catch { throw new Error('无法连接本机后端，请确认项目已启动且扩展允许访问 127.0.0.1。'); }
  if (!response.ok) {
    const body = await response.json().catch(()=>null);
    const detail = body?.detail?.detail || body?.detail;
    throw new Error(typeof detail === 'string' ? detail : `本机连接失败 (${response.status})，请检查项目或重新配对。`);
  }
  return response.json();
}

// Executed in an isolated world. Only rendered ranking tables are returned;
// no cookies, localStorage, page scripts, account forms or arbitrary commands.
async function extract(kind) {
  const headerSets = kind === 'sales' ? [
    ['Rank / Categories','Sales / Sales Volume','Ranking Change Rate','Action'],
    ['排名 / 类目','销售额 / 销量','排名增长率','操作'],
    ['排名 / 类目','销售额 / 销量','排名变化率','操作']
  ] : [['Rank','Category Name','TikTok Ad Count','Facebook Ad Count','Action'],
    ['排名','类目名称','TikTok 广告数','Facebook 广告数','操作'],
    ['排名','类别名称','TikTok 广告数','Facebook 广告数','操作']];
  const normal = text => text.replace(/\s+/g,'').replaceAll('／','/');
  const headings = kind === 'sales' ? ['Sales Dashboard','销售仪表板'] : ['Advertising Trends Dashboard','广告趋势仪表板','广告仪表板'];
  const boundaries = kind === 'sales' ? ['Top 10 Market Categories','市场类目排行Top10'] : ['TikTok Category Ad Share','TikTok 类目广告占比'];
  const deadline = Date.now() + 14000;
  while (Date.now() < deadline) {
    if (location.pathname.includes('login')) return {error:'login'};
    const table = [...document.querySelectorAll('table')].find(t => {
      const headers = [...t.querySelectorAll('thead th')].map(e=>normal(e.innerText));
      return headerSets.some(set => set.length===headers.length&&set.every((h,i)=>normal(h)===headers[i]));
    });
    if (table && table.querySelectorAll('tbody tr').length === 10) {
      const text = document.body.innerText;
      const starts = headings.map(h=>text.indexOf(h)).filter(i=>i>=0);
      let context;
      if (starts.length) {
        const start = Math.min(...starts);
        const ends = [...boundaries.map(h=>text.indexOf(h,start)),text.indexOf(table.innerText,start)].filter(i=>i>start);
        if (ends.length) context = text.slice(start,Math.min(...ends));
      }
      if (!context && kind === 'advertising') {
        // Decorative dashboard titles vary. Read only explicit metadata before
        // the recognized table, never return the surrounding sidebar text.
        const tableStart = text.indexOf(table.innerText);
        if (tableStart < 0) return {error:'heading'};
        const before = text.slice(0,tableStart);
        const dates = [...before.matchAll(/(?:Data Updated|数据更新)\s*[:：]\s*[A-Za-z]{3}\.?\s+\d{1,2},\s*\d{4}/g)];
        const scopes = [...before.matchAll(/(?:Platform|平台)\s*[:：]?\s*(?:All|全部)\s+(?:Region|地区)\s*[:：]?\s*(?:All|全部)(?=\s|$)/g)];
        // Ambiguous or absent metadata must not be inferred from the URL.
        if (dates.length !== 1 || scopes.length !== 1) return {error:'heading'};
        context = `${dates[0][0]}\n${scopes[0][0]}`;
      }
      if (!context) return {error:'heading'};
      return {url:location.href, headers:[...table.querySelectorAll('thead th')].map(e => e.innerText),
        rows:[...table.querySelectorAll('tbody tr')].map(r => ({cells:[...r.querySelectorAll('td')].map(e => e.innerText),url:r.querySelector('a')?.href || ''})),
        context};
    }
    if (/We would like to make sure you are not a robot|Verify you are human|Turnstile error|Just a moment/i.test(document.body.innerText)) return {error:'challenge'};
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  return {error:'table'};
}

async function read(kind, created) {
  const url = PAGES[kind];
  const tabs = await chrome.tabs.query({url: `${url}*`});
  // Reuse only the exact unfiltered dashboard. Never navigate a user's tab.
  let tab = tabs.find(t => t.url === url);
  if (!tab) { tab = await chrome.tabs.create({url, active:false}); created.push(tab.id); }
  const deadline = Date.now() + 10000;
  while ((await chrome.tabs.get(tab.id)).status !== 'complete' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 300));
  const result = await chrome.scripting.executeScript({target:{tabId:tab.id},func:extract,args:[kind]});
  return result[0]?.result || {error:'page'};
}

async function poll() {
  if (working) return;
  working = true;
  const created = [];
  try {
    const {token} = await chrome.storage.local.get('token');
    if (!token) return;
    const {job} = await request('poll', {}, token);
    if (!job) return;
    // Server may request ONLY these two pages; no arbitrary remote commands.
    if (!job.pages || Object.keys(job.pages).length !== 2 || Object.keys(PAGES).some(kind => job.pages[kind] !== PAGES[kind])) throw new Error('任务页面不符合固定读取规则。');
    await remember('正在读取两组前十…');
    const pages = {};
    let error;
    for (const kind of Object.keys(PAGES)) {
      let result;
      try { result = await read(kind, created); } catch { result = {error:'page'}; }
      if (result.error) {error = `${kind}.${result.error}`; break;}
      pages[kind] = result;
    }
    const receipt = await request('complete', error ? {id:job.id,error} : {id:job.id,pages}, token);
    await remember(receipt.status === 'done' ? '两组前十已传回工作台。' : '采集停止，请查看工作台原因；登录及安全验证需你自行处理。');
  } catch (e) {
    await remember(e.message || '浏览器读取失败，请检查 CJ 页面。');
  } finally {
    for (const id of created) await chrome.tabs.remove(id).catch(() => {});
    working = false;
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
  await chrome.alarms.create('commerceos-cj', {periodInMinutes:0.5});
});
chrome.runtime.onStartup.addListener(() => { chrome.alarms.create('commerceos-cj', {periodInMinutes:0.5}); void poll(); });
chrome.alarms.onAlarm.addListener(alarm => {if(alarm.name === 'commerceos-cj') void poll();});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  (async () => {
    if (message.type === 'pair') {
      const result = await request('pair', {code:message.code});
      await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
      await chrome.storage.local.set({token:result.token,notice:'已配对。请在普通 Chrome 正常登录 CJ，再到工作台点击采集。'});
      await chrome.alarms.create('commerceos-cj', {periodInMinutes:0.5});
      void poll();
    } else if (message.type === 'poll') { void poll(); }
    else if (message.type === 'disconnect') { await chrome.storage.local.remove('token'); await remember('本扩展已断开；工作台中可撤销连接凭证。'); }
    respond({ok:true});
  })().catch(e => respond({ok:false,message:e.message}));
  return true;
});

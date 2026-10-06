const notice = document.getElementById('notice');
let busy = false;
async function state() {if(busy)return;try{const data = await chrome.storage.local.get(['notice','token']);notice.textContent = data.notice || (data.token ? '已配对' : '尚未配对');}catch{notice.textContent='扩展存储不可用，请重新加载扩展。';}}
async function send(message) {
 if(busy)return false;
 busy=true;notice.textContent=message.type==='pair'?'正在连接本机工作台…':'正在检查连接…';
 const buttons=[...document.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
 try {
  const result=await chrome.runtime.sendMessage(message);
  if(!result?.ok)throw Error(result?.message||'扩展后台没有回应，请在扩展管理页重新加载。');
  busy=false;await state();return true;
 }catch(e){notice.textContent=e.message||'连接失败，请重新加载扩展后重试。';return false;}
 finally{busy=false;buttons.forEach(b=>b.disabled=false);}
}
document.getElementById('pair').addEventListener('submit', async e => {e.preventDefault();if(await send({type:'pair',code:document.getElementById('code').value.trim()}))document.getElementById('code').value='';});
document.getElementById('refresh').addEventListener('click', () => send({type:'poll'}));
document.getElementById('disconnect').addEventListener('click', () => send({type:'disconnect'}));
chrome.storage.onChanged.addListener(() => void state());
void send({type:'poll'}); void state();

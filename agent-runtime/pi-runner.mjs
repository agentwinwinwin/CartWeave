/** Pi owns the agent lifecycle. Django owns network, credentials and business policy.
 * Private line-delimited IPC, never an HTTP service or a browser-accessible port.
 */
import {createInterface} from 'node:readline';
import {Agent} from '@earendil-works/pi-agent-core';
import {AssistantMessageEventStream, getCurrentSystemMessage, getCurrentSystemPrompt} from '@earendil-works/pi-ai';

const send = value => process.stdout.write(JSON.stringify(value)+'\n');
const usageZero = () => ({input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}});
const allowedEvents = new Set(['agent_start','agent_end','turn_start','turn_end','message_start','message_end']);

export async function runTurn(payload, exchange, emit=()=>{}) {
  if (!payload || typeof payload.system!=='string' || !Array.isArray(payload.messages) || !payload.messages.length || payload.messages.length>40)
    throw Error('Invalid harness input');
  if (payload.messages.some(m=>!['user','assistant'].includes(m.role)||typeof m.content!=='string')) throw Error('Invalid message');
  if (payload.messages.at(-1).role!=='user') throw Error('User input required');
  const model = {id:payload.model_id,name:payload.model_id,api:payload.protocol,provider:'commerceos',baseUrl:'',reasoning:false,
    input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:32768,maxTokens:4096};
  const assistant = text => ({role:'assistant',content:[{type:'text',text}],api:model.api,provider:model.provider,
    model:model.id,usage:usageZero(),stopReason:'stop',timestamp:Date.now()});
  let usage={}; let requests=0;
  const agent = new Agent({initialState:{systemPrompt:payload.system,model,tools:[],messages:payload.messages.slice(0,-1).map(m=>
    m.role==='user'?{...m,timestamp:Date.now()}:assistant(m.content))},toolExecution:'sequential',
    streamFn:(_model,context)=>{
      const stream = new AssistantMessageEventStream();
      void (async()=>{
        try {
          if (++requests>1 || getCurrentSystemMessage(context.messages)?.tools?.length) throw Error('Tools are not authorized for this profile');
          const messages=context.messages.filter(m=>m.role!=='system').map(m=>({role:m.role,content:typeof m.content==='string'?m.content:
            m.content.filter(x=>x.type==='text').map(x=>x.text).join('')}));
          const result=await exchange({system:getCurrentSystemPrompt(context.messages),messages});
          if(typeof result.text!=='string'||!result.text.trim()||result.text.length>200000)throw Error('Invalid provider response');
          usage=result.usage??{};
          const message=assistant(result.text);
          stream.push({type:'start',partial:message});
          stream.push({type:'text_start',contentIndex:0,partial:message});
          stream.push({type:'text_delta',contentIndex:0,delta:result.text,partial:message});
          stream.push({type:'text_end',contentIndex:0,content:result.text,partial:message});
          stream.push({type:'done',reason:'stop',message});
          stream.end();
        } catch {
          const error={...assistant(''),stopReason:'error',errorMessage:'Provider request failed'};
          stream.push({type:'error',reason:'error',error});stream.end();
        }
      })();
      return stream;
    }});
  const events=[];
  agent.subscribe(event=>{if(allowedEvents.has(event.type)){const entry={type:event.type};events.push(entry);emit(entry);}});
  await agent.prompt(payload.messages.at(-1).content);
  const result=agent.state.messages.at(-1);
  if(result?.role!=='assistant'||result.stopReason!=='stop')throw Error('Harness turn failed');
  return {text:result.content.filter(c=>c.type==='text').map(c=>c.text).join(''),usage,events,
    runtime:'pi-agent-core',version:'1.0.4'};
}

// Importing runTurn for regression tests must not start the IPC runner.
if (process.argv[1] && new URL(import.meta.url).pathname===process.argv[1]) {
  const lines = createInterface({input:process.stdin, crlfDelay:Infinity});
  const iterator = lines[Symbol.asyncIterator]();
  try {
    const first=await iterator.next();
    const result=await runTurn(JSON.parse(first.value),async request=>{
      send({type:'provider_request',...request});
      const reply=await iterator.next();
      if(reply.done)throw Error('Host disconnected');
      const parsed=JSON.parse(reply.value);
      if(parsed.type!=='provider_result')throw Error('Invalid host result');
      return parsed;
    },event=>send({type:'event',event}));
    send({type:'result',...result});
  } catch {send({type:'error',message:'Pi harness 未完成本轮调用。'});process.exitCode=1;}
  finally {lines.close();process.stdin.destroy();}
}

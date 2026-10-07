"""The ONLY conversational LLM entry. Pi core is isolated from business credentials.

One bounded Pi turn per call. No coding-agent CLI, shell, arbitrary tools or retries.
The existing provider transport is private to this boundary.
"""
import json
import os
from pathlib import Path
import selectors
import shutil
import subprocess
import time
from django.conf import settings
from apps.common.errors import RuleError


def complete(connection, system, messages, *, purpose='mapping'):
    from apps.connections.model_gateway import provider_complete
    if purpose not in {'mapping', 'assistant', 'customer_support', 'customer_support_rag', 'product_image_plan', 'product_image_batch', 'product_image_photography'}:
        raise RuleError('未登记的模型运行用途。')
    if not messages or len(messages)>40 or any(m.get('role') not in ('user','assistant') or not isinstance(m.get('content'),str) for m in messages):
        raise RuleError('模型会话输入不合法。')
    if len(system)+sum(len(m['content']) for m in messages)>180000:
        raise RuleError('模型上下文过长，请减少资料或新建会话。')
    root = Path(settings.BASE_DIR).parent
    node = os.environ.get('COMMERCE_HARNESS_NODE') or shutil.which('node')
    if not node:
        raise RuleError('Pi harness 需要 Node.js 22.19+；请设置 COMMERCE_HARNESS_NODE 并安装 npm 依赖。')
    payload={'system':system,'messages':messages,'model_id':connection.model_id,'protocol':connection.protocol,'purpose':purpose}
    # Never inherit provider keys, NODE_OPTIONS/preload, or proxy environment.
    env={k:v for k,v in os.environ.items() if k in ('PATH','SystemRoot','TMPDIR','LANG')}
    process=None; selector=selectors.DefaultSelector(); received=b''; count=0; deadline=time.monotonic()+70
    try:
        process=subprocess.Popen([node,str(root/'agent-runtime/pi-runner.mjs')],cwd=root,env=env,
            stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
        process.stdin.write((json.dumps(payload,ensure_ascii=False)+'\n').encode())
        process.stdin.flush()
        selector.register(process.stdout,selectors.EVENT_READ)
        while time.monotonic()<deadline:
            if not selector.select(min(1, max(0, deadline-time.monotonic()))): continue
            chunk=os.read(process.stdout.fileno(),65536)
            if not chunk: break
            received+=chunk
            if len(received)>2_000_000: raise RuleError('Pi harness 响应超过限制。')
            while b'\n' in received:
                raw,received=received.split(b'\n',1); event=json.loads(raw)
                if event.get('type')=='provider_request':
                    count+=1
                    if count!=1 or event.get('system')!=system or event.get('messages')!=messages:
                        raise RuleError('Pi harness 请求与本轮已授权上下文不一致。')
                    text,usage=provider_complete(connection,system,messages,purpose=purpose)
                    process.stdin.write((json.dumps({'type':'provider_result','text':text,'usage':usage},ensure_ascii=False)+'\n').encode())
                    process.stdin.flush()
                elif event.get('type')=='result':
                    if count!=1 or not isinstance(event.get('text'),str): raise RuleError('Pi harness 缺少真实模型调用。')
                    return event['text'],{**event.get('usage',{}),'harness':{'runtime':'pi-agent-core','version':'1.0.4',
                        'purpose':purpose,'events':[x['type'] for x in event.get('events',[]) if x.get('type') in
                        {'agent_start','agent_end','turn_start','turn_end','message_start','message_end'}]}}
                elif event.get('type')=='error': break
        raise RuleError('Pi harness 未完成调用或已超时；没有回退旧模型直连，请检查 Node 22.19+ 与依赖。')
    except (OSError, ValueError, BrokenPipeError):
        raise RuleError('Pi harness 启动或通信失败；请检查 Node 22.19+ 与 npm 依赖。本轮没有回退直连。') from None
    finally:
        selector.close()
        if process:
            if process.poll() is None: process.kill()
            process.wait(timeout=5)
            process.stdin.close();process.stdout.close()

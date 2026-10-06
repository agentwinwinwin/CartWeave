"""Private provider transport for apps.agents.harness, not an agent entry point."""
import ipaddress
import json
import socket
import time
from urllib.parse import urlsplit, quote
import httpx
from django.conf import settings
from apps.common.errors import RuleError
from .services import credential


def validate_endpoint(url):
    parsed = urlsplit(url)
    if parsed.username or parsed.password or parsed.query or parsed.fragment or not parsed.hostname:
        raise RuleError('模型地址需为不含密钥、查询参数的 API 基础地址。')
    try:
        addresses = {ipaddress.ip_address(a[4][0]) for a in socket.getaddrinfo(parsed.hostname, parsed.port or 443)}
    except (ValueError, OSError):
        raise RuleError('模型服务地址无法解析。') from None
    local = settings.LOCAL and settings.DESKTOP_MODE and all(a.is_loopback for a in addresses)
    if parsed.scheme != 'https' and not (parsed.scheme == 'http' and local):
        raise RuleError('远程模型需 HTTPS；本机桌面模式可使用 localhost HTTP 模型。')
    if not local and any(not a.is_global for a in addresses):
        raise RuleError('只支持公网 HTTPS 服务或本机桌面模型地址。')
    return url.rstrip('/')


def complete(connection, system, messages):
    """Compatibility entry: existing mapping callers now execute through Pi."""
    from apps.agents.harness import complete as run
    return run(connection, system, messages, purpose='mapping')


def provider_complete(connection, system, messages, *, purpose='mapping'):
    base = validate_endpoint(connection.base_url)
    key = credential(connection) if connection.credential_ciphertext else ''
    headers = {'Content-Type': 'application/json'}
    model = connection.model_id
    protocol = connection.protocol
    if protocol == 'anthropic-messages':
        headers.update({'x-api-key': key, 'anthropic-version': '2023-06-01'})
        path = '/messages'
        payload = {'model':model, 'max_tokens':4096, 'system':system, 'messages':messages}
    elif protocol == 'google-generative-ai':
        headers['x-goog-api-key'] = key
        path = f'/models/{quote(model, safe="")}:generateContent'
        payload = {'systemInstruction':{'parts':[{'text':system}]},
            'contents':[{'role':'model' if m['role']=='assistant' else 'user', 'parts':[{'text':m['content']}]} for m in messages],
            'generationConfig':{'maxOutputTokens':4096, **({'responseMimeType':'application/json'} if purpose!='assistant' else {})}}
    elif protocol == 'openai-responses':
        if key: headers['Authorization'] = f'Bearer {key}'
        path = '/responses'
        payload = {'model':model, 'instructions':system, 'input':messages, 'max_output_tokens':4096}
    else:
        if key: headers['Authorization'] = f'Bearer {key}'
        path = '/chat/completions'
        payload = {'model':model, 'messages':[{'role':'system','content':system}, *messages], 'max_tokens':4096}
    try:
        started = time.monotonic()
        with httpx.Client(timeout=55, follow_redirects=False, trust_env=False) as client:
            with client.stream('POST', base+path, headers=headers, json=payload) as response:
                if response.status_code >= 300:
                    raise RuleError(f'模型服务返回 HTTP {response.status_code}；请检查模型 ID、地址、额度和密钥。')
                parts, size = [], 0
                for part in response.iter_bytes():
                    if time.monotonic() - started > 55:
                        raise RuleError('模型响应读取超时；本轮未保存，不自动重试。')
                    size += len(part)
                    if size > 2_000_000: raise RuleError('模型响应过大，请缩小本轮资料。')
                    parts.append(part)
                result = json.loads(b''.join(parts))
        if protocol == 'anthropic-messages':
            text = ''.join(x.get('text','') for x in result['content'] if x.get('type')=='text')
        elif protocol == 'google-generative-ai':
            text = ''.join(x.get('text','') for x in result['candidates'][0]['content']['parts'])
        elif protocol == 'openai-responses':
            text = ''.join(x.get('text','') for o in result['output'] for x in o.get('content',[]) if x.get('type')=='output_text')
        else:
            text = result['choices'][0]['message']['content']
        if not isinstance(text,str) or not text.strip(): raise RuleError('模型没有返回内容。')
        # A model must never echo the configured credential into persisted output.
        if key: text = text.replace(key, '[REDACTED]')
        raw_usage = result.get('usage', result.get('usageMetadata', {}))
        usage = {k:v for k,v in raw_usage.items() if isinstance(v,int) and not isinstance(v,bool)} if isinstance(raw_usage,dict) else {}
        return text, usage
    except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError):
        raise RuleError('模型调用失败或响应格式异常；本轮未保存，可手动重试。') from None

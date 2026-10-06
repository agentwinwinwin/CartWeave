"""Narrow loopback bridge for an explicitly paired, ordinary Chrome extension.

No browser control protocol, cookies, scripts, credentials or arbitrary URLs.
"""
import hashlib
import hmac
import json
import re
import secrets
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from uuid import uuid4
from cryptography.fernet import Fernet
from django.conf import settings
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from apps.common.errors import Conflict, RuleError
from . import cj_intelligence as source


def fingerprint(value):
    return hashlib.sha256(value.encode()).hexdigest()


def load(team_id, name):
    path = source.folder(team_id) / name
    if not path.exists():
        return None
    try:
        text = path.read_text()
        if name.endswith('.enc'):
            text = Fernet(settings.CREDENTIAL_KEY.encode()).decrypt(text.encode()).decode()
        return json.loads(text)
    except Exception:
        raise RuleError('Chrome 连接记录不可用，请重新配对。') from None


def save(team_id, name, data):
    text = json.dumps(data, ensure_ascii=False)
    source.write_private(source.folder(team_id) / name, source.encrypt(text) if name.endswith('.enc') else text)


@contextmanager
def state_lock(team_id):
    lock = source.LocalBrowserLock(team_id)
    lock.path = source.folder(team_id) / 'bridge.lock'
    if not lock.acquire():
        raise Conflict('Chrome 连接正在更新，请稍后重试。')
    try:
        yield
    finally:
        lock.release()


def pairing_code(team_id):
    with state_lock(team_id):
        code = secrets.token_urlsafe(24)
        save(team_id, 'pair-code.enc', {'digest': fingerprint(code), 'expires_at': time.time() + 300})
    return {'code': code, 'expires_in': 300}


def extension_origin(request):
    source.require_desktop()
    origin = request.headers.get('Origin', '')
    if (request.META.get('REMOTE_ADDR') not in ('127.0.0.1', '::1') or
            request.get_host() not in ('127.0.0.1:8010', 'localhost:8010') or
            not re.fullmatch(r'chrome-extension://[a-p]{32}', origin)):
        raise RuleError('此通道仅允许本机 Chrome 扩展，不接受网页跨域调用。')
    return origin


def workspace_for_digest(name, value):
    # Only valid UUID workspace folders; a single desktop owner is expected.
    from pathlib import Path
    from uuid import UUID
    root = Path(getattr(settings, 'CJ_INTELLIGENCE_DIR', settings.BASE_DIR / '.local' / 'cj-intelligence'))
    for folder in root.iterdir() if root.exists() else []:
        try:
            team_id = str(UUID(folder.name))
        except ValueError:
            continue
        data = load(team_id, name)
        if data and hmac.compare_digest(data.get('digest', ''), fingerprint(value)) and data.get('expires_at', 0) > time.time():
            return team_id
    raise RuleError('配对码或扩展凭证无效、过期或已撤销。')


def pair(request):
    origin = extension_origin(request)
    payload = request.data
    if not isinstance(payload, dict) or set(payload) != {'code'} or not isinstance(payload['code'], str) or not 20 <= len(payload['code']) <= 100:
        raise RuleError('请填写工作台刚生成的一次性配对码。')
    team_id = workspace_for_digest('pair-code.enc', payload['code'])
    with state_lock(team_id):
        code = load(team_id, 'pair-code.enc')
        if not code or code['expires_at'] <= time.time() or not hmac.compare_digest(code['digest'], fingerprint(payload['code'])):
            raise RuleError('配对码已使用或过期。')
        token = secrets.token_urlsafe(32)
        save(team_id, 'extension.enc', {'digest': fingerprint(token), 'origin': origin,
             'expires_at': time.time() + 30 * 86400, 'last_seen': time.time()})
        save(team_id, 'pair-code.enc', {'digest': '', 'expires_at': 0})
    return {'token': token, 'expires_in': 30 * 86400}


def authenticate(request):
    origin = extension_origin(request)
    header = request.headers.get('Authorization', '')
    if not header.startswith('Bearer ') or not 30 <= len(header[7:]) <= 100:
        raise RuleError('请先将扩展与工作台配对。')
    team_id = workspace_for_digest('extension.enc', header[7:])
    data = load(team_id, 'extension.enc')
    if data['origin'] != origin:
        raise RuleError('凭证不属于此扩展。')
    return team_id, data['digest']


def connection_status(team_id):
    data = load(team_id, 'extension.enc')
    paired = bool(data and data.get('expires_at', 0) > time.time())
    online = bool(paired and time.time() - data.get('last_seen', 0) < 75)
    return {'paired': paired, 'online': online}


def revoke(team_id):
    with state_lock(team_id):
        save(team_id, 'extension.enc', {'digest': '', 'expires_at': 0})
        save(team_id, 'pair-code.enc', {'digest': '', 'expires_at': 0})
    return {'paired': False}


def poll(request):
    team_id, token_digest = authenticate(request)
    if request.data:
        raise RuleError('任务领取不接收参数。')
    with state_lock(team_id):
        data = load(team_id, 'extension.enc')
        if data.get('digest') != token_digest:
            raise RuleError('连接已改变，请重新配对。')
        data['last_seen'] = time.time()
        save(team_id, 'extension.enc', data)
        job = load(team_id, 'extension-job.json')
        if not job or job['expires_at'] <= time.time() or job['token_digest'] != token_digest or job['status'] != 'pending':
            return {'job': None}
        job['status'] = 'claimed'
        save(team_id, 'extension-job.json', job)
        return {'job': {'id': job['id'], 'pages': {kind: source.ORIGIN + path for kind, path in source.PATHS.items()}}}


class RawRow(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    cells: list[str] = Field(min_length=4, max_length=5)
    url: str = Field(max_length=600)


class RawPage(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    url: str = Field(max_length=600)
    headers: list[str] = Field(min_length=4, max_length=5)
    rows: list[RawRow] = Field(min_length=10, max_length=10)
    context: str = Field(max_length=12000)


def complete(request):
    team_id, token_digest = authenticate(request)
    payload = request.data
    if not isinstance(payload, dict) or set(payload) not in ({'id', 'pages'}, {'id', 'error'}) or len(json.dumps(payload)) > 100000:
        raise RuleError('仅接收本轮两榜表格或固定错误状态。')
    with state_lock(team_id):
        active = load(team_id, 'extension.enc')
        if not active or active.get('digest') != token_digest or active.get('expires_at', 0) <= time.time():
            raise RuleError('连接已失效，请重新配对。')
        job = load(team_id, 'extension-job.json')
        if not job or job['id'] != payload.get('id') or job['status'] != 'claimed' or job['token_digest'] != token_digest or job['expires_at'] <= time.time():
            raise RuleError('采集任务已结束或不属于此连接，不接受迟到结果。')
        if 'error' in payload:
            errors = {'challenge': 'CJ 要求安全验证，请在普通 Chrome 中自行处理后手动重试。',
                      'login': 'CJ 尚未登录，请在普通 Chrome 登录。',
                      'page': 'CJ 榜单未加载或结构变化，请检查两个页面。'}
            for kind, name in [('sales','销售榜'),('advertising','广告榜')]:
                errors.update({kind+'.challenge': name+'要求安全验证，请在普通 Chrome 自行处理后重试。',
                    kind+'.login': name+'尚未登录，请在普通 Chrome 登录。',
                    kind+'.heading': name+'表格已加载，但未识别仪表板标题或元数据边界；请反馈截图，不会猜测榜单范围。',
                    kind+'.table': name+'未识别到完整前十表格，可能是语言、结构差异或加载未完成；请检查页面并反馈截图。',
                    kind+'.page': name+'页面未加载或无法读取，请检查该页面。'})
            if not isinstance(payload['error'], str) or payload['error'] not in errors:
                raise RuleError('未知采集错误。')
            job.update(status='failed', error=errors[payload['error']])
        else:
            try:
                if not isinstance(payload['pages'], dict) or set(payload['pages']) != set(source.PATHS):
                    raise ValueError()
                pages = {kind: source.parse_page(kind, RawPage.model_validate(raw).model_dump()) for kind, raw in payload['pages'].items()}
            except (ValidationError, ValueError, TypeError, RuleError):
                job.update(status='failed', error='CJ 两榜表格、来源或范围未通过校验；未使用旧数据。')
            else:
                job.update(status='done', result={'schema_version': 'cj.intelligence.top10@1',
                           'captured_at': datetime.now(timezone.utc).isoformat(), **pages,
                           'collector': 'chrome_extension', 'supplier_category_mapping': 'not_verified'})
        save(team_id, 'extension-job.json', job)
    return {'accepted': True, 'status': job['status']}


def collect(team_id):
    source.require_desktop()
    lock = source.lock_for(team_id)
    if not lock.acquire():
        raise Conflict('已有行情采集正在进行，不会重复请求。')
    try:
        with state_lock(team_id):
            data = load(team_id, 'extension.enc')
            if not connection_status(team_id)['online']:
                raise RuleError('Chrome 扩展未连接，请打开已配对的普通 Chrome；不会启动自动化浏览器。')
            job = {'id': str(uuid4()), 'status': 'pending', 'token_digest': data['digest'], 'expires_at': time.time() + 70}
            save(team_id, 'extension-job.json', job)
        while time.time() < job['expires_at']:
            current = load(team_id, 'extension-job.json')
            active = load(team_id, 'extension.enc')
            if not active or active.get('digest') != job['token_digest']:
                raise RuleError('Chrome 连接已撤销或改变，已停止采集。')
            if current and current['id'] == job['id']:
                if current['status'] == 'failed':
                    raise RuleError(current['error'])
                if current['status'] == 'done':
                    source.write_private(source.folder(team_id) / 'snapshot.json', json.dumps(current['result'], ensure_ascii=False))
                    return current['result']
            time.sleep(0.2)
        raise RuleError('Chrome 采集超时，请检查浏览器是否打开及 CJ 是否要求登录或验证；不会自动重试。')
    finally:
        lock.release()

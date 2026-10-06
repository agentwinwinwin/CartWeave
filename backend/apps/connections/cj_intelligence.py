"""Desktop-only, model-free read-only CJ webpage collector.

No Codex runtime, API key, credential upload, or arbitrary URL is accepted.
Users sign in normally in Chrome; the paired extension returns table data only.
"""
import json
import os
import re
import tempfile
import threading
from datetime import datetime
from pathlib import Path
from uuid import UUID
from urllib.parse import urlparse

from django.conf import settings
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from apps.common.errors import Conflict, RuleError
from .services import encrypt

ORIGIN = 'https://www.cjdropshipping.com'
PATHS = {'sales': '/intelligence/sales-trends', 'advertising': '/intelligence/ad-trends'}
_guard = threading.Lock()
_locks = {}


class LocalBrowserLock:
    """One workspace browser operation across the local API and runtime worker."""
    def __init__(self, team_id):
        self.path = folder(team_id) / 'browser.lock'
        self.thread_lock = threading.Lock()
        self.fd = None

    def acquire(self, blocking=False):
        if not self.thread_lock.acquire(blocking=blocking):
            return False
        fd = None
        try:
            fd = os.open(self.path, os.O_CREAT | os.O_RDWR, 0o600)
            if os.name == 'nt':
                import msvcrt
                if os.fstat(fd).st_size == 0:
                    os.write(fd, b'0')
                os.lseek(fd, 0, os.SEEK_SET)
                msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.fd = fd
            return True
        except OSError as exc:
            if fd is not None:
                os.close(fd)
            self.thread_lock.release()
            import errno
            if exc.errno in (errno.EACCES, errno.EAGAIN):
                return False
            raise RuleError('无法取得本机浏览器锁，已停止访问 CJ。') from None

    def release(self):
        fd, self.fd = self.fd, None
        if fd is not None:
            try:
                if os.name == 'nt':
                    import msvcrt
                    os.lseek(fd, 0, os.SEEK_SET)
                    msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(fd, fcntl.LOCK_UN)
            finally:
                os.close(fd)
                self.thread_lock.release()

    def locked(self):
        return self.thread_lock.locked()


def require_desktop():
    if not (settings.LOCAL and settings.DESKTOP_MODE):
        raise RuleError('网页行情采集目前仅支持本机桌面模式，不支持远程服务打开登录窗口。')


def folder(team_id):
    require_desktop()
    team_id = str(UUID(str(team_id)))
    root = Path(getattr(settings, 'CJ_INTELLIGENCE_DIR', settings.BASE_DIR / '.local' / 'cj-intelligence'))
    target = root / team_id
    target.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(target, 0o700)
    return target


def write_private(path, content):
    # Atomic, owner-only files; never persist decrypted browser state.
    fd, name = tempfile.mkstemp(dir=path.parent, prefix='.pending-')
    try:
        with os.fdopen(fd, 'w') as stream:
            stream.write(content)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def lock_for(team_id):
    with _guard:
        key = str(team_id)
        if key not in _locks:
            _locks[key] = LocalBrowserLock(team_id)
        return _locks[key]


def start_login(team_id):
    raise RuleError('已改用普通 Chrome 扩展连接，请在 CJ 网站正常登录并在工作台配对扩展。')


class TrendRow(BaseModel):
    model_config = ConfigDict(extra='forbid')
    rank: int = Field(ge=1, le=10)
    category_name: str = Field(min_length=1, max_length=200)
    source_category_id: str = Field(min_length=1, max_length=100)
    source_url: str
    metrics: dict[str, str]


def parse_page(kind, raw):
    """Fail closed on missing ranks, headers, scope, dates or source identity."""
    path = PATHS[kind]
    if raw.get('url') != ORIGIN + path:
        raise RuleError('CJ 登录已失效或页面被重定向，请重新登录；不会使用旧数据。')
    expected = (['Rank', 'Category Name', 'TikTok Ad Count', 'Facebook Ad Count', 'Action']
                if kind == 'advertising' else ['Rank / Categories', 'Sales / Sales Volume', 'Ranking Change Rate', 'Action'])
    aliases = {'排名/类目': 'Rank / Categories', '排名/类别': 'Rank / Categories',
        '销售额/销量': 'Sales / Sales Volume', '排名增长率': 'Ranking Change Rate',
        '排名变化率': 'Ranking Change Rate', '操作': 'Action', '排名': 'Rank',
        '类目名称': 'Category Name', '类别名称': 'Category Name',
        'TikTok广告数': 'TikTok Ad Count', 'Facebook广告数': 'Facebook Ad Count'}
    headers = [aliases.get(re.sub(r'\s+', '', h).replace('／','/'), re.sub(r'\s+', ' ', h).strip()) for h in raw.get('headers', [])]
    if headers != expected or len(raw.get('rows', [])) != 10:
        raise RuleError('CJ 榜单结构变化或前十不完整，已停止采集。')
    context = raw.get('context', '')
    if kind == 'sales':
        if not re.search(r'Amazon\s*(?:platform product sales data|平台商品销售数据)', context) or not re.search(r'(?:Site|站点)\s*[:：]?\s*All Sites', context):
            raise RuleError('无法核实销售榜来源或 All Sites 范围。')
        names = ['sales_display', 'sales_volume_display', 'ranking_change_rate_display']
    else:
        if not re.search(r'(?:Platform|平台)\s*[:：]?\s*(?:All|全部)\s+(?:Region|地区)\s*[:：]?\s*(?:All|全部)', context):
            raise RuleError('无法核实广告榜平台与地区范围。')
        names = ['tiktok_ad_count_display', 'facebook_ad_count_display']
    date = re.search(r'(?:Data Updated|数据更新)\s*[:：]\s*([A-Za-z]{3})\.?\s+(\d{1,2}),\s*(\d{4})', context)
    if not date:
        raise RuleError('无法核实 CJ 来源更新时间。')
    try:
        updated = datetime.strptime(' '.join(date.groups()), '%b %d %Y').date().isoformat()
        result = []
        for i, row in enumerate(raw['rows'], 1):
            cells = row['cells']
            if len(cells) != len(expected):
                raise ValueError()
            if kind == 'sales':
                split = re.fullmatch(r'(\d{1,2})\s*([^\d][\s\S]*)', cells[0].strip())
                if not split:
                    raise ValueError()
                rank, name = int(split[1]), split[2].strip()
                values = [*re.split(r'\s*/\s*', cells[1].strip()), cells[2].strip()]
            else:
                rank, name = int(cells[0]), cells[1].strip()
                values = [cells[2].strip(), cells[3].strip()]
            url = urlparse(row['url'])
            category = url.path.removeprefix(path + '/')
            pattern = r'\d+' if kind == 'sales' else r'[a-f0-9]{24}'
            if rank != i or url.scheme != 'https' or url.netloc != 'www.cjdropshipping.com' or not re.fullmatch(pattern, category):
                raise ValueError()
            if len(values) != len(names) or not all(values):
                raise ValueError()
            result.append(TrendRow(rank=rank, category_name=name, source_category_id=category,
                source_url=row['url'], metrics=dict(zip(names, values))).model_dump())
        if len({r['source_category_id'] for r in result}) != 10:
            raise ValueError()
    except (ValueError, KeyError, IndexError, TypeError, ValidationError):
        raise RuleError('CJ 排名、类目或指标不符合前十榜单约定，已停止采集。') from None
    return {'source_url': raw['url'], 'updated_on': updated, 'scope': 'all_sites' if kind == 'sales' else 'all_platforms_all_regions',
        'data_source': 'amazon_market' if kind == 'sales' else 'tiktok_facebook_advertising',
        'period': None, 'precision': 'rounded_web_display', 'rows': result}


def status(team_id):
    from .cj_browser_bridge import connection_status
    root = folder(team_id)
    connection = connection_status(team_id)
    login = {'status': 'connected' if connection['online'] else 'offline',
             'message': '普通 Chrome 扩展已连接；CJ 登录是否有效将在采集时检查。' if connection['online'] else '请安装并配对扩展，保持普通 Chrome 打开。'}
    snapshot = None
    if (root / 'snapshot.json').exists():
        try:
            snapshot = json.loads((root / 'snapshot.json').read_text())
        except ValueError:
            raise RuleError('保存的行情快照损坏，请重新采集。') from None
    return {'session_saved': connection['paired'], 'extension': connection, 'login': login, 'snapshot': snapshot,
        'note': 'session_saved 仅兼容表示扩展已配对，不保存 CJ 登录态；GET 只返回历史快照。'}


def collect(team_id):
    from .cj_browser_bridge import collect as read_chrome
    return read_chrome(team_id)

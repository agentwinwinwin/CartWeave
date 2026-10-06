"""CJ category directory and bounded search preview; not a workflow executor."""
import time
from datetime import timedelta
from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from django.core.cache import cache
from django.db import transaction
from django.utils import timezone
from django.views.decorators.debug import sensitive_variables
from pydantic import BaseModel, ConfigDict, Field, model_validator
from typing import Literal

from apps.common.errors import Conflict, RuleError
from .models import SupplierConnection
from .cj import cj_request, samples, CJUnavailable
READ_INTERVAL_SECONDS = 1.1  # Below the documented free-account ceiling of 1 QPS.


class CategoryQuery(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    categoryId: str = Field(min_length=1, max_length=200)
    keyword: str = Field(default='', max_length=200)


class ProductSearch(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    categoryId: str = Field(default='', max_length=200)
    keyword: str = Field(default='', max_length=200)
    emptyResultPolicy: Literal['pause', 'drop_keyword_once'] = 'pause'
    # Missing in historical frozen tasks: preserve their original catalog search.
    candidateSource: Literal['catalog', 'trending'] = 'catalog'
    market: str = Field(pattern=r'^[A-Z]{2}$')
    requestedCurrency: str = Field(pattern=r'^[A-Z]{3}$')
    limit: int = Field(default=20, ge=1, le=1000, strict=True)
    categoryQueries: list[CategoryQuery] | None = Field(default=None, max_length=10)

    @model_validator(mode='after')
    def validate_groups(self):
        if self.categoryQueries is not None:
            if self.categoryId or (self.categoryQueries and self.keyword):
                raise ValueError('多类目查询不能混用旧类目或全局关键词')
            ids = [group.categoryId for group in self.categoryQueries]
            if len(ids) != len(set(ids)) or self.limit < len(ids):
                raise ValueError('类目不能重复，候选数量不能少于类目数量')
        return self


def candidate_search_params(query):
    """CJ's documented trending subset; listing count is NOT a sales ranking."""
    return {'productFlag': 0, 'orderBy': 0, 'sort': 'desc'} if query.candidateSource == 'trending' else {}


def flatten_categories(data):
    if not isinstance(data, list):
        raise CJUnavailable('CJ 类目目录格式异常，请稍后刷新。')
    result, seen = [], set()
    for first in data:
        if not isinstance(first, dict) or not isinstance(first.get('categoryFirstList'), list):
            raise CJUnavailable('CJ 类目目录格式异常，请稍后刷新。')
        for second in first['categoryFirstList']:
            if not isinstance(second, dict) or not isinstance(second.get('categorySecondList'), list):
                raise CJUnavailable('CJ 类目目录格式异常，请稍后刷新。')
            for leaf in second['categorySecondList']:
                if not isinstance(leaf, dict) or not all(isinstance(leaf.get(k), str) and leaf[k] for k in ('categoryId', 'categoryName')):
                    raise CJUnavailable('CJ 类目缺少标识，请稍后刷新。')
                if leaf['categoryId'] in seen:
                    continue
                seen.add(leaf['categoryId'])
                names = [first.get('categoryFirstName'), second.get('categorySecondName'), leaf['categoryName']]
                result.append({'id': leaf['categoryId'], 'name': leaf['categoryName'], 'path': ' / '.join(n for n in names if isinstance(n, str) and n)})
    return result


def connection_for(member):
    connection = SupplierConnection.objects.filter(team=member.team, provider='cj').first()
    if not connection or connection.status != 'verified' or not connection.token_expires_at or connection.token_expires_at <= timezone.now() + timedelta(minutes=1):
        raise Conflict('请先在 CJ 接入页保存密钥并验证连接；令牌过期时需要重新验证。')
    return connection


@sensitive_variables()
def read_cj(connection, path, method='GET', **kwargs):
    if method != 'GET' and (method != 'POST' or path not in ('/logistic/freightCalculate','/product/productDetail/query')):
        raise RuleError('商品读取服务不允许采购、付款或其他写入动作。')
    # Reserve account request slots across web workers; remote I/O stays outside transactions.
    with transaction.atomic():
        current = SupplierConnection.objects.select_for_update().get(pk=connection.pk)
        if current.configuration_version != connection.configuration_version or current.status != 'verified':
            raise Conflict('CJ 连接已变化，请刷新后重试。')
        if current.verification_until and current.verification_until > timezone.now():
            raise Conflict('CJ 请求过于频繁或正在验证，请稍后重试。')
        current.verification_until = timezone.now() + timedelta(seconds=READ_INTERVAL_SECONDS)
        current.save(update_fields=['verification_until'])
    try:
        token = Fernet(settings.CREDENTIAL_KEY.encode()).decrypt(connection.token_ciphertext.encode()).decode()
    except (InvalidToken, ValueError):
        raise CJUnavailable('无法读取 CJ 访问凭证，请重新保存密钥并验证。') from None
    data = cj_request(method, path, headers={'CJ-Access-Token': token}, **kwargs)
    connection.refresh_from_db()
    if connection.configuration_version != current.configuration_version or connection.status != 'verified':
        raise Conflict('CJ 连接已变化，本次旧查询结果已丢弃。')
    return data


def catalog(member, refresh=False):
    connection = connection_for(member)
    key = f'cj-categories:{connection.id}:{connection.configuration_version}'
    saved = cache.get(key)
    if saved is not None and not refresh:
        return saved
    items = flatten_categories(read_cj(connection, '/product/getCategory', allow_list=True))
    result = {'categories': items, 'fetched_at': timezone.now().isoformat(), 'source': 'cj', 'connection_version': connection.configuration_version}
    cache.set(key, result, 3600)
    return result


def preview(member, query, *, stock_only=False):
    if query.categoryQueries:
        directory = catalog(member)
        ids = {item['id'] for item in directory['categories']}
        if any(group.categoryId not in ids for group in query.categoryQueries):
            raise RuleError('所选 CJ 类目不存在或已失效，请重新选择。')
        groups, merged, seen = [], [], set()
        count = len(query.categoryQueries)
        version = connection_for(member).configuration_version
        deadline = time.monotonic() + 40
        for index, group in enumerate(query.categoryQueries):
            quota = query.limit // count + (index < query.limit % count)
            budget = min(query.limit, 20)
            preview_quota = budget // count + (index < budget % count)
            row = {'categoryId': group.categoryId, 'keyword': group.keyword, 'quota': quota, 'previewQuota': preview_quota}
            if connection_for(member).configuration_version != version:
                raise Conflict('CJ 连接已变化，请重新试搜。')
            try:
                if time.monotonic() >= deadline:
                    raise CJUnavailable('本次试搜时间已用完，请稍后重试。')
                result = preview(member, ProductSearch(categoryId=group.categoryId, keyword=group.keyword,
                    candidateSource=query.candidateSource,
                    market=query.market, requestedCurrency=query.requestedCurrency, limit=preview_quota,
                    emptyResultPolicy=query.emptyResultPolicy if group.keyword else 'pause'), stock_only=stock_only)
                row.update(outcome=result['outcome'], products=result['products'], attempts=result['attempts'])
                for product in result['products']:
                    if product['id'] not in seen:
                        seen.add(product['id'])
                        merged.append(product)
            except CJUnavailable:
                row.update(outcome='error', products=[], attempts=[], message='此类目查询失败或超时，请重试；不代表零结果。')
            groups.append(row)
        failed = any(group['outcome'] == 'error' for group in groups)
        return {'outcome': ('partial' if merged else 'error') if failed else ('results' if merged else 'no_results'),
                'products': merged, 'groups': groups, 'attempts': [], 'query': query.model_dump(), 'preview_only': True,
                'message': '按类目分配试搜额度，按商品 ID 合并去重；未用完的额度不转给其他类目。仅为样本，不是完整采集结果。'}
    # Categories are validated against CJ's server-side directory, not labels supplied by the UI.
    if query.categoryId:
        directory = catalog(member)
        if query.categoryId not in {item['id'] for item in directory['categories']}:
            raise RuleError('所选 CJ 类目不存在或已失效，请重新选择；不会自动扩大到不限类目。')
    if query.emptyResultPolicy == 'drop_keyword_once' and not query.keyword:
        raise RuleError('只有填写关键词后，才能选择去掉关键词重试。')
    connection = connection_for(member)
    attempts = []
    params = {'page': 1, 'size': min(query.limit, 20), **candidate_search_params(query)}
    if stock_only:
        params['verifiedWarehouse'] = 1
    if query.categoryId:
        params['categoryId'] = query.categoryId
    if query.keyword:
        params['keyWord'] = query.keyword
    for attempt in range(2):
        # Allow the preceding category load or search to finish its reserved slot.
        expected_version = connection.configuration_version
        connection.refresh_from_db()
        if connection.configuration_version != expected_version:
            raise Conflict('CJ 连接已变化，请重新试搜。')
        delay = (connection.verification_until - timezone.now()).total_seconds() if connection.verification_until else 0
        if delay > 3:
            raise Conflict('CJ 正在验证，请稍后重试搜索。')
        if delay > 0:
            time.sleep(delay + 0.05)
        data = read_cj(connection, '/product/listV2', params=params)
        products = samples(data, limit=min(query.limit, 20))
        attempts.append({'categoryId': params.get('categoryId', ''), 'keyword': params.get('keyWord', ''),
                         'candidateSource': query.candidateSource, 'has_results': bool(products)})
        if products or attempt == 1 or query.emptyResultPolicy != 'drop_keyword_once':
            break
        params.pop('keyWord', None)
    return {'outcome': 'results' if products else 'no_results', 'products': products,
            'attempts': attempts, 'query': query.model_dump(), 'preview_only': True,
            'message': '返回最多二十件预览样本，未执行选品流程。' if products else 'CJ 查询成功但没有商品，请调整关键词或重新选择类目。'}

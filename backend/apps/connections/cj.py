"""CJ credential onboarding and bounded, read-only verification."""
import time
import uuid
import threading
from datetime import timedelta

import httpx
from cryptography.fernet import Fernet
from django.conf import settings
from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.views.decorators.debug import sensitive_variables
from rest_framework.exceptions import APIException

from apps.audit.models import AuditRecord
from apps.common.errors import Conflict
from .models import SupplierConnection
from .services import encrypt

BASE = 'https://developers.cjdropshipping.com/api2.0/v1'
_transport = threading.local()


def _without_cookies(request):
    # Connection pooling must not propagate one account's cookies to another.
    request.headers.pop('cookie', None)


def pooled_request(method, url, **kwargs):
    client = getattr(_transport, 'client', None)
    if client is None or client.is_closed:
        client = httpx.Client(trust_env=False, follow_redirects=False,
            limits=httpx.Limits(max_connections=2, max_keepalive_connections=2, keepalive_expiry=30),
            event_hooks={'request':[_without_cookies]})
        _transport.client = client
    # Credentials are supplied for this request only, never client defaults.
    try:
        return client.request(method, url, **kwargs)
    finally:
        client.cookies.clear()


class CJUnavailable(APIException):
    status_code = 502
    default_code = 'cj_unavailable'
    default_detail = 'CJ 验证未完成，请稍后重试。'


class CJTemporary(CJUnavailable):
    default_code = 'cj_temporary'


def public_connection(connection):
    if connection is None:
        return {'configured': False, 'status': 'not_configured', 'configuration_version': 0, 'sample_products': []}
    return {'id': str(connection.id), 'configured': True, 'status': connection.status,
            'configuration_version': connection.configuration_version, 'verified_at': connection.verified_at,
            'last_error': connection.last_error, 'sample_products': connection.sample_products}


@sensitive_variables()
@transaction.atomic
def save_key(member, api_key, expected_version):
    type(member.team).objects.select_for_update().get(pk=member.team_id)
    connection = SupplierConnection.objects.select_for_update().filter(team=member.team, provider='cj').first()
    if (connection.configuration_version if connection else 0) != expected_version:
        raise Conflict('CJ 连接已被更新，请刷新后再保存。')
    if connection is None:
        connection = SupplierConnection(team=member.team, provider='cj')
    else:
        connection.configuration_version += 1
    connection.credential_ciphertext = encrypt(api_key)
    connection.token_ciphertext, connection.token_expires_at = '', None
    connection.status, connection.last_error = 'saved', ''
    connection.sample_products, connection.verified_at = [], None
    connection.verification_token, connection.verification_until = None, None
    connection.save()
    AuditRecord.objects.create(team=member.team, actor=member.user, action='cj.credential_saved',
                               object_id=str(connection.id), metadata={'configuration_version': connection.configuration_version})
    return connection


@sensitive_variables()
def cj_request(method, path, allow_list=False, **kwargs):
    # No user-controlled URL, redirects, automatic writes, or raw upstream errors.
    try:
        response = pooled_request(method, BASE + path, timeout=12, follow_redirects=False, **kwargs)
        if response.status_code == 429:
            try:
                body=response.json()
            except ValueError:
                body={}
            if isinstance(body,dict) and (body.get('code')==16900500 or 'points' in str(body.get('message','')).lower()):
                raise CJUnavailable('CJ API 点数不足，请等待额度恢复或检查账号；不会自动反复重试。')
            raise CJTemporary('CJ 请求频率受限，正在按限频规则等待重试。')
        if response.status_code >= 500:
            raise CJTemporary('CJ 服务暂时异常，正在等待重试。')
        if response.status_code != 200:
            raise CJUnavailable('CJ 暂时不可用或拒绝认证，请检查密钥状态后重试。')
        data = response.json()
    except httpx.HTTPError:
        raise CJTemporary('CJ 网络请求失败或超时，正在等待重试。') from None
    except ValueError:
        raise CJUnavailable('CJ 返回内容不是有效 JSON，已暂停，请检查接口状态。') from None
    if not isinstance(data, dict) or data.get('code') != 200 or data.get('result') is not True:
        if isinstance(data,dict) and data.get('code')==1600200:
            raise CJTemporary('CJ 请求频率受限，正在按限频规则等待重试。')
        if isinstance(data,dict) and data.get('code')==16900500:
            raise CJUnavailable('CJ API 点数不足，请等待额度恢复或检查账号；不会自动反复重试。')
        raise CJUnavailable('CJ 未通过请求，请检查 API Key 是否完整、已激活且具有商品读取权限。')
    if not isinstance(data.get('data'), (dict, list) if allow_list else dict):
        raise CJUnavailable('CJ 返回的数据结构不符合接口约定。')
    return data['data']


def samples(data, limit=3):
    content = data.get('content')
    if not isinstance(content, list):
        raise CJUnavailable('CJ 商品列表结构发生变化，尚未完成验证。')
    products = []
    for group in content:
        if not isinstance(group, dict) or not isinstance(group.get('productList'), list):
            raise CJUnavailable('CJ 商品列表结构发生变化，尚未完成验证。')
        for item in group['productList']:
            if not isinstance(item, dict) or not item.get('id'):
                raise CJUnavailable('CJ 商品缺少标识，尚未完成验证。')
            # No raw upstream payload, HTML, credentials, or undocumented fields in the UI.
            fields = ('id', 'nameEn', 'sku', 'sellPrice', 'listedNum', 'warehouseInventoryNum', 'totalVerifiedInventory')
            products.append({key: value if isinstance(value := item.get(key), (str, int, float)) and not isinstance(value, bool) else None for key in fields})
    return products[:limit]


@sensitive_variables()
def verify_connection(member):
    with transaction.atomic():
        connection = SupplierConnection.objects.select_for_update().filter(team=member.team, provider='cj').first()
        if connection is None:
            raise Conflict('请先保存 CJ API Key。')
        now = timezone.now()
        if connection.verification_until and connection.verification_until > now:
            raise Conflict('CJ 验证正在执行或处于短暂冷却，请稍后重试。')
        lease = uuid.uuid4()
        version = connection.configuration_version
        connection.verification_token, connection.verification_until = lease, now + timedelta(seconds=60)
        connection.status, connection.last_error = 'verifying', ''
        connection.save(update_fields=['verification_token', 'verification_until', 'status', 'last_error'])
    token_ciphertext = connection.token_ciphertext
    token_expiry = connection.token_expires_at
    error, products = None, []
    try:
        cipher = Fernet(settings.CREDENTIAL_KEY.encode())
        if token_ciphertext and token_expiry and token_expiry > timezone.now() + timedelta(minutes=5):
            access_token = cipher.decrypt(token_ciphertext.encode()).decode()
        else:
            api_key = cipher.decrypt(connection.credential_ciphertext.encode()).decode()
            result = cj_request('POST', '/authentication/getAccessToken', json={'apiKey': api_key})
            access_token = result.get('accessToken')
            expiry = result.get('accessTokenExpiryDate')
            token_expiry = parse_datetime(expiry) if isinstance(expiry, str) else None
            if not isinstance(access_token, str) or not access_token or not token_expiry or timezone.is_naive(token_expiry) or token_expiry <= timezone.now():
                raise CJUnavailable('CJ 访问令牌或有效期异常，尚未完成验证。')
            token_ciphertext = encrypt(access_token)
            # Official account QPS is one; the sample query follows token exchange.
            time.sleep(1.1)
        products = samples(cj_request('GET', '/product/listV2', headers={'CJ-Access-Token': access_token}, params={'page': 1, 'size': 3}))
    except CJUnavailable as exc:
        error = exc
    except Exception:
        error = CJUnavailable('无法安全读取或校验 CJ 凭证，请联系管理员后重新保存密钥。')
    with transaction.atomic():
        current = SupplierConnection.objects.select_for_update().get(pk=connection.pk)
        if current.configuration_version != version or current.verification_token != lease:
            raise Conflict('验证期间密钥已更新，旧验证结果已丢弃。')
        current.status = 'error' if error else 'verified'
        current.last_error = str(error.detail) if error else ''
        current.sample_products = products
        current.verified_at = None if error else timezone.now()
        # A cached token that fails validation is discarded for the next explicit attempt.
        current.token_ciphertext = '' if error else token_ciphertext
        current.token_expires_at = None if error else token_expiry
        current.verification_until = timezone.now() + timedelta(seconds=3)
        current.save()
        AuditRecord.objects.create(team=member.team, actor=member.user, action='cj.verification_failed' if error else 'cj.verified',
                                   object_id=str(current.id), metadata={'configuration_version': version, 'sample_count': len(products)})
    if error:
        raise error
    return current

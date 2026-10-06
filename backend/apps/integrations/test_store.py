import httpx
from django.conf import settings
from apps.common.errors import RuleError
from apps.connections.services import credential, check_store

class UnknownResult(Exception):
    pass

class TestStoreAdapter:
    def __init__(self, store, verify_connection=False):
        if verify_connection:
            store.refresh_from_db()
            if not store.active or store.environment != 'test' or store.channel != 'test-store' or store.adapter != 'test-store.v1':
                raise RuleError('只能验收已安装的测试站适配器。')
        else:
            check_store(store)
        # Only a server-configured base URL, never a URL supplied in a workflow.
        self.base = settings.TEST_STORE_API_BASE.rstrip('/')
        self.headers = {'Authorization': 'Bearer ' + credential(store)}
        self.store_capabilities=set(store.capabilities)

    def call(self, method, path, data=None, allow_missing=False):
        try:
            response = httpx.request(method, self.base + path, json=data, headers=self.headers, timeout=10, follow_redirects=False, trust_env=False)
        except (httpx.TransportError, httpx.TimeoutException):
            raise UnknownResult('测试站响应未知，需要核对结果。') from None
        if allow_missing and response.status_code == 404:
            return None
        if response.status_code >= 500:
            raise UnknownResult('测试站暂时不可用。')
        if response.status_code >= 400:
            raise RuleError('测试站拒绝操作，请检查接口授权与商品数据。')
        try:
            return response.json()
        except ValueError:
            raise UnknownResult('测试站响应格式异常。') from None

    def validate(self, listing):
        result = self.call('POST', '/actions/listing.validate', {'listing': listing})
        from apps.common.utils import digest
        if result.get('valid') is not True or result.get('digest') != digest(listing):
            raise RuleError('渠道未通过商品检查。')
        return result

    def lookup(self, key):
        return self.call('POST', '/actions/publication.lookup', {'operation_key': key}, allow_missing=True)

    def publish(self, operation):
        return self.call('POST', '/actions/listing.publish', {'operation_key': operation.key, 'listing': operation.payload})

    def verify(self, external_id, listing_digest):
        result = self.call('POST', '/actions/listing.wait', {'external_id': external_id})
        if result.get('digest') != listing_digest or result.get('status') != 'active':
            raise UnknownResult('商品尚未确认可售或内容摘要不匹配。')
        return result

    def listing_status(self, external_id):
        return self.call('POST', '/actions/listing.status', {'external_id':external_id})

    def unpublish(self, command):
        return self.call('POST', '/actions/listing.unpublish', command)

    def read_business(self,action,cursor):
        from contracts.store_business import BUSINESS_ACTIONS,ReadPage
        from apps.common.utils import parse
        if action not in BUSINESS_ACTIONS or action not in self.store_capabilities:
            raise RuleError('店铺尚未验收该业务读取动作，请重新验收接口包。')
        return parse(BUSINESS_ACTIONS[action][2],self.call('POST','/actions/'+action,parse(ReadPage,{'cursor':cursor,'limit':50})))

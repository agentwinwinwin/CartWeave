from cryptography.fernet import Fernet
from django.conf import settings
from apps.common.errors import RuleError

def encrypt(secret):
    return Fernet(settings.CREDENTIAL_KEY.encode()).encrypt(secret.encode()).decode()

def credential(store):
    return Fernet(settings.CREDENTIAL_KEY.encode()).decrypt(store.credential_ciphertext.encode()).decode()

def check_store(store, configuration_version=None):
    store.refresh_from_db()
    if not store.active or not store.verified or store.environment != 'test' or store.channel != 'test-store' or store.adapter != 'test-store.v1':
        raise RuleError('第一阶段仅允许已验收的测试站连接。')
    if configuration_version is not None and store.configuration_version != configuration_version:
        raise RuleError('店铺配置版本已改变，需要重新创建运行。')
    if not {'listing.validate', 'listing.publish', 'listing.wait'} <= set(store.capabilities):
        raise RuleError('店铺缺少已验收的发布动作。')

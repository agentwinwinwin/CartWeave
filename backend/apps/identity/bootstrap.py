import hashlib
import json
import secrets
from pathlib import Path
from django.conf import settings
from django.contrib.auth.models import User
from django.db import transaction
from django.utils import timezone
from apps.connections.models import Store
from apps.connections.services import encrypt
from apps.skills.models import SkillVersion
from apps.skills.handlers import handler_hash
from apps.teststore.models import ApiClient
from .models import Team, Membership

def example_brief():
    root = settings.BASE_DIR.parent
    snapshot = json.loads((root / 'components/commerce/test-store/crownley/snapshot.json').read_text())
    product = snapshot['featured'][0]['product']
    sizes = list(product.get('sizeStock', {})) or ['M']
    return {'schema_version': 'ProductBrief@1', 'product_id': 'workflow-' + secrets.token_hex(6),
        'title': product['name'], 'description': 'A test listing based on the supplied product snapshot. No live stock, shipping or material claims.',
        'selling_points': ['Test product snapshot', 'Variant mapping retained for integration testing'],
        'images': [product['image']], 'currency': 'USD', 'market': 'US',
        'variants': [{'sku': f'TEST-{i}', 'size': size, 'cj_pid': 'fixture-' + product['id'],
                      'cj_vid': f'fixture-{product["id"]}-{i}', 'price': str(product['price']), 'inventory': 5} for i, size in enumerate(sizes)],
        'source_kind': 'test_fixture', 'evidence_ref': 'crownley-snapshot',
        'source_note': 'Synthetic CJ variant IDs for testing only; not usable for procurement.'}

@transaction.atomic
def bootstrap_local():
    if not settings.LOCAL:
        raise RuntimeError('Development bootstrap is forbidden outside COMMERCE_ENV=local.')
    if User.objects.filter(username='commerce-local').exists():
        return
    password = secrets.token_urlsafe(24)
    user = User.objects.create_user('commerce-local', password=password)
    team = Team.objects.create(name='CommerceOS 内部测试团队')
    Membership.objects.create(team=team, user=user, role='admin')
    token = secrets.token_urlsafe(48)
    store = Store.objects.create(team=team, name='Crownley 本地测试站', credential_ciphertext=encrypt(token))
    ApiClient.objects.create(name=store.name, storefront_id=store.id, token_hash=hashlib.sha256(token.encode()).hexdigest())
    SkillVersion.objects.create(team=team, key='content.editorial', version='1.0.0', handler='content.editorial.v1',
        artifact_hash=handler_hash('content.editorial.v1'), status='approved', reviewed_by=user, reviewed_at=timezone.now(),
        review_note='Local bootstrap: closed deterministic formatter, no shell/network/model calls. Test-only review; not a production registration.')
    path = settings.BASE_DIR / '.local' / 'development-access.json'
    with path.open('x') as file:
        import os
        os.chmod(path, 0o600)
        json.dump({'username': user.username, 'password': password, 'store_id': str(store.id)}, file)

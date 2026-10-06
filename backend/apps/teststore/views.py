import hashlib
from decimal import Decimal
from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.throttling import SimpleRateThrottle
from apps.common.errors import Conflict
from apps.common.utils import digest, parse
from contracts.listings import Listing, Brief
from .models import ApiClient, PublishedProduct

class StoreAuthentication(BaseAuthentication):
    def authenticate(self, request):
        auth = request.headers.get('Authorization', '')
        if not auth.startswith('Bearer ') or len(auth) > 300:
            raise AuthenticationFailed('缺少有效的店铺接口凭证。')
        client = ApiClient.objects.filter(active=True, token_hash=hashlib.sha256(auth[7:].encode()).hexdigest()).first()
        if client is None:
            raise AuthenticationFailed('店铺接口凭证无效。')
        return None, client
    def authenticate_header(self, request):
        return 'Bearer'

class StoreThrottle(SimpleRateThrottle):
    scope = 'store'
    def get_cache_key(self, request, view):
        return self.cache_format % {'scope': self.scope, 'ident': str(request.auth.pk)} if request.auth else None

class StoreAPI(APIView):
    authentication_classes = [StoreAuthentication]
    permission_classes = [AllowAny]
    throttle_classes = [StoreThrottle]

def receipt(product):
    return {'external_id': str(product.id), 'product_id': product.product_id,
        'digest': product.digest, 'status': product.status, 'storefront_id': str(product.client.storefront_id)}

def checked_listing(value):
    listing = parse(Listing, value)
    # Validate asset paths and SKU uniqueness using the same domain constraints.
    parse(Brief, {**{k: v for k, v in listing.items() if k not in ('schema_version', 'bullets')},
        'selling_points': listing['bullets'], 'source_kind': 'test_fixture',
        'evidence_ref': 'test-store-input', 'source_note': 'API payload, not CJ verification'})
    return listing

class Capabilities(StoreAPI):
    def get(self, request):
        from contracts.store_api import ACTION_CONTRACTS
        return Response({'adapter': 'test-store.v1', 'storefront_id': str(request.auth.storefront_id),
            'actions': list(ACTION_CONTRACTS), 'idempotent_publish': True,
            'package_version': '1.4.0', 'contracts_path': '/api/test-store/v1/contracts'})

class Contracts(StoreAPI):
    def get(self, request):
        from contracts.store_api import package_contract
        return Response(package_contract())


class Action(StoreAPI):
    """A closed, server-owned dispatch table; no code or endpoint is taken from a draft."""
    def post(self, request, action):
        from contracts.store_api import ACTION_CONTRACTS
        if action not in ACTION_CONTRACTS:
            return Response({'code': 'unsupported_action', 'action': action}, status=501)
        input_model, output_model = ACTION_CONTRACTS[action]
        command = parse(input_model, request.data)
        from contracts.store_business import BUSINESS_ACTIONS
        if action in BUSINESS_ACTIONS:
            from .models import BusinessEvent
            kind,_,_=BUSINESS_ACTIONS[action]
            rows=list(BusinessEvent.objects.filter(client=request.auth,kind=kind,sequence__gt=int(command['cursor'])).order_by('sequence')[:command['limit']+1])
            selected=rows[:command['limit']]
            result=Response({'items':[r.payload for r in selected],
                'next_cursor':str(selected[-1].sequence) if selected else command['cursor'],'has_more':len(rows)>command['limit']})
        elif action == 'listing.validate':
            listing = checked_listing(command['listing'])
            result = Response({'valid': True, 'digest': digest(listing), 'adapter': 'test-store.v1'})
        elif action == 'listing.publish':
            # Reuse the same create-only, tenant-isolated idempotent transaction.
            result = Products().post(request)
        elif action == 'listing.wait':
            result = ProductDetail().get(request, pk=command['external_id'])
        elif action == 'listing.status':
            result = Response(receipt(get_object_or_404(PublishedProduct, pk=command['external_id'], client=request.auth)))
        elif action == 'listing.unpublish':
            with transaction.atomic():
                # Serialize keys per storefront as in publishing; never modify listing content.
                ApiClient.objects.select_for_update().get(pk=request.auth.pk)
                product = get_object_or_404(PublishedProduct.objects.select_for_update(), pk=command['external_id'], client=request.auth)
                if product.digest != command['expected_digest']:
                    raise Conflict('商品内容摘要已改变，不能下架其他版本。')
                if PublishedProduct.objects.filter(client=request.auth, unpublish_key=command['operation_key']).exclude(pk=product.pk).exists():
                    raise Conflict('下架操作键已绑定其他商品。')
                if product.unpublish_key and product.unpublish_key != command['operation_key']:
                    raise Conflict('商品已存在另一项下架操作。')
                product.status, product.unpublish_key = 'inactive', command['operation_key']
                product.save(update_fields=['status', 'unpublish_key'])
                result = Response(receipt(product))
        else:
            result = Operation().get(request, key=command['operation_key'])
        return Response(parse(output_model, result.data), status=result.status_code)

class Validate(StoreAPI):
    def post(self, request):
        listing = checked_listing(request.data.get('listing'))
        return Response({'valid': True, 'digest': digest(listing), 'adapter': 'test-store.v1'})

class Products(StoreAPI):
    def post(self, request):
        from rest_framework.exceptions import ValidationError
        key = request.data.get('operation_key')
        if not isinstance(key, str) or len(key) != 64 or any(c not in '0123456789abcdef' for c in key):
            raise ValidationError('需要稳定的 SHA256 操作键。')
        listing = checked_listing(request.data.get('listing'))
        content_digest = digest(listing)
        with transaction.atomic():
            client = ApiClient.objects.select_for_update().get(pk=request.auth.pk)
            previous = PublishedProduct.objects.filter(client=client, operation_key=key).first()
            if previous:
                if previous.digest != content_digest:
                    raise Conflict('同一操作键不能发布不同内容。')
                return Response(receipt(previous))
            # Phase one is create-only. Updating an existing product needs a distinct future action contract.
            if PublishedProduct.objects.filter(client=client, product_id=listing['product_id']).exists():
                raise Conflict('该商品已有发布版本；第一阶段禁止隐式覆盖。')
            product = PublishedProduct.objects.create(client=client, product_id=listing['product_id'], operation_key=key,
                digest=content_digest, payload=listing)
        return Response(receipt(product), status=201)

class Operation(StoreAPI):
    def get(self, request, key):
        return Response(receipt(get_object_or_404(PublishedProduct, client=request.auth, operation_key=key)))

class ProductDetail(StoreAPI):
    def get(self, request, pk):
        product = get_object_or_404(PublishedProduct, pk=pk, client=request.auth)
        return Response({**receipt(product), 'listing': product.payload})

class PublicCatalog(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    def get(self, request, storefront_id=None):
        if storefront_id is None:
            from django.conf import settings
            from django.http import Http404
            if not settings.LOCAL:
                raise Http404()
            client = ApiClient.objects.filter(active=True).order_by('created_at').first()
            if not client:
                raise Http404()
            storefront_id = client.storefront_id
        client = get_object_or_404(ApiClient, storefront_id=storefront_id, active=True)
        products = PublishedProduct.objects.filter(client=client, status='active').order_by('created_at')[:100]
        return Response({'mode': 'test-publication', 'storefront_id': str(storefront_id), 'products': [
            {'id': p.product_id, 'name': p.payload['title'], 'description': p.payload['description'],
             'price': float(min(Decimal(v['price']) for v in p.payload['variants'])),
             'image': p.payload['images'][0], 'gallery': p.payload['images'][1:], 'category': 'Workflow publication',
             'department': 'Workflow', 'color': 'Selected', 'status': 'Active', 'badge': 'Workflow published',
             'stock': sum(v['inventory'] for v in p.payload['variants']),
             'sizeStock': {v['size']: v['inventory'] for v in p.payload['variants']},
             'variants': [{k: v[k] for k in ('sku', 'size', 'price', 'inventory')} for v in p.payload['variants']],
             'publicationDigest': p.digest} for p in products]})

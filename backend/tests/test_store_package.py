import hashlib
from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient
from apps.identity.bootstrap import example_brief
from apps.identity.models import Team, Membership
from apps.teststore.models import ApiClient as StoreClient, PublishedProduct
from apps.common.utils import digest
from contracts.store_api import package_contract
from uuid import uuid4


class StorePackageTests(TestCase):
    def setUp(self):
        self.api = APIClient()
        self.store = StoreClient.objects.create(name='sandbox', storefront_id=uuid4(),
            token_hash=hashlib.sha256(b'package-test-token').hexdigest())
        self.api.credentials(HTTP_AUTHORIZATION='Bearer package-test-token')
        brief = example_brief()
        self.listing = {k: v for k, v in brief.items() if k not in (
            'schema_version', 'selling_points', 'source_kind', 'evidence_ref', 'source_note')}
        self.listing.update(schema_version='ListingDraft@1', bullets=brief['selling_points'])
        self.key = digest({'run': 'store-package-test'})

    def call(self, action, data):
        return self.api.post('/api/test-store/v1/actions/' + action, data, format='json')

    def test_closed_dispatch_and_authentication(self):
        self.assertEqual(self.call('refund.execute', {}).status_code, 501)
        self.assertEqual(self.call('listing.publish', {}).status_code, 400)
        self.assertEqual(self.call('listing.validate', {'listing': self.listing, 'approved': True}).status_code, 400)
        self.api.credentials()
        self.assertEqual(self.call('listing.validate', {'listing': self.listing}).status_code, 401)
        self.assertEqual(self.api.get('/api/test-store/v1/contracts').status_code, 401)

    def test_real_actions_idempotency_query_and_isolation(self):
        checked = self.call('listing.validate', {'listing': self.listing})
        self.assertEqual(checked.status_code, 200)
        payload = {'operation_key': self.key, 'listing': self.listing}
        self.assertEqual(self.call('publication.lookup', {'operation_key': self.key}).status_code, 404)
        published = self.call('listing.publish', payload)
        self.assertEqual(published.status_code, 201, published.data)
        self.assertEqual(self.call('listing.publish', payload).status_code, 200)
        self.assertEqual(PublishedProduct.objects.count(), 1)
        result = self.call('publication.lookup', {'operation_key': self.key})
        self.assertEqual(result.data, published.data)
        evidence = self.call('listing.wait', {'external_id': published.data['external_id']})
        self.assertEqual(evidence.status_code, 200)
        self.assertEqual(evidence.data['digest'], checked.data['digest'])
        changed = {**payload, 'listing': {**self.listing, 'title': 'Changed'}}
        self.assertEqual(self.call('listing.publish', changed).status_code, 409)
        self.assertEqual(self.call('listing.publish', {**payload, 'operation_key': 'b'*64}).status_code, 409)
        StoreClient.objects.create(name='other', storefront_id=uuid4(), token_hash=hashlib.sha256(b'other').hexdigest())
        self.api.credentials(HTTP_AUTHORIZATION='Bearer other')
        self.assertEqual(self.call('publication.lookup', {'operation_key': self.key}).status_code, 404)
        self.assertEqual(self.call('listing.wait', {'external_id': published.data['external_id']}).status_code, 404)

    def test_contract_matches_implemented_package(self):
        response = self.api.get('/api/test-store/v1/contracts')
        self.assertEqual(response.data, package_contract())
        self.assertEqual(len(response.data['actions']), 15)
        descriptors=response.data['design_manifests']
        self.assertEqual(len(descriptors),3)
        self.assertTrue(all(d['parameterSchema']=={} for d in descriptors))
        self.assertTrue(all(d['channels']==['test-store'] for d in descriptors))
        self.assertEqual(next(d for d in descriptors if d['id'].endswith('listing.publish'))['input'],'PreparedChannelPublication@1')
        self.assertEqual(next(a for a in response.data['actions'] if a['action']=='listing.publish')['inputSchema']['properties']['listing']['$ref'],'#/$defs/Listing')
        self.assertIn('supplier.pay', response.data['unsupported'])
        self.assertTrue(response.data['extensions'])
        self.api.credentials()
        self.assertIn(self.api.get('/api/v1/integration-packages').status_code, [401, 403])
        user = User.objects.create_user('package-owner')
        team = Team.objects.create(name='package-tests')
        Membership.objects.create(user=user, team=team, role='admin')
        self.api.force_authenticate(user=user)
        result = self.api.get('/api/v1/integration-packages')
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.data['packages'][0], response.data)

from datetime import timedelta
from unittest.mock import patch

import httpx
from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.audit.models import AuditRecord
from apps.connections.cj import BASE, save_key
from apps.connections.models import SupplierConnection
from apps.identity.models import Team, Membership


class CJConnectionTests(TestCase):
    @patch('apps.connections.cj.pooled_request')
    def test_retry_classification_and_redaction(self, request):
        from apps.connections.cj import cj_request, CJTemporary, CJUnavailable
        for response in [httpx.Response(429,json={'code':1600200}),httpx.Response(503)]:
            request.return_value=response
            with self.assertRaises(CJTemporary):cj_request('GET','/product/listV2')
        request.return_value=httpx.Response(429,json={'code':16900500,'message':'private points details'})
        with self.assertRaises(CJUnavailable) as caught:cj_request('GET','/product/listV2')
        self.assertNotIsInstance(caught.exception,CJTemporary)
        self.assertNotIn('private',str(caught.exception))

    def setUp(self):
        self.user = User.objects.create_user('cj-admin')
        self.team = Team.objects.create(name='CJ team')
        self.member = Membership.objects.create(team=self.team, user=self.user, role='admin')
        self.api = APIClient()
        self.api.force_authenticate(self.user)
        self.key = 'CJ-test@api@not-a-real-credential-12345'

    def save(self, version=0, key=None):
        return self.api.put('/api/v1/connections/cj', {'api_key': key or self.key, 'expected_version': version}, format='json')

    def token(self):
        return httpx.Response(200, json={'code': 200, 'result': True, 'data': {
            'accessToken': 'private-test-token', 'accessTokenExpiryDate': (timezone.now() + timedelta(days=1)).isoformat(),
            'refreshToken': 'not-exposed'}})

    def products(self):
        return httpx.Response(200, json={'code': 200, 'result': True, 'data': {'content': [{'productList': [
            {'id': 'real-response-id', 'nameEn': 'Sample', 'sellPrice': '8.90', 'listedNum': 5,
             'warehouseInventoryNum': 0, 'accessToken': 'must-never-be-forwarded'}]}]}})

    def test_encrypted_save_and_no_secret_in_get_or_audit(self):
        self.assertEqual(self.save().status_code, 200)
        connection = SupplierConnection.objects.get()
        self.assertNotIn(self.key, connection.credential_ciphertext)
        body = self.api.get('/api/v1/connections/cj').content.decode()
        self.assertNotIn(self.key, body)
        self.assertNotIn('ciphertext', body)
        self.assertNotIn(self.key, str(list(AuditRecord.objects.values())))
        self.assertEqual(self.save().status_code, 409)

    def test_permissions_team_isolation_and_invalid_account_number(self):
        self.assertEqual(self.save(key='CJ0000000').status_code, 400)
        self.member.role = 'operator'
        self.member.save()
        self.assertEqual(self.save().status_code, 403)
        self.assertEqual(self.api.post('/api/v1/connections/cj/verify').status_code, 403)
        other = Team.objects.create(name='Other')
        SupplierConnection.objects.create(team=other, credential_ciphertext='unrelated')
        self.assertFalse(self.api.get('/api/v1/connections/cj').json()['configured'])
        self.api.force_authenticate(None)
        self.assertEqual(self.api.get('/api/v1/connections/cj').status_code, 403)

    @patch('apps.connections.cj.time.sleep')
    @patch('apps.connections.cj.pooled_request')
    def test_verify_uses_only_official_read_endpoints_and_caches_token(self, request, sleep):
        self.save()
        request.side_effect = [self.token(), self.products()]
        response = self.api.post('/api/v1/connections/cj/verify')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['status'], 'verified')
        self.assertEqual(response.json()['sample_products'][0]['warehouseInventoryNum'], 0)
        self.assertIsNone(response.json()['sample_products'][0]['totalVerifiedInventory'])
        self.assertNotIn('private-test-token', response.content.decode())
        self.assertNotIn('must-never-be-forwarded', response.content.decode())
        calls = request.call_args_list
        self.assertEqual(calls[0].args, ('POST', BASE + '/authentication/getAccessToken'))
        self.assertEqual(calls[1].args, ('GET', BASE + '/product/listV2'))
        self.assertEqual(calls[1].kwargs['params'], {'page': 1, 'size': 3})
        self.assertFalse(calls[0].kwargs['follow_redirects'])
        self.assertEqual(self.api.post('/api/v1/connections/cj/verify').status_code, 409)
        SupplierConnection.objects.update(verification_until=timezone.now() - timedelta(seconds=1))
        request.reset_mock()
        request.side_effect = [self.products()]
        self.assertEqual(self.api.post('/api/v1/connections/cj/verify').status_code, 200)
        self.assertEqual(request.call_count, 1)
        self.assertEqual(request.call_args.args[0], 'GET')

    @patch('apps.connections.cj.pooled_request')
    def test_upstream_failure_is_redacted_and_not_verified(self, request):
        self.save()
        request.return_value = httpx.Response(200, json={'code': 1600001, 'result': False, 'message': self.key})
        response = self.api.post('/api/v1/connections/cj/verify')
        self.assertEqual(response.status_code, 502)
        self.assertNotIn(self.key, response.content.decode())
        connection = SupplierConnection.objects.get()
        self.assertEqual(connection.status, 'error')
        self.assertIsNone(connection.verified_at)

    @patch('apps.connections.cj.time.sleep')
    @patch('apps.connections.cj.pooled_request')
    def test_key_rotation_discards_inflight_old_result(self, request, sleep):
        self.save()
        def upstream(method, url, **kwargs):
            if method == 'POST':
                return self.token()
            save_key(self.member, 'CJ-new@api@another-test-credential', 1)
            return self.products()
        request.side_effect = upstream
        self.assertEqual(self.api.post('/api/v1/connections/cj/verify').status_code, 409)
        connection = SupplierConnection.objects.get()
        self.assertEqual(connection.configuration_version, 2)
        self.assertEqual(connection.status, 'saved')
        self.assertFalse(connection.token_ciphertext)
        self.assertEqual(connection.sample_products, [])

    @patch('apps.connections.cj.pooled_request')
    def test_network_failure_and_malformed_token_fail_safely(self, request):
        self.save()
        request.side_effect = httpx.ConnectError('error with sensitive transport context')
        response = self.api.post('/api/v1/connections/cj/verify')
        self.assertEqual(response.status_code, 502)
        self.assertNotIn('sensitive', response.content.decode())
        SupplierConnection.objects.update(verification_until=timezone.now() - timedelta(seconds=1))
        request.side_effect = None
        request.return_value = httpx.Response(200, json={'code': 200, 'result': True, 'data': {'accessToken': 'invalid'}})
        self.assertEqual(self.api.post('/api/v1/connections/cj/verify').status_code, 502)

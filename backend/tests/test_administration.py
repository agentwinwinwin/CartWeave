from unittest.mock import patch
from django.test import TestCase
from django.contrib.auth.models import User
from rest_framework.test import APIClient
from apps.identity.models import Team, Membership
from apps.skills.models import SkillVersion
from apps.connections.models import Store
from apps.teststore.models import ApiClient as ShopClient

class AdministrationTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user('admin-unit', password='admin-unit-password')
        self.team = Team.objects.create(name='internal')
        self.member = Membership.objects.create(team=self.team, user=self.user, role='admin')
        self.api = APIClient()
        self.api.force_authenticate(user=self.user)

    def test_registration_is_pending_and_rejects_uploaded_entrypoints(self):
        data = {'key': 'content.editorial', 'version': '2.0.0', 'handler': 'content.editorial.v1'}
        response = self.api.post('/api/v1/skills', data, format='json')
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()['status'], 'pending')
        self.assertEqual(self.api.post('/api/v1/skills', data, format='json').status_code, 409)
        data.update(version='3.0.0', handler='shell://uploaded-code')
        self.assertEqual(self.api.post('/api/v1/skills', data, format='json').status_code, 400)
        pk = response.json()['id']
        self.assertEqual(self.api.post(f'/api/v1/skills/{pk}/review', {'status': 'approved', 'reason': 'Reviewed closed formatter'}, format='json').status_code, 200)
        self.assertEqual(SkillVersion.objects.get(pk=pk).status, 'approved')

    def test_store_provision_does_not_leak_credentials_or_grant_verification(self):
        response = self.api.post('/api/v1/stores', {'name': 'test shop'}, format='json')
        self.assertEqual(response.status_code, 201)
        self.assertFalse(response.json()['verified'])
        self.assertEqual(ShopClient.objects.count(), 1)
        store = Store.objects.get()
        self.assertNotIn(store.credential_ciphertext, str(self.api.get('/api/v1/stores').json()))
        capabilities = {'storefront_id': str(store.id), 'adapter': 'test-store.v1', 'actions': ['listing.validate', 'listing.publish', 'listing.wait'], 'idempotent_publish': True}
        with patch('apps.integrations.test_store.TestStoreAdapter.call', return_value=capabilities):
            self.assertEqual(self.api.post(f'/api/v1/stores/{store.id}/verify', {}, format='json').status_code, 200)
        store.refresh_from_db()
        self.assertTrue(store.verified)

    def test_registered_picker_metadata_checks_review_hash_and_version_identity(self):
        pk = self.api.post('/api/v1/skills', {'key': 'content.editorial', 'version': '9.0.0', 'handler': 'content.editorial.v1'}, format='json').json()['id']
        row = self.api.get('/api/v1/skills').json()[0]
        self.assertFalse(row['selectable'])
        self.assertEqual(row['manifest']['id'], f'registered.{pk}')
        self.assertEqual(row['manifest']['input'], 'ApprovedProductBrief@2')
        self.assertEqual(row['manifest']['parameterSchema'], {})
        self.api.post(f'/api/v1/skills/{pk}/review', {'status': 'approved', 'reason': 'Reviewed'}, format='json')
        self.assertTrue(self.api.get('/api/v1/skills').json()[0]['selectable'])
        with patch('apps.skills.handlers.handler_hash', return_value='changed'):
            row = self.api.get('/api/v1/skills').json()[0]
            self.assertFalse(row['selectable'])
            self.assertEqual(row['unavailable_reason'], '审核或代码摘要已失效')
        self.api.post(f'/api/v1/skills/{pk}/review', {'status': 'revoked', 'reason': 'Stopped'}, format='json')
        self.assertFalse(self.api.get('/api/v1/skills').json()[0]['selectable'])

    def test_verification_rejects_wrong_identity(self):
        pk = self.api.post('/api/v1/stores', {'name': 'shop'}, format='json').json()['id']
        with patch('apps.integrations.test_store.TestStoreAdapter.call', return_value={'storefront_id': 'wrong'}):
            self.assertEqual(self.api.post(f'/api/v1/stores/{pk}/verify', {}, format='json').status_code, 422)
        self.assertFalse(Store.objects.get(pk=pk).verified)

    def test_members_and_last_admin_protection(self):
        data = {'username': 'new-operator', 'password': 'Long-unique-team-test-123!', 'role': 'operator'}
        result = self.api.post('/api/v1/members', data, format='json')
        self.assertEqual(result.status_code, 201)
        self.assertNotIn('password', result.json())
        self.assertEqual(self.api.patch(f'/api/v1/members/{self.member.id}', {'role': 'viewer', 'active': False}, format='json').status_code, 422)
        self.assertEqual(self.api.patch(f'/api/v1/members/{result.json()["id"]}', {'role': 'viewer', 'active': False}, format='json').status_code, 200)

    def test_invalid_team_and_malformed_documents_fail_cleanly(self):
        self.api.credentials(HTTP_X_TEAM_ID='not-a-uuid')
        self.assertEqual(self.api.get('/api/v1/stores').status_code, 403)
        self.api.credentials()
        response = self.api.post('/api/v1/workflows', {'document': 42, 'skill_id': 'bad'}, format='json')
        self.assertEqual(response.status_code, 400)

    def test_operator_cannot_register_or_review_skills(self):
        self.member.role = 'operator'
        self.member.save()
        self.assertEqual(self.api.post('/api/v1/skills', {}, format='json').status_code, 403)
        self.assertEqual(self.api.post('/api/v1/stores', {}, format='json').status_code, 403)

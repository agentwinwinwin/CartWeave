from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from apps.identity.models import Team, Membership
from apps.identity.desktop import desktop_token


@override_settings(LOCAL=True, DESKTOP_MODE=True, DESKTOP_OWNER='desktop-owner')
class DesktopTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user('desktop-owner')
        self.team = Team.objects.create(name='Personal')
        self.member = Membership.objects.create(user=self.user, team=self.team, role='admin')
        self.api = APIClient()

    def trusted(self, **extra):
        return {'HTTP_X_COMMERCE_DESKTOP': desktop_token(), **extra}

    def test_personal_session_needs_no_login_and_retains_workspace(self):
        result = self.api.get('/api/v1/auth/session', **self.trusted())
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()['mode'], 'desktop')
        self.assertTrue(result.json()['authenticated'])
        self.assertEqual(result.json()['user']['team_id'], str(self.team.pk))
        self.assertEqual(self.api.get('/api/v1/connections/cj', **self.trusted()).status_code, 200)

    def test_missing_invalid_and_remote_transport_rejected(self):
        for kwargs in ({}, {'HTTP_X_COMMERCE_DESKTOP': 'invalid'},
                       self.trusted(REMOTE_ADDR='192.168.1.5')):
            self.assertEqual(self.api.get('/api/v1/connections/cj', **kwargs).status_code, 403)

    def test_cannot_adopt_disabled_or_ambiguous_identity(self):
        self.user.is_active = False
        self.user.save()
        self.assertEqual(self.api.get('/api/v1/auth/session', **self.trusted()).status_code, 403)
        self.user.is_active = True
        self.user.save()
        Membership.objects.create(user=self.user, team=Team.objects.create(name='Another'), role='admin')
        self.assertEqual(self.api.get('/api/v1/auth/session', **self.trusted()).status_code, 403)

    @override_settings(DESKTOP_MODE=False)
    def test_normal_deployment_does_not_accept_desktop_transport(self):
        self.assertEqual(self.api.get('/api/v1/connections/cj', **self.trusted()).status_code, 403)
        self.assertFalse(self.api.get('/api/v1/auth/session', **self.trusted()).json()['authenticated'])

    def test_key_save_is_available_without_login_and_still_validated(self):
        response = self.api.put('/api/v1/connections/cj', {
            'api_key': 'not-a-key', 'expected_version': 0,
        }, format='json', **self.trusted())
        self.assertEqual(response.status_code, 400)
        self.assertNotIn('not-a-key', str(response.json()))

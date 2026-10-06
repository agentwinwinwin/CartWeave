import copy
import hashlib
from datetime import timedelta
from unittest.mock import patch
from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework.exceptions import APIException
from apps.common.errors import Conflict, RuleError
from apps.common.utils import digest, parse
from apps.identity.models import Team, Membership
from apps.identity.bootstrap import example_brief
from apps.connections.models import Store
from apps.connections.services import encrypt
from apps.skills.models import SkillVersion
from apps.skills.handlers import handler_hash
from apps.registry.definitions import template, validate_document
from apps.workflows.models import WorkflowDraft, WorkflowVersion
from apps.workflows.services import freeze, update_draft
from apps.runtime.models import WorkflowRun, Outbox, RunEvent
from apps.runtime.services import start_run, due_jobs, process_job, decide, revise, resume
from apps.teststore.models import ApiClient as StoreClient, PublishedProduct
from apps.integrations.test_store import UnknownResult

class TestAdapter:
    """Runs the actual DRF storefront endpoint, not a made-up publication response."""
    def __init__(self, store):
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION='Bearer test-adapter-token')
    def call(self, method, path, data=None, allow_missing=False):
        response = getattr(self.client, method.lower())('/api/test-store/v1' + path, data=data, format='json')
        if allow_missing and response.status_code == 404:
            return None
        if response.status_code >= 400:
            raise RuleError('Store rejected operation')
        return response.json()
    def validate(self, listing):
        return self.call('POST', '/validate', {'listing': listing})
    def lookup(self, key):
        return self.call('GET', '/operations/' + key, allow_missing=True)
    def publish(self, operation):
        return self.call('POST', '/products', {'operation_key': operation.key, 'listing': operation.payload})
    def verify(self, external_id, listing_digest):
        result = self.call('GET', '/products/' + external_id)
        if result['digest'] != listing_digest or result['status'] != 'active':
            raise UnknownResult()
        return result
    def listing_status(self, external_id):
        return self.call('POST','/actions/listing.status',{'external_id':external_id})
    def unpublish(self, command):
        return self.call('POST','/actions/listing.unpublish',command)

class PublicationTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user('operator-test', password='test-password-unique')
        self.team = Team.objects.create(name='test')
        self.member = Membership.objects.create(user=self.user, team=self.team, role='admin')
        self.skill = SkillVersion.objects.create(team=self.team, key='content.editorial', version='1', handler='content.editorial.v1',
            artifact_hash=handler_hash('content.editorial.v1'), status='approved', reviewed_by=self.user, reviewed_at=timezone.now(), review_note='Reviewed fixture')
        self.store = Store.objects.create(team=self.team, name='test', verified=True,
            capabilities=['listing.validate', 'listing.publish', 'listing.wait'], credential_ciphertext=encrypt('test-adapter-token'))
        StoreClient.objects.create(name='fixture', storefront_id=self.store.id, token_hash=hashlib.sha256(b'test-adapter-token').hexdigest())
        self.draft = WorkflowDraft.objects.create(team=self.team, title='test', document=template(self.skill), skill=self.skill)
        self.version = freeze(self.draft, 1)
        self.brief = example_brief()
        self.api = APIClient()
        self.api.force_authenticate(user=self.user)
        self.adapter_patch = patch.dict('apps.integrations.registry.ADAPTERS', {'test-store.v1': TestAdapter})
        self.adapter_patch.start()
        self.addCleanup(self.adapter_patch.stop)

    def start(self, key='test-start-1'):
        return start_run(self.version, self.store, self.user, self.brief, key)[0]

    def test_stop_queued_run_prevents_worker_and_preserves_record(self):
        from apps.runtime.services import cancel
        run=self.start();cancel(run,self.user,run.revision);self.drain();run.refresh_from_db()
        self.assertEqual(run.status,'cancelled');self.assertEqual(run.approvals.count(),0)
        self.assertEqual(PublishedProduct.objects.count(),0)
        self.assertTrue(WorkflowRun.objects.filter(pk=run.pk).exists())

    def test_running_stop_waits_for_current_result_without_next_node(self):
        from apps.runtime.services import cancel
        run=self.start();self.drain();self.approve(run)
        def inflight(current):
            requested=cancel(current,self.user,current.revision)
            self.assertEqual(requested.status,'running')
            self.assertTrue(requested.context['stop_requested'])
            return {'inflight_test_result':'retained'}
        with patch('apps.runtime.services.perform',side_effect=inflight):self.drain()
        run.refresh_from_db();self.assertEqual(run.status,'cancelled')
        self.assertEqual(run.context['inflight_test_result'],'retained')
        self.assertEqual(run.cursor,1);self.assertEqual(list(due_jobs()),[])
        self.assertEqual(PublishedProduct.objects.count(),0)

    def test_stop_during_publish_retains_remote_receipt_without_undo(self):
        from apps.runtime.services import cancel
        from apps.listings.models import ExternalOperation
        run=self.final_wait();self.approve(run);original=TestAdapter.publish
        def inflight(adapter,operation):
            result=original(adapter,operation)
            current=WorkflowRun.objects.get(pk=run.pk)
            cancel(current,self.user,current.revision)
            return result
        with patch.object(TestAdapter,'publish',inflight):self.drain()
        run.refresh_from_db();self.assertEqual(run.status,'cancelled')
        self.assertIn('receipt',run.context)
        self.assertEqual(PublishedProduct.objects.count(),1)
        self.assertTrue(ExternalOperation.objects.filter(run=run,status='succeeded').exists())
        self.assertEqual(list(due_jobs()),[])

    def set_reviews(self, brief=True, listing=True):
        document = copy.deepcopy(self.version.document)
        document['nodes'][0]['binding']['parameters'] = {'approvalEnabled': brief}
        document['nodes'][3]['binding']['parameters'] = {'approvalEnabled': listing}
        updated = update_draft(self.draft, document, self.draft.revision)
        self.version = freeze(updated, updated.revision)

    @override_settings(LOCAL=True, DESKTOP_MODE=True)
    def test_both_reviews_off_publish_with_explicit_waiver_evidence(self):
        from apps.runtime.services import require_approval
        self.set_reviews(False, False)
        run = self.start()
        self.drain()
        run.refresh_from_db()
        self.assertEqual(run.status, 'succeeded')
        self.assertEqual(run.approvals.count(), 0)
        self.assertEqual(set(run.context['reviewWaivers']), {'brief', 'listing'})
        self.assertEqual(run.events.filter(payload__reviewMode='skipped').count(), 2)
        require_approval(run, 'listing')
        run.context['listing']['title'] = 'changed after policy check'
        with self.assertRaises(RuleError):
            require_approval(run, 'listing')

    @override_settings(LOCAL=True, DESKTOP_MODE=True)
    def test_only_first_review_off_still_waits_for_final_review(self):
        self.set_reviews(False, True)
        run = self.start()
        self.drain()
        run.refresh_from_db()
        self.assertEqual(run.status, 'waiting_approval')
        self.assertEqual(run.approvals.get().stage, 'listing')
        self.approve(run)
        self.drain()
        run.refresh_from_db()
        self.assertEqual(run.status, 'succeeded')

    @override_settings(LOCAL=True, DESKTOP_MODE=False)
    def test_team_mode_cannot_disable_review(self):
        with self.assertRaises(RuleError):
            self.set_reviews(False, True)

    @override_settings(LOCAL=True, DESKTOP_MODE=True)
    def test_review_switch_rejects_non_boolean_and_preserves_existing_run(self):
        run = self.start()
        self.drain()
        with self.assertRaises(RuleError):
            self.set_reviews('false', True)
        self.set_reviews(False, False)
        run.refresh_from_db()
        self.assertEqual(run.status, 'waiting_approval')
        self.assertEqual(run.version_id, self.draft.versions.order_by('revision').first().id)
    def drain(self):
        for _ in range(20):
            jobs = list(due_jobs())
            if not jobs:
                break
            for job in jobs:
                process_job(job)
    def approve(self, run):
        run.refresh_from_db()
        approval = run.approvals.get(status='pending')
        return decide(approval, self.user, 'approve', 'reviewed test evidence', run.revision)
    def final_wait(self):
        run = self.start()
        self.drain()
        self.approve(run)
        self.drain()
        run.refresh_from_db()
        return run

    def test_complete_two_approval_publication_and_public_catalog(self):
        run = self.start()
        self.drain()
        run.refresh_from_db()
        self.assertEqual(run.status, 'waiting_approval')
        self.assertEqual(PublishedProduct.objects.count(), 0)
        self.approve(run)
        self.drain()
        run.refresh_from_db()
        self.assertEqual(run.status, 'waiting_approval')
        self.assertEqual(run.cursor, 3)
        self.assertEqual(PublishedProduct.objects.count(), 0)
        self.approve(run)
        self.drain()
        run.refresh_from_db()
        self.assertEqual(run.status, 'succeeded')
        self.assertEqual(run.approvals.filter(status='approved').count(), 2)
        self.assertEqual(run.attempts.filter(status='completed').count(), 7)
        self.assertEqual(PublishedProduct.objects.count(), 1)
        catalog = APIClient().get(f'/api/test-store/v1/catalog/{self.store.id}').json()
        self.assertEqual(catalog['products'][0]['name'], self.brief['title'])
        self.assertEqual(catalog['products'][0]['variants'], [{k: v[k] for k in ('sku', 'size', 'price', 'inventory')} for v in self.brief['variants']])
        self.assertNotIn('cj_vid', str(catalog))
        sequences = list(run.events.order_by('sequence').values_list('sequence', flat=True))
        self.assertEqual(sequences, list(range(1, len(sequences) + 1)))
        transfers = [e.payload['edgeId'] for e in run.events.order_by('sequence') if e.payload['status'] == 'transferring']
        self.assertEqual(transfers, [edge['id'] for edge in run.version.document['edges']])

    def test_duplicate_start_and_conflicting_payload(self):
        run = self.start()
        self.assertEqual(self.start().id, run.id)
        self.assertEqual(Outbox.objects.count(), 1)
        self.brief['title'] += ' changed'
        with self.assertRaises(Conflict):
            self.start()

    def test_graph_cannot_skip_approval_or_replace_core(self):
        document = copy.deepcopy(self.draft.document)
        document['nodes'].pop(3)
        with self.assertRaises(APIException):
            validate_document(document, self.skill)
        document = copy.deepcopy(self.draft.document)
        document['nodes'][4]['binding']['skillId'] = 'uploaded.publish'
        with self.assertRaises(RuleError):
            validate_document(document, self.skill)

    def test_unreviewed_revoked_and_changed_hash_fail_closed(self):
        for status in ('pending', 'revoked'):
            self.skill.status = status
            self.skill.save()
            with self.assertRaises(RuleError):
                self.start()
        self.skill.status = 'approved'
        self.skill.save()
        SkillVersion.objects.filter(pk=self.skill.pk).update(artifact_hash='0' * 64)
        self.version.refresh_from_db()
        with self.assertRaises(RuleError):
            self.start()

    def test_expired_and_wrong_revision_approval_rejected(self):
        run = self.start()
        self.drain()
        request = run.approvals.get()
        with self.assertRaises(Conflict):
            decide(request, self.user, 'approve', 'reason', 999)
        request.expires_at = timezone.now() - timedelta(seconds=1)
        request.save()
        with self.assertRaises(Conflict):
            self.approve(run)

    def test_revise_invalidates_old_final_approval_and_preserves_brief(self):
        run = self.final_wait()
        old = run.approvals.get(stage='listing')
        listing = copy.deepcopy(run.context['listing'])
        listing['title'] = 'Revised test title'
        run = revise(run, self.user, 'listing', listing, run.revision, 'Improve title')
        old.refresh_from_db()
        self.assertEqual(old.status, 'superseded')
        with self.assertRaises(Conflict):
            decide(old, self.user, 'approve', 'old', run.revision)
        self.drain()
        run.refresh_from_db()
        self.assertEqual(run.status, 'waiting_approval')
        self.assertEqual(run.approvals.filter(stage='brief', status='approved').count(), 1)
        self.approve(run)
        self.drain()
        run.refresh_from_db()
        self.assertEqual(run.status, 'succeeded')
        self.assertEqual(PublishedProduct.objects.get().payload['title'], listing['title'])

    def test_content_cannot_change_price_or_supplier_variant(self):
        run = self.final_wait()
        listing = copy.deepcopy(run.context['listing'])
        listing['variants'][0]['price'] = '0.01'
        with self.assertRaises(RuleError):
            revise(run, self.user, 'listing', listing, run.revision, 'change price')

    def test_double_decision_and_duplicate_job_are_safe(self):
        run = self.start()
        self.drain()
        request = run.approvals.get()
        run = self.approve(run)
        decide(request, self.user, 'approve', 'reviewed test evidence', 1)
        with self.assertRaises(Conflict):
            decide(request, self.user, 'reject', 'no', run.revision)
        self.drain()
        self.approve(run)
        self.drain()
        for job in Outbox.objects.all():
            self.assertFalse(process_job(job.id))
        self.assertEqual(PublishedProduct.objects.count(), 1)

    def test_timeout_after_remote_commit_reconciles_without_duplicate(self):
        run = self.final_wait()
        self.approve(run)
        original = TestAdapter.publish
        def ambiguous(adapter, operation):
            original(adapter, operation)
            raise UnknownResult('response lost')
        with patch.object(TestAdapter, 'publish', ambiguous):
            self.drain()
        run.refresh_from_db()
        self.assertEqual(run.status, 'waiting_event')
        self.assertEqual(PublishedProduct.objects.count(), 1)
        Outbox.objects.filter(status='pending').update(available_at=timezone.now())
        self.drain()
        run.refresh_from_db()
        self.assertEqual(run.status, 'succeeded')
        self.assertEqual(PublishedProduct.objects.count(), 1)

    def test_worker_recovers_expired_lease(self):
        run = self.start()
        job = Outbox.objects.get(run=run)
        job.status, job.lease_until = 'claimed', timezone.now() - timedelta(seconds=1)
        job.save()
        run.status = 'running'
        run.save()
        self.drain()
        run.refresh_from_db()
        self.assertEqual(run.status, 'waiting_approval')

    def test_connection_change_or_revocation_blocks_publication(self):
        run = self.final_wait()
        self.approve(run)
        self.store.configuration_version += 1
        self.store.save()
        self.drain()
        run.refresh_from_db()
        self.assertEqual(run.status, 'needs_attention')
        self.assertEqual(PublishedProduct.objects.count(), 0)

    def test_permissions_and_cross_team_isolation(self):
        run = self.start()
        other = User.objects.create_user('other-user', password='other-test-password')
        team = Team.objects.create(name='other')
        Membership.objects.create(team=team, user=other, role='admin')
        self.api.force_authenticate(user=other)
        self.assertEqual(self.api.get(f'/api/v1/runs/{run.id}').status_code, 404)
        self.api.force_authenticate(user=self.user)
        self.member.role = 'viewer'
        self.member.save()
        self.assertEqual(self.api.post('/api/v1/runs', {}).status_code, 403)
        self.drain()
        run.refresh_from_db()
        self.assertEqual(run.status, 'needs_attention')

    def test_unverified_store_rejected(self):
        self.store.verified = False
        self.store.save()
        with self.assertRaises(RuleError):
            self.start()

    def test_auth_csrf_and_no_anonymous_mutations(self):
        client = APIClient(enforce_csrf_checks=True)
        self.assertEqual(client.get('/api/v1/runs').status_code, 403)
        self.assertEqual(client.post('/api/v1/auth/login', {'username': self.user.username, 'password': 'test-password-unique'}).status_code, 403)
        session = client.get('/api/v1/auth/session').json()
        client.credentials(HTTP_X_CSRFTOKEN=session['csrf_token'])
        result = client.post('/api/v1/auth/login', {'username': self.user.username, 'password': 'test-password-unique'}, format='json')
        self.assertEqual(result.status_code, 200)
        client.credentials()
        self.assertEqual(client.post('/api/v1/auth/logout').status_code, 403)
        self.assertEqual(APIClient().post('/api/test-store/v1/products', {}).status_code, 401)

    def test_versions_and_price_validation(self):
        with self.assertRaises(ValueError):
            self.version.save()
        with self.assertRaises(Conflict):
            update_draft(self.draft, self.draft.document, 999)
        from contracts.listings import Brief
        invalid = copy.deepcopy(self.brief)
        invalid['variants'][0]['price'] = 'NaN'
        with self.assertRaises(APIException):
            parse(Brief, invalid)
        invalid = copy.deepcopy(self.brief)
        invalid['images'] = ['http://127.0.0.1/internal']
        with self.assertRaises(APIException):
            parse(Brief, invalid)

    def test_teststore_idempotency_and_no_implicit_overwrite(self):
        from apps.skills.handlers import editorial_copy
        listing = editorial_copy(self.brief, {})
        adapter = TestAdapter(self.store)
        data = {'operation_key': '1' * 64, 'listing': listing}
        first = adapter.client.post('/api/test-store/v1/products', data, format='json')
        duplicate = adapter.client.post('/api/test-store/v1/products', data, format='json')
        self.assertEqual(first.json()['external_id'], duplicate.json()['external_id'])
        data['listing']['title'] = 'Different'
        self.assertEqual(adapter.client.post('/api/test-store/v1/products', data, format='json').status_code, 409)
        data['operation_key'] = '2' * 64
        self.assertEqual(adapter.client.post('/api/test-store/v1/products', data, format='json').status_code, 409)

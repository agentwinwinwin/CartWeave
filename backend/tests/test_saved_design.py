import copy
from django.test import TestCase
from . import test_publication as fixtures
from apps.workflows.models import DesignRelease, WorkflowVersion


class SavedDesignTests(TestCase):
    setUp = fixtures.PublicationTests.setUp

    def save_design(self, document=None, expected=0):
        document = copy.deepcopy(document or self.version.document)
        document['environment']['storeRef'] = str(self.store.id)
        return self.api.post('/api/v1/workflow-designs', {'document':document, 'expected_revision':expected}, format='json')

    def test_saved_restored_frozen_and_edit_does_not_change_release(self):
        saved = self.save_design()
        self.assertEqual(saved.status_code, 200, saved.data)
        row = saved.data
        release = self.api.post(f"/api/v1/workflow-designs/{row['id']}/freeze", {'expected_revision':1}, format='json')
        self.assertEqual(release.status_code, 201, release.data)
        snapshot = copy.deepcopy(release.data)
        edited = copy.deepcopy(row['document'])
        edited['title'] = 'Changed settings'
        edited['nodes'][0]['binding']['parameters']['approvalEnabled'] = True
        self.assertEqual(self.save_design(edited, 1).status_code, 200)
        self.assertEqual(self.api.get('/api/v1/workflow-designs').data[0]['document']['title'], 'Changed settings')
        old = self.api.get(f"/api/v1/workflow-releases/{snapshot['id']}")
        self.assertEqual(old.data, snapshot)
        version = WorkflowVersion.objects.get(pk=snapshot['version_id'])
        self.assertEqual(version.document['title'], row['document']['title'])
        response = self.api.post('/api/v1/runs', {'version_id':snapshot['version_id'], 'store_id':str(self.store.id), 'brief':self.brief, 'idempotency_key':'saved-design-run'}, format='json')
        self.assertEqual(response.status_code, 202, response.data)
        self.store.configuration_version += 1
        self.store.save(update_fields=['configuration_version'])
        response = self.api.post('/api/v1/runs', {'version_id':snapshot['version_id'], 'store_id':str(self.store.id), 'brief':self.brief, 'idempotency_key':'stale-design-run'}, format='json')
        self.assertEqual(response.status_code, 409)

    def test_conflicts_and_unsupported_graph_fail_closed(self):
        row = self.save_design().data
        self.assertEqual(self.save_design(expected=0).status_code, 409)
        changed = copy.deepcopy(row['document'])
        changed['nodes'].insert(0, {'id':'start', 'definitionId':'product.start'})
        self.assertEqual(self.save_design(changed, 1).status_code, 200)
        response = self.api.post(f"/api/v1/workflow-designs/{row['id']}/freeze", {'expected_revision':2}, format='json')
        self.assertEqual(response.status_code, 422)
        self.assertEqual(DesignRelease.objects.count(), 0)
        secret = copy.deepcopy(changed)
        secret['apiKey'] = 'do-not-save'
        self.assertEqual(self.save_design(secret, 2).status_code, 400)

    def test_no_silent_skill_substitution(self):
        doc = copy.deepcopy(self.version.document)
        doc['nodes'][1]['binding']['skillVersion'] = '999'
        row = self.save_design(doc).data
        response = self.api.post(f"/api/v1/workflow-designs/{row['id']}/freeze", {'expected_revision':1}, format='json')
        self.assertEqual(response.status_code, 422)

    def test_independent_business_freeze_explains_actual_entry_without_creating_release(self):
        for template, definitions, button in [
            ('optimize', ['insight.start', 'insight.propose', 'insight.end'], '生成复盘报告'),
        ]:
            with self.subTest(template=template):
                doc = copy.deepcopy(self.version.document)
                doc.update(id=f'independent-{template}', templateId=template,
                           nodes=[{'id': str(i), 'definitionId': key} for i, key in enumerate(definitions)])
                row = self.save_design(doc).data
                versions = WorkflowVersion.objects.count()
                response = self.api.post(f"/api/v1/workflow-designs/{row['id']}/freeze", {'expected_revision': 1}, format='json')
                self.assertEqual(response.status_code, 422)
                self.assertIn(button, str(response.data))
                self.assertEqual(DesignRelease.objects.count(), 0)
                self.assertEqual(WorkflowVersion.objects.count(), versions)

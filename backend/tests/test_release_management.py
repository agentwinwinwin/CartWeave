from django.test import TestCase, override_settings
from apps.workflows.models import DesignRelease, ReleaseRetirement
from apps.runtime.models import WorkflowRun, WorkflowSchedule
from apps.identity.models import Team, Membership
from django.contrib.auth.models import User
from .test_saved_design import SavedDesignTests


class ReleaseManagementTests(TestCase):
    setUp=SavedDesignTests.setUp
    save_design=SavedDesignTests.save_design

    def frozen(self):
        saved=self.save_design()
        self.assertEqual(saved.status_code,200,saved.data)
        response=self.api.post(f'/api/v1/workflow-designs/{saved.data["id"]}/freeze',{'expected_revision':1},format='json')
        self.assertEqual(response.status_code,201,response.data)
        return DesignRelease.objects.get(pk=response.data['id'])

    def lifecycle(self,row):return f'/api/v1/workflow-releases/{row.id}/lifecycle'

    def test_delete_and_restore_are_recoverable_without_modifying_snapshot(self):
        row=self.frozen();original=row.document;digest=row.digest
        listed=self.api.get('/api/v1/workflow-releases').data
        self.assertEqual(listed['results'][0]['active_runs'],0)
        self.assertTrue(listed['results'][0]['can_delete'])
        for _ in range(2):self.assertEqual(self.api.delete(self.lifecycle(row),{},format='json').status_code,200)
        self.assertEqual(self.api.get('/api/v1/workflow-releases').data['count'],0)
        self.assertEqual(self.api.get('/api/v1/workflow-releases?view=deleted').data['count'],1)
        row.refresh_from_db();self.assertEqual(row.document,original);self.assertEqual(row.digest,digest)
        self.assertTrue(self.api.get(f'/api/v1/workflow-releases/{row.id}').data['deleted'])
        self.assertEqual(self.api.post(f'/api/v1/workflow-designs/{row.design_id}/freeze',{'expected_revision':1},format='json').status_code,409)
        blocked=self.api.post('/api/v1/runs',{'version_id':str(row.version_id),'store_id':str(self.store.id),'brief':self.brief,'idempotency_key':'deleted-new'},format='json')
        self.assertEqual(blocked.status_code,409,blocked.data)
        self.assertEqual(WorkflowRun.objects.count(),0)
        self.assertEqual(self.api.post(self.lifecycle(row),{},format='json').status_code,200)
        self.assertEqual(self.api.get('/api/v1/workflow-releases').data['count'],1)
        self.assertEqual(ReleaseRetirement.objects.count(),0)

    def test_active_runs_block_delete_finished_history_is_preserved(self):
        row=self.frozen()
        run=WorkflowRun.objects.create(team=self.team,version=row.version,store=self.store,store_version=row.store_version,requested_by=self.user,idempotency_key='reference',request_digest='a'*64,status='waiting_approval')
        self.assertEqual(self.api.delete(self.lifecycle(row),{},format='json').status_code,409)
        self.assertEqual(self.api.get('/api/v1/workflow-releases').data['results'][0]['active_runs'],1)
        run.status='succeeded';run.save(update_fields=['status'])
        self.assertEqual(self.api.delete(self.lifecycle(row),{},format='json').status_code,200)
        self.assertTrue(WorkflowRun.objects.filter(pk=run.pk).exists())

    def test_active_schedule_blocks_but_paused_reference_is_retained(self):
        row=self.frozen()
        plan=WorkflowSchedule.objects.create(team=self.team,release=row,requested_by=self.user,name='test',frequency='daily',timezone='UTC',clock='09:00',enabled=True)
        self.assertEqual(self.api.delete(self.lifecycle(row),{},format='json').status_code,409)
        plan.enabled=False;plan.save(update_fields=['enabled'])
        self.assertEqual(self.api.delete(self.lifecycle(row),{},format='json').status_code,200)
        self.assertTrue(WorkflowSchedule.objects.filter(pk=plan.pk).exists())
        self.assertFalse(self.api.get('/api/v1/schedules').data['releases'])
        enabled=self.api.patch(f'/api/v1/schedules/{plan.id}',{'expected_revision':plan.revision,'enabled':True},format='json')
        self.assertEqual(enabled.status_code,422,enabled.data)
        plan.refresh_from_db();self.assertFalse(plan.enabled)

    def test_team_isolation_and_operator_permissions(self):
        row=self.frozen();other=User.objects.create_user('release-other');team=Team.objects.create(name='Other')
        Membership.objects.create(team=team,user=other,role='operator');self.api.force_authenticate(other)
        self.assertEqual(self.api.get('/api/v1/workflow-releases').data['count'],0)
        self.assertEqual(self.api.delete(self.lifecycle(row),{},format='json').status_code,404)
        self.api.force_authenticate(self.user)
        Membership.objects.filter(user=self.user,team=self.team).update(role='viewer')
        self.assertEqual(self.api.delete(self.lifecycle(row),{},format='json').status_code,403)
        self.assertEqual(self.api.post(self.lifecycle(row),{},format='json').status_code,403)

    def test_bad_filters_are_rejected(self):
        for query in ('page=0','page=no','view=all'):
            self.assertEqual(self.api.get('/api/v1/workflow-releases?'+query).status_code,400)

    @override_settings(LOCAL=True,DESKTOP_MODE=True)
    def test_deleted_start_does_not_cancel_another_current_run(self):
        row=self.frozen()
        self.assertEqual(self.api.delete(self.lifecycle(row),{},format='json').status_code,200)
        current=WorkflowRun.objects.create(team=self.team,version=self.version,store=self.store,store_version=self.store.configuration_version,requested_by=self.user,idempotency_key='current',request_digest='a'*64,status='queued')
        response=self.api.post('/api/v1/runs',{'version_id':str(row.version_id),'store_id':str(self.store.id),'brief':self.brief,'idempotency_key':'deleted-new'},format='json')
        self.assertEqual(response.status_code,409,response.data)
        current.refresh_from_db();self.assertEqual(current.status,'queued')

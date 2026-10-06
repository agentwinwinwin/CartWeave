from datetime import datetime, timedelta, timezone as utc
from types import SimpleNamespace
from copy import deepcopy
from unittest.mock import patch
from django.test import TestCase, SimpleTestCase
from django.utils import timezone
from apps.identity.models import Team, Membership
from apps.runtime.models import WorkflowSchedule, ScheduleOccurrence, WorkflowRun, SelectionTask
from apps.runtime.scheduling import next_due, fire_schedule, dispatch_schedules
from apps.skills.models import SkillVersion
from apps.workflows.models import WorkflowDesign, DesignRelease
from . import test_launch_workflow as launch_tests
from . import test_cj_opportunity as cj_tests


class ScheduleClockTests(SimpleTestCase):
    def config(self, **kwargs):
        return SimpleNamespace(frequency='daily',timezone='Asia/Shanghai',clock='09:00',weekdays=[0],interval_hours=24,**kwargs)

    def test_local_clock_and_weekly_and_interval(self):
        config=self.config()
        now=datetime(2026,10,3,0,0,tzinfo=utc.utc)
        self.assertEqual(next_due(config,now),datetime(2026,10,3,1,0,tzinfo=utc.utc))
        self.assertEqual(next_due(config,now+timedelta(hours=1)),datetime(2026,10,4,1,0,tzinfo=utc.utc))
        config.frequency='weekly'
        self.assertEqual(next_due(config,now),datetime(2026,10,5,1,0,tzinfo=utc.utc))
        config.frequency='interval';config.interval_hours=3
        self.assertEqual(next_due(config,now),now+timedelta(hours=3))

    def test_dst_gap_skips_date_and_fold_only_once(self):
        config=self.config();config.timezone='America/New_York';config.clock='02:30'
        self.assertEqual(next_due(config,datetime(2026,3,8,5,tzinfo=utc.utc)),datetime(2026,3,9,6,30,tzinfo=utc.utc))
        config.clock='01:30'
        first=next_due(config,datetime(2026,11,1,4,tzinfo=utc.utc))
        self.assertEqual(first,datetime(2026,11,1,5,30,tzinfo=utc.utc))
        self.assertEqual(next_due(config,first),datetime(2026,11,2,6,30,tzinfo=utc.utc))


class ScheduleTests(TestCase):
    document=launch_tests.LaunchWorkflowTests.document
    create_release=launch_tests.LaunchWorkflowTests.create_release
    advance=launch_tests.LaunchWorkflowTests.advance
    remote=cj_tests.CJWorkflowTests.remote
    configured=cj_tests.CJWorkflowTests.configured

    def setUp(self):
        launch_tests.LaunchWorkflowTests.setUp(self)
        self.release=self.create_release(self.configured())
        self.payload={'name':'Daily selection','release_id':self.release['id'],'frequency':'daily','timezone':'Asia/Shanghai','clock':'09:00','enabled':True}

    def create(self, **overrides):
        response=self.api.post('/api/v1/schedules',self.payload|overrides,format='json')
        self.assertEqual(response.status_code,201,response.data)
        return WorkflowSchedule.objects.get(pk=response.data['id'])

    def due(self, schedule, lag=0):
        now=timezone.now()
        schedule.next_due_at=now-timedelta(seconds=lag);schedule.save(update_fields=['next_due_at'])
        return now

    def test_scheduled_fifteen_step_flow_keeps_two_reviews_and_publishes(self):
        from apps.teststore.models import PublishedProduct
        timer=self.create();now=self.due(timer)
        fire_schedule(timer.id,now);fire_schedule(timer.id,now)
        self.assertEqual(WorkflowRun.objects.count(),1)
        self.assertEqual(ScheduleOccurrence.objects.count(),1)
        timer.refresh_from_db();run=timer.last_run
        self.assertEqual(run.version_id,timer.release.version_id)
        self.assertGreater(timer.next_due_at,now)
        self.advance(run,False)
        self.assertEqual(run.status,'waiting_approval')
        self.assertEqual(PublishedProduct.objects.count(),0)
        self.advance(run)
        self.assertEqual(run.status,'succeeded',run.error)
        self.assertEqual(run.approvals.filter(status='approved').count(),2)
        self.assertEqual(PublishedProduct.objects.count(),1)
        fire_schedule(timer.id,self.due(timer))
        self.assertEqual(WorkflowRun.objects.count(),2)
        self.assertEqual(timer.occurrences.filter(status='started').count(),2)

    def test_unfinished_and_needs_attention_rounds_do_not_overlap(self):
        timer=self.create();fire_schedule(timer.id,self.due(timer))
        timer.refresh_from_db()
        for status in ('running','waiting_approval','waiting_event','needs_attention'):
            WorkflowRun.objects.filter(pk=timer.last_run_id).update(status=status)
            SelectionTask.objects.update(status='needs_attention')
            fire_schedule(timer.id,self.due(timer))
            self.assertEqual(timer.occurrences.latest('created_at').status,'skipped')
        self.assertEqual(WorkflowRun.objects.count(),1)

    def test_busy_other_cj_task_skips_without_new_run(self):
        timer=self.create()
        SelectionTask.objects.create(team=self.team,requested_by=self.user,query={},connection_version=1,status='queued')
        fire_schedule(timer.id,self.due(timer))
        self.assertEqual(timer.occurrences.get().status,'skipped')
        self.assertEqual(WorkflowRun.objects.count(),0)

    def test_missed_slots_do_not_catch_up(self):
        timer=self.create();now=self.due(timer,lag=86400*5)
        fire_schedule(timer.id,now);timer.refresh_from_db()
        self.assertEqual(timer.occurrences.get().status,'missed')
        self.assertGreater(timer.next_due_at,now)
        self.assertEqual(WorkflowRun.objects.count(),0)
        fire_schedule(timer.id,now)
        self.assertEqual(timer.occurrences.count(),1)

    def test_revoked_skill_disables_and_rolls_back_start(self):
        timer=self.create()
        SkillVersion.objects.filter(pk=timer.release.version.skill_id).update(status='revoked')
        fire_schedule(timer.id,self.due(timer));timer.refresh_from_db()
        self.assertFalse(timer.enabled);self.assertIsNone(timer.next_due_at)
        self.assertEqual(timer.occurrences.get().status,'blocked')
        self.assertEqual(WorkflowRun.objects.count(),0)
        self.assertEqual(SelectionTask.objects.count(),0)

    def test_revoked_actor_cannot_run_timer(self):
        timer=self.create()
        Membership.objects.filter(team=self.team,user=self.user).update(active=False)
        fire_schedule(timer.id,self.due(timer));timer.refresh_from_db()
        self.assertFalse(timer.enabled)
        self.assertEqual(WorkflowRun.objects.count(),0)

    def test_saved_draft_changes_do_not_change_timer_version(self):
        timer=self.create()
        design=WorkflowDesign.objects.get(pk=timer.release.design_id)
        design.document['title']='Changed draft';design.save()
        fire_schedule(timer.id,self.due(timer));timer.refresh_from_db()
        self.assertNotEqual(timer.last_run.version.document['title'],'Changed draft')

    def test_pause_does_not_cancel_existing_run_and_stale_edits_reject(self):
        timer=self.create();fire_schedule(timer.id,self.due(timer))
        response=self.api.patch(f'/api/v1/schedules/{timer.id}',{'expected_revision':1,'enabled':False},format='json')
        self.assertEqual(response.status_code,200,response.data)
        timer.refresh_from_db();self.assertIsNone(timer.next_due_at)
        self.assertEqual(timer.last_run.status,'queued')
        response=self.api.patch(f'/api/v1/schedules/{timer.id}',{'expected_revision':1,'enabled':True},format='json')
        self.assertEqual(response.status_code,409)

    def test_invalid_frequency_timezone_and_weekly_days(self):
        for patch_data in ({'frequency':'cron'},{'timezone':'unknown/zone'},{'frequency':'weekly','weekdays':[]},{'clock':'25:00'},{'frequency':'interval','interval_hours':0},{'weekdays':[0,0]},{'secret':'bad'}):
            response=self.api.post('/api/v1/schedules',self.payload|patch_data,format='json')
            self.assertEqual(response.status_code,400,response.data)
        timer=self.create()
        response=self.api.patch(f'/api/v1/schedules/{timer.id}',{'expected_revision':1,'frequency':'weekly','weekdays':[]},format='json')
        self.assertEqual(response.status_code,400)

    def test_team_isolation_and_viewer_cannot_configure(self):
        timer=self.create();other=Team.objects.create(name='Other')
        self.api.credentials(HTTP_X_TEAM_ID=str(other.id))
        self.assertEqual(self.api.get('/api/v1/schedules').status_code,403)
        self.api.credentials()
        Membership.objects.filter(team=self.team,user=self.user).update(role='viewer')
        self.assertEqual(self.api.get('/api/v1/schedules').status_code,200)
        self.assertEqual(self.api.post('/api/v1/schedules',self.payload,format='json').status_code,403)
        self.assertEqual(self.api.patch(f'/api/v1/schedules/{timer.id}',{'expected_revision':1,'enabled':False},format='json').status_code,403)

    def test_dispatch_heartbeat_and_paused_timers(self):
        timer=self.create(enabled=False)
        dispatch_schedules()
        response=self.api.get('/api/v1/schedules')
        self.assertTrue(response.data['dispatcher']['online'])
        self.assertEqual(response.data['schedules'][0]['id'],str(timer.id))
        self.assertEqual(WorkflowRun.objects.count(),0)
        self.assertTrue(response.data['releases'])

    def test_frozen_publication_13_survives_read_only_package_14_addition(self):
        from contracts.store_api import package_contract
        from apps.common.utils import digest
        document=deepcopy(DesignRelease.objects.get(pk=self.release['id']).document)
        document['id']='historical-publication-13'
        plan=next(n['binding']['parameters'] for n in document['nodes'] if n['definitionId']=='listing.map')
        plan['mappingPlanVersion']='1.3.0'
        legacy=package_contract()|{'version':'1.3.0'}
        # Freeze under the actual old registry, then execute under today's one.
        with patch('contracts.store_api.package_contract',return_value=legacy):
            release=self.create_release(document)
        timer=self.create(release_id=release['id'])
        original=digest(timer.release.version.document)
        fire_schedule(timer.id,self.due(timer));timer.refresh_from_db()
        self.assertTrue(timer.enabled)
        self.assertEqual(timer.occurrences.get().status,'started')
        self.advance(timer.last_run)
        timer.last_run.refresh_from_db()
        self.assertEqual(timer.last_run.status,'succeeded',timer.last_run.error)
        self.assertEqual(timer.last_run.context['prepared_publication']['package_version'],'1.3.0')
        self.assertEqual(digest(timer.release.version.document),original)

    def test_new_freeze_does_not_silently_bind_historical_package(self):
        from apps.registry.definitions import validate_document
        from apps.common.errors import RuleError
        document=deepcopy(DesignRelease.objects.get(pk=self.release['id']).document)
        plan=next(n['binding']['parameters'] for n in document['nodes'] if n['definitionId']=='listing.map')
        plan['mappingPlanVersion']='1.3.0'
        with self.assertRaises(RuleError):validate_document(document,self.skill)
        validate_document(document,self.skill,frozen=True)
        for unsupported in ('1.2.0','1.5.0','unknown'):
            plan['mappingPlanVersion']=unsupported
            with self.assertRaises(RuleError):validate_document(document,self.skill,frozen=True)

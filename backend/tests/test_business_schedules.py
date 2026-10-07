import json
import uuid
from datetime import timedelta
from unittest.mock import patch
from django.test import TestCase,LiveServerTestCase,override_settings
from django.utils import timezone
from apps.runtime.models import WorkflowSchedule,WorkflowRun,SupportMessageClaim,Outbox
from apps.runtime.scheduling import fire_schedule
from apps.agents.models import OperationReport
from apps.teststore.models import ExchangeRecord
from .test_business_workflow import BusinessMixin,document
from . import test_business_workflow as business_fixtures
from . import test_store_testing as store_fixtures
from . import test_product_images as image_fixtures

@override_settings(LOCAL=True,DESKTOP_MODE=True)
class SupportScheduleTests(BusinessMixin,TestCase):
    setUp=store_fixtures.StoreTestingTests.setUp
    request=store_fixtures.StoreTestingTests.request
    api_call=store_fixtures.StoreTestingTests.api_call
    lab=store_fixtures.StoreTestingTests.lab

    def release(self,**config):
        self.assertEqual(self.lab('enable',{'confirmed':True}).status_code,200)
        return self.freeze(document(self.store,'support',{'input_mode':'inbox','message_id':None,
            'reply_policy':'automatic','mode':'fixture','connection_id':None,'sample_knowledge_confirmed':True,**config}))

    def timer(self,release,**config):
        r=self.api.post('/api/v1/schedules',{'name':'Inbox listener','release_id':release['id'],
            'frequency':'continuous','timezone':'Asia/Shanghai','enabled':True,**config},format='json')
        self.assertEqual(r.status_code,201,r.data)
        return WorkflowSchedule.objects.get(pk=r.data['id'])

    def message(self,text='标准配送需要多久？'):
        r=self.lab('support.receive',{'operation_key':uuid.uuid4().hex*2,'message':text,'test_data_confirmed':True})
        self.assertEqual(r.status_code,200,r.data);return r.data['id']

    def poll(self,timer):
        timer.next_due_at=timezone.now();timer.save(update_fields=['next_due_at'])
        with patch('apps.integrations.test_store.httpx.request',side_effect=self.request):fire_schedule(timer.id)
        timer.refresh_from_db()

    def finish(self,run):
        with patch('apps.integrations.test_store.httpx.request',side_effect=self.request):
            for _ in range(7):self.step(run)

    def test_repeated_polls_claim_once_and_new_message_runs_seven_steps(self):
        r=self.release();timer=self.timer(r);first=self.message()
        self.poll(timer);run=timer.last_run
        self.poll(timer);self.assertEqual(WorkflowRun.objects.count(),1)
        self.finish(run);self.assertEqual(run.status,'succeeded',run.error)
        self.assertFalse(run.approvals.exists()) # policy authorization, not invented human approval
        self.assertEqual(ExchangeRecord.objects.filter(kind='reply').count(),1)
        self.poll(timer);self.assertEqual(WorkflowRun.objects.count(),1)
        second=self.message();self.poll(timer);self.finish(timer.last_run)
        self.assertEqual(WorkflowRun.objects.count(),2)
        self.assertEqual(ExchangeRecord.objects.filter(kind='reply').count(),2)
        self.assertEqual(set(SupportMessageClaim.objects.values_list('message_id',flat=True)),{uuid.UUID(first),uuid.UUID(second)})
        overview=self.api.get('/api/v1/schedules').data
        self.assertEqual(overview['schedules'][0]['completed_messages'],2)
        self.assertEqual(overview['schedules'][0]['pending_messages'],0)
        self.assertEqual(overview['releases'][0]['input_mode'],'inbox')

    def test_manual_policy_is_preserved_and_does_not_block_other_messages(self):
        timer=self.timer(self.release(reply_policy='manual'));self.message();self.message()
        self.poll(timer);first=timer.last_run
        with patch('apps.integrations.test_store.httpx.request',side_effect=self.request):
            for _ in range(4):self.step(first)
        self.assertEqual(first.status,'waiting_approval')
        self.assertFalse(ExchangeRecord.objects.filter(kind='reply').exists())
        self.poll(timer);self.assertNotEqual(timer.last_run_id,first.id)
        self.assertEqual(WorkflowRun.objects.count(),2)

    def test_handoff_and_model_failure_are_not_auto_retried(self):
        timer=self.timer(self.release());self.message('我要退款');self.poll(timer);run=timer.last_run
        with patch('apps.integrations.test_store.httpx.request',side_effect=self.request):
            for _ in range(4):self.step(run)
        self.assertEqual((run.status,run.cursor),('needs_attention',3))
        self.assertFalse(ExchangeRecord.objects.filter(kind='reply').exists())
        self.message();self.poll(timer);next_run=timer.last_run
        with patch('apps.integrations.test_store.httpx.request',side_effect=self.request):
            self.step(next_run);self.step(next_run)
            with patch('apps.agents.store_support.prepare',side_effect=RuntimeError('secret')) as model:
                self.step(next_run);self.poll(timer);self.poll(timer)
                self.assertEqual(model.call_count,1)
        self.assertEqual(next_run.status,'needs_attention')
        self.assertEqual(WorkflowRun.objects.count(),2)
        self.assertEqual(self.api.get('/api/v1/schedules').data['schedules'][0]['attention_messages'],2)

    def test_cursor_pages_all_messages_instead_of_latest_fifty_and_pause_keeps_pending(self):
        timer=self.timer(self.release())
        for _ in range(55):self.message()
        self.poll(timer);self.assertEqual(SupportMessageClaim.objects.count(),50)
        self.poll(timer);self.assertEqual(SupportMessageClaim.objects.count(),55)
        self.assertEqual(WorkflowRun.objects.count(),1)
        response=self.api.patch(f'/api/v1/schedules/{timer.id}',{'expected_revision':1,'enabled':False},format='json')
        self.assertEqual(response.status_code,200,response.data)
        self.poll(timer);self.assertEqual(WorkflowRun.objects.count(),1)
        self.assertEqual(SupportMessageClaim.objects.filter(run__isnull=True).count(),54)

    def test_changed_store_stops_listener_without_switching_and_other_schedule_deduplicates(self):
        r=self.release();one=self.timer(r);two=self.timer(r);self.message()
        self.poll(one);self.poll(two);self.assertEqual(WorkflowRun.objects.count(),1)
        self.store.configuration_version+=1;self.store.save()
        self.poll(one);self.assertFalse(one.enabled);self.assertIsNone(one.next_due_at)
        self.assertTrue(one.occurrences.filter(status='blocked').exists())

    def test_inbox_cannot_use_time_frequency_or_manual_no_event_start(self):
        r=self.release()
        response=self.api.post('/api/v1/schedules',{'name':'wrong','release_id':r['id'],'frequency':'daily','timezone':'UTC'},format='json')
        self.assertEqual(response.status_code,422,response.data)
        response=self.api.post('/api/v1/runs',{'version_id':r['version_id'],'store_id':str(self.store.id),'idempotency_key':str(uuid.uuid4())},format='json')
        self.assertEqual(response.status_code,422,response.data)

    def test_legacy_manual_draft_without_claim_is_not_regenerated(self):
        inbox=self.release();message=self.message()
        legacy=self.freeze(document(self.store,'support',{'message_id':message,'mode':'fixture','connection_id':None,'sample_knowledge_confirmed':True}))
        old=WorkflowRun.objects.create(team=self.team,store=self.store,store_version=self.store.configuration_version,
            version_id=legacy['version_id'],requested_by=self.user,idempotency_key='legacy-reply',request_digest='a'*64,
            context={'business':{'kind':'support'}},status='waiting_approval',cursor=3)
        timer=self.timer(inbox);self.poll(timer)
        self.assertEqual(WorkflowRun.objects.count(),1)
        self.assertEqual(SupportMessageClaim.objects.get().run_id,old.id)

    def test_pi_calls_harness_once_per_claim_and_receipt_is_real_test_http(self):
        from apps.connections.models import ModelConnection
        model=ModelConnection.objects.create(team=self.team,name='Fixture model',protocol='openai-completions',model_id='test-chat',base_url='https://example.invalid',credential_ciphertext='fixture')
        timer=self.timer(self.release(mode='pi',connection_id=str(model.id)));self.message()
        answer=json.dumps({'schema_version':'GroundedSupportReply@1','reply':'Standard shipping takes 3–7 business days.',
            'citations':['shipping'],'questions':[],'handoff_required':False})
        # Citation IDs are sourced from the actual policy context, never invented.
        from apps.agents.operations import retrieve
        citation=retrieve('标准配送需要多久？')[0]['id'];value=json.loads(answer);value['citations']=[citation]
        with patch('apps.agents.store_support.complete',return_value=(json.dumps(value),{'model_called':True})) as harness:
            self.poll(timer);self.finish(timer.last_run);self.poll(timer)
        self.assertEqual(harness.call_count,1)
        self.assertEqual(timer.last_run.status,'succeeded',timer.last_run.error)

@override_settings(LOCAL=True,DESKTOP_MODE=True)
class ImageScheduleTests(BusinessMixin,TestCase):
    setUp=image_fixtures.ProductImageTests.setUp
    create=image_fixtures.ProductImageTests.create
    setup_images=business_fixtures.ImageWorkflowTests.setup_images

    def test_images_are_candidates_but_no_repeat_or_hidden_paid_confirmation(self):
        release=self.setup_images()
        baseline=WorkflowRun.objects.count()
        response=self.api.post('/api/v1/schedules',{'name':'Images','release_id':release['id'],'frequency':'interval','interval_hours':24,'timezone':'UTC','enabled':True},format='json')
        self.assertEqual(response.status_code,201,response.data)
        timer=WorkflowSchedule.objects.get(pk=response.data['id'])
        timer.next_due_at=timezone.now();timer.save();fire_schedule(timer.id);timer.refresh_from_db()
        self.assertEqual(timer.last_run.status,'queued');self.assertEqual(WorkflowRun.objects.count(),baseline+1)
        # Isolate scheduling duplicate guard; complete image execution is tested separately.
        WorkflowRun.objects.filter(pk=timer.last_run_id).update(status='succeeded')
        timer.next_due_at=timezone.now();timer.save();fire_schedule(timer.id)
        self.assertEqual(WorkflowRun.objects.count(),baseline+1)
        self.assertEqual(timer.occurrences.latest('created_at').status,'skipped')
        overview=self.api.get('/api/v1/schedules').data
        self.assertTrue(any(r['scope']=='product-images' for r in overview['releases']))
        response=self.api.patch(f'/api/v1/schedules/{timer.id}',{'expected_revision':1,'frequency':'continuous'},format='json')
        self.assertEqual(response.status_code,422)

@override_settings(LOCAL=True,DESKTOP_MODE=True)
class SupportListenerHTTPTests(BusinessMixin,LiveServerTestCase):
    setUp=store_fixtures.StoreTestingTests.setUp
    lab=store_fixtures.StoreTestingTests.lab
    def api_call(self,path,data):
        return self.api.post('/api/v1/'+path,data,format='json')

    def test_actual_http_feed_and_two_automated_reply_rounds(self):
        with override_settings(TEST_STORE_API_BASE=self.live_server_url+'/api/test-store/v1'):
            self.assertEqual(self.lab('enable',{'confirmed':True}).status_code,200)
            release=self.freeze(document(self.store,'support',{'input_mode':'inbox','message_id':None,'reply_policy':'automatic',
                'mode':'fixture','connection_id':None,'sample_knowledge_confirmed':True}))
            response=self.api.post('/api/v1/schedules',{'name':'HTTP inbox','release_id':release['id'],
                'frequency':'continuous','timezone':'UTC','enabled':True},format='json')
            self.assertEqual(response.status_code,201,response.data)
            timer=WorkflowSchedule.objects.get(pk=response.data['id'])
            for _ in range(2):
                message=self.lab('support.receive',{'operation_key':uuid.uuid4().hex*2,'message':'标准配送需要多久？','test_data_confirmed':True})
                self.assertEqual(message.status_code,200,message.data)
                timer.next_due_at=timezone.now();timer.save();fire_schedule(timer.id);timer.refresh_from_db()
                run=timer.last_run
                self.assertIsNotNone(run,timer.last_error)
                for _ in range(7):self.step(run)
                self.assertEqual(run.status,'succeeded',run.error)
                self.assertEqual(run.context['business']['receipt']['message_id'],message.data['id'])
            self.assertEqual(ExchangeRecord.objects.filter(kind='reply').count(),2)
            timer.next_due_at=timezone.now();timer.save();fire_schedule(timer.id)
            self.assertEqual(WorkflowRun.objects.count(),2)

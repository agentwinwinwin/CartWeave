import copy
import json
import uuid
from unittest.mock import patch
from django.test import TestCase, LiveServerTestCase, override_settings
from apps.runtime.models import WorkflowRun, Outbox
from apps.runtime.services import process_job
from apps.agents.models import OperationReport, ProductImageBatch
from apps.registry.business import GRAPHS
from tests import test_store_testing as store_fixtures
from tests import test_product_images as image_fixtures

def document(store,kind,config):
    ids=GRAPHS[kind]
    return {'schemaVersion':'2','id':f'workflow-{kind}-{uuid.uuid4()}','title':kind,'revision':1,'templateId':kind,
        'environment':{'channel':'test-store','fulfillment':'supplier','capabilities':[],'storeRef':str(store.id)},
        'customSkills':[],'customChannels':[],
        'nodes':[{'id':key,'definitionId':key,'title':key,'binding':{'skillId':key+'.core','skillVersion':'1.0.0',
            'mode':'default','parameters':{'runtime':config} if i==0 else {}}} for i,key in enumerate(ids)],
        'edges':[{'id':f'edge-{i}','source':ids[i],'target':ids[i+1],'kind':'forward'} for i in range(len(ids)-1)]}

class BusinessMixin:
    def freeze(self,doc):
        row=self.api.post('/api/v1/workflow-designs',{'document':doc,'expected_revision':0},format='json')
        self.assertEqual(row.status_code,200,row.data)
        response=self.api.post(f"/api/v1/workflow-designs/{row.data['id']}/freeze",{'expected_revision':1},format='json')
        self.assertEqual(response.status_code,201,response.data)
        return response.data
    def start(self,release,key=None):
        response=self.api.post('/api/v1/runs',{'version_id':release['version_id'],'store_id':str(self.store.id),
            'idempotency_key':key or str(uuid.uuid4())},format='json')
        self.assertEqual(response.status_code,202,response.data)
        return WorkflowRun.objects.get(pk=response.data['id'])
    def step(self,run):
        job=Outbox.objects.filter(run=run,status='pending').first();self.assertIsNotNone(job)
        # Test clock only: no real sleeps or external auto retries.
        from django.utils import timezone
        job.available_at=timezone.now();job.save(update_fields=['available_at']);process_job(job.pk);run.refresh_from_db()
    def confirm(self,run,**kwargs):
        r=self.api.post(f'/api/v1/runs/{run.id}/business-command',{'confirmed':True,'expected_revision':run.revision,**kwargs},format='json')
        self.assertEqual(r.status_code,200,r.data);run.refresh_from_db()

@override_settings(LOCAL=True,DESKTOP_MODE=True)
class SupportWorkflowTests(BusinessMixin,TestCase):
    setUp=store_fixtures.StoreTestingTests.setUp
    request=store_fixtures.StoreTestingTests.request
    api_call=store_fixtures.StoreTestingTests.api_call
    lab=store_fixtures.StoreTestingTests.lab
    def setup_message(self,text='标准配送需要多久？'):
        self.assertEqual(self.lab('enable',{'confirmed':True}).status_code,200)
        r=self.lab('support.receive',{'operation_key':'d'*64,'message':text,'test_data_confirmed':True})
        self.assertEqual(r.status_code,200,r.data)
        return document(self.store,'support',{'message_id':r.data['id'],'mode':'fixture','connection_id':None,'sample_knowledge_confirmed':True})
    def test_seven_real_steps_freeze_wait_confirm_send_lookup_archive(self):
        doc=self.setup_message();release=self.freeze(doc);self.assertEqual(release['scope'],'support')
        with patch('apps.integrations.test_store.httpx.request',side_effect=self.request):
            run=self.start(release)
            self.assertIsNone(run.version.skill)
            for _ in range(4):self.step(run)
            self.assertEqual((run.cursor,run.status),(3,'waiting_approval'))
            from apps.teststore.models import ExchangeRecord
            self.assertFalse(ExchangeRecord.objects.filter(kind='reply').exists())
            stale=self.api.post(f'/api/v1/runs/{run.id}/business-command',{'confirmed':True,'expected_revision':run.revision-1},format='json')
            self.assertEqual(stale.status_code,409)
            self.confirm(run)
            for _ in range(3):self.step(run)
            self.assertEqual(run.status,'succeeded');self.assertEqual(run.attempts.filter(status='completed').count(),7)
            self.assertEqual(ExchangeRecord.objects.filter(kind='reply').count(),1)
            self.assertEqual(OperationReport.objects.get(pk=run.context['business']['report_id']).payload['status'],'archived')
            self.assertEqual(self.api.get(f'/api/v1/runs/{run.id}').data['status'],'succeeded')
    def test_missing_nodes_and_handoff_fail_closed(self):
        doc=self.setup_message('我要退款');release=self.freeze(doc)
        with patch('apps.integrations.test_store.httpx.request',side_effect=self.request):
            run=self.start(release)
            for _ in range(4):self.step(run)
        self.assertEqual(run.status,'needs_attention');self.assertEqual(run.cursor,3)
        doc['nodes'].pop(3);doc['id']+='-bad'
        row=self.api.post('/api/v1/workflow-designs',{'document':doc,'expected_revision':0},format='json').data
        response=self.api.post(f"/api/v1/workflow-designs/{row['id']}/freeze",{'expected_revision':1},format='json')
        self.assertEqual(response.status_code,422)
    def test_failed_reply_is_not_retried_and_modified_confirmed_reply_is_blocked(self):
        release=self.freeze(self.setup_message())
        with patch('apps.integrations.test_store.httpx.request',side_effect=self.request):
            run=self.start(release);self.step(run);self.step(run)
            with patch('apps.agents.store_support.prepare',side_effect=RuntimeError('fixture failure')) as model:
                self.step(run);self.assertEqual(run.status,'needs_attention')
                resumed=self.api.post(f'/api/v1/runs/{run.id}/resume',{'expected_revision':run.revision},format='json')
                self.assertEqual(resumed.status_code,200);run.refresh_from_db();self.step(run)
                self.assertEqual(model.call_count,1);self.assertEqual(run.status,'needs_attention')
    def test_confirmed_reply_cannot_be_replaced_before_send(self):
        release=self.freeze(self.setup_message())
        with patch('apps.integrations.test_store.httpx.request',side_effect=self.request):
            run=self.start(release)
            for _ in range(4):self.step(run)
            self.confirm(run)
            r=OperationReport.objects.get(pk=run.context['business']['report_id']);r.payload['reply']['reply']='Changed after approval';r.save(update_fields=['payload'])
            self.step(run);self.assertEqual(run.status,'needs_attention')
            from apps.teststore.models import ExchangeRecord
            self.assertFalse(ExchangeRecord.objects.filter(kind='reply').exists())

@override_settings(LOCAL=True,DESKTOP_MODE=True)
class ImageWorkflowTests(BusinessMixin,TestCase):
    setUp=image_fixtures.ProductImageTests.setUp
    create=image_fixtures.ProductImageTests.create
    png=image_fixtures.ProductImageTests.png
    def setup_images(self):
        old,_=self.create()
        ProductImageBatch.objects.filter(pk=old['id']).update(status='cancelled')
        config={k:v for k,v in self.fields.items() if k not in ('design_id','idempotency_key')}
        return self.freeze(document(self.store,'product-images',config))
    def test_six_steps_reuse_image_executor_and_require_two_confirmations(self):
        release=self.setup_images();run=self.start(release);self.step(run)
        batch=ProductImageBatch.objects.get(pk=run.context['business']['batch_id'])
        from apps.agents.image_service import process_batch
        answer={'schema_version':'ProductImagePlan@2','shots':[{'prompt':'Preserve original product','preserve':['shape'],'forbidden_changes':['brand']}],'questions':[]}
        with patch('apps.agents.image_service.complete',return_value=(json.dumps(answer),{'harness':{'version':'1.0.4'}})) as model:
            process_batch(batch.id);self.assertEqual(model.call_count,1)
        self.step(run);self.assertEqual((run.cursor,run.status),(1,'waiting_approval'))
        self.confirm(run)
        with patch('apps.agents.image_service.edit',return_value=(self.png(),1024,1024,'fixture-not-paid',{})) as image:
            process_batch(batch.id);self.assertEqual(image.call_count,1)
        self.step(run);self.step(run);self.step(run)
        self.assertEqual((run.cursor,run.status),(4,'waiting_approval'))
        batch.refresh_from_db();self.assertFalse(batch.pack)
        self.confirm(run,asset_ids=[str(a.id) for a in batch.assets.all()]);self.step(run)
        self.assertEqual(run.status,'succeeded');self.assertEqual(run.attempts.filter(status='completed').count(),6)
        self.assertEqual(run.context['business']['pack']['schema_version'],'ApprovedProductImagePack@1')
        batch.refresh_from_db();self.assertEqual(batch.configuration['design_snapshot'],run.version.document)
    def test_stop_waiting_workflow_stops_attached_batch(self):
        release=self.setup_images();run=self.start(release);self.step(run)
        response=self.api.post(f'/api/v1/runs/{run.id}/cancel',{'expected_revision':run.revision},format='json')
        self.assertEqual(response.status_code,200,response.data)
        b=ProductImageBatch.objects.get(pk=run.context['business']['batch_id']);self.assertEqual(b.status,'cancelled')

@override_settings(LOCAL=True,DESKTOP_MODE=True)
class BusinessHTTPTests(BusinessMixin,LiveServerTestCase):
    setUp=store_fixtures.StoreTestingTests.setUp
    lab=store_fixtures.StoreTestingTests.lab
    def api_call(self,path,data):
        return self.api.post('/api/v1/'+path,data,format='json')
    def test_support_workflow_uses_actual_http_and_restores_same_run(self):
        with override_settings(TEST_STORE_API_BASE=self.live_server_url+'/api/test-store/v1'):
            self.assertEqual(self.lab('enable',{'confirmed':True}).status_code,200)
            message=self.lab('support.receive',{'operation_key':'e'*64,'message':'标准配送需要多久？','test_data_confirmed':True}).data
            release=self.freeze(document(self.store,'support',{'message_id':message['id'],'mode':'fixture','connection_id':None,'sample_knowledge_confirmed':True}))
            run=self.start(release)
            for _ in range(4):self.step(run)
            self.assertEqual(run.status,'waiting_approval');self.confirm(run)
            for _ in range(3):self.step(run)
            self.assertEqual(run.status,'succeeded')
            restored=self.api.get(f'/api/v1/runs/{run.id}').data
            self.assertEqual(restored['context']['business']['receipt']['message_id'],message['id'])

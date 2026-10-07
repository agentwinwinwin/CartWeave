import base64
import hashlib
import io
import uuid
from unittest.mock import patch
import httpx
from PIL import Image
from django.test import TestCase, override_settings
from apps.common.utils import digest
from apps.teststore.models import PublishedProduct, ExchangeRecord, TestingEnrollment, BusinessEvent
from apps.agents.models import ProductImageBatch, ProductImageAsset
from apps.listings.models import ChannelListing
from apps.runtime.models import WorkflowRun
from tests.test_business_sync import BusinessSyncTests
from apps.identity.bootstrap import example_brief

@override_settings(LOCAL=True, DESKTOP_MODE=True)
class StoreTestingTests(TestCase):
    setUp=BusinessSyncTests.setUp

    def request(self,method,url,**kwargs):
        path='/api/test-store/v1'+url.split('/api/test-store/v1',1)[1]
        response=getattr(self.remote_api,method.lower())(path,kwargs.get('json'),format='json')
        return httpx.Response(response.status_code,json=response.data)

    def api_call(self,path,data):
        with patch('apps.integrations.test_store.httpx.request',side_effect=self.request):
            return self.api.post('/api/v1/'+path,data,format='json')

    def lab(self,action,data):
        return self.api_call(f'stores/{self.store.id}/test-lab',{'action':action,'data':data})

    def publish(self):
        brief=example_brief();listing={k:v for k,v in brief.items() if k not in ['source_kind','evidence_ref','source_note','selling_points']}
        listing.update(schema_version='ListingDraft@1',bullets=brief['selling_points'])
        result=self.remote_api.post('/api/test-store/v1/actions/listing.publish',{'listing':listing,'operation_key':'a'*64},format='json')
        self.assertEqual(result.status_code,201,result.data)
        return PublishedProduct.objects.get(id=result.data['external_id'])

    def test_actual_contract_order_customer_finance_support_seven_steps(self):
        self.assertEqual(self.lab('enable',{'confirmed':True}).status_code,200)
        product=self.publish();original=product.digest
        orderdata={'operation_key':'b'*64,'product_id':str(product.id),'quantity':1,'test_data_confirmed':True,
            'procurement':'5.00','shipping':'2.00','platform_payment':'1.00','advertising':'0.00','other':'0.00'}
        order=self.lab('test.order.create',orderdata);self.assertEqual(order.status_code,200,order.data)
        self.assertTrue(order.data['test_payment'])
        self.assertEqual(self.lab('test.order.create',orderdata).data,order.data)
        self.assertEqual(BusinessEvent.objects.count(),3)
        self.assertEqual(self.lab('test.order.create',{**orderdata,'quantity':2}).status_code,422)
        for kind in ['orders','customers','finance']:
            r=self.api_call(f'stores/{self.store.id}/sync/{kind}',{});self.assertEqual(r.status_code,200,r.data)
        review=self.api_call('operation-reports/reviews',{'request_key':str(uuid.uuid4())})
        self.assertEqual(review.status_code,201,review.data)
        self.assertEqual(review.data['payload']['test_fact_count'],1)
        self.assertIsNotNone(review.data['payload']['summary']['operating_profit'])
        message=self.lab('support.receive',{'operation_key':'c'*64,'message':'标准配送需要多久？','order_id':order.data['id'],'test_data_confirmed':True})
        self.assertEqual(message.status_code,200,message.data)
        draft=self.api_call('operation-reports/support',{'request_key':str(uuid.uuid4()),'store_id':str(self.store.id),
            'message_id':message.data['id'],'sample_knowledge_confirmed':True})
        self.assertEqual(draft.status_code,201,draft.data)
        p=draft.data['payload'];self.assertEqual(p['channel_mode'],'test_store_http');self.assertIsNotNone(p['order_facts'])
        reply=self.api_call('operation-report/'+draft.data['id'],{'confirmed':True,'expected_revision':1})
        self.assertEqual(reply.status_code,200,reply.data)
        self.assertEqual(len(reply.data['payload']['events']),7)
        self.assertEqual(reply.data['payload']['receipt']['status'],'stored-in-test-inbox')
        self.assertEqual(ExchangeRecord.objects.filter(kind='reply').count(),1)
        product.refresh_from_db();self.assertEqual(product.digest,original)

    def test_missing_costs_remain_unknown_and_enrollment_version_is_checked(self):
        self.assertEqual(self.lab('enable',{'confirmed':False}).status_code,422)
        self.lab('enable',{'confirmed':True});p=self.publish()
        result=self.lab('test.order.create',{'operation_key':'d'*64,'product_id':str(p.id),'quantity':1,'test_data_confirmed':True})
        self.assertEqual(result.status_code,200,result.data)
        fact=BusinessEvent.objects.get(kind='finance');self.assertIsNone(fact.payload['procurement'])
        self.store.configuration_version+=1;self.store.save()
        self.assertEqual(self.lab('support.receive',{'operation_key':'e'*64,'message':'shipping','test_data_confirmed':True}).status_code,422)

    def test_material_png_real_endpoint_and_idempotent_lookup(self):
        p=self.publish();buffer=io.BytesIO();Image.new('RGB',(1024,1024),'white').save(buffer,format='PNG');png=buffer.getvalue()
        fields={'operation_key':'f'*64,'product_id':str(p.id),'batch_id':str(uuid.uuid4()),'asset_id':str(uuid.uuid4()),
            'png_base64':base64.b64encode(png).decode(),'sha256':hashlib.sha256(png).hexdigest(),'appearance_confirmed':True}
        def call(action,data):return self.remote_api.post('/api/test-store/v1/testing/actions/'+action,data,format='json')
        r=call('materials.save',fields);self.assertEqual(r.status_code,200,r.data)
        self.assertNotIn('png_base64',r.data['result'])
        self.assertEqual(call('materials.save',fields).data,r.data)
        self.assertEqual(call('materials.lookup',{'operation_key':'f'*64}).data,r.data)
        self.assertEqual(call('materials.save',{**fields,'operation_key':'1'*64,'sha256':'0'*64}).status_code,422)

    def test_client_isolation_and_production_disabled(self):
        p=self.publish()
        self.remote_api.credentials(HTTP_AUTHORIZATION='Bearer invalid')
        self.assertEqual(self.remote_api.post('/api/test-store/v1/testing/actions/test.records',{},format='json').status_code,401)
        with override_settings(DESKTOP_MODE=False):
            self.assertEqual(self.lab('enable',{'confirmed':True}).status_code,422)


from django.test import LiveServerTestCase

@override_settings(LOCAL=True, DESKTOP_MODE=True)
class StoreHTTPTests(LiveServerTestCase):
    """Actual TCP HTTP round trips to DRF in a temporary database, no HTTP mock."""
    setUp=BusinessSyncTests.setUp
    publish=StoreTestingTests.publish
    lab=StoreTestingTests.lab
    test_actual_contract_order_customer_finance_support_seven_steps=StoreTestingTests.test_actual_contract_order_customer_finance_support_seven_steps

    def api_call(self,path,data):
        with override_settings(TEST_STORE_API_BASE=self.live_server_url+'/api/test-store/v1'):
            return self.api.post('/api/v1/'+path,data,format='json')


from tests.test_product_images import ProductImageTests
from tests.test_publication import PublicationTests

@override_settings(LOCAL=True, DESKTOP_MODE=True)
class ImageStoreHTTPTests(LiveServerTestCase):
    setUp=PublicationTests.setUp
    create=ProductImageTests.create
    plan=ProductImageTests.plan
    action=ProductImageTests.action
    png=ProductImageTests.png

    def test_existing_image_pipeline_confirmed_pack_actual_http_export(self):
        from apps.agents.image_service import process_batch
        from rest_framework.test import APIClient
        remote=APIClient();remote.credentials(HTTP_AUTHORIZATION='Bearer test-adapter-token')
        batch,_=self.create(planner_skill='product_image_photography')
        listing={k:v for k,v in self.brief.items() if k not in ['source_kind','evidence_ref','source_note','selling_points']}
        listing.update(schema_version='ListingDraft@1',bullets=self.brief['selling_points'])
        publication=remote.post('/api/test-store/v1/actions/listing.publish',{'listing':listing,'operation_key':'9'*64},format='json')
        self.assertEqual(publication.status_code,201,publication.data)
        ChannelListing.objects.filter(store=self.store).update(external_id=publication.data['external_id'])
        batch=self.plan(batch);batch=self.action(batch,'generate',confirmed=True).data
        # Provider is mocked explicitly; the store HTTP, DB and file checks are real.
        with patch('apps.agents.image_service.edit',return_value=(self.png(),1024,1024,'fixture-not-paid-provider',{'model_called':False})):
            process_batch(batch['id']);process_batch(batch['id'])
        batch=self.api.get('/api/v1/product-image-batches/'+batch['id']).data
        batch=self.action(batch,'deliver',confirmed=True,asset_ids=[a['id'] for a in batch['assets']]).data
        self.assertEqual(batch['status'],'delivered')
        with override_settings(TEST_STORE_API_BASE=self.live_server_url+'/api/test-store/v1'):
            enrolled=self.api.post(f'/api/v1/stores/{self.store.id}/test-lab',{'action':'enable','data':{'confirmed':True}},format='json')
            self.assertEqual(enrolled.status_code,200,enrolled.data)
            path='/api/v1/product-image-batches/'+batch['id']+'/export-test-store'
            exported=self.api.post(path,{'confirmed':True},format='json')
            self.assertEqual(exported.status_code,200,exported.data)
            self.assertEqual(self.api.post(path,{'confirmed':True},format='json').data,exported.data)
        self.assertEqual(ExchangeRecord.objects.filter(kind='material').count(),1)
        original=PublishedProduct.objects.get(id=publication.data['external_id'])
        self.assertEqual(original.digest,publication.data['digest'])
        self.assertEqual(original.payload['images'],listing['images'])

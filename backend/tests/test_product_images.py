import base64
import io
import json
import os
import uuid
from pathlib import Path
from datetime import timedelta
from unittest import skipUnless
from unittest.mock import patch
import httpx
from PIL import Image
from django.test import TestCase
from django.utils import timezone
from django.contrib.auth.models import User
from apps.agents.models import ProductImageBatch, ProductImageAsset
from apps.agents.image_service import process_batch
from apps.agents.image_transport import edit, ImageResultUnknown
from apps.connections.models import ModelConnection
from apps.connections.services import encrypt
from apps.identity.models import Team, Membership
from apps.listings.models import ChannelListing
from tests.test_publication import PublicationTests


class ProductImageTests(TestCase):
    setUp=PublicationTests.setUp

    def create(self,count=1,planner_skill='product_image_batch'):
        from apps.runtime.services import start_run
        run=start_run(self.version,self.store,self.user,self.brief,'image-product')[0]
        ChannelListing.objects.get_or_create(team=self.team,run=run,store=self.store,external_id='fixture-published',
            defaults={'evidence':{'listing':self.brief,'digest':'fixture'}})
        planner=ModelConnection.objects.create(team=self.team,name='Fixture planner',protocol='openai-completions',
            base_url='https://models.example/v1',model_id='fixture-planner',credential_ciphertext=encrypt('fixture-planner-key'))
        generator=ModelConnection.objects.create(team=self.team,name='Fixture image',protocol='openai-responses',
            base_url='https://api.openai.com/v1',model_id='gpt-image-2.5-sunburst',credential_ciphertext=encrypt('fixture-image-key'))
        self.fields={'design_id':'workflow-product-images-'+str(uuid.uuid4()),'product_ids':[str(run.id)],'planner_id':str(planner.id),
            'generator_id':str(generator.id),'images_per_product':count,'usage':'main','size':'1024x1024','quality':'medium',
            'requirements':'白色背景，保持原商品外观','planner_skill':planner_skill,'idempotency_key':str(uuid.uuid4())}
        from apps.workflows.models import WorkflowDesign
        ids=['image.start','image.brief','image.generate','image.check','image.authorize','image.end']
        WorkflowDesign.objects.create(team=self.team,client_id=self.fields['design_id'],document={'templateId':'product-images',
            'nodes':[{'id':n,'definitionId':n} for n in ids],
            'edges':[{'source':ids[i],'target':ids[i+1],'kind':'forward'} for i in range(5)]})
        response=self.api.post('/api/v1/product-image-batches',self.fields,format='json')
        self.assertEqual(response.status_code,201,response.data)
        return response.data,generator

    def plan(self,batch,count=1):
        answer={'schema_version':'ProductImagePlan@2','shots':[{'prompt':'Keep the supplied product, change background only',
            'preserve':['shape','color'],'forbidden_changes':['logo','accessories']} for _ in range(count)],'questions':[]}
        with patch('apps.agents.image_service.complete',return_value=(json.dumps(answer),{'harness':{'version':'1.0.4'}})) as harness:
            process_batch(batch['id'])
            self.assertEqual(harness.call_args.kwargs['purpose'],batch['configuration'].get('planner_skill','product_image_batch'))
        return self.api.get('/api/v1/product-image-batches/'+batch['id']).data

    def action(self,batch,action,**kwargs):
        return self.api.post('/api/v1/product-image-batches/'+batch['id'],
            {'action':action,'expected_revision':batch['revision'],**kwargs},format='json')

    def png(self):
        data=io.BytesIO();Image.new('RGB',(1024,1024),'white').save(data,format='PNG');return data.getvalue()

    def test_full_batch_plan_generate_check_deliver_and_refresh_do_not_publish(self):
        batch,generator=self.create(2)
        self.assertEqual(self.api.get('/api/v1/product-image-products').data['count'],1)
        replay=self.api.post('/api/v1/product-image-batches',self.fields,format='json')
        self.assertEqual(replay.data['id'],batch['id']);self.assertEqual(ProductImageBatch.objects.count(),1)
        batch=self.plan(batch,2);self.assertEqual(batch['status'],'plan_ready')
        self.assertEqual(self.action(batch,'generate').status_code,422)
        batch=self.action(batch,'generate',confirmed=True).data
        with patch('apps.agents.image_service.edit',return_value=(self.png(),1024,1024,'fixture-request',{'output_tokens':10})) as transport:
            process_batch(batch['id']);process_batch(batch['id']);process_batch(batch['id'])
            self.assertEqual(transport.call_count,2)
        batch=self.api.get('/api/v1/product-image-batches/'+batch['id']).data
        self.assertEqual(batch['status'],'review');self.assertEqual(len(batch['assets']),2)
        self.assertEqual(self.action(batch,'deliver',confirmed=True,asset_ids=[str(uuid.uuid4())]).status_code,422)
        delivered=self.action(batch,'deliver',confirmed=True,asset_ids=[a['id'] for a in batch['assets']])
        self.assertEqual(delivered.status_code,200,delivered.data)
        self.assertEqual(delivered.data['status'],'delivered')
        self.assertEqual(delivered.data['pack']['schema_version'],'ApprovedProductImagePack@1')
        asset=self.api.get(batch['assets'][0]['url'].replace('/backend','/api'))
        self.assertEqual(asset.status_code,200);self.assertEqual(asset['Content-Type'],'image/png')
        self.assertNotIn('fixture-image-key',json.dumps(delivered.data))
        from apps.teststore.models import PublishedProduct
        self.assertEqual(PublishedProduct.objects.count(),0)

    def test_github_photography_skill_is_pinned_separate_and_can_deliver(self):
        from apps.agents.skills import profile
        batch,_=self.create(planner_skill='product_image_photography')
        self.assertEqual(batch['configuration']['skill_digest'],profile('product_image_photography')['digest'])
        self.assertNotEqual(profile('product_image_batch')['digest'],batch['configuration']['skill_digest'])
        batch=self.plan(batch);batch=self.action(batch,'generate',confirmed=True).data
        with patch('apps.agents.image_service.edit',return_value=(self.png(),1024,1024,'fixture',{})):
            process_batch(batch['id']);process_batch(batch['id'])
        batch=self.api.get('/api/v1/product-image-batches/'+batch['id']).data
        delivered=self.action(batch,'deliver',confirmed=True,asset_ids=[a['id'] for a in batch['assets']])
        self.assertEqual(delivered.status_code,200,delivered.data)
        self.assertEqual(delivered.data['status'],'delivered')

    def test_connection_change_missing_facts_and_expired_lease_never_retry(self):
        batch,generator=self.create();batch=self.plan(batch)
        generator.model_id='different-image';generator.save()
        self.assertEqual(self.action(batch,'generate',confirmed=True).status_code,422)
        ProductImageBatch.objects.filter(pk=batch['id']).update(status='generating',lease_token=uuid.uuid4(),lease_until=timezone.now()-timedelta(seconds=1))
        with patch('apps.agents.image_service.edit') as remote:process_batch(batch['id']);process_batch(batch['id']);remote.assert_not_called()
        self.assertEqual(ProductImageBatch.objects.get(pk=batch['id']).status,'unknown')

    def test_cancel_during_image_call_retains_result_and_blocks_next(self):
        batch,_=self.create(2);batch=self.plan(batch,2);batch=self.action(batch,'generate',confirmed=True).data
        def inflight(*args):
            ProductImageBatch.objects.filter(pk=batch['id']).update(status='stopping')
            return self.png(),1024,1024,'fixture',{}
        with patch('apps.agents.image_service.edit',side_effect=inflight) as remote:
            process_batch(batch['id']);process_batch(batch['id']);self.assertEqual(remote.call_count,1)
        self.assertEqual(ProductImageAsset.objects.count(),1)
        self.assertEqual(ProductImageBatch.objects.get(pk=batch['id']).status,'cancelled')

    def test_unknown_result_and_team_isolation(self):
        batch,_=self.create();batch=self.plan(batch);batch=self.action(batch,'generate',confirmed=True).data
        with patch('apps.agents.image_service.edit',side_effect=ImageResultUnknown('unknown')) as remote:
            process_batch(batch['id']);process_batch(batch['id']);self.assertEqual(remote.call_count,1)
        self.assertEqual(ProductImageBatch.objects.get(pk=batch['id']).status,'unknown')
        other=User.objects.create_user('image-fixture-other');team=Team.objects.create(name='image-other')
        Membership.objects.create(user=other,team=team,role='admin');self.api.force_authenticate(user=other)
        self.assertEqual(self.api.get('/api/v1/product-image-batches/'+batch['id']).status_code,404)
        self.assertEqual(self.api.get('/api/v1/product-image-products').data['count'],0)

    def test_inflight_connection_change_retains_image_and_blocks_next(self):
        batch,generator=self.create(2);batch=self.plan(batch,2);batch=self.action(batch,'generate',confirmed=True).data
        def inflight(*args):
            generator.model_id='changed';generator.save()
            return self.png(),1024,1024,'fixture',{}
        with patch('apps.agents.image_service.edit',side_effect=inflight) as remote:
            process_batch(batch['id']);process_batch(batch['id']);self.assertEqual(remote.call_count,1)
        self.assertEqual(ProductImageAsset.objects.count(),1)
        self.assertEqual(ProductImageBatch.objects.get(pk=batch['id']).status,'failed')

    def test_transport_real_multipart_reference_and_png_with_mock_http(self):
        batch,connection=self.create()
        actual=httpx.Client
        def response(request):
            if request.method=='GET':
                self.assertEqual(str(request.url),'https://cf.cjdropshipping.com/fixture-reference.png')
                self.assertNotIn('Authorization',request.headers)
                return httpx.Response(200,content=self.png(),headers={'content-type':'image/png'})
            self.assertEqual(request.url.path,'/v1/images/edits')
            self.assertEqual(request.headers['Authorization'],'Bearer fixture-image-key')
            self.assertIn(b'gpt-image-2.5-sunburst',request.content)
            self.assertIn(b'product.png',request.content)
            self.assertNotIn(b'fixture-image-key',request.content)
            return httpx.Response(200,headers={'x-request-id':'fixture'},json={'data':[{'b64_json':base64.b64encode(self.png()).decode()}]})
        with patch('apps.agents.image_transport.validate_endpoint'),patch('apps.agents.image_transport.httpx.Client',side_effect=lambda **kw:actual(transport=httpx.MockTransport(response),**kw)):
            data=edit(connection,'https://cf.cjdropshipping.com/fixture-reference.png',{'prompt':'fixture','preserve':[],'forbidden_changes':[]},batch['configuration'])
        self.assertEqual(data[1:3],(1024,1024))

    def test_unpublished_products_bad_shape_and_missing_questions_fail_closed(self):
        batch,_=self.create()
        fields={**self.fields,'product_ids':[str(uuid.uuid4())],'idempotency_key':str(uuid.uuid4()),'design_id':str(uuid.uuid4())}
        self.assertEqual(self.api.post('/api/v1/product-image-batches',fields,format='json').status_code,422)
        with patch('apps.agents.image_service.complete',return_value=('{}',{})):process_batch(batch['id'])
        saved=ProductImageBatch.objects.get(pk=batch['id']);self.assertEqual(saved.status,'failed')
        self.assertEqual(saved.assets.count(),0)

    def test_unresolved_product_questions_stop_before_paid_images(self):
        batch,_=self.create()
        answer={'schema_version':'ProductImagePlan@2','shots':[{'prompt':'Keep product unchanged', 'preserve':['shape'], 'forbidden_changes':['material']}], 'questions':['请确认商品材质']}
        with patch('apps.agents.image_service.complete',return_value=(json.dumps(answer),{})), patch('apps.agents.image_service.edit') as remote:
            process_batch(batch['id']);process_batch(batch['id'])
            remote.assert_not_called()
        self.assertEqual(ProductImageBatch.objects.get(pk=batch['id']).status,'needs_info')

    @skipUnless(os.environ.get('COMMERCE_IMAGE_SMOKE_FILE'), 'Optional real-image fixture; no provider call')
    def test_real_generated_artifact_through_mock_transport_and_delivery(self):
        """Real PNG, isolated catalog and simulated Pi/HTTP. Not paid-provider acceptance."""
        from apps.agents.image_transport import validate_png
        content=Path(os.environ['COMMERCE_IMAGE_SMOKE_FILE']).read_bytes()
        dimensions=validate_png(content)
        batch,_=self.create(planner_skill='product_image_photography');batch=self.plan(batch)
        batch=self.action(batch,'generate',confirmed=True).data
        actual=httpx.Client
        def response(request):
            self.assertEqual(request.url.path,'/v1/images/edits')
            self.assertIn(b'product.png',request.content)
            return httpx.Response(200,headers={'x-request-id':'external-artifact-smoke-only'},
                json={'data':[{'b64_json':base64.b64encode(content).decode()}]})
        with patch('apps.agents.image_transport.httpx.Client',side_effect=lambda **kw:actual(transport=httpx.MockTransport(response),**kw)):
            process_batch(batch['id']);process_batch(batch['id'])
        batch=self.api.get('/api/v1/product-image-batches/'+batch['id']).data
        if dimensions!=(1024,1024):
            self.assertEqual(batch['status'],'failed')
            self.assertIn('尺寸不匹配',batch['error'])
            self.assertEqual(batch['assets'],[])
            self.assertEqual(self.action(batch,'deliver',confirmed=True).status_code,422)
            return
        self.assertEqual(batch['status'],'review')
        asset=self.api.get(batch['assets'][0]['url'].replace('/backend','/api'))
        self.assertEqual(b''.join(asset.streaming_content),content)
        delivered=self.action(batch,'deliver',confirmed=True,asset_ids=[batch['assets'][0]['id']])
        self.assertEqual(delivered.status_code,200,delivered.data)
        self.assertEqual(delivered.data['status'],'delivered')
        self.assertEqual(delivered.data['pack']['schema_version'],'ApprovedProductImagePack@1')
        from apps.teststore.models import PublishedProduct
        self.assertEqual(PublishedProduct.objects.count(),0)

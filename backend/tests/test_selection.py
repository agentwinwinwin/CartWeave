from copy import deepcopy
from datetime import timedelta
from unittest.mock import patch
from django.test import TestCase
from django.contrib.auth.models import User
from django.utils import timezone
from rest_framework.test import APIClient
from apps.identity.models import Team, Membership
from apps.connections.models import SupplierConnection
from apps.runtime.models import SelectionTask
from apps.runtime.selection import process_selection, due_selection_tasks, selected_brief, verify_selection_brief
from apps.common.errors import RuleError
from contracts.assets import allowed_image


class SelectionTests(TestCase):
    def test_expanded_limits_and_durable_pagination(self):
        from contracts.selection import SelectionQuery
        from apps.runtime.selection import collect_page
        q = SelectionQuery(**{**self.query, 'limit':100, 'variants_per_product':20})
        result = self.api.post('/api/v1/selections', q.model_dump(mode='json'), format='json')
        self.assertEqual(result.status_code,201,result.data)
        task = SelectionTask.objects.get(pk=result.data['id'])
        def page(task,path,**kwargs):
            self.assertEqual(path,'/product/listV2')
            self.assertEqual(kwargs['params']['size'],20)
            start=(kwargs['params']['page']-1)*20
            return {'content':[{'productList':[{'id':f'pid-{i}','nameEn':'Hat','sku':f'SKU-{i}'} for i in range(start,start+20)]}]}
        with patch('apps.runtime.selection.preview',return_value={'outcome':'results','products':[{'id':f'pid-{i}'} for i in range(20)],'attempts':[]}), patch('apps.runtime.selection.read',side_effect=page) as remote:
            state=None
            for index in range(5):
                state, more=collect_page(task,q,state)
                self.assertEqual(more,index<4)
            self.assertEqual(len(state['products']),100)
            self.assertEqual(len({r['id'] for r in state['products']}),100)
            self.assertFalse(state['preview_only'])
            self.assertEqual(remote.call_count,4)

    def test_pagination_preserves_category_quotas_and_deduplicates(self):
        from contracts.selection import SelectionQuery
        from apps.runtime.selection import collect_page
        q=SelectionQuery(**{**self.query,'keyword':'','limit':50,'candidateSource':'trending','categoryQueries':[{'categoryId':'a'},{'categoryId':'b'}]})
        task=SelectionTask.objects.create(team=self.team,requested_by=self.user,query=q.model_dump(mode='json'),connection_version=1)
        def first(member,query,**kwargs):
            self.assertEqual(query.candidateSource, 'trending')
            return {'outcome':'results','products':[{'id':f'{query.categoryId}-{i}'} for i in range(20)],'attempts':[]}
        def next_page(task,path,**kwargs):
            category=kwargs['params']['categoryId']
            self.assertEqual(kwargs['params']['page'],2)
            self.assertEqual(kwargs['params']['verifiedWarehouse'],1)
            self.assertEqual(kwargs['params']['productFlag'],0)
            self.assertEqual(kwargs['params']['orderBy'],0)
            return {'content':[{'productList':[{'id':f'{category}-{i}'} for i in range(20,40)]}]}
        with patch('apps.runtime.selection.preview',side_effect=first),patch('apps.runtime.selection.read',side_effect=next_page):
            state=None
            for i in range(4):
                state,more=collect_page(task,q,deepcopy(state))
                self.assertEqual(more,i<3)
            self.assertEqual([len(g['products']) for g in state['groups']],[25,25])
            self.assertEqual(len(state['products']),50)
        # A repeating upstream page cannot cause an unbounded crawl or invented candidates.
        q=SelectionQuery(**{**self.query,'limit':100,'candidateSource':'trending'})
        with patch('apps.runtime.selection.preview',side_effect=first),patch('apps.runtime.selection.read',return_value={'content':[{'productList':[{'id':f'-{i}'} for i in range(20)]}]}) as remote:
            state=None
            for _ in range(5):state,more=collect_page(task,q,state)
            self.assertFalse(more)
            self.assertEqual(len(state['products']),20)
            self.assertEqual(remote.call_count,4)

    def test_factory_search_does_not_exclude_factory_supply(self):
        from apps.runtime.selection import collect_page
        from contracts.selection import SelectionQuery
        q=SelectionQuery(**{**self.query,'allow_factory_supply':True})
        task=SelectionTask(team=self.team,requested_by=self.user,query=q.model_dump(mode='json'),connection_version=1)
        with patch('apps.runtime.selection.preview',return_value={'outcome':'results'}) as preview:
            collect_page(task,q)
        self.assertFalse(preview.call_args.kwargs['stock_only'])

    def test_more_than_five_variants_are_actually_researched(self):
        result=self.api.post('/api/v1/selections',{**self.query,'variants_per_product':20},format='json')
        self.assertEqual(result.status_code,201,result.data)
        task=SelectionTask.objects.get(pk=result.data['id'])
        def remote(task,path,**kwargs):
            payload=self.remote(task,path,**kwargs)
            if path=='/product/query':payload['variants']=[{'vid':f'vid-{i}'} for i in range(7)]
            if path=='/product/variant/queryByVid':payload['vid']=kwargs['params']['vid']
            return payload
        with patch('apps.runtime.selection.preview',return_value={'outcome':'results','products':[{'id':'pid-1'}],'attempts':[]}),patch('apps.runtime.selection.read',side_effect=remote):
            for _ in range(40):
                process_selection(task.id)
                task.refresh_from_db()
                if task.status not in ('queued','running'):break
        self.assertEqual(task.status,'ready',task.error)
        self.assertEqual(len(task.candidates),7)
        self.assertTrue(all(row['omitted_variants']==0 for row in task.candidates))

    def setUp(self):
        self.user = User.objects.create_user('selection-user')
        self.team = Team.objects.create(name='selection-team')
        Membership.objects.create(team=self.team, user=self.user, role='admin')
        self.connection = SupplierConnection.objects.create(team=self.team, provider='cj', status='verified',
            token_expires_at=timezone.now()+timedelta(days=1), configuration_version=1)
        self.api = APIClient()
        self.api.force_authenticate(user=self.user)
        self.query = {'market':'US', 'requestedCurrency':'USD', 'keyword':'hat', 'limit':1,
                      'fee_percent':'3', 'margin_percent':'30', 'tax_reserve_usd':'2', 'variants_per_product':1}

    def remote(self, task, path, **kwargs):
        if path == '/product/query':
            return {'pid':'pid-1','productNameEn':'Verified hat', 'productImage':'https://oss-cf.cjdropshipping.com/product/hat.jpg',
                    'variants':[{'vid':'vid-1'}, {'vid':'vid-2'}]}
        if path == '/product/variant/queryByVid':
            return {'pid':'pid-1','vid':'vid-1','variantSku':'CJ-SKU-1','variantKey':'Black', 'variantSellPrice':'5.00',
                    'inventories':[{'countryCode':'CN','totalInventory':500,'cjInventory':100,'factoryInventory':400,'verifiedWarehouse':1}]}
        if path == '/logistic/freightCalculate':
            self.assertEqual(kwargs['method'],'POST')
            self.assertEqual(kwargs['json']['startCountryCode'],'CN')
            self.assertEqual(kwargs['json']['endCountryCode'],'US')
            return [{'logisticPrice':'4.00','logisticName':'CJPacket','logisticAging':'7-12'}]
        raise AssertionError(path)

    def run_task(self, overrides=None, remote=None):
        result = self.api.post('/api/v1/selections', {**self.query, **(overrides or {})}, format='json')
        self.assertEqual(result.status_code,201,result.data)
        task = SelectionTask.objects.get(pk=result.data['id'])
        with patch('apps.runtime.selection.preview',return_value={'outcome':'results','products':[{'id':'pid-1'}],'attempts':[]}), patch('apps.runtime.selection.read',side_effect=remote or self.remote):
            for _ in range(15):
                process_selection(task.id)
                task.refresh_from_db()
                if task.status not in ('queued','running'):
                    break
        return task

    def test_full_selection_handoff_and_proof_integrity(self):
        task = self.run_task()
        self.assertEqual(task.status,'ready',task.error)
        row=task.candidates[0]
        self.assertEqual(row['landed_cost'],'11.00')
        self.assertEqual(row['suggested_price'],'16.42')
        self.assertEqual(row['omitted_variants'],1)
        self.assertEqual(row['inventory'],100)
        brief=selected_brief(task,'vid-1')
        self.assertEqual(brief['source_kind'],'cj_selection')
        self.assertEqual(brief['variants'][0]['cj_vid'],'vid-1')
        verify_selection_brief(self.team,brief)
        modified=deepcopy(brief)
        modified['variants'][0]['price']='0.01'
        with self.assertRaises(RuleError):verify_selection_brief(self.team,modified)
        self.connection.configuration_version=2
        self.connection.save()
        with self.assertRaises(RuleError):selected_brief(task,'vid-1')

    def test_missing_taxes_or_unverified_inventory_cannot_publish(self):
        task=self.run_task({'tax_reserve_usd':None})
        self.assertEqual(task.status,'needs_attention')
        self.assertEqual(task.candidates[0]['status'],'needs_review')
        with self.assertRaises(RuleError):selected_brief(task,'vid-1')
        def unverified(task,path,**kwargs):
            result=self.remote(task,path,**kwargs)
            if path=='/product/variant/queryByVid':result['inventories'][0]['verifiedWarehouse']=2
            return result
        other=self.run_task(remote=unverified)
        self.assertEqual(other.status,'needs_attention')
        self.assertEqual(other.candidates[0]['status'],'rejected')

    def test_bounded_validation_and_tenant_isolation(self):
        self.assertEqual(self.api.post('/api/v1/selections',{**self.query,'limit':101},format='json').status_code,400)
        self.assertEqual(self.api.post('/api/v1/selections',{**self.query,'variants_per_product':21},format='json').status_code,400)
        self.assertEqual(self.api.post('/api/v1/selections',{**self.query,'strategy':'upload.py'},format='json').status_code,400)
        task=self.run_task()
        outsider=User.objects.create_user('other-selection')
        other=Team.objects.create(name='other')
        Membership.objects.create(team=other,user=outsider,role='admin')
        self.api.force_authenticate(user=outsider)
        self.assertEqual(self.api.get(f'/api/v1/selections/{task.id}').status_code,404)
        with self.assertRaises(RuleError):verify_selection_brief(other,selected_brief(task,'vid-1'))

    def factory_remote(self, task, path, **kwargs):
        result = self.remote(task, path, **kwargs)
        if path == '/product/variant/queryByVid':
            result['inventories'] = [{'countryCode':'CN', 'totalInventory':28707,
                'cjInventory':0, 'factoryInventory':28707, 'verifiedWarehouse':2}]
        return result

    def test_factory_supply_requires_opt_in_and_explicit_assumptions(self):
        denied = self.run_task(remote=self.factory_remote)
        self.assertEqual(denied.candidates[0]['status'], 'rejected')
        research = self.run_task({'allow_factory_supply':True}, self.factory_remote)
        self.assertEqual(research.status, 'needs_attention')
        self.assertEqual(research.candidates[0]['shipping_cost'], '4.00')
        self.assertEqual(research.candidates[0]['status'], 'needs_review')
        with self.assertRaises(RuleError): selected_brief(research, 'vid-1')
        task = self.run_task({'allow_factory_supply':True, 'factory_processing_days':3,
                             'factory_sale_limit':10}, self.factory_remote)
        self.assertEqual(task.status, 'ready', task.error)
        row = task.candidates[0]
        self.assertEqual(row['factory_reported_quantity'], 28707)
        self.assertEqual(row['inventory'], 10)
        self.assertEqual(row['estimated_total_days'], 15)
        self.assertEqual(row['inventory_evidence'][0]['cjInventory'], 0)
        brief = selected_brief(task, 'vid-1')
        verify_selection_brief(self.team, brief)
        from types import SimpleNamespace
        from apps.runtime.services import review_enabled
        run = SimpleNamespace(context={'brief':brief}, version=SimpleNamespace(document={'nodes':[
            {'binding':{'parameters':{'approvalEnabled':False}}} for _ in range(4)]}))
        self.assertTrue(review_enabled(run, 'brief'))
        self.assertTrue(review_enabled(run, 'listing'))

    def test_factory_handling_time_and_parameter_bounds(self):
        task = self.run_task({'allow_factory_supply':True, 'factory_processing_days':9,
                             'factory_sale_limit':10, 'maximum_days':20}, self.factory_remote)
        self.assertEqual(task.candidates[0]['status'], 'rejected')
        for patch_data in [{'allow_factory_supply':'true'}, {'factory_processing_days':-1},
                           {'factory_processing_days':61}, {'factory_sale_limit':0}, {'factory_sale_limit':1001}]:
            self.assertEqual(self.api.post('/api/v1/selections', {**self.query, **patch_data}, format='json').status_code, 400)

    def test_no_results_stops_and_expired_lease_is_recoverable(self):
        result=self.api.post('/api/v1/selections',self.query,format='json')
        pk=result.data['id']
        self.assertEqual(self.api.post('/api/v1/selections',self.query,format='json').status_code,409)
        SelectionTask.objects.filter(pk=pk).update(status='running',lease_until=timezone.now()-timedelta(seconds=1))
        self.assertIn(str(pk),[str(x) for x in due_selection_tasks()])
        with patch('apps.runtime.selection.preview',return_value={'outcome':'no_results'}):process_selection(pk)
        task=SelectionTask.objects.get(pk=pk)
        self.assertEqual(task.status,'needs_attention')
        self.assertEqual(task.candidates,[])

    def test_media_allowlist_is_not_arbitrary_remote_fetch(self):
        for url in ['http://oss-cf.cjdropshipping.com/a.jpg','https://oss-cf.cjdropshipping.com.evil.com/a.jpg',
                    'https://127.0.0.1/a.jpg','https://user@oss-cf.cjdropshipping.com/a.jpg']:
            self.assertFalse(allowed_image(url))
        self.assertTrue(allowed_image('https://oss-cf.cjdropshipping.com/product/a.jpg'))

    def test_selection_to_two_approvals_and_actual_store_api(self):
        import hashlib
        from apps.connections.models import Store
        from apps.connections.services import encrypt
        from apps.skills.models import SkillVersion
        from apps.skills.handlers import handler_hash
        from apps.registry.definitions import template
        from apps.workflows.models import WorkflowDraft
        from apps.workflows.services import freeze
        from apps.runtime.services import start_run, due_jobs, process_job, decide
        from apps.teststore.models import ApiClient as StoreClient, PublishedProduct
        from tests.test_publication import TestAdapter
        task=self.run_task()
        brief=selected_brief(task,'vid-1')
        skill=SkillVersion.objects.create(team=self.team,key='content.editorial',version='test',handler='content.editorial.v1',
            artifact_hash=handler_hash('content.editorial.v1'),status='approved',reviewed_by=self.user,
            reviewed_at=timezone.now(),review_note='Deterministic formatter reviewed for integration test')
        store=Store.objects.create(team=self.team,name='selection-test',verified=True,
            capabilities=['listing.validate','listing.publish','listing.wait'],credential_ciphertext=encrypt('test-adapter-token'))
        StoreClient.objects.create(name='selection-store',storefront_id=store.id,token_hash=hashlib.sha256(b'test-adapter-token').hexdigest())
        draft=WorkflowDraft.objects.create(team=self.team,title='selection',document=template(skill),skill=skill)
        version=freeze(draft,1)
        run,_=start_run(version,store,self.user,brief,'selection-integration')
        with patch.dict('apps.integrations.registry.ADAPTERS',{'test-store.v1':TestAdapter}):
            for _ in range(20):
                for job in list(due_jobs()):process_job(job)
                run.refresh_from_db()
                if run.status=='waiting_approval':
                    request=run.approvals.get(status='pending')
                    decide(request,self.user,'approve','Test fixture CJ responses; no procurement.',run.revision)
                elif run.status in ('succeeded','needs_attention'):break
        run.refresh_from_db()
        self.assertEqual(run.status,'succeeded',run.error)
        self.assertEqual(run.approvals.filter(status='approved').count(),2)
        self.assertEqual(PublishedProduct.objects.get().payload['variants'][0]['cj_vid'],'vid-1')
        self.assertEqual(PublishedProduct.objects.get().payload['images'],brief['images'])

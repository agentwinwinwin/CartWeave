from unittest.mock import patch
from django.test import SimpleTestCase, TestCase
from django.utils import timezone
from apps.skills.opportunity_orders import normalize, propose
from apps.skills.models import SkillVersion
from apps.skills.registry import handler_hash
from apps.teststore.models import PublishedProduct
from apps.runtime.models import SelectionTask
from apps.runtime.services import due_jobs,process_job
from .test_cj_opportunity import CJWorkflowTests


class CJOrderAlgorithmTests(SimpleTestCase):
    def test_demand_quota_replenishes_low_unknown_duplicate_and_existing(self):
        from types import SimpleNamespace
        from apps.runtime.demand_collection import collect
        from apps.connections.cj_catalog import ProductSearch
        task=SimpleNamespace(team='team',requested_by='user',query={'batch_target':10,'scan_budget':20,'demand_quota':True,'minimum_cj_order_count':5})
        query=ProductSearch(limit=10,keyword='hat',market='US',requestedCurrency='USD')
        first=[{'id':str(i)} for i in range(20)]
        pages={2:[{'id':str(i)} for i in range(20,40)],3:[{'id':str(i)} for i in range(39,59)]}
        def remote(task,path,**kwargs):
            if path=='/product/listV2':return {'content':[{'productList':pages[kwargs['params']['page']]}]}
            pid=kwargs['json']['id']
            return {'id':pid,'orderCount':None if pid=='1' else 0 if int(pid)<20 else 10}
        state=None;products=[]
        with patch('apps.identity.models.Membership.objects.get'),patch('apps.runtime.selection.preview',return_value={'outcome':'results','products':first,'attempts':[{'keyword':'hat'}]}),patch('apps.runtime.selection.read',side_effect=remote),patch('apps.runtime.existing_products.task_blocked_pids',return_value={'20','21'}):
            for _ in range(100):
                state,more=collect(task,query,state)
                if not more:
                    products.extend(state['products'])
                    if not state.get('continuation'):break
        self.assertFalse(more)
        self.assertEqual(state['termination'],'demand_quota')
        self.assertEqual(state['demand_qualified'],20)
        self.assertEqual(state['quota_limit'],20)
        self.assertIsNone(state['scan_limit'])
        self.assertEqual(len(products),20)
        self.assertEqual(len({p['id'] for p in products}),20)
        self.assertEqual(len(state['rejected']),20)
        self.assertEqual(state['scanned'],40)
        self.assertEqual(len(state['excluded_existing']),2)

    def test_demand_quota_stops_at_directory_without_filling_missing_slots(self):
        from types import SimpleNamespace
        from apps.runtime.demand_collection import collect
        from apps.connections.cj_catalog import ProductSearch
        task=SimpleNamespace(team='team',requested_by='user',query={'batch_target':10,'scan_budget':20,'demand_quota':True})
        query=ProductSearch(limit=10,market='US',requestedCurrency='USD')
        state=None
        with patch('apps.identity.models.Membership.objects.get'),patch('apps.runtime.selection.preview',return_value={'outcome':'results','products':[{'id':'a'},{'id':'b'}],'attempts':[]}),patch('apps.runtime.selection.read',side_effect=lambda task,path,**kw:{'id':kw['json']['id'],'orderCount':10 if kw['json']['id']=='a' else 0}):
            for _ in range(10):
                state,more=collect(task,query,state)
                if not more:break
        self.assertFalse(more)
        self.assertEqual(state['termination'],'directory')
        self.assertEqual(state['demand_qualified'],1)
        self.assertEqual(len(state['products']),1)

    def test_demand_quota_repeated_full_page_stops_without_infinite_requests(self):
        from types import SimpleNamespace
        from apps.runtime.demand_collection import collect
        from apps.connections.cj_catalog import ProductSearch
        task=SimpleNamespace(team='team',requested_by='user',query={'batch_target':10,'scan_budget':20,'demand_quota':True})
        query=ProductSearch(limit=10,market='US',requestedCurrency='USD')
        products=[{'id':str(i)} for i in range(20)]
        def remote(task,path,**kwargs):
            if path=='/product/listV2':return {'content':[{'productList':products}]}
            return {'id':kwargs['json']['id'],'orderCount':0}
        state=None
        with patch('apps.identity.models.Membership.objects.get'),patch('apps.runtime.selection.preview',return_value={'outcome':'results','products':products,'attempts':[]}),patch('apps.runtime.selection.read',side_effect=remote) as reader:
            for _ in range(60):
                state,more=collect(task,query,state)
                if not more:break
        self.assertFalse(more)
        self.assertEqual(state['termination'],'duplicate_page')
        self.assertEqual(state.get('demand_qualified',0),0)
        self.assertEqual(reader.call_count,21)

    def test_explicit_budget_and_directory_end_are_distinct(self):
        from types import SimpleNamespace
        from apps.runtime.demand_collection import collect
        from apps.connections.cj_catalog import ProductSearch
        for count,ending in ((20,'budget'),(3,'directory')):
            with self.subTest(ending=ending):
                task=SimpleNamespace(team='team',requested_by='user',query={'batch_target':10,'scan_budget':20})
                query=ProductSearch(limit=10,keyword='hat',market='US',requestedCurrency='USD')
                products=[{'id':str(i)} for i in range(count)]
                state=None
                with patch('apps.identity.models.Membership.objects.get'),patch('apps.runtime.selection.preview',return_value={'outcome':'results','products':products,'attempts':[]}),patch('apps.runtime.selection.read',side_effect=lambda task,path,**kw:{'id':kw['json']['id'],'orderCount':0}):
                    for _ in range(30):
                        state,more=collect(task,query,state)
                        if not more:break
                self.assertFalse(more)
                self.assertEqual(state['termination'],ending)
                self.assertEqual(state['scan_limit'],20)
                self.assertEqual(state['products'],[])

    def test_scan_budget_accepts_only_bounded_integer(self):
        from contracts.selection import SelectionQuery
        from pydantic import ValidationError
        base={'fee_percent':'3','margin_percent':'30'}
        for value in (19,10001,20.5,True):
            with self.subTest(value=value),self.assertRaises(ValidationError):
                SelectionQuery(**base,scan_budget=value)
        self.assertEqual(SelectionQuery(**base,scan_budget=1000).scan_budget,1000)

    def test_keyword_is_preserved_across_demand_pages(self):
        from types import SimpleNamespace
        from apps.runtime.demand_collection import collect
        from apps.connections.cj_catalog import ProductSearch
        task=SimpleNamespace(team='team',requested_by='user',query={'batch_target':10})
        query=ProductSearch(limit=10,market='US',requestedCurrency='USD',keyword='hat',categoryQueries=[])
        records=[{'id':str(i)} for i in range(20)]
        def read(task,path,**kwargs):
            if path=='/product/listV2':
                self.assertEqual(kwargs['params'],{'page':2,'size':20,'keyWord':'hat'})
                return {'content':[{'productList':[]}]}
            return {'id':kwargs['json']['id'],'orderCount':10}
        with patch('apps.identity.models.Membership.objects.get'),patch('apps.runtime.selection.preview',return_value={'outcome':'results','products':records,'attempts':[{'keyword':'hat'}]}) as first,patch('apps.runtime.selection.read',side_effect=read):
            state=None
            for _ in range(30):
                state,more=collect(task,query,state)
                if not more:break
        self.assertFalse(more);self.assertEqual(first.call_args.args[1].keyword,'hat')
        self.assertEqual(first.call_args.args[1].categoryId,'')

    def test_demand_is_checked_before_quota_and_spec_research(self):
        from types import SimpleNamespace
        from apps.runtime.demand_collection import collect
        from apps.connections.cj_catalog import ProductSearch
        task=SimpleNamespace(team='team',requested_by='user',query={'minimum_cj_order_count':1})
        query=ProductSearch(limit=1,market='US',requestedCurrency='USD')
        products=[{'id':p} for p in ('zero','unknown','low','high')]
        calls=[]
        def remote(task,path,**kwargs):
            calls.append(path);pid=kwargs['json']['id']
            return {'id':pid,'soldOut':None,'orderCount':{'zero':0,'unknown':None,'low':2,'high':50}[pid]}
        state=None
        with patch('apps.identity.models.Membership.objects.get'),patch('apps.runtime.selection.preview',return_value={'outcome':'results','products':products,'attempts':[]}) as first,patch('apps.runtime.selection.read',side_effect=remote):
            for _ in range(10):
                state,more=collect(task,query,state)
                if not more:break
        self.assertFalse(more)
        self.assertEqual([p['id'] for p in state['products']],['high'])
        self.assertEqual(state['scanned'],4)
        self.assertEqual(len(state['rejected']),2)
        self.assertEqual(calls,['/product/productDetail/query']*4)
        self.assertFalse(first.call_args.kwargs['stock_only'])
        self.assertFalse(state['preview_only'])

    def test_repeated_pages_are_bounded_and_not_researched_twice(self):
        from types import SimpleNamespace
        from apps.runtime.demand_collection import collect
        from apps.connections.cj_catalog import ProductSearch
        task=SimpleNamespace(team='team',requested_by='user',query={})
        query=ProductSearch(limit=10,market='US',requestedCurrency='USD')
        products=[{'id':str(i)} for i in range(20)]
        def remote(task,path,**kwargs):
            if path=='/product/listV2':return {'content':[{'productList':products}]}
            return {'id':kwargs['json']['id'],'orderCount':0}
        state=None
        with patch('apps.identity.models.Membership.objects.get'),patch('apps.runtime.selection.preview',return_value={'outcome':'results','products':products,'attempts':[]}),patch('apps.runtime.selection.read',side_effect=remote) as reader:
            for _ in range(100):
                state,more=collect(task,query,state)
                if not more:break
        self.assertFalse(more);self.assertEqual(state['scanned'],20)
        self.assertEqual(state['scan_limit'],50);self.assertEqual(state['products'],[])
        self.assertEqual(sum(c.args[1]=='/product/productDetail/query' for c in reader.call_args_list),20)
        self.assertEqual(sum(c.args[1]=='/product/listV2' for c in reader.call_args_list),2)

    def test_multi_category_unused_quota_is_not_transferred(self):
        from types import SimpleNamespace
        from apps.runtime.demand_collection import collect
        from apps.connections.cj_catalog import ProductSearch
        task=SimpleNamespace(team='team',requested_by='user',query={})
        query=ProductSearch(limit=4,market='US',requestedCurrency='USD',categoryQueries=[{'categoryId':'a'},{'categoryId':'b'}])
        def first(member,q,**kwargs):
            return {'outcome':'results','products':[{'id':'shared'}] if q.categoryId=='a' else [{'id':p} for p in ('shared','b1','b2','b3')],'attempts':[]}
        def remote(task,path,**kwargs):return {'id':kwargs['json']['id'],'orderCount':10}
        state=None
        with patch('apps.identity.models.Membership.objects.get'),patch('apps.runtime.selection.preview',side_effect=first),patch('apps.runtime.selection.read',side_effect=remote) as reader:
            for _ in range(20):
                state,more=collect(task,query,state)
                if not more:break
        self.assertFalse(more);self.assertEqual([len(g['products']) for g in state['groups']],[1,2])
        self.assertEqual(len(state['products']),3);self.assertEqual(reader.call_count,4)
    def test_null_sales_does_not_block_valid_orders_or_rename_them_sales(self):
        evidence=[normalize({'id':pid,'soldOut':None,'orderCount':orders,'listed':999},pid,timezone.now().isoformat()) for pid,orders in [('low',2),('high',100)]]
        rows=[{'pid':p,'vid':p,'landed_cost':10,'inventory':50,'total_days':10,'supply_type':'cj_stock'} for p in ('low','high')]
        result=propose(rows,{'fee_percent':'3','margin_percent':'30'},evidence)
        self.assertEqual(result['recommended_vid'],'high')
        self.assertEqual(result['ranked'][0]['order_count'],100)
        self.assertNotIn('sales_90d',result['ranked'][0])
        self.assertIsNone(result['evidence'][0]['order_window_days'])
        self.assertEqual(result['algorithm'],'product.opportunity.v4')

    def test_missing_orders_not_replaced_by_sales_or_listings(self):
        rows=[{'pid':'p','vid':'v','landed_cost':10,'inventory':50,'total_days':10,'supply_type':'cj_stock'}]
        for count in (None,0):
            fact=normalize({'id':'p','soldOut':999,'orderCount':count,'listed':999},'p',timezone.now().isoformat())
            self.assertIsNone(propose(rows,{'fee_percent':'3','margin_percent':'30'},[fact])['recommended_vid'])
        for count in (True,-1,'5'):
            with self.assertRaises(ValueError):normalize({'id':'p','orderCount':count},'p',timezone.now().isoformat())


class CJOrderWorkflowTests(TestCase):
    setUp=CJWorkflowTests.setUp
    document=CJWorkflowTests.document
    create_release=CJWorkflowTests.create_release
    run_release=CJWorkflowTests.run_release
    advance=CJWorkflowTests.advance

    def remote(self,task,path,**kwargs):
        if path=='/product/productDetail/query':return {'id':'pid-1','soldOut':None,'orderCount':self.orders,'listed':500}
        from .test_launch_workflow import LaunchWorkflowTests
        return LaunchWorkflowTests.remote(self,task,path,**kwargs)

    def configured(self,orders=224):
        self.orders=orders
        skill=SkillVersion.objects.create(team=self.team,key='product.opportunity',version='4.0.0',handler='product.opportunity.v4',artifact_hash=handler_hash('product.opportunity.v4'),status='approved',reviewed_by=self.user,reviewed_at=timezone.now(),review_note='Reviewed order-count fixture.')
        doc=self.document();doc['nodes'][0]['binding']['parameters'].update(marketEvidenceSource='cj',minimumCJOrderCount=1,candidateSource='catalog')
        doc['nodes'][5]['binding'].update(skillId=f'registered.{skill.id}',skillVersion='4.0.0',parameters={})
        return doc

    def test_catalog_to_publication_with_null_sales_uses_true_order_count(self):
        run=self.run_release(self.create_release(self.configured()))
        self.advance(run)
        self.assertEqual(run.status,'succeeded',run.error)
        self.assertEqual(run.context['selection']['sales_ranking'][0]['order_count'],224)
        self.assertEqual(run.context['selection_proposal']['ranked'][0]['order_count'],224)
        self.assertNotIn('sales_90d',run.context['selection_proposal']['ranked'][0])
        self.assertEqual(run.approvals.filter(status='approved').count(),2)
        self.assertEqual(PublishedProduct.objects.count(),1)
        self.assertIn('统计周期',run.context['brief']['source_note'])

    def test_demand_first_full_flow_reuses_evidence_before_inventory(self):
        doc=self.configured();doc['nodes'][0]['binding']['parameters']['demandFirstCollection']=True
        run=self.run_release(self.create_release(doc));self.advance(run)
        self.assertEqual(run.status,'succeeded',run.error)
        self.assertEqual(run.context['selection']['search']['scanned'],1)
        self.assertEqual(run.context['selection']['records'][0]['demand_evidence']['order_count'],224)
        self.assertEqual(PublishedProduct.objects.count(),1)

    def test_new_submission_after_selection_blocks_publish(self):
        from apps.runtime.models import WorkflowRun
        from apps.listings.models import ExternalOperation
        doc=self.configured();doc['nodes'][0]['binding']['parameters']['demandFirstCollection']=True
        release=self.create_release(doc);run=self.run_release(release)
        self.advance(run,False);self.assertEqual(run.status,'waiting_approval')
        # Simulate another durable remote submission appearing after selection.
        other=WorkflowRun.objects.create(team=self.team,store=self.store,store_version=1,
            version=run.version,requested_by=self.user,idempotency_key='late-submission-fixture',
            request_digest='a'*64,context={'brief':run.context['brief']})
        ExternalOperation.objects.create(team=self.team,store=self.store,run=other,key='late-publication',
            request_digest='b'*64,status='unknown',payload={'schema_version':'ListingDraft@1'})
        from apps.common.errors import RuleError
        # The shared helper replays a stopped node for diagnostics. The worker
        # must persist the failure and that replay must still reject the action.
        with self.assertRaises(RuleError):self.advance(run)
        for job in list(due_jobs()):process_job(job)
        run.refresh_from_db()
        self.assertEqual(run.status,'needs_attention')
        self.assertIn('重复提交',run.error)
        self.assertEqual(PublishedProduct.objects.count(),0)
        self.assertFalse(ExternalOperation.objects.filter(run=run).exists())

    def test_missing_or_zero_orders_pauses_without_inventory_calls(self):
        run=self.run_release(self.create_release(self.configured(None)))
        with patch('apps.runtime.selection.preview',return_value={'outcome':'results','products':[{'id':'pid-1'}],'attempts':[]}),patch('apps.runtime.selection.read',side_effect=self.remote) as remote:
            for _ in range(12):
                for job in list(due_jobs()):process_job(job)
                run.refresh_from_db()
                if run.status=='needs_attention':break
            self.assertFalse(any(c.args[1]=='/product/variant/queryByVid' for c in remote.call_args_list))
        self.assertEqual(run.status,'needs_attention')
        self.assertIn('订单数',run.error)
        self.assertEqual(PublishedProduct.objects.count(),0)

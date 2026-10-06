from unittest.mock import patch
from datetime import timedelta
from django.test import TestCase,SimpleTestCase,override_settings
from django.utils import timezone
from apps.skills.models import SkillVersion
from apps.skills.registry import handler_hash
from apps.connections.models import SupplierConnection
from apps.skills.opportunity_cj import normalize,propose
from apps.teststore.models import PublishedProduct
from apps.runtime.services import due_jobs,process_job
from . import test_launch_workflow as launch_tests

class CJAlgorithmTests(SimpleTestCase):
    def test_sales_has_highest_weight_without_changing_approved_algorithm(self):
        now=timezone.now().isoformat()
        facts=[normalize({'id':p,'soldOut':sales,'listed':9999},p,now) for p,sales in [('low',5),('high',100)]]
        rows=[{'pid':p,'vid':p,'landed_cost':10,'inventory':50,'total_days':10,'supply_type':'cj_stock'} for p in ('low','high')]
        result=propose(rows,{'fee_percent':'3','margin_percent':'30'},facts)
        self.assertEqual(result['recommended_vid'],'high')
        self.assertEqual(result['ranked'][0]['score'],'100.0000')
        self.assertEqual(result['ranked'][1]['score'],'57.2500')

    def test_null_never_becomes_sales_and_ranking_uses_ninety_days(self):
        fact=normalize({'id':'p','soldOut':None,'listed':500,'orderCount':1000},'p',timezone.now().isoformat())
        rows=[{'pid':'p','vid':'v','landed_cost':10,'inventory':50,'total_days':10,'supply_type':'cj_stock'}]
        q={'fee_percent':'3','margin_percent':'30'}
        self.assertIsNone(propose(rows,q,[fact])['recommended_vid'])
        fact['sales_90d']=5
        result=propose(rows,q,[fact]);self.assertEqual(result['recommended_vid'],'v')
        self.assertEqual(result['ranked'][0]['suggested_price'],'14.93')
        self.assertIn('目标国家销量',result['unknowns'])
        with self.assertRaises(ValueError):normalize({'id':'other'},'p',timezone.now().isoformat())
        with self.assertRaises(ValueError):normalize({'id':'p','soldOut':True},'p',timezone.now().isoformat())

class CJWorkflowTests(TestCase):
    def test_sales_read_before_filter_and_sorted_without_unknown_as_zero(self):
        doc=self.configured();doc['nodes'][0]['binding']['parameters'].update(candidateSource='catalog',limit=3)
        run=self.run_release(self.create_release(doc))
        sales={'low':5,'unknown':None,'high':100}
        def read(task,path,**kw):
            if path=='/product/productDetail/query':
                pid=kw['json']['id'];return {'id':pid,'soldOut':sales[pid],'listed':999}
            if path=='/product/query':
                pid=kw['params']['pid'];return {'pid':pid,'productNameEn':'Hat','productImage':'https://example.com/image.jpg','variants':[{'vid':pid+'-v'}]}
            self.fail('Stock/freight must not run before all sales are collected')
        with patch('apps.runtime.selection.preview',return_value={'outcome':'results','products':[{'id':p} for p in sales],'attempts':[]}),patch('apps.runtime.selection.read',side_effect=read):
            for _ in range(12):
                for job in list(due_jobs()):process_job(job)
                run.refresh_from_db()
                if run.cursor>=3 or run.status=='needs_attention':break
        self.assertEqual(run.cursor,3,run.error)
        self.assertEqual([p['pid'] for p in run.context['selection']['sales_ranking']],['high','low','unknown'])
        self.assertIsNone(run.context['selection']['sales_ranking'][-1]['sales_90d'])
        self.assertFalse(run.context['selection']['sales_ranking'][-1]['eligible'])
        self.assertEqual([s['product']['pid'] for s in run.context['selection']['specs']],['high','low'])

    def test_catalog_collection_sales_and_publication_full_flow(self):
        doc=self.configured()
        doc['nodes'][0]['binding']['parameters']['candidateSource']='catalog'
        run=self.run_release(self.create_release(doc))
        with patch('apps.connections.cj_catalog.read_cj',return_value={'content':[{'productList':[{'id':'pid-1','nameEn':'Hat'}]}]}) as remote:
            for _ in range(3):
                for job in list(due_jobs()):process_job(job)
                run.refresh_from_db()
                if run.cursor==2:break
        self.assertEqual(run.cursor,2,run.error)
        self.assertNotIn('productFlag',remote.call_args.kwargs['params'])
        self.advance(run)
        self.assertEqual(run.status,'succeeded',run.error)
        self.assertEqual(run.context['selection']['sales_ranking'],[{'pid':'pid-1','sales_90d':35,'eligible':True,'reason':None}])
        self.assertEqual(run.context['selection_proposal']['ranked'][0]['sales_90d'],35)
        self.assertEqual(PublishedProduct.objects.count(),1)

    def test_trending_collection_sales_scoring_and_publication_full_flow(self):
        from apps.runtime.models import SelectionTask
        doc=self.configured()
        doc['nodes'][0]['binding']['parameters']['candidateSource']='trending'
        run=self.run_release(self.create_release(doc))
        with patch('apps.connections.cj_catalog.read_cj',return_value={'content':[{'productList':[{'id':'pid-1','nameEn':'Hat'}]}]}) as remote:
            for _ in range(3):
                for job in list(due_jobs()):process_job(job)
                run.refresh_from_db()
                if run.cursor==2:break
        self.assertEqual(run.cursor,2,run.error)
        self.assertEqual(remote.call_args.args[1],'/product/listV2')
        self.assertEqual(remote.call_args.kwargs['params']['productFlag'],0)
        self.assertEqual(remote.call_args.kwargs['params']['verifiedWarehouse'],1)
        self.assertEqual(run.version.document['nodes'][0]['binding']['parameters']['candidateSource'],'trending')
        self.assertEqual(SelectionTask.objects.get(pk=run.context['selection_task']).query['candidateSource'],'trending')
        self.assertEqual(run.context['selection']['search']['candidateSource'],'trending')
        self.advance(run)
        self.assertEqual(run.status,'succeeded',run.error)
        self.assertEqual(run.context['selection_proposal']['ranked'][0]['sales_90d'],35)
        self.assertEqual(run.approvals.filter(status='approved').count(),2)
        self.assertEqual(PublishedProduct.objects.count(),1)

    setUp=launch_tests.LaunchWorkflowTests.setUp
    document=launch_tests.LaunchWorkflowTests.document
    create_release=launch_tests.LaunchWorkflowTests.create_release
    run_release=launch_tests.LaunchWorkflowTests.run_release
    advance=launch_tests.LaunchWorkflowTests.advance

    def remote(self,task,path,**kwargs):
        if path=='/product/productDetail/query':
            self.assertEqual(kwargs['method'],'POST');self.assertEqual(kwargs['json'],{'id':'pid-1'})
            return {'id':'pid-1','soldOut':self.sales,'listed':250,'orderCount':1000}
        return launch_tests.LaunchWorkflowTests.remote(self,task,path,**kwargs)

    def configured(self,sales=35):
        self.sales=sales
        skill=SkillVersion.objects.create(team=self.team,key='product.opportunity',version='3.0.0',handler='product.opportunity.v3',artifact_hash=handler_hash('product.opportunity.v3'),status='approved',reviewed_by=self.user,reviewed_at=timezone.now(),review_note='Reviewed CJ fixture.')
        doc=self.document();doc['nodes'][0]['binding']['parameters'].update(marketEvidenceSource='cj',minimumCJSales90d=1)
        doc['nodes'][5]['binding'].update(skillId=f'registered.{skill.id}',skillVersion='3.0.0',parameters={})
        return doc

    @override_settings(LOCAL=True,DESKTOP_MODE=True)
    def test_automatic_source_desktop_respects_disabled_reviews(self):
        doc=self.configured();doc['nodes'][7]['binding']['parameters']['approvalEnabled']=False;doc['nodes'][10]['binding']['parameters']['approvalEnabled']=False
        run=self.run_release(self.create_release(doc));self.advance(run,False)
        self.assertEqual(run.status,'succeeded',run.error)
        self.assertEqual(run.context['selection_proposal']['ranked'][0]['sales_90d'],35)
        self.assertEqual(PublishedProduct.objects.count(),1)
        self.assertEqual(run.approvals.count(),0)
        self.assertEqual(set(run.context['reviewWaivers']),{'brief','listing'})

    def test_missing_sales_stops_before_inventory_and_shipping(self):
        doc=self.configured(None);run=self.run_release(self.create_release(doc))
        with patch('apps.runtime.selection.preview',return_value={'outcome':'results','products':[{'id':'pid-1'}],'attempts':[]}),patch('apps.runtime.selection.read',side_effect=self.remote) as read:
            for _ in range(12):
                for job in list(due_jobs()):process_job(job)
                run.refresh_from_db()
                if run.status=='needs_attention':break
            self.assertFalse(any(c.args[1] in ('/product/variant/queryByVid','/logistic/freightCalculate') for c in read.call_args_list))
        self.assertEqual(run.status,'needs_attention');self.assertEqual(run.cursor,2)
        self.assertEqual(run.context['selection_proposal']['phase'],'research')
        self.assertIsInstance(run.context['selection_proposal']['unknowns'],list)
        self.assertIn('检查商品资料',run.error)
        self.assertIn('未返回',run.context['selection_proposal']['rejected'][0]['reasons'][0])
        self.assertEqual(PublishedProduct.objects.count(),0)

    def test_cj_source_cannot_use_legacy_supply_algorithm(self):
        doc=self.configured();doc['nodes'][5]['binding'].update(skillId='product.decision.landed-cost',skillVersion='1.0.0')
        saved=self.api.post('/api/v1/workflow-designs',{'document':doc,'expected_revision':0},format='json').data
        response=self.api.post(f'/api/v1/workflow-designs/{saved["id"]}/freeze',{'expected_revision':1},format='json')
        self.assertEqual(response.status_code,422);self.assertIn('忽略销量',str(response.data))

    def test_search_preview_collects_cj_fields_without_fabricated_windows(self):
        self.configured(None)
        SupplierConnection.objects.create(team=self.team,provider='cj',status='verified',token_expires_at=timezone.now()+timedelta(days=1))
        result={'outcome':'results','products':[{'id':'pid-1'}],'message':'Fixture','attempts':[]}
        with patch('apps.connections.cj_catalog.preview',return_value=result),patch('apps.runtime.cj_evidence.read_cj',return_value={'id':'pid-1','soldOut':None,'listed':8}):
            response=self.api.post('/api/v1/connections/cj/search-preview',{'market':'US','requestedCurrency':'USD','limit':1,'marketEvidenceSource':'cj'},format='json')
        self.assertEqual(response.status_code,200,response.data)
        self.assertIsNone(response.data['cj_evidence'][0]['sales_90d'])
        self.assertEqual(response.data['cj_evidence'][0]['listing_count'],8)
        self.assertNotIn('sales_30d',response.data['cj_evidence'][0])

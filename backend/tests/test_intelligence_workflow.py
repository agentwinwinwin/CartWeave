import json
import tempfile
from copy import deepcopy
from unittest.mock import patch
from django.test import TestCase, override_settings
from django.utils import timezone
from datetime import timedelta
from apps.connections import cj_intelligence as browser
from apps.connections import intelligence_plans as plans
from apps.connections import cj_browser_bridge as bridge
from apps.connections.models import SupplierConnection
from apps.common.errors import RuleError
from apps.registry.launch import selection_query, validate_launch
from apps.teststore.models import PublishedProduct
from . import test_unified_selection as unified
from .test_cj_intelligence import raw_fixture


@override_settings(LOCAL=True, DESKTOP_MODE=True)
class IntelligenceWorkflowTests(TestCase):
    document=unified.CompactSelectionTests.document
    configured=unified.CompactSelectionTests.configured
    create_release=unified.CompactSelectionTests.create_release
    run_release=unified.CompactSelectionTests.run_release
    drive=unified.CompactSelectionTests.drive
    remote=unified.CompactSelectionTests.remote

    def unified_document(self,target=2):
        doc=unified.UnifiedSelectionTests.unified_document(self,target)
        doc['selectionStrategy']=deepcopy(doc['nodes'][3])
        doc['nodes']=[n for n in doc['nodes'] if n['definitionId'] not in ('product.decide','product.cost')]
        doc['edges']=[{'id':a['id']+':'+b['id'],'source':a['id'],'target':b['id'],'kind':'forward'} for a,b in zip(doc['nodes'],doc['nodes'][1:])]
        return doc

    def setUp(self):
        unified.CompactSelectionTests.setUp(self)
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        setting=override_settings(CJ_INTELLIGENCE_DIR=self.temp.name);setting.enable();self.addCleanup(setting.disable)
        self.supplier=SupplierConnection.objects.create(team=self.team,provider='cj',status='verified',token_expires_at=timezone.now()+timedelta(days=1))
        self.snapshot={'schema_version':'cj.intelligence.top10@1','captured_at':timezone.now().isoformat(),
            **{kind:browser.parse_page(kind,raw_fixture(kind)) for kind in ('sales','advertising')}}
        self.directory={'connection_version':self.supplier.configuration_version,'categories':[{'id':'cj-leaf','name':'Beauty','path':'Beauty / Skin / Masks'}]}
        root=browser.folder(self.team.id)
        browser.write_private(root/'snapshot.json',json.dumps(self.snapshot))
        import time
        bridge.save(self.team.id,'extension.enc',{'digest':'test-only','expires_at':time.time()+300,'last_seen':time.time()})

    def graph(self, enabled=False):
        doc=self.unified_document()
        with patch('apps.connections.intelligence_plans.catalog',return_value=self.directory):
            self.plan=plans.create(self.member,{'source':'advertising','mappings':[{'source_category_id':self.snapshot['advertising']['rows'][0]['source_category_id'],'category_id':'cj-leaf'}]})
        first={'id':'market','definitionId':'market.intelligence','title':'采集市场类目排行',
            'binding':{'skillId':'market.intelligence.core','skillVersion':'1.0.0','mode':'default',
                       'parameters':{'enabled':enabled,'categoryPlanRef':self.plan['id'],'categoryQueries':plans.queries(self.plan)}}}
        doc['nodes']=[first,*doc['nodes']]
        doc['edges']=[{'id':a['id']+':'+b['id'],'source':a['id'],'target':b['id'],'kind':'forward'} for a,b in zip(doc['nodes'],doc['nodes'][1:])]
        return doc

    def test_disabled_prefix_preserves_original_task_and_full_publication(self):
        doc=self.graph();old=deepcopy(doc);old['nodes']=old['nodes'][1:];old['edges']=[e for e in old['edges'] if e['source']!='market']
        original=selection_query(old)
        self.assertEqual(selection_query(doc),original)
        with patch('apps.connections.cj_intelligence.collect') as collect:
            run=self.run_release(self.create_release(doc));self.drive(run)
        collect.assert_not_called()
        self.assertEqual(run.status,'succeeded',run.error)
        self.assertEqual(run.context['market_intelligence']['status'],'skipped')
        self.assertEqual(PublishedProduct.objects.count(),2)

    def test_enabled_prefix_inherits_category_and_completes_the_batch(self):
        doc=self.graph(True)
        q=selection_query(doc)
        self.assertEqual(q['categoryQueries'],[{'categoryId':'cj-leaf','keyword':''}]);self.assertEqual(q['keyword'],'')
        with patch('apps.connections.cj_intelligence.collect',return_value=self.snapshot) as collect,patch('apps.connections.intelligence_plans.catalog',return_value=self.directory):
            run=self.run_release(self.create_release(doc));self.drive(run)
        self.assertEqual(run.status,'succeeded',run.error)
        collect.assert_called_once()
        self.assertEqual(run.context['market_intelligence']['status'],'ready')
        self.assertEqual(PublishedProduct.objects.count(),2)

    def test_changed_top_ten_stops_before_any_product_research(self):
        doc=self.graph(True);changed=deepcopy(self.snapshot);changed['advertising']['rows'][0]['source_category_id']='changed'
        with patch('apps.connections.cj_intelligence.collect',return_value=changed):
            run=self.run_release(self.create_release(doc));calls=self.drive(run)
        self.assertEqual(run.status,'needs_attention',run.error)
        self.assertEqual(run.cursor,0);self.assertEqual(calls,[])
        self.assertEqual(PublishedProduct.objects.count(),0)

    def test_unknown_or_tampered_mapping_cannot_freeze(self):
        doc=self.graph(True);doc['nodes'][0]['binding']['parameters']['categoryQueries']=[{'categoryId':'different','keyword':''}]
        with self.assertRaises(RuleError):validate_launch(doc,self.skill)
        with self.assertRaises(RuleError):plans.read(self.team.id,'../../session.enc')

    def test_replenishment_returns_to_correct_collection_node_with_prefix(self):
        doc=self.graph(True);self.pool=[f'bad{i}' for i in range(20)];original=self.remote
        def remote(task,path,**kwargs):
            if path=='/product/listV2':
                self.assertEqual(kwargs['params']['page'],2)
                self.assertEqual(kwargs['params']['categoryId'],'cj-leaf')
                self.assertNotIn('keyWord',kwargs['params'])
                return {'content':[{'productList':[{'id':'good'},{'id':'next'}]}]}
            result=original(task,path,**kwargs)
            if path=='/product/productDetail/query' and kwargs['json']['id'].startswith('bad'):
                for row in result['variantInventory']:row['inventory'][0]['cjInventory']=0
            return result
        self.remote=remote
        with patch('apps.connections.cj_intelligence.collect',return_value=self.snapshot) as collect,patch('apps.connections.intelligence_plans.catalog',return_value=self.directory):
            run=self.run_release(self.create_release(doc));self.drive(run)
        self.assertEqual(run.status,'succeeded',run.error)
        collect.assert_called_once()
        self.assertEqual(PublishedProduct.objects.count(),2)

    def test_plan_rejects_unverified_catalog_and_other_workspace(self):
        with patch('apps.connections.intelligence_plans.catalog',return_value=self.directory):
            with self.assertRaises(RuleError):plans.create(self.member,{'source':'sales','mappings':[{'source_category_id':'unknown','category_id':'cj-leaf'}]})
        self.graph()
        from uuid import uuid4
        with self.assertRaises(RuleError):plans.read(uuid4(),self.plan['id'])

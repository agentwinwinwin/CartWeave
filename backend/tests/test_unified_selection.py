from copy import deepcopy
from django.test import TestCase
from apps.common.errors import RuleError
from apps.registry.launch import selection_query,validate_launch,UNIFIED_LAUNCH_IDS,COMPACT_LAUNCH_IDS
from apps.teststore.models import PublishedProduct
from apps.runtime.serializers import RunSerializer
from .test_batch_workflow import BatchWorkflowTests


class UnifiedSelectionTests(TestCase):
    setUp=BatchWorkflowTests.setUp
    document=BatchWorkflowTests.document
    configured=BatchWorkflowTests.configured
    create_release=BatchWorkflowTests.create_release
    run_release=BatchWorkflowTests.run_release
    drive=BatchWorkflowTests.drive

    def unified_document(self,target=2):
        doc=self.configured()
        start=doc['nodes'][0]['binding']['parameters']
        for n in (doc['nodes'][3],doc['nodes'][4],doc['nodes'][6]):start.update(n['binding']['parameters'])
        start.update(limit=target,demandFirstCollection=True,batchPublishing=True,scanBudget=1000)
        verify=deepcopy(doc['nodes'][2]);verify.update(definitionId='product.verify',title='统一核验并补选')
        verify['binding'].update(skillId='product.verify.core',parameters={})
        doc['nodes'][6]['binding']['parameters']={}
        doc['nodes']=[*doc['nodes'][:2],verify,*doc['nodes'][5:]]
        doc['edges']=[{'id':f'{a["id"]}:{b["id"]}','source':a['id'],'target':b['id'],'kind':'forward'} for a,b in zip(doc['nodes'],doc['nodes'][1:])]
        return doc

    def remote(self,task,path,**kw):
        if path=='/product/productDetail/query' and not getattr(self,'missing_inventory',False):
            pid=kw['json']['id']
            return {'id':pid,'orderCount':100,'nameen':pid,'bigimg':'https://oss-cf.cjdropshipping.com/product/hat.jpg',
                'stanProducts':[{'id':pid+f'-{i}','pid':pid,'sku':pid+f'-{i}','variantkey':pid+f'-{i}','sellprice':'5.00'} for i in (1,2)],
                'variantInventory':[{'vid':pid+f'-{i}','inventory':[{'countryCode':'CN','cjInventory':0 if pid=='bad' else 100,'factoryInventory':0,'verifiedWarehouse':1}]} for i in (1,2)]}
        return BatchWorkflowTests.remote(self,task,path,**kw)

    def test_unified_node_replenishes_and_publishes_whole_batch(self):
        doc=self.unified_document();run=self.run_release(self.create_release(doc))
        calls=self.drive(run)
        self.assertEqual(run.status,'succeeded',run.error)
        self.assertEqual([n['definitionId'] for n in run.version.document['nodes']],UNIFIED_LAUNCH_IDS)
        self.assertEqual(run.context['batch_meta']['published'],2)
        self.assertEqual(PublishedProduct.objects.count(),2)
        self.assertEqual(run.approvals.filter(status='approved').count(),2)
        self.assertEqual(run.context['verification']['phase'],'done')
        self.assertEqual(len(run.context['selection']['product_exclusions']),1)
        self.assertFalse(any(c.args[1] in ('/product/query','/product/variant/queryByVid') for c in calls))
        result=RunSerializer(run).data
        self.assertEqual(result['context']['batch_meta']['published'],2)
        self.assertEqual(result['context']['verification']['phase'],'done')

    def test_global_ranking_works_inside_unified_node(self):
        self.category_pools={'a':['good','next','unused'],'b':[],'c':[]}
        original=self.remote
        def remote(task,path,**kw):
            result=original(task,path,**kw)
            if path=='/product/productDetail/query':result['orderCount']=10000 if kw['json']['id']=='unused' else 100
            return result
        self.remote=remote
        doc=self.unified_document();doc['nodes'][0]['binding']['parameters'].update(finalSelectionMode='global',
            categoryId='',keyword='',categoryQueries=[{'categoryId':c,'keyword':''} for c in ('a','b','c')])
        # At least as many target products as directions is an existing query constraint.
        doc['nodes'][0]['binding']['parameters']['limit']=3
        run=self.run_release(self.create_release(doc));self.drive(run)
        self.assertEqual(run.status,'succeeded',run.error)
        self.assertEqual(run.context['batch_meta']['selected'],3)
        self.assertEqual(run.context['batch_briefs'][0]['title'],'unused')
        self.assertEqual(PublishedProduct.objects.count(),3)

    def test_incomplete_reply_supplements_without_skipping_checks(self):
        self.missing_inventory=True
        run=self.run_release(self.create_release(self.unified_document()));calls=self.drive(run)
        self.assertEqual(run.status,'succeeded',run.error)
        self.assertTrue(any(c.args[1]=='/product/variant/queryByVid' for c in calls))
        self.assertEqual(run.context['batch_meta']['published'],2)

    def test_shortfall_does_not_publish_or_approve(self):
        run=self.run_release(self.create_release(self.unified_document(4)));self.drive(run)
        self.assertEqual(run.status,'needs_attention',run.error)
        self.assertEqual(run.version.document['nodes'][run.cursor]['definitionId'],'product.verify')
        self.assertEqual(run.approvals.count(),0)
        self.assertEqual(PublishedProduct.objects.count(),0)

    def test_task_is_the_only_rule_configuration_source(self):
        doc=self.unified_document()
        doc['nodes'][0]['binding']['parameters'].update(minimumInventory=17,maximumDeliveryDays=18,taxReserveUsd=4)
        query=selection_query(doc)
        self.assertEqual((query['minimum_inventory'],query['maximum_days'],query['tax_reserve_usd']),(17,18,'4'))
        doc['nodes'][4]['binding']['parameters']['taxReserveUsd']=2
        with self.assertRaises(RuleError):validate_launch(doc,self.skill)

    def test_unified_node_returns_to_collection_when_page_has_no_qualified_product(self):
        self.pool=[f'bad{i}' for i in range(20)];original=self.remote
        def remote(task,path,**kw):
            if path=='/product/listV2':
                self.assertEqual(kw['params']['page'],2)
                return {'content':[{'productList':[{'id':'good'},{'id':'next'}]}]}
            result=original(task,path,**kw)
            if path=='/product/productDetail/query' and kw['json']['id'].startswith('bad'):
                for row in result['variantInventory']:row['inventory'][0]['cjInventory']=0
            return result
        self.remote=remote
        run=self.run_release(self.create_release(self.unified_document()));calls=self.drive(run)
        self.assertEqual(run.status,'succeeded',run.error)
        self.assertEqual(run.context['batch_meta']['published'],2)
        self.assertEqual(len(run.context['selection']['product_exclusions']),20)
        self.assertEqual(sum(c.args[1]=='/product/listV2' for c in calls),1)

    def test_unified_read_failure_can_resume_same_frozen_configuration(self):
        from apps.connections.cj import CJUnavailable
        from apps.runtime.services import resume
        original=self.remote;failed=False
        def remote(task,path,**kw):
            nonlocal failed
            if path=='/logistic/freightCalculate' and not failed:
                failed=True
                raise CJUnavailable('Synthetic read failure')
            return original(task,path,**kw)
        self.remote=remote
        run=self.run_release(self.create_release(self.unified_document()))
        version=run.version_id;self.drive(run)
        self.assertEqual(run.status,'needs_attention',run.error)
        self.assertEqual(run.version.document['nodes'][run.cursor]['definitionId'],'product.verify')
        self.assertEqual(PublishedProduct.objects.count(),0)
        resume(run,self.user,run.revision);self.drive(run)
        self.assertEqual(run.status,'succeeded',run.error)
        self.assertEqual(run.version_id,version)
        self.assertEqual(run.context['batch_meta']['published'],2)
        self.assertEqual(run.approvals.filter(status='approved').count(),2)


class CompactSelectionTests(UnifiedSelectionTests):
    def unified_document(self,target=2):
        doc=super().unified_document(target)
        doc['selectionStrategy']=deepcopy(doc['nodes'][3])
        doc['nodes']=[n for n in doc['nodes'] if n['definitionId'] not in ('product.decide','product.cost')]
        doc['nodes'][2]['title']='统一核验、定价并补选'
        doc['edges']=[{'id':f'{a["id"]}:{b["id"]}','source':a['id'],'target':b['id'],'kind':'forward'} for a,b in zip(doc['nodes'],doc['nodes'][1:])]
        return doc

    def test_unified_node_replenishes_and_publishes_whole_batch(self):
        run=self.run_release(self.create_release(self.unified_document()));calls=self.drive(run)
        self.assertEqual(run.status,'succeeded',run.error)
        self.assertEqual([n['definitionId'] for n in run.version.document['nodes']],COMPACT_LAUNCH_IDS)
        self.assertEqual(run.context['batch_meta']['published'],2)
        self.assertEqual(PublishedProduct.objects.count(),2)
        self.assertEqual(run.approvals.filter(status='approved').count(),2)
        self.assertEqual(run.context['verification']['completed'],['product.normalize','product.filter','product.delivery','product.decide','product.cost'])
        self.assertIn('selection_proposal',run.context)
        self.assertFalse(any(c.args[1] in ('/product/query','/product/variant/queryByVid') for c in calls))

    def test_task_is_the_only_rule_configuration_source(self):
        doc=self.unified_document();doc['nodes'][0]['binding']['parameters'].update(minimumInventory=17,maximumDeliveryDays=18,taxReserveUsd=4)
        query=selection_query(doc)
        self.assertEqual((query['minimum_inventory'],query['maximum_days'],query['tax_reserve_usd']),(17,18,'4'))
        doc['selectionStrategy']['binding']['parameters']['taxReserveUsd']=2
        with self.assertRaises(RuleError):validate_launch(doc,self.skill)

    def test_internal_system_check_rejects_incorrect_strategy_price(self):
        from unittest.mock import patch
        from decimal import Decimal
        from apps.skills.opportunity_orders import propose
        def wrong_price(*args,**kwargs):
            result=propose(*args,**kwargs)
            for row in result['ranked']:row['suggested_price']=str(Decimal(row['suggested_price'])+1)
            return result
        run=self.run_release(self.create_release(self.unified_document()))
        with patch('apps.skills.opportunity_orders.propose',side_effect=wrong_price):self.drive(run)
        self.assertEqual(run.status,'needs_attention')
        self.assertIn('不一致',run.error)
        self.assertEqual(run.approvals.count(),0)
        self.assertEqual(PublishedProduct.objects.count(),0)

from unittest.mock import patch
from datetime import timedelta
from django.test import TestCase
from django.utils import timezone
from apps.runtime.models import Outbox,WorkflowRun
from apps.runtime.services import due_jobs,process_job,decide
from apps.teststore.models import PublishedProduct
from .test_cj_orders import CJOrderWorkflowTests


class BatchWorkflowTests(TestCase):
    setUp=CJOrderWorkflowTests.setUp
    document=CJOrderWorkflowTests.document
    create_release=CJOrderWorkflowTests.create_release
    run_release=CJOrderWorkflowTests.run_release
    configured=CJOrderWorkflowTests.configured

    def batch_run(self,target=2):
        doc=self.configured();doc['nodes'][0]['binding']['parameters'].update(limit=target,variantsPerProduct=2,demandFirstCollection=True,batchPublishing=True)
        return self.run_release(self.create_release(doc))

    def remote(self,task,path,**kwargs):
        if path=='/product/listV2':return {'content':[{'productList':[]}]}
        if path=='/product/productDetail/query':return {'id':kwargs['json']['id'],'orderCount':100,'soldOut':None,'listed':0}
        if path=='/product/query':
            pid=kwargs['params']['pid']
            return {'pid':pid,'productNameEn':pid,'productImage':'https://oss-cf.cjdropshipping.com/product/hat.jpg','variants':[{'vid':pid+'-1'},{'vid':pid+'-2'}]}
        if path=='/product/variant/queryByVid':
            vid=kwargs['params']['vid'];pid=vid.rsplit('-',1)[0]
            return {'pid':pid,'vid':vid,'variantSku':vid,'variantKey':vid,'variantSellPrice':'5.00',
                'inventories':[{'countryCode':'CN','cjInventory':0 if pid=='bad' else 100,'factoryInventory':0,'verifiedWarehouse':1}]}
        if path=='/logistic/freightCalculate':return [{'logisticPrice':'4.00','logisticName':'CJPacket','logisticAging':'7-12'}]
        raise AssertionError(path)

    def drive(self,run):
        def preview(member,query,**kwargs):
            pool=self.category_pools.get(query.categoryId,[]) if hasattr(self,'category_pools') else getattr(self,'pool',('bad','good','next','unused'))
            return {'outcome':'results' if pool else 'no_results','products':[{'id':p} for p in pool],'attempts':[]}
        with patch('apps.runtime.selection.preview',side_effect=preview),patch('apps.runtime.selection.read',side_effect=self.remote) as calls:
            for _ in range(3000):
                Outbox.objects.filter(status='pending').update(available_at=timezone.now()-timedelta(seconds=1))
                for job in list(due_jobs()):process_job(job)
                run.refresh_from_db()
                if run.status=='waiting_approval':
                    request=run.approvals.get(status='pending')
                    self.assertEqual(len(request.snapshot['batch_items']),run.context['batch_meta']['target'])
                    decide(request,self.user,'approve','Reviewed entire synthetic batch.',run.revision)
                if run.status in ('succeeded','needs_attention'):break
            return calls.call_args_list

    def test_replenish_group_variants_and_publish_with_two_batch_reviews(self):
        doc=self.configured();doc['nodes'][0]['binding']['parameters'].update(limit=2,variantsPerProduct=2,demandFirstCollection=True,batchPublishing=True,scanBudget=20,demandQualifiedQuota=True)
        run=self.run_release(self.create_release(doc));calls=self.drive(run)
        self.assertEqual(run.status,'succeeded',run.error)
        self.assertEqual(len(run.context['batch_briefs']),2)
        self.assertTrue(all(len(b['variants'])==2 for b in run.context['batch_briefs']))
        self.assertEqual(run.approvals.filter(status='approved').count(),2)
        children=WorkflowRun.objects.filter(context__batch_parent=str(run.id))
        self.assertEqual(children.count(),2)
        self.assertTrue(all(c.status=='succeeded' and c.approvals.count()==0 for c in children))
        self.assertEqual(PublishedProduct.objects.count(),2)
        self.assertTrue(any(c.args[1]=='/product/query' and c.kwargs['params']['pid']=='unused' for c in calls))
        self.assertEqual(run.context['batch_meta']['qualified'],3)
        self.assertEqual(run.context['batch_meta']['selected'],2)
        from apps.runtime.models import SelectionTask
        self.assertTrue(SelectionTask.objects.get(evidence__workflow_run=str(run.id)).query['demand_quota'])

    def test_shortfall_does_not_approve_or_publish_smaller_batch(self):
        run=self.batch_run(4);self.drive(run)
        self.assertEqual(run.status,'needs_attention',run.error)
        self.assertEqual(run.context['batch_meta']['qualified'],3)
        self.assertTrue(run.context['batch_meta']['shortfall'])
        self.assertEqual(run.approvals.count(),0)
        self.assertEqual(PublishedProduct.objects.count(),0)

    def test_total_above_target_reports_category_shortfall_not_total_shortfall(self):
        from apps.runtime.batch import research
        run=self.batch_run()
        run.context={'selection':{'records':[], 'qualified_pids':[str(i) for i in range(13)],
            'qualified_categories':{'a':13},'collection':{'termination':'directory'}}}
        with patch('apps.runtime.batch.selection_query',return_value={'batch_target':10,
                'categoryQueries':[{'categoryId':c} for c in ('a','b','c')]}):
            result=research(run,'product.normalize')
        self.assertTrue(result['_research_required'])
        self.assertIn('合格总数已达到目标，但部分类目未达到冻结配额',result['_research_message'])
        self.assertIn('类目 1：合格 13 / 配额 4',result['_research_message'])
        self.assertIn('类目 2：合格 0 / 配额 3',result['_research_message'])
        self.assertNotIn('实际仅',result['_research_message'])
        self.assertFalse(result['batch_meta'].get('research_complete',False))

    def test_global_mode_selects_best_ten_across_categories_without_final_quotas(self):
        self.category_pools={'a':[f'good-{i:02}' for i in range(13)],'b':[],'c':[]}
        base=self.remote
        def remote(task,path,**kwargs):
            result=base(task,path,**kwargs)
            if path=='/product/productDetail/query':
                result['orderCount']=10000 if kwargs['json']['id']=='good-12' else 100
            return result
        self.remote=remote
        doc=self.configured();doc['nodes'][0]['binding']['parameters'].update(limit=10,variantsPerProduct=2,
            demandFirstCollection=True,batchPublishing=True,scanBudget=1000,finalSelectionMode='global',
            categoryId='',keyword='',categoryQueries=[{'categoryId':c,'keyword':''} for c in ('a','b','c')])
        run=self.run_release(self.create_release(doc));self.drive(run)
        self.assertEqual(run.status,'succeeded',run.error)
        self.assertEqual(run.context['batch_meta']['qualified'],13)
        self.assertEqual(run.context['batch_meta']['selected'],10)
        self.assertEqual(run.context['batch_briefs'][0]['title'],'good-12')
        self.assertEqual(PublishedProduct.objects.count(),10)
        self.assertEqual(len({b['product_id'] for b in run.context['batch_briefs']}),10)

    def test_global_mode_still_pauses_when_total_is_below_target(self):
        doc=self.configured();doc['nodes'][0]['binding']['parameters'].update(limit=4,variantsPerProduct=2,
            demandFirstCollection=True,batchPublishing=True,finalSelectionMode='global')
        run=self.run_release(self.create_release(doc));self.drive(run)
        self.assertEqual(run.status,'needs_attention',run.error)
        self.assertIn('合并候选池中共 3 款',run.error)
        self.assertEqual(PublishedProduct.objects.count(),0)
        self.assertEqual(run.approvals.count(),0)

    def test_partial_failure_retries_only_failed_publication(self):
        from .test_publication import TestAdapter
        from apps.common.errors import RuleError
        from apps.runtime.services import resume
        original=TestAdapter.publish;calls=[];failed=False
        def publish(adapter,operation):
            nonlocal failed
            calls.append(operation.key)
            if operation.payload['title']=='next' and not failed:
                failed=True;raise RuleError('Synthetic channel failure')
            return original(adapter,operation)
        run=self.batch_run()
        with patch.object(TestAdapter,'publish',publish):
            self.drive(run)
            self.assertEqual(run.status,'needs_attention',run.error)
            self.assertEqual(PublishedProduct.objects.count(),1)
            self.assertEqual(run.context['batch_meta']['published'],1)
            resume(run,self.user,run.revision);self.drive(run)
        self.assertEqual(run.status,'succeeded',run.error)
        self.assertEqual(PublishedProduct.objects.count(),2)
        self.assertEqual(len(calls),3)
        self.assertEqual(len(set(calls)),2)

    def test_product_projection_contains_members_not_parent_duplicate(self):
        run=self.batch_run();self.drive(run)
        result=self.api.get('/api/v1/products')
        self.assertEqual(result.status_code,200,result.data)
        self.assertEqual(result.data['count'],2)

    def test_child_cannot_inherit_after_parent_cancelled(self):
        from apps.runtime.batch import inherit_approval
        from apps.common.errors import RuleError
        run=self.batch_run();self.drive(run)
        child=WorkflowRun.objects.get(pk=run.context['batch_children'][0])
        run.status='cancelled';run.save(update_fields=['status'])
        with self.assertRaises(RuleError):inherit_approval(child,'listing')

    def test_twenty_products_are_twenty_publications_not_twenty_skus(self):
        # Catalog page is deliberately short; no real CJ or user database writes.
        self.pool=[f'product-{i:02}' for i in range(20)]
        run=self.batch_run(20);self.drive(run)
        self.assertEqual(run.status,'succeeded',run.error)
        self.assertEqual(run.context['batch_meta']['published'],20)
        self.assertEqual(PublishedProduct.objects.count(),20)
        self.assertEqual(sum(len(b['variants']) for b in run.context['batch_briefs']),40)

    def test_explicit_budget_reads_until_directory_ends_even_after_target_qualifies(self):
        self.pool=[f'bad{i:03}' for i in range(20)]
        base=self.remote
        def remote(task,path,**kwargs):
            if path=='/product/listV2':
                page=kwargs['params']['page']
                if page==5:return {'content':[{'productList':[]}]}
                self.assertLessEqual(page,5,'must stop at empty directory page')
                return {'content':[{'productList':[{'id':f'bad{i:03}' if page<4 else f'good{i:03}'} for i in range((page-1)*20,page*20)]}]}
            result=base(task,path,**kwargs)
            if path=='/product/variant/queryByVid' and result['pid'].startswith('bad'):
                result['inventories'][0]['cjInventory']=0
            return result
        self.remote=remote
        doc=self.configured();doc['nodes'][0]['binding']['parameters'].update(limit=2,variantsPerProduct=2,demandFirstCollection=True,batchPublishing=True,scanBudget=1000)
        run=self.run_release(self.create_release(doc));calls=self.drive(run)
        self.assertEqual(run.status,'succeeded',run.error)
        self.assertEqual(run.context['selection']['collection']['scanned'],80)
        self.assertEqual(run.context['batch_meta']['published'],2)
        self.assertEqual(len(run.context['selection']['product_exclusions']),60)
        self.assertFalse(any(c.args[1]=='/logistic/freightCalculate' and c.kwargs['json']['products'][0]['vid'].startswith('bad') for c in calls))

    def test_full_detail_snapshot_runs_local_checks_without_repeated_requests(self):
        original=self.remote
        def remote(task,path,**kwargs):
            if path=='/product/productDetail/query':
                pid=kwargs['json']['id']
                return {'id':pid,'orderCount':100,'nameen':pid,'bigimg':'https://oss-cf.cjdropshipping.com/product/hat.jpg',
                    'stanProducts':[{'id':pid+f'-{i}','pid':pid,'sku':pid+f'-{i}','variantkey':pid+f'-{i}','sellprice':'5.00'} for i in (1,2)],
                    'variantInventory':[{'vid':pid+f'-{i}','inventory':[{'countryCode':'CN','cjInventory':0 if pid=='bad' else 100,'factoryInventory':0,'verifiedWarehouse':1}]} for i in (1,2)]}
            if path in ('/product/query','/product/variant/queryByVid'):
                raise AssertionError('Complete snapshot must not re-read details or stock')
            return original(task,path,**kwargs)
        self.remote=remote
        run=self.batch_run();calls=self.drive(run)
        self.assertEqual(run.status,'succeeded',run.error)
        self.assertEqual(PublishedProduct.objects.count(),2)
        self.assertEqual(sum(c.args[1]=='/product/productDetail/query' for c in calls),4)
        self.assertEqual(len(run.context['selection']['product_exclusions']),1)
        self.assertTrue(run.attempts.filter(node_id=run.version.document['nodes'][3]['id'],status='completed').exists())

    def test_missing_snapshot_inventory_supplements_only_that_spec(self):
        self.pool=['good','next','unused'];original=self.remote
        def remote(task,path,**kwargs):
            if path=='/product/productDetail/query':
                pid=kwargs['json']['id']
                return {'id':pid,'orderCount':100,'nameen':pid,'bigimg':'https://oss-cf.cjdropshipping.com/product/hat.jpg',
                    'stanProducts':[{'id':pid+'-1','pid':pid,'sku':pid+'-1','variantkey':pid+'-1','sellprice':'5.00'}]}
            if path=='/product/query':raise AssertionError('Product essentials are already present')
            return original(task,path,**kwargs)
        self.remote=remote
        run=self.batch_run();calls=self.drive(run)
        self.assertEqual(run.status,'succeeded',run.error)
        self.assertEqual(sum(c.args[1]=='/product/variant/queryByVid' for c in calls),3)
        self.assertEqual(PublishedProduct.objects.count(),2)

    def test_best_product_can_arrive_after_target_already_qualified(self):
        self.pool=[f'early-{i:02}' for i in range(20)];original=self.remote
        def remote(task,path,**kwargs):
            if path=='/product/listV2':
                self.assertEqual(kwargs['params']['page'],2)
                return {'content':[{'productList':[{'id':'late-winner'}]}]}
            result=original(task,path,**kwargs)
            if path=='/product/productDetail/query':
                result['orderCount']=10000 if kwargs['json']['id']=='late-winner' else 1
            return result
        self.remote=remote
        doc=self.configured();doc['nodes'][0]['binding']['parameters'].update(limit=2,variantsPerProduct=2,demandFirstCollection=True,batchPublishing=True,scanBudget=40)
        run=self.run_release(self.create_release(doc));self.drive(run)
        self.assertEqual(run.status,'succeeded',run.error)
        self.assertEqual(run.context['batch_meta']['researched'],21)
        self.assertEqual(run.context['batch_meta']['qualified'],21)
        self.assertEqual(run.context['batch_briefs'][0]['title'],'late-winner')
        self.assertEqual(PublishedProduct.objects.count(),2)

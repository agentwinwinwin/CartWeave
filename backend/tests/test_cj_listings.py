from unittest.mock import patch
from django.test import SimpleTestCase, TestCase, override_settings
from django.utils import timezone
from apps.skills.opportunity_orders import normalize
from apps.skills.opportunity_listings import propose, HANDLER, VERSION
from apps.skills.registry import handler_hash
from apps.skills.models import SkillVersion
from .test_batch_workflow import BatchWorkflowTests


class ListingScoreTests(SimpleTestCase):
    def score(self, records):
        evidence=[normalize({'id':pid,'orderCount':orders,'listed':listed},pid,timezone.now().isoformat()) for pid,orders,listed in records]
        rows=[{'pid':pid,'vid':pid,'landed_cost':10,'inventory':50,'total_days':10,'supply_type':'cj_stock'} for pid,_,_ in records]
        return propose(rows,{'fee_percent':'3','margin_percent':'30'},evidence)

    def test_listing_interest_changes_ranking_and_preserves_price(self):
        result=self.score([('low',100,0),('high',100,900)])
        self.assertEqual(result['recommended_vid'],'high')
        first,last=result['ranked']
        self.assertEqual(first['listing_score'],'90.0000')
        self.assertEqual(first['score'],'97.5000')
        self.assertEqual(last['score'],'75.0000')
        self.assertEqual(first['suggested_price'],last['suggested_price'])
        self.assertEqual(result['algorithm'],HANDLER)
        self.assertEqual(result['version'],VERSION)

    def test_orders_remain_required_and_missing_listings_are_not_zero(self):
        result=self.score([('zero',0,100000),('missing',100,None),('valid',50,0)])
        self.assertEqual(result['recommended_vid'],'valid')
        self.assertEqual(len(result['rejected']),2)
        self.assertEqual(result['ranked'][0]['listing_score'],'0.0000')

    def test_orders_outweigh_listing_interest_and_results_are_deterministic(self):
        values=[('demand',100,0),('attention',10,100000)]
        a=self.score(values);b=self.score(list(reversed(values)))
        self.assertEqual(a['recommended_vid'],'demand')
        self.assertEqual(a['ranked'],b['ranked'])


class ListingBatchTests(TestCase):
    setUp=BatchWorkflowTests.setUp
    document=BatchWorkflowTests.document
    create_release=BatchWorkflowTests.create_release
    run_release=BatchWorkflowTests.run_release
    configured=BatchWorkflowTests.configured
    drive=BatchWorkflowTests.drive

    def remote(self,task,path,**kwargs):
        result=BatchWorkflowTests.remote(self,task,path,**kwargs)
        if path=='/product/productDetail/query':
            result['listed']=900 if kwargs['json']['id']=='next' else 0
        return result

    def test_compact_canvas_inherits_registered_listing_strategy(self):
        from copy import deepcopy
        doc=self.configured()
        skill=SkillVersion.objects.create(team=self.team,key='product.opportunity',version=VERSION,handler=HANDLER,
            artifact_hash=handler_hash(HANDLER),status='approved',reviewed_by=self.user,
            reviewed_at=timezone.now(),review_note='Reviewed compact listing score fixture.')
        start=doc['nodes'][0]['binding']['parameters']
        for index in (3,4,6):start.update(doc['nodes'][index]['binding']['parameters'])
        start.update(limit=2,demandFirstCollection=True,batchPublishing=True,scanBudget=20,demandQualifiedQuota=True)
        strategy=deepcopy(doc['nodes'][5]);strategy['binding'].update(skillId=f'registered.{skill.id}',skillVersion=VERSION,parameters={})
        doc['selectionStrategy']=strategy
        verify=deepcopy(doc['nodes'][2]);verify.update(definitionId='product.verify',title='统一核验并选品')
        verify['binding'].update(skillId='product.verify.core',parameters={})
        doc['nodes']=[*doc['nodes'][:2],verify,*doc['nodes'][7:]]
        doc['edges']=[{'id':f'{a["id"]}:{b["id"]}','source':a['id'],'target':b['id'],'kind':'forward'} for a,b in zip(doc['nodes'],doc['nodes'][1:])]
        run=self.run_release(self.create_release(doc));self.drive(run)
        self.assertEqual(run.status,'succeeded',run.error)
        self.assertEqual(run.context['selection_proposal']['algorithm'],HANDLER)
        self.assertEqual(run.context['batch_meta']['published'],2)

    def test_registered_listing_algorithm_runs_entire_batch_publication(self):
        from apps.teststore.models import PublishedProduct
        doc=self.configured()
        skill=SkillVersion.objects.create(team=self.team,key='product.opportunity',version=VERSION,handler=HANDLER,
            artifact_hash=handler_hash(HANDLER),status='approved',reviewed_by=self.user,
            reviewed_at=timezone.now(),review_note='Reviewed listing score fixture.')
        doc['nodes'][0]['binding']['parameters'].update(limit=2,variantsPerProduct=2,
            demandFirstCollection=True,batchPublishing=True,scanBudget=20,demandQualifiedQuota=True)
        doc['nodes'][5]['binding'].update(skillId=f'registered.{skill.id}',skillVersion=VERSION,parameters={})
        if getattr(self,'skip_reviews',False):
            for n in doc['nodes']:
                if n['definitionId'] in ('product.authorize','listing.authorize'):
                    n['binding']['parameters']['approvalEnabled']=False
        run=self.run_release(self.create_release(doc));self.drive(run)
        self.assertEqual(run.status,'succeeded',run.error)
        self.assertEqual(run.context['selection_proposal']['algorithm'],HANDLER)
        self.assertEqual(run.context['selection_proposal']['ranked'][0]['pid'],'next')
        self.assertEqual(run.approvals.filter(status='approved').count(),0 if getattr(self,'skip_reviews',False) else 2)
        self.assertEqual(PublishedProduct.objects.count(),2)
        if getattr(self,'skip_reviews',False):
            self.assertEqual(set(run.context['reviewWaivers']),{'brief','listing'})
            self.assertEqual(run.events.filter(payload__reviewMode='skipped').count(),2)

    @override_settings(LOCAL=True,DESKTOP_MODE=True)
    def test_listing_algorithm_desktop_runs_without_forced_reviews(self):
        self.skip_reviews=True
        self.test_registered_listing_algorithm_runs_entire_batch_publication()

    @override_settings(LOCAL=True,DESKTOP_MODE=True)
    def test_factory_marker_does_not_override_desktop_switches(self):
        from types import SimpleNamespace
        from apps.runtime.services import review_enabled
        from copy import deepcopy
        doc=deepcopy(self.version.document)
        for n in doc['nodes']:
            if n['definitionId'] in ('product.authorize','listing.authorize'):
                n['binding']['parameters']={'approvalEnabled':False}
        run=SimpleNamespace(context={'batch_mode':'parent','batch_briefs':[{'source_note':'FACTORY_SUPPLY：未验证工厂报量'}],
            'brief':{'source_kind':'cj_selection','source_note':'FACTORY_SUPPLY：未验证工厂报量'},
            'selection_proposal':{'requires_manual_review':True}},
            version=SimpleNamespace(document=doc),requested_by=self.user,team=self.team)
        self.assertFalse(review_enabled(run,'brief'))
        self.assertFalse(review_enabled(run,'listing'))
        with override_settings(DESKTOP_MODE=False):
            self.assertTrue(review_enabled(run,'brief'))
            self.assertTrue(review_enabled(run,'listing'))
        doc['nodes'][0]['binding']['parameters']['approvalEnabled']=True
        self.assertTrue(review_enabled(run,'brief'))

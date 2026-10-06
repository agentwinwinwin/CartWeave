from copy import deepcopy
from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch
from django.test import TestCase,SimpleTestCase,override_settings
from django.utils import timezone
from apps.skills.opportunity_market import propose
from apps.skills.market_evidence import EvidenceDocument
from apps.skills.models import SkillVersion,MarketEvidence
from apps.skills.registry import handler_hash
from apps.runtime.models import WorkflowRun
from apps.runtime.services import due_jobs,process_job,decide
from apps.common.utils import digest
from apps.teststore.models import PublishedProduct
from . import test_launch_workflow as launch_tests

def evidence_document():
    today=timezone.now().date().isoformat()
    return {'name':'Synthetic demand fixture','market':'US','currency':'USD','channel':'synthetic-fixture',
        'source_name':'Synthetic test only','source_url':'https://example.org/synthetic-fixture',
        'observed_on':today,'period_end':today,'rows':[{'cj_pid':'pid-1','match_note':'Synthetic exact fixture product mapping',
        'sales_kind':'observed','sales_30d':30,'previous_sales_30d':20,'searches_30d':100,'previous_searches_30d':80,
        'competitor_count':3,'competitor_median_price':'40.00','acquisition_cost':'5.00'}]}

class MarketAlgorithmTests(SimpleTestCase):
    def test_sales_trend_competition_and_ads_affect_proposal(self):
        q={'fee_percent':'3','margin_percent':'30','maximum_days':20}
        row={'pid':'pid-1','vid':'v','landed_cost':11,'inventory':50,'total_days':10,'supply_type':'cj_stock'}
        evidence=EvidenceDocument.model_validate(evidence_document()).model_dump(mode='json')
        result=propose([row],q,evidence)
        self.assertEqual(result['recommended_vid'],'v')
        self.assertEqual(result['ranked'][0]['suggested_price'],'23.89')
        self.assertGreater(Decimal(result['ranked'][0]['trend_score']),50)
        lower=deepcopy(evidence);lower['rows'][0]['sales_30d']=10;lower['rows'][0]['competitor_count']=100
        self.assertLess(Decimal(propose([row],q,lower)['ranked'][0]['score']),Decimal(result['ranked'][0]['score']))
        for change in ({'sales_30d':None},{'sales_30d':0},{'competitor_median_price':'10.00'},{'sales_kind':'estimated'}):
            invalid=deepcopy(evidence);invalid['rows'][0].update(change)
            self.assertIsNone(propose([row],q,invalid)['recommended_vid'])
        estimated=deepcopy(evidence);estimated['rows'][0]['sales_kind']='estimated'
        self.assertEqual(propose([row],q,estimated,True)['recommended_vid'],'v')

class MarketWorkflowTests(TestCase):
    setUp=launch_tests.LaunchWorkflowTests.setUp
    remote=launch_tests.LaunchWorkflowTests.remote
    document=launch_tests.LaunchWorkflowTests.document
    create_release=launch_tests.LaunchWorkflowTests.create_release
    run_release=launch_tests.LaunchWorkflowTests.run_release
    advance=launch_tests.LaunchWorkflowTests.advance

    def configured(self,change=None):
        document=evidence_document()
        if change:document['rows'][0].update(change)
        response=self.api.post('/api/v1/market-evidence',{'document':document,'confirmed_source':True},format='json')
        self.assertEqual(response.status_code,201,response.data)
        skill=SkillVersion.objects.create(team=self.team,key='product.opportunity',version='2.0.0',handler='product.opportunity.v2',
            artifact_hash=handler_hash('product.opportunity.v2'),status='approved',reviewed_by=self.user,reviewed_at=timezone.now(),review_note='Reviewed synthetic test.')
        doc=self.document();doc['nodes'][5]['binding'].update(skillId=f'registered.{skill.id}',skillVersion='2.0.0',parameters={'marketEvidenceRef':response.data['id'],'allowEstimatedSales':False})
        return doc,response.data['id']

    @override_settings(LOCAL=True,DESKTOP_MODE=True)
    def test_market_skill_desktop_respects_disabled_reviews(self):
        doc,reference=self.configured()
        doc['nodes'][7]['binding']['parameters']['approvalEnabled']=False
        doc['nodes'][10]['binding']['parameters']['approvalEnabled']=False
        run=self.run_release(self.create_release(doc));self.advance(run,False)
        self.assertEqual(run.status,'succeeded',run.error)
        self.assertEqual(run.context['brief']['variants'][0]['price'],'23.89')
        self.assertEqual(run.context['selection_proposal']['evidence_ref'],reference)
        self.assertEqual(run.approvals.count(),0)
        self.assertEqual(set(run.context['reviewWaivers']),{'brief','listing'})
        self.assertEqual(PublishedProduct.objects.count(),1)

    def test_missing_sales_pauses_on_evaluation_and_preserves_reasons(self):
        doc,_=self.configured({'sales_30d':None})
        run=self.run_release(self.create_release(doc));self.advance(run)
        self.assertEqual(run.status,'needs_attention')
        self.assertEqual(run.cursor,5)
        self.assertTrue(run.context['selection_proposal']['rejected'])
        self.assertEqual(PublishedProduct.objects.count(),0)

    def test_mismatched_or_expired_evidence_cannot_freeze(self):
        doc,reference=self.configured()
        wrong={**MarketEvidence.objects.get(pk=reference).document,'market':'GB'}
        MarketEvidence.objects.filter(pk=reference).update(document=wrong,digest=digest(wrong))
        saved=self.api.post('/api/v1/workflow-designs',{'document':doc,'expected_revision':0},format='json').data
        response=self.api.post(f'/api/v1/workflow-designs/{saved["id"]}/freeze',{'expected_revision':1},format='json')
        self.assertEqual(response.status_code,422)

    def test_expired_source_window_cannot_freeze(self):
        doc,reference=self.configured()
        old=(timezone.now().date()-timedelta(days=8)).isoformat()
        stale={**MarketEvidence.objects.get(pk=reference).document,'period_end':old,'observed_on':old}
        MarketEvidence.objects.filter(pk=reference).update(document=stale,digest=digest(stale))
        saved=self.api.post('/api/v1/workflow-designs',{'document':doc,'expected_revision':0},format='json').data
        response=self.api.post(f'/api/v1/workflow-designs/{saved["id"]}/freeze',{'expected_revision':1},format='json')
        self.assertEqual(response.status_code,422)
        self.assertIn('七天',str(response.data))

    def test_unmatched_cj_product_is_not_given_category_sales(self):
        doc,_=self.configured({'cj_pid':'different-product'})
        run=self.run_release(self.create_release(doc));self.advance(run)
        self.assertEqual(run.status,'needs_attention')
        self.assertEqual(run.context['selection_proposal']['ranked'],[])
        self.assertIn('对应',run.context['selection_proposal']['rejected'][0]['reasons'][0])
        self.assertEqual(PublishedProduct.objects.count(),0)

    def test_v2_revocation_blocks_approval(self):
        doc,_=self.configured();run=self.run_release(self.create_release(doc));self.advance(run,False)
        SkillVersion.objects.filter(team=self.team,handler='product.opportunity.v2').update(status='revoked')
        response=self.api.post(f'/api/v1/approvals/{run.approvals.get(status="pending").id}/decisions',{'decision':'approve','reason':'Synthetic first review','expected_revision':run.revision},format='json')
        self.assertEqual(response.status_code,422)
        self.assertEqual(PublishedProduct.objects.count(),0)

    def test_changed_proposal_blocks_approval(self):
        doc,_=self.configured();run=self.run_release(self.create_release(doc));self.advance(run,False)
        run.context['selection_proposal']['ranked'][0]['score']='100'
        run.save(update_fields=['context'])
        response=self.api.post(f'/api/v1/approvals/{run.approvals.get(status="pending").id}/decisions',{'decision':'approve','reason':'Synthetic review','expected_revision':run.revision},format='json')
        self.assertEqual(response.status_code,409)
        self.assertEqual(PublishedProduct.objects.count(),0)

    def test_import_requires_attestation_and_keeps_unknown_as_null(self):
        result=self.api.post('/api/v1/market-evidence',{'document':evidence_document(),'confirmed_source':False},format='json')
        self.assertEqual(result.status_code,400)
        doc,_=self.configured({'sales_30d':None})
        row=self.api.get('/api/v1/market-evidence').data[0]
        self.assertIsNone(row['document']['rows'][0]['sales_30d'])
        self.assertEqual(row['provenance'],'operator_import_unverified')

    def task_configured(self,change=None):
        doc,reference=self.configured(change)
        doc['nodes'][0]['binding']['parameters'].update(doc['nodes'][5]['binding']['parameters'])
        doc['nodes'][5]['binding']['parameters']={}
        return doc,reference

    def test_task_owned_evidence_inherits_and_completes_publication(self):
        doc,reference=self.task_configured()
        run=self.run_release(self.create_release(doc));self.advance(run)
        self.assertEqual(run.status,'succeeded',run.error)
        self.assertEqual(run.context['selection']['search']['market_evidence']['reference'],reference)
        self.assertEqual(run.context['selection_proposal']['evidence_ref'],reference)
        self.assertEqual(PublishedProduct.objects.count(),1)

    def test_task_unmatched_search_stops_before_product_detail(self):
        doc,_=self.task_configured({'cj_pid':'different-product'})
        run=self.run_release(self.create_release(doc))
        with patch('apps.runtime.selection.preview',return_value={'outcome':'results','products':[{'id':'pid-1'}],'attempts':[]}),patch('apps.runtime.selection.read') as detail:
            for _ in range(5):
                for job in list(due_jobs()):process_job(job)
                run.refresh_from_db()
                if run.status=='needs_attention':break
            detail.assert_not_called()
        self.assertEqual(run.status,'needs_attention')
        self.assertEqual(run.cursor,1)
        self.assertIn('市场证据',str(run.error))
        self.assertFalse(run.context['selection']['facts'])
        self.assertEqual(PublishedProduct.objects.count(),0)

    def test_preview_joins_task_evidence_without_widening_query(self):
        doc,reference=self.task_configured()
        query={k:v for k,v in doc['nodes'][0]['binding']['parameters'].items() if k in ('market','requestedCurrency','limit','categoryId','categoryQueries','keyword','emptyResultPolicy','marketEvidenceRef')}
        result={'outcome':'results','message':'Fixture','products':[{'id':'pid-1'},{'id':'not-matched'}],'groups':[]}
        with patch('apps.connections.cj_catalog.preview',return_value=result) as preview:
            response=self.api.post('/api/v1/connections/cj/search-preview',query,format='json')
        self.assertEqual(response.status_code,200,response.data)
        self.assertEqual(response.data['products'],[{'id':'pid-1'}])
        self.assertEqual(response.data['market_evidence']['unmatched_ids'],['not-matched'])
        self.assertEqual(preview.call_args.args[1].market,'US')

    def test_conflicting_task_and_decision_evidence_is_rejected(self):
        doc,reference=self.task_configured()
        doc['nodes'][5]['binding']['parameters']={'marketEvidenceRef':'00000000-0000-4000-8000-000000000000'}
        saved=self.api.post('/api/v1/workflow-designs',{'document':doc,'expected_revision':0},format='json').data
        response=self.api.post(f'/api/v1/workflow-designs/{saved["id"]}/freeze',{'expected_revision':1},format='json')
        self.assertEqual(response.status_code,422)
        self.assertIn('冲突',str(response.data))

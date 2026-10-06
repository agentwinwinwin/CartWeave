from types import SimpleNamespace
from unittest.mock import patch
from django.test import TestCase
from apps.identity.models import Team
from apps.connections.models import Store
from apps.runtime.models import WorkflowRun
from apps.listings.models import ChannelListing, ExternalOperation
from apps.runtime.existing_products import blocked_pids, task_blocked_pids
from apps.runtime.demand_collection import collect
from apps.connections.cj_catalog import ProductSearch
from . import test_publication as publication


class ExistingCJProductTests(TestCase):
    setUp=publication.PublicationTests.setUp

    def seed(self,pid='already',team=None,store=None,published=True):
        run=WorkflowRun.objects.create(team=team or self.team,store=store or self.store,
            version=self.version,store_version=1,requested_by=self.user,idempotency_key='fixture-'+pid,
            request_digest='a'*64,context={'brief':{'source_kind':'cj_selection','variants':[{'cj_pid':pid}]}})
        if published:ChannelListing.objects.create(run=run,team=run.team,store=run.store,external_id='external-'+pid,evidence={})
        return run

    def operation(self,run,status='unknown',action=None):
        return ExternalOperation.objects.create(run=run,team=run.team,store=run.store,key='op-'+str(run.id)+str(action),
            request_digest='b'*64,status=status,payload={'action':action} if action else {'schema_version':'ListingDraft@1'})

    def test_store_team_scope_and_current_run_retry(self):
        run=self.seed()
        other_store=Store.objects.create(team=self.team,name='second')
        self.seed('other-store',store=other_store)
        other_team=Team.objects.create(name='other')
        self.seed('other-team',team=other_team)
        self.assertEqual(blocked_pids(self.team,self.store.id),{'already'})
        self.assertEqual(blocked_pids(self.team,self.store.id,run.id),set())

    def test_pending_submission_blocks_but_draft_does_not(self):
        pending=self.seed('pending',published=False);self.operation(pending)
        self.seed('draft',published=False)
        self.assertEqual(blocked_pids(self.team,self.store.id),{'pending'})

    def test_only_confirmed_unpublish_releases_product(self):
        run=self.seed();op=self.operation(run,action='listing.unpublish')
        self.assertEqual(blocked_pids(self.team,self.store.id),{'already'})
        op.status='succeeded';op.save(update_fields=['status'])
        self.assertEqual(blocked_pids(self.team,self.store.id),set())

    def test_existing_is_skipped_before_orders_and_does_not_take_quota(self):
        self.seed()
        current=self.seed('current',published=False)
        task=SimpleNamespace(team=self.team,requested_by=self.user,query={},evidence={'workflow_run':str(current.id)})
        self.assertEqual(task_blocked_pids(task),{'already'})
        query=ProductSearch(limit=1,market='US',requestedCurrency='USD')
        state=None
        with patch('apps.runtime.selection.preview',return_value={'outcome':'results','products':[{'id':'already'},{'id':'new'}],'attempts':[]}),patch('apps.runtime.selection.read',return_value={'id':'new','orderCount':2}) as remote:
            for _ in range(10):
                state,more=collect(task,query,state)
                if not more:break
        self.assertFalse(more);self.assertEqual([p['id'] for p in state['products']],['new'])
        self.assertEqual(state['excluded_existing'][0]['pid'],'already')
        self.assertEqual(state['scanned'],1);self.assertEqual(remote.call_count,1)
        self.assertEqual(remote.call_args.kwargs['json'],{'id':'new'})

    def test_new_submission_during_selection_is_rechecked(self):
        current=self.seed('current',published=False)
        task=SimpleNamespace(team=self.team,requested_by=self.user,query={},evidence={'workflow_run':str(current.id)})
        query=ProductSearch(limit=1,market='US',requestedCurrency='USD')
        with patch('apps.runtime.selection.preview',return_value={'outcome':'results','products':[{'id':'late'}],'attempts':[]}),patch('apps.runtime.selection.read',return_value={'id':'late','orderCount':50}):
            state,_=collect(task,query);state,_=collect(task,query,state)
            late=self.seed('late',published=False);self.operation(late)
            state,more=collect(task,query,state)
        self.assertFalse(more);self.assertEqual(state['products'],[])
        self.assertEqual(state['excluded_existing'][0]['pid'],'late')

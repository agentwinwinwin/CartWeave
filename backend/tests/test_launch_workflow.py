import copy
from datetime import timedelta
from unittest.mock import patch
from django.test import TestCase, override_settings
from django.utils import timezone
from . import test_publication as publication
from . import test_selection as selection
from apps.connections.models import SupplierConnection
from apps.registry.launch import LAUNCH_IDS
from apps.workflows.models import WorkflowVersion, DesignRelease
from apps.runtime.models import WorkflowRun, SelectionTask
from apps.runtime.services import due_jobs, process_job, decide, perform
from apps.teststore.models import PublishedProduct
from contracts.store_api import package_contract
from apps.common.errors import RuleError
from apps.runtime.selection import selected_brief
from apps.skills.models import SkillVersion
from apps.skills.registry import handler_hash


class LaunchWorkflowTests(TestCase):
    setUp = publication.PublicationTests.setUp
    remote = selection.SelectionTests.remote

    def test_desktop_new_run_stops_old_and_waits_for_inflight_worker(self):
        from apps.runtime.services import finish_cancel
        release=self.create_release();old=self.run_release(release)
        old.status='running';old.save(update_fields=['status'])
        request={'version_id':release['version_id'],'store_id':str(self.store.id),'idempotency_key':'replacement-run-start'}
        with override_settings(LOCAL=True,DESKTOP_MODE=True):
            response=self.api.post('/api/v1/runs',request,format='json')
            self.assertEqual(response.status_code,409,response.data)
            old.refresh_from_db();self.assertTrue(old.context['stop_requested'])
            self.assertEqual(WorkflowRun.objects.count(),1)
            finish_cancel(old,self.user);old.save(update_fields=['status'])
            response=self.api.post('/api/v1/runs',request,format='json')
            self.assertEqual(response.status_code,202,response.data)
            new=WorkflowRun.objects.get(pk=response.data['id'])
            retry=self.api.post('/api/v1/runs',request,format='json')
            self.assertEqual(retry.status_code,200,retry.data)
            new.refresh_from_db();self.assertEqual(new.status,'queued')
            self.assertEqual(WorkflowRun.objects.count(),2)

    def test_history_retains_two_runs_and_cleans_only_obsolete_inactive_rounds(self):
        from apps.runtime.retention import prune_run_history
        from apps.runtime.models import Outbox,NodeAttempt,RunEvent
        run=self.run_release(self.create_release())
        run.status='needs_attention';run.context['selection']={'specs':[{}]*95};run.save()
        task=SelectionTask.objects.get(pk=run.context['selection_task'])
        task.status='needs_attention';task.candidates=[{'raw':'old'}];task.save()
        Outbox.objects.filter(run=run).update(status='done')
        NodeAttempt.objects.create(team=self.team,run=run,node_id='test',generation=1,input_digest='a'*64,output={'raw':[1]*100})
        newer=[]
        for i in range(2):
            newer.append(WorkflowRun.objects.create(team=self.team,version=run.version,store=self.store,
                store_version=run.store_version,requested_by=self.user,idempotency_key=f'retention-{i}',request_digest='a'*64))
        result=prune_run_history(self.team,self.user)
        self.assertEqual(result['pruned'],1)
        run.refresh_from_db();task.refresh_from_db()
        self.assertTrue(run.context['history_pruned'])
        self.assertEqual(task.candidates,[])
        self.assertFalse(NodeAttempt.objects.filter(run=run).exists())
        self.assertFalse(RunEvent.objects.filter(run=run).exists())
        self.assertFalse(Outbox.objects.filter(run=run).exists())
        self.assertEqual(prune_run_history(self.team,self.user)['pruned'],0)
        visible=self.api.get('/api/v1/runs')
        self.assertEqual(visible.status_code,200)
        self.assertEqual({r['id'] for r in visible.data},{str(r.id) for r in newer})

    def test_cj_temporary_retry_is_bounded_and_preserves_cursor(self):
        from apps.connections.cj import CJTemporary
        from apps.runtime.models import Outbox
        release=self.create_release();run=self.run_release(release)
        run.cursor=3;run.context['selection']={'filter_index':69,'specs':[{}]*95}
        run.save(update_fields=['cursor','context'])
        original=copy.deepcopy(run.context)
        job=Outbox.objects.get(run=run)
        with patch('apps.runtime.services.perform',side_effect=CJTemporary('CJ 网络请求失败或超时，正在等待重试。')):
            for attempt in range(1,4):
                Outbox.objects.filter(pk=job.pk).update(available_at=timezone.now()-timedelta(seconds=1))
                process_job(job.pk);job.refresh_from_db();run.refresh_from_db()
                self.assertEqual(run.context,original)
                self.assertEqual(run.cursor,3)
                self.assertEqual(job.attempts,attempt)
                self.assertEqual(run.status,'queued' if attempt<3 else 'needs_attention')
        self.assertIn('CJ 网络',run.error)
        self.assertEqual(job.status,'done')

    def test_cj_business_failure_does_not_retry(self):
        from apps.connections.cj import CJUnavailable
        from apps.runtime.models import Outbox
        run=self.run_release(self.create_release());run.cursor=3;run.save(update_fields=['cursor'])
        job=Outbox.objects.get(run=run)
        with patch('apps.runtime.services.perform',side_effect=CJUnavailable('CJ API 点数不足。')):
            process_job(job.pk)
        run.refresh_from_db();job.refresh_from_db()
        self.assertEqual(run.status,'needs_attention')
        self.assertEqual(job.attempts,1)
        self.assertIn('点数不足',run.error)

    def test_archive_keeps_latest_round_and_blocks_old_resume(self):
        from apps.runtime.retention import archive_old_research
        from apps.runtime.services import resume
        from apps.common.errors import Conflict
        run=self.run_release(self.create_release());run.status='needs_attention'
        run.context['selection']={'filter_index':69,'specs':[{}]*95};run.save()
        task=SelectionTask.objects.get(pk=run.context['selection_task'])
        task.status='needs_attention';task.candidates=[{'raw':'old'}];task.save()
        keep=WorkflowRun.objects.create(team=self.team,version=run.version,store=self.store,
            store_version=run.store_version,requested_by=self.user,idempotency_key='keep-latest-round',
            request_digest='a'*64,context={'selection':{'filter_index':70}})
        self.assertEqual(archive_old_research(keep,self.user),1)
        run.refresh_from_db();task.refresh_from_db();keep.refresh_from_db()
        self.assertEqual(run.context['archived_research']['checked'],69)
        self.assertEqual(task.candidates,[])
        self.assertEqual(keep.context['selection']['filter_index'],70)
        self.assertEqual(archive_old_research(keep,self.user),0)
        with self.assertRaises(Conflict):resume(run,self.user,run.revision)

    def test_archive_never_removes_brief_or_published_evidence(self):
        from apps.runtime.retention import archive_old_research
        run=self.run_release(self.create_release());run.status='needs_attention'
        run.context['brief']={'source_kind':'cj_selection'};run.save()
        keep=WorkflowRun.objects.create(team=self.team,version=run.version,store=self.store,
            store_version=run.store_version,requested_by=self.user,idempotency_key='keep-protected-round',request_digest='a'*64)
        before=copy.deepcopy(run.context)
        self.assertEqual(archive_old_research(keep,self.user),0)
        run.refresh_from_db();self.assertEqual(run.context,before)

    def test_all_rejected_filter_persists_last_sku_before_pause(self):
        from apps.runtime.launch import execute_node
        release=self.create_release();run=self.run_release(release)
        run.context['selection']={'specs':[{'product':{'pid':'pid-1','title':'Hat','image':'https://oss-cf.cjdropshipping.com/product/hat.jpg','omitted_variants':0},'variant':{'vid':'vid-1'}}],
            'filter_index':0,'candidates':[],'rejected':[]}
        def remote(task,path,**kwargs):
            result=self.remote(task,path,**kwargs)
            result['inventories']=[]
            return result
        with patch('apps.runtime.selection.read',side_effect=remote):
            result=execute_node(run,'product.filter')
        self.assertTrue(result['_research_required'])
        self.assertEqual(result['selection']['filter_index'],1)
        self.assertEqual(len(result['selection']['rejected']),1)
        self.assertEqual(result['selection']['candidates'],[])

    def test_run_polling_keeps_progress_but_not_snapshot_history(self):
        import json
        from apps.runtime.models import NodeAttempt
        from apps.runtime.serializers import RunSerializer
        release=self.create_release(self.document());run=self.run_release(release)
        run.cursor=3
        run.context={'selection':{'records':[{'id':'pid','nameEn':'Hat','raw':'x'*100000}],
            'facts':[{'pid':'pid','variants':[{'raw':'x'*100000}]}],
            'specs':[{'product':{'pid':'pid','title':'Hat','variants':['x'*100000]},'variant':{'vid':'vid'}}],
            'filter_index':0,'candidates':[],
            'collection':{'scanned':70,'scan_limit':None,'quota_limit':1000,'demand_qualified':19,
                'private_data':'x'*100000},
            'search':{'scanned':70,'scan_limit':None,'quota_limit':1000,'demand_qualified':19,
                'private_data':'x'*100000}},'private_execution_data':'x'*100000}
        run.save(update_fields=['cursor','context'])
        attempt=NodeAttempt.objects.create(team=self.team,run=run,node_id=run.version.document['nodes'][3]['id'],
            generation=1,status='progress',input_digest='a'*64,output=run.context)
        before=copy.deepcopy(run.context)
        data=RunSerializer(run).data
        self.assertLess(len(json.dumps(data,default=str)),20000)
        self.assertNotIn('output',data['attempts'][0])
        self.assertEqual(data['context']['selection']['specs'][0]['variant']['vid'],'vid')
        self.assertEqual(data['context']['selection']['filter_index'],0)
        for source in ('collection','search'):
            counters=data['context']['selection'][source]
            self.assertEqual(counters['scanned'],70)
            self.assertEqual(counters['quota_limit'],1000)
            self.assertEqual(counters['demand_qualified'],19)
            self.assertIsNone(counters['scan_limit'])
            self.assertNotIn('private_data',counters)
        run.refresh_from_db();attempt.refresh_from_db()
        self.assertEqual(run.context,before)
        self.assertEqual(attempt.output,before)

    def registered_strategy(self):
        return SkillVersion.objects.create(team=self.team,key='product.opportunity',version='1.0.0',handler='product.opportunity.v1',
            artifact_hash=handler_hash('product.opportunity.v1'),status='approved',reviewed_by=self.user,
            reviewed_at=timezone.now(),review_note='Reviewed deterministic test algorithm.')

    def test_registered_opportunity_skill_runs_through_all_fifteen_nodes(self):
        skill=self.registered_strategy();doc=self.document()
        doc['nodes'][5]['binding'].update(skillId=f'registered.{skill.id}',skillVersion=skill.version)
        release=self.create_release(doc);run=self.run_release(release);self.advance(run)
        self.assertEqual(run.status,'succeeded',run.error)
        self.assertEqual(run.context['selection_proposal']['algorithm'],skill.handler)
        proposal=run.context['selection_proposal']['ranked'][0]
        self.assertEqual(proposal['suggested_price'],run.context['brief']['variants'][0]['price'])
        self.assertEqual(run.context['selection']['strategy_version_id'],str(skill.id))
        self.assertEqual(PublishedProduct.objects.count(),1)
        rows=self.api.get('/api/v1/skills').data
        registered=next(r for r in rows if str(r['id'])==str(skill.id))
        self.assertTrue(registered['selectable'])
        self.assertEqual(registered['manifest']['input'],'DeliveryCandidates@1')
        self.assertEqual(registered['manifest']['effects'],['read'])

    def test_strategy_revocation_after_review_stops_before_publication(self):
        skill=self.registered_strategy();doc=self.document()
        doc['nodes'][5]['binding'].update(skillId=f'registered.{skill.id}',skillVersion=skill.version)
        release=self.create_release(doc);run=self.run_release(release);self.advance(run,False)
        skill.status='revoked';skill.save(update_fields=['status'])
        decide(run.approvals.get(status='pending'),self.user,'approve','Synthetic first review.',run.revision)
        for job in list(due_jobs()):process_job(job)
        run.refresh_from_db()
        self.assertEqual(run.status,'needs_attention')
        self.assertEqual(PublishedProduct.objects.count(),0)

    def document(self):
        pkg=package_contract()
        doc={'schemaVersion':'2','id':'full-launch','title':'Full CJ launch','revision':1,'templateId':'launch',
            'environment':{'channel':'test-store','fulfillment':'supplier','capabilities':[], 'storeRef':str(self.store.id)},
            'customSkills':[],'nodes':[],'edges':[]}
        params={'product.start':{'market':'US','requestedCurrency':'USD','limit':1,'keyword':'hat','variantsPerProduct':1},
            'product.filter':{'minimumInventory':5,'requireVerifiedInventory':True},
            'product.delivery':{'maximumDeliveryDays':20,'allowCrossBorderShipping':True},
            'product.cost':{'platformFeeRate':0,'paymentFeeRate':3,'returnReserveRate':0,'targetContributionRate':30,'taxReserveUsd':2},
            'listing.map':{'mappingMode':'installed','mappingPlanRef':pkg['package'],'mappingPlanVersion':pkg['version'],
                'mappingStoreRef':str(self.store.id),'mappingStoreVersion':self.store.configuration_version}}
        for key in LAUNCH_IDS:
            binding={'skillId':key+'.core','skillVersion':'1.0.0','mode':'default','parameters':params.get(key,{})}
            if key=='content.make':binding.update(skillId=f'registered.{self.skill.id}',skillVersion=self.skill.version)
            if key=='product.decide':binding.update(skillId='product.decision.landed-cost')
            if key in ('listing.validate','listing.publish','listing.wait'):
                descriptor=next(m for m in pkg['design_manifests'] if m['id']==f'installed.{pkg["package"]}.{key}')
                binding.update(skillId=descriptor['id'],skillVersion=descriptor['version'])
            doc['nodes'].append({'id':'instance-'+key,'definitionId':key,'title':key,'binding':binding})
        for a,b in zip(doc['nodes'],doc['nodes'][1:]):doc['edges'].append({'id':a['id']+':'+b['id'],'source':a['id'],'target':b['id'],'kind':'forward'})
        return doc

    def create_release(self, document=None):
        if not SupplierConnection.objects.filter(team=self.team).exists():
            SupplierConnection.objects.create(team=self.team,provider='cj',status='verified',token_expires_at=timezone.now()+timedelta(days=1))
        saved=self.api.post('/api/v1/workflow-designs',{'document':document or self.document(),'expected_revision':0},format='json')
        self.assertEqual(saved.status_code,200,saved.data)
        frozen=self.api.post(f'/api/v1/workflow-designs/{saved.data["id"]}/freeze',{'expected_revision':1},format='json')
        self.assertEqual(frozen.status_code,201,frozen.data)
        self.assertEqual(frozen.data['scope'],'cj-launch')
        return frozen.data

    def run_release(self,release):
        request={'version_id':release['version_id'],'store_id':str(self.store.id),'idempotency_key':'full-launch-start'}
        response=self.api.post('/api/v1/runs',request,format='json')
        self.assertEqual(response.status_code,202,response.data)
        retry=self.api.post('/api/v1/runs',request,format='json')
        self.assertEqual(retry.status_code,200,retry.data)
        self.assertEqual(response.data['id'],retry.data['id'])
        return WorkflowRun.objects.get(pk=response.data['id'])

    def advance(self,run,auto_approve=True):
        with patch('apps.runtime.selection.preview',return_value={'outcome':'results','products':[{'id':'pid-1'}],'attempts':[]}),patch('apps.runtime.selection.read',side_effect=self.remote):
            for _ in range(40):
                for job in list(due_jobs()):process_job(job)
                run.refresh_from_db()
                if run.status=='waiting_approval':
                    if not auto_approve:return
                    request=run.approvals.get(status='pending')
                    decide(request,self.user,'approve','Synthetic CJ fixture, temporary test database only.',run.revision)
                elif run.status in ('succeeded','needs_attention'):break
            if run.status=='needs_attention':
                # Still mocked: never issue real requests during test diagnostics.
                perform(run)

    def test_package_version_is_not_publication_descriptor_version(self):
        from apps.common.errors import RuleError
        from apps.registry.launch import validate_launch
        doc=self.document();pkg=package_contract()
        binding=next(n['binding'] for n in doc['nodes'] if n['definitionId']=='listing.publish')
        self.assertNotEqual(binding['skillVersion'],pkg['version'])
        self.create_release(doc)
        binding['skillVersion']=pkg['version']
        with self.assertRaises(RuleError):
            validate_launch(doc,self.skill)

    def test_fifteen_nodes_two_reviews_mapping_and_actual_test_store(self):
        release=self.create_release();run=self.run_release(release)
        self.assertNotIn('brief',run.context)
        self.advance(run,False)
        self.assertEqual(run.cursor,7)
        self.assertEqual(run.approvals.get(status='pending').stage,'brief')
        self.assertEqual(PublishedProduct.objects.count(),0)
        decide(run.approvals.get(status='pending'),self.user,'approve','Verified synthetic product.',run.revision)
        self.advance(run)
        self.assertEqual(run.status,'succeeded',run.error)
        self.assertEqual(run.approvals.filter(status='approved').count(),2)
        completed={a.node_id for a in run.attempts.filter(status='completed')}
        self.assertEqual(completed,{'instance-'+key for key in LAUNCH_IDS})
        self.assertEqual(run.context['prepared_publication']['listing'],run.context['listing'])
        self.assertEqual(PublishedProduct.objects.count(),1)
        self.assertEqual(PublishedProduct.objects.get().payload['variants'][0]['cj_vid'],'vid-1')
        self.assertEqual(run.context['brief']['variants'][0]['price'],'16.42')
        self.assertEqual(SelectionTask.objects.get(pk=run.context['selection_task']).status,'ready')

    def test_missing_taxes_or_unimplemented_skill_cannot_freeze(self):
        doc=self.document();doc['nodes'][5]['binding']['skillId']='product.decision.llm'
        saved=self.api.post('/api/v1/workflow-designs',{'document':doc,'expected_revision':0},format='json').data
        response=self.api.post(f'/api/v1/workflow-designs/{saved["id"]}/freeze',{'expected_revision':1},format='json')
        self.assertEqual(response.status_code,422)

        self.assertEqual(DesignRelease.objects.count(),0)
        doc=self.document();doc['nodes'][6]['binding']['parameters'].pop('taxReserveUsd')
        self.api.post('/api/v1/workflow-designs',{'document':doc,'expected_revision':1},format='json')
        response=self.api.post(f'/api/v1/workflow-designs/{saved["id"]}/freeze',{'expected_revision':2},format='json')
        self.assertEqual(response.status_code,422)

    def test_example_parameters_report_missing_strategy_first(self):
        doc=self.document()
        doc['nodes'][5]['binding'].update(skillId='product.decide.core',parameters={'market':'US','timeout':60,'instruction':'example','modelRef':''})
        saved=self.api.post('/api/v1/workflow-designs',{'document':doc,'expected_revision':0},format='json').data
        response=self.api.post(f'/api/v1/workflow-designs/{saved["id"]}/freeze',{'expected_revision':1},format='json')
        self.assertEqual(response.status_code,422)
        self.assertEqual(response.data['detail']['node_id'],'instance-product.decide')
        self.assertIn('商品机会与售价建议',str(response.data['detail']))
        self.assertEqual(DesignRelease.objects.count(),0)

    def test_changed_prepared_request_cannot_be_sent(self):
        release=self.create_release();run=self.run_release(release)
        self.advance(run,False);decide(run.approvals.get(status='pending'),self.user,'approve','First review.',run.revision)
        self.advance(run,False);decide(run.approvals.get(status='pending'),self.user,'approve','Final review.',run.revision)
        for job in list(due_jobs()):process_job(job)
        run.refresh_from_db();self.assertEqual(run.cursor,12)
        run.context['prepared_publication']['store_version']=999;run.save(update_fields=['context'])
        for job in list(due_jobs()):process_job(job)
        run.refresh_from_db();self.assertEqual(run.status,'needs_attention')
        self.assertEqual(PublishedProduct.objects.count(),0)

    def test_resumable_multi_spec_work_does_not_publish_before_reviews(self):
        doc=self.document();doc['nodes'][0]['binding']['parameters']['variantsPerProduct']=2
        release=self.create_release(doc);run=self.run_release(release)
        def remote(task,path,**kwargs):
            result=self.remote(task,path,**kwargs)
            if path=='/product/variant/queryByVid':
                result['vid']=kwargs['params']['vid'];result['variantSku']='SKU-'+result['vid'];result['variantKey']=result['vid']
            return result
        with patch('apps.runtime.selection.preview',return_value={'outcome':'results','products':[{'id':'pid-1'}],'attempts':[]}),patch('apps.runtime.selection.read',side_effect=remote):
            for _ in range(30):
                for job in list(due_jobs()):process_job(job)
                run.refresh_from_db()
                if run.status=='waiting_approval':break
        self.assertEqual(run.status,'waiting_approval',run.error)
        self.assertEqual(run.context['selection']['filter_index'],2)
        self.assertEqual(run.context['selection']['delivery_index'],2)
        self.assertEqual(len(run.context['selection']['candidates']),2)
        self.assertTrue(run.attempts.filter(status='progress').exists())
        self.assertEqual(PublishedProduct.objects.count(),0)

    @override_settings(LOCAL=True,DESKTOP_MODE=True)
    def test_full_graph_review_switches_are_frozen_and_audited(self):
        doc=self.document()
        doc['nodes'][7]['binding']['parameters']['approvalEnabled']=False
        doc['nodes'][10]['binding']['parameters']['approvalEnabled']=False
        release=self.create_release(doc);run=self.run_release(release);self.advance(run)
        self.assertEqual(run.status,'succeeded',run.error)
        self.assertEqual(run.approvals.count(),0)
        self.assertEqual(set(run.context['reviewWaivers']),{'brief','listing'})
        self.assertEqual(run.events.filter(payload__reviewMode='skipped').count(),2)

    def test_no_results_stops_at_collection_without_publish(self):
        release=self.create_release();run=self.run_release(release)
        with patch('apps.runtime.selection.preview',return_value={'outcome':'no_results'}):
            for _ in range(3):
                for job in list(due_jobs()):process_job(job)
        run.refresh_from_db()
        self.assertEqual(run.status,'needs_attention');self.assertEqual(run.cursor,1)
        self.assertEqual(PublishedProduct.objects.count(),0)
        self.assertEqual(SelectionTask.objects.get(pk=run.context['selection_task']).status,'needs_attention')

    def test_original_quote_expiry_is_not_extended_by_task_completion(self):
        release=self.create_release();run=self.run_release(release)
        self.advance(run,False)
        task=SelectionTask.objects.get(pk=run.context['selection_task'])
        task.candidates[0]['quote_observed_at']=(timezone.now()-timedelta(hours=2)).isoformat()
        task.completed_at=timezone.now()
        task.save(update_fields=['candidates','completed_at'])
        with self.assertRaises(RuleError):
            selected_brief(task,'vid-1')
        self.assertEqual(PublishedProduct.objects.count(),0)

    def test_malformed_environment_or_edges_are_rejected_without_server_error(self):
        for index,change in enumerate(({'environment':[]},{'edges':[None]})):
            doc=self.document();doc['id']=f'malformed-{index}';doc.update(change)
            saved=self.api.post('/api/v1/workflow-designs',{'document':doc,'expected_revision':0},format='json')
            self.assertEqual(saved.status_code,200)
            response=self.api.post(f'/api/v1/workflow-designs/{saved.data["id"]}/freeze',{'expected_revision':1},format='json')
            self.assertIn(response.status_code,(400,422),response.data)
        self.assertEqual(DesignRelease.objects.count(),0)

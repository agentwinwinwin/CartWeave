from datetime import timedelta
from django.conf import settings
import uuid
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from apps.approvals.models import ApprovalRequest, ApprovalDecision
from apps.audit.models import AuditRecord
from apps.common.errors import Conflict, RuleError
from apps.common.utils import digest, parse
from apps.connections.services import check_store
from contracts.listings import Brief, Listing, check_listing
from apps.identity.permissions import require_role
from apps.integrations.test_store import UnknownResult
from apps.integrations.registry import listing_adapter
from apps.listings.models import ListingRevision, ExternalOperation, ChannelListing
from apps.registry.definitions import NODE_IDS, validate_document
from apps.skills.handlers import check_skill, execute
from .models import WorkflowRun, Outbox, RunEvent, NodeAttempt, WaitCondition

def audit(run, action, actor=None, metadata=None):
    AuditRecord.objects.create(team=run.team, actor=actor, action=action, object_id=str(run.id), metadata=metadata or {})

def node(run):
    return run.version.document['nodes'][min(run.cursor, len(run.version.document['nodes']) - 1)]

def index_of(run, definition):
    return next(i for i,n in enumerate(run.version.document['nodes']) if n['definitionId']==definition)

def approval_stage(run):
    return {'product.authorize':'brief','listing.authorize':'listing'}.get(node(run)['definitionId'])

def next_edge(run):
    nodes=run.version.document['nodes']
    return next(e for e in run.version.document['edges'] if e['kind']=='forward' and e['source']==nodes[run.cursor]['id'] and e['target']==nodes[run.cursor+1]['id'])

def event(run, status, **extra):
    run.sequence += 1
    run.save(update_fields=['sequence'])
    payload = {'workflowId': str(run.version.workflow_id), 'documentRevision': run.version.revision,
        'runId': str(run.id), 'sequence': run.sequence, 'attempt': run.generation, 'nodeId': node(run)['id'],
        'status': status, 'occurredAt': timezone.now().isoformat(), **extra}
    RunEvent.objects.create(team=run.team, run=run, sequence=run.sequence, payload=payload)

def enqueue(run, delay=0):
    Outbox.objects.create(run=run, available_at=timezone.now() + timedelta(seconds=delay))

def approval_digest(run, stage):
    payload=run.context['brief' if stage == 'brief' else 'listing']
    if run.context.get('batch_mode')=='parent':payload=run.context['batch_briefs' if stage=='brief' else 'batch_listings']
    return digest({'stage': stage, 'payload': payload,
        'workflow': run.version.digest, 'skill': run.version.skill.artifact_hash,
        'store': str(run.store_id), 'store_version': run.store_version,
        **({'market_proposal':digest(run.context['selection_proposal'])} if run.context.get('selection_proposal',{}).get('algorithm') in ('product.opportunity.v2','product.opportunity.v3','product.opportunity.v4','product.opportunity.v5') else {})})

def review_enabled(run, stage):
    private_desktop = settings.LOCAL and settings.DESKTOP_MODE
    if not private_desktop:
        if run.context.get('batch_mode')=='parent' and any(b.get('source_note','').startswith('FACTORY_SUPPLY：') for b in run.context.get('batch_briefs',[])):
            return True
        if run.context.get('selection_proposal',{}).get('requires_manual_review') or 'MARKET_EVIDENCE：' in run.context['brief'].get('source_note',''):
            return True
        if run.context['brief'].get('source_kind') == 'cj_selection' and run.context['brief'].get('source_note', '').startswith('FACTORY_SUPPLY：'):
            return True
    index = index_of(run, 'product.authorize' if stage == 'brief' else 'listing.authorize')
    enabled = run.version.document['nodes'][index]['binding'].get('parameters', {}).get('approvalEnabled', True)
    # Explicit private-desktop choice takes precedence over risk-review markers.
    # Facts, quotation freshness and publication authorization are still checked.
    if enabled is False and settings.LOCAL and settings.DESKTOP_MODE:
        require_role(run.requested_by, run.team, ['admin'])
        return False
    if enabled is False:
        if not (settings.LOCAL and settings.DESKTOP_MODE):
            raise RuleError('当前运行环境不允许跳过人工审核。')
        require_role(run.requested_by, run.team, ['admin'])
    return enabled is not False

def require_approval(run, stage):
    if run.context.get('batch_parent'):
        from .batch import inherit_approval
        inherit_approval(run,stage)
        return
    if not review_enabled(run, stage):
        evidence = run.context.get('reviewWaivers', {}).get(stage)
        if evidence != approval_digest(run, stage):
            raise RuleError('缺少与当前内容版本一致的免人工审核记录。')
        return
    request = run.approvals.filter(stage=stage, status='approved', digest=approval_digest(run, stage), expires_at__gt=timezone.now()).order_by('-created_at').first()
    if not request:
        raise RuleError('缺少有效的商品方案或最终上架批准。')
    require_role(request.decision.decided_by, run.team, ['approver'])

@transaction.atomic
def start_run(version, store, user, brief, key):
    require_role(user, version.team, ['operator'])
    if store.team_id != version.team_id:
        raise RuleError('店铺不属于当前团队。')
    check_store(store)
    validate_document(version.document, version.skill, frozen=True)
    if any(n['binding'].get('parameters', {}).get('approvalEnabled') is False for n in version.document['nodes']):
        require_role(user, version.team, ['admin'])
    from apps.registry.launch import is_launch, selection_query
    full = is_launch(version.document)
    if full:
        if brief is not None:
            raise RuleError('完整流程从冻结商品任务启动，不接受外部商品资料替代 CJ 采集。')
        if version.document['environment'].get('storeRef') != str(store.id):
            raise RuleError('运行店铺与冻结配置不一致。')
        mapping = next(n['binding']['parameters'] for n in version.document['nodes'] if n['definitionId']=='listing.map')
        if mapping['mappingStoreVersion'] != store.configuration_version:
            raise Conflict('映射的店铺连接版本已变化。')
        from apps.connections.cj_catalog import connection_for
        from apps.identity.models import Membership
        supplier = connection_for(Membership.objects.get(team=version.team,user=user,active=True))
        query = selection_query(version.document)
    else:
        brief = parse(Brief, brief)
        from .selection import verify_selection_brief
        verify_selection_brief(version.team, brief)
    request_digest = digest({'version': str(version.id), 'store': str(store.id), 'store_version': store.configuration_version, 'brief': brief})
    # Lock the team so concurrent duplicate start requests serialize even before a run exists.
    type(version.team).objects.select_for_update().get(pk=version.team_id)
    previous = WorkflowRun.objects.filter(team=version.team, idempotency_key=key).first()
    if previous:
        if previous.request_digest != request_digest:
            raise Conflict('幂等键已用于不同的运行请求。')
        return previous, False
    from apps.workflows.models import ReleaseRetirement
    if ReleaseRetirement.objects.filter(release__version=version).exists():
        raise RuleError('冻结版本已删除，不能启动新运行；请到冻结版本管理页恢复或选择其他版本。')
    if settings.LOCAL and settings.DESKTOP_MODE and WorkflowRun.objects.filter(team=version.team,
            version__document__templateId=version.document.get('templateId'),status='running').exists():
        raise Conflict('上一次运行正在停止，等待在途接口结束后才能启动新运行。')
    run = WorkflowRun.objects.create(team=version.team, version=version, store=store,
        store_version=store.configuration_version, requested_by=user, idempotency_key=key,
        request_digest=request_digest, context={'brief': brief})
    if full:
        from .models import SelectionTask
        if SelectionTask.objects.filter(team=version.team,status__in=['queued','running','workflow_owned']).exists():
            raise Conflict('已有 CJ 选品执行中，请等待，避免重复占用配额。')
        task=SelectionTask.objects.create(team=version.team,requested_by=user,query=query,
            connection_version=supplier.configuration_version,status='workflow_owned',evidence={'workflow_run':str(run.id)})
        run.context={'query':query,'selection_task':str(task.id)}
        run.save(update_fields=['context'])
    if settings.LOCAL and settings.DESKTOP_MODE:
        from .retention import prune_run_history
        prune_run_history(version.team, user)
    audit(run, 'run.created', user, {'request_digest': request_digest})
    enqueue(run)
    return run, True

@transaction.atomic
def decide(request, user, decision, reason, expected_revision):
    # Always lock run before approval to maintain the same lock order as revisions.
    run = WorkflowRun.objects.select_for_update().select_related('version__skill', 'store').get(pk=request.run_id)
    request = ApprovalRequest.objects.select_for_update().get(pk=request.pk)
    require_role(user, run.team, ['approver'])
    if request.status in ('approved', 'rejected'):
        existing = request.decision
        if existing.decided_by_id == user.id and existing.decision == decision and existing.reason == reason:
            return run
        raise Conflict('该审批已有决定。')
    if run.status != 'waiting_approval' or run.revision != expected_revision or request.run_revision != run.revision or request.status != 'pending' or request.expires_at <= timezone.now() or request.digest != approval_digest(run, request.stage):
        raise Conflict('审批已过期或草稿版本发生变化。')
    check_store(run.store, run.store_version)
    check_skill(run.version.skill)
    from .market_proof import verify
    verify(run)
    if run.context.get('batch_mode')=='parent':
        from .batch import validate_approval
        validate_approval(run,request.stage)
    ApprovalDecision.objects.create(team=run.team, request=request, decided_by=user, decision=decision, reason=reason)
    request.status = 'approved' if decision == 'approve' else 'rejected'
    request.save(update_fields=['status'])
    pending_attempt = run.attempts.filter(node_id=node(run)['id'], generation=run.generation, status='waiting_approval').order_by('-created_at').first()
    if pending_attempt:
        pending_attempt.status = 'completed' if decision == 'approve' else 'rejected'
        pending_attempt.completed_at = timezone.now()
        pending_attempt.output = {'approval_ref': str(request.id), 'approved_digest': request.digest, 'decision': decision}
        pending_attempt.save(update_fields=['status', 'completed_at', 'output'])
    WaitCondition.objects.filter(run=run, resolved=False).update(resolved=True)
    if decision == 'approve':
        event(run, 'completed', approvalRef=str(request.id))
        event(run, 'transferring', edgeId=next_edge(run)['id'])
        run.cursor += 1
        run.status = 'queued'
        run.revision += 1
        run.save(update_fields=['cursor', 'status', 'revision'])
        enqueue(run)
    else:
        run.status = 'needs_attention'
        run.error = '批次审批已拒绝；请取消本批次，调整配置后重新冻结并启动。' if run.context.get('batch_mode')=='parent' else '审批拒绝，请修订后重新提交。'
        run.revision += 1
        run.save(update_fields=['status', 'error', 'revision'])
        event(run, 'stopped', approvalRef=str(request.id))
    audit(run, 'approval.' + decision, user, {'approval': str(request.id), 'reason': reason})
    return run

@transaction.atomic
def revise(run, user, stage, payload, expected_revision, reason):
    run = WorkflowRun.objects.select_for_update().select_related('version__skill').get(pk=run.pk)
    require_role(user, run.team, ['operator'])
    if run.context.get('batch_mode')=='parent' or run.context.get('batch_parent'):
        raise RuleError('批次成员不能用单商品返工接口改写；请调整配置并建立新批次，已发布商品保留。')
    if run.revision != expected_revision or run.status not in ('waiting_approval', 'needs_attention') or approval_stage(run) is None or run.generation >= 4:
        raise Conflict('仅待审批或拒绝的草稿允许返工，最多三轮。')
    if stage == 'listing' and approval_stage(run) != 'listing':
        raise RuleError('尚未生成最终草稿。')
    if run.operations.exists():
        raise RuleError('已有发布操作，不能通过返工重放。')
    if stage == 'brief':
        from .selection import verify_selection_brief
        if run.context['brief'].get('source_kind') == 'cj_selection' and payload.get('source_kind') != 'cj_selection':
            raise RuleError('不可移除真实选品的证据约束。')
        verify_selection_brief(run.team, payload)
        run.context = {**{k:v for k,v in run.context.items() if k in ('selection','query','selection_task','selection_proposal')}, 'brief': parse(Brief, payload)}
        run.cursor = index_of(run,'product.authorize')
        run.approvals.filter(status__in=['pending', 'approved']).update(status='superseded')
    else:
        listing = parse(Listing, payload)
        check_listing(listing, run.context['brief'])
        run.context['listing'] = listing
        run.context.pop('channel_validation', None)
        run.context.pop('prepared_publication', None)
        run.cursor = index_of(run,'listing.validate')
        run.approvals.filter(stage='listing', status__in=['pending', 'approved']).update(status='superseded')
    run.generation += 1
    run.attempts.filter(status='waiting_approval').update(status='superseded', completed_at=timezone.now())
    run.revision += 1
    run.status, run.error = 'queued', ''
    run.save(update_fields=['context', 'cursor', 'generation', 'revision', 'status', 'error'])
    WaitCondition.objects.filter(run=run, resolved=False).update(resolved=True)
    audit(run, 'run.revised', user, {'stage': stage, 'reason': reason})
    enqueue(run)
    return run

@transaction.atomic
def resume(run, user, expected_revision):
    run = WorkflowRun.objects.select_for_update().get(pk=run.pk)
    require_role(user, run.team, ['operator'])
    if run.context.get('archived_research'):
        raise Conflict('旧轮次的研究中间数据已清理；请启动新流程，不能从旧断点恢复。')
    if run.revision != expected_revision or run.status != 'needs_attention' or approval_stage(run) is not None:
        raise Conflict('当前运行不能直接恢复；拒绝审批需要修订。')
    if run.context.get('batch_children'):
        for child in WorkflowRun.objects.filter(pk__in=run.context['batch_children'],team=run.team,status='needs_attention'):
            resume(child,user,child.revision)
    if run.context.get('selection_task') and not run.context.get('brief'):
        from .models import SelectionTask
        type(run.team).objects.select_for_update().get(pk=run.team_id)
        if SelectionTask.objects.filter(team=run.team,status__in=['queued','running','workflow_owned']).exclude(pk=run.context['selection_task']).exists():
            raise Conflict('另一个选品任务正在执行，请等待后恢复。')
        SelectionTask.objects.filter(pk=run.context['selection_task']).update(status='workflow_owned')
    run.status, run.error = 'queued', ''
    run.revision += 1
    run.save(update_fields=['status', 'error', 'revision'])
    audit(run, 'run.resumed', user)
    enqueue(run)
    return run

@transaction.atomic
def cancel(run, user, expected_revision):
    run = WorkflowRun.objects.select_for_update().get(pk=run.pk)
    require_role(user, run.team, ['operator'])
    if run.revision != expected_revision or run.status not in ('queued', 'running', 'waiting_approval', 'waiting_event', 'needs_attention'):
        raise Conflict('运行版本已变化或已结束，请刷新后再停止。')
    if run.context.get('stop_requested'):return run
    run.revision += 1
    if run.status=='running':
        run.context={**run.context,'stop_requested':True}
        run.save(update_fields=['context','revision'])
        audit(run,'run.stop_requested',user,{'warning':'Current in-flight request may finish; remote effects are not undone.'})
    else:
        finish_cancel(run,user)
        run.save(update_fields=['status','revision'])
    for child in WorkflowRun.objects.select_for_update().filter(team=run.team,context__batch_parent=str(run.id)).exclude(status__in=['succeeded','cancelled']):
        if child.status=='running':
            child.context={**child.context,'stop_requested':True};child.revision+=1;child.save(update_fields=['context','revision'])
        else:
            child.revision+=1;finish_cancel(child,user);child.save(update_fields=['status','revision'])
    return run

def finish_cancel(run,user=None):
    """Stop at a safe worker boundary; never discard an in-flight external receipt."""
    run.status='cancelled'
    run.approvals.filter(status='pending').update(status='superseded')
    run.attempts.filter(status='waiting_approval').update(status='cancelled', completed_at=timezone.now())
    WaitCondition.objects.filter(run=run, resolved=False).update(resolved=True)
    audit(run, 'run.cancelled', user, {'warning': 'Cancellation does not undo remote publication.'})
    if run.context.get('selection_task'):
        from .models import SelectionTask
        SelectionTask.objects.filter(pk=run.context['selection_task'],status='workflow_owned').update(status='cancelled')
    event(run, 'stopped')

def perform(run):
    """Remote calls are outside transactions. Only the closed registry is executable."""
    definition = node(run)['definitionId']
    check_store(run.store, run.store_version)
    require_role(run.requested_by, run.team, ['operator'])
    check_skill(run.version.skill)
    from .market_proof import verify
    verify(run)
    from .selection import verify_selection_brief
    from apps.registry.launch import LAUNCH_IDS, is_launch
    if is_launch(run.version.document):
        from apps.skills.registry import selection_skill
        from apps.registry.launch import decision_binding
        selection_skill(decision_binding(run.version.document),run.team)
        if definition=='market.intelligence':
            from apps.connections.intelligence_plans import execute as collect_intelligence
            return collect_intelligence(run)
        from .batch import enabled, perform as perform_batch
        if enabled(run):return perform_batch(run,definition)
    if is_launch(run.version.document) and definition=='product.verify':
        from .unified_selection import verify
        return verify(run)
    if is_launch(run.version.document) and definition in LAUNCH_IDS[:7]:
        from .launch import execute_node
        return execute_node(run,definition)
    verify_selection_brief(run.team, run.context['brief'])
    if definition == 'content.make':
        require_approval(run, 'brief')
        listing = parse(Listing, execute(run.version.skill, run.context['brief'], {}))
        check_listing(listing, run.context['brief'])
        return {'listing': listing}
    adapter = listing_adapter(run.store)
    if definition == 'listing.validate':
        require_approval(run, 'brief')
        check_listing(run.context['listing'], run.context['brief'])
        return {'channel_validation': adapter.validate(run.context['listing'])}
    if definition == 'listing.map':
        require_approval(run,'brief')
        require_approval(run,'listing')
        check_listing(run.context['listing'],run.context['brief'])
        if not run.context.get('channel_validation',{}).get('valid'):
            raise RuleError('渠道必填字段检查未通过，不能准备发布。')
        from contracts.publication import PreparedPublication
        p=node(run)['binding']['parameters']
        return {'prepared_publication':parse(PreparedPublication,{
            'listing':run.context['listing'],'listing_digest':digest(run.context['listing']),
            'approval_digest':approval_digest(run,'listing'),'store_id':str(run.store_id),
            'store_version':run.store_version,'package':p['mappingPlanRef'],'package_version':p['mappingPlanVersion']})}
    if definition == 'listing.publish':
        if is_launch(run.version.document):
            from contracts.publication import PreparedPublication
            prepared=parse(PreparedPublication,run.context.get('prepared_publication',{}))
            from contracts.store_api import publication_package_compatible
            plan=next(n['binding']['parameters'] for n in run.version.document['nodes'] if n['definitionId']=='listing.map')
            if prepared['listing'] != run.context['listing'] or prepared['listing_digest']!=digest(run.context['listing']) or prepared['approval_digest']!=approval_digest(run,'listing') or prepared['store_id']!=str(run.store_id) or prepared['store_version']!=run.store_version or prepared['package']!=plan['mappingPlanRef'] or prepared['package_version']!=plan['mappingPlanVersion'] or not publication_package_compatible(prepared['package'],prepared['package_version']):
                raise RuleError('准备结果与批准内容、店铺或已安装接口包不一致，禁止发送。')
        require_approval(run, 'brief')
        require_approval(run, 'listing')
        check_listing(run.context['listing'], run.context['brief'])
        key = digest({'store': str(run.store_id), 'approved_payload': approval_digest(run, 'listing')})
        with transaction.atomic():
            from apps.connections.models import Store
            from .existing_products import blocked_pids, cj_pids
            Store.objects.select_for_update().get(pk=run.store_id,team=run.team)
            if cj_pids(run.context['brief']) & blocked_pids(run.team,run.store_id,run.id):
                raise RuleError('同店铺已有该 CJ 商品的上架记录或待确认发布，停止重复提交；请检查商品模块。')
            operation, _ = ExternalOperation.objects.get_or_create(store=run.store, key=key,
                defaults={'team': run.team, 'run': run, 'request_digest': digest(run.context['listing']), 'payload': run.context['listing']})
            if operation.request_digest != digest(run.context['listing']):
                raise Conflict('发布操作键与内容不一致。')
            if operation.status == 'succeeded':
                return {'receipt': operation.receipt}
            # Persist uncertainty before the request, so a crash causes reconciliation.
            operation.status = 'unknown'
            operation.save(update_fields=['status'])
        receipt = adapter.lookup(key)
        if receipt is None:
            # The audited test-store API enforces this key atomically. Never switch keys on retry.
            receipt = adapter.publish(operation)
        if receipt.get('digest') != operation.request_digest or not receipt.get('external_id'):
            raise UnknownResult('发布回执无法核验。')
        from contracts.listings import PublicationReceipt
        receipt = parse(PublicationReceipt, receipt)
        if receipt['storefront_id'] != str(run.store_id) or receipt['product_id'] != run.context['listing']['product_id']:
            raise RuleError('发布回执的店铺或商品不匹配。')
        ExternalOperation.objects.filter(pk=operation.pk).update(status='succeeded', receipt=receipt)
        return {'receipt': receipt}
    if definition == 'listing.wait':
        evidence = adapter.verify(run.context['receipt']['external_id'], digest(run.context['listing']))
        from contracts.listings import PublishedEvidence
        evidence = parse(PublishedEvidence, evidence)
        if evidence['storefront_id'] != str(run.store_id) or evidence['product_id'] != run.context['listing']['product_id'] or evidence['listing'] != run.context['listing']:
            raise RuleError('可售证据与批准的商品内容不匹配。')
        return {'published': evidence}
    if definition == 'listing.end':
        if not run.context.get('published'):
            raise RuleError('尚无真实可售证据。')
        return {}
    return {}

def process_job(job_id):
    token = uuid.uuid4()
    with transaction.atomic():
        job = Outbox.objects.select_for_update().get(pk=job_id)
        now = timezone.now()
        if job.status == 'done' or job.available_at > now or job.lease_until and job.lease_until > now:
            return False
        run = WorkflowRun.objects.select_for_update().select_related('version__skill', 'store', 'requested_by').get(pk=job.run_id)
        if run.status not in ('queued', 'running', 'waiting_event'):
            job.status = 'done'
            job.save(update_fields=['status'])
            return False
        if run.context.get('stop_requested'):
            finish_cancel(run,run.requested_by);run.save(update_fields=['status'])
            job.status='done';job.save(update_fields=['status']);return False
        # No other live task for this run may own execution.
        if Outbox.objects.filter(run=run, status='claimed', lease_until__gt=now).exclude(pk=job.pk).exists():
            return False
        job.status, job.lease_token, job.lease_until = 'claimed', token, now + timedelta(seconds=90)
        job.attempts += 1
        job.save(update_fields=['status', 'lease_token', 'lease_until', 'attempts'])
        cursor, generation = run.cursor, run.generation
        NodeAttempt.objects.filter(run=run, status='running').update(status='interrupted', completed_at=now)
        attempt = NodeAttempt.objects.create(team=run.team, run=run, node_id=node(run)['id'], generation=generation, input_digest=digest(run.context))
        run.status = 'running'
        run.save(update_fields=['status'])
        event(run, 'running')
    try:
        if approval_stage(run):
            from .market_proof import verify
            verify(run)
            check_store(run.store, run.store_version)
            check_skill(run.version.skill)
            require_role(run.requested_by, run.team, ['operator'])
            if run.context.get('batch_mode')=='parent':
                from .batch import validate_approval
                validate_approval(run,approval_stage(run))
            if approval_stage(run) == 'listing':
                require_approval(run, 'brief')
                if not run.context.get('channel_validation', {}).get('valid'):
                    raise RuleError('渠道检查尚未通过。')
            stage = approval_stage(run)
            result, error = {}, None
            if not review_enabled(run, stage):
                result = {'reviewWaivers': {**run.context.get('reviewWaivers', {}), stage: approval_digest(run, stage)}}
        else:
            result, error = perform(run), None
    except Exception as exc:
        from apps.common.db_retry import transient_database_lock
        if transient_database_lock(exc):
            raise
        # Unexpected errors never leak credentials, prompts or HTTP payloads into logs/API.
        result, error = {}, exc
    with transaction.atomic():
        job = Outbox.objects.select_for_update().get(pk=job_id)
        current = WorkflowRun.objects.select_for_update().select_related('version__skill', 'store').get(pk=run.pk)
        if job.lease_token != token or current.cursor != cursor or current.generation != generation or current.status != 'running':
            return False
        attempt.completed_at = timezone.now()
        if not error:
            current.error = ''
        if current.context.get('stop_requested'):
            current.context.update({k:v for k,v in result.items() if not k.startswith('_')})
            attempt.status='failed' if error else 'completed'
            attempt.output={'stop_requested':True,'inflight_completed':not bool(error)}
            if error:current.error='停止前的在途请求未完成；已保留操作记录，外部结果须核对。'
            if result.get('published') and node(current)['definitionId']=='listing.wait' and current.context.get('batch_mode')!='parent':
                ChannelListing.objects.get_or_create(run=current,defaults={'team':current.team,'store':current.store,'external_id':result['published']['external_id'],'evidence':result['published']})
            finish_cancel(current,current.requested_by)
            job.status='done'
        elif error:
            from apps.connections.cj import CJUnavailable, CJTemporary
            unknown = isinstance(error, UnknownResult)
            attempt.status = 'unknown' if unknown else 'failed'
            current.error = str(error.detail)[:500] if isinstance(error, (RuleError, Conflict, CJUnavailable)) else ('外部结果未知，正在核对。' if unknown else '节点执行失败，请查看运行记录并由管理员处理。')
            attempt.output={'error':{'code':getattr(error,'default_code','internal_error'),'message':current.error}}
            readonly_cj=node(current)['definitionId'] in ('product.collect','product.normalize','product.filter','product.delivery','product.verify')
            if isinstance(error,CJTemporary) and readonly_cj and job.attempts < 3:
                delay=2**job.attempts
                current.error=f'{current.error} 第 {job.attempts}/3 次尝试失败，{delay} 秒后重试当前步骤。'
                current.status='queued'
                job.status,job.available_at,job.lease_until='pending',timezone.now()+timedelta(seconds=delay),None
                event(current,'queued')
            elif unknown and job.attempts < 5:
                current.status = 'waiting_event'
                job.status, job.available_at, job.lease_until = 'pending', timezone.now() + timedelta(seconds=10), None
                WaitCondition.objects.get_or_create(team=current.team, run=current, kind='channel_result', generation=generation, resolved=False)
                event(current, 'waiting_event')
            else:
                current.status, job.status = 'needs_attention', 'done'
                if current.context.get('selection_task') and not current.context.get('brief'):
                    from .models import SelectionTask
                    SelectionTask.objects.filter(pk=current.context['selection_task'],status='workflow_owned').update(status='needs_attention',error=current.error)
                event(current, 'failed')
        elif result.get('_research_required'):
            result.pop('_research_required')
            research_message=result.pop('_research_message',None)
            current.context.update(result)
            current.status,job.status,attempt.status='needs_attention','done','failed'
            current.error=research_message or '市场证据不足或没有满足当前策略的商品；停在评估节点，请查看待研究原因。'
            attempt.output=result
            from .models import SelectionTask
            if not current.context.get('brief'):
                SelectionTask.objects.filter(pk=current.context['selection_task']).update(status='needs_attention',error=current.error)
            event(current,'failed')
        elif '_local_advance' in result:
            target=result.pop('_local_advance')
            from .batch import enabled
            from .cj_snapshot import complete_detail
            local_selection=result.get('selection',{}).get('current_research',{})
            # Only the two existing pure checks may share a worker turn.
            if cursor!=2 or target not in (2,4) or not enabled(current) or (
                not local_selection.get('specs') or not all(complete_detail(s['variant']) for s in local_selection['specs']) or
                local_selection.get('filter_index')!=len(local_selection['specs'])):
                raise RuleError('未授权的本地联合校验。')
            current.context.update(result)
            from .retention import progress_output
            attempt.status,attempt.output='completed',progress_output(result)
            event(current,'completed')
            current.cursor=3
            NodeAttempt.objects.create(team=current.team,run=current,node_id=node(current)['id'],generation=generation,
                input_digest=digest(local_selection['specs']),status='completed',completed_at=timezone.now(),
                output={**progress_output({'selection':local_selection}),'local_validation':True,'source':'/product/productDetail/query'})
            event(current,'completed')
            current.cursor=target;current.status,job.status='queued','done'
            event(current,'queued');enqueue(current)
        elif '_goto' in result:
            target=result.pop('_goto')
            from .batch import enabled
            from apps.registry.launch import intelligence_offset
            offset=intelligence_offset(current.version.document)
            if not enabled(current) or not ((cursor-offset in (2,3,4) and target==2) or (cursor-offset==2 and target==1 and current.context.get('selection',{}).get('collection',{}).get('continuation'))):
                raise RuleError('未授权的研究回路。')
            current.context.update(result)
            attempt.status,attempt.output='progress',{'qualified':result.get('batch_meta',{}).get('qualified',0)}
            current.cursor=target+offset;current.status,job.status='queued','done'
            event(current,'queued');enqueue(current)
        elif result.get('_continue'):
            result.pop('_continue')
            delay=result.pop('_delay',0)
            if delay and (current.context.get('batch_mode')!='parent' or delay!=2):raise RuleError('未授权的等待间隔。')
            current.context.update(result)
            from .retention import progress_output
            attempt.status,attempt.output='progress',progress_output(result)
            current.status,job.status='queued','done'
            enqueue(current,delay)
        elif approval_stage(current) and review_enabled(current, approval_stage(current)):
            stage = approval_stage(current)
            approval = ApprovalRequest.objects.create(team=current.team, run=current, stage=stage,
                generation=generation, run_revision=current.revision, digest=approval_digest(current, stage),
                snapshot={'payload': current.context['brief' if stage == 'brief' else 'listing'], 'store_id': str(current.store_id), 'store_version': current.store_version,
                    **({'batch_items':current.context['batch_briefs' if stage=='brief' else 'batch_listings']} if current.context.get('batch_mode')=='parent' else {})},
                expires_at=timezone.now() + timedelta(hours=24))
            WaitCondition.objects.create(team=current.team, run=current, kind='approval', generation=generation)
            current.status, job.status, attempt.status = 'waiting_approval', 'done', 'waiting_approval'
            event(current, 'waiting_approval', approvalRef=str(approval.id))
        else:
            current.context.update(result)
            attempt.status, attempt.output = 'completed', result
            if approval_stage(current):
                stage = approval_stage(current)
                audit(current, 'approval.skipped', current.requested_by, {'stage': stage, 'digest': approval_digest(current, stage), 'policy': 'desktop-test-store'})
                event(current, 'completed', reviewMode='skipped', stage=stage)
            else:
                event(current, 'completed')
            if node(current)['definitionId'] == 'content.make' and current.context.get('batch_mode')!='parent':
                ListingRevision.objects.create(team=current.team, run=current, generation=generation, digest=digest(result['listing']), payload=result['listing'])
            if node(current)['definitionId'] == 'listing.wait' and current.context.get('batch_mode')!='parent':
                ChannelListing.objects.get_or_create(run=current, defaults={'team': current.team, 'store': current.store,
                    'external_id': result['published']['external_id'], 'evidence': result['published']})
                WaitCondition.objects.filter(run=current, kind='channel_result', resolved=False).update(resolved=True)
            job.status = 'done'
            if cursor == len(current.version.document['nodes']) - 1:
                current.status = 'succeeded'
                audit(current, 'run.succeeded')
            else:
                edge = next_edge(current)
                event(current, 'transferring', edgeId=edge['id'])
                current.cursor += 1
                current.status = 'queued'
                enqueue(current)
        attempt.save(update_fields=['status', 'output', 'completed_at'])
        current.save(update_fields=['status', 'cursor', 'context', 'error'])
        job.save(update_fields=['status', 'available_at', 'lease_until'])
    return True

def due_jobs():
    from django.db.models import Q
    now = timezone.now()
    return Outbox.objects.filter(status__in=['pending', 'claimed'], available_at__lte=now).filter(Q(lease_until__isnull=True) | Q(lease_until__lte=now)).order_by('created_at').values_list('id', flat=True)[:50]

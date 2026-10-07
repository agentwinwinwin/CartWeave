"""Durable closed business workflows; reuse model/image executors, never publication handlers."""
import uuid
import hashlib
from datetime import timedelta
from django.db import transaction
from django.utils import timezone
from rest_framework.views import APIView
from rest_framework.response import Response
from django.shortcuts import get_object_or_404
from apps.common.errors import RuleError, Conflict
from apps.common.utils import digest
from apps.connections.services import check_store
from apps.identity.permissions import membership, require_role
from apps.identity.models import Membership
from apps.registry.business import validate, configuration
from apps.agents.models import OperationReport, ProductImageBatch
from apps.teststore.testing import adapter_for, call
from apps.common.utils import parse
from contracts.listings import Contract
from pydantic import Field
from typing import Literal
from .models import WorkflowRun, Outbox, NodeAttempt, SupportMessageClaim

class Confirmation(Contract):
    expected_revision: int = Field(ge=1,strict=True)
    confirmed: Literal[True]
    asset_ids: list[uuid.UUID] = Field(default_factory=list,max_length=2500)

def member_for(run):
    return Membership.objects.get(team=run.team,user=run.requested_by,active=True)

@transaction.atomic
def start(version,store,user,brief,key,message_claim=None):
    from .services import audit, enqueue
    if brief is not None: raise RuleError('客服与图片使用冻结节点配置，不接受商品发布输入。')
    validate(version.document,version.team,True)
    if version.document['environment'].get('storeRef')!=str(store.id): raise RuleError('店铺与冻结配置不匹配。')
    from apps.workflows.models import DesignRelease
    release=DesignRelease.objects.filter(version=version,team=version.team,store=store).first()
    if not release: raise RuleError('缺少完整业务冻结快照，不能运行。')
    check_store(store,release.store_version)
    config=configuration(version.document)
    if version.document['templateId']=='support' and config.get('input_mode')=='inbox':
        if not message_claim or message_claim.team_id!=version.team_id or message_claim.store_id!=store.id or message_claim.store_version!=store.configuration_version or not message_claim.release_id or message_claim.release.version_id!=version.id:
            raise RuleError('此冻结版本监听收件箱，请在定时器启用“一直执行”；不能手动重复启动无消息的流程。')
    elif message_claim is not None: raise RuleError('此版本不接收收件箱事件。')
    fingerprint=digest({'version':str(version.id),'store':str(store.id),'store_version':store.configuration_version,
        **({'message_id':str(message_claim.message_id)} if message_claim else {})})
    type(version.team).objects.select_for_update().get(pk=version.team_id)
    previous=WorkflowRun.objects.filter(team=version.team,idempotency_key=key).first()
    if previous:
        if previous.request_digest!=fingerprint: raise Conflict('请求键已用于另一运行。')
        return previous,False
    from apps.workflows.models import ReleaseRetirement
    if ReleaseRetirement.objects.filter(release__version=version).exists(): raise RuleError('冻结版本已删除。')
    active=WorkflowRun.objects.filter(team=version.team,version__document__templateId=version.document['templateId'])
    active=active.filter(store=store,status__in=['queued','running','waiting_event']) if message_claim else active.filter(status__in=['queued','running','waiting_event','waiting_approval','needs_attention'])
    if active.exists():
        raise Conflict('此业务还有未结束运行，请先返回原运行继续或明确停止；不会重复调用模型或生图。')
    if version.document['templateId']=='support':
        if message_claim:
            if message_claim.run_id: raise Conflict('此客户消息已有执行记录，不能重复调用模型。')
        else:
            message_claim,created=SupportMessageClaim.objects.get_or_create(team=version.team,store=store,
                store_version=store.configuration_version,message_id=config['message_id'])
            if not created:
                previous_run=message_claim.run
                old_report=OperationReport.objects.filter(team=version.team,request_key=uuid.uuid5(previous_run.id,'support-reply')).first() if previous_run else None
                # A NEW explicit manual request may retry a cancelled, known-failed
                # draft. Event claims and unknown/sent results never auto retry.
                if message_claim.schedule_id or not previous_run or previous_run.status!='cancelled' or old_report and old_report.payload.get('status')!='failed':
                    raise Conflict('此客户消息已有执行意图，请返回原运行；结果未知或已发送的消息不能重复执行。')
    state={'kind':version.document['templateId']}
    if message_claim: state.update(message_id=str(message_claim.message_id),message_claim_id=str(message_claim.id))
    run=WorkflowRun.objects.create(team=version.team,version=version,store=store,store_version=store.configuration_version,
        requested_by=user,idempotency_key=key,request_digest=fingerprint,context={'business':state})
    if message_claim:
        message_claim.run=run;message_claim.save(update_fields=['run'])
    audit(run,'run.created',user); enqueue(run)
    return run,True

def report(run):
    return OperationReport.objects.get(pk=run.context['business']['report_id'],team=run.team)

def batch(run):
    return ProductImageBatch.objects.get(pk=run.context['business']['batch_id'],team=run.team)

def step(run):
    state=dict(run.context['business']); config=configuration(run.version.document); member=member_for(run)
    if state['kind']=='fulfillment':
        from .fulfillment import step as fulfillment_step
        return fulfillment_step(run,state,config)
    if state['kind']=='support':
        store,adapter=adapter_for(member,str(run.store_id))
        message_id=state.get('message_id') or config['message_id']
        if run.cursor==0:
            claim=SupportMessageClaim.objects.filter(pk=state.get('message_claim_id'),run=run,team=run.team).first()
            if config.get('input_mode')=='inbox':
                if not claim or str(claim.message_id)!=message_id: raise RuleError('缺少已领取的真实消息。')
                state['message']=claim.message
            else:
                inbox=call(adapter,'support.messages',{})
                recent=call(adapter,'test.records',{})
                if any(r['kind']=='reply' and r['payload'].get('message_id')==message_id for r in recent['records']):
                    raise RuleError('此客户消息已有答复，不能重复生成或发送；请选择新的消息。')
                item=next((m for m in inbox['messages'] if m['id']==message_id),None)
                if not item: raise RuleError('冻结的客户消息已不可用，请重新选择并冻结。')
                state['message']=item
        elif run.cursor==1:
            state['evidence']=call(adapter,'support.context',{'message_id':message_id})
            if state['evidence']['message_id']!=message_id or state['evidence']['message']!=state['message']['message']:
                raise RuleError('收件与资料不匹配，不能调用模型。')
        elif run.cursor==2:
            # Reserve BEFORE calling the model. A lost result never causes silent replay.
            key=uuid.uuid5(run.id,'support-reply')
            r,created=OperationReport.objects.get_or_create(team=run.team,request_key=key,
                defaults={'kind':'support','requested_by':run.requested_by,'request_digest':digest(state['evidence']),
                    'payload':{'status':'processing','workflow_run_id':str(run.id)}})
            if not created:
                if r.payload.get('status') in ('processing','failed'): raise RuleError('此轮模型调用失败或结果未知，禁止自动重试；请明确启动新运行。')
            else:
                from apps.agents.store_support import prepare
                try:
                    r.payload={**prepare({**config,'message_id':message_id,'store_id':str(store.id)},member,state['evidence']),'workflow_run_id':str(run.id)}
                    r.save(update_fields=['payload'])
                except Exception:
                    r.payload={'status':'failed','workflow_run_id':str(run.id),'error':'模型执行未完成，未发送；需要新运行才能重试。'}
                    r.save(update_fields=['payload']); raise
            state['report_id']=str(r.id); state['reply']=r.payload
        elif run.cursor==3:
            r=report(run);p=r.payload
            if p['status']=='handoff': raise RuleError('缺少事实或涉及权益处理，已转人工；禁止继续发送。')
            if config.get('reply_policy')=='automatic' and config.get('input_mode')=='inbox':
                if p['reply']['questions'] or not p['evidence']:
                    raise RuleError('客服仍有待确认问题或缺少政策证据，转人工；不会自动发送。')
                p={**p,'authorization':{'mode':'frozen_automatic_policy','version_id':str(run.version_id)},
                    'events':[e if e['step']!=4 else {'step':4,'label':'冻结自动答复政策核验（非人工批准）'} for e in p['events']]}
                r.payload=p;r.save(update_fields=['payload'])
                state['confirmation_digest']=digest(p)
                state['approved']={'mode':'frozen_automatic_policy','version_id':str(run.version_id),'payload':p}
                from .services import audit
                audit(run,'support.automatic_policy_checked',metadata={'reply_digest':digest(p),'message_id':message_id})
                return state,'done'
            state['confirmation_digest']=digest(p)
            return state,'approval'
        elif run.cursor==4:
            r=report(run)
            if not state.get('approved') or digest(state['approved']['payload'])!=state['confirmation_digest']:
                raise RuleError('客服回复未获得本轮人工确认或冻结自动答复授权。')
            approved=state['approved']['payload']
            if any(r.payload.get(k)!=approved.get(k) for k in ('message_id','store_id','store_version','context_digest','reply')):
                raise RuleError('已批准的消息、资料或回复发生变化，禁止发送。')
            if r.payload.get('status')!='sent':
                from apps.agents.store_support import send
                r=send(member,r.pk,{'confirmed':True,'expected_revision':r.payload['revision']},send_only=True)
            state['reply']=r.payload
        elif run.cursor==5:
            r=report(run); receipt=call(adapter,'support.reply.lookup',{'operation_key':r.payload['operation_key']})
            if receipt!=r.payload['receipt']: raise RuleError('消息回执不匹配，不能视为送达。')
            state['receipt']=receipt
        else:
            r=report(run)
            if state.get('receipt')!=r.payload.get('receipt'): raise RuleError('尚未核对送达。')
            r.payload={**r.payload,'status':'archived','events':r.payload['events']+[
                {'step':6,'label':'HTTP 核对消息送达（测试收件箱，非邮件）'},{'step':7,'label':'工作流归档'}]}
            r.save(update_fields=['payload']); state['reply']=r.payload
    else:
        if run.cursor==0:
            from apps.agents.image_service import start as start_images
            b=start_images(member,run.requested_by,{**config,'design_id':run.version.document['id'],
                'idempotency_key':str(uuid.uuid5(run.id,'image-batch'))},frozen_document=run.version.document)
            state['batch_id']=str(b.id)
        else:
            b=batch(run); state['batch_status']=b.status
            if b.status in ('failed','unknown','needs_info','cancelled','stopping'):
                raise RuleError(b.error or '图片任务已停止或需要补充资料，不能继续。')
            if run.cursor==1:
                if b.status=='plan_ready': return state,'approval'
                return state,'wait'
            if run.cursor==2:
                if b.status!='review': return state,'wait'
            elif run.cursor==3:
                from apps.agents.image_transport import validate_png
                assets=list(b.assets.all())
                if len(assets)!=len(b.products)*b.configuration['images_per_product']: raise RuleError('图片数量不完整。')
                for asset in assets:
                    content=bytes(asset.content)
                    if hashlib.sha256(content).hexdigest()!=asset.digest: raise RuleError('图片文件摘要不匹配。')
                    validate_png(content)
                state['file_checks']='passed'
            elif run.cursor==4:
                if state.get('file_checks')!='passed': raise RuleError('文件检查未完成。')
                return state,'approval'
            elif b.status!='delivered' or not b.pack: raise RuleError('图片尚未人工确认并交付。')
            else: state['pack']=b.pack
    return state,'done'

def process(job_id):
    from .services import node,event,enqueue,next_edge,audit,finish_cancel
    token=uuid.uuid4()
    with transaction.atomic():
        job=Outbox.objects.select_for_update().get(pk=job_id); now=timezone.now()
        if job.status=='done' or job.available_at>now or job.lease_until and job.lease_until>now: return False
        run=WorkflowRun.objects.select_for_update().select_related('version','store','requested_by').get(pk=job.run_id)
        if run.status not in ('queued','running','waiting_event'): job.status='done';job.save();return False
        if run.context.get('stop_requested'): finish_cancel(run,run.requested_by);run.save();job.status='done';job.save();return False
        if Outbox.objects.filter(run=run,status='claimed',lease_until__gt=now).exclude(pk=job.pk).exists():return False
        job.status='claimed';job.lease_token=token;job.lease_until=now+timedelta(minutes=6);job.save()
        cursor=run.cursor
        run.status='running';run.save(update_fields=['status']);event(run,'running')
        attempt=NodeAttempt.objects.create(team=run.team,run=run,node_id=node(run)['id'],generation=run.generation,input_digest=digest(run.context))
    try:
        require_role(run.requested_by,run.team,['operator']);check_store(run.store,run.store_version)
        validate(run.version.document,run.team,True)
        state,outcome=step(run);error=None
    except Exception as exc:
        state=run.context['business'];outcome='failed';error=exc
    with transaction.atomic():
        job=Outbox.objects.select_for_update().get(pk=job_id)
        current=WorkflowRun.objects.select_for_update().get(pk=run.pk)
        if job.lease_token!=token or current.cursor!=cursor or current.status!='running': return False
        current.context['business']=state; current.revision+=1;job.status='done';job.lease_until=None
        attempt.completed_at=timezone.now()
        if current.context.get('stop_requested'):
            finish_cancel(current,current.requested_by);attempt.status='completed' if not error else 'failed'
        elif error:
            current.status='needs_attention';current.error=str(error.detail)[:500] if isinstance(error,(RuleError,Conflict)) else '业务节点执行失败，未继续；请查看原因。'
            attempt.status='failed';event(current,'failed')
        elif outcome=='approval':
            current.status='waiting_approval';attempt.status='waiting_approval';event(current,'waiting_approval')
        elif outcome=='wait':
            current.status='waiting_event';attempt.status='progress';event(current,'waiting_event');enqueue(current,15 if state['kind']=='fulfillment' else 2)
        else:
            current.error='';attempt.status='completed';event(current,'completed')
            if cursor==len(current.version.document['nodes'])-1: current.status='succeeded';audit(current,'run.succeeded')
            else: event(current,'transferring',edgeId=next_edge(current)['id']);current.cursor+=1;current.status='queued';enqueue(current)
        attempt.output={'business_kind':state['kind'],'batch_status':state.get('batch_status'),'error':current.error}
        attempt.save();current.save();job.save()
    return True

class Command(APIView):
    @transaction.atomic
    def post(self,request,pk):
        from .services import node,event,next_edge,enqueue,audit
        from .serializers import RunSerializer
        member=membership(request,['operator'])
        fields=parse(Confirmation,request.data)
        run=get_object_or_404(WorkflowRun.objects.select_for_update(),pk=pk,team=member.team)
        if fields['expected_revision']!=run.revision or run.status!='waiting_approval':
            raise Conflict('请确认当前运行与待审核版本；旧页面不能覆盖。')
        check_store(run.store,run.store_version);validate(run.version.document,run.team,True)
        state=run.context['business']
        if state['kind']=='support':
            if run.cursor!=3 or digest(report(run).payload)!=state['confirmation_digest']:raise Conflict('客服回复已改变，不能批准旧内容。')
            if fields['asset_ids']:raise RuleError('客服确认不接受图片参数。')
            state['approved']={'by':request.user.pk,'at':timezone.now().isoformat(),'payload':report(run).payload}
        elif state['kind']=='fulfillment':
            if run.cursor!=2 or fields['asset_ids'] or digest(state['plan'])!=state.get('confirmation_digest'):raise Conflict('履约方案已改变或确认节点不匹配。')
            from .fulfillment import call as fulfillment_call
            detail=fulfillment_call(run,'order.detail',{'order_id':state['plan']['order_id']})
            if detail!=state['order_detail']:raise Conflict('订单已变化，请停止并重新核验；不能批准旧方案。')
            state['approved']={'by':request.user.pk,'at':timezone.now().isoformat(),'payload':state['plan']}
        else:
            from apps.agents.image_service import command
            b=ProductImageBatch.objects.select_for_update().get(pk=state['batch_id'],team=member.team)
            if run.cursor not in (1,4):raise RuleError('当前不是图片确认节点。')
            command(b,request.user,{'expected_revision':b.revision,'confirmed':True,
                'action':'generate' if run.cursor==1 else 'deliver','asset_ids':fields['asset_ids']})
        run.attempts.filter(node_id=node(run)['id'],status='waiting_approval').update(status='completed',completed_at=timezone.now())
        event(run,'completed');event(run,'transferring',edgeId=next_edge(run)['id']);run.cursor+=1;run.status='queued';run.revision+=1;run.save()
        audit(run,'business.confirmed',request.user,{'cursor':run.cursor-1});enqueue(run)
        return Response(RunSerializer(run).data)

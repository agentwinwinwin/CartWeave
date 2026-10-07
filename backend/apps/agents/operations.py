"""Read-only review archives and explicit support simulations, separate from DAG runtime."""
import json
import re
from datetime import timedelta
from pathlib import Path
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView
from pydantic import ValidationError
from apps.common.errors import Conflict, RuleError
from apps.common.utils import digest, parse
from apps.identity.permissions import membership, require_role
from apps.connections.models import ModelConnection
from contracts.operations import OperationRequest, GroundedReply, SupportConfirmation
from .models import OperationReport, AgentSession
from .skills import profile
from .harness import complete

SOURCE='https://github.com/LaelaZorana/ecom-support-copilot/blob/058c8bc3101655ecd90d65d12f9b1534667f1917/data/policies.md'
KEYWORDS={
    'Shipping':['shipping','delivery','ship','运费','配送','多久','到货'],
    'Returns':['return','refund','退货','退款'],
    'Final Sale':['final sale','gift card','清仓','礼品卡'],
    'Warranty':['warranty','defect','broken','保修','损坏','破损'],
    'Price Match':['price','match','价格','差价'],
    'Order Changes and Cancellations':['cancel','change','取消','修改订单'],
}


def retrieve(message):
    text=(Path(__file__).parent/'knowledge/northwind-policies.md').read_text()
    parts=re.split(r'^## ',text,flags=re.M)[1:]
    scored=[]
    for part in parts:
        heading,body=part.split('\n',1)
        score=sum(word in message.lower() for word in KEYWORDS[heading])
        if score: scored.append((score,heading,body.strip()))
    return [{'id':heading,'text':body,'digest':digest(body),'source':SOURCE}
        for _,heading,body in sorted(scored,key=lambda row:(-row[0],row[1]))[:3]]


def support(fields,team):
    if not fields['sample_knowledge_confirmed']: raise RuleError('请确认使用开源测试政策；它不是店铺真实政策。')
    message=fields['message'].strip()
    if not message: raise RuleError('请输入模拟客户消息。')
    evidence=retrieve(message)
    rule=profile('customer_support_rag')
    model_source=None
    if fields['mode']=='pi':
        connection=get_object_or_404(ModelConnection,pk=fields['connection_id'],team=team)
        model_source={'connection_id':str(connection.id),'model_id':connection.model_id,'protocol':connection.protocol}
        system=rule['instructions']+'\n输出契约：'+json.dumps(GroundedReply.model_json_schema(),ensure_ascii=False)
        text,usage=complete(connection,system,[{'role':'user','content':json.dumps({'customer_message':message,'sample_policy_passages':evidence,'order_facts':None},ensure_ascii=False)}],purpose='customer_support_rag')
        try: answer=GroundedReply.model_validate_json(text.strip().removeprefix('```json').removeprefix('```').removesuffix('```').strip()).model_dump(mode='json')
        except ValidationError: raise RuleError('客服输出契约不通过，未发送任何消息。') from None
    else:
        # Extractive fixture is deliberately NOT labelled as an LLM response.
        answer={'schema_version':'GroundedSupportReply@1','reply':'模拟政策参考：\n'+('\n\n'.join(p['text'] for p in evidence) if evidence else '没有检索到相关政策，请转人工确认。'),
            'citations':[p['id'] for p in evidence],'questions':[],'handoff_required':not bool(evidence)}
        usage={'executor':'deterministic-extractive-fixture','model_called':False}
    if any(c not in {p['id'] for p in evidence} for c in answer['citations']): raise RuleError('回复引用了未检索的知识，不能通过检查。')
    if evidence and not answer['citations']: raise RuleError('政策回复缺少引用，不能通过检查。')
    # No verified order facts exist in this simulation; never authorize transactional promises.
    risky=any(word in message.lower() for word in ['my order','order #','refund','cancel','退货','退款','取消','我的订单','破损','保修'])
    if risky or not evidence:
        answer['handoff_required']=True
        answer['questions']=list(dict.fromkeys(answer['questions']+['请由人工核对订单及适用政策；本测试不会执行退款、取消或补发。']))
    return {'schema_version':'SupportSimulation@1','status':'handoff' if answer['handoff_required'] else 'awaiting_review',
        'mode':fields['mode'],'model_source':model_source,'channel_mode':'simulated','revision':1,'customer_message':message,
        'reply':answer,'evidence':evidence,'knowledge_digest':digest(evidence),'skill_digest':rule['digest'],'usage':usage,
        'events':[{'step':1,'label':'模拟接收消息'},{'step':2,'label':'检索开源测试政策'},
            {'step':3,'label':'Pi 模型回复' if fields['mode']=='pi' else '确定性提取测试回复'},
            {'step':4,'label':'待人工检查 / 转人工'}], 'remote_effects':[]}


def review(fields,team):
    from apps.finance.services import current_facts, calculate, totals
    from apps.finance.views import amounts
    from apps.commerce.models import BusinessRecord, SyncState
    end=timezone.now();start=end-timedelta(days=7)
    facts=list(current_facts(team).filter(currency=fields['currency'],paid_at__gte=start,paid_at__lte=end))
    summary=amounts(totals([calculate(f) for f in facts]))
    missing=sorted({key for fact in facts for key in calculate(fact)['missing_costs']})
    test_count=sum(f.source_ref.startswith('test-store://') for f in facts)
    recommendations=[]
    if not facts: recommendations.append('先同步真实订单及财务事实，再评价经营表现。')
    if missing: recommendations.append('补全缺失成本：'+', '.join(missing)+'；不能把缺失成本当零计算利润。')
    if facts and not missing: recommendations.append('根据真实利润与退款记录人工复核商品策略；本报告不自动改价或投流。')
    if test_count: recommendations.insert(0,f'本报告包含 {test_count} 笔测试站付款事件，仅用于接口联调，不是实际收入。')
    return {'schema_version':'OperationsReview@1','status':'archived','source':'workspace_readonly_snapshot',
        'period_start':start.isoformat(),'period_end':end.isoformat(),'currency':fields['currency'],
        'summary':summary,'fact_count':len(facts),'test_fact_count':test_count,'snapshot_digest':digest([(str(f.id),f.revision) for f in facts]),
        'order_projection_count':BusinessRecord.objects.filter(team=team,kind='orders').count(),
        'sync_sources':[{'kind':s.kind,'synced_at':s.synced_at.isoformat() if s.synced_at else None,'store_id':str(s.store_id)} for s in SyncState.objects.filter(team=team)],
        'missing_costs':missing,'recommendations':recommendations,'adjustments_applied':False,'model_called':False}


def public_report(record):
    return {'id':str(record.id),'kind':record.kind,'created_at':record.created_at.isoformat(),'payload':record.payload}


class OperationReports(APIView):
    def get(self,request,kind):
        member=membership(request)
        if kind not in ('support','reviews'): raise RuleError('未知归档模块。')
        try:
            page=int(request.query_params.get('page','1'))
            if not 1<=page<=100000: raise ValueError()
        except ValueError: raise RuleError('页码无效。') from None
        rows=OperationReport.objects.filter(team=member.team,kind=kind).order_by('-created_at')
        data={'results':[public_report(r) for r in rows[(page-1)*20:page*20]],'count':rows.count(),'page':page}
        if kind=='support' and page==1:
            data['legacy_drafts']=[{'id':str(s.id),'created_at':s.created_at.isoformat(),'reply':s.result.get('reply',''),'status':'draft_only'} for s in AgentSession.objects.filter(team=member.team,purpose='customer_support').order_by('-created_at')[:20]]
        return Response(data,headers={'Cache-Control':'no-store'})

    def post(self,request,kind):
        member=membership(request,['operator'])
        if kind not in ('support','reviews'): raise RuleError('未知归档模块。')
        fields=parse(OperationRequest,request.data);identity=digest({'kind':kind,**fields})
        if kind=='reviews' and (fields['mode']!='fixture' or fields['message'] or fields['connection_id'] or fields['store_id'] or fields['message_id']): raise RuleError('复盘当前只执行真实账目只读核算，不调用模型或调整策略。')
        if fields['mode']=='pi' and not fields['connection_id']: raise RuleError('请选择已配置的模型。')
        with transaction.atomic():
            type(member.team).objects.select_for_update().get(pk=member.team.pk)
            old=OperationReport.objects.filter(team=member.team,request_key=fields['request_key']).first()
            if old:
                if old.request_digest!=identity: raise Conflict('同一请求编号不能改变参数。')
                return Response(public_report(old),headers={'Cache-Control':'no-store'})
            record=OperationReport.objects.create(team=member.team,requested_by=request.user,kind=kind,
                request_key=fields['request_key'],request_digest=identity,payload={'status':'processing'})
        try:
            if kind=='support' and fields['store_id']:
                from .store_support import prepare
                output=prepare(fields,member)
            else:
                output=support(fields,member.team) if kind=='support' else review(fields,member.team)
            require_role(request.user,member.team,['operator'])
            record.payload=output;record.save(update_fields=['payload'])
        except Exception:
            record.payload={'status':'failed','error':'执行未完成；未发送、退款或调整经营策略。'};record.save(update_fields=['payload'])
            raise
        return Response(public_report(record),status=201,headers={'Cache-Control':'no-store'})


class OperationReportDetail(APIView):
    def post(self,request,pk):
        member=membership(request,['operator'])
        fields=parse(SupportConfirmation,request.data)
        if fields['confirmed'] is not True: raise RuleError('必须明确确认测试回复。')
        current=get_object_or_404(OperationReport,pk=pk,team=member.team,kind='support')
        if current.payload.get('channel_mode')=='test_store_http':
            from .store_support import send
            return Response(public_report(send(member,pk,fields)),headers={'Cache-Control':'no-store'})
        with transaction.atomic():
            record=get_object_or_404(OperationReport.objects.select_for_update(),pk=pk,team=member.team,kind='support')
            payload=record.payload
            if payload.get('revision')!=fields['expected_revision']: raise Conflict('客服记录已更新，请刷新。')
            if payload.get('status')!='awaiting_review': raise RuleError('本记录不能模拟发送；转人工记录不能跳过。')
            payload={**payload,'status':'archived','revision':2,'confirmed_at':timezone.now().isoformat(),'events':payload['events']+[
                {'step':5,'label':'模拟发送（未调用渠道）'},{'step':6,'label':'模拟送达（非真实回执）'},{'step':7,'label':'归档模拟客服记录'}]}
            record.payload=payload;record.save(update_fields=['payload'])
        return Response(public_report(record),headers={'Cache-Control':'no-store'})

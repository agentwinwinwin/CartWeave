"""Store-linked support draft and explicit send/lookup, isolated from old fixtures."""
import json
from datetime import timedelta
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from apps.common.errors import RuleError, Conflict
from apps.common.utils import digest, parse
from apps.connections.models import ModelConnection
from apps.connections.services import check_store
from apps.identity.permissions import require_role
from apps.integrations.test_store import UnknownResult
from apps.teststore.testing import adapter_for, call
from contracts.operations import GroundedReply
from .harness import complete
from .skills import profile
from .models import OperationReport

def prepare(fields,member,evidence=None):
    store,adapter=adapter_for(member,fields['store_id'])
    if not fields['message_id'] or not fields['sample_knowledge_confirmed']:
        raise RuleError('请选择测试站真实收件记录并确认使用测试政策。')
    evidence=evidence or call(adapter,'support.context',{'message_id':fields['message_id']})
    rule=profile('customer_support_rag'); model_source=None
    if fields['mode']=='pi':
        connection=get_object_or_404(ModelConnection,pk=fields['connection_id'],team=member.team)
        model_source={'connection_id':str(connection.id),'model_id':connection.model_id,'protocol':connection.protocol}
        text,usage=complete(connection,rule['instructions']+'\n输出契约：'+json.dumps(GroundedReply.model_json_schema()),
            [{'role':'user','content':json.dumps(evidence,ensure_ascii=False)}],purpose='customer_support_rag')
        try: answer=parse(GroundedReply,json.loads(text.strip().removeprefix('```json').removeprefix('```').removesuffix('```')))
        except (ValueError,TypeError): raise RuleError('客服输出无法解析，未发送。') from None
    else:
        answer={'schema_version':'GroundedSupportReply@1','reply':'测试站政策参考：\n'+'\n\n'.join(p['text'] for p in evidence['policy']),
            'citations':[p['id'] for p in evidence['policy']],'questions':[],'handoff_required':not bool(evidence['policy'])}
        usage={'model_called':False,'executor':'deterministic-extractive-fixture'}
    if not set(answer['citations'])<=set(p['id'] for p in evidence['policy']) or evidence['policy'] and not answer['citations']:
        raise RuleError('回复政策引用不通过，未发送。')
    if any(w in evidence['message'].lower() for w in ['refund','cancel','退款','取消','补发']):
        answer['handoff_required']=True
        answer['questions'].append('退款、取消或补发须人工处理；本接口不授权资金或履约动作。')
    if not evidence['order'] and any(w in evidence['message'].lower() for w in ['my order','order #','tracking','我的订单','物流单','追踪','订单到哪']):
        answer['handoff_required']=True
        answer['questions'].append('缺少可核验的关联订单资料，不能承诺订单进度或编造物流状态。')
    return {'schema_version':'StoreSupport@1','channel_mode':'test_store_http','status':'handoff' if answer['handoff_required'] else 'awaiting_review',
        'revision':1,'mode':fields['mode'],'model_source':model_source,'store_id':str(store.id),'store_version':store.configuration_version,
        'message_id':fields['message_id'],'context_digest':evidence['context_digest'],'customer_message':evidence['message'],
        'order_facts':evidence['order'],'reply':answer,'evidence':evidence['policy'],'usage':usage,'skill_digest':rule['digest'],
        'events':[{'step':1,'label':'HTTP 读取测试站收件'}, {'step':2,'label':'HTTP 读取政策与关联订单'},
            {'step':3,'label':'Pi 回复' if fields['mode']=='pi' else '确定性政策测试回复'}, {'step':4,'label':'检查并等待人工确认'}]}

def send(member,pk,fields,send_only=False):
    with transaction.atomic():
        record=get_object_or_404(OperationReport.objects.select_for_update(),pk=pk,team=member.team,kind='support')
        p=record.payload
        if p.get('revision')!=fields['expected_revision']: raise Conflict('记录已改变，请刷新。')
        stale=p['status']=='sending' and timezone.now()-timezone.datetime.fromisoformat(p['send_started_at'])>timedelta(seconds=60)
        if p['status'] not in ('awaiting_review','send_unknown') and not stale: raise RuleError('本记录不能发送；在途请求不能重复提交。')
        lookup=p['status']=='send_unknown' or stale
        store,adapter=adapter_for(member,p['store_id'])
        if store.configuration_version!=p['store_version']: raise Conflict('连接已改变，不能发送旧草稿。')
        key=digest({'report_id':str(record.id),'context_digest':p['context_digest'],'reply':p['reply']['reply']})
        record.payload={**p,'status':'sending','revision':p['revision']+1,'operation_key':key,'send_started_at':timezone.now().isoformat()};record.save(update_fields=['payload'])
    try:
        require_role(member.user,member.team,['operator'])
        receipt=call(adapter,'support.reply.lookup',{'operation_key':key}) if lookup else call(adapter,'support.reply',
            {'operation_key':key,'message_id':p['message_id'],'reply':p['reply']['reply'],'context_digest':p['context_digest']})
        if receipt.get('message_id')!=p['message_id'] or receipt.get('operation_key')!=key or receipt.get('reply')!=p['reply']['reply']:
            raise UnknownResult('回复回执不匹配。')
        if not send_only:
            check=call(adapter,'support.reply.lookup',{'operation_key':key})
            if check!=receipt: raise UnknownResult('回复回查不一致。')
        check_store(store,p['store_version'])
        result={**record.payload,'status':'sent' if send_only else 'archived','receipt':receipt,'confirmed_at':timezone.now().isoformat(),
            'events':p['events']+[{'step':5,'label':'HTTP 保存答复到测试站收件箱'}]+([] if send_only else [
                {'step':6,'label':'HTTP 回查送达记录（非邮件）'},{'step':7,'label':'归档真实接口证据'}])}
    except Exception:
        record.payload={**record.payload,'status':'send_unknown','error':'发送或回查未完成；请核对原操作键，不会自动重发。'}
        record.save(update_fields=['payload']);raise
    record.payload=result;record.save(update_fields=['payload']);return record

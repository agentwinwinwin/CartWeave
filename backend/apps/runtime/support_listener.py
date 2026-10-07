"""Persistent inbox polling -> claimed message -> normal seven-step WorkflowRun.

No LLM in the dispatcher. Cursor and claims commit together; failures never replay
model calls. This adapter is explicitly local test inbox, not production email.
"""
from datetime import timedelta
from django.db.models import Q
from apps.common.errors import RuleError, Conflict
from apps.common.utils import parse
from apps.identity.models import Membership
from apps.teststore.testing import adapter_for
from contracts.support_feed import MessageFeed
from .models import SupportMessageClaim, WorkflowRun, ScheduleOccurrence

def poll(schedule,now):
    from .scheduling import check_release,check_frequency,schedule_audit
    from .business import start
    schedule.next_due_at=now+timedelta(seconds=15)
    try:
        check_release(schedule.release,schedule.requested_by)
        check_frequency(schedule.release,schedule.frequency)
        member=Membership.objects.get(team=schedule.team,user=schedule.requested_by,active=True)
        store,adapter=adapter_for(member,str(schedule.release.store_id))
        feed=parse(MessageFeed,adapter.call('POST','/testing/message-feed',{'cursor':str(schedule.message_cursor) if schedule.message_cursor else None}))
        if feed['storefront_id']!=str(adapter.store_id): raise RuleError('收件事件来源不属于冻结店铺。')
        ids=[m['id'] for m in feed['messages']]
        positions=[(m['received_at'],m['id']) for m in feed['messages']]
        if len(ids)!=len(set(ids)) or str(schedule.message_cursor) in ids or positions!=sorted(positions) or (ids and feed['next_cursor']!=ids[-1]) or (not ids and (feed['has_more'] or feed['next_cursor']!=(str(schedule.message_cursor) if schedule.message_cursor else None))):
            raise RuleError('消息页或游标无效，未推进。')
        for m in feed['messages']:
            if not m['answered']:
                # Pre-listener manual runs/reports may not have a message claim.
                # Their unfinished/failed model intent is still not new work.
                old=WorkflowRun.objects.filter(team=schedule.team,store=store,store_version=schedule.release.store_version,
                    version__document__templateId='support').filter(Q(context__business__message_id=m['id'])|
                    Q(version__document__nodes__0__binding__parameters__runtime__message_id=m['id'])).order_by('created_at').first()
                if not old:
                    from apps.agents.models import OperationReport
                    if OperationReport.objects.filter(team=schedule.team,kind='support',payload__store_id=str(store.id),
                        payload__store_version=schedule.release.store_version,payload__message_id=m['id']).exists():
                        continue # Existing independent draft remains in the support archive.
                SupportMessageClaim.objects.get_or_create(team=schedule.team,store=store,store_version=schedule.release.store_version,
                    message_id=m['id'],defaults={'schedule':schedule,'release':schedule.release,'run':old,'message':{k:v for k,v in m.items() if k!='answered'}})
        schedule.message_cursor=feed['next_cursor'];schedule.last_polled_at=now;schedule.last_error=''
        # Single active worker per shop; manual handoffs do not block other customers.
        if not WorkflowRun.objects.filter(team=schedule.team,store=store,version__document__templateId='support',status__in=['queued','running','waiting_event']).exists():
            claim=schedule.message_claims.filter(release=schedule.release,run__isnull=True).order_by('created_at','id').first()
            if claim:
                run,_=start(schedule.release.version,store,schedule.requested_by,None,f'support-event:{claim.id}',message_claim=claim)
                schedule.last_run=run
                occurrence=ScheduleOccurrence.objects.create(team=schedule.team,schedule=schedule,scheduled_at=now,
                    schedule_revision=schedule.revision,release=schedule.release,status='started',run=run)
                schedule_audit(schedule,'schedule.message_claimed',schedule.requested_by,{'message_id':str(claim.message_id),'occurrence':str(occurrence.id),'run_id':str(run.id)})
    except Conflict:
        # Another runner acquired the shop; keep the same pending claim for next poll.
        pass
    except Exception:
        # Never leak remote exception payloads; fix explicitly before enabling again.
        schedule.last_error='客服监听已暂停：收件接口、权限、店铺版本或冻结模型规则检查失败。没有重试模型或发送；修复后重新启用。'
        schedule.enabled=False;schedule.next_due_at=None
        ScheduleOccurrence.objects.create(team=schedule.team,schedule=schedule,scheduled_at=now,
            schedule_revision=schedule.revision,release=schedule.release,status='blocked',reason=schedule.last_error)
    schedule.save(update_fields=['message_cursor','last_polled_at','next_due_at','last_run','last_error','enabled','updated_at'])

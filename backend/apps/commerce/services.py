from datetime import timedelta
from django.db import transaction
from django.utils import timezone
from apps.common.errors import RuleError,Conflict
from apps.connections.services import check_store
from apps.integrations.registry import listing_adapter
from apps.finance.services import record_fact
from apps.audit.models import AuditRecord
from contracts.store_business import BUSINESS_ACTIONS
from .models import BusinessRecord,SyncState


def sync_page(member,store,kind):
    action=kind+'.read'
    if action not in BUSINESS_ACTIONS:raise RuleError('不支持的业务同步类型。')
    check_store(store)
    if action not in store.capabilities:raise RuleError('该店铺未验收此读取能力，请先重新验收店铺接口包。')
    now=timezone.now();lease=now+timedelta(seconds=30)
    with transaction.atomic():
        type(store).objects.select_for_update().get(pk=store.pk,team=member.team)
        state,_=SyncState.objects.get_or_create(team=member.team,store=store,kind=kind,defaults={'store_version':store.configuration_version})
        if state.store_version!=store.configuration_version:raise Conflict('店铺版本已变更，不能复用旧同步游标；请核对连接。')
        if state.lease_until and state.lease_until>now:raise Conflict('该模块正在同步，请勿重复提交。')
        state.lease_until=lease;state.save(update_fields=['lease_until'])
        cursor=state.cursor;version=store.configuration_version
    try:
        adapter=listing_adapter(store)
        if not hasattr(adapter,'read_business'):raise RuleError('已安装接口包尚未实现业务读取。')
        page=adapter.read_business(action,cursor)
        if int(page['next_cursor'])<int(cursor) or (page['items'] or page['has_more']) and int(page['next_cursor'])<=int(cursor):
            raise RuleError('接口返回游标没有前进，未保存数据。')
        with transaction.atomic():
            type(store).objects.select_for_update().get(pk=store.pk,team=member.team)
            check_store(store,version)
            if action not in store.capabilities:raise Conflict('同步期间读取权限已失效。')
            state=SyncState.objects.select_for_update().get(pk=state.pk)
            if state.lease_until!=lease or state.cursor!=cursor or state.lease_until<=timezone.now():raise Conflict('同步租约已失效或游标已变更，未接受迟到结果。')
            keys=set()
            for item in page['items']:
                identity=item['external_order_id'] if kind=='finance' else item['external_id']
                key=(identity,item['revision'])
                if key in keys:raise RuleError('接口页含重复资料版本。')
                keys.add(key)
                if kind=='finance':
                    record_fact(member.team,store,member.user,item)
                    continue
                previous=BusinessRecord.objects.filter(store=store,kind=kind,external_id=identity).first()
                if previous and previous.revision==item['revision']:
                    if previous.payload!=item:raise Conflict('同一业务版本的内容发生变化。')
                    continue
                if previous and previous.revision>item['revision']:continue
                observed=BUSINESS_ACTIONS[action][1].model_validate(item).observed_at
                if previous and observed<previous.observed_at:raise Conflict('不能用更早资料覆盖当前记录。')
                BusinessRecord.objects.update_or_create(team=member.team,store=store,kind=kind,external_id=identity,
                    defaults={'revision':item['revision'],'payload':item,'observed_at':observed})
            state.cursor=page['next_cursor'];state.has_more=page['has_more'];state.synced_at=timezone.now();state.lease_until=None
            state.save(update_fields=['cursor','has_more','synced_at','lease_until'])
            AuditRecord.objects.create(team=member.team,actor=member.user,action='commerce.synced',object_id=str(store.id),
                metadata={'kind':kind,'count':len(page['items']),'store_version':version,'has_more':state.has_more})
        return {'received':len(page['items']),'has_more':state.has_more,'synced_at':state.synced_at,'store_id':str(store.id),'kind':kind}
    finally:
        SyncState.objects.filter(pk=state.pk,lease_until=lease).update(lease_until=None)

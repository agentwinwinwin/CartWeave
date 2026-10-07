"""Durable triggers for trusted frozen workflows; never browser timers or approvals."""
from datetime import datetime, time, timedelta, timezone as dt_timezone
from zoneinfo import ZoneInfo
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import APIException
from apps.common.errors import Conflict, RuleError
from apps.identity.permissions import require_role
from apps.identity.models import Membership, Team
from apps.audit.models import AuditRecord
from apps.connections.services import check_store
from apps.connections.cj_catalog import connection_for
from apps.registry.definitions import validate_document
from apps.registry.launch import is_launch
from apps.registry.business import is_business, configuration
from .models import WorkflowSchedule, ScheduleOccurrence, SchedulerHeartbeat, WorkflowRun, SelectionTask
from .services import start_run


def next_due(config, after):
    if config.frequency == 'continuous':
        return after + timedelta(seconds=15)
    if config.frequency == 'interval':
        return after + timedelta(hours=config.interval_hours)
    zone = ZoneInfo(config.timezone)
    date = after.astimezone(zone).date()
    hour, minute = map(int, config.clock.split(':'))
    for offset in range(9):
        day = date + timedelta(days=offset)
        if config.frequency == 'weekly' and day.weekday() not in config.weekdays:
            continue
        wall = datetime.combine(day, time(hour, minute))
        # Once per local date, first fold on autumn DST; nonexistent spring times skip.
        local = wall.replace(tzinfo=zone, fold=0)
        utc = local.astimezone(dt_timezone.utc)
        if utc.astimezone(zone).replace(tzinfo=None) == wall and utc > after:
            return utc
    raise RuleError('无法计算下次执行时间，请检查星期与时区。')


def check_release(release, user):
    require_role(user, release.team, ['operator'])
    from apps.workflows.models import ReleaseRetirement
    if ReleaseRetirement.objects.filter(release=release).exists():
        raise RuleError('冻结版本已删除，请先恢复或选择其他版本。')
    if not is_launch(release.version.document) and not is_business(release.version.document):
        raise RuleError('请选择已实现的完整选品、智能客服或商品图冻结流程。')
    if release.version.team_id != release.team_id or release.store.team_id != release.team_id:
        raise RuleError('流程版本或店铺不属于当前工作区。')
    check_store(release.store, release.store_version)
    validate_document(release.version.document, release.version.skill, frozen=True)
    if is_business(release.version.document):
        if release.version.document['templateId']=='support':
            from apps.teststore.testing import adapter_for
            adapter_for(Membership.objects.get(team=release.team,user=user,active=True),str(release.store_id))
        return
    if any(n['binding'].get('parameters', {}).get('approvalEnabled') is False for n in release.version.document['nodes']):
        require_role(user, release.team, ['admin'])
    connection_for(Membership.objects.get(team=release.team, user=user, active=True))

def check_frequency(release, frequency):
    inbox=release.version.document.get('templateId')=='support' and configuration(release.version.document).get('input_mode')=='inbox'
    if frequency=='continuous' and not inbox:
        raise RuleError('一直执行仅用于已冻结的客服收件箱监听；先在客服首节点选择“持续接收新消息”再冻结。')
    if inbox and frequency!='continuous':
        raise RuleError('客服收件箱版本请选择“一直执行 · 收到新消息触发”；不会按时钟重复某条消息。')


def schedule_audit(schedule, action, user, metadata=None):
    AuditRecord.objects.create(team=schedule.team, actor=user, action=action, object_id=str(schedule.pk), metadata=metadata or {})


@transaction.atomic
def fire_schedule(pk, now=None):
    now = now or timezone.now()
    team_id = WorkflowSchedule.objects.filter(pk=pk).values_list('team_id', flat=True).first()
    if team_id is None:
        return
    # Same order as start_run's team lock; serializes different timers sharing CJ.
    Team.objects.select_for_update().get(pk=team_id)
    schedule = WorkflowSchedule.objects.select_for_update().select_related('release__version__skill', 'release__store', 'requested_by').get(pk=pk)
    if not schedule.enabled or not schedule.next_due_at or schedule.next_due_at > now:
        return
    if schedule.frequency=='continuous':
        from .support_listener import poll
        poll(schedule,now)
        return
    due = schedule.next_due_at
    occurrence, created = ScheduleOccurrence.objects.get_or_create(schedule=schedule, scheduled_at=due,
        defaults={'team':schedule.team, 'schedule_revision':schedule.revision, 'release':schedule.release, 'status':'pending'})
    schedule.next_due_at = next_due(schedule, now)
    if created:
        if now - due > timedelta(seconds=90):
            occurrence.status, occurrence.reason = 'missed', '服务未及时触发；已跳过错过的时段，不补跑。'
        elif (schedule.last_run_id and WorkflowRun.objects.filter(pk=schedule.last_run_id).exclude(status__in=['succeeded','cancelled']).exists()) or (is_launch(schedule.release.version.document) and SelectionTask.objects.filter(team=schedule.team, status__in=['queued','running','workflow_owned']).exists()):
            occurrence.status, occurrence.reason = 'skipped', '上一轮尚未结束或工作区正在选品；本时段跳过，不排队补跑。'
        else:
            try:
                # Savepoint rolls back partial run creation on a rejected start.
                with transaction.atomic():
                    check_release(schedule.release, schedule.requested_by)
                    check_frequency(schedule.release,schedule.frequency)
                    if is_business(schedule.release.version.document) and WorkflowRun.objects.filter(version=schedule.release.version,store=schedule.release.store).exists():
                        raise Conflict('固定消息或商品清单已有运行记录；本轮跳过，避免重复回复、生成方案或生图扣费。需要新制作任务请重新配置并冻结。')
                    run, _ = start_run(schedule.release.version, schedule.release.store, schedule.requested_by, None, f'schedule:{occurrence.id}')
                occurrence.status, occurrence.run = 'started', run
                schedule.last_run, schedule.last_error = run, ''
            except Conflict as exc:
                occurrence.status,occurrence.reason='skipped',str(exc.detail)[:500]
            except APIException:
                # Don't expose credential/provider exception payloads in timer history.
                occurrence.status = 'blocked'
                occurrence.reason = '启动检查未通过：请检查成员权限、所需凭证、店铺连接版本与冻结规则；修复后重新启用。'
                schedule.enabled, schedule.next_due_at = False, None
                schedule.last_error = occurrence.reason
        occurrence.save(update_fields=['status','reason','run'])
        schedule_audit(schedule, 'schedule.triggered', schedule.requested_by, {'occurrence':str(occurrence.id),'status':occurrence.status,'run_id':str(occurrence.run_id) if occurrence.run_id else None})
    schedule.save(update_fields=['next_due_at','enabled','last_run','last_error','updated_at'])


def dispatch_schedules():
    now = timezone.now()
    SchedulerHeartbeat.objects.update_or_create(name='runtime', defaults={'last_seen_at':now})
    ids = list(WorkflowSchedule.objects.filter(enabled=True, next_due_at__lte=now).order_by('next_due_at').values_list('id', flat=True)[:20])
    for pk in ids:
        fire_schedule(pk, now)

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
from .models import WorkflowSchedule, ScheduleOccurrence, SchedulerHeartbeat, WorkflowRun, SelectionTask
from .services import start_run


def next_due(config, after):
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
    if not is_launch(release.version.document):
        raise RuleError('定时器当前仅支持完整 CJ 选品到测试站流程；七步样本发布缺少每轮真实输入，不能重复运行。')
    if release.version.team_id != release.team_id or release.store.team_id != release.team_id:
        raise RuleError('流程版本或店铺不属于当前工作区。')
    check_store(release.store, release.store_version)
    validate_document(release.version.document, release.version.skill, frozen=True)
    if any(n['binding'].get('parameters', {}).get('approvalEnabled') is False for n in release.version.document['nodes']):
        require_role(user, release.team, ['admin'])
    connection_for(Membership.objects.get(team=release.team, user=user, active=True))


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
    due = schedule.next_due_at
    occurrence, created = ScheduleOccurrence.objects.get_or_create(schedule=schedule, scheduled_at=due,
        defaults={'team':schedule.team, 'schedule_revision':schedule.revision, 'release':schedule.release, 'status':'pending'})
    schedule.next_due_at = next_due(schedule, now)
    if created:
        if now - due > timedelta(seconds=90):
            occurrence.status, occurrence.reason = 'missed', '服务未及时触发；已跳过错过的时段，不补跑。'
        elif (schedule.last_run_id and WorkflowRun.objects.filter(pk=schedule.last_run_id).exclude(status__in=['succeeded','cancelled']).exists()) or SelectionTask.objects.filter(team=schedule.team, status__in=['queued','running','workflow_owned']).exists():
            occurrence.status, occurrence.reason = 'skipped', '上一轮尚未结束或工作区正在选品；本时段跳过，不排队补跑。'
        else:
            try:
                # Savepoint rolls back partial run creation on a rejected start.
                with transaction.atomic():
                    check_release(schedule.release, schedule.requested_by)
                    run, _ = start_run(schedule.release.version, schedule.release.store, schedule.requested_by, None, f'schedule:{occurrence.id}')
                occurrence.status, occurrence.run = 'started', run
                schedule.last_run, schedule.last_error = run, ''
            except APIException:
                # Don't expose credential/provider exception payloads in timer history.
                occurrence.status = 'blocked'
                occurrence.reason = '启动检查未通过：请检查成员权限、CJ 凭证、店铺连接版本和 Skill；修复后重新启用。'
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

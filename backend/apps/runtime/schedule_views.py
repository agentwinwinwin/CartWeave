from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView
from apps.common.errors import Conflict
from apps.identity.permissions import membership
from apps.workflows.models import DesignRelease
from apps.registry.launch import is_launch
from apps.registry.business import is_business, configuration
from .models import WorkflowSchedule, SchedulerHeartbeat
from .scheduling import next_due, check_release, check_frequency, schedule_audit


class ScheduleInput(serializers.Serializer):
    name = serializers.CharField(max_length=120)
    release_id = serializers.UUIDField()
    frequency = serializers.ChoiceField(choices=['daily','weekly','interval','continuous'])
    timezone = serializers.CharField(max_length=100)
    clock = serializers.RegexField(r'^(?:[01]\d|2[0-3]):[0-5]\d$', default='09:00')
    weekdays = serializers.ListField(child=serializers.IntegerField(min_value=0,max_value=6), max_length=7, default=list)
    interval_hours = serializers.IntegerField(min_value=1,max_value=720,default=24)
    enabled = serializers.BooleanField(default=False)
    expected_revision = serializers.IntegerField(min_value=1, required=False)

    def validate_timezone(self, value):
        try: ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError): raise ValidationError('请输入有效 IANA 时区，例如 Asia/Shanghai。')
        return value

    def validate(self, value):
        if value.get('frequency') == 'weekly' and not value.get('weekdays'):
            raise ValidationError('每周执行至少选择一天。')
        if len(value.get('weekdays',[])) != len(set(value.get('weekdays',[]))):
            raise ValidationError('星期不能重复。')
        return value


def schedule_data(row):
    return {'id':str(row.id),'name':row.name,'release_id':str(row.release_id),
        'workflow_title':row.release.document['title'],'release_revision':row.release.revision,
        'frequency':row.frequency,'timezone':row.timezone,'clock':row.clock,'weekdays':row.weekdays,
        'interval_hours':row.interval_hours,'enabled':row.enabled,'revision':row.revision,
        'next_due_at':row.next_due_at,'last_error':row.last_error,
        'last_polled_at':row.last_polled_at,
        'pending_messages':row.message_claims.filter(release=row.release,run__isnull=True).count(),
        'attention_messages':row.message_claims.filter(run__status__in=['needs_attention','waiting_approval']).count(),
        'completed_messages':row.message_claims.filter(run__status='succeeded').count(),
        'last_run_id':str(row.last_run_id) if row.last_run_id else None,
        'history':[{'id':str(o.id),'scheduled_at':o.scheduled_at,'status':o.status,'reason':o.reason,
                    'run_id':str(o.run_id) if o.run_id else None,'run_status':o.run.status if o.run_id else None,
                    'release_revision':o.release.revision} for o in row.occurrences.select_related('run','release').order_by('-scheduled_at')[:10]]}


class Schedules(APIView):
    def get(self, request):
        member = membership(request)
        heartbeat = SchedulerHeartbeat.objects.filter(name='runtime').first()
        releases = DesignRelease.objects.filter(team=member.team,retirement__isnull=True).select_related('store','version').order_by('-created_at')[:100]
        return Response({'schedules':[schedule_data(row) for row in WorkflowSchedule.objects.filter(team=member.team).select_related('release').order_by('-created_at')[:100]],
            'releases':[{'id':str(row.id),'title':row.document['title'],'revision':row.revision,'store_name':row.store.name,
                'scope':row.version.document.get('templateId'),
                'input_mode':configuration(row.version.document).get('input_mode','message') if row.version.document.get('templateId')=='support' else None,
                'reply_policy':configuration(row.version.document).get('reply_policy','manual') if row.version.document.get('templateId')=='support' else None}
                for row in releases if is_launch(row.version.document) or is_business(row.version.document)],
            'dispatcher':{'last_seen_at':heartbeat.last_seen_at if heartbeat else None,
                'online':bool(heartbeat and (timezone.now()-heartbeat.last_seen_at).total_seconds()<120)}})

    @transaction.atomic
    def post(self, request):
        member = membership(request, ['operator'])
        data = parse_input(request.data)
        release = get_object_or_404(DesignRelease.objects.select_for_update(),pk=data.pop('release_id'),team=member.team)
        check_release(release,request.user)
        check_frequency(release,data['frequency'])
        data.pop('expected_revision',None)
        row = WorkflowSchedule(team=member.team, requested_by=request.user, release=release, **data)
        if row.enabled: row.next_due_at=timezone.now() if row.frequency=='continuous' else next_due(row,timezone.now())
        row.save()
        schedule_audit(row,'schedule.created',request.user,{'enabled':row.enabled,'release_id':str(release.id)})
        return Response(schedule_data(row),status=201)


def parse_input(data, partial=False):
    unknown = set(data)-set(ScheduleInput().fields)
    if unknown: raise ValidationError('包含不支持的定时参数。')
    serializer = ScheduleInput(data=data, partial=partial)
    serializer.is_valid(raise_exception=True)
    return dict(serializer.validated_data)


class ScheduleDetail(APIView):
    @transaction.atomic
    def patch(self, request, pk):
        member = membership(request,['operator'])
        row = get_object_or_404(WorkflowSchedule.objects.select_for_update().select_related('release__version__skill','release__store'),pk=pk,team=member.team)
        data = parse_input(request.data,partial=True)
        if data.pop('expected_revision',None)!=row.revision: raise Conflict('定时配置已更新，请刷新后再修改。')
        if 'release_id' in data:
            release=get_object_or_404(DesignRelease.objects.select_for_update(),pk=data.pop('release_id'),team=member.team)
            if release.pk!=row.release_id:
                row.message_cursor=None;row.last_polled_at=None;row.last_run=None
            row.release=release
        for key,value in data.items(): setattr(row,key,value)
        row.release=get_object_or_404(DesignRelease.objects.select_for_update(),pk=row.release_id,team=member.team)
        # Revalidate the merged configuration, including weekly days on partial edits.
        parse_input({key:getattr(row,key) for key in ('name','frequency','timezone','clock','weekdays','interval_hours','enabled')}|{'release_id':str(row.release_id)})
        check_frequency(row.release,row.frequency)
        if row.enabled:
            check_release(row.release,request.user)
            row.next_due_at=timezone.now() if row.frequency=='continuous' else next_due(row,timezone.now())
            row.last_error=''
        else: row.next_due_at=None
        row.requested_by=request.user
        row.revision+=1
        row.save()
        schedule_audit(row,'schedule.updated',request.user,{'enabled':row.enabled,'release_id':str(row.release_id),'revision':row.revision})
        return Response(schedule_data(row))

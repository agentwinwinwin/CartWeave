from django.db import transaction
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView
from apps.identity.permissions import membership
from apps.identity.models import Team
from apps.audit.models import AuditRecord
from apps.common.errors import Conflict
from apps.runtime.models import WorkflowRun, WorkflowSchedule
from .models import DesignRelease, ReleaseRetirement


class Releases(APIView):
    def get(self,request):
        member=membership(request)
        try:
            page=int(request.query_params.get('page','1'))
            if not 1<=page<=100000:raise ValueError()
        except ValueError:raise ValidationError('页码无效。')
        archived=request.query_params.get('view','active')
        if archived not in ('active','deleted'):raise ValidationError('版本视图无效。')
        rows=DesignRelease.objects.filter(team=member.team,retirement__isnull=archived=='active')
        count=rows.count()
        rows=rows.select_related('store').annotate(
            active_runs=Count('version__workflowrun',filter=~Q(version__workflowrun__status__in=['succeeded','cancelled']),distinct=True),
            run_count=Count('version__workflowrun',distinct=True),
            active_schedules=Count('workflowschedule',filter=Q(workflowschedule__enabled=True),distinct=True),
            schedule_count=Count('workflowschedule',distinct=True)).order_by('-created_at','-id')[(page-1)*50:page*50]
        results=[{'id':str(r.id),'title':r.document['title'],'revision':r.revision,'created_at':r.created_at,
            'store_name':r.store.name,'node_count':len(r.document['nodes']),'active_runs':r.active_runs,
            'run_count':r.run_count,'active_schedules':r.active_schedules,'schedule_count':r.schedule_count,
            'deleted':archived=='deleted','can_delete':not(r.active_runs or r.active_schedules)} for r in rows]
        return Response({'results':results,'count':count,'page':page,'page_size':50},headers={'Cache-Control':'no-store'})


class ReleaseLifecycle(APIView):
    @transaction.atomic
    def delete(self,request,pk):
        member=membership(request,['operator'])
        if request.data:raise ValidationError('删除不接受流程改写参数。')
        Team.objects.select_for_update().get(pk=member.team.pk)
        row=get_object_or_404(DesignRelease.objects.select_for_update(),pk=pk,team=member.team)
        if WorkflowRun.objects.filter(version=row.version).exclude(status__in=['succeeded','cancelled']).exists():
            raise Conflict('该版本仍有未结束运行，请先停止或完成运行；删除不会替你取消任务。')
        if WorkflowSchedule.objects.filter(release=row,enabled=True).exists():
            raise Conflict('该版本被已启用的定时器引用，请先暂停定时器或切换版本。')
        _,created=ReleaseRetirement.objects.get_or_create(release=row,defaults={'team':member.team,'retired_by':member.user})
        if created:AuditRecord.objects.create(team=member.team,actor=member.user,action='release.deleted',object_id=str(row.id))
        return Response({'id':str(row.id),'deleted':True,'recoverable':True})

    @transaction.atomic
    def post(self,request,pk):
        member=membership(request,['operator'])
        if request.data:raise ValidationError('恢复不接受流程改写参数。')
        Team.objects.select_for_update().get(pk=member.team.pk)
        row=get_object_or_404(DesignRelease.objects.select_for_update(),pk=pk,team=member.team)
        removed,_=ReleaseRetirement.objects.filter(release=row).delete()
        if removed:AuditRecord.objects.create(team=member.team,actor=member.user,action='release.restored',object_id=str(row.id))
        return Response({'id':str(row.id),'deleted':False})

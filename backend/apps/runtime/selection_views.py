from django.shortcuts import get_object_or_404
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import serializers
from apps.identity.permissions import membership
from apps.common.utils import parse
from apps.connections.cj_catalog import connection_for
from apps.audit.models import AuditRecord
from contracts.selection import SelectionQuery
from .models import SelectionTask
from .selection import selected_brief


def data(task):
    return {'id': str(task.id), 'status': task.status, 'stage': task.stage, 'query': task.query,
            'candidates': task.candidates, 'log': task.log, 'error': task.error,
            'ranked_vids': task.evidence.get('ranked_vids', []), 'created_at': task.created_at,
            'completed_at': task.completed_at, 'connection_version': task.connection_version}


class Selections(APIView):
    def get(self, request):
        member = membership(request)
        return Response([data(t) for t in SelectionTask.objects.filter(team=member.team).order_by('-created_at')[:20]])

    def post(self, request):
        member = membership(request, ['operator'])
        query = parse(SelectionQuery, request.data)
        if query['strategy']!='landed-cost.v1':
            raise serializers.ValidationError('注册选品 Skill 请在十五步流程的评估节点选择并冻结；独立选品入口不接受未绑定版本的策略名称。')
        connection = connection_for(member)
        from django.db import transaction
        from apps.common.errors import Conflict
        with transaction.atomic():
            type(member.team).objects.select_for_update().get(pk=member.team_id)
            if SelectionTask.objects.filter(team=member.team, status__in=['queued', 'running', 'workflow_owned']).exists():
                raise Conflict('已有选品任务执行中，请等待，避免重复占用 CJ 配额。')
            task = SelectionTask.objects.create(team=member.team, requested_by=request.user,
                query=query, connection_version=connection.configuration_version)
            AuditRecord.objects.create(team=member.team, actor=request.user, action='selection.created', object_id=str(task.id))
        return Response(data(task), status=201)


class SelectionDetail(APIView):
    def get(self, request, pk):
        member = membership(request)
        return Response(data(get_object_or_404(SelectionTask, pk=pk, team=member.team)))


class SelectionBrief(APIView):
    def post(self, request, pk):
        member = membership(request, ['operator'])
        task = get_object_or_404(SelectionTask, pk=pk, team=member.team)
        vid = request.data.get('vid')
        if not isinstance(vid, str) or not vid:
            raise serializers.ValidationError('请选择实际规格。')
        return Response({'brief': selected_brief(task, vid)})

"""Persist editor documents without granting them execution authority."""
import copy
import json
from uuid import UUID
from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError
from apps.identity.permissions import membership
from apps.common.errors import Conflict, RuleError
from apps.common.utils import digest
from apps.audit.models import AuditRecord
from apps.connections.models import Store
from apps.connections.services import check_store
from apps.skills.models import SkillVersion
from apps.registry.definitions import NODE_IDS, validate_document
from apps.registry.launch import is_launch
from .models import WorkflowDesign, WorkflowDraft, DesignRelease
from .services import freeze


def safe_document(value):
    if not isinstance(value, dict) or len(json.dumps(value)) > 256000:
        raise ValidationError('流程配置必须为不超过 256KB 的 JSON 文档。')
    if value.get('schemaVersion') != '2' or not isinstance(value.get('id'), str) or not 1 <= len(value['id']) <= 100:
        raise ValidationError('流程文档 ID 或版本无效。')
    if not isinstance(value.get('title'), str) or not 1 <= len(value['title']) <= 200:
        raise ValidationError('流程名称无效。')
    if type(value.get('revision')) is not int or value['revision'] < 1:
        raise ValidationError('流程修订号无效。')
    if not isinstance(value.get('nodes'), list) or not 2 <= len(value['nodes']) <= 40 or not isinstance(value.get('edges'), list) or len(value['edges']) > 100:
        raise ValidationError('流程节点或连线数量无效。')
    def scan(item):
        if isinstance(item, dict):
            for key, child in item.items():
                if key.lower().replace('_', '').replace('-', '') in {'apikey', 'password', 'secret', 'token', 'accesstoken', 'authorization', 'credentials'}:
                    raise ValidationError('流程只保存连接引用，禁止保存凭证。')
                scan(child)
        elif isinstance(item, list):
            for child in item:
                scan(child)
    scan(value)
    return value


def data(row):
    return {'id': str(row.id), 'revision': row.revision, 'document': row.document, 'digest': digest(row.document)}


class Designs(APIView):
    def get(self, request):
        member = membership(request)
        return Response([data(d) for d in WorkflowDesign.objects.filter(team=member.team).order_by('-updated_at')[:100]])

    @transaction.atomic
    def post(self, request):
        member = membership(request, ['operator'])
        document = safe_document(request.data.get('document'))
        expected = request.data.get('expected_revision')
        if type(expected) is not int or expected < 0:
            raise ValidationError('必须提供 expected_revision。')
        type(member.team).objects.select_for_update().get(pk=member.team_id)
        row = WorkflowDesign.objects.select_for_update().filter(team=member.team, client_id=document['id']).first()
        if row:
            if row.revision != expected:
                raise Conflict('配置已由其他页面修改，请重新载入，不能覆盖。')
            row.document = document
            row.revision += 1
            row.save(update_fields=['document', 'revision', 'updated_at'])
        else:
            if expected != 0:
                raise Conflict('原配置不存在，请重新载入。')
            row = WorkflowDesign.objects.create(team=member.team, client_id=document['id'], document=document)
        AuditRecord.objects.create(team=member.team, actor=request.user, action='design.saved', object_id=str(row.id))
        return Response(data(row))


class DesignFreeze(APIView):
    @transaction.atomic
    def post(self, request, pk):
        member = membership(request, ['operator'])
        row = get_object_or_404(WorkflowDesign.objects.select_for_update(), pk=pk, team=member.team)
        if type(request.data.get('expected_revision')) is not int or request.data['expected_revision'] != row.revision:
            raise Conflict('保存版本已改变，请重新保存或载入。')
        existing = DesignRelease.objects.filter(design=row, revision=row.revision).first()
        if existing:
            if hasattr(existing,'retirement'):
                raise Conflict('该冻结版本已删除，请到冻结版本管理页恢复，或保存新的配置后冻结。')
            return Response(release_data(existing))
        document = copy.deepcopy(row.document)
        ids = [n.get('definitionId') for n in document['nodes'] if isinstance(n, dict)]
        if ids != NODE_IDS and not is_launch(document):
            from apps.registry.launch import LAUNCH_IDS
            raise RuleError({'message': '仅支持已实现的七步发布图或完整十五步 CJ 到测试站主线；节点不能缺失、重排或插入未实现职责。',
                'supported_nodes': LAUNCH_IDS, 'unimplemented_nodes': [key for key in ids if key not in LAUNCH_IDS]})
        environment = document.get('environment', {})
        if not isinstance(environment,dict):
            raise ValidationError('店铺环境配置必须为对象。')
        try:
            store_id = UUID(environment.get('storeRef', ''))
        except (ValueError, TypeError, AttributeError):
            raise ValidationError('请配置实际后端店铺 UUID 连接引用；设计声明不能代替已验收连接。')
        store = get_object_or_404(Store, pk=store_id, team=member.team)
        check_store(store)
        # These fields describe connection metadata, never change executable nodes.
        if not is_launch(document):
            document['environment'] = {k:v for k,v in environment.items() if k not in ('storeRef', 'storeIntegration')}
        binding = next(n.get('binding') for n in document['nodes'] if n['definitionId'] == 'content.make')
        if not isinstance(binding,dict) or not isinstance(binding.get('skillId'),str):
            raise ValidationError('内容节点需配置有效的 Skill 引用。')
        skill_id = binding.get('skillId','')
        if skill_id.startswith('registered.'):
            try:
                skill_uuid = UUID(skill_id.removeprefix('registered.'))
            except ValueError:
                raise RuleError('登记 Skill 引用无效。')
            skill = SkillVersion.objects.filter(team=member.team, pk=skill_uuid, version=binding.get('skillVersion'), status='approved').first()
        else:
            skill = SkillVersion.objects.filter(team=member.team, key=skill_id, version=binding.get('skillVersion'), status='approved').first()
        if not skill:
            content=next(n for n in document['nodes'] if n['definitionId']=='content.make')
            raise RuleError({'node_id':content['id'],'message':'保存的内容 Skill 版本未审核或不可用，不能改用默认 Skill。',
                'hint':'请在“制作商品内容与素材”节点选择后端已注册、可用的“原素材与商品文案整理”，应用后重新保存冻结。'})
        executable = validate_document(document, skill)
        if is_launch(document) and next(n['binding']['parameters'] for n in document['nodes'] if n['definitionId']=='listing.map')['mappingStoreVersion'] != store.configuration_version:
            raise Conflict('映射方案的连接版本已过期，请在准备节点重新选择店铺包。')
        draft = WorkflowDraft.objects.create(team=member.team, title=document['title'], document={**executable, 'revision':1}, skill=skill)
        version = freeze(draft, 1)
        release = DesignRelease.objects.create(team=member.team, design=row, revision=row.revision, document=row.document,
            digest=digest(row.document), version=version, store=store, store_version=store.configuration_version)
        AuditRecord.objects.create(team=member.team, actor=request.user, action='design.frozen', object_id=str(release.id))
        return Response(release_data(release), status=201)


def release_data(row):
    return {'id': str(row.id), 'revision':row.revision, 'digest':row.digest, 'document':row.document,'deleted':hasattr(row,'retirement'),
        'version_id':str(row.version_id), 'store_id':str(row.store_id), 'store_version':row.store_version,
        'scope':'cj-launch' if is_launch(row.document) else 'phase-one-publication'}


class ReleaseDetail(APIView):
    def get(self, request, pk):
        member = membership(request)
        return Response(release_data(get_object_or_404(DesignRelease, pk=pk, team=member.team)))

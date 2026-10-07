from django.contrib.auth import authenticate, login, logout
from django.db import connection
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.middleware.csrf import get_token
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect
from django.utils import timezone
from rest_framework import serializers
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from apps.identity.permissions import membership
from apps.common.errors import Conflict, RuleError
from apps.common.utils import digest
from apps.skills.models import SkillVersion
from apps.skills.registry import handler_hash
from apps.registry.definitions import NODES, template, validate_document
from apps.connections.models import Store
from apps.connections.services import check_store
from apps.workflows.models import WorkflowDraft, WorkflowVersion
from apps.workflows.services import update_draft, freeze
from apps.runtime.models import WorkflowRun
from apps.runtime.serializers import RunSerializer, StartSerializer, RevisionSerializer, DecisionSerializer, ReviseSerializer
from apps.runtime.services import start_run, decide, revise, resume, cancel
from apps.approvals.models import ApprovalRequest
from apps.audit.models import AuditRecord

def validated(serializer, data):
    value = serializer(data=data)
    value.is_valid(raise_exception=True)
    return value.validated_data

class Health(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    def get(self, request):
        connection.ensure_connection()
        return Response({'status': 'ok', 'phase': 'approval-to-test-publication', 'database': connection.vendor})

class IntegrationPackages(APIView):
    def get(self, request):
        membership(request)
        from contracts.store_api import package_contract
        from contracts.store_testing import contract as testing_contract
        from django.conf import settings
        return Response({'packages': [package_contract()], 'execution': 'server-installed-only',
                         'testing_extensions':[testing_contract()] if settings.LOCAL and settings.DESKTOP_MODE else [],
                         'note': 'AI-generated source must be reviewed, tested and installed by the server; uploading a manifest does not execute it.'})

class Session(APIView):
    permission_classes = [AllowAny]
    def get(self, request):
        user = request.user
        return Response({'mode': 'desktop' if request.auth == 'desktop' else 'team', 'csrf_token': get_token(request), 'authenticated': user.is_authenticated,
            'user': {'username': user.username, 'role': membership(request).role, 'team_id': str(membership(request).team_id)} if user.is_authenticated else None})

class LoginSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(max_length=200, write_only=True, trim_whitespace=False)

@method_decorator(csrf_protect, name='dispatch')
class Login(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'login'
    def post(self, request):
        data = validated(LoginSerializer, request.data)
        user = authenticate(request, **data)
        if user is None or not user.membership_set.filter(active=True).exists():
            from rest_framework.exceptions import AuthenticationFailed
            raise AuthenticationFailed('用户名或密码错误，或没有团队访问权限。')
        login(request, user)
        return Response({'authenticated': True, 'csrf_token': get_token(request)})

class Logout(APIView):
    def post(self, request):
        logout(request)
        return Response({'authenticated': False})

class Definitions(APIView):
    def get(self, request):
        membership(request)
        return Response({'nodes': NODES, 'execution_scope': 'phase-one-only'})

class Skills(APIView):
    def get(self, request):
        member = membership(request)
        query = SkillVersion.objects.filter(team=member.team)
        if member.role != 'admin':
            query = query.filter(status='approved')
        from apps.skills.registry import check_skill
        from apps.skills.descriptors import skill_descriptor
        rows = []
        for skill in query.order_by('-created_at'):
            usable = False
            reason = '待审核' if skill.status == 'pending' else '已停用'
            if skill.status == 'approved':
                try:
                    check_skill(skill)
                    usable, reason = True, ''
                except RuleError:
                    reason = '审核或代码摘要已失效'
            rows.append({**{key: getattr(skill, key) for key in ('id', 'key', 'version', 'handler', 'artifact_hash', 'status', 'review_note', 'reviewed_at')},
                         'manifest': skill_descriptor(skill), 'selectable': usable,
                         'unavailable_reason': reason, 'execution_scope': 'phase-one-test-store'})
        return Response(rows, headers={'Cache-Control': 'no-store'})
    def post(self, request):
        member = membership(request, ['admin'])
        data = validated(SkillRegistrationSerializer, request.data)
        if SkillVersion.objects.filter(team=member.team, key=data['key'], version=data['version']).exists():
            raise Conflict('此 Skill 版本已注册，不能覆盖。')
        skill = SkillVersion.objects.create(team=member.team, artifact_hash=handler_hash(data['handler']), **data)
        AuditRecord.objects.create(team=member.team, actor=request.user, action='skill.registered', object_id=str(skill.id))
        return Response({'id': str(skill.id), 'status': 'pending', 'artifact_hash': skill.artifact_hash}, status=201)

class SkillRegistrationSerializer(serializers.Serializer):
    key = serializers.ChoiceField(choices=['content.editorial','product.opportunity'])
    version = serializers.RegexField(r'^\d+\.\d+\.\d+$', max_length=40)
    handler = serializers.ChoiceField(choices=['content.editorial.v1','product.opportunity.v1','product.opportunity.v2','product.opportunity.v3','product.opportunity.v4','product.opportunity.v5'])

    def validate(self, data):
        expected={'content.editorial':{'content.editorial.v1':None},'product.opportunity':{'product.opportunity.v1':'1.0.0','product.opportunity.v2':'2.0.0','product.opportunity.v3':'3.0.0','product.opportunity.v4':'4.0.0','product.opportunity.v5':'5.0.0'}}
        versions=expected[data['key']]
        if data['handler'] not in versions or (versions.get(data['handler']) and data['version']!=versions[data['handler']]):
            raise serializers.ValidationError('能力、入口和已实现版本不匹配。')
        return data

class ReviewSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=['approved', 'revoked'])
    reason = serializers.CharField(max_length=1000)

class SkillReview(APIView):
    def post(self, request, pk):
        member = membership(request, ['admin'])
        skill = get_object_or_404(SkillVersion, pk=pk, team=member.team)
        data = validated(ReviewSerializer, request.data)
        if skill.artifact_hash != handler_hash(skill.handler):
            raise RuleError('产物哈希改变，须注册新版本，不能重新批准旧版本。')
        skill.status, skill.review_note, skill.reviewed_by, skill.reviewed_at = data['status'], data['reason'], request.user, timezone.now()
        skill.save(update_fields=['status', 'review_note', 'reviewed_by', 'reviewed_at'])
        AuditRecord.objects.create(team=member.team, actor=request.user, action='skill.' + skill.status, object_id=str(skill.id), metadata={'reason': data['reason']})
        return Response({'id': str(skill.id), 'status': skill.status})

class Stores(APIView):
    def get(self, request):
        member = membership(request)
        return Response(list(Store.objects.filter(team=member.team).values('id', 'name', 'channel', 'environment', 'adapter', 'configuration_version', 'verified', 'active', 'capabilities')))
    def post(self, request):
        import secrets, hashlib
        from django.db import transaction
        from apps.connections.services import encrypt
        from apps.teststore.models import ApiClient
        member = membership(request, ['admin'])
        data = validated(StoreSerializer, request.data)
        # Provision only the installed isolated test-store, never arbitrary remote credentials/URLs.
        token = secrets.token_urlsafe(48)
        with transaction.atomic():
            store = Store.objects.create(team=member.team, name=data['name'], credential_ciphertext=encrypt(token))
            ApiClient.objects.create(name=store.name, storefront_id=store.id, token_hash=hashlib.sha256(token.encode()).hexdigest())
            AuditRecord.objects.create(team=member.team, actor=request.user, action='store.provisioned', object_id=str(store.id))
        return Response({'id': str(store.id), 'name': store.name, 'verified': False, 'channel': store.channel}, status=201)

class StoreSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=100)

class StoreVerify(APIView):
    def post(self, request, pk):
        from apps.integrations.test_store import TestStoreAdapter, UnknownResult
        member = membership(request, ['admin'])
        store = get_object_or_404(Store, pk=pk, team=member.team)
        # This endpoint rechecks an installed test adapter; it is not arbitrary connector registration.
        if store.channel != 'test-store' or store.environment != 'test' or store.adapter != 'test-store.v1' or not store.active:
            raise RuleError('未注册的测试适配器。')
        required_actions = ['listing.validate', 'listing.publish', 'listing.wait']
        try:
            result = TestStoreAdapter(store, verify_connection=True).call('GET', '/capabilities')
        except UnknownResult:
            raise RuleError('测试站不可达，未通过验收。')
        from contracts.store_api import ACTION_CONTRACTS
        actions = result.get('actions', [])
        if not isinstance(actions,list) or any(not isinstance(a,str) for a in actions) or not set(required_actions)<=set(actions) or not set(actions)<=set(ACTION_CONTRACTS) or result.get('storefront_id') != str(store.id) or result.get('adapter') != store.adapter or result.get('idempotent_publish') is not True:
            raise RuleError('店铺身份或动作版本不匹配。')
        store.verified = True
        store.capabilities = actions
        store.save(update_fields=['verified', 'capabilities'])
        AuditRecord.objects.create(team=member.team, actor=request.user, action='store.verified', object_id=str(store.id), metadata={'capabilities': result['actions']})
        return Response({'verified': True, 'configuration_version': store.configuration_version})

class Templates(APIView):
    def get(self, request):
        member = membership(request)
        skill = SkillVersion.objects.filter(team=member.team, key='content.editorial', status='approved').order_by('-created_at').first()
        if not skill:
            raise RuleError('尚无已审核的内容 Skill。')
        from apps.skills.handlers import check_skill
        check_skill(skill)
        from apps.identity.bootstrap import example_brief
        return Response({'document': template(skill), 'skill_id': str(skill.id), 'brief': example_brief()})

class DraftSerializer(serializers.Serializer):
    document = serializers.JSONField()
    skill_id = serializers.UUIDField()

class DraftUpdateSerializer(RevisionSerializer):
    document = serializers.JSONField()

def draft_data(draft):
    return {'id': str(draft.id), 'title': draft.title, 'revision': draft.revision, 'document': draft.document, 'skill_id': str(draft.skill_id)}

class Workflows(APIView):
    def get(self, request):
        member = membership(request)
        return Response([draft_data(d) for d in WorkflowDraft.objects.filter(team=member.team).order_by('-created_at')[:100]])
    def post(self, request):
        member = membership(request, ['operator'])
        data = validated(DraftSerializer, request.data)
        skill = get_object_or_404(SkillVersion, pk=data['skill_id'], team=member.team)
        document = validate_document(data['document'], skill)
        document = {**document, 'revision': 1}
        draft = WorkflowDraft.objects.create(team=member.team, title=document['title'], document=document, skill=skill)
        AuditRecord.objects.create(team=member.team, actor=request.user, action='workflow.created', object_id=str(draft.id))
        return Response(draft_data(draft), status=201)

class WorkflowDetail(APIView):
    def get(self, request, pk):
        member = membership(request)
        return Response(draft_data(get_object_or_404(WorkflowDraft, pk=pk, team=member.team)))
    def patch(self, request, pk):
        member = membership(request, ['operator'])
        draft = get_object_or_404(WorkflowDraft, pk=pk, team=member.team)
        data = validated(DraftUpdateSerializer, request.data)
        return Response(draft_data(update_draft(draft, data['document'], data['expected_revision'])))

class WorkflowValidate(APIView):
    def post(self, request, pk):
        member = membership(request, ['operator'])
        draft = get_object_or_404(WorkflowDraft, pk=pk, team=member.team)
        data = validated(RevisionSerializer, request.data)
        if data['expected_revision'] != draft.revision:
            raise Conflict('流程草稿版本已改变。')
        validate_document(draft.document, draft.skill)
        return Response({'valid': True, 'engine': 'server-registry+pydantic', 'revision': draft.revision, 'document_digest': digest(draft.document), 'scope': 'phase-one-only'})

class Versions(APIView):
    def post(self, request, pk):
        member = membership(request, ['operator'])
        draft = get_object_or_404(WorkflowDraft, pk=pk, team=member.team)
        data = validated(RevisionSerializer, request.data)
        version = freeze(draft, data['expected_revision'])
        return Response({'id': str(version.id), 'revision': version.revision, 'digest': version.digest}, status=201)

class Runs(APIView):
    def get(self, request):
        member = membership(request)
        return Response(RunSerializer(WorkflowRun.objects.filter(team=member.team,context__batch_parent__isnull=True).filter(Q(context__history_pruned__isnull=True)|Q(context__history_pruned=False)).select_related('version').order_by('-created_at')[:100], many=True).data)
    def post(self, request):
        member = membership(request, ['operator'])
        data = validated(StartSerializer, request.data)
        version = get_object_or_404(WorkflowVersion, pk=data['version_id'], team=member.team)
        store = get_object_or_404(Store, pk=data['store_id'], team=member.team)
        release = getattr(version, 'design_release', None)
        if release and hasattr(release,'retirement') and not WorkflowRun.objects.filter(team=member.team,idempotency_key=data['idempotency_key']).exists():
            raise Conflict('冻结版本已删除，请先恢复或选择其他版本；没有停止当前运行。')
        if release and (release.store_id != store.id or release.store_version != store.configuration_version):
            raise Conflict('冻结配置的店铺或连接版本已改变，必须重新保存并冻结；不能替换运行目标。')
        # Desktop "new run" replaces unfinished runs of this business template.
        # Cancellation commits separately: a waiting replacement must not undo it.
        from django.conf import settings
        if settings.LOCAL and settings.DESKTOP_MODE and not WorkflowRun.objects.filter(team=member.team,idempotency_key=data['idempotency_key']).exists():
            validate_document(version.document,version.skill,frozen=True)
            from apps.runtime.services import cancel
            old_runs=WorkflowRun.objects.filter(team=member.team,context__batch_parent__isnull=True,
                version__document__templateId=version.document.get('templateId'),
                status__in=['queued','running','waiting_approval','waiting_event','needs_attention']).order_by('-created_at')
            for old in old_runs:
                cancel(old,request.user,old.revision)
        run, created = start_run(version, store, request.user, data['brief'], data['idempotency_key'])
        return Response(RunSerializer(run).data, status=202 if created else 200)

class RunDetail(APIView):
    def get(self, request, pk):
        member = membership(request)
        return Response(RunSerializer(get_object_or_404(WorkflowRun, pk=pk, team=member.team)).data)

class Events(APIView):
    def get(self, request, pk):
        member = membership(request)
        run = get_object_or_404(WorkflowRun, pk=pk, team=member.team)
        try:
            sequence = int(request.query_params.get('after_sequence', 0))
            if sequence < 0:
                raise ValueError()
        except ValueError:
            raise serializers.ValidationError('after_sequence 必须是非负整数。')
        events = list(run.events.filter(sequence__gt=sequence).order_by('sequence').values_list('payload', flat=True)[:200])
        return Response({'events': events, 'next_sequence': events[-1]['sequence'] if events else sequence})

class Decisions(APIView):
    def post(self, request, pk):
        member = membership(request, ['approver'])
        approval = get_object_or_404(ApprovalRequest, pk=pk, team=member.team)
        data = validated(DecisionSerializer, request.data)
        return Response(RunSerializer(decide(approval, request.user, **data)).data)

class RunRevise(APIView):
    def post(self, request, pk):
        member = membership(request, ['operator'])
        run = get_object_or_404(WorkflowRun, pk=pk, team=member.team)
        data = validated(ReviseSerializer, request.data)
        return Response(RunSerializer(revise(run, request.user, **data)).data)

class RunAction(APIView):
    def post(self, request, pk, action):
        member = membership(request, ['operator'])
        run = get_object_or_404(WorkflowRun, pk=pk, team=member.team)
        data = validated(RevisionSerializer, request.data)
        if action not in ('resume', 'cancel'):
            from django.http import Http404
            raise Http404()
        handler = {'resume': resume, 'cancel': cancel}[action]
        return Response(RunSerializer(handler(run, request.user, **data)).data)

class ListingDetail(APIView):
    def get(self, request, pk):
        member = membership(request)
        run = get_object_or_404(WorkflowRun, pk=pk, team=member.team)
        return Response({'run_id': str(run.id), 'revisions': list(run.listings.values('id', 'generation', 'digest', 'payload')),
            'operations': list(run.operations.values('id', 'key', 'status', 'request_digest', 'receipt')),
            'publication': run.context.get('published')})

class MemberSerializer(serializers.Serializer):
    username = serializers.RegexField(r'^[a-zA-Z0-9_.-]+$', max_length=150)
    password = serializers.CharField(write_only=True, min_length=12, max_length=200, trim_whitespace=False)
    role = serializers.ChoiceField(choices=['admin', 'operator', 'approver', 'viewer'])

class Members(APIView):
    def get(self, request):
        from apps.identity.models import Membership
        member = membership(request, ['admin'])
        return Response(list(Membership.objects.filter(team=member.team).values('id', 'user__username', 'role', 'active')))
    def post(self, request):
        from django.contrib.auth.models import User
        from django.contrib.auth.password_validation import validate_password
        from django.core.exceptions import ValidationError as DjangoValidationError
        from django.db import transaction
        from apps.identity.models import Membership
        member = membership(request, ['admin'])
        data = validated(MemberSerializer, request.data)
        if User.objects.filter(username=data['username']).exists():
            raise Conflict('用户名已存在。')
        try:
            validate_password(data['password'], User(username=data['username']))
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.messages)
        with transaction.atomic():
            user = User.objects.create_user(username=data['username'], password=data['password'])
            entry = Membership.objects.create(team=member.team, user=user, role=data['role'])
            AuditRecord.objects.create(team=member.team, actor=request.user, action='member.created', object_id=str(entry.id))
        return Response({'id': entry.id, 'username': user.username, 'role': entry.role}, status=201)

class MemberUpdateSerializer(serializers.Serializer):
    role = serializers.ChoiceField(choices=['admin', 'operator', 'approver', 'viewer'])
    active = serializers.BooleanField()

class MemberUpdate(APIView):
    def patch(self, request, pk):
        from apps.identity.models import Membership
        from django.db import transaction
        member = membership(request, ['admin'])
        data = validated(MemberUpdateSerializer, request.data)
        with transaction.atomic():
            type(member.team).objects.select_for_update().get(pk=member.team_id)
            target = get_object_or_404(Membership.objects.select_for_update(), pk=pk, team=member.team)
            if target.role == 'admin' and target.active and (not data['active'] or data['role'] != 'admin') and Membership.objects.filter(team=member.team, role='admin', active=True).count() == 1:
                raise RuleError('不能停用或降级最后一名团队管理员。')
            target.role, target.active = data['role'], data['active']
            target.save(update_fields=['role', 'active'])
            AuditRecord.objects.create(team=member.team, actor=request.user, action='member.updated', object_id=str(target.id), metadata=data)
        return Response({'id': target.id, 'role': target.role, 'active': target.active})

class Audit(APIView):
    def get(self, request):
        member = membership(request, ['admin'])
        return Response(list(AuditRecord.objects.filter(team=member.team).order_by('-created_at').values('id', 'created_at', 'actor_id', 'action', 'object_id', 'metadata')[:100]))

import json
from datetime import timedelta
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView
from pydantic import ValidationError
from apps.common.errors import Conflict, RuleError
from apps.common.utils import parse
from apps.connections.models import ModelConnection
from apps.identity.permissions import membership, require_role
from contracts.agents import AgentStart, AgentTurn, SupportReply, ImagePlan
from .harness import complete
from .models import AgentSession
from .skills import profile, public_profiles


def public_session(session):
    return {'id':str(session.id),'purpose':session.purpose,'revision':session.revision,
        'messages':session.messages,'result':session.result,
        'busy':bool(session.busy_until and session.busy_until>timezone.now())}


class AgentSkills(APIView):
    def get(self,request):
        membership(request)
        return Response(public_profiles(),headers={'Cache-Control':'no-store'})


class Sessions(APIView):
    def get(self,request):
        member=membership(request)
        return Response([public_session(s) for s in AgentSession.objects.filter(team=member.team).order_by('-created_at')[:20]],
            headers={'Cache-Control':'no-store'})

    def post(self,request):
        member=membership(request,['operator'])
        fields=parse(AgentStart,request.data)
        rule=profile(fields['purpose'])
        session=AgentSession.objects.create(team=member.team,**fields,skill_digest=rule['digest'])
        return Response(public_session(session),status=201,headers={'Cache-Control':'no-store'})


class SessionDetail(APIView):
    def get(self,request,pk):
        member=membership(request)
        return Response(public_session(get_object_or_404(AgentSession,pk=pk,team=member.team)),headers={'Cache-Control':'no-store'})

    def post(self,request,pk):
        member=membership(request,['operator'])
        fields=parse(AgentTurn,request.data)
        if not fields['message'].strip(): raise RuleError('请输入问题或资料。')
        connection=get_object_or_404(ModelConnection,pk=fields['connection_id'],team=member.team)
        with transaction.atomic():
            session=get_object_or_404(AgentSession.objects.select_for_update(),pk=pk,team=member.team)
            if fields['expected_revision']!=session.revision: raise Conflict('对话已更新，请刷新后重试。')
            if session.busy_until and session.busy_until>timezone.now(): raise Conflict('本会话正在调用模型，请勿重复发送。')
            if len(session.messages)>=40: raise RuleError('本会话已达到 20 轮，请新建对话。')
            rule=profile(session.purpose)
            if session.skill_digest!=rule['digest']: raise RuleError('本会话 Skill 已改变，请新建对话；不会隐式替换策略。')
            session.busy_until=timezone.now()+timedelta(minutes=2)
            session.save(update_fields=['busy_until'])
        try:
            output={'customer_support':SupportReply,'product_image_plan':ImagePlan}.get(session.purpose)
            system=rule['instructions']
            if output: system+='\n只返回符合以下契约的 JSON 对象：\n'+json.dumps(output.model_json_schema(),ensure_ascii=False)
            messages=[{'role':m['role'],'content':m['content']} for m in session.messages]+[{'role':'user','content':fields['message']}]
            text,usage=complete(connection,system,messages,purpose=session.purpose)
            result={}
            if output:
                clean=text.strip()
                if clean.startswith('```'): clean=clean.split('\n',1)[1].rsplit('```',1)[0].strip()
                result=output.model_validate_json(clean).model_dump(mode='json')
            require_role(request.user,member.team,['operator'])
            with transaction.atomic():
                current=AgentSession.objects.select_for_update().get(pk=session.pk)
                if current.revision!=session.revision or current.busy_until!=session.busy_until: raise Conflict('对话已改变，本轮未保存。')
                current.messages=session.messages+[{'role':'user','content':fields['message']},
                    {'role':'assistant','content':text,'model':connection.model_id,'connection_id':str(connection.id),
                     'skill':rule['id'],'skill_version':rule['version'],'usage':usage}]
                current.result=result
                current.revision+=1;current.busy_until=None
                current.save(update_fields=['messages','result','revision','busy_until'])
            return Response(public_session(current),headers={'Cache-Control':'no-store'})
        except ValidationError:
            raise RuleError('模型输出未通过本节点固定契约；未保存结果，不猜测或补齐。') from None
        finally:
            AgentSession.objects.filter(pk=session.pk,revision=session.revision,busy_until=session.busy_until).update(busy_until=None)

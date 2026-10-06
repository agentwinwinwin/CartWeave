from rest_framework.response import Response
from rest_framework.views import APIView
from apps.common.errors import RuleError
from apps.identity.permissions import membership
from . import cj_intelligence as service
from . import cj_browser_bridge as bridge
from rest_framework.permissions import AllowAny


def empty_request(request):
    if request.data:
        raise RuleError('此接口固定采集两组前十，不接收 URL、密码、Cookie 或自定义采集代码。')


class CJIntelligence(APIView):
    def get(self, request):
        member = membership(request)
        return Response(service.status(member.team_id), headers={'Cache-Control': 'no-store'})


class CJIntelligenceLogin(APIView):
    def post(self, request):
        member = membership(request, ['admin'])
        empty_request(request)
        return Response(service.start_login(member.team_id), status=202, headers={'Cache-Control': 'no-store'})


class CJIntelligenceCollect(APIView):
    def post(self, request):
        member = membership(request, ['operator'])
        empty_request(request)
        return Response(service.collect(member.team_id), headers={'Cache-Control': 'no-store'})


class CJIntelligencePlans(APIView):
    def post(self, request):
        from .intelligence_plans import create
        return Response(create(membership(request, ['operator']), request.data), status=201)


class CJIntelligencePlan(APIView):
    def get(self, request, plan_id):
        from .intelligence_plans import read
        return Response(read(membership(request).team_id, plan_id), headers={'Cache-Control': 'no-store'})


class CJChromePairing(APIView):
    def post(self, request):
        member = membership(request, ['admin'])
        empty_request(request)
        return Response(bridge.pairing_code(member.team_id), headers={'Cache-Control': 'no-store'})

    def delete(self, request):
        member = membership(request, ['admin'])
        empty_request(request)
        return Response(bridge.revoke(member.team_id))


class CJChromeBridge(APIView):
    # This is NOT desktop anonymous auth: extension origin + loopback + scoped
    # bearer proof are required inside every action. No access to other APIs.
    authentication_classes = []
    permission_classes = [AllowAny]

    def options(self, request, action):
        origin = bridge.extension_origin(request)
        return Response(headers={'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Vary': 'Origin'})

    def post(self, request, action):
        handlers = {'pair': bridge.pair, 'poll': bridge.poll, 'complete': bridge.complete}
        if action not in handlers:
            raise RuleError('不支持的 Chrome 连接动作。')
        data = handlers[action](request)
        return Response(data, headers={'Cache-Control': 'no-store',
             'Access-Control-Allow-Origin': request.headers['Origin'], 'Vary': 'Origin'})

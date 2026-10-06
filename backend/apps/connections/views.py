from django.utils.decorators import method_decorator
from django.views.decorators.debug import sensitive_post_parameters
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.identity.permissions import membership
from .models import SupplierConnection
from .cj import public_connection, save_key, verify_connection


class CJKeySerializer(serializers.Serializer):
    api_key = serializers.CharField(max_length=200, write_only=True, trim_whitespace=True)
    expected_version = serializers.IntegerField(min_value=0)

    def validate_api_key(self, value):
        if '@api@' not in value or any(c.isspace() for c in value) or '*' in value or len(value.split('@api@')[-1]) < 10:
            raise serializers.ValidationError('请填写完整 API Key，不是 CJ 用户编号、MCP Token 或遮罩值。')
        return value


@method_decorator(sensitive_post_parameters('api_key'), name='dispatch')
class CJConnection(APIView):
    def get(self, request):
        member = membership(request)
        connection = SupplierConnection.objects.filter(team=member.team, provider='cj').first()
        return Response(public_connection(connection), headers={'Cache-Control': 'no-store'})

    def put(self, request):
        member = membership(request, ['admin'])
        serializer = CJKeySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        connection = save_key(member, **serializer.validated_data)
        return Response(public_connection(connection), headers={'Cache-Control': 'no-store'})


class CJVerify(APIView):
    def post(self, request):
        member = membership(request, ['admin'])
        return Response(public_connection(verify_connection(member)), headers={'Cache-Control': 'no-store'})


class CJCategories(APIView):
    def get(self, request):
        from .cj_catalog import catalog
        return Response(catalog(membership(request), refresh=request.query_params.get('refresh') == '1'), headers={'Cache-Control': 'no-store'})


class CJSearchPreview(APIView):
    def post(self, request):
        from apps.common.utils import parse
        from .cj_catalog import ProductSearch, preview
        member = membership(request, ['operator'])
        data=dict(request.data)
        reference=data.pop('marketEvidenceRef',None)
        source=data.pop('marketEvidenceSource','external' if reference else 'none')
        if source not in ('none','external','cj') or source=='cj' and reference:
            from apps.common.errors import RuleError
            raise RuleError('市场证据来源无效或存在重复配置。')
        query = ProductSearch(**parse(ProductSearch, data))
        if reference:
            from apps.skills.market_evidence import evidence_for
            evidence_for(member.team,reference,query.market,query.requestedCurrency)
        result=preview(member, query)
        if reference:
            from apps.runtime.market_search import join_evidence
            result=join_evidence(member.team,result,reference,query.market,query.requestedCurrency)
        if source=='cj':
            from apps.runtime.cj_evidence import preview_evidence
            result=preview_evidence(member,result)
        return Response(result, headers={'Cache-Control': 'no-store'})

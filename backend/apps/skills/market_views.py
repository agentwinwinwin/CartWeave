import json
from django.db import transaction
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError
from apps.identity.permissions import membership
from apps.common.utils import parse,digest
from apps.audit.models import AuditRecord
from .models import MarketEvidence
from .market_evidence import EvidenceDocument

def data(row):
    return {'id':str(row.id),'name':row.name,'digest':row.digest,'document':row.document,
        'provenance':'operator_import_unverified','created_at':row.created_at}

class MarketEvidenceView(APIView):
    def get(self,request):
        member=membership(request)
        return Response([data(row) for row in MarketEvidence.objects.filter(team=member.team).order_by('-created_at')[:50]])

    @transaction.atomic
    def post(self,request):
        member=membership(request,['operator'])
        if request.data.get('confirmed_source') is not True:
            raise ValidationError('需确认来源和商品对应关系；人工导入不是系统核实销量。')
        payload=request.data.get('document')
        if len(json.dumps(payload))>100000:raise ValidationError('证据文档不能超过 100KB。')
        document=parse(EvidenceDocument,payload)
        row=MarketEvidence.objects.create(team=member.team,submitted_by=request.user,name=document['name'],document=document,digest=digest(document))
        AuditRecord.objects.create(team=member.team,actor=request.user,action='market_evidence.imported',object_id=str(row.id),metadata={'digest':row.digest,'provenance':'operator_import_unverified'})
        return Response(data(row),status=201)

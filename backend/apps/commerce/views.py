from uuid import UUID
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError
from apps.identity.permissions import membership
from apps.connections.models import Store
from .models import BusinessRecord,SyncState
from .services import sync_page


def store_status(team,kind):
    states={str(s.store_id):s for s in SyncState.objects.filter(team=team,kind=kind)}
    return [{'id':str(s.id),'name':s.name,'readable':s.active and s.verified and kind+'.read' in s.capabilities,
        'synced_at':states[str(s.id)].synced_at if str(s.id) in states else None,
        'has_more':states[str(s.id)].has_more if str(s.id) in states else False}
        for s in Store.objects.filter(team=team).order_by('name')]


class BusinessList(APIView):
    def get(self,request,kind):
        member=membership(request)
        if kind not in ('orders','customers'):raise ValidationError('不支持的业务列表。')
        try:
            page=int(request.query_params.get('page','1'))
            if page<1 or page>100000:raise ValueError()
            store_id=request.query_params.get('store','')
            if store_id:UUID(store_id)
        except ValueError:raise ValidationError('页码或店铺参数无效。')
        query=BusinessRecord.objects.filter(team=member.team,kind=kind).select_related('store')
        if store_id:
            get_object_or_404(Store,pk=store_id,team=member.team);query=query.filter(store_id=store_id)
        if kind=='customers':query=query.exclude(payload__status='deleted')
        term=request.query_params.get('q','').strip()[:160]
        if term:
            fields=('customer_name','item_summary') if kind=='orders' else ('name','email')
            condition=Q(external_id__icontains=term)
            for field in fields:condition|=Q(**{'payload__'+field+'__icontains':term})
            query=query.filter(condition)
        count=query.count()
        rows=[{'id':str(r.id),'store_id':str(r.store_id),'store_name':r.store.name,**r.payload}
            for r in query.order_by('-observed_at','-id')[(page-1)*50:page*50]]
        return Response({'results':rows,'count':count,'page':page,'page_size':50,'stores':store_status(member.team,kind)},headers={'Cache-Control':'no-store'})


class BusinessSync(APIView):
    def post(self,request,pk,kind):
        member=membership(request,['approver'])
        if request.data:raise ValidationError('同步只读取已绑定店铺，不接受地址、凭证或业务数据。')
        store=get_object_or_404(Store,pk=pk,team=member.team)
        return Response(sync_page(member,store,kind))

from datetime import date, datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from uuid import UUID
from django.utils import timezone
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError
from apps.identity.permissions import membership
from apps.connections.models import Store
from .services import current_facts, calculate, totals, COSTS


def amounts(value):
    if isinstance(value, Decimal):return format(value,'.2f')
    if isinstance(value, list):return [amounts(v) for v in value]
    if isinstance(value, dict):return {k:amounts(v) for k,v in value.items()}
    return value


class Earnings(APIView):
    def get(self, request):
        member = membership(request)
        try:
            tz = ZoneInfo(request.query_params.get('timezone','Asia/Shanghai'))
            today = timezone.now().astimezone(tz).date()
            start = date.fromisoformat(request.query_params.get('start',str(today-timedelta(days=6))))
            end = date.fromisoformat(request.query_params.get('end',str(today)))
            page = int(request.query_params.get('page','1'))
            if not 0 <= (end-start).days <= 92 or not 1 <= page <= 100000:raise ValueError()
            store_id = request.query_params.get('store','')
            if store_id:UUID(store_id)
        except (ValueError, ZoneInfoNotFoundError):
            raise ValidationError('日期范围须为 1–93 天，时区与页码须有效。')
        currency = request.query_params.get('currency','USD')
        if currency not in ('USD','EUR','GBP','CNY'):raise ValidationError('请按单一受支持币种查看，不自动换汇。')
        stores = Store.objects.filter(team=member.team)
        if store_id and not stores.filter(pk=store_id).exists():raise ValidationError('店铺不可用。')
        base = current_facts(member.team)
        query = base.filter(currency=currency, paid_at__gte=datetime.combine(start,time.min,tzinfo=tz), paid_at__lt=datetime.combine(end+timedelta(days=1),time.min,tzinfo=tz))
        if store_id:query=query.filter(store_id=store_id)
        # Projection only: no storefront polling, payment or supplier writes.
        facts = list(query.select_related('store').order_by('-paid_at','-id'))
        calculated = [calculate(f) for f in facts]
        groups = {}
        for f,r in zip(facts,calculated):groups.setdefault(str(f.paid_at.astimezone(tz).date()),[]).append(r)
        daily = []
        for offset in range((end-start).days+1):
            day = str(start+timedelta(days=offset));daily.append({'date':day,**totals(groups.get(day,[]))})
        results = []
        for f,r in list(zip(facts,calculated))[(page-1)*50:page*50]:
            results.append({'id':str(f.id),'order_id':f.external_order_id,'store_name':f.store.name,'paid_at':f.paid_at.isoformat(),'observed_at':f.observed_at.isoformat(),'revision':f.revision,'currency':f.currency,'source_ref':f.source_ref,'paid_total':f.paid_total,'tax_collected':f.tax_collected,'refund_total':f.refund_total,'tax_refunded':f.tax_refunded,'costs':{k:getattr(f,k) for k in COSTS},**r})
        from apps.commerce.views import store_status
        return Response(amounts({'status':'ready' if facts else 'no_data' if base.exists() else 'awaiting_connection','summary':totals(calculated),'daily':daily,'results':results,'count':len(facts),'page':page,'page_size':50,'currency':currency,'timezone':str(tz),'start':str(start),'end':str(end),'stores':store_status(member.team,'finance'),'basis':'paid_date_latest_facts','latest_observed_at':max((f.observed_at for f in facts),default=None),'connectors':{'orders':'store_package','actual_costs':'source_facts_only','advertising':'source_facts_only'}}),headers={'Cache-Control':'no-store'})

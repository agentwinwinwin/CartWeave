"""Real local test-store HTTP and persistence, never real payment/email execution."""
import base64
import hashlib
import io
from decimal import Decimal
from django.conf import settings
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView
from apps.common.errors import Conflict, RuleError
from apps.common.utils import digest, parse
from apps.connections.models import Store
from apps.connections.services import check_store
from apps.identity.permissions import membership
from apps.integrations.test_store import TestStoreAdapter
from contracts.store_testing import ACTIONS, envelope, contract
from contracts.store_business import BUSINESS_ACTIONS
from .models import ApiClient, PublishedProduct, ExchangeRecord, BusinessEvent, TestingEnrollment
from .views import StoreAPI

def local_only():
    if not settings.LOCAL or not settings.DESKTOP_MODE:
        raise RuleError('这些接口仅用于本机桌面测试站，不允许用于生产店铺。')

def context(client, message):
    from apps.agents.operations import retrieve
    passages=retrieve(message.payload['message'])
    order=None
    if message.payload.get('order_id'):
        row=get_object_or_404(ExchangeRecord,client=client,kind='order',pk=message.payload['order_id'])
        order=row.payload['order']
    value={'message_id':str(message.id),'message':message.payload['message'], 'order':order,
        'policy':passages,'policy_scope':'Northwind test policy; not production merchant policy', 'source':'test-store-http'}
    return {**value,'context_digest':digest(value)}

class TestingContracts(StoreAPI):
    def get(self,request):
        local_only()
        return Response(contract())

class TestingAction(StoreAPI):
    def post(self,request,action):
        local_only()
        if action not in ACTIONS: raise RuleError('未实现的测试动作。')
        fields=parse(ACTIONS[action],request.data);client=request.auth
        with transaction.atomic():
            ApiClient.objects.select_for_update().get(pk=client.pk,active=True)
            result=self.execute(client,action,fields)
        return Response(parse(envelope(action),{'storefront_id':str(client.storefront_id),'result':result}),headers={'Cache-Control':'no-store'})

    def execute(self,client,action,f):
        if action=='test.records':
            products=PublishedProduct.objects.filter(client=client,status='active').order_by('-created_at')[:100]
            records=ExchangeRecord.objects.filter(client=client).exclude(kind='message').order_by('-created_at')[:50]
            return {'products':[{'id':str(p.id),'title':p.payload['title'],'price':p.payload['variants'][0]['price']} for p in products],
                'records':[{'kind':r.kind,'id':str(r.id),'created_at':r.created_at.isoformat(), 'payload':{k:v for k,v in r.payload.items() if k!='png_base64'}} for r in records]}
        if action=='support.messages':
            rows=ExchangeRecord.objects.filter(client=client,kind='message').order_by('-created_at')[:50]
            return {'messages':[{'id':str(r.id),**r.payload} for r in rows]}
        if action=='support.context':
            return context(client,get_object_or_404(ExchangeRecord,client=client,kind='message',pk=f['message_id']))
        if action.endswith('.lookup'):
            kind='reply' if action.startswith('support') else 'material'
            return {k:v for k,v in get_object_or_404(ExchangeRecord,client=client,kind=kind,operation_key=f['operation_key']).payload.items() if k!='png_base64'}
        identity=digest({'action':action,**f})
        old=ExchangeRecord.objects.filter(client=client,operation_key=f['operation_key']).first()
        if old:
            if old.input_digest!=identity: raise Conflict('同一操作键不能改变测试请求。')
            return {k:v for k,v in old.payload.items() if k not in ('png_base64','lines')}
        if action=='test.order.create':
            p=get_object_or_404(PublishedProduct,pk=f['product_id'],client=client,status='active')
            sku=p.payload['variants'][0]
            if f['quantity']>sku['inventory']: raise RuleError('测试购买数量超过刊登库存。')
            row=ExchangeRecord.objects.create(client=client,kind='order',operation_key=f['operation_key'],input_digest=identity,payload={})
            now=timezone.now().isoformat();external=str(row.id);customer='test-customer-'+external
            source='test-store://'+str(client.storefront_id)+'/test-orders/'+external
            total=Decimal(str(sku['price']))*f['quantity']
            order={'external_id':external,'revision':1,'observed_at':now,'source_ref':source,'ordered_at':now,
                'customer_id':customer,'customer_name':'Test Customer','currency':'USD','total':str(total),
                'payment_status':'paid','fulfillment_status':'unfulfilled','tracking_number':None,
                'item_summary':'[TEST PAYMENT ONLY] '+p.payload['title'][:400]}
            customer_fact={'external_id':customer,'revision':1,'observed_at':now,'source_ref':source,
                'name':'Test Customer','email':'customer@example.invalid','country':'US','status':'active'}
            finance={'external_order_id':external,'source_event_id':'test-payment-'+external,'source_ref':source,'revision':1,
                'paid_at':now,'observed_at':now,'currency':'USD','paid_total':str(total),'tax_collected':'0.00',
                'refund_total':'0.00','tax_refunded':'0.00',**{k:f[k] for k in ('procurement','shipping','platform_payment','advertising','other')}}
            for kind,value in [('orders',order),('customers',customer_fact),('finance',finance)]:
                value=parse(BUSINESS_ACTIONS[kind+'.read'][1],value)
                BusinessEvent.objects.create(client=client,kind=kind,external_id=external if kind!='customers' else customer,revision=1,payload=value)
            result={'id':external,'order':order,'test_payment':True,'source_ref':source,'product_id':str(p.id)}
            # Private structured order lines, not added to the historical @1 receipt.
            row.payload={**result,'lines':[{'product_id':str(p.id),'sku':sku['sku'],'quantity':f['quantity']}]}
            row.save(update_fields=['payload'])
            return result
        elif action=='support.receive':
            if f['order_id']: get_object_or_404(ExchangeRecord,client=client,pk=f['order_id'],kind='order')
            result={'message':f['message'],'order_id':f['order_id'],'received_at':timezone.now().isoformat(),'channel':'test-inbox'}
            row=ExchangeRecord.objects.create(client=client,kind='message',operation_key=f['operation_key'],input_digest=identity,payload=result)
            result={**result,'id':str(row.id)}
        elif action=='support.reply':
            message=get_object_or_404(ExchangeRecord,client=client,pk=f['message_id'],kind='message')
            if context(client,message)['context_digest']!=f['context_digest']: raise Conflict('客服资料已改变，不能发送旧回复。')
            if ExchangeRecord.objects.filter(client=client,kind='reply',payload__message_id=f['message_id']).exists(): raise Conflict('此消息已有答复，请查看历史。')
            result={'message_id':f['message_id'],'reply':f['reply'],'operation_key':f['operation_key'],
                'status':'stored-in-test-inbox','delivered_at':timezone.now().isoformat(),'email_sent':False}
            row=ExchangeRecord.objects.create(client=client,kind='reply',operation_key=f['operation_key'],input_digest=identity,payload=result)
        else:
            get_object_or_404(PublishedProduct,client=client,pk=f['product_id'],status='active')
            try:
                data=base64.b64decode(f['png_base64'],validate=True)
                if len(data)>8*1024*1024 or hashlib.sha256(data).hexdigest()!=f['sha256']: raise ValueError()
                from PIL import Image
                image=Image.open(io.BytesIO(data))
                if image.format!='PNG' or image.size not in [(1024,1024),(1024,1536),(1536,1024)]: raise ValueError()
                image.verify()
            except Exception: raise RuleError('素材 PNG、摘要或尺寸检查失败。') from None
            result={k:f[k] for k in ('product_id','batch_id','asset_id','sha256')}
            result.update(status='archived-not-published',received_at=timezone.now().isoformat())
            row=ExchangeRecord.objects.create(client=client,kind='material',operation_key=f['operation_key'],input_digest=identity,payload={**result,'png_base64':f['png_base64']})
            return result
        row.payload=result;row.save(update_fields=['payload'])
        return result

def adapter_for(member,store_id):
    store=get_object_or_404(Store,pk=store_id,team=member.team)
    check_store(store)
    enrollment=TestingEnrollment.objects.filter(store=store,configuration_version=store.configuration_version,contract_digest=digest(contract())).first()
    if not enrollment: raise RuleError('请先在测试站联调中心确认启用测试业务接口。')
    return store,TestStoreAdapter(store)

def call(adapter,action,data):
    data=parse(ACTIONS[action],data)
    value=parse(envelope(action),adapter.call('POST','/testing/actions/'+action,data))
    if value['storefront_id']!=str(adapter.store_id): raise RuleError('测试接口回执不属于当前店铺。')
    return value['result']

class MessageFeed(StoreAPI):
    """Read-only chronological pages, including answered markers; never a latest-50 sample."""
    def post(self,request):
        from django.db.models import Q
        from contracts.support_feed import FeedInput, MessageFeed as Result
        local_only(); fields=parse(FeedInput,request.data); client=request.auth
        rows=ExchangeRecord.objects.filter(client=client,kind='message')
        if fields['cursor']:
            after=get_object_or_404(ExchangeRecord,client=client,kind='message',pk=fields['cursor'])
            rows=rows.filter(Q(created_at__gt=after.created_at)|Q(created_at=after.created_at,id__gt=after.id))
        rows=list(rows.order_by('created_at','id')[:51]); more=len(rows)>50; rows=rows[:50]
        ids=[str(r.id) for r in rows]
        answered=set(ExchangeRecord.objects.filter(client=client,kind='reply',payload__message_id__in=ids).values_list('payload__message_id',flat=True))
        return Response(parse(Result,{'storefront_id':str(client.storefront_id),
            'messages':[{'id':str(r.id),**r.payload,'answered':str(r.id) in answered} for r in rows],
            'next_cursor':str(rows[-1].id) if rows else fields['cursor'],'has_more':more}),headers={'Cache-Control':'no-store'})

class TestLab(APIView):
    def get(self,request,pk):
        local_only();member=membership(request)
        store,adapter=adapter_for(member,pk)
        messages=call(adapter,'support.messages',{})
        records=call(adapter,'test.records',{})
        return Response({'store_id':str(store.id),'messages':messages['messages'],**records,'version':'1.0.0'})

    def post(self,request,pk):
        local_only();member=membership(request,['operator'])
        store=get_object_or_404(Store,pk=pk,team=member.team)
        action=request.data.get('action');data=request.data.get('data',{})
        if action=='enable':
            if data!={'confirmed':True}: raise RuleError('必须确认测试政策、订单非真实收款以及素材不自动发布。')
            check_store(store);adapter=TestStoreAdapter(store)
            remote=adapter.call('GET','/testing/contracts')
            if digest(remote)!=digest(contract()): raise RuleError('测试站扩展契约不匹配。')
            TestingEnrollment.objects.update_or_create(store=store,defaults={'configuration_version':store.configuration_version,'contract_digest':digest(contract()),'confirmed_at':timezone.now()})
            return Response({'enabled':True,'version':'1.0.0'})
        store,adapter=adapter_for(member,pk)
        if action=='test.shipment.advance':
            from contracts.fulfillment import AdvanceCommand,ShipmentFact
            fields=parse(AdvanceCommand,data)
            return Response(parse(ShipmentFact,adapter.call('POST','/testing/shipment-advance',fields)))
        if action not in ('test.order.create','support.receive'): raise RuleError('测试台不能直接发送回复或替换线上素材。')
        return Response(call(adapter,action,data))

class ShipmentAdvance(StoreAPI):
    def post(self,request):
        from .fulfillment import advance
        local_only()
        return Response(advance(request.auth,request.data),headers={'Cache-Control':'no-store'})

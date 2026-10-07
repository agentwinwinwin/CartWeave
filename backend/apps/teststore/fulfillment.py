"""Explicit simulated shipping over real HTTP/persistence, with isolated store ownership."""
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.response import Response
from apps.common.errors import RuleError,Conflict
from apps.common.utils import digest,parse
from contracts.fulfillment import FULFILLMENT_ACTIONS,ShipmentFact,AdvanceCommand
from contracts.store_business import OrderFact
from .models import ExchangeRecord,BusinessEvent,ApiClient

def order_detail(client,order_id):
    row=get_object_or_404(ExchangeRecord,client=client,kind='order',pk=order_id)
    if not row.payload.get('lines'): raise RuleError('旧测试订单缺少 SKU 与数量，请新建测试订单；不能猜测规格。')
    return {'storefront_id':str(client.storefront_id),'order':row.payload['order'],
        'lines':row.payload['lines'],'destination_country':'US','test_payment':True}

def project_order(client,shipment):
    row=get_object_or_404(ExchangeRecord,client=client,kind='order',pk=shipment['order_id'])
    old=row.payload['order']
    status='delivered' if shipment['status']=='delivered' else 'fulfilled'
    if old['fulfillment_status']==status and old['tracking_number']==shipment['tracking_number']: return old
    value=parse(OrderFact,{**old,'revision':old['revision']+1,'observed_at':timezone.now().isoformat(),
        'fulfillment_status':status,'tracking_number':shipment['tracking_number']})
    row.payload={**row.payload,'order':value};row.save(update_fields=['payload'])
    BusinessEvent.objects.create(client=client,kind='orders',external_id=value['external_id'],revision=value['revision'],payload=value)
    return value

@transaction.atomic
def execute(client,action,f):
    ApiClient.objects.select_for_update().get(pk=client.pk,active=True)
    if action=='order.detail':return order_detail(client,f['order_id'])
    if action=='shipment.read':return get_object_or_404(ExchangeRecord,client=client,kind='shipment',pk=f['shipment_id']).payload
    if action=='fulfillment.lookup':return get_object_or_404(ExchangeRecord,client=client,kind='shipment',operation_key=f['operation_key']).payload
    identity=digest({'action':action,**f})
    old=ExchangeRecord.objects.filter(client=client,operation_key=f['operation_key']).first()
    if old:
        if old.input_digest!=identity or old.kind!=('shipment' if action=='fulfillment.create' else 'fulfillment-record'):raise Conflict('履约键已用于其他输入。')
        return old.payload
    if action=='fulfillment.create':
        detail=order_detail(client,f['order_id']);order=detail['order']
        if order['revision']!=f['expected_order_revision'] or order['payment_status']!='paid' or order['fulfillment_status']!='unfulfilled':raise Conflict('订单状态或版本不允许创建发货单。')
        if ExchangeRecord.objects.filter(client=client,kind='shipment',payload__order_id=f['order_id']).exists():raise Conflict('订单已创建发货单，不能重复履约。')
        from .models import PublishedProduct
        for line in detail['lines']:
            p=get_object_or_404(PublishedProduct,client=client,pk=line['product_id'])
            sku=next((s for s in p.payload['variants'] if s['sku']==line['sku']),None)
            if not sku or sku['inventory']<line['quantity']:raise RuleError('刊登规格缺失或测试库存不足。')
        row=ExchangeRecord.objects.create(client=client,kind='shipment',operation_key=f['operation_key'],input_digest=identity,payload={})
        now=timezone.now().isoformat()
        value=parse(ShipmentFact,{'external_id':str(row.id),'revision':1,'observed_at':now,
            'source_ref':f'test-store://{client.storefront_id}/shipments/{row.id}',
            'storefront_id':str(client.storefront_id),'order_id':f['order_id'],'operation_key':f['operation_key'],
            'status':'prepared','tracking_number':'TEST-'+row.id.hex.upper(),'events':[]})
        row.payload=value;row.save(update_fields=['payload'])
        BusinessEvent.objects.create(client=client,kind='shipments',external_id=str(row.id),revision=1,payload=value)
        return value
    row=get_object_or_404(ExchangeRecord,client=client,kind='shipment',pk=f['shipment_id']);s=row.payload
    if s['revision']!=f['expected_shipment_revision'] or s['status'] not in ('dispatched','in_transit','delivered'):raise Conflict('尚无有效出库证据或物流版本改变，不能回写。')
    value=project_order(client,s)
    ExchangeRecord.objects.create(client=client,kind='fulfillment-record',operation_key=f['operation_key'],input_digest=identity,payload=value)
    return value

@transaction.atomic
def advance(client,fields):
    ApiClient.objects.select_for_update().get(pk=client.pk,active=True)
    f=parse(AdvanceCommand,fields);row=get_object_or_404(ExchangeRecord,client=client,kind='shipment',pk=f['shipment_id']);s=row.payload
    transitions={'prepared':('dispatched',),'dispatched':('in_transit','exception'),'in_transit':('delivered','exception')}
    if s['revision']!=f['expected_revision'] or f['status'] not in transitions.get(s['status'],()):raise Conflict('物流版本已改变或不能跳过出库/运输阶段。')
    now=timezone.now().isoformat();labels={'dispatched':'测试承运方确认出库','in_transit':'测试包裹运输中','delivered':'测试签收确认','exception':'测试物流异常，需人工处理'}
    value=parse(ShipmentFact,{**s,'revision':s['revision']+1,'observed_at':now,'status':f['status'],
        'events':s['events']+[{'status':f['status'],'occurred_at':now,'description':labels[f['status']]}]})
    row.payload=value;row.save(update_fields=['payload'])
    BusinessEvent.objects.create(client=client,kind='shipments',external_id=str(row.id),revision=value['revision'],payload=value)
    # Delivery is a carrier event, not inferred from a dispatch receipt.
    if value['status']=='delivered':project_order(client,value)
    return value

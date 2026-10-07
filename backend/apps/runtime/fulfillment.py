"""Closed eight-step local test fulfillment. External writes are intent-first, lookup-first."""
from apps.common.errors import RuleError,Conflict
from apps.common.utils import digest,parse
from apps.integrations.test_store import TestStoreAdapter
from contracts.fulfillment import FULFILLMENT_ACTIONS
from .models import WorkflowRun

def call(run,action,data,missing=False):
    if action not in run.store.capabilities:raise RuleError('店铺尚未验收该履约动作。')
    model,result=FULFILLMENT_ACTIONS[action]
    value=TestStoreAdapter(run.store).call('POST','/actions/'+action,parse(model,data),allow_missing=missing)
    if value is None:return None
    value=parse(result,value)
    if 'storefront_id' in value and value['storefront_id']!=str(run.store_id):raise RuleError('履约回执属于其他店铺。')
    return value

def step(run,state,config):
    if run.cursor==0:
        state['order_detail']=call(run,'order.detail',{'order_id':config['order_id']})
        if state['order_detail']['order']['external_id']!=config['order_id']:raise RuleError('订单明细的来源 ID 不匹配。')
    elif run.cursor==1:
        d=state['order_detail'];o=d['order']
        if o['payment_status']!='paid' or o['fulfillment_status']!='unfulfilled' or not d['lines']:
            raise RuleError('订单未支付、已履约或缺少规格数量，不允许测试发货。')
        state['plan']={'order_id':config['order_id'],'expected_order_revision':o['revision'],
            'test_execution_confirmed':True,'lines':d['lines'],'test_only':True}
    elif run.cursor==2:
        state['confirmation_digest']=digest(state['plan'])
        return state,'approval'
    elif run.cursor==3:
        if not state.get('approved') or digest(state['approved']['payload'])!=digest(state['plan']):raise RuleError('本轮履约方案未确认。')
        from apps.listings.models import ExternalOperation
        key=digest({'run':str(run.id),'action':'fulfillment.create','plan':state['plan']})
        command={k:v for k,v in state['plan'].items() if k in ('order_id','expected_order_revision','test_execution_confirmed')}
        command['operation_key']=key
        operation,created=ExternalOperation.objects.get_or_create(store=run.store,key=key,defaults={'team':run.team,'run':run,'payload':command,'request_digest':digest(command)})
        if operation.payload!=command or operation.run_id!=run.id:raise Conflict('履约意图输入已变化。')
        receipt=call(run,'fulfillment.lookup',{'operation_key':key},True)
        if receipt is None:
            if not created:raise RuleError('履约结果未知且未找到原操作，禁止自动重发，请人工核对。')
            receipt=call(run,'fulfillment.create',command)
        if receipt['operation_key']!=key or receipt['order_id']!=config['order_id']:raise RuleError('履约操作回执不匹配。')
        operation.status='succeeded';operation.receipt=receipt;operation.save(update_fields=['status','receipt'])
        state['shipment']=receipt
    elif run.cursor in (4,6):
        shipment=call(run,'shipment.read',{'shipment_id':state['shipment']['external_id']})
        if shipment['order_id']!=config['order_id'] or shipment['operation_key']!=state['shipment']['operation_key']:raise RuleError('物流证据与本轮订单不一致。')
        state['shipment']=shipment
        if shipment['status']=='exception':raise RuleError('测试物流异常，需要人工处理；不能当作已签收。')
        if run.cursor==4 and shipment['status']=='prepared' or run.cursor==6 and shipment['status']!='delivered':return state,'wait'
    elif run.cursor==5:
        s=state['shipment'];key=digest({'run':str(run.id),'action':'fulfillment.record','shipment':s})
        state['order_record']=call(run,'fulfillment.record',{'shipment_id':s['external_id'],
            'expected_shipment_revision':s['revision'],'operation_key':key})
        record=state['order_record'];old=state['order_detail']['order']
        if record['external_id']!=config['order_id'] or record['tracking_number']!=s['tracking_number'] or record['fulfillment_status'] not in ('fulfilled','delivered') or any(record[k]!=old[k] for k in ('payment_status','currency','total','ordered_at','customer_id')):
            raise RuleError('履约回写结果未对应原订单与物流证据。')
    else:
        if state['shipment']['status']!='delivered':raise RuleError('尚无签收证据。')
        state['receipt']=state['shipment'];state['archived']=True
    return state,'done'

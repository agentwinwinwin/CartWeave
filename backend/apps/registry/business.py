"""Closed support/image graphs. Model policies are NOT deterministic SkillVersion handlers."""
import copy
from uuid import UUID
from pydantic import Field, model_validator
from typing import Literal
from contracts.listings import Contract
from contracts.product_images import ImageBatchStart
from apps.common.errors import RuleError
from apps.common.utils import parse
from apps.agents.skills import profile
from apps.agents.image_transport import fingerprint, check_generator
from apps.connections.models import ModelConnection

GRAPHS = {
    'fulfillment':['order.start','order.eligible','order.authorize','order.dispatch','order.wait','order.record','order.delivery','order.end'],
    'support': ['support.start','support.context','support.propose','support.authorize','support.execute','support.wait','support.end'],
    'product-images': ['image.start','image.brief','image.generate','image.check','image.authorize','image.end'],
}
LEGACY_DEFAULTS = {'market':'US','timeout':60,'resourceRef':'','modelRef':'',
    'instruction':'依据可追溯证据输出契约结果；缺少信息应明确标记。',
    'reviewChecklist':'核对证据、缺失信息及本次处理范围。',
    'ruleNote':'遵循固定契约，保留缺失事实。','approvalEnabled':True}
RELATIONS = {'support':{('support.propose','support.context','collaboration'),('support.authorize','support.propose','feedback')},
    'fulfillment':set(),
    'product-images':{('image.authorize','image.brief','feedback')}}
class SupportConfig(Contract):
    message_id: UUID | None = None
    input_mode: Literal['message','inbox'] = 'message'
    reply_policy: Literal['manual','automatic'] = 'manual'
    mode: Literal['fixture','pi'] = 'fixture'
    connection_id: UUID | None = None
    sample_knowledge_confirmed: Literal[True]

    @model_validator(mode='after')
    def input_policy(self):
        if self.input_mode=='message' and not self.message_id:
            raise ValueError('单次运行须选择消息。')
        if self.input_mode=='inbox' and self.message_id is not None:
            raise ValueError('监听收件箱不绑定某一条消息。')
        if self.reply_policy=='automatic' and self.input_mode!='inbox':
            raise ValueError('自动答复仅用于明确配置的收件箱监听版本。')
        return self

class FulfillmentConfig(Contract):
    order_id: UUID
    test_execution_confirmed: Literal[True]

def is_business(document):
    return document.get('templateId') in GRAPHS

def configuration(document):
    return document['nodes'][0]['binding']['parameters'].get('runtime', {})

def validate(document, team=None, frozen=False):
    doc=copy.deepcopy(document); key=doc.get('templateId'); nodes=doc.get('nodes',[])
    if not isinstance(nodes,list) or any(not isinstance(n,dict) or not isinstance(n.get('id'),str) or not n['id'] or not isinstance(n.get('binding'),dict) or not isinstance(n['binding'].get('parameters'),dict) for n in nodes):
        raise RuleError('节点、标识或参数结构无效。')
    if not isinstance(doc.get('edges'),list) or any(not isinstance(e,dict) or not isinstance(e.get('id'),str) or not e['id'] for e in doc['edges']):
        raise RuleError('连线结构或标识无效。')
    if team is None:
        from apps.connections.models import Store
        try: team=Store.objects.get(pk=doc.get('environment',{}).get('storeRef')).team
        except (Store.DoesNotExist, ValueError, TypeError): raise RuleError('请先保存已验收的店铺连接。') from None
    if key not in GRAPHS or [n.get('definitionId') for n in nodes]!=GRAPHS[key] or len({n.get('id') for n in nodes})!=len(nodes):
        raise RuleError('业务执行图必须为完整标准主线；不能删除、重排或插入未实现节点。')
    pairs=[(n['id'],nodes[i+1]['id']) for i,n in enumerate(nodes[:-1])]
    forward=[e for e in doc.get('edges',[]) if e.get('kind')=='forward']
    if [(e.get('source'),e.get('target')) for e in forward]!=pairs or len({e.get('id') for e in doc['edges']})!=len(doc['edges']):
        raise RuleError('业务前向连线不匹配。协作与返工仅作设计提示，不执行旁路。')
    definitions={n['id']:n['definitionId'] for n in nodes}
    for e in doc['edges']:
        if e.get('source') not in definitions or e.get('target') not in definitions or e.get('kind') not in ('forward','feedback','collaboration'):
            raise RuleError('业务连线引用或类型无效。')
        if e['kind']!='forward' and (definitions[e['source']],definitions[e['target']],e['kind']) not in RELATIONS[key]:
            raise RuleError('未实现的协作或返工连线不能冻结运行。')
    # Closed bindings: legacy empty system bindings are accepted, uploaded implementations are not.
    for i,n in enumerate(nodes):
        b=n.get('binding',{}); expected=n['definitionId']+'.core'
        if b.get('mode')!='default' or b.get('skillId') not in ('',expected) or b.get('skillVersion')!='1.0.0' or b.get('execution') or b.get('connectionRef'):
            raise RuleError({'node_id':n['id'],'message':'此业务仅执行内置受信节点；自定义实现未注册。'})
        legacy={**LEGACY_DEFAULTS}
        if n['definitionId']=='image.start': legacy.update(usage='商品主图与详情图',imageCount=4)
        if n['definitionId']=='image.generate': legacy.update(skillInstruction='按已确认制作方案生成，不改变商品外观或虚构功能。')
        for name,value in b.get('parameters',{}).items():
            if name=='runtime' and i==0: continue
            if name not in legacy or value!=legacy[name]:
                raise RuleError({'node_id':n['id'],'message':f'参数 {name} 不属于已实现运行配置；请通过本流程运行配置窗口设置。'})
    config=configuration(doc)
    if key=='fulfillment':
        from django.conf import settings
        from apps.connections.models import Store
        if not settings.LOCAL or not settings.DESKTOP_MODE or doc.get('environment',{}).get('fulfillment')!='merchant':
            raise RuleError('本版本仅本机测试站仓库模拟履约；供应商采购与平台履约尚未实现。')
        store=Store.objects.filter(pk=doc.get('environment',{}).get('storeRef'),team=team).first()
        actions={'order.detail','fulfillment.create','fulfillment.lookup','shipment.read','fulfillment.record','shipments.read'}
        if not store or not actions<=set(store.capabilities):raise RuleError('请在配置店铺接入重新验收订单与物流接口包。')
        config=parse(FulfillmentConfig,config)
        signature={'profile':'local-test-fulfillment','contract_digest':None}
        from contracts.fulfillment import FULFILLMENT_ACTIONS
        from apps.common.utils import digest
        signature['contract_digest']=digest({a:[i.model_json_schema(),o.model_json_schema()] for a,(i,o) in FULFILLMENT_ACTIONS.items()})
        if frozen and doc.get('runtimePolicy')!=signature:raise RuleError('履约接口契约已改变，请重新冻结。')
        doc['runtimePolicy']=signature;nodes[0]['binding']['parameters']['runtime']=config
        return doc
    if key=='support':
        config=parse(SupportConfig,config); purpose='customer_support_rag'
        if config['mode']=='pi' and not config['connection_id']: raise RuleError('请选择客服对话模型。')
        if nodes[3]['binding']['parameters'].get('approvalEnabled',True) is not True:
            raise RuleError('发送客户回复必须人工确认，不能关闭此审核。')
    else:
        config=parse(ImageBatchStart,{**config,'design_id':doc['id'],'idempotency_key':str(UUID(int=0))})
        config={k:v for k,v in config.items() if k not in ('design_id','idempotency_key')}
        purpose=config['planner_skill']
        from apps.agents.image_service import available_products
        products={p['id']:p for p in available_products(team)}
        if any(pid not in products or products[pid]['store_id']!=doc.get('environment',{}).get('storeRef') for pid in config['product_ids']):
            raise RuleError('图片流程只能选择冻结店铺中仍可用的已上架商品。')
    rule=profile(purpose); refs={}
    model_ids={'reply':config['connection_id']} if key=='support' and config['mode']=='pi' else (
        {'planner':config['planner_id'],'generator':config['generator_id']} if key=='product-images' else {})
    if team:
        for role,pk in model_ids.items():
            c=ModelConnection.objects.filter(team=team,pk=pk).first()
            if not c: raise RuleError('冻结配置引用的模型连接不存在。')
            if role=='generator': check_generator(c)
            elif c.model_id.startswith('gpt-image-'): raise RuleError('方案或客服回复必须使用对话模型。')
            refs[role]=fingerprint(c)
    signature={'profile':purpose,'digest':rule['digest'],'connections':refs}
    if frozen:
        if doc.get('runtimePolicy')!=signature: raise RuleError('模型连接或内置 Skill 已变化，请重新配置并冻结；不会静默替换。')
    else:
        doc['runtimePolicy']=signature
    nodes[0]['binding']['parameters']['runtime']=config
    return doc

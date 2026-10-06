"""Closed CJ-to-test-store main path; editor metadata never grants execution."""
from decimal import Decimal
from apps.common.errors import RuleError
from apps.common.utils import parse
from contracts.selection import SelectionQuery

LAUNCH_IDS = ['product.start','product.collect','product.normalize','product.filter','product.delivery',
    'product.decide','product.cost','product.authorize','content.make','listing.validate',
    'listing.authorize','listing.map','listing.publish','listing.wait','listing.end']
UNIFIED_LAUNCH_IDS = ['product.start','product.collect','product.verify',*LAUNCH_IDS[5:]]
COMPACT_LAUNCH_IDS = ['product.start','product.collect','product.verify',*LAUNCH_IDS[7:]]
SELECTION_RULE_KEYS = {'minimumInventory','requireVerifiedInventory','allowFactorySupply','factoryProcessingDays','factorySaleLimit',
    'maximumDeliveryDays','allowCrossBorderShipping','platformFeeRate','paymentFeeRate','returnReserveRate','targetContributionRate','taxReserveUsd'}

def intelligence_offset(document):
    return int(bool(document.get('nodes') and document['nodes'][0].get('definitionId') == 'market.intelligence'))

def selection_ids(document):
    return [n.get('definitionId') for n in document.get('nodes',[]) if isinstance(n,dict)][intelligence_offset(document):]

def is_unified(document):
    return selection_ids(document) in (UNIFIED_LAUNCH_IDS,COMPACT_LAUNCH_IDS)

def is_compact(document):
    return selection_ids(document) == COMPACT_LAUNCH_IDS

def decision_binding(document):
    if is_compact(document):
        strategy=document.get('selectionStrategy')
        if not isinstance(strategy,dict) or strategy.get('definitionId')!='product.decide' or not isinstance(strategy.get('binding'),dict):
            raise RuleError('定义商品任务缺少选品与定价策略，请重新保存配置。')
        return strategy['binding']
    return next(n['binding'] for n in document['nodes'] if n['definitionId']=='product.decide')

def expanded_selection(document):
    """Validate compact graph first; expose trusted internal stages for legacy checks only."""
    if not is_compact(document):return document
    from copy import deepcopy
    nodes=document['nodes'];ids=[n.get('id') for n in nodes];edges=document.get('edges',[])
    if not isinstance(edges,list) or any(not isinstance(e,dict) for e in edges) or [(e.get('source'),e.get('target')) for e in edges if e.get('kind')=='forward']!=list(zip(ids,ids[1:])):
        raise RuleError('集中选品主线连线不完整，不能绕过统一核验。')
    if len(set(ids))!=len(ids) or any(e.get('source') not in ids or e.get('target') not in ids for e in edges) or len({e.get('id') for e in edges})!=len(edges):
        raise RuleError('集中选品节点或连线引用无效。')
    decision_binding(document)
    decision=deepcopy(document['selectionStrategy'])
    if set(decision)-{'id','definitionId','title','binding'} or not isinstance(decision.get('id'),str) or decision['id'] in ids:
        raise RuleError('任务策略标识无效。')
    index=2+intelligence_offset(document)
    cost_id=nodes[index]['id']+':cost'
    if cost_id in ids or cost_id==decision['id']:raise RuleError('内部核算标识冲突。')
    cost={'id':cost_id,'definitionId':'product.cost','title':'内部售价复核','binding':{'skillId':'product.cost.core','skillVersion':'1.0.0','mode':'default','parameters':{}}}
    result=deepcopy(document);result['nodes']=[*result['nodes'][:index+1],decision,cost,*result['nodes'][index+1:]]
    result['edges']=[{'id':f'internal:{a["id"]}:{b["id"]}','source':a['id'],'target':b['id'],'kind':'forward'} for a,b in zip(result['nodes'],result['nodes'][1:])]+[e for e in edges if e.get('kind')!='forward']
    return result

def is_launch(document):
    nodes=document.get('nodes',[]) if isinstance(document,dict) else []
    return isinstance(nodes,list) and all(isinstance(n,dict) for n in nodes) and selection_ids(document) in ((UNIFIED_LAUNCH_IDS,COMPACT_LAUNCH_IDS) if intelligence_offset(document) else (LAUNCH_IDS,UNIFIED_LAUNCH_IDS,COMPACT_LAUNCH_IDS))

def parameters(document, definition):
    if is_compact(document) and definition=='product.decide':return decision_binding(document).get('parameters',{})
    if is_unified(document) and definition in ('product.filter','product.delivery','product.cost'):
        return next(n['binding']['parameters'] for n in document['nodes'] if n['definitionId']=='product.start')
    return next(n['binding']['parameters'] for n in document['nodes'] if n['definitionId'] == definition)

def market_parameters(document):
    """Task-owned research inputs; legacy frozen documents keep their original binding."""
    start=parameters(document,'product.start')
    decision=parameters(document,'product.decide')
    if not start.get('marketEvidenceRef'):return decision
    if decision.get('marketEvidenceRef') and decision['marketEvidenceRef']!=start['marketEvidenceRef']:
        raise RuleError('任务与评估节点的市场证据冲突，请统一后重新保存。')
    estimated=start.get('allowEstimatedSales',False)
    if type(estimated) is not bool:raise RuleError('估算销量开关必须为布尔值。')
    if 'allowEstimatedSales' in decision and decision['allowEstimatedSales']!=estimated:
        raise RuleError('任务与评估节点的估算销量开关冲突，不能覆盖上游设置。')
    return {'marketEvidenceRef':start['marketEvidenceRef'],'allowEstimatedSales':estimated}

def selection_query(document):
    document=expanded_selection(document)
    start = parameters(document, 'product.start')
    stock = parameters(document, 'product.filter')
    delivery = parameters(document, 'product.delivery')
    cost = parameters(document, 'product.cost')
    query = {key:start[key] for key in ('market','requestedCurrency','categoryId','categoryQueries','keyword','emptyResultPolicy','candidateSource','limit') if key in start}
    if intelligence_offset(document) and parameters(document,'market.intelligence').get('enabled') is True:
        config=parameters(document,'market.intelligence')
        if not config.get('categoryPlanRef') or not config.get('categoryQueries'):
            raise RuleError('请在行情首节点确认供货类目方案。')
        query.update(categoryQueries=config['categoryQueries'],categoryId='',keyword='',emptyResultPolicy='pause',candidateSource='catalog')
    try:
        fees=[Decimal(str(cost.get(key,0))) for key in ('platformFeeRate','paymentFeeRate','returnReserveRate')]
        if any(not value.is_finite() or value<0 or value>100 for value in fees):
            raise ValueError()
        fee=sum(fees)
    except Exception:
        raise RuleError('系统核算的费用率必须为明确数字。')
    if start.get('category'):
        raise RuleError('旧手填类目不能用于真实查询，请重新选择 CJ 类目。')
    query.update(variants_per_product=start.get('variantsPerProduct', 2), minimum_inventory=stock.get('minimumInventory',5),
        maximum_days=delivery.get('maximumDeliveryDays',15), allow_factory_supply=stock.get('allowFactorySupply',False),
        factory_processing_days=stock.get('factoryProcessingDays'), factory_sale_limit=stock.get('factorySaleLimit'),
        fee_percent=fee,
        margin_percent=cost.get('targetContributionRate',30), tax_reserve_usd=cost.get('taxReserveUsd'),
        strategy={'2.0.0':'product.opportunity.v2','3.0.0':'product.opportunity.v3','4.0.0':'product.opportunity.v4','5.0.0':'product.opportunity.v5'}.get(next(n['binding'].get('skillVersion') for n in document['nodes'] if n['definitionId']=='product.decide'),'product.opportunity.v1') if next(n['binding']['skillId'] for n in document['nodes'] if n['definitionId']=='product.decide').startswith('registered.') else 'landed-cost.v1')
    query['demand_first_collection']=start.get('demandFirstCollection',False)
    query['minimum_cj_order_count']=start.get('minimumCJOrderCount',1)
    batch=start.get('batchPublishing',False)
    if type(batch) is not bool:raise RuleError('批次发布开关类型无效。')
    query['batch_target']=query.get('limit',3) if batch else 0
    query['final_selection_mode']=start.get('finalSelectionMode','per_category')
    if 'scanBudget' in start:query['scan_budget']=start['scanBudget']
    query['demand_quota']=start.get('demandQualifiedQuota',False)
    if query['demand_quota'] and (not batch or not query['demand_first_collection'] or not query.get('scan_budget')):
        raise RuleError('订单达标候选额度要求 CJ 需求前置批次，并设置候选额度。')
    if batch and (not query['demand_first_collection'] or query['strategy'] not in ('product.opportunity.v4','product.opportunity.v5')):
        raise RuleError('合格商品批次要求已注册的 CJ v4/v5 需求前置采集。')
    if query['demand_first_collection'] and query['strategy'] not in ('product.opportunity.v4','product.opportunity.v5'):
        raise RuleError('需求前置采集仅支持已注册的 CJ 订单选品 v4/v5。')
    query = parse(SelectionQuery, query)
    if query['tax_reserve_usd'] is None:
        raise RuleError('“系统核算”节点必须明确填写税费及附加费预留 USD，可明确填 0；不会把缺失值当零。')
    return query

def validate_launch(document, skill, *, frozen=False):
    original=document
    document=expanded_selection(document)
    from apps.skills.handlers import check_skill
    from django.conf import settings
    from contracts.store_api import package_contract, publication_package_compatible
    check_skill(skill)
    if document.get('schemaVersion')!='2' or type(document.get('revision')) is not int or document['revision']<1 or any(not isinstance(document.get(key),str) or not 1<=len(document[key])<=200 for key in ('id','title','templateId')):
        raise RuleError('流程文档标识、名称或版本无效。')
    if not is_launch(document):
        raise RuleError('当前支持集中配置的十三步 CJ 主线及历史十五步主线，不能跳过统一核验、审核或发布准备。')
    env = document.get('environment', {})
    if not isinstance(env,dict) or env.get('channel') != 'test-store' or env.get('fulfillment') != 'supplier':
        raise RuleError('真实完整主线当前支持 test-store / supplier，不冒充已实现其他渠道。')
    ids = [n.get('id') for n in document['nodes']]
    if any(not isinstance(key,str) or not key for key in ids) or len(set(ids)) != len(ids):
        raise RuleError('节点 ID 无效或重复。')
    edges = document.get('edges', [])
    if not isinstance(edges,list) or any(not isinstance(e,dict) or not isinstance(e.get('id'),str) or not e['id'] for e in edges):
        raise RuleError('连线结构或 ID 无效。')
    forward = [e for e in edges if e.get('kind') == 'forward']
    if [(e.get('source'),e.get('target')) for e in forward] != list(zip(ids,ids[1:])) or len({e.get('id') for e in edges}) != len(edges):
        raise RuleError('前向连线必须对应完整主线，不能绕过审核和准备节点。')
    if any(e.get('source') not in ids or e.get('target') not in ids or e.get('kind') not in ('forward','feedback','collaboration') for e in edges):
        raise RuleError('连线引用或类型无效。')
    task_parameters=parameters(document,'product.start')
    source=task_parameters.get('marketEvidenceSource','external' if task_parameters.get('marketEvidenceRef') else 'none')
    if source not in ('none','external','cj'):raise RuleError('未知市场证据来源。')
    if source=='cj' and (task_parameters.get('marketEvidenceRef') or task_parameters.get('allowEstimatedSales')):
        raise RuleError('CJ 自动证据不混用外部证据或估算销量，请清除旧引用。')
    minimum_sales=task_parameters.get('minimumCJSales90d',1)
    if type(minimum_sales) is not int or not 1<=minimum_sales<=100000000:raise RuleError('CJ 近 90 天最低销量须为 1–100000000 的整数。')
    minimum_orders=task_parameters.get('minimumCJOrderCount',1)
    if type(minimum_orders) is not int or not 1<=minimum_orders<=100000000:raise RuleError('CJ 最低订单数须为 1–100000000 的整数。')
    if 'allowEstimatedSales' in task_parameters and type(task_parameters['allowEstimatedSales']) is not bool:
        raise RuleError('定义商品任务的估算销量开关必须为布尔值。')
    if task_parameters.get('allowEstimatedSales') and not task_parameters.get('marketEvidenceRef'):
        raise RuleError('允许估算销量前请在定义商品任务中选择市场证据，不能忽略此设置。')
    # Optional relation declarations do not start side effects. Rework stays behind the controlled revise API.
    pkg = package_contract()
    allowed = {
        'market.intelligence':{'enabled','categoryPlanRef','categoryQueries'},
        'product.start':{'market','timeout','category','categoryId','categoryQueries','keyword','emptyResultPolicy','candidateSource','limit','requestedCurrency','variantsPerProduct','marketEvidenceRef','allowEstimatedSales','marketEvidenceSource','minimumCJSales90d','minimumCJOrderCount','demandFirstCollection','batchPublishing','scanBudget','demandQualifiedQuota','finalSelectionMode'},
        'product.collect':set(), 'product.normalize':set(),
        'product.filter':{'minimumInventory','requireVerifiedInventory','allowFactorySupply','factoryProcessingDays','factorySaleLimit'},
        'product.delivery':{'maximumDeliveryDays','allowCrossBorderShipping'},
        'product.decide':set(),
        'product.cost':{'platformFeeRate','paymentFeeRate','returnReserveRate','targetContributionRate','taxReserveUsd'},
        'product.authorize':{'market','timeout','reviewChecklist','approvalEnabled'},
        'listing.authorize':{'market','timeout','reviewChecklist','approvalEnabled'},
        'content.make':set(), 'listing.validate':set(), 'listing.publish':set(), 'listing.wait':set(),
        'listing.map':{'mappingMode','mappingPlanRef','mappingPlanVersion','mappingStoreRef','mappingStoreVersion'},
        'listing.end':{'market','timeout','ruleNote'},
    }
    if is_unified(document):
        allowed['product.start'] |= SELECTION_RULE_KEYS
        allowed['product.verify']=set()
        allowed['product.cost']=set()
    for n in document['nodes']:
        key = n['definitionId']; b = n.get('binding',{})
        if not isinstance(n.get('title'),str) or not n['title'] or not isinstance(b,dict) or set(b)-{'skillId','skillVersion','mode','parameters','connectionRef','execution'} or b.get('mode') not in ('default','custom'):
            raise RuleError('节点名称、绑定或运行设置无效。')
        p=b.get('parameters',{})
        if not isinstance(p,dict):
            raise RuleError({'node_id':n['id'],'message':f'“{n["title"]}”的参数结构无效。'})
        if b.get('execution'):
            raise RuleError(f'“{n["title"]}”的自定义超时/重试尚未开放，请移除执行覆盖；受信后端仍负责幂等与租约。')
        if b.get('connectionRef') not in (None,'',env.get('storeRef')):
            raise RuleError('节点连接不能覆盖冻结的店铺。')
        if key == 'content.make':
            expected = (f'registered.{skill.id}',skill.version)
        elif key in ('listing.validate','listing.publish','listing.wait'):
            descriptor=next((m for m in pkg['design_manifests'] if m['id']==f'installed.{pkg["package"]}.{key}'),None)
            if not descriptor:
                raise RuleError('已安装接口包缺少发布节点描述，不能冻结。')
            expected = (descriptor['id'],descriptor['version'])
        elif key == 'product.decide':
            from apps.skills.registry import selection_skill
            try:
                selected=selection_skill(b,skill.team)
                if selected and selected.handler in ('product.opportunity.v3','product.opportunity.v4','product.opportunity.v5'):
                    if source!='cj':raise RuleError('请在定义商品任务中选择“CJ 自动证据”。')
                    if selected.handler in ('product.opportunity.v4','product.opportunity.v5') and 'minimumCJSales90d' in task_parameters:
                        raise RuleError('订单数策略不能沿用90天销量门槛，请保存更新后的订单数任务设置。')
                elif source=='cj':raise RuleError('CJ 自动证据须配合已注册的 CJ 订单 / 销量选品版本，不能用旧算法忽略销量。')
                elif selected and selected.handler=='product.opportunity.v2':
                    from apps.skills.market_evidence import evidence_for
                    allowed[key]={'marketEvidenceRef','allowEstimatedSales'}
                    research=market_parameters(document)
                    if type(research.get('allowEstimatedSales',False)) is not bool:raise RuleError('估算销量开关必须为布尔值。')
                    q=selection_query(document)
                    evidence_for(skill.team,research.get('marketEvidenceRef'),q['market'],q['requestedCurrency'])
                elif parameters(document,'product.start').get('marketEvidenceRef'):
                    raise RuleError('任务已设置销量证据，请在评估节点选择已审核的“销量趋势与竞争选品 v2”；不会忽略证据。')
            except RuleError as exc:
                raise RuleError({'node_id':n['id'],'message':str(exc.detail),
                    'hint':'在定义商品任务配置 CJ 自动证据并绑定选品算法；使用外部证据时选择“销量趋势与竞争选品 v2”。保存后重新冻结，不会忽略证据或自动换版本。'})
            expected = (b.get('skillId'),b.get('skillVersion'))
        else:
            expected = (f'{key}.core','1.0.0')
        if (b.get('skillId'),b.get('skillVersion')) != expected:
            raise RuleError({'node_id':n['id'],'message':f'“{n["title"]}”未绑定已实现的运行策略。',
                'required_skill':expected[0], 'required_version':expected[1],
                'hint':'选品选择“到货成本与时效排序（真实运行）”；内容选择已审核的“原素材与商品文案整理”；接口在准备发布节点选择已验收的店铺包。不会自动替换你的 Skill。'})
        if set(p)-allowed[key]:
            raise RuleError({'node_id':n['id'],'message':f'“{n["title"]}”含有未实现的执行参数：'+ '、'.join(sorted(set(p)-allowed[key])),
                'hint':'重新选择已注册的兼容 Skill 并应用，参数以该版本声明为准；不会忽略未知参数。'})
        if p.get('timeout',60) != 60 or p.get('market',env.get('market','US')) != 'US':
            raise RuleError('当前运行仅支持 US；自定义工具超时尚未开放。')
        if key == 'market.intelligence':
            if type(p.get('enabled',False)) is not bool:
                raise RuleError('行情开关须为布尔值。')
            if p.get('enabled'):
                from apps.connections.intelligence_plans import read, queries
                from apps.connections.cj_intelligence import status
                from apps.connections.models import SupplierConnection
                plan=read(skill.team_id,p.get('categoryPlanRef'))
                if p.get('categoryQueries') != queries(plan):
                    raise RuleError('行情类目与已确认方案不一致，不能覆盖为其他查询。')
                if not SupplierConnection.objects.filter(team_id=skill.team_id,provider='cj',status='verified',configuration_version=plan['connection_version']).exists():
                    raise RuleError('行情方案的 CJ 连接版本已变化，请重新确认。')
                if not status(skill.team_id)['session_saved']:
                    raise RuleError('请在行情首节点配对普通 Chrome 扩展，并在 CJ 正常登录；API Key 不代替网页连接。')
        if key in ('product.authorize','listing.authorize'):
            if type(p.get('approvalEnabled',True)) is not bool:
                raise RuleError('审核开关必须为布尔值。')
            if p.get('approvalEnabled',True) is False and not (settings.LOCAL and settings.DESKTOP_MODE):
                raise RuleError('关闭审核仅适用于私人本机测试站。')
    if parameters(document,'product.filter').get('requireVerifiedInventory',True) is not True:
        raise RuleError('未知库存不能用于发布；请保留“仅接受已验证库存”，工厂供货另行显式开启。')
    if parameters(document,'product.delivery').get('allowCrossBorderShipping',True) is not True:
        raise RuleError('当前配送策略需要允许跨境直发；国内线路专用策略尚未实现。')
    p = parameters(document,'listing.map')
    version_matches = publication_package_compatible(p.get('mappingPlanRef'),p.get('mappingPlanVersion')) if frozen else p.get('mappingPlanVersion') == pkg['version']
    if p.get('mappingMode') != 'installed' or p.get('mappingPlanRef') != pkg['package'] or not version_matches or p.get('mappingStoreRef') != env.get('storeRef') or type(p.get('mappingStoreVersion')) is not int:
        raise RuleError('准备渠道发布数据节点需选择当前已验收的店铺接口包；映射分析草案不能执行。')
    selection_query(document)
    return original

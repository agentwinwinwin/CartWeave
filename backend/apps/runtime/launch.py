"""Bounded, resumable node handlers. Every CJ call is read-only."""
import re
from copy import deepcopy
from decimal import Decimal, ROUND_UP
from django.utils import timezone
from django.db import transaction
from apps.common.errors import RuleError
from apps.common.utils import parse
from apps.identity.models import Membership
from apps.connections.cj_catalog import connection_for, ProductSearch
from apps.registry.launch import selection_query, market_parameters, parameters
from contracts.assets import allowed_image
from .models import SelectionTask
from . import selection

def task_for(run):
    task = SelectionTask.objects.get(pk=run.context['selection_task'], team=run.team)
    if task.evidence.get('workflow_run') != str(run.id):
        raise RuleError('选品任务未绑定当前运行。')
    member = Membership.objects.get(team=run.team, user=run.requested_by, active=True)
    if connection_for(member).configuration_version != task.connection_version:
        raise RuleError('CJ 连接版本已变化；请使用新配置启动新任务。')
    return task

def landed(row, q):
    reserve = Decimal(q['tax_reserve_usd'])
    taxes = selection.amount(row.get('quoted_taxes')) or Decimal(0)
    clearance = selection.amount(row.get('clearance_fee')) or Decimal(0)
    postage = max(Decimal(row['shipping_cost']) + max(reserve,taxes+clearance), selection.amount(row.get('quoted_total_postage')) or Decimal(0))
    return Decimal(row['supplier_cost']) + postage

def execute_node(run, definition):
    q = selection_query(run.version.document)
    task = task_for(run)
    state = deepcopy(run.context.get('selection', {}))
    if definition == 'product.start':
        from apps.registry.launch import intelligence_offset
        if intelligence_offset(run.version.document) and parameters(run.version.document,'market.intelligence').get('enabled'):
            prepared=run.context.get('market_intelligence',{})
            if prepared.get('status')!='ready' or prepared.get('category_queries')!=q['categoryQueries']:
                raise RuleError('行情方向尚未采集或类目未核对，不能进入商品任务。')
        if parameters(run.version.document,'product.start').get('marketEvidenceRef'):
            from apps.skills.market_evidence import evidence_for
            evidence_for(run.team,market_parameters(run.version.document)['marketEvidenceRef'],q['market'],q['requestedCurrency'])
        return {'query':q, 'selection':{'records':[], 'facts':[], 'candidates':[], 'rejected':[]}}
    if definition == 'product.collect':
        member = Membership.objects.get(team=run.team, user=run.requested_by, active=True)
        search = ProductSearch(**{k:v for k,v in q.items() if k in ProductSearch.model_fields})
        reference=parameters(run.version.document,'product.start').get('marketEvidenceRef')
        if reference:
            from apps.skills.market_evidence import evidence_for
            evidence_for(run.team,reference,q['market'],q['requestedCurrency'])
        result, collecting = selection.collect_page(task, search, state.get('collection'))
        if collecting:
            state['collection'] = result
            return {'selection': state, '_continue': True}
        if q.get('demand_first_collection'):state['collection']=result
        else:state.pop('collection', None)
        if not q.get('demand_first_collection') and result.get('outcome')=='results':
            from .existing_products import task_blocked_pids
            blocked=task_blocked_pids(task)
            excluded=[{'pid':r['id'],'reason':'当前店铺已上架或发布结果待确认'} for r in result['products'] if r['id'] in blocked]
            result={**result,'products':[r for r in result['products'] if r['id'] not in blocked],'excluded_existing':excluded}
            if not result['products']:
                result.update(outcome='no_results',message='本次候选已在当前店铺上架或提交中，已排除，不会重复发布。')
        if reference:
            from .market_search import join_evidence
            result=join_evidence(run.team,result,reference,q['market'],q['requestedCurrency'])
        if result.get('outcome') != 'results':
            state['search']={k:result.get(k) for k in ('groups','attempts','scanned','scan_limit','quota_limit','demand_qualified','rejected','excluded_existing')}
            return {'selection':state,'_research_required':True,'_research_message':
                result.get('message') if q.get('demand_first_collection') or result.get('excluded_existing') else
                (result.get('message') or '市场证据未对应本次候选，不能继续研究。') if reference else
                'CJ 查询无完整候选结果；请查看类目范围、仓库筛选或接口失败，不会扩大范围。'}
        records = result.get('products', [])
        maximum=(q.get('scan_budget') or min(500,max(20,q['limit']*5))) if q.get('batch_target') else q['limit']
        if not records or len(records)>maximum or len({r['id'] for r in records}) != len(records):
            raise RuleError('CJ 候选数量或标识不符合冻结任务范围。')
        state.update(records=records,search={'candidateSource':search.candidateSource,'attempts':result.get('attempts',[]),'groups':result.get('groups',[]),
            'scanned':result.get('scanned'),'scan_limit':result.get('scan_limit'),'quota_limit':result.get('quota_limit'),'demand_qualified':result.get('demand_qualified'),'demand_rejected':result.get('rejected',[]),
            'excluded_existing':result.get('excluded_existing',[])},observed_at=timezone.now().isoformat())
        if reference:state['search']['market_evidence']=result['market_evidence']
    elif definition == 'product.normalize':
        index = len(state['facts']); records=state['records']
        if index>=len(records):
            # Explicit retry after an all-missing research pause re-reads the same bounded records.
            # Never merely refresh old observation timestamps.
            state['facts']=[];index=0
        market_fact=None
        metric='order_count' if q['strategy'] in ('product.opportunity.v4','product.opportunity.v5') else 'sales_90d'
        metric_label='CJ 订单数（周期未声明）' if metric=='order_count' else 'CJ 近 90 天销量'
        if q['strategy'] in ('product.opportunity.v3','product.opportunity.v4','product.opportunity.v5'):
            from apps.skills.opportunity_cj import normalize
            if metric=='order_count':
                from apps.skills.opportunity_orders import normalize
            pid=str(records[index]['id'])
            cached=records[index].get('demand_evidence') if q.get('demand_first_collection') else None
            if cached:
                from .cj_evidence import verify_fresh
                verify_fresh([cached],'order_count')
                market_fact=cached
            else:
                raw=selection.read(task,'/product/productDetail/query',method='POST',json={'id':pid})
                market_fact=normalize(raw,pid,timezone.now().isoformat())
        snapshot=records[index].get('detail_snapshot')
        if snapshot:
            from .cj_snapshot import fresh
            product=fresh(snapshot)
            # Missing product essentials are supplemented, never guessed.
            if not product.get('productNameEn') or not product.get('productImage'):
                product=selection.read(task,'/product/query',params={'pid':str(records[index]['id'])})
        else:
            product=selection.read(task,'/product/query',params={'pid':str(records[index]['id'])})
        pid=str(records[index]['id'])
        if str(product.get('pid')) != pid or not isinstance(product.get('variants'),list):
            raise RuleError('CJ 商品详情标识或规格结构不匹配。')
        from django.utils.html import strip_tags
        raw=product['variants']; limited=raw[:q['variants_per_product']]
        facts={'pid':pid,'title':strip_tags(str(product.get('productNameEn') or ''))[:200],
            'image':product.get('productImage'),'variants':limited,'omitted_variants':max(0,len(raw)-len(limited)),
            **({'detail_observed_at':product['observed_at']} if product.get('observed_at') else {})}
        if market_fact:
            facts['market_evidence']=market_fact
            minimum=parameters(run.version.document,'product.start').get('minimumCJOrderCount' if metric=='order_count' else 'minimumCJSales90d',1)
            if market_fact[metric] is None or market_fact[metric]<minimum:
                facts['market_rejection']=metric_label+'未返回' if market_fact[metric] is None else metric_label+'低于任务门槛'
                facts['variants']=[]
        state['facts'].append(facts)
        if len(state['facts'])<len(records):return {'selection':state,'_continue':True}
        if q['strategy'] in ('product.opportunity.v3','product.opportunity.v4','product.opportunity.v5') and q.get('candidateSource','catalog')=='catalog':
            # Rank products, not SKU counts: all sales are read before any stock request.
            # Unknown sales remain explicit exclusions; never use orderCount/listed.
            state['facts'].sort(key=lambda p:(
                p['market_evidence'][metric] is None,
                -(p['market_evidence'][metric] or 0),p['pid']))
            state['demand_metric']=metric
            state['sales_ranking']=[{'pid':p['pid'],metric:p['market_evidence'][metric],
                'eligible':not bool(p.get('market_rejection')),'reason':p.get('market_rejection')}
                for p in state['facts']]
        state['specs']=[{'product':p,'variant':v} for p in state['facts'] for v in p['variants']]
        state['filter_index']=0
        if not state['specs']:
            if q['strategy'] in ('product.opportunity.v3','product.opportunity.v4','product.opportunity.v5'):
                return {'selection':state,'selection_proposal':{'phase':'research','algorithm':q['strategy'],'version':'5.0.0' if q['strategy']=='product.opportunity.v5' else '4.0.0' if metric=='order_count' else '3.0.0','recommended_vid':None,'ranked':[],
                    'basis':f'检查商品资料阶段的 {metric_label}核验，尚未进行综合评分。',
                    'warning':'未生成商品与售价建议，不进入库存、运费、核算或发布。',
                    'unknowns':([metric_label] if any(p['market_evidence'][metric] is None for p in state['facts']) else [])+['目标国家销量','增长趋势','搜索热度','竞争售价','获客成本'],
                    'requires_manual_review':True,
                    'rejected':[{'pid':p['pid'],'reasons':[p.get('market_rejection','缺少规格')]} for p in state['facts']]},
                    '_research_required':True,'_research_message':f'缺少可继续研究的 {metric_label}或规格资料，或低于门槛；停在检查商品资料，请查看逐商品原因。'}
            raise RuleError('所有商品都缺少可研究规格。')
    elif definition == 'product.filter':
        index=state['filter_index']; spec=state['specs'][index]; p=spec['product']; v=spec['variant'];vid=v.get('vid')
        if not isinstance(vid,str) or not vid:raise RuleError('规格缺少 CJ vid。')
        from .cj_snapshot import complete_detail
        cached=complete_detail(v)
        if cached:
            from .cj_snapshot import fresh
            fresh({'observed_at':p['detail_observed_at']})
            detail=v['_cj_detail']
        else:
            detail=selection.read(task,'/product/variant/queryByVid',params={'vid':vid,'features':'enable_inventory'})
        if str(detail.get('pid'))!=p['pid'] or str(detail.get('vid'))!=vid:raise RuleError('商品与规格标识不匹配。')
        inventory=detail.get('inventories') or []
        stocks=[w for w in inventory if isinstance(w,dict) and str(w.get('verifiedWarehouse'))=='1' and type(w.get('cjInventory')) is int and w['cjInventory']>=q['minimum_inventory'] and re.fullmatch('[A-Z]{2}',str(w.get('countryCode','')))]
        factories=[w for w in inventory if isinstance(w,dict) and type(w.get('factoryInventory')) is int and w['factoryInventory']>=q['minimum_inventory'] and re.fullmatch('[A-Z]{2}',str(w.get('countryCode','')))] if q['allow_factory_supply'] else []
        cost=selection.amount(detail.get('variantSellPrice'));image=detail.get('variantImage') or v.get('variantImage') or p['image']
        row={'pid':p['pid'],'vid':vid,'title':p['title'],'sku':detail.get('variantSku'),'option':str(detail.get('variantKey') or vid)[:40],
            'image':image,'supplier_cost':str(cost) if cost is not None else None,'currency':'USD','sales':None,
            'observed_at':p['detail_observed_at'] if cached else timezone.now().isoformat(),'omitted_variants':p['omitted_variants'],
            'inventory_evidence':[{k:w.get(k) for k in ('countryCode','cjInventory','factoryInventory','verifiedWarehouse','totalInventory')} for w in inventory if isinstance(w,dict)]}
        if not (stocks or factories) or not cost or not allowed_image(image) or not row['title'] or not row['sku']:
            row.update(status='rejected',reason='库存来源、供货价、原图、标题或 SKU 缺失/不合格');state['rejected'].append(row)
        elif stocks:
            w=sorted(stocks,key=lambda w:(w['countryCode']!=q['market'],-w['cjInventory']))[0]
            row.update(origin=w['countryCode'],inventory=w['cjInventory'],supply_type='cj_stock',processing_days=0,status='pending');state['candidates'].append(row)
        else:
            if q['factory_processing_days'] is None or q['factory_sale_limit'] is None:
                raise RuleError('工厂供货必须明确备货天数与限售量，不能把工厂报量当已核实库存。')
            w=sorted(factories,key=lambda w:(w['countryCode']!=q['market'],-w['factoryInventory']))[0]
            row.update(origin=w['countryCode'],inventory=min(q['factory_sale_limit'],w['factoryInventory']),supply_type='factory',processing_days=q['factory_processing_days'],factory_reported_quantity=w['factoryInventory'],status='pending');state['candidates'].append(row)
        state['filter_index']+=1
        if state['filter_index']<len(state['specs']):
            if complete_detail(state['specs'][state['filter_index']]['variant']):
                from copy import copy
                local=copy(run);local.context={**run.context,'selection':state}
                return execute_node(local,'product.filter')
            return {'selection':state,'_continue':True}
        if not state['candidates']:
            # Persist the last rejected SKU and 100% checked count before pausing.
            return {'selection':state,'_research_required':True,
                '_research_message':'全部规格已筛查，没有通过真实库存与商品资料检查的规格；请调整选品条件。'}
        state['delivery_index']=0
    elif definition == 'product.delivery':
        row=state['candidates'][state['delivery_index']]
        quotes=selection.read(task,'/logistic/freightCalculate',method='POST',allow_list=True,json={'startCountryCode':row['origin'],'endCountryCode':q['market'],'products':[{'quantity':1,'vid':row['vid']}]})
        options=[]
        for quote in quotes if isinstance(quotes,list) else []:
            if not isinstance(quote,dict):continue
            price=selection.amount(quote.get('logisticPrice'));aging=re.fullmatch(r'(\d+)(?:\s*-\s*(\d+))?',str(quote.get('logisticAging','')))
            if price is not None and aging and int(aging[2] or aging[1])+row['processing_days']<=q['maximum_days'] and quote.get('logisticName'):
                option={**row,'shipping_cost':str(price),'maximum_days':int(aging[2] or aging[1]),'logistic':quote['logisticName'],
                    'quoted_taxes':quote.get('taxesFee'),'clearance_fee':quote.get('clearanceOperationFee'),'quoted_total_postage':quote.get('totalPostageFee')}
                options.append(option)
        if not options:row.update(status='rejected',reason='没有满足备货与运输时效的完整报价')
        else:
            row.update(min(options,key=lambda r:landed(r,q)),status='delivery_verified',quote_observed_at=timezone.now().isoformat())
        state['delivery_index']+=1
        if state['delivery_index']<len(state['candidates']):return {'selection':state,'_continue':True}
        if not any(r['status']=='delivery_verified' for r in state['candidates']):
            if q.get('batch_target'):return {'selection':state,'_research_required':True,'_research_message':'该商品没有配送核验通过的规格。'}
            raise RuleError('没有配送核验通过的规格。')
    elif definition == 'product.decide':
        eligible=[r for r in state['candidates'] if r['status']=='delivery_verified']
        from apps.skills.registry import selection_skill
        from apps.skills.opportunity import propose
        from apps.registry.launch import decision_binding
        binding=decision_binding(run.version.document)
        strategy=selection_skill(binding,run.team)
        if strategy:
            inputs=[{'pid':r['pid'],'vid':r['vid'],'landed_cost':landed(r,q),'inventory':r['inventory'],
                'total_days':r['maximum_days']+r['processing_days'],'supply_type':r['supply_type']} for r in eligible]
            if strategy.handler in ('product.opportunity.v4','product.opportunity.v5'):
                from apps.skills.opportunity_orders import propose as order_propose
                if strategy.handler=='product.opportunity.v5':
                    from apps.skills.opportunity_listings import propose as order_propose
                proposal=order_propose(inputs,q,[r['market_evidence'] for r in state['facts']],parameters(run.version.document,'product.start').get('minimumCJOrderCount',1))
            elif strategy.handler=='product.opportunity.v3':
                from apps.skills.opportunity_cj import propose as cj_propose
                proposal=cj_propose(inputs,q,[r['market_evidence'] for r in state['facts']],parameters(run.version.document,'product.start').get('minimumCJSales90d',1))
            elif strategy.handler=='product.opportunity.v2':
                from apps.skills.market_evidence import evidence_for
                from apps.skills.opportunity_market import propose as market_propose
                research=market_parameters(run.version.document)
                record,evidence=evidence_for(run.team,research['marketEvidenceRef'],q['market'],q['requestedCurrency'])
                proposal=market_propose(inputs,q,evidence,research.get('allowEstimatedSales',False))
                proposal.update(evidence_ref=str(record.id),evidence_digest=record.digest,provenance='operator_import_unverified')
            else:proposal=propose(inputs,q)
            state.update(ranked_vids=[r['vid'] for r in proposal['ranked']],selected_vid=proposal['recommended_vid'],
                strategy=strategy.handler,proposal=proposal,strategy_version_id=str(strategy.id),strategy_hash=strategy.artifact_hash,
                decision_note=proposal['basis']+' '+proposal['warning'])
            return {'selection':state,'selection_proposal':proposal,**({'_research_required':True} if proposal['recommended_vid'] is None else {})}
        ordered=sorted(eligible,key=lambda r:(landed(r,q),r['maximum_days'],r['vid']))
        state['ranked_vids']=[r['vid'] for r in ordered]
        state['selected_vid']=ordered[0]['vid']
        state['strategy']='landed-cost.v1'
        state['decision_note']='确定性到货成本与时效排序，发布最高排名的一件商品；其他候选保留，不预测销量。'
    elif definition == 'product.cost':
        for row in state['candidates']:
            if row['status']!='delivery_verified':continue
            from datetime import timedelta
            from django.utils.dateparse import parse_datetime
            observed=parse_datetime(row['quote_observed_at'])
            if not observed or observed<timezone.now()-timedelta(hours=1):
                raise RuleError('选品运费报价已超过一小时，请重新运行，不能刷新证据时间掩盖过期。')
            total=landed(row,q);fee=Decimal(q['fee_percent']);margin=Decimal(q['margin_percent'])
            ad=Decimal(0)
            if state.get('proposal',{}).get('algorithm') in ('product.opportunity.v2','product.opportunity.v3','product.opportunity.v4','product.opportunity.v5'):
                proposed=next((r for r in state['proposal']['ranked'] if r['vid']==row['vid']),None)
                if proposed is None:
                    row.update(status='rejected',reason='市场证据或含广告经营空间未通过');continue
                if state['proposal']['algorithm']=='product.opportunity.v2':ad=Decimal(proposed['acquisition_cost'])
            retail=((total+ad)/(1-(fee+margin)/100)).quantize(Decimal('.01'),rounding=ROUND_UP)
            row.update(status='eligible',landed_cost=str(total),suggested_price=str(retail),
                contribution_before_ads=str((retail*(1-fee/100)-total).quantize(Decimal('.01'))),
                estimated_total_days=row['maximum_days']+row['processing_days'],tax_reserve=q['tax_reserve_usd'])
            if state.get('proposal',{}).get('algorithm')=='product.opportunity.v2':
                row.update(acquisition_cost=str(ad),contribution_after_ads=str((retail*(1-fee/100)-total-ad).quantize(Decimal('.01'))))
            if state.get('proposal'):
                proposed=next(r for r in state['proposal']['ranked'] if r['vid']==row['vid'])
                if Decimal(proposed['suggested_price'])!=retail:
                    raise RuleError('策略建议售价与系统独立核算不一致，不能继续审核或发布。')
        # Existing CJ evidence validation remains authoritative for every approval and publication.
        with transaction.atomic():
            task=SelectionTask.objects.select_for_update().get(pk=task.pk)
            task.candidates=state['candidates']+state['rejected'];task.evidence={**task.evidence,'ranked_vids':state['ranked_vids'],
                'selection_proposal':state.get('proposal'), 'strategy_version_id':state.get('strategy_version_id'), 'strategy_hash':state.get('strategy_hash')}
            task.status='ready';task.stage='done';task.completed_at=timezone.now();task.save()
        brief=selection.selected_brief(task,state['selected_vid'])
        return {'selection':state,'brief':brief}
    else:raise RuleError('未实现的选品节点。')
    return {'selection':state}

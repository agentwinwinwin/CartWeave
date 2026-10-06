"""Bounded demand-first collection; one list page OR one evidence read per turn."""
from copy import deepcopy
from django.utils import timezone
from apps.common.errors import RuleError
from apps.connections.cj_catalog import ProductSearch, candidate_search_params
from apps.connections.cj import samples
from apps.skills.opportunity_orders import normalize


def collect(task, search, saved=None):
    from .selection import read, preview
    from apps.identity.models import Membership
    groups = search.categoryQueries or [search]
    budget = task.query.get('scan_budget') or min(500, max(20, search.limit * 5))
    demand_quota=task.query.get('demand_quota',False)
    streaming=bool(task.query.get('scan_budget') and task.query.get('batch_target') and not search.categoryQueries)
    state = deepcopy(saved) if saved and (not saved.get('outcome') or saved.get('continuation')) else dict(group_index=0, page=1, pending=[], pending_index=0,
        pool=[], products=[], groups=[], attempts=[], seen=[], scanned=0, rejected=[], scan_limit=budget)
    if state.pop('continuation',False):
        state.pop('outcome',None);state['products']=[]
    i = state['group_index']; group = groups[i]
    quota = search.limit // len(groups) + (i < search.limit % len(groups))
    group_budget = budget // len(groups) + (i < budget % len(groups))
    size = min(20, group_budget)
    if state['pending_index'] < len(state['pending']):
        row = state['pending'][state['pending_index']]
        # Reserve each original PID once; retries reuse the same persisted cursor.
        if row['id'] not in state['seen']:
            from .existing_products import task_blocked_pids
            if row['id'] in task_blocked_pids(task):
                state['seen'].append(row['id'])
                state.setdefault('excluded_existing',[]).append({'pid':row['id'],'reason':'当前店铺已上架或发布结果待确认'})
                state['pending_index'] += 1
                return state, True
            raw = read(task, '/product/productDetail/query', method='POST', json={'id': row['id']})
            fact = normalize(raw, row['id'], timezone.now().isoformat())
            state['seen'].append(row['id']); state['scanned'] += 1
            threshold = task.query.get('minimum_cj_order_count', 1)
            if fact['order_count'] is not None and fact['order_count'] >= threshold:
                from .cj_snapshot import extract
                snapshot=extract(raw,row['id'],fact['observed_at'])
                state['pool'].append({**row, 'demand_evidence': fact,**({'detail_snapshot':snapshot} if snapshot is not None else {})})
                state['demand_qualified']=state.get('demand_qualified',0)+1
                state['group_qualified']=state.get('group_qualified',0)+1
            else:
                state['rejected'].append({'pid':row['id'], 'order_count':fact['order_count'],
                    'reason':'CJ 订单数未返回' if fact['order_count'] is None else 'CJ 订单数低于任务门槛'})
        state['pending_index'] += 1
        if demand_quota and state.get('group_qualified',0)>=group_budget:
            state.update(pending=[],pending_index=0,page_done=True,termination='demand_quota')
        return state, True
    if state.get('page_done'):
        from .existing_products import task_blocked_pids
        blocked=task_blocked_pids(task)
        for row in state['pool']:
            if row['id'] in blocked:
                state.setdefault('excluded_existing',[]).append({'pid':row['id'],'reason':'选品期间已由其他流程提交或上架'})
        state['pool']=[r for r in state['pool'] if r['id'] not in blocked]
        # No quota is consumed by unknown/low demand. Rank before selecting quota.
        pool = sorted(state['pool'], key=lambda r:(-r['demand_evidence']['order_count'], r['id']))
        selected = pool if task.query.get('batch_target') else pool[:quota]
        state['products'].extend({**r,'selection_category':group.categoryId} for r in selected)
        state['groups'].append({'categoryId':group.categoryId, 'keyword':group.keyword, 'quota':quota,
            'outcome':'results' if selected else 'no_results', 'products':selected,
            'scan_slots':state.get('group_scanned',0), 'qualified':len(pool)})
        state.update(group_index=i+1, page=1, pending=[], pending_index=0, pool=[], page_done=False, group_scanned=0,group_qualified=0)
        if state['group_index'] < len(groups):return state, True
        # Recheck earlier groups before handing over the final candidate set.
        for row in state['products']:
            if row['id'] in blocked and not any(x['pid']==row['id'] for x in state.get('excluded_existing',[])):
                state.setdefault('excluded_existing',[]).append({'pid':row['id'],'reason':'选品期间已由其他流程提交或上架'})
        state['products']=[r for r in state['products'] if r['id'] not in blocked]
        return {**state, 'outcome':'results' if state['products'] else 'no_results',
            'termination':state.get('termination','directory'),
            'query':search.model_dump(), 'preview_only':False,
            'message':f'在限定扫描范围内没有可用候选；已排除 {len(state.get("excluded_existing",[]))} 款同店铺已上架或提交中的商品，其余需订单需求达标。'}, False
    if streaming and state['pool']:
        # Research this page before fetching more. Only the batch executor may resume it.
        state['products']=[{**r,'selection_category':group.categoryId} for r in sorted(state['pool'],key=lambda r:(-r['demand_evidence']['order_count'],r['id']))]
        state['pool']=[]
        return {**state,'outcome':'results','continuation':True,'preview_only':False},False
    if state['page'] == 1:
        member = Membership.objects.get(team=task.team, user=task.requested_by, active=True)
        query = ProductSearch(categoryId=group.categoryId, keyword=group.keyword, limit=size,
            market=search.market, requestedCurrency=search.requestedCurrency, candidateSource=search.candidateSource,
            emptyResultPolicy=search.emptyResultPolicy if group.keyword else 'pause')
        # Stock belongs to the subsequent stock check, not the demand candidate quota.
        result = preview(member, query, stock_only=False)
        if result['outcome'] not in ('results','no_results'):raise RuleError('CJ 类目查询失败，不作为零结果。')
        rows = result['products']; state['attempts'].extend(result['attempts'])
        state['active_keyword'] = result['attempts'][-1]['keyword'] if result['attempts'] else group.keyword
    else:
        params = {'page':state['page'], 'size':size, **candidate_search_params(search)}
        if group.categoryId:params['categoryId'] = group.categoryId
        if state['active_keyword']:params['keyWord'] = state['active_keyword']
        rows = samples(read(task, '/product/listV2', params=params), limit=size)
    remaining = group_budget - state.get('group_scanned',0)
    state['pending'] = rows if demand_quota else rows[:remaining]; state['pending_index'] = 0
    state['group_scanned'] = state.get('group_scanned',0) + len(state['pending'])
    repeated=demand_quota and bool(rows) and all(r['id'] in state['seen'] for r in rows)
    state['page_done'] = len(rows) < size or (not demand_quota and state['group_scanned'] >= group_budget) or repeated or state['page']>=1000
    if state['page_done']:
        state['termination']='directory' if len(rows)<size else 'duplicate_page' if repeated else 'page_limit' if state['page']>=1000 else 'budget'
    if demand_quota:
        state['quota_limit']=budget;state['scan_limit']=None
    state['page'] += 1
    return state, True

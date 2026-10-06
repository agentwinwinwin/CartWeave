"""One operator batch, bounded sequential qualification, independent publications."""
from copy import copy, deepcopy
from django.db import transaction
from apps.common.errors import RuleError
from apps.common.utils import digest, parse
from apps.registry.launch import selection_query
from contracts.listings import Listing, check_listing
from .models import WorkflowRun


def enabled(run):
    return not run.context.get('batch_parent') and bool(selection_query(run.version.document).get('batch_target'))


def research(run, definition):
    from .launch import execute_node
    from .selection import selected_product_brief
    q=selection_query(run.version.document);target=q['batch_target']
    state=deepcopy(run.context.get('selection',{}))
    meta={**run.context.get('batch_meta',{}),'target':target,'qualified':len(state.get('qualified_pids',[]))}
    if definition in ('product.start','product.collect'):
        result=execute_node(run,definition)
        if definition=='product.collect' and result.get('_research_required') and state.get('records') and result['selection'].get('collection',{}).get('termination'):
            # Empty final page is normal exhaustion, not a failed product lookup.
            result.pop('_research_required',None);result.pop('_research_message',None)
            result['selection']['records']=[]
        if definition=='product.collect' and result.get('_research_required') and result['selection'].get('collection',{}).get('termination'):
            ending=result['selection']['collection']['termination']
            stop='扫描预算已达到，搜索结果未必全部结束' if ending=='budget' else '订单达标候选额度已达到' if ending=='demand_quota' else 'CJ 目录结束或分页安全边界已达到'
            result['_research_message']=f'目标 {target} 款，当前合格 {meta["qualified"]} 款；{stop}。请查看需求与库存排除原因，不自动减量。'
            meta['shortfall']=True
        if definition=='product.collect' and not result.get('_continue') and not result.get('_research_required'):
            # Page ordering is not a global ranking. Research every candidate in scope.
            new=result['selection']['records']
            previous=state.get('records',[]) if state.get('research_index',0)>0 else []
            result['selection']['records']=previous+[r for r in new if r['id'] not in {p['id'] for p in previous}]
            for key,default in [('research_index',0),('qualified_rows',[]),('qualified_pids',[]),('processed_facts',[]),('qualified_categories',{})]:
                result['selection'][key]=state.get(key,default)
            result['selection'].update(demand_metric='order_count',sales_ranking=[
                {'pid':r['id'],'order_count':r['demand_evidence']['order_count'],'eligible':True}
                for r in sorted(result['selection']['records'],key=lambda r:-r['demand_evidence']['order_count'])])
        return {**result,'batch_meta':meta,'batch_mode':'parent'}
    if definition in ('product.normalize','product.filter','product.delivery'):
        if meta.get('research_complete'):
            return {'selection':state,'batch_meta':meta}
        records=state['records'];index=state.get('research_index',0)
        if index>=len(records):
            if state.get('collection',{}).get('continuation'):
                state.pop('current_research',None)
                return {'selection':state,'batch_meta':meta,'_goto':1}
            groups=q.get('categoryQueries') or [{'categoryId':''}]
            quotas={g['categoryId']:target//len(groups)+(i<target%len(groups)) for i,g in enumerate(groups)}
            enough=meta['qualified']>=target if q.get('final_selection_mode')=='global' else all(state.get('qualified_categories',{}).get(category,0)>=quota for category,quota in quotas.items())
            if enough:
                state.update(facts=state['processed_facts'],candidates=state['qualified_rows'])
                state.pop('current_research',None)
                meta.update(research_complete=True,ranking_scope=state.get('collection',{}).get('termination','directory'))
                return {'selection':state,'batch_meta':meta}
            ending=state.get('collection',{}).get('termination')
            stop='已达到本次扫描预算，尚未证明搜索结果全部结束' if ending=='budget' else '订单达标候选额度已达到' if ending=='demand_quota' else 'CJ 目录结束或分页安全边界已达到'
            counts=state.get('qualified_categories',{})
            distribution='；'.join(f'类目 {i+1}：合格 {counts.get(g["categoryId"],0)} / 配额 {quotas[g["categoryId"]]}' for i,g in enumerate(groups))
            if q.get('final_selection_mode')=='global':
                return {'selection':state,'batch_meta':{**meta,'shortfall':True},'_research_required':True,
                    '_research_message':f'目标 {target} 款，合并候选池中共 {meta["qualified"]} 款完成全部核验，尚不足目标。{stop}。请查看排除原因；不会凑数或自动减量。'}
            reason='合格总数已达到目标，但部分类目未达到冻结配额' if meta['qualified']>=target else '合格商品不足目标'
            return {'selection':state,'batch_meta':{**meta,'shortfall':True},'_research_required':True,
                '_research_message':f'目标 {target} 款，共 {meta["qualified"]} 款完成全部核验；{reason}。{distribution}。{stop}。类目顺序与任务配置一致，不跨类目挪用配额、不凑数或自动减量。'}
        if definition=='product.normalize':
            state['current_research']={'records':[records[index]],'facts':[],'candidates':[],'rejected':[]}
        local=copy(run);local.context={**run.context,'selection':state['current_research']}
        result=execute_node(local,definition);current=result['selection'];state['current_research']=current
        if result.get('_continue'):return {'selection':state,'batch_meta':meta,'_continue':True}
        from apps.registry.launch import is_unified
        if definition=='product.normalize' and not is_unified(run.version.document) and not result.get('_research_required'):
            from .cj_snapshot import complete_detail
            if current.get('specs') and all(complete_detail(s['variant']) for s in current['specs']):
                # Both local checks consume the same immutable snapshot in this turn.
                # No threads, remote calls, artificial waits or skipped node evidence.
                combined=copy(run);combined.context={**run.context,'selection':state}
                checked=research(combined,'product.filter')
                target_cursor=checked.pop('_goto',4)
                return {**checked,'_local_advance':target_cursor}
        complete=result.get('_research_required') or definition=='product.delivery'
        if complete:
            state['processed_facts'].extend(current.get('facts',[]))
            passed=[r for r in current.get('candidates',[]) if r.get('status')=='delivery_verified']
            # Count only cost-representable specifications, not merely deliverable ones.
            from decimal import Decimal, ROUND_UP
            from .launch import landed
            from contracts.listings import Variant
            from pydantic import ValidationError
            for row in passed:
                price=(landed(row,q)/(1-(Decimal(q['fee_percent'])+Decimal(q['margin_percent']))/100)).quantize(Decimal('.01'),rounding=ROUND_UP)
                try:
                    Variant(sku=row['sku'],size=row['option'],cj_pid=row['pid'],cj_vid=row['vid'],price=price,inventory=row['inventory'])
                except ValidationError:
                    row.update(status='rejected',reason='规格、库存或系统核算售价不满足受信发布契约')
            passed=[r for r in passed if r['status']=='delivery_verified']
            category=records[index].get('selection_category','')
            if passed:
                state['qualified_rows'].extend(passed);state['qualified_pids'].append(records[index]['id'])
                state['qualified_categories'][category]=state['qualified_categories'].get(category,0)+1
            else:
                state.setdefault('product_exclusions',[]).append({'pid':records[index]['id'],
                    'reason':result.get('_research_message') or '该商品没有通过库存与配送核验的规格',
                    'specs':current.get('rejected',[])+[r for r in current.get('candidates',[]) if r.get('status')=='rejected']})
            state['research_index']=index+1
            meta['qualified']=len(state['qualified_pids']);meta['researched']=meta.get('researched',0)+1
            # Re-enter normalize even after N qualify: it drains pages, then finalizes.
            return {'selection':state,'batch_meta':meta,'_goto':2}
        return {'selection':state,'batch_meta':meta}
    result=execute_node(run,definition)
    if definition=='product.cost' and not result.get('_research_required'):
        from .launch import task_for
        task=task_for(run)
        ranked=result['selection']['ranked_vids'];rows=result['selection']['candidates']
        pids=[]
        for vid in ranked:
            row=next(r for r in rows if r['vid']==vid)
            if row['pid'] not in pids:pids.append(row['pid'])
        groups=q.get('categoryQueries') or [{'categoryId':''}]
        quotas={g['categoryId']:target//len(groups)+(i<target%len(groups)) for i,g in enumerate(groups)}
        categories={r['id']:r.get('selection_category','') for r in result['selection']['records']}
        selected=[];counts={}
        for pid in pids:
            category=categories.get(pid,'')
            if q.get('final_selection_mode')=='global':
                if len(selected)<target:selected.append(pid)
            elif counts.get(category,0)<quotas.get(category,0):
                selected.append(pid);counts[category]=counts.get(category,0)+1
        briefs=[selected_product_brief(task,pid) for pid in selected]
        if len(briefs)!=target:raise RuleError('系统核算后的批次数量与目标不符，不能进入审批。')
        result['selection']['selected_pids']=selected
        result.update(batch_briefs=briefs,brief=briefs[0],batch_meta={**meta,'qualified':len(pids),'selected':len(briefs)})
    return result


def inherit_approval(run,stage):
    from .services import require_approval
    parent=WorkflowRun.objects.select_related('version__skill','store').get(pk=run.context['batch_parent'],team=run.team)
    if parent.context.get('batch_mode')!='parent' or parent.status=='cancelled' or parent.context.get('stop_requested') or parent.version_id!=run.version_id or parent.store_id!=run.store_id or parent.store_version!=run.store_version:
        raise RuleError('批次授权已取消或店铺/执行版本不一致。')
    require_approval(parent,stage)
    key='brief' if stage=='brief' else 'listing'
    cohort=parent.context['batch_briefs' if stage=='brief' else 'batch_listings']
    expected=next((x for x in cohort if x['product_id']==run.context['batch_member']),None)
    if expected!=run.context.get(key):raise RuleError('该商品不在批次批准清单内，不能继承审批。')


def validate_approval(run,stage):
    from contracts.listings import Brief
    from .selection import verify_selection_brief
    briefs=run.context.get('batch_briefs',[])
    target=selection_query(run.version.document)['batch_target']
    if len(briefs)!=target or len({b.get('product_id') for b in briefs})!=target:
        raise RuleError('批次必须达到目标数量，且不能包含重复商品。')
    for brief in briefs:
        parse(Brief,brief);verify_selection_brief(run.team,brief)
    if stage=='listing':
        listings=run.context.get('batch_listings',[])
        if len(listings)!=target or len(run.context.get('batch_validations',[]))!=target:
            raise RuleError('批次内容或渠道检查尚未全部完成。')
        for listing,brief in zip(listings,briefs,strict=True):
            check_listing(parse(Listing,listing),brief)


def perform(run,definition):
    from .services import require_approval, audit, enqueue
    from .selection import verify_selection_brief
    from apps.skills.handlers import execute
    from apps.integrations.registry import listing_adapter
    if definition=='product.verify':
        from .unified_selection import verify
        return verify(run)
    if definition.startswith('product.') and definition!='product.authorize':return research(run,definition)
    briefs=run.context.get('batch_briefs',[])
    for brief in briefs:verify_selection_brief(run.team,brief)
    require_approval(run,'brief')
    if definition=='content.make':
        listings=deepcopy(run.context.get('batch_listings',[]));brief=briefs[len(listings)]
        listing=parse(Listing,execute(run.version.skill,brief,{}));check_listing(listing,brief);listings.append(listing)
        return {'batch_listings':listings,'listing':listings[0],**({'_continue':True} if len(listings)<len(briefs) else {})}
    if definition=='listing.validate':
        validations=deepcopy(run.context.get('batch_validations',[]));listing=run.context['batch_listings'][len(validations)]
        result=listing_adapter(run.store).validate(listing)
        if not result.get('valid'):raise RuleError('批次中有商品未通过渠道字段检查，不能审批。')
        validations.append(result)
        return {'batch_validations':validations,'channel_validation':{'valid':len(validations)==len(briefs)},
            **({'_continue':True} if len(validations)<len(briefs) else {})}
    require_approval(run,'listing')
    if definition=='listing.map':
        # Provision private members only after both real batch decisions.
        children=[]
        for i,(brief,listing) in enumerate(zip(briefs,run.context['batch_listings'],strict=True)):
            key='batch-'+digest({'batch':str(run.id),'product':brief['product_id']})
            context={'batch_parent':str(run.id),'batch_member':brief['product_id'],'brief':brief,'listing':listing,
                'channel_validation':run.context['batch_validations'][i],
                **{k:run.context[k] for k in ('selection','selection_task','selection_proposal','query')}}
            with transaction.atomic():
                child,created=WorkflowRun.objects.get_or_create(team=run.team,idempotency_key=key,defaults={
                    'version':run.version,'store':run.store,'store_version':run.store_version,'requested_by':run.requested_by,
                    'cursor':next(i for i,n in enumerate(run.version.document['nodes']) if n['definitionId']=='listing.map'),
                    'request_digest':digest(context),'context':context})
                if child.request_digest!=digest(context):raise RuleError('批次成员的幂等输入发生变化。')
                if created:
                    audit(child,'batch.member_created',run.requested_by,{'parent':str(run.id),'approval_mode':'parent-snapshot'})
                    enqueue(child)
            children.append(str(child.id))
        return {'batch_children':children}
    if definition in ('listing.publish','listing.wait'):
        children=list(WorkflowRun.objects.filter(pk__in=run.context['batch_children'],team=run.team).select_related('publication'))
        if len(children)!=len(briefs):raise RuleError('批次成员缺失，不能标记完成。')
        items=[{'run_id':str(child.id),'product_id':child.context['brief']['product_id'],'title':child.context['brief']['title'],
            'status':child.status,'error':child.error,'external_id':getattr(getattr(child,'publication',None),'external_id',None)} for child in children]
        meta={**run.context['batch_meta'],'published':sum(x['status']=='succeeded' and bool(x['external_id']) for x in items),
            'failed':sum(x['status'] in ('needs_attention','cancelled') for x in items)}
        result={'batch_items':items,'batch_meta':meta}
        if any(x['status'] not in ('succeeded','needs_attention','cancelled') for x in items):return {**result,'_continue':True,'_delay':2}
        if meta['published']!=len(briefs):return {**result,'_research_required':True,
            '_research_message':f'批次已确认可售 {meta["published"]}/{len(briefs)} 款，其余需要处理；成功商品保留，仅重试失败成员。'}
        return result
    if definition=='listing.end':return {'batch_completed':True}
    raise RuleError('未实现的批次节点。')

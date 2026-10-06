from apps.common.utils import digest
from apps.common.errors import RuleError
from apps.registry.launch import selection_query,market_parameters
from apps.skills.market_evidence import evidence_for
from apps.skills.opportunity_market import propose

def verify(run):
    from apps.registry.launch import is_compact,decision_binding
    binding=decision_binding(run.version.document) if is_compact(run.version.document) else next((n['binding'] for n in run.version.document['nodes'] if n['definitionId']=='product.decide'),None)
    if not binding or binding.get('skillVersion') not in ('2.0.0','3.0.0','4.0.0','5.0.0'):return
    from apps.skills.registry import selection_skill
    selection_skill(binding,run.team)
    index=next(i for i,n in enumerate(run.version.document['nodes']) if n['definitionId']==('product.verify' if is_compact(run.version.document) else 'product.decide'))
    if 'selection_proposal' not in run.context:
        if run.cursor>index:raise RuleError('市场选品证据缺失，不能绕过评估。')
        return
    q=selection_query(run.version.document)
    from .launch import landed
    # Rejected-by-market rows still retain delivery facts, and must stay in the recomputation.
    rows=[r for r in run.context['selection']['candidates'] if r.get('shipping_cost') is not None]
    inputs=[{'pid':r['pid'],'vid':r['vid'],'landed_cost':landed(r,q),'inventory':r['inventory'],
        'total_days':r['maximum_days']+r['processing_days'],'supply_type':r['supply_type']} for r in rows]
    if binding['skillVersion'] in ('3.0.0','4.0.0','5.0.0'):
        if run.cursor<=index:return  # Early research failure has no completed proposal.
        from apps.skills.opportunity_cj import propose as cj_propose
        orders=binding['skillVersion'] in ('4.0.0','5.0.0')
        if orders:
            from apps.skills.opportunity_orders import propose as cj_propose
            if binding['skillVersion']=='5.0.0':
                from apps.skills.opportunity_listings import propose as cj_propose
        from apps.registry.launch import parameters
        from .cj_evidence import verify_fresh
        evidence=[r['market_evidence'] for r in run.context['selection']['facts']]
        verify_fresh(evidence,'order_count' if orders else 'sales_90d')
        expected=cj_propose(inputs,q,evidence,parameters(run.version.document,'product.start').get('minimumCJOrderCount' if orders else 'minimumCJSales90d',1))
    else:
        research=market_parameters(run.version.document)
        record,evidence=evidence_for(run.team,research['marketEvidenceRef'],q['market'],q['requestedCurrency'])
        expected=propose(inputs,q,evidence,research.get('allowEstimatedSales',False))
        expected.update(evidence_ref=str(record.id),evidence_digest=record.digest,provenance='operator_import_unverified')
    if digest(expected)!=digest(run.context['selection_proposal']):raise RuleError('市场选品评分、输入或来源摘要已改变，不能继续审批或发布。')

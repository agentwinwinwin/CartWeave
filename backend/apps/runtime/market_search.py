"""Join bounded CJ search results to the task's market evidence, without widening search."""
from copy import deepcopy
from apps.skills.market_evidence import evidence_for

def join_evidence(team, result, reference, market, currency):
    record,evidence=evidence_for(team,reference,market,currency)
    ids={row['cj_pid'] for row in evidence['rows']}
    joined=deepcopy(result)
    products=joined.get('products',[])
    matched=[p for p in products if str(p['id']) in ids]
    joined.update(products=matched,market_evidence={
        'reference':str(record.id),'digest':record.digest,
        'searched_count':len(products),'matched_count':len(matched),
        'unmatched_ids':[str(p['id']) for p in products if str(p['id']) not in ids],
        'provenance':'operator_import_unverified'})
    for group in joined.get('groups',[]):
        group['market_matched_count']=sum(str(p['id']) in ids for p in group.get('products',[]))
    if joined.get('outcome')=='results' and not matched:
        joined.update(outcome='market_evidence_missing',message='本次限额 CJ 搜索结果没有对应的市场证据，已停止；不扩大类目、不用类目均值代替商品销量。')
    elif matched:
        joined['message']=f'本次 CJ 样本 {len(products)} 件，市场证据对应 {len(matched)} 件；仅对应商品继续研究，未对应商品不进入详情与运费核验。'
    return joined

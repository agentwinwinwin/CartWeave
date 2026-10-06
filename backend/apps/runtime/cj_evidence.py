"""Read-only, bounded source adapter, separate from deterministic ranking."""
import time
from datetime import timedelta
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from apps.common.errors import RuleError
from apps.connections.cj_catalog import read_cj,connection_for
from apps.skills.opportunity_cj import normalize,CJEvidence

def verify_fresh(rows,metric='sales_90d'):
    from apps.skills.opportunity_orders import CJEvidence as OrderEvidence
    for raw in rows:
        row=(OrderEvidence if metric=='order_count' else CJEvidence).model_validate(raw);observed=parse_datetime(row.observed_at)
        if not observed or timezone.is_naive(observed) or observed>timezone.now() or observed<timezone.now()-timedelta(hours=1):
            raise RuleError('CJ 销量证据已过期或时间无效，请重新采集，不刷新原时间。')

def preview_evidence(member,result):
    connection=connection_for(member);facts=[]
    # Source verification, not a full crawl. At most three extra read-only requests.
    for product in result.get('products',[])[:3]:
        connection.refresh_from_db()
        delay=(connection.verification_until-timezone.now()).total_seconds() if connection.verification_until else 0
        if delay>3:raise RuleError('CJ 正在验证，请稍后再试搜。')
        if delay>0:time.sleep(delay+.05)
        pid=str(product['id'])
        raw=read_cj(connection,'/product/productDetail/query',method='POST',json={'id':pid})
        from apps.skills.opportunity_orders import normalize as order_normalize
        now=timezone.now().isoformat()
        facts.append({**normalize(raw,pid,now),'order_count':order_normalize(raw,pid,now)['order_count']})
    return {**result,'cj_evidence':facts,'cj_evidence_unread':max(0,len(result.get('products',[]))-len(facts))}

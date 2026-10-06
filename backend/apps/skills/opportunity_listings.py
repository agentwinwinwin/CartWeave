"""Versioned order-demand plus listing-interest score; no market-sales claims."""
from decimal import Decimal, ROUND_HALF_UP
from typing import Literal
from pydantic import Field
from . import opportunity_orders as orders
from .opportunity import Candidate

KEY = orders.KEY
HANDLER = 'product.opportunity.v5'
VERSION = '5.0.0'


class Row(orders.Row):
    listing_count: int = Field(ge=0)
    listing_score: Decimal = Field(ge=0, le=100)


class Proposal(orders.Proposal):
    algorithm: Literal['product.opportunity.v5']
    version: Literal['5.0.0']
    ranked: list[Row]


def propose(rows, query, evidence, minimum_orders=1):
    candidates = [Candidate.model_validate(row) for row in rows]
    facts = [orders.CJEvidence.model_validate(row) for row in evidence]
    by_pid = {fact.pid: fact for fact in facts}
    # Reuse v4's validation, demand gate, and unchanged price calculation.
    result = orders.propose(rows, query, evidence, minimum_orders)
    kept = []
    for row in result['ranked']:
        count = by_pid[row['pid']].listing_count
        if count is None:
            result['rejected'].append({'pid': row['pid'], 'vid': row['vid'], 'reasons': ['CJ 刊登次数未返回，不能填零或按完整评分继续。']})
        else:
            kept.append(row)
    candidate_by_vid = {row.vid: row for row in candidates}
    if kept:
        max_orders = max(row['order_count'] for row in kept)
        min_cost = min(candidate_by_vid[row['vid']].landed_cost for row in kept)
        min_days = min(max(1, candidate_by_vid[row['vid']].total_days) for row in kept)
        for row in kept:
            candidate = candidate_by_vid[row['vid']]
            count = by_pid[row['pid']].listing_count
            # Saturation: 100 listings=50 points, 900=90. Avoid one huge count
            # compressing every other candidate's score to almost zero.
            listing = Decimal(count) / (Decimal(count) + 100) * 100
            demand = Decimal(row['order_count']) / max_orders * 100
            cost = min_cost / candidate.landed_cost * 100
            delivery = Decimal(min_days) / max(1, candidate.total_days) * 100
            inventory = min(Decimal(candidate.inventory) / 50, Decimal(1)) * 100
            score = max(Decimal(0), demand * Decimal('.45') + listing * Decimal('.25')
                        + cost * Decimal('.15') + delivery * Decimal('.10')
                        + inventory * Decimal('.05') - Decimal(row['factory_penalty']))
            row.update(score=score.quantize(Decimal('.0001'), rounding=ROUND_HALF_UP),
                       demand_score=demand.quantize(Decimal('.0001')),
                       cost_score=cost.quantize(Decimal('.0001')),
                       delivery_score=delivery.quantize(Decimal('.0001')),
                       listing_count=count, listing_score=listing.quantize(Decimal('.0001')))
        kept.sort(key=lambda row: (-row['score'], candidate_by_vid[row['vid']].landed_cost,
                                  candidate_by_vid[row['vid']].total_days, row['vid']))
    result.update(algorithm=HANDLER, version=VERSION, ranked=kept,
                  recommended_vid=kept[0]['vid'] if kept else None,
                  basis='CJ 订单数45% + 刊登关注度25% + 到货成本15% + 总时效10% + 库存5%；刊登分=次数/(次数+100)×100，工厂扣10。',
                  warning='刊登次数仅为 CJ 商品关注度代理，不等于独立商家数、销量或真实市场竞争。订单周期与国家未声明；不预测店铺销量。建议价不含广告，不证明市场接受度。')
    return Proposal.model_validate(result).model_dump(mode='json')

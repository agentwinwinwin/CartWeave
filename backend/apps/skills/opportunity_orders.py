"""CJ order counts with unspecified reporting period; never 90-day units sold."""
from decimal import Decimal,ROUND_HALF_UP,ROUND_UP
from typing import Literal
from pydantic import BaseModel,ConfigDict,Field
from .opportunity import Candidate

KEY='product.opportunity'
HANDLER='product.opportunity.v4'
VERSION='4.0.0'

class CJEvidence(BaseModel):
    model_config=ConfigDict(extra='forbid')
    pid:str=Field(min_length=1)
    source:Literal['cj.productDetail.v1']='cj.productDetail.v1'
    order_scope:Literal['cj_platform_unspecified_market']='cj_platform_unspecified_market'
    order_window_days:None=None
    order_count:int|None=Field(default=None,ge=0,strict=True)
    listing_count:int|None=Field(default=None,ge=0,strict=True)
    observed_at:str

def normalize(raw,pid,observed_at):
    if not isinstance(raw,dict) or str(raw.get('id'))!=pid:
        raise ValueError('CJ 订单详情商品 ID 不匹配。')
    # Missing values are not zero; booleans/numeric strings are not trusted integers.
    for key in ('orderCount','listed'):
        if raw.get(key) is not None and (type(raw[key]) is not int or raw[key]<0):
            raise ValueError('CJ 订单数或刊登数结构变化，不能继续评分。')
    return CJEvidence(pid=pid,order_count=raw.get('orderCount'),listing_count=raw.get('listed'),observed_at=observed_at).model_dump(mode='json')

class Row(BaseModel):
    model_config=ConfigDict(extra='forbid')
    pid:str
    vid:str
    score:Decimal=Field(ge=0,le=100)
    demand_score:Decimal
    cost_score:Decimal
    delivery_score:Decimal
    inventory_score:Decimal
    factory_penalty:Decimal
    order_count:int
    suggested_price:Decimal=Field(gt=0)
    contribution_before_ads:Decimal

class Proposal(BaseModel):
    model_config=ConfigDict(extra='forbid')
    algorithm:Literal['product.opportunity.v4']
    version:Literal['4.0.0']
    recommended_vid:str|None
    ranked:list[Row]
    rejected:list[dict]
    evidence:list[CJEvidence]
    basis:str
    unknowns:list[str]
    warning:str
    requires_manual_review:Literal[True]
    provenance:Literal['cj_api']

def propose(rows,query,evidence,minimum_orders=1):
    if type(minimum_orders) is not int or not 1<=minimum_orders<=100000000:raise ValueError('CJ 最低订单数须为 1–100000000 的整数。')
    candidates=[Candidate.model_validate(row) for row in rows]
    facts=[CJEvidence.model_validate(row) for row in evidence]
    if len({r.pid for r in facts})!=len(facts) or len({r.vid for r in candidates})!=len(candidates):raise ValueError('CJ 商品证据或规格重复。')
    by_pid={row.pid:row for row in facts};eligible=[];rejected=[]
    for row in candidates:
        fact=by_pid.get(row.pid)
        reason='CJ 未返回订单数（周期未声明），不能用刊登次数或缺失值代替。' if fact is None or fact.order_count is None else 'CJ 订单数（周期未声明）低于本次任务门槛。' if fact.order_count<minimum_orders else ''
        if reason:rejected.append({'pid':row.pid,'vid':row.vid,'reasons':[reason]})
        else:eligible.append(row)
    ranked=[]
    if eligible:
        fee=Decimal(str(query['fee_percent']));target=Decimal(str(query['margin_percent']))
        if not (0<=fee<=30 and 0<target<=50 and fee+target<100):raise ValueError('费用率或贡献率无效。')
        max_orders=max(by_pid[r.pid].order_count for r in eligible);min_cost=min(r.landed_cost for r in eligible);min_days=min(max(1,r.total_days) for r in eligible)
        for row in eligible:
            orders=by_pid[row.pid].order_count;demand=Decimal(orders)/max_orders*100
            cost=min_cost/row.landed_cost*100;delivery=Decimal(min_days)/max(1,row.total_days)*100;inventory=min(Decimal(row.inventory)/50,Decimal(1))*100
            penalty=Decimal(10) if row.supply_type=='factory' else Decimal(0)
            score=max(Decimal(0),demand*Decimal('.45')+cost*Decimal('.35')+delivery*Decimal('.15')+inventory*Decimal('.05')-penalty)
            price=(row.landed_cost/(1-(fee+target)/100)).quantize(Decimal('.01'),rounding=ROUND_UP)
            ranked.append(Row(pid=row.pid,vid=row.vid,score=score.quantize(Decimal('.0001'),rounding=ROUND_HALF_UP),demand_score=demand.quantize(Decimal('.0001')),cost_score=cost.quantize(Decimal('.0001')),delivery_score=delivery.quantize(Decimal('.0001')),inventory_score=inventory,factory_penalty=penalty,order_count=orders,suggested_price=price,contribution_before_ads=(price*(1-fee/100)-row.landed_cost).quantize(Decimal('.01'))))
        by_vid={row.vid:row for row in eligible};ranked.sort(key=lambda r:(-r.score,by_vid[r.vid].landed_cost,by_vid[r.vid].total_days,r.vid))
    return Proposal.model_validate({'algorithm':HANDLER,'version':VERSION,'recommended_vid':ranked[0].vid if ranked else None,
        'ranked':[row.model_dump(mode='json') for row in ranked],'rejected':rejected,'evidence':[row.model_dump(mode='json') for row in facts],
        'basis':'CJ 平台订单数（周期未声明） 45% + 到货成本 35% + 总时效 15% + 库存缓冲 5%；批内排序，工厂扣 10。',
        'unknowns':['目标国家销量及近 90 天销量','30 天增长趋势','搜索热度','真实竞品售价','获客成本'],
        'warning':'CJ 未声明订单数的统计周期或国家；订单数不是卖出件数，不预测目标店铺销量，不把刊登数当竞争商家数。建议价为广告前核算价，不证明市场接受度。',
        'requires_manual_review':True,'provenance':'cj_api'}).model_dump(mode='json')

"""Deterministic supply feasibility ranking, not a demand or sales forecast."""
from decimal import Decimal, ROUND_UP, ROUND_HALF_UP
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field

KEY = 'product.opportunity'
HANDLER = 'product.opportunity.v1'
VERSION = '1.0.0'

class Candidate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    pid: str = Field(min_length=1)
    vid: str = Field(min_length=1)
    landed_cost: Decimal = Field(gt=0)
    inventory: int = Field(gt=0, strict=True)
    total_days: int = Field(ge=0, strict=True)
    supply_type: Literal['cj_stock','factory']

class ProposalRow(BaseModel):
    model_config = ConfigDict(extra='forbid')
    pid: str
    vid: str
    score: Decimal = Field(ge=0,le=100)
    cost_score: Decimal
    delivery_score: Decimal
    inventory_score: Decimal
    factory_penalty: Decimal
    suggested_price: Decimal = Field(gt=0)
    contribution_before_ads: Decimal

def propose(rows, query):
    candidates=[Candidate.model_validate(row) for row in rows]
    if not candidates or len({r.vid for r in candidates})!=len(candidates):
        raise ValueError('Candidates must be nonempty and have unique variant identities.')
    fee=Decimal(str(query['fee_percent']));target=Decimal(str(query['margin_percent']))
    if not (0<=fee<=30 and 0<target<=50 and fee+target<100):
        raise ValueError('Invalid explicit economics parameters.')
    minimum_cost=min(r.landed_cost for r in candidates)
    minimum_days=min(max(1,r.total_days) for r in candidates)
    ranked=[]
    for row in candidates:
        cost=minimum_cost/row.landed_cost*100
        delivery=Decimal(minimum_days)/max(1,row.total_days)*100
        inventory=min(Decimal(row.inventory)/50,Decimal(1))*100
        penalty=Decimal(10) if row.supply_type=='factory' else Decimal(0)
        score=max(Decimal(0),cost*Decimal('.60')+delivery*Decimal('.25')+inventory*Decimal('.15')-penalty)
        retail=(row.landed_cost/(1-(fee+target)/100)).quantize(Decimal('.01'),rounding=ROUND_UP)
        result=ProposalRow(pid=row.pid,vid=row.vid,score=score.quantize(Decimal('.0001'),rounding=ROUND_HALF_UP),
            cost_score=cost.quantize(Decimal('.0001')),delivery_score=delivery.quantize(Decimal('.0001')),
            inventory_score=inventory,factory_penalty=penalty,suggested_price=retail,
            contribution_before_ads=(retail*(1-fee/100)-row.landed_cost).quantize(Decimal('.01')))
        ranked.append(result)
    by_id={row.vid:row for row in candidates}
    ranked.sort(key=lambda r:(-r.score,by_id[r.vid].landed_cost,by_id[r.vid].total_days,r.vid))
    return {'algorithm':HANDLER,'version':VERSION,'recommended_vid':ranked[0].vid,
        'ranked': [row.model_dump(mode='json') for row in ranked],
        'basis':'成本 60% + 总时效 25% + 库存缓冲 15%；工厂供货扣 10 分。评分仅在本批候选内比较。',
        'unknowns':['市场需求','真实销量','广告获客成本','竞争售价'],
        'warning':'不是爆款预测；建议售价是满足配置贡献率的核算价，不证明市场接受度或最终利润。'}

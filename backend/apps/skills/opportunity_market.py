"""Demand/competition/economics rule v2. Imported data is evidence, not a truth guarantee."""
from decimal import Decimal,ROUND_UP
from typing import Literal
from pydantic import BaseModel,ConfigDict,Field
from .opportunity import Candidate
from .market_evidence import Observation

HANDLER='product.opportunity.v2'
VERSION='2.0.0'
KEY='product.opportunity'

class RankedRow(BaseModel):
    model_config=ConfigDict(extra='forbid')
    pid:str
    vid:str
    score:Decimal=Field(ge=0,le=100)
    demand_score:Decimal=Field(ge=0,le=100)
    trend_score:Decimal=Field(ge=0,le=100)
    competition_score:Decimal=Field(ge=0,le=100)
    economics_score:Decimal=Field(ge=0,le=100)
    fulfilment_score:Decimal=Field(ge=0,le=100)
    factory_penalty:Decimal=Field(ge=0,le=10)
    suggested_price:Decimal=Field(gt=0)
    acquisition_cost:Decimal=Field(ge=0)
    competitor_median_price:Decimal=Field(gt=0)
    contribution_before_ads:Decimal
    contribution_after_ads:Decimal
    sales_kind:Literal['observed','estimated']
    observation:Observation

class RejectedRow(BaseModel):
    model_config=ConfigDict(extra='forbid')
    pid:str
    vid:str
    reasons:list[str]=Field(min_length=1)
    required_price:Decimal|None=None
    market_price:Decimal|None=None

class Proposal(BaseModel):
    model_config=ConfigDict(extra='forbid')
    algorithm:Literal['product.opportunity.v2']
    version:Literal['2.0.0']
    recommended_vid:str|None
    ranked:list[RankedRow]
    rejected:list[RejectedRow]
    requires_manual_review:Literal[True]
    basis:str
    unknowns:list[str]
    warning:str

def propose(rows,query,evidence,allow_estimated=False):
    candidates=[Candidate.model_validate(r) for r in rows]
    if not candidates or len({r.vid for r in candidates})!=len(candidates):raise ValueError('Invalid candidate identities.')
    observations={r['cj_pid']:r for r in evidence['rows']}
    fee=Decimal(str(query['fee_percent']));margin=Decimal(str(query['margin_percent']))
    if not (0<=fee<=30 and 0<margin<=50):raise ValueError('Invalid economics.')
    usable=[];rejected=[]
    required=['sales_30d','previous_sales_30d','searches_30d','previous_searches_30d','competitor_count','competitor_median_price','acquisition_cost']
    for row in candidates:
        obs=observations.get(row.pid)
        reasons=[]
        if not obs:reasons=['缺少与 CJ 商品对应的市场证据']
        else:
            reasons=['缺少 '+key for key in required if obs[key] is None]
            if obs['sales_kind']=='estimated' and not allow_estimated:reasons.append('估算销量未获显式允许')
            if obs['sales_30d']==0:reasons.append('当前窗口没有销量证据')
            if obs['searches_30d']==0:reasons.append('当前窗口没有搜索需求证据')
        if reasons:
            rejected.append({'pid':row.pid,'vid':row.vid,'reasons':reasons});continue
        ad=Decimal(obs['acquisition_cost'])
        price=((row.landed_cost+ad)/(1-(fee+margin)/100)).quantize(Decimal('.01'),rounding=ROUND_UP)
        ceiling=Decimal(obs['competitor_median_price'])
        if price>ceiling:
            rejected.append({'pid':row.pid,'vid':row.vid,'reasons':['满足配置贡献率的含广告售价超过竞品中位价，需补充差异化或定价证据'],'required_price':str(price),'market_price':str(ceiling)});continue
        usable.append((row,obs,price,ad,ceiling))
    ranked=[]
    max_sales=max([o['sales_30d'] for _,o,*_ in usable],default=1)
    max_search=max([o['searches_30d'] for _,o,*_ in usable],default=1)
    def trend(current,previous):
        # No invented infinite growth when the previous window is zero.
        return Decimal(50) if previous==0 else Decimal(50)+max(Decimal(-100),min(Decimal(100),Decimal(current-previous)/previous*100))/2
    for row,obs,price,ad,ceiling in usable:
        demand=Decimal(obs['sales_30d'])/max_sales*70+Decimal(obs['searches_30d'])/max_search*30
        growth=trend(obs['sales_30d'],obs['previous_sales_30d'])*Decimal('.7')+trend(obs['searches_30d'],obs['previous_searches_30d'])*Decimal('.3')
        competition=100/(1+Decimal(obs['competitor_count'])/20)
        economics=min(Decimal(100),max(Decimal(0),(ceiling*(1-fee/100)-row.landed_cost-ad)/ceiling*200))
        fulfilment=max(Decimal(0),100-Decimal(row.total_days)/query['maximum_days']*60)*Decimal('.7')+min(Decimal(1),Decimal(row.inventory)/50)*30
        penalty=Decimal(10) if row.supply_type=='factory' else Decimal(0)
        score=max(Decimal(0),demand*Decimal('.3')+growth*Decimal('.2')+competition*Decimal('.15')+economics*Decimal('.2')+fulfilment*Decimal('.15')-penalty)
        ranked.append({'pid':row.pid,'vid':row.vid,'score':str(score.quantize(Decimal('.0001'))),
            'demand_score':str(demand),'trend_score':str(growth),'competition_score':str(competition),
            'economics_score':str(economics),'fulfilment_score':str(fulfilment),'factory_penalty':str(penalty),
            'suggested_price':str(price),'acquisition_cost':str(ad),'competitor_median_price':str(ceiling),
            'contribution_before_ads':str((price*(1-fee/100)-row.landed_cost).quantize(Decimal('.01'))),
            'contribution_after_ads':str((price*(1-fee/100)-row.landed_cost-ad).quantize(Decimal('.01'))),
            'sales_kind':obs['sales_kind'],'observation':obs})
    by_id={r.vid:r for r in candidates}
    ranked.sort(key=lambda r:(-Decimal(r['score']),by_id[r['vid']].landed_cost,by_id[r['vid']].total_days,r['vid']))
    result={'algorithm':HANDLER,'version':VERSION,'recommended_vid':ranked[0]['vid'] if ranked else None,
        'ranked':ranked,'rejected':rejected,'requires_manual_review':True,
        'basis':'需求 30% + 销量/搜索趋势 20% + 竞争 15% + 含广告经营空间 20% + 履约 15%；工厂扣 10 分。',
        'unknowns':['未来销量','未来广告实际成本','来源真实性（人工导入未独立核实）'],
        'warning':'两个相邻 30 天窗口；零历史不推断无限增长。批内相对评分，不保证好卖。导入数据须人工核验，两轮审核强制开启。'}
    return Proposal.model_validate(result).model_dump(mode='json')
